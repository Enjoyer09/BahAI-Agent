#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BAHAI_SMOKE_BASE_URL || 'http://127.0.0.1:3001';
const CHAT_URL = `${BASE_URL}/chat`;
const HEADLESS = !process.argv.includes('--visible');
const SLOW_MO_ARG = process.argv.find((arg) => arg.startsWith('--slow-mo='));
const SLOW_MO = SLOW_MO_ARG ? Number(SLOW_MO_ARG.split('=')[1]) : 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

async function openDesktopShell(page) {
  await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  const didLogin = await loginIfNeeded(page);
  if (didLogin) {
    await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
  }
  await page.waitForTimeout(1200);
  await page.waitForFunction(() => {
    const text = document.body.innerText || '';
    return text.includes('Desktop') || text.includes('Local Desktop') || text.includes('Cloud Desktop');
  }, { timeout: 15000 });
}

async function openSettings(page) {
  const sidebarSettingsButton = page.getByRole('button', { name: /parametrlər/i });
  assert(await sidebarSettingsButton.count() >= 1, 'Parametrlər button tapılmadı');
  await sidebarSettingsButton.first().click();
  const aiTab = page.getByRole('button', { name: 'Süni İntellekt', exact: true });
  assert(await aiTab.count() === 1, 'Süni İntellekt settings tab tapılmadı');
  await aiTab.click();
  await page.waitForFunction(() => (document.body.innerText || '').includes('Manual (Pro)'), { timeout: 12000 });
}

async function switchExecutionMode(page, mode) {
  const manual = page.getByText('⚙️ Manual (Pro)', { exact: true });
  assert(await manual.count() === 1, 'Manual (Pro) seçimi tapılmadı');
  await manual.click();
  const select = page.getByLabel('Execution mode', { exact: true });
  assert(await select.count() === 1, 'Execution mode seçimi tapılmadı');
  await select.selectOption(mode.toLowerCase());
}

async function assertLocalMode(page) {
  const select = page.getByLabel('Execution mode', { exact: true });
  assert(await select.inputValue() === 'local', 'Local mode tətbiq olunmadı');
  assert((await page.getByLabel('Provider base URL', { exact: true }).inputValue()).includes('11434'), 'Local Ollama URL tətbiq olunmadı');
}

async function assertCloudMode(page) {
  const select = page.getByLabel('Execution mode', { exact: true });
  assert(await select.inputValue() === 'cloud', 'Cloud mode tətbiq olunmadı');
  assert(!(await page.getByLabel('Provider base URL', { exact: true }).inputValue()).includes('11434'), 'Cloud mode lokal URL ilə qaldı');
}

async function closeSettings(page) {
  const closeButton = page.getByRole('button', { name: 'Parametrləri bağla', exact: true });
  assert(await closeButton.count() >= 1, 'Parametrləri bağla düyməsi tapılmadı');
  await closeButton.first().click();
  await page.waitForTimeout(500);
}

async function sendDesktopPrompt(page) {
  const input = page.getByLabel('Message input', { exact: true });
  assert(await input.count() === 1, 'Message input tapılmadı');
  await input.fill('Lokal runtime hazirligini qisa yoxla ve mene bir cumle ile status de.');

  const sendButton = page.getByRole('button', { name: 'Send message' });
  assert(await sendButton.count() === 1, 'Send button tapılmadı');
  await sendButton.click();

  await page.waitForFunction(() => {
    const text = document.body.innerText || '';
    return text.includes('runtime') || text.includes('Local') || text.includes('lokal');
  }, { timeout: 30000 });
}

async function main() {
  console.log(`BahAI desktop smoke starting: ${CHAT_URL}`);
  const { chromium } = require(path.join(process.cwd(), 'backend', 'node_modules', 'playwright'));
  const browser = await chromium.launch({ headless: HEADLESS, slowMo: SLOW_MO });
  const context = await browser.newContext({
    viewport: { width: 1512, height: 982 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) BahAIDesktop Electron/30.0.0 Chrome/124.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  const artifactsDir = path.join(process.cwd(), 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  try {
    await openDesktopShell(page);
    console.log('Desktop shell ok');

    await openSettings(page);
    console.log('Settings panel ok');

    await switchExecutionMode(page, 'Local');
    await assertLocalMode(page);
    console.log('Local mode ok');

    await switchExecutionMode(page, 'Cloud');
    await assertCloudMode(page);
    console.log('Cloud mode ok');

    await closeSettings(page);
    console.log('Settings modal closed');

    await sendDesktopPrompt(page);
    console.log('Desktop message flow ok');

    const screenshotPath = path.join(artifactsDir, `desktop-smoke-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot: ${screenshotPath}`);
    console.log('BahAI desktop smoke passed.');
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`BahAI desktop smoke failed: ${error.message}`);
  process.exitCode = 1;
});
