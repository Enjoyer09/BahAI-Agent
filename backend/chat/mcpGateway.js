// ==========================================
// Model Context Protocol (MCP) Client Gateway
// Dynamically loads local/remote MCP tools from config
// ==========================================

const fs = require('fs/promises');
const path = require('path');

class MCPGateway {
  constructor() {
    this.mcpTools = [];
    this.mcpServers = [];
  }

  async loadConfig(workspaceDirectory) {
    try {
      const configPath = path.join(workspaceDirectory, '.mcp', 'config.json');
      const data = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(data);
      if (Array.isArray(config.servers)) {
        this.mcpServers = config.servers;
        this.mcpTools = config.servers.flatMap(s => (s.tools || []).map(t => ({
          type: 'function',
          function: {
            name: `mcp_${s.name}_${t.name}`,
            description: `[MCP Tool from ${s.name}]: ${t.description}`,
            parameters: t.parameters || { type: 'object', properties: {} }
          }
        })));
      }
    } catch {
      // Config not found or invalid — MCP is optional
      this.mcpTools = [];
    }
    return this.mcpTools;
  }

  getTools() {
    return this.mcpTools;
  }
}

const mcpGateway = new MCPGateway();

module.exports = {
  mcpGateway,
  MCPGateway
};
