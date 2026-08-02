import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHARED_DIR = path.resolve(__dirname, '../../shared');

// Load the shared contract the same way backend code does (CJS require).
const contract = require('../../shared/contract.js');

describe('shared wire contract (shared/contract.js)', () => {
  it('exposes the four contract groups', () => {
    expect(Array.isArray(contract.SSE_EVENT_TYPES)).toBe(true);
    expect(Array.isArray(contract.MESSAGE_ROLES)).toBe(true);
    expect(Array.isArray(contract.ATTACHMENT_TYPES)).toBe(true);
    expect(Array.isArray(contract.WEB_PRIVACY_MEMORY_KEYS)).toBe(true);
  });

  it('SSE event types cover every type emitted by the backend', () => {
    const types = contract.SSE_EVENT_TYPES;
    for (const t of [
      'assistant_message', 'assistant_delta', 'provider_telemetry',
      'tool_execution', 'tool_result', 'task_plan', 'orchestration_state',
      'orchestration_phase', 'auto_route', 'approval_request',
      'approval_resolved', 'human_checkpoint', 'governance_state',
      'workspace_updated', 'token_usage', 'error', 'debug',
    ]) {
      expect(types).toContain(t);
    }
    // No duplicates
    expect(new Set(types).size).toBe(types.length);
  });

  it('web privacy keys are the exact set the frontend scrubber relies on', () => {
    expect(contract.WEB_PRIVACY_MEMORY_KEYS).toEqual([
      'providerTelemetry',
      'lastProviderTelemetry',
      'tokenUsage',
      'guiCapabilities',
      'guiCapabilitiesUpdatedAt',
    ]);
  });

  it('has a matching TypeScript declaration file', () => {
    const dts = fs.readFileSync(path.join(SHARED_DIR, 'contract.d.ts'), 'utf8');
    for (const name of ['SSE_EVENT_TYPES', 'MESSAGE_ROLES', 'ATTACHMENT_TYPES', 'WEB_PRIVACY_MEMORY_KEYS']) {
      expect(dts).toContain(name);
    }
  });

  it('every SSE event type the frontend dispatches on is in the contract (drift guard)', () => {
    // Parse the frontend SSEEvent union literal members from types.ts and assert
    // each one is a known backend emit. This catches drift where the backend
    // adds a new event type but the shared contract / frontend dispatcher diverge.
    const typesPath = path.resolve(__dirname, '../../frontend/src/lib/types.ts');
    const source = fs.readFileSync(typesPath, 'utf8');
    // Collect every `type: 'xxx'` literal anywhere in the SSEEvent union (the
    // union spans multiple lines, so scanning the whole file is more robust
    // than trying to bracket-match a single block).
    const literalMembers = [...source.matchAll(/type:\s*'([a-z_]+)'/g)]
      .map((m) => m[1])
      .filter((name) => name !== 'type');
    expect(literalMembers.length).toBeGreaterThan(10);
    for (const name of literalMembers) {
      expect(contract.SSE_EVENT_TYPES).toContain(name);
    }
  });
});
