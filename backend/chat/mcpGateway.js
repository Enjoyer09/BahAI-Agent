// ==========================================
// Model Context Protocol (MCP) Client Gateway
//
// Real stdio MCP client: spawns each configured server process and speaks
// JSON-RPC 2.0 over stdio (newline-delimited messages), performing the
// standard handshake:
//   1. client -> initialize
//   2. server -> initialize result
//   3. client -> notifications/initialized
//   4. client -> tools/list
//   5. client -> tools/call { name, arguments }
//
// Config lives in <workspace>/.mcp/config.json:
//   {
//     "servers": [
//       { "name": "fs", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"], "env": {}, "cwd": "/path" }
//     ]
//   }
//
// Backward-compatible: a server entry may also declare a static `tools` array
// (previous behaviour) so fully offline configs keep working without a process.
// ==========================================

const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');

const DEFAULT_INIT_TIMEOUT_MS = 15000;
const DEFAULT_TOOLS_TIMEOUT_MS = 10000;
const DEFAULT_CALL_TIMEOUT_MS = 60000;

class MCPStdioClient {
  /**
   * @param {object} config
   * @param {string} config.name server name (used for tool name prefixes)
   * @param {string} config.command executable to spawn
   * @param {string[]} [config.args] spawn args
   * @param {object} [config.env] extra env vars
   * @param {string} [config.cwd] working directory
   * @param {object} [options] timeouts
   */
  constructor(config, options = {}) {
    this.name = String(config.name || 'mcp');
    this.command = config.command;
    this.args = Array.isArray(config.args) ? config.args : [];
    this.env = config.env && typeof config.env === 'object' ? config.env : {};
    this.cwd = config.cwd;
    this.initTimeoutMs = options.initTimeoutMs || DEFAULT_INIT_TIMEOUT_MS;
    this.toolsTimeoutMs = options.toolsTimeoutMs || DEFAULT_TOOLS_TIMEOUT_MS;
    this.callTimeoutMs = options.callTimeoutMs || DEFAULT_CALL_TIMEOUT_MS;
    this.process = null;
    this.buffer = '';
    this.pending = new Map(); // id -> { resolve, reject, timer }
    this.nextId = 1;
    this.ready = false;
    this.tools = [];
    this.protocolVersion = null;
    this.serverCapabilities = {};
  }

  get isConnected() {
    return Boolean(this.process && this.ready);
  }

  _send(message) {
    if (!this.process || this.process.stdin.destroyed) {
      throw new Error(`MCP server "${this.name}" process not running`);
    }
    this.process.stdin.write(JSON.stringify(message) + '\n');
  }

  _request(method, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" to "${this.name}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this._send({ jsonrpc: '2.0', id, method, params: params || {} });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  _onLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return; // ignore malformed/keepalive noise
    }

    if (message.id !== undefined && this.pending.has(message.id)) {
      const { resolve, reject, timer } = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(timer);
      if (message.error) {
        reject(new Error(`MCP server "${this.name}" error: ${message.error.message || JSON.stringify(message.error)}`));
      } else {
        resolve(message.result);
      }
      return;
    }

    // Unrequested notifications (logs, resources) — ignore for tool usage.
  }

  async connect() {
    if (this.process && !this.process.killed) {
      if (this.ready) return;
      // Stale/partial connection (e.g. a previous handshake failed or the
      // process exited): tear the old child down before reconnecting so we
      // never accumulate orphan processes across repeated loadConfig calls.
      this.close();
    }
    if (!this.command) {
      throw new Error(`MCP server "${this.name}" is missing a command`);
    }
    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    this.process = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';
      for (const line of lines) this._onLine(line);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', () => { /* surface in debug logs if needed */ });
    child.on('error', (err) => {
      // Only the current child may touch client state — a stale child from a
      // previous connect/close cycle must not clobber a fresh connection.
      if (this.process !== child) return;
      this.ready = false;
      this._failAllPending(new Error(`MCP server "${this.name}" spawn error: ${err.message}`));
    });
    child.on('exit', (code) => {
      if (this.process !== child) return; // stale child (replaced by reconnect/close)
      this.ready = false;
      this._failAllPending(new Error(`MCP server "${this.name}" exited with code ${code}`));
    });

    try {
      // 1. initialize handshake
      const initResult = await this._request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'bahai-agent', version: '1.0.0' },
      }, this.initTimeoutMs);

      this.protocolVersion = initResult?.protocolVersion || '2024-11-05';
      this.serverCapabilities = initResult?.capabilities || {};

      // 3. initialized notification (fire and forget)
      try {
        this._send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
      } catch { /* ignore */ }

      this.ready = true;

      // 4. tools/list
      try {
        const result = await this._request('tools/list', {}, this.toolsTimeoutMs);
        const rawTools = Array.isArray(result?.tools) ? result.tools : [];
        this.tools = rawTools
          .filter((tool) => tool && tool.name)
          .map((tool) => ({
            type: 'function',
            function: {
              name: `mcp_${this.name}_${tool.name}`,
              description: `[MCP Tool from ${this.name}]: ${tool.description || tool.name}`,
              parameters: tool.inputSchema || { type: 'object', properties: {} },
            },
          }));
      } catch {
        this.tools = [];
      }
      return this.tools;
    } catch (err) {
      // Handshake failed — never leave the spawned child running.
      this.close();
      throw err;
    }
  }

  async listTools() {
    if (!this.isConnected) await this.connect();
    return this.tools;
  }

  async callTool(toolName, args = {}) {
    if (!this.isConnected) await this.connect();
    const result = await this._request('tools/call', {
      name: toolName,
      arguments: args || {},
    }, this.callTimeoutMs);
    return this._formatToolResult(result);
  }

  _formatToolResult(result) {
    if (!result) return 'MCP tool returned no result';
    if (Array.isArray(result.content)) {
      const parts = result.content
        .map((item) => {
          if (!item) return '';
          if (item.type === 'text') return item.text || '';
          if (item.type === 'image') return '[image content]';
          return JSON.stringify(item);
        })
        .filter(Boolean);
      const body = parts.join('\n');
      if (result.isError) return `MCP tool error:\n${body}`;
      return body || 'MCP tool returned empty content';
    }
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  _failAllPending(error) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  close() {
    this.ready = false;
    this._failAllPending(new Error(`MCP server "${this.name}" closed`));
    if (this.process && !this.process.killed) {
      try {
        this.process.kill('SIGTERM');
      } catch { /* already gone */ }
    }
    this.process = null;
  }
}

