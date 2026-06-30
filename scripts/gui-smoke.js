#!/usr/bin/env node

const { pathToFileURL } = require('url');
const { getSession, closeAllSessions, findInstalledChromePath } = require('../backend/browserSession');
const { inspectGuiState, runGuiAction, stepGuiAgent } = require('../backend/gui/agent');

const sessionId = `gui-smoke-${Date.now()}`;
const workingDirectory = process.cwd();
const visible = process.argv.includes('--visible') || process.env.GUI_BROWSER_VISIBLE === 'true';
const useChrome = process.argv.includes('--chrome') || process.env.GUI_BROWSER_CHANNEL === 'chrome';
const persistent = process.argv.includes('--persistent') || process.env.GUI_BROWSER_PERSISTENT === 'true';
const chromePath = useChrome ? findInstalledChromePath() : '';
const slowMoArg = process.argv.find((arg) => arg.startsWith('--slow-mo='));
const slowMoMs = slowMoArg ? Number(slowMoArg.split('=')[1]) : 350;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function loadSmokePage() {
  const session = await getSession(sessionId, {
    visible,
    slowMoMs,
    browserChannel: useChrome ? 'chrome' : '',
    executablePath: chromePath,
    persistent
  });
  const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>BahAI GUI Smoke</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 40px; color: #172033; background: #f6f7f9; }
      main { max-width: 640px; padding: 24px; background: white; border: 1px solid #d7dce2; border-radius: 8px; }
      label { display: block; font-size: 13px; margin-bottom: 6px; color: #566174; }
      input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #b9c0cc; border-radius: 6px; }
      button { margin-top: 14px; padding: 10px 14px; border: 0; border-radius: 6px; background: #1264a3; color: white; cursor: pointer; }
      #status { margin-top: 14px; font-weight: 700; color: #1264a3; }
    </style>
  </head>
  <body>
    <main>
      <h1>BahAI GUI Smoke</h1>
      <label for="name">Name</label>
      <input id="name" aria-label="Name" placeholder="Type here" />
      <button id="submit" type="button">Submit</button>
      <div id="status">waiting</div>
    </main>
    <script>
      document.getElementById('submit').addEventListener('click', () => {
        const value = document.getElementById('name').value || 'empty';
        document.getElementById('status').textContent = 'submitted:' + value;
      });
    </script>
  </body>
</html>`;

  await session.page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return session;
}

async function main() {
  console.log('BahAI GUI smoke test starting...');
  if (visible) {
    console.log(`Visible browser mode enabled. SlowMo: ${slowMoMs}ms${useChrome ? ` | chrome: ${chromePath || 'not found'}` : ''}${persistent ? ' | persistent profile' : ''}`);
  }

  const session = await loadSmokePage();
  const goal = 'Type BahAI into the name input and submit the form.';

  const inspection = await inspectGuiState({ sessionId, workingDirectory, goal, history: [] });
  assert(inspection.observation?.screenshotPath, 'gui_observe did not create a screenshot');
  assert(inspection.groundingPrompt?.goal === goal, 'gui_observe did not preserve the goal');
  console.log(`observe ok: ${inspection.observation.screenshotPath}`);

  const promptOnly = await stepGuiAgent({
    sessionId,
    workingDirectory,
    goal,
    history: [],
    autoGround: false,
    groundingMode: 'prompt_only'
  });
  assert(promptOnly.action === null, 'prompt-only gui_step should not execute an action');
  assert(promptOnly.assessment?.executable === false, 'prompt-only gui_step should report non-executable assessment');
  console.log(`prompt-only ok: ${promptOnly.assessment.reason}`);

  const typed = await runGuiAction({
    sessionId,
    workingDirectory,
    action: {
      type: 'type',
      selector: '#name',
      text: 'BahAI',
      confidence: 0.99,
      reasoning: 'Smoke test fills a known input.'
    },
    history: []
  });
  assert(typed.result?.ok, 'gui_act type failed');

  const clicked = await stepGuiAgent({
    sessionId,
    workingDirectory,
    goal,
    action: {
      type: 'click',
      selector: '#submit',
      confidence: 0.99,
      reasoning: 'Smoke test clicks a known button.'
    },
    history: typed.history,
    autoGround: false,
    groundingMode: 'prompt_only'
  });
  assert(clicked.result?.ok, 'manual gui_step click failed');

  const status = await session.page.locator('#status').textContent();
  assert(status === 'submitted:BahAI', `unexpected page status: ${status}`);
  assert(clicked.observation?.screenshotPath, 'manual gui_step did not create a screenshot');

  console.log(`manual action ok: ${status}`);
  console.log(`final screenshot: ${clicked.observation.screenshotPath}`);
  console.log('BahAI GUI smoke test passed.');
}

main()
  .catch((error) => {
    console.error(`BahAI GUI smoke test failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeAllSessions();
  });
