// ==========================================
// ECC Preset Loader
//
// Reads the vendored ECC preset at <repo>/presets/ecc (third-party, MIT —
// see presets/ecc/LICENSE-ECC.txt and PROVENANCE.txt).
//
// SECURITY: preset content is untrusted data, never instructions. Nothing here
// executes a preset file — only YAML frontmatter and markdown bodies are read,
// and lookups go through the in-memory index, so no user-supplied string ever
// becomes a filesystem path.
//
// Token discipline: the index carries id/name/description only. Bodies are
// loaded one entry at a time via getEntry(), never in bulk.
// ==========================================

const fs = require('fs');
const path = require('path');

const PRESET_ROOT = path.resolve(__dirname, '../../presets/ecc');
const CACHE_TTL_MS = 60 * 1000;
const DESCRIPTION_LIMIT = 400;
const BODY_LIMIT = 40000;
const MAX_FILES = 5000;

const KINDS = ['agents', 'skills', 'commands', 'rules'];

let cache = null;
let cachedAt = 0;

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function truncate(value, limit) {
  const text = String(value || '');
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function splitList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function unquote(value) {
  if (!value) return '';
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

const BLOCK_SCALARS = new Set(['>', '>-', '|', '|-']);

// Inline YAML list: [a, b] or ["a", "b"]
function parseInlineList(value) {
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(',')
    .map((item) => unquote(item.trim()))
    .filter(Boolean);
}

// Minimal YAML frontmatter reader. ECC only uses flat keys, one level of
// nesting (metadata:), folded block scalars (description: >-) and inline lists.
function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { attributes: {}, body: raw };

  const lines = raw.split(/\r?\n/);
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return { attributes: {}, body: raw };

  const attributes = {};
  let group = null;

  for (let i = 1; i < end; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) {
      const nested = line.match(/^\s+([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (nested && group && !(nested[1] in attributes)) {
        group[nested[1]] = unquote(nested[2].trim());
      }
      continue;
    }

    const key = match[1];
    const value = match[2].trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      attributes[key] = parseInlineList(value);
      group = null;
      continue;
    }

    if (BLOCK_SCALARS.has(value)) {
      const block = [];
      while (i + 1 < end && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) {
        i += 1;
        block.push(lines[i].trim());
      }
      attributes[key] = block.join(' ').trim();
      group = null;
      continue;
    }

    if (!value) {
      group = {};
      attributes[key] = group;
      continue;
    }

    group = null;
    attributes[key] = unquote(value);
  }

  return { attributes, body: lines.slice(end + 1).join('\n').trim() };
}

function listDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function loadAgents(root) {
  const dir = path.join(root, 'agents');
  return listDir(dir)
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => {
      const file = path.join(dir, entry.name);
      const { attributes, body } = parseFrontmatter(readText(file));
      const id = attributes.name || path.basename(entry.name, '.md');
      return {
        id,
        kind: 'agents',
        name: id,
        description: truncate(attributes.description, DESCRIPTION_LIMIT),
        model: attributes.model || null,
        tools: splitList(attributes.tools),
        color: attributes.color || null,
        path: `agents/${entry.name}`,
        body,
      };
    });
}

function loadSkills(root) {
  const dir = path.join(root, 'skills');
  return listDir(dir)
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const skillDir = path.join(dir, entry.name);
      const file = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(file)) return null;

      const { attributes, body } = parseFrontmatter(readText(file));
      const siblings = listDir(skillDir).filter((item) => item.name !== 'SKILL.md');
      const metadata = attributes.metadata && typeof attributes.metadata === 'object'
        ? attributes.metadata
        : {};

      return {
        id: attributes.name || entry.name,
        kind: 'skills',
        name: attributes.name || entry.name,
        description: truncate(attributes.description, DESCRIPTION_LIMIT),
        origin: metadata.origin || attributes.origin || null,
        license: attributes.license || null,
        tools: splitList(attributes.tools || attributes['allowed-tools']),
        supportFiles: siblings.length,
        path: `skills/${entry.name}/SKILL.md`,
        body,
      };
    })
    .filter(Boolean);
}

function loadCommands(root) {
  const dir = path.join(root, 'commands');
  return listDir(dir)
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => {
      const file = path.join(dir, entry.name);
      const { attributes, body } = parseFrontmatter(readText(file));
      const id = path.basename(entry.name, '.md');
      return {
        id,
        kind: 'commands',
        name: attributes.name || id,
        description: truncate(attributes.description, DESCRIPTION_LIMIT),
        argumentHint: attributes['argument-hint'] || null,
        path: `commands/${entry.name}`,
        body,
      };
    });
}

const RULE_AREA_LABELS = {
  common: 'Ümumi',
  react: 'React',
  typescript: 'TypeScript/JavaScript',
  python: 'Python',
};

function ruleArea(id) {
  const area = id.split('/')[0];
  return RULE_AREA_LABELS[area] || area;
}

