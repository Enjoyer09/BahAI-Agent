// ==========================================
// ECC Preset Adapter
//
// Translates ECC entries into bahAI's own shapes:
//   - ECC tool names (Read, Grep, Bash…) → bahAI registry names (read_file, grep_search…)
//   - ECC agent/skill/command → a system-prompt fragment + model hint
//
// This is a naming adapter only. An ECC agent's tool list is a declaration of
// what its prompt assumes is available; it never grants permissions. bahAI's
// own approval layer still gates every tool call.
// ==========================================

const ecc = require('./ecc');

// Parenthesised forms like `Bash(git:*)` reduce to the base tool name.
function baseToolName(raw) {
  return String(raw || '').replace(/\(.*\)$/, '').trim();
}

const TOOL_MAP = {
  Read: 'read_file',
  Write: 'write_file',
  Edit: 'file_edit',
  MultiEdit: 'multi_file_edit',
  Grep: 'grep_search',
  Glob: 'glob_search',
  LS: 'list_directory',
  Bash: 'run_terminal_command',
  WebFetch: 'web_fetch',
  WebSearch: 'web_search',
};

function mapTools(eccTools) {
  const mapped = [];
  const unmapped = [];

  for (const raw of eccTools || []) {
    const base = baseToolName(raw);
    const target = TOOL_MAP[base];
    if (target) {
      if (!mapped.includes(target)) mapped.push(target);
    } else if (!unmapped.includes(base)) {
      unmapped.push(base);
    }
  }

  return { mapped, unmapped };
}

function modelHint(eccModel) {
  if (!eccModel) return null;
  const value = String(eccModel).toLowerCase();
  if (value.includes('opus')) return 'high';
  if (value.includes('haiku')) return 'low';
  return 'medium';
}

// One preset entry as a ready-to-use bahAI profile.
function toProfile(kind, id) {
  const entry = ecc.getEntry(kind, id);
  if (!entry) return null;

  const { mapped, unmapped } = mapTools(entry.tools);

  return {
    preset: 'ecc',
    id: `${kind}/${entry.name}`,
    kind,
    name: entry.name,
    description: entry.description,
    systemPrompt: ecc.renderPrompt(kind, id),
    model: entry.model || null,
    reasoningEffort: modelHint(entry.model),
    tools: mapped,
    unsupportedTools: unmapped,
    source: {
      preset: 'ecc',
      path: entry.path,
      license: 'MIT',
    },
  };
}

const FALLBACK_ROLE_PROMPT = 'Sən köməkçi assitansan. İstifadəçiyə azərbaycan dilində kömək et.';

// bahAI's built-in PROFILE_BUNDLES are not ECC entries — they are local
// definitions, so they get a compatible profile shape with no preset source.
function builtinToProfile(bundle) {
  return {
    preset: null,
    id: `builtin/${bundle.id}`,
    kind: 'builtin',
    name: bundle.name,
    description: bundle.description,
    systemPrompt: bundle.rolePrompt || FALLBACK_ROLE_PROMPT,
    model: bundle.recommendedModel || null,
    reasoningEffort: null,
    tools: [],
    unsupportedTools: [],
    source: {
      preset: null,
      path: 'backend/chat/profiles.js',
      license: null,
    },
  };
}

// Effective preset state for one chat request. Returns at most one ECC entry,
// so the injected context stays a fixed size no matter how large a preset is.
function resolveSelection({ presetId, kind, entryId } = {}) {
  if (presetId !== 'ecc') return { active: false, reason: 'preset_seçilməyib' };
  if (!ecc.KINDS.includes(kind) || !entryId) {
    return { active: false, reason: 'kind_və_ya_id_verilməyib' };
  }

  const profile = toProfile(kind, entryId);
  if (!profile) return { active: false, reason: 'preset_girişi_tapılmadı' };

  return { active: true, profile };
}

module.exports = {
  TOOL_MAP,
  mapTools,
  toProfile,
  builtinToProfile,
  resolveSelection,
};
