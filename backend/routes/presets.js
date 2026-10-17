// ==========================================
// ECC Preset Routes — GET /api/presets/*
//
// Exposes the vendored ECC preset as an index the UI can browse, and resolves
// a chosen entry into a bahAI profile.
//
// Progressive disclosure: /index returns names and descriptions only
// (~60k tokens for the whole preset), and a body is fetched one entry at a
// time via /entry. Never bulk-load the preset into a prompt.
// ==========================================

const express = require('express');
const router = express.Router();
const ecc = require('../presets/ecc');
const adapt = require('../presets/adapt');
const { listProfileBundles } = require('../chat/profiles');
const { requireAdmin } = require('../auth');

// GET /api/presets — list available presets
router.get('/', (req, res) => {
  const index = ecc.getIndex();
  res.json({
    ok: true,
    presets: [
      {
        id: index.id,
        name: index.name,
        version: index.version,
        source: index.source,
        license: index.license,
        counts: index.counts,
        hooksExecutable: false,
      },
    ],
  });
});

// GET /api/presets/ecc/index — counts + index for one kind
// Optional ?kind=agents|skills|commands|rules and ?q=<search>
router.get('/ecc/index', (req, res) => {
  const { kind, q } = req.query;

  if (kind && !ecc.KINDS.includes(kind)) {
    return res.status(400).json({ ok: false, error: `Naməlum kateqoriya: ${kind}` });
  }

  if (q) {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    return res.json({ ok: true, query: String(q), results: ecc.search(q, limit) });
  }

  const index = ecc.getIndex();
  const payload = {
    ok: true,
    id: index.id,
    version: index.version,
    source: index.source,
    license: index.license,
    counts: index.counts,
    hooks: index.hooks,
    loadedAt: index.loadedAt,
  };

  if (kind) {
    payload.kind = kind;
    payload.entries = index[kind];
  }

  res.json(payload);
});

// GET /api/presets/ecc/entry/:kind/:id — full body for one entry
router.get('/ecc/entry/:kind/:id', (req, res) => {
  const { kind, id } = req.params;

  if (!ecc.KINDS.includes(kind)) {
    return res.status(400).json({ ok: false, error: `Naməlum kateqoriya: ${kind}` });
  }

  const entry = ecc.getEntry(kind, id);
  if (!entry) {
    return res.status(404).json({ ok: false, error: 'Preset girişi tapılmadı' });
  }

  res.json({ ok: true, entry });
});

// GET /api/presets/profiles — unified list: built-in bundles + ECC entries
router.get('/profiles', (req, res) => {
  const kind = req.query.kind;
  const limit = Math.min(Number(req.query.limit) || 200, 500);

  const builtin = listProfileBundles().map(adapt.builtinToProfile);

  if (kind && !ecc.KINDS.includes(kind)) {
    return res.status(400).json({ ok: false, error: `Naməlum kateqoriya: ${kind}` });
  }

  const index = ecc.getIndex();
  const kinds = kind ? [kind] : ecc.KINDS;

  // Names and descriptions only — systemPrompt is added on /resolve, per entry,
  // so this list stays small even with 300+ skills.
  const presetProfiles = kinds.flatMap((current) =>
    index[current].slice(0, limit).map((entry) => ({
      preset: 'ecc',
      id: `ecc/${current}/${entry.id}`,
      kind: current,
      name: entry.name,
      description: entry.description,
      model: entry.model || null,
      tools: adapt.mapTools(entry.tools).mapped,
      unsupportedTools: adapt.mapTools(entry.tools).unmapped,
      source: { preset: 'ecc', path: entry.path, license: 'MIT' },
    }))
  );

  res.json({
    ok: true,
    builtin,
    preset: presetProfiles,
    counts: { builtin: builtin.length, preset: presetProfiles.length },
  });
});

// GET /api/presets/resolve — one entry as a ready-to-apply profile
router.get('/resolve', (req, res) => {
  const { preset, kind, id } = req.query;
  const result = adapt.resolveSelection({ presetId: preset, kind, entryId: id });

  if (!result.active) {
    return res.status(404).json({
      ok: false,
      error: result.reason,
      hint: 'İstifadə: /api/presets/resolve?preset=ecc&kind=agents&id=react-reviewer',
    });
  }

  res.json({ ok: true, profile: result.profile });
});

// POST /api/presets/ecc/refresh — drop the index cache (admin)
router.post('/ecc/refresh', requireAdmin, (req, res) => {
  const index = ecc.refresh();
  res.json({ ok: true, counts: index.counts, loadedAt: index.loadedAt });
});

module.exports = router;
