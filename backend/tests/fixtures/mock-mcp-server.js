#!/usr/bin/env node
/**
 * Mock MCP server for tests — speaks newline-delimited JSON-RPC 2.0 over stdio,
 * implementing the minimal subset of the Model Context Protocol:
 *   initialize, notifications/initialized, tools/list, tools/call
 */
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function respond(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  // Notification — no response expected
  if (msg.method && msg.id === undefined) {
    return;
  }

  if (msg.method === 'initialize') {
    respond({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock-mcp-server', version: '1.0.0' },
      },
    });
    return;
  }

  if (msg.method === 'tools/list') {
    respond({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          {
            name: 'echo',
            description: 'Echoes back the given text',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          },
          {
            name: 'add',
            description: 'Adds two numbers',
            inputSchema: {
              type: 'object',
              properties: { a: { type: 'number' }, b: { type: 'number' } },
              required: ['a', 'b'],
            },
          },
        ],
      },
    });
    return;
  }

  if (msg.method === 'tools/call') {
    const { name, arguments: args = {} } = msg.params || {};
    if (name === 'echo') {
      respond({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: `echo: ${String(args.text || '')}` }],
        },
      });
      return;
    }
    if (name === 'add') {
      const sum = Number(args.a || 0) + Number(args.b || 0);
      respond({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: String(sum) }],
        },
      });
      return;
    }
    respond({
      jsonrpc: '2.0',
      id: msg.id,
      result: { isError: true, content: [{ type: 'text', text: `unknown tool: ${name}` }] },
    });
    return;
  }

  // Unknown request
  respond({
    jsonrpc: '2.0',
    id: msg.id,
    error: { code: -32601, message: `Method not found: ${msg.method}` },
  });
});
