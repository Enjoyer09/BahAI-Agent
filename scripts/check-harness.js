#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = process.cwd();

function fail(message) {
  console.error(`Harness check failed: ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`ok - ${message}`);
}

function mustExist(relPath) {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) {
    fail(`${relPath} missing`);
    return false;
  }
  ok(`${relPath} exists`);
  return true;
}

function mustContain(relPath, snippets) {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) {
    fail(`${relPath} missing`);
    return;
  }
  const content = fs.readFileSync(abs, 'utf8');
  for (const snippet of snippets) {
    if (!content.includes(snippet)) {
      fail(`${relPath} missing snippet: ${snippet}`);
      return;
    }
  }
  ok(`${relPath} contains expected markers`);
}

function main() {
  mustExist('docs/ai/harness/README.md');
  mustExist('docs/ai/harness/commands.md');
  mustExist('docs/ai/harness/evidence.md');

  mustContain('package.json', ['smoke:gui', 'smoke:prod']);
  mustContain('backend/gui/browserPolicy.js', ['resolveGuiBrowserPolicy', 'getRecommendedGuiBrowserMode']);
  mustContain('memory/CODE_AGENT_HANDOFF.md', ['scripts/prod-smoke.js']);

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
  console.log('Harness check passed.');
}

main();