class MCPGateway {
  constructor(options = {}) {
    this.clients = [];        // { name, staticTools, client? }
    this.mcpTools = [];
    this.options = options;
  }

  async loadConfig(workspaceDirectory, options = {}) {
    const dir = workspaceDirectory || process.cwd();
    const configPath = path.join(dir, '.mcp', 'config.json');
    this.clients = [];
    this.mcpTools = [];

    let config = null;
    try {
      config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    } catch {
      // Config not found or invalid — MCP is optional
      return this.mcpTools;
    }

    const servers = Array.isArray(config.servers) ? config.servers : [];
    for (const server of servers) {
      if (!server || !server.name) continue;

      const entry = {
        name: server.name,
        staticTools: [],
        client: null,
      };

      // Static tools (backward-compatible, no process needed)
      if (Array.isArray(server.tools) && server.tools.length > 0) {
        entry.staticTools = server.tools.map((tool) => ({
          type: 'function',
          function: {
            name: `mcp_${server.name}_${tool.name}`,
            description: `[MCP Tool from ${server.name}]: ${tool.description || tool.name}`,
            parameters: tool.parameters || { type: 'object', properties: {} },
          },
        }));
      }

      // Real stdio server
      if (server.command) {
        let client = null;
        try {
          client = new MCPStdioClient(server, { ...this.options, ...options });
          const tools = await client.connect();
          entry.client = client;
          entry.staticTools = entry.staticTools.concat(tools);
        } catch (err) {
          console.error(`[MCP] Failed to connect server "${server.name}": ${err.message}`);
          if (client) {
            try { client.close(); } catch { /* ignore */ }
          }
          entry.client = null;
        }
      }

      this.clients.push(entry);
      this.mcpTools = this.mcpTools.concat(entry.staticTools);
    }
    return this.mcpTools;
  }

  getTools() {
    return this.mcpTools;
  }

  /**
   * Per-server status for the MCP panel UI. Never leaks env vars or secrets —
   * only the server name, connection state and tool counts.
   */
  getStatus() {
    return this.clients.map((entry) => ({
      name: entry.name,
      type: entry.client ? 'stdio' : 'static',
      connected: Boolean(entry.client && entry.client.isConnected),
      toolCount: Array.isArray(entry.staticTools) ? entry.staticTools.length : 0,
      tools: Array.isArray(entry.staticTools)
        ? entry.staticTools.map((tool) => tool.function?.name || '').filter(Boolean)
        : [],
    }));
  }

  hasTool(toolName) {
    return this.mcpTools.some((tool) => tool.function.name === toolName);
  }

  async callTool(toolName, args = {}) {
    // Resolve mcp_<server>_<tool>
    const match = String(toolName || '').match(/^mcp_([^_]+)_(.+)$/);
    if (!match) {
      return `Unknown MCP tool: ${toolName}`;
    }
    const [, serverName, rawTool] = match;
    const entry = this.clients.find((c) => c.name === serverName);
    if (!entry) {
      return `MCP server not found: ${serverName}`;
    }
    if (entry.client && entry.client.isConnected) {
      return entry.client.callTool(rawTool, args);
    }
    // Static tool fallback: no executable behind it — explain how to enable.
    const staticTool = entry.staticTools.find((t) => t.function.name === toolName);
    if (staticTool) {
      return `MCP tool "${rawTool}" on "${serverName}" is declared statically but has no connected server process, so it cannot be executed. Configure a command in .mcp/config.json to enable it.`;
    }
    return `Unknown MCP tool on server "${serverName}": ${rawTool}`;
  }

  closeAll() {
    for (const entry of this.clients) {
      if (entry.client) {
        try { entry.client.close(); } catch { /* ignore */ }
      }
    }
    this.clients = [];
    this.mcpTools = [];
  }
}

const mcpGateway = new MCPGateway();

module.exports = {
  MCPStdioClient,
  MCPGateway,
  mcpGateway,
};
