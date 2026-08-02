// ==========================================
// buildCompactProjectMemory — web/desktop scrub tests
// ==========================================
// buildCompactProjectMemory (backend/helpers.js) projects project memory into
// the compact hint sent to the model. GUI/browser capability status is a
// desktop ops-panel detail: web_chat must never receive it, desktop keeps it.
// This locks that contract so a regression (re-adding guiCapabilities to the
// web projection) is caught.
//
// Run with: cd backend && npx vitest run tests/compact-project-memory.test.js
// ==========================================

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildCompactProjectMemory } = require('../helpers.js');

const guiMemory = {
  latestPrompt: 'salam',
  latestGoal: 'kod yaz',
  repoProfile: {
    ecosystem: 'Node.js',
    packageManager: 'npm',
    frameworks: ['Express'],
    buildCommand: 'npm run build',
    testCommand: 'npm test',
    lintCommand: 'npm run lint',
  },
  lastValidation: { status: 'passed', summary: 'ok' },
  activeGuiSession: { sessionId: 's1', status: 'running' },
  guiCapabilities: {
    summary: { status: 'ok', recommendedWorkflow: 'gui', recommendedBrowserMode: 'persistent' },
    warnings: ['Playwright missing'],
  },
};

describe('buildCompactProjectMemory guiCapabilities scrub', () => {
  it('keeps guiCapabilities for desktop (default productMode)', () => {
    const compact = buildCompactProjectMemory(guiMemory);
    expect(compact.guiCapabilities).toBeDefined();
    expect(compact.guiCapabilities.summary.status).toBe('ok');
    expect(compact.guiCapabilities.warnings).toEqual(['Playwright missing']);
  });

  it('keeps guiCapabilities for explicit desktop_code', () => {
    const compact = buildCompactProjectMemory(guiMemory, { productMode: 'desktop_code' });
    expect(compact.guiCapabilities).toBeDefined();
  });

  it('omits guiCapabilities for web_chat', () => {
    const compact = buildCompactProjectMemory(guiMemory, { productMode: 'web_chat' });
    expect(compact.guiCapabilities).toBeUndefined();
  });

  it('web_chat projection keeps the non-privacy memory fields', () => {
    const compact = buildCompactProjectMemory(guiMemory, { productMode: 'web_chat' });
    expect(compact.latestPrompt).toBe('salam');
    expect(compact.latestGoal).toBe('kod yaz');
    expect(compact.lastValidation).toEqual({ status: 'passed', summary: 'ok' });
    expect(compact.activeGuiSession).toEqual({ sessionId: 's1', status: 'running' });
    expect(compact.repoProfile.ecosystem).toBe('Node.js');
  });

  it('returns {} for non-object input', () => {
    expect(buildCompactProjectMemory(null)).toEqual({});
    expect(buildCompactProjectMemory('x')).toEqual({});
  });

  it('no guiCapabilities key present at all for web (not just undefined)', () => {
    const compact = buildCompactProjectMemory(guiMemory, { productMode: 'web_chat' });
    expect(Object.prototype.hasOwnProperty.call(compact, 'guiCapabilities')).toBe(false);
  });
});
