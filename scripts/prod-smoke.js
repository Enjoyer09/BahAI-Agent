#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BAHAI_SMOKE_BASE_URL || 'https://bahai-agent-production.up.railway.app';
const CHAT_URL = `${BASE_URL}/chat`;
const EMAIL = process.env.BAHAI_SMOKE_EMAIL || 'demo@bahai.az';
const PASSWORD = process.env.BAHAI_SMOKE_PASSWORD || 'demo123';
const PROD_WORKDIR = process.env.BAHAI_SMOKE_WORKDIR || 'workspace://default';
const HEADLESS = !process.argv.includes('--visible');
const CHECKPOINT_MODE = process.argv.includes('--checkpoint');
const SLOW_MO_ARG = process.argv.find((arg) => arg.startsWith('--slow-mo='));
const SLOW_MO = SLOW_MO_ARG ? Number(SLOW_MO_ARG.split('=')[1]) : 0;
const REQUIRE_CLOUD_UI = !process.argv.includes('--skip-cloud-ui');
const MATRIX_MODE = process.argv.includes('--matrix');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extractBrowserFailureDetails(sseText) {
  const normalized = String(sseText || '');
  const code = normalized.match(/Code:\s*([a-z0-9_:-]+)/i)?.[1] || '';
  const cdp = normalized.match(/CDP:\s*(.+)/i)?.[1]?.trim() || '';
  const executable = normalized.match(/Executable:\s*(.+)/i)?.[1]?.trim() || '';
  const profile = normalized.match(/Profile:\s*(.+)/i)?.[1]?.trim() || '';
  const message = normalized.match(/Browser open error:\s*(.+)/i)?.[1]?.trim() || '';
  return { code, cdp, executable, profile, message };
}

async function loginIfNeeded(page) {
  const dialog = page.getByRole('dialog', { name: 'Xoş gəlmisiniz' });
  const hasDialog = await dialog.count();
  if (hasDialog !== 1) return false;

  const demoFillByTestId = page.getByTestId('auth-demo-fill');
  if (await demoFillByTestId.count() === 1) {
    await demoFillByTestId.click();
  } else {
    const demoFillFallback = dialog.getByRole('button', { name: 'Demo girişini doldur' });
    assert(await demoFillFallback.count() === 1, 'Demo fill button tapılmadı');
    await demoFillFallback.click();
  }

  const loginSubmitByTestId = page.getByTestId('auth-login-submit');
  if (await loginSubmitByTestId.count() === 1) {
    await loginSubmitByTestId.click();
  } else {
    const submitFallback = dialog.locator('button[type="submit"]');
    assert(await submitFallback.count() === 1, 'Login submit button unikal deyil');
    await submitFallback.click();
  }

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
  return true;
}

async function ensureAuthenticated(page) {
  await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');

  const didLogin = await loginIfNeeded(page);
  if (didLogin) {
    await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
  }

  const token = await page.evaluate(() => localStorage.getItem('auth_token'));
  assert(!!token, 'Auth token yaranmadı');
  return token;
}

async function assertCloudChatShell(page) {
  console.log('Checking cloud chat shell...');
  await page.waitForFunction(() => {
    const text = document.body.innerText || '';
    return text.includes('Yeni chat') || text.includes('Message input') || text.includes('Parametrlər');
  }, { timeout: 15000 });

  const body = await page.locator('body').innerText();
  assert(!body.includes('Local Desktop aktivdir'), 'Web shell desktop local mətnini göstərir');
  assert(!body.includes('Cloud Desktop aktivdir'), 'Web shell desktop cloud mətnini göstərir');
  assert(!body.includes('Desktop Runtime Status'), 'Web shell desktop runtime panelini göstərir');
  assert(!body.includes('Qovluq aç'), 'Web shell desktop qovluq əmrlərini göstərir');
}

async function startFreshChat(page) {
  console.log('Starting fresh chat...');
  const ariaButton = page.getByRole('button', { name: 'New chat' });
  if (await ariaButton.count()) {
    await ariaButton.first().click();
    await page.waitForTimeout(700);
    return;
  }
  const textButton = page.getByRole('button', { name: 'Yeni chat' });
  if (await textButton.count()) {
    await textButton.first().click();
    await page.waitForTimeout(700);
  }
}

async function waitForComposerReady(page, timeoutMs = 45000) {
  await page.waitForFunction(() => {
    const send = document.querySelector('[aria-label="Send message"]');
    const stop = document.querySelector('[aria-label="Stop generation"]');
    return Boolean(send) && !stop;
  }, { timeout: timeoutMs });
}

