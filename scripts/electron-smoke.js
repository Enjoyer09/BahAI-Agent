#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const HEADLESS = !process.argv.includes('--visible');
const SLOW_MO_ARG = process.argv.find((arg) => arg.startsWith('--slow-mo='));
const SLOW_MO = SLOW_MO_ARG ? Number(SLOW_MO_ARG.split('=')[1]) : 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function ensureFrontendBuild() {
  const indexPath = path.join(process.cwd(), 'frontend', 'dist', 'index.html');
  assert(fs.existsSync(indexPath), 'frontend build tapılmadı; əvvəl `npm run build --prefix frontend` işlədin');
}

async function loginIfNeeded(page) {
  const dialog = page.getByRole('dialog', { name: 'Xoş gəlmisiniz' });
  if (await dialog.count() !== 1) return false;

  const demoFill = page.getByTestId('auth-demo-fill');
  if (await demoFill.count() === 1) await demoFill.click();
  else await page.getByRole('button', { name: /Demo girişini doldur/i }).click();

  const submit = page.getByTestId('auth-login-submit');
  if (await submit.count() === 1) await submit.click();
  else await dialog.locator('button[type="submit"]').click();

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
  return true;
}

async function openSettings(page) {
  const settingsButton = page.getByRole('button', { name: /parametrlər/i });
  assert(await settingsButton.count() >= 1, 'Parametrlər button tapılmadı');
  await settingsButton.first().click();
  await page.waitForFunction(() => {
    const text = document.body.innerText || '';
    return text.includes('Execution Source') && text.includes('Desktop Runtime Status');
  }, { timeout: 15000 });
}

async function closeSettings(page) {
  const doneButton = page.getByRole('button', { name: /bitdi/i });
  assert(await doneButton.count() >= 1, 'Bitdi button tapılmadı');
  await doneButton.first().click();
  await page.waitForTimeout(500);
}

async function sendSmokeMessage(page) {
  const input = page.getByLabel('Message input', { exact: true });
  assert(await input.count() === 1, 'Message input tapılmadı');
  await input.fill('Desktop electron smoke testdir. Mene qisa olaraq local yoxsa cloud desktop oldugunu de.');
  const sendButton = page.getByRole('button', { name: 'Send message' });
  assert(await sendButton.count() === 1, 'Send button tapılmadı');
  await sendButton.click();
  await page.waitForFunction(() => {
    const text = document.body.innerText || '';
    return text.toLowerCase().includes('desktop') || text.toLowerCase().includes('local') || text.toLowerCase().includes('cloud');
  }, { timeout: 30000 });
}

async function main() {
  await ensureFrontendBuild();
  console.log('BahAI electron smoke starting...');

  const { _electron: electron } = require(path.join(process.cwd(), 'backend', 'node_modules', 'playwright'));
  const electronBinary = require(path.join(process.cwd(), 'electron', 'node_modules', 'electron'));
  const appPath = path.join(process.cwd(), 'electron');

  const electronApp = await electron.launch({
    executablePath: electronBinary,
    args: [appPath, '--backend-ui'],
    env: {
      ...process.env,
      BAHAI_DESKTOP_DEBUG: 'false'
    }
  });

  const artifactsDir = path.join(process.cwd(), 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  try {
    const page = await electronApp.firstWindow();
    if (SLOW_MO > 0) await page.waitForTimeout(SLOW_MO);

    await page.waitForLoadState('domcontentloaded');
    await page.goto('http://localhost:3001/chat', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => {
      const text = document.body.innerText || '';
      return text.includes('Xoş gəlmisiniz') || text.includes('Desktop') || text.includes('Local Desktop') || text.includes('Cloud Desktop');
    }, { timeout: 20000 });

    const didLogin = await loginIfNeeded(page);
    if (didLogin) {
      await page.waitForFunction(() => {
        const text = document.body.innerText || '';
        return text.includes('Desktop') || text.includes('Local Desktop') || text.includes('Cloud Desktop');
      }, { timeout: 20000 });
    }

    const userAgent = await page.evaluate(() => navigator.userAgent);
    assert(userAgent.includes('Electron'), 'Desktop shell Electron userAgent ilə açılmadı');
    console.log('Electron shell ok');

    const body = await page.locator('body').innerText();
    assert(!body.includes('BahAI Cloud • Chat'), 'Electron app web-only chat shell göstərir');
    assert(
      body.includes('Parametrlər') || body.includes('Qovluq aç') || body.includes('Local Desktop') || body.includes('Cloud Desktop'),
      'Desktop shell siqnalları görünmədi'
    );
    console.log('Desktop shell identity ok');

    await openSettings(page);
    console.log('Settings modal ok');

    await closeSettings(page);
    console.log('Settings close ok');

    await sendSmokeMessage(page);
    console.log('Electron chat flow ok');

    const screenshotPath = path.join(artifactsDir, `electron-smoke-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot: ${screenshotPath}`);
    console.log('BahAI electron smoke passed.');
  } finally {
    await electronApp.close();
  }
}

main().catch((error) => {
  console.error(`BahAI electron smoke failed: ${error.message}`);
  process.exitCode = 1;
});
