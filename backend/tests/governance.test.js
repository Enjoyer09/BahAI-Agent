import { describe, it, expect } from 'vitest';

const { classifyEntryPath, buildGateReceipt } = require('../orchestrator/governance');

describe('governance helpers', () => {
  it('classifies audit-style requests into audit entry path', () => {
    const entryPath = classifyEntryPath({
      latestUserText: 'proqrami audit ele',
      workflow: 'default',
      orchestration: { enabled: true }
    });

    expect(entryPath.mode).toBe('audit');
  });

  it('builds a blocked gate receipt when approval was rejected', () => {
    const receipt = buildGateReceipt({
      entryPath: { mode: 'bootstrap', reason: 'test' },
      plannerArtifact: { goal: 'Test', summary: 'Summary' },
      executionArtifacts: [{ summary: 'Did work' }],
      projectMemory: {
        lastApprovalDecision: {
          decision: 'reject',
          title: 'Dangerous action'
        }
      },
      runId: 'run_1',
      workflow: 'default'
    });

    expect(receipt.overall).toBe('blocked');
    expect(receipt.evidence.find((item) => item.label === 'approval')?.status).toBe('failed');
  });
});