function firstHeading(body) {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function loadRules(root) {
  const dir = path.join(root, 'rules');
  const found = [];

  const walk = (current, depth) => {
    if (found.length >= MAX_FILES || depth > 4) return;
    for (const entry of listDir(current)) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;

      const id = path.relative(dir, full).split(path.sep).join('/');
      // The rules tree's own README is documentation about the tree, not a rule set.
      if (id === 'README.md') continue;

      const { attributes, body } = parseFrontmatter(readText(full));
      const heading = firstHeading(body);
      const fallback = `${ruleArea(id)} qaydaları — ${heading || path.basename(id, '.md')}`;

      found.push({
        id,
        kind: 'rules',
        name: id.replace(/\.md$/, ''),
        description: truncate(attributes.description || fallback, DESCRIPTION_LIMIT),
        paths: Array.isArray(attributes.paths) ? attributes.paths : [],
        path: `rules/${id}`,
      });
    }
  };

  walk(dir, 0);
  return found;
}

function loadHookManifests(root) {
  const dir = path.join(root, 'hooks');
  // Claude Code lifecycle hooks — bahAI has no dispatcher for them, so these
  // are reported for provenance only and are never installed or executed.
  return listDir(dir)
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name);
}

function stripBody(entry) {
  const { body, ...rest } = entry;
  return { ...rest, bodyChars: body ? body.length : 0 };
}

function build() {
  const versionFile = path.join(PRESET_ROOT, 'ECC_VERSION.txt');
  const version = fs.existsSync(versionFile) ? readText(versionFile).trim() : null;

  const agents = loadAgents(PRESET_ROOT);
  const skills = loadSkills(PRESET_ROOT);
  const commands = loadCommands(PRESET_ROOT);
  const rules = loadRules(PRESET_ROOT);
  const hooks = loadHookManifests(PRESET_ROOT);

  return {
    id: 'ecc',
    name: 'ECC',
    version,
    source: 'https://github.com/affaan-m/ECC',
    license: 'MIT',
    counts: {
      agents: agents.length,
      skills: skills.length,
      commands: commands.length,
      rules: rules.length,
      hooks: hooks.length,
    },
    agents: agents.map(stripBody),
    skills: skills.map(stripBody),
    commands: commands.map(stripBody),
    rules: rules.map(stripBody),
    hooks: {
      manifests: hooks,
      executable: false,
      note: 'Claude Code lifecycle hooks — bahAI-də dispatcher yoxdur, icra olunmur.',
    },
    loadedAt: new Date().toISOString(),
  };
}

function getIndex() {
  const now = Date.now();
  if (cache && now - cachedAt < CACHE_TTL_MS) return cache;
  cache = build();
  cachedAt = now;
  return cache;
}

function refresh() {
  cache = null;
  cachedAt = 0;
  return getIndex();
}

function findIn(kind) {
  const index = getIndex();
  if (!KINDS.includes(kind)) return null;
  return index[kind];
}

// Full body for one entry, loaded on demand so the index stays cheap.
function getEntry(kind, id) {
  if (!KINDS.includes(kind) || !id) return null;

  if (kind === 'rules') {
    const rule = findIn(kind).find((item) => item.id === id);
    if (!rule) return null;
    const file = path.join(PRESET_ROOT, rule.path);
    if (!fs.existsSync(file)) return null;
    return { ...rule, body: truncate(readText(file), BODY_LIMIT) };
  }

  const entry = findIn(kind).find((item) => item.id === id);
  if (!entry) return null;

  const file = path.join(PRESET_ROOT, entry.path);
  if (!fs.existsSync(file)) return null;
  const { body } = parseFrontmatter(readText(file));
  return { ...entry, body: truncate(body, BODY_LIMIT) };
}

// Prompt text ready to be injected into a system prompt for one entry.
function renderPrompt(kind, id) {
  const entry = getEntry(kind, id);
  if (!entry) return null;

  const header = kind === 'agents'
    ? `Sən "${entry.name}" agentsən. ${entry.description}`
    : `Aktiv bacarıq — ${entry.name}: ${entry.description}`;

  return [header, '', entry.body].join('\n').trim();
}

// Cheap keyword search over the index — never touches bodies.
function search(query, limit = 20) {
  const needle = String(query || '').toLowerCase().trim();
  if (!needle) return [];

  const index = getIndex();
  const results = [];

  for (const kind of KINDS) {
    for (const entry of index[kind]) {
      const haystack = `${entry.id} ${entry.description}`.toLowerCase();
      if (haystack.includes(needle)) {
        results.push({ kind, id: entry.id, name: entry.name, description: entry.description });
        if (results.length >= limit) return results;
      }
    }
  }

  return results;
}

module.exports = {
  PRESET_ROOT,
  KINDS,
  getIndex,
  refresh,
  getEntry,
  renderPrompt,
  search,
};