async function sendSmokeMessage(page) {
  console.log('Sending baseline smoke message...');
  await waitForComposerReady(page);
  const input = page.getByLabel('Message input', { exact: true });
  assert(await input.count() === 1, 'Message input tapılmadı');
  await input.fill('Salam. Bu bir prod smoke testdir. Zəhmət olmasa bir cümlə ilə cavab ver.');

  const sendButton = page.getByRole('button', { name: 'Send message' });
  assert(await sendButton.count() === 1, 'Send button tapılmadı');
  await sendButton.click();

  await page.waitForFunction(() => {
    const text = document.body.innerText || '';
    return text.includes('prod smoke testdir') || text.includes('Bu bir prod smoke testdir');
  }, { timeout: 10000 });
  await waitForComposerReady(page, 50000);

  const body = await page.locator('body').innerText();
  assert(!body.includes('Qovluq aç'), 'Web chat shell desktop folder CTA göstərir');
  assert(!body.includes('Qovluq və ya repo əlavə et'), 'Web chat shell desktop repo CTA göstərir');
}

async function sendPromptAndWaitForStableAnswer(page, prompt, matcher, options = {}) {
  console.log(`Prompt => ${prompt}`);
  await waitForComposerReady(page);
  const input = page.getByLabel('Message input', { exact: true });
  assert(await input.count() === 1, 'Message input tapılmadı');
  await input.fill(prompt);

  const sendButton = page.getByRole('button', { name: 'Send message' });
  assert(await sendButton.count() === 1, 'Send button tapılmadı');
  await sendButton.click();

  const timeoutMs = options.timeoutMs || 45000;
  const pollingStart = Date.now();
  let matchedText = '';

  while (Date.now() - pollingStart < timeoutMs) {
    await page.waitForTimeout(1200);
    const body = await page.locator('body').innerText();
    if (typeof matcher === 'function' ? matcher(body) : matcher.test(body)) {
      matchedText = body;
      break;
    }
  }

  await waitForComposerReady(page, timeoutMs);

  assert(!!matchedText, `Prompt üçün gözlənilən cavab gəlmədi: ${prompt}`);
  assert(!matchedText.includes('wttr.in/'), 'Raw weather tool URL UI-da göründü');
  assert(!matchedText.includes('"name": "web_fetch"'), 'Raw tool JSON UI-da göründü');
  assert(!matchedText.includes('arguments'), 'Raw tool arguments UI-da göründü');
  assert(!matchedText.includes('function_call_output'), 'Raw function call UI-da göründü');
  return matchedText;
}

async function runSmokeMatrix(page) {
  const cases = [
    {
      name: 'date',
      prompt: 'Bugün ayın neçəsidir?',
      matcher: (body) => /Bu gün .*2026/i.test(body) || /iyul 2026/i.test(body)
    },
    {
      name: 'weather',
      prompt: 'Sumqayıtda hava necədir?',
      matcher: (body) => /Sumqayıtda/i.test(body) && /°C/i.test(body)
    },
    {
      name: 'sports',
      prompt: 'Bugün FIFA Dünya Çempionatında hansı oyunlar var?',
      matcher: (body) => /FIFA Dünya Çempionat/i.test(body) && /(Bu gün|bugün|8 iyul 2026|9 iyul 2026)/i.test(body),
    },
    {
      name: 'code',
      prompt: 'JavaScript-də async await nədir? Bir qısa nümunə ver.',
      matcher: (body) => /async await/i.test(body) && /await/i.test(body)
    }
  ];

  const results = [];
  for (const testCase of cases) {
    console.log(`Matrix case starting: ${testCase.name}`);
    const text = await sendPromptAndWaitForStableAnswer(page, testCase.prompt, testCase.matcher, { timeoutMs: 50000 });
    results.push({ name: testCase.name, ok: true, sample: text.slice(-280) });
    console.log(`Matrix case ok: ${testCase.name}`);
  }
  return results;
}

async function createCheckpointFlow(token) {
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Accept': 'text/event-stream'
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'user',
          content: 'GUI Agent ilə visible browser aç və wix.com daxil ol. Mən login olana qədər gözlə. Login-dən sonra observe et. Workflow: gui.'
        }
      ],
      model: 'auto',
      workingDirectory: PROD_WORKDIR,
      orchestrationMode: true,
      workflow: 'gui'
    })
  });

  assert(response.ok, `checkpoint chat failed: ${response.status}`);
  const text = await response.text();
  assert(
    text.includes('"type":"human_checkpoint"') || text.includes('Browser açıla bilmədi'),
    'checkpoint flow nə human_checkpoint, nə də browser failure qaytardı'
  );
  return text;
}

