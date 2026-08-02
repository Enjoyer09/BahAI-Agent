import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCPStdioClient, MCPGateway, mcpGateway } from '../chat/mcpGateway.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_SERVER = path.join(__dirname, 'fixtures', 'mock-mcp-server.js');

const TEST_DIR = path.join(__dirname, 'fixtures', 'mock-workspace');

function writeConfig(servers) {
  const fs = require('fs');
  const dir = path.join(TEST_DIR, '.mcp');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ servers }, null, 2));
}

function cleanupConfig() {
  const fs = require('fs');
  try { fs.rmSync(path.join(TEST_DIR, '.mcp'), { recursive: true, force: true }); } catch { /* ignore */ }
}

describe('MCPStdioClient (real stdio JSON-RPC)', () => {
  let client;

  afterAll(() => {
    if (client) client.close();
  });

  it('performs the initialize handshake and lists tools', async () => {
    client = new MCPStdioClient({
      name: 'mock',
      command: process.execPath,
      args: [MOCK_SERVER],
    }, { initTimeoutMs: 5000, toolsTimeoutMs: 5000 });

    const tools = await client.connect();
    expect(client.isConnected).toBe(true);
    expect(client.protocolVersion).toBe('2024-11-05');
    expect(tools).toHaveLength(2);
    expect(tools[0].function.name).toBe('mcp_mock_echo');
    expect(tools[0].function.description).toContain('Echoes back');
    expect(tools[1].function.name).toBe('mcp_mock_add');
  });

  it('executes tools/call and formats text content', async () => {
    const result = await client.callTool('echo', { text: 'salam' });
    expect(result).toBe('echo: salam');

    const sum = await client.callTool('add', { a: 2, b: 3 });
    expect(sum).toBe('5');
  });

  it('reports MCP-level errors from the server', async () => {
    const result = await client.callTool('nope', {});
    expect(result).toContain('MCP tool error');
    expect(result).toContain('unknown tool');
  });

  it('gracefully handles a missing command', async () => {
    const bad = new MCPStdioClient({ name: 'ghost' });
    await expect(bad.connect()).rejects.toThrow(/missing a command/);
  });

  it('cleans up the spawned process after a failed connect (no orphan)', async () => {
    // Point at a script that exits immediately without speaking MCP.
    const broken = new MCPStdioClient({
      name: 'broken',
      command: process.execPath,
      args: ['-e', 'process.exit(3)'],
    }, { initTimeoutMs: 2000 });
    await expect(broken.connect()).rejects.toThrow();
    // The failed handshake must not leave a live child behind.
    expect(broken.process).toBeNull();
    expect(broken.isConnected).toBe(false);
  });

  it('reconnects cleanly after close() without leaking', async () => {
    const c = new MCPStdioClient({
      name: 'mock',
      command: process.execPath,
      args: [MOCK_SERVER],
    }, { initTimeoutMs: 5000, toolsTimeoutMs: 5000 });
    await c.connect();
    expect(c.isConnected).toBe(true);
    const firstPid = c.process.pid;
    c.close();
    expect(c.process).toBeNull();
    // Reconnect spawns a fresh process (no reuse of a dead child).
    await c.connect();
    expect(c.isConnected).toBe(true);
    expect(c.process.pid).not.toBe(firstPid);
    c.close();
  });
});

