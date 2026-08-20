const express = require('express');
const router = express.Router();
const pluginRegistry = require('../plugins/registry');
const { listProfileBundles } = require('../chat/profiles');
const path = require('path');
const { spawn } = require('child_process');

// GET /api/dsh/plugins - List installed plugins
router.get('/plugins', (req, res) => {
  res.json({
    ok: true,
    plugins: pluginRegistry.listPlugins()
  });
});

// POST /api/dsh/plugins/execute - Execute a plugin dynamically
router.post('/plugins/execute', async (req, res) => {
  const { name, context } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Plugin name required' });
  try {
    const result = await pluginRegistry.executePlugin(name, context || {});
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dsh/profiles - List sub-agent profile bundles
router.get('/profiles', (req, res) => {
  res.json({
    ok: true,
    profiles: listProfileBundles()
  });
});

// POST /api/dsh/stress-test - Trigger 100-prompt heavy stress test from GUI
router.post('/stress-test', (req, res) => {
  const testScript = path.resolve(__dirname, '../../sandbox/quick_stress_audit.js');
  const child = spawn('node', [testScript], {
    cwd: path.resolve(__dirname, '../..'),
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  res.json({
    ok: true,
    message: '100+ Heavy Stress Test started in background!',
    reportPath: '100_stress_test_report.md'
  });
});

module.exports = router;
