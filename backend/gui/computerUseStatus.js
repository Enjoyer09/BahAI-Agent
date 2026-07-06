const fs = require('fs');
const path = require('path');

const DEFAULT_COMPUTER_USE_ROOT = path.join(process.env.HOME || '/tmp', '.codex', 'computer-use');
const DEFAULT_COMPUTER_USE_APP = path.join(DEFAULT_COMPUTER_USE_ROOT, 'Codex Computer Use.app');
const DEFAULT_COMPUTER_USE_CONFIG = path.join(DEFAULT_COMPUTER_USE_ROOT, 'config.json');

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function detectComputerUseStatus({
  runtimePlatform = process.platform,
  appPath = process.env.COMPUTER_USE_APP_PATH || DEFAULT_COMPUTER_USE_APP,
  configPath = process.env.COMPUTER_USE_CONFIG_PATH || DEFAULT_COMPUTER_USE_CONFIG
} = {}) {
  const supportedPlatform = runtimePlatform === 'darwin';
  const resolvedAppPath = String(appPath || DEFAULT_COMPUTER_USE_APP);
  const binaryPath = path.join(resolvedAppPath, 'Contents', 'MacOS', 'SkyComputerUseService');
  const infoPlistPath = path.join(resolvedAppPath, 'Contents', 'Info.plist');
  const appExists = fs.existsSync(resolvedAppPath);
  const binaryExists = fs.existsSync(binaryPath);
  const infoPlistExists = fs.existsSync(infoPlistPath);
  const configExists = fs.existsSync(configPath);
  const config = configExists ? readJsonSafe(configPath) : null;
  const available = supportedPlatform && appExists && binaryExists;

  const reasons = [];
  if (!supportedPlatform) reasons.push('computer_use_macos_only');
  if (!appExists) reasons.push('computer_use_app_missing');
  if (appExists && !binaryExists) reasons.push('computer_use_binary_missing');
  if (appExists && !infoPlistExists) reasons.push('computer_use_info_missing');

  return {
    available,
    supportedPlatform,
    appPath: resolvedAppPath,
    binaryPath,
    infoPlistPath,
    configPath,
    appExists,
    binaryExists,
    infoPlistExists,
    configExists,
    bundleDetected: appExists && binaryExists && infoPlistExists,
    bundleId: appExists ? 'com.openai.sky.CUAService' : '',
    config: config ? {
      locale: config.locale || '',
      direction: config.direction || '',
      accentColor: config.accentColor || ''
    } : null,
    reasons
  };
}

module.exports = {
  detectComputerUseStatus,
  DEFAULT_COMPUTER_USE_ROOT,
  DEFAULT_COMPUTER_USE_APP,
  DEFAULT_COMPUTER_USE_CONFIG
};
