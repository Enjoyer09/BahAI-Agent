// ==========================================
// App Builder — publish self-contained HTML pages from chat
// ==========================================
// The `build_and_publish_app` tool lets the agent take an HTML payload it has
// written (a landing page, form, calculator, quiz, portfolio, etc.) and serve
// it as a live, hosted URL. The agent passes the HTML string; this module
// validates it, writes it to disk under APPS_DIR, and returns the path.
//
// Persistence on cloud hosts: the target directory defaults to <repo>/backend/apps
// which on Railway is ephemeral. Mount a Railway Volume at that path (or set
// APPS_DIR to the mount) so published apps survive redeploys.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2 MB — a single static HTML page is rarely larger.
const MAX_TITLE_CHARS = 100;
const MAX_SLUG_CHARS = 40;
// Slugs are URL-safe path segments: lowercase letters, digits, hyphens. Must
// start with an alphanumeric character. This prevents path traversal (no dots,
// no slashes) and keeps URLs readable.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function getAppsDir() {
  if (process.env.APPS_DIR) return path.resolve(process.env.APPS_DIR);
  // <repo>/backend/apps when running from backend/, or <appsRoot>/apps via env override.
  return path.resolve(__dirname, '..', 'apps');
}

function getPublicBaseUrl() {
  const base = process.env.PUBLIC_BASE_URL;
  if (!base) return null;
  return base.replace(/\/+$/, '');
}

// SYNC mkdir so index.js can call it once at boot without async ceremony.
// A single mkdir recursive with recursive:true is cheap and only runs once
// per process — we don't want to wait for it before serving the first
// request.
function ensureAppsDir() {
  const dir = getAppsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function validateInputs({ html, title, slug }) {
  if (typeof html !== 'string' || html.length === 0) {
    return { ok: false, error: 'html is required and must be a non-empty string.' };
  }
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > MAX_HTML_BYTES) {
    return { ok: false, error: `html exceeds the ${MAX_HTML_BYTES}-byte size limit (got ${bytes}).` };
  }
  if (title != null && title !== '') {
    if (typeof title !== 'string') return { ok: false, error: 'title must be a string.' };
    if (title.length > MAX_TITLE_CHARS) {
      return { ok: false, error: `title exceeds ${MAX_TITLE_CHARS} characters.` };
    }
  }
  if (slug != null && slug !== '') {
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
      return {
        ok: false,
        error: 'slug must match /^[a-z0-9][a-z0-9-]{0,39}$/ (lowercase letters/digits/hyphens; must start with a letter or digit; max 40 chars).'
      };
    }
  }
  return { ok: true };
}

function generateId() {
  return 'app-' + crypto.randomBytes(6).toString('hex'); // 12 hex chars
}

/**
 * Publish an HTML payload.
 * @returns {{ok:true, id:string, title:string|null, path:string, publicUrl:string|null}
 *          | {ok:false, error:string}}
 */
async function publishApp({ html, title, slug } = {}) {
  const v = validateInputs({ html, title, slug });
  if (!v.ok) return v;

  const id = slug && slug.length > 0 ? slug : generateId();
  const dir = getAppsDir();
  const targetFile = path.join(dir, id, 'index.html');

  // Paranoid path-traversal guard. SLUG_RE + generateId() already prevent this,
  // but resolve and check anyway in case the apps dir itself was overridden.
  const resolved = path.resolve(targetFile);
  const rootResolved = path.resolve(dir) + path.sep;
  if (!resolved.startsWith(rootResolved)) {
    return { ok: false, error: 'Invalid path.' };
  }

  await fsp.mkdir(path.dirname(resolved), { recursive: true });
  await fsp.writeFile(resolved, html, 'utf8');

  const urlPath = `/apps/${id}/`;
  const publicBase = getPublicBaseUrl();
  return {
    ok: true,
    id,
    title: title || null,
    path: urlPath,
    publicUrl: publicBase ? `${publicBase}${urlPath}` : null
  };
}

module.exports = {
  publishApp,
  ensureAppsDir,
  getAppsDir,
  getPublicBaseUrl,
  MAX_HTML_BYTES
};