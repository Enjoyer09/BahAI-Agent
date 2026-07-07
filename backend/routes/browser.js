// ==========================================
// Browser / GUI / Telemetry Route
// ==========================================

const express = require('express');
const router = express.Router();
const { listInstalledBrowsers, closeAllSessions } = require('../browserSession');
const { buildGuiCapabilityStatus } = require('../gui/capabilityStatus');
const { detectComputerUseStatus } = require('../gui/computerUseStatus');

// GET /api/browsers — List installed browsers
router.get('/browsers', async (req, res) => {
  try {
    const browsers = listInstalledBrowsers();
    res.json({ browsers });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/gui-capabilities — Check GUI capabilities
router.get('/gui-capabilities', async (req, res) => {
  try {
    const status = buildGuiCapabilityStatus({});
    res.json({
      ...status,
      capabilities: status
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/computer-use-status — Check Computer Use status
router.get('/computer-use-status', async (req, res) => {
  try {
    const status = detectComputerUseStatus({});
    res.json({
      ...status,
      status
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/runtime-status — Check server runtime status
router.get('/runtime-status', async (req, res) => {
  res.json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    nodeVersion: process.version,
    platform: process.platform,
    timestamp: Date.now()
  });
});

// GET /api/browser-shot — Capture browser screenshot (legacy/simple)
router.get('/browser-shot', async (req, res) => {
  try {
    const { getSession } = require('../browserSession');
    const session = await getSession('default');
    const screenshotBuffer = await session.page.screenshot({ fullPage: false });
    res.setHeader('Content-Type', 'image/png');
    res.send(screenshotBuffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