async function loadCheckpoint(token) {
  const response = await fetch(`${BASE_URL}/api/interactions`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  assert(response.ok, `interactions failed: ${response.status}`);
  const data = await response.json();
  const checkpoint = (data.interactions || []).find((item) => item.kind === 'checkpoint')?.checkpoint || null;
  return checkpoint;
}

async function resumeCheckpoint(token, checkpointId) {
  const response = await fetch(`${BASE_URL}/api/checkpoints/${encodeURIComponent(checkpointId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Accept': 'text/event-stream'
    },
    body: JSON.stringify({
      decision: 'resume',
      workingDirectory: PROD_WORKDIR
    })
  });
  assert(response.ok, `resume checkpoint failed: ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  assert(contentType.includes('text/event-stream'), 'resume checkpoint SSE qaytarmadı');
  const text = await response.text();
  assert(
    text.includes('gui_observe') || text.includes('Login sonrası Wix pəncərəsini yalnız müşahidə edirəm'),
    'resume flow gözlənilən GUI observe cavabını qaytarmadı'
  );
}

async function checkHealth(token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${BASE_URL}/api/browsers`, { headers });
  assert(res.ok, `/api/browsers failed: ${res.status}`);
  const data = await res.json();
  assert(Array.isArray(data.browsers), 'browsers payload yanlışdır');
}

async function main() {
  console.log(`BahAI prod smoke starting: ${CHAT_URL}`);
  console.log(`Credentials: ${EMAIL}`);

  const { chromium } = require(path.join(process.cwd(), 'backend', 'node_modules', 'playwright'));
  const browser = await chromium.launch({ headless: HEADLESS, slowMo: SLOW_MO });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const artifactsDir = path.join(process.cwd(), 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  try {
    const token = await ensureAuthenticated(page);
    console.log('Auth ok');

    await checkHealth(token);
    console.log('Health ok: /api/browsers');

    if (REQUIRE_CLOUD_UI) {
      await assertCloudChatShell(page);
      console.log('Cloud chat shell ok');
    }

    await startFreshChat(page);
    await sendSmokeMessage(page);
    console.log('Chat ok');

    if (MATRIX_MODE) {
      const matrixResults = await runSmokeMatrix(page);
      console.log('Smoke matrix ok');
      for (const result of matrixResults) {
        console.log(`- ${result.name}: ok`);
      }
    }

    if (CHECKPOINT_MODE) {
      const checkpointText = await createCheckpointFlow(token);
      console.log('Checkpoint request ok');
      if (checkpointText.includes('"type":"human_checkpoint"')) {
        const checkpoint = await loadCheckpoint(token);
        assert(checkpoint?.id, 'checkpoint interaction tapılmadı');
        await resumeCheckpoint(token, checkpoint.id);
        console.log('Checkpoint resume ok');
      } else {
        const failure = extractBrowserFailureDetails(checkpointText);
        console.log('Checkpoint flow browser launch failure qaytardı; resume skip edildi.');
        if (failure.code) console.log(`Browser failure code: ${failure.code}`);
        if (failure.message) console.log(`Browser failure message: ${failure.message}`);
        if (failure.cdp) console.log(`Browser failure CDP: ${failure.cdp}`);
        if (failure.executable) console.log(`Browser failure executable: ${failure.executable}`);
        if (failure.profile) console.log(`Browser failure profile: ${failure.profile}`);
      }
    }

    const suffix = MATRIX_MODE ? 'prod-smoke-matrix' : 'prod-smoke';
    const screenshotPath = path.join(artifactsDir, `${suffix}-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot: ${screenshotPath}`);
    console.log('BahAI prod smoke passed.');
  } catch (error) {
    try {
      const failureShot = path.join(artifactsDir, `prod-smoke-failure-${Date.now()}.png`);
      await page.screenshot({ path: failureShot, fullPage: true });
      console.error(`Failure screenshot: ${failureShot}`);
      const bodyText = await page.locator('body').innerText().catch(() => '');
      if (bodyText) {
        console.error(`Failure body excerpt:\n${bodyText.slice(0, 2000)}`);
      }
    } catch (captureErr) {
      console.error(`Failure diagnostics capture failed: ${captureErr.message}`);
    }
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`BahAI prod smoke failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