describe('MCPGateway', () => {
  let gateway;

  afterEach(() => {
    if (gateway) gateway.closeAll();
    cleanupConfig();
  });

  it('loads config and exposes prefixed tools', async () => {
    writeConfig([{ name: 'mock', command: process.execPath, args: [MOCK_SERVER] }]);
    gateway = new MCPGateway({ initTimeoutMs: 5000, toolsTimeoutMs: 5000 });

    const tools = await gateway.loadConfig(TEST_DIR);
    expect(tools.some((t) => t.function.name === 'mcp_mock_echo')).toBe(true);
    expect(tools.some((t) => t.function.name === 'mcp_mock_add')).toBe(true);
    expect(gateway.hasTool('mcp_mock_echo')).toBe(true);
  });

  it('executes tools/call through the gateway', async () => {
    writeConfig([{ name: 'mock', command: process.execPath, args: [MOCK_SERVER] }]);
    gateway = new MCPGateway({ initTimeoutMs: 5000, toolsTimeoutMs: 5000 });
    await gateway.loadConfig(TEST_DIR);

    const result = await gateway.callTool('mcp_mock_echo', { text: 'gateway-ok' });
    expect(result).toBe('echo: gateway-ok');
  });

  it('returns empty tools when no config exists', async () => {
    gateway = new MCPGateway();
    const tools = await gateway.loadConfig(TEST_DIR);
    expect(tools).toEqual([]);
  });

  it('keeps backward-compatible static tools without a process', async () => {
    writeConfig([{
      name: 'static',
      tools: [
        { name: 'hello', description: 'Static greeting', parameters: { type: 'object', properties: {} } },
      ],
    }]);
    gateway = new MCPGateway();
    const tools = await gateway.loadConfig(TEST_DIR);
    expect(tools).toHaveLength(1);
    expect(tools[0].function.name).toBe('mcp_static_hello');
    // No process behind a static tool: execution explains how to enable it
    const result = await gateway.callTool('mcp_static_hello', {});
    expect(result).toContain('statically');
  });

  it('handles unknown servers and tools gracefully', async () => {
    writeConfig([{ name: 'mock', command: process.execPath, args: [MOCK_SERVER] }]);
    gateway = new MCPGateway({ initTimeoutMs: 5000, toolsTimeoutMs: 5000 });
    await gateway.loadConfig(TEST_DIR);

    expect(await gateway.callTool('mcp_nope_x', {})).toContain('MCP server not found');
    expect(await gateway.callTool('browser_open', {})).toContain('Unknown MCP tool');
  });

  it('getStatus reports per-server connection state without leaking internals', async () => {
    writeConfig([
      { name: 'mock', command: process.execPath, args: [MOCK_SERVER] },
      {
        name: 'static',
        tools: [{ name: 'hello', description: 'Static greeting', parameters: { type: 'object', properties: {} } }],
      },
    ]);
    gateway = new MCPGateway({ initTimeoutMs: 5000, toolsTimeoutMs: 5000 });
    await gateway.loadConfig(TEST_DIR);

    const status = gateway.getStatus();
    expect(status).toHaveLength(2);

    const mockEntry = status.find((s) => s.name === 'mock');
    expect(mockEntry.type).toBe('stdio');
    expect(mockEntry.connected).toBe(true);
    expect(mockEntry.toolCount).toBe(2);
    expect(mockEntry.tools).toContain('mcp_mock_echo');
    // No secrets/process handles leak into the status payload.
    expect(JSON.stringify(mockEntry)).not.toContain('process');
    expect(JSON.stringify(mockEntry)).not.toContain('pending');

    const staticEntry = status.find((s) => s.name === 'static');
    expect(staticEntry.type).toBe('static');
    expect(staticEntry.connected).toBe(false);
    expect(staticEntry.toolCount).toBe(1);
  });
});

describe('mcpGateway singleton + helpers wiring', () => {
  afterAll(() => {
    mcpGateway.closeAll();
    cleanupConfig();
  });

  it('loadMcpConfigForWorkingDirectory loads and caches per directory', async () => {
    const { loadMcpConfigForWorkingDirectory } = require('../helpers.js');
    writeConfig([{ name: 'mock', command: process.execPath, args: [MOCK_SERVER] }]);
    mcpGateway.closeAll();
    // Reset the module-level cache so the fresh config is picked up
    const helpersModule = require('../helpers.js');
    helpersModule.resetMcpConfigCache();

    const tools = await loadMcpConfigForWorkingDirectory(TEST_DIR);
    expect(tools.some((t) => t.function.name === 'mcp_mock_echo')).toBe(true);
  });
});
