/**
 * bahAI - Attachment Pipeline
 * Adapted from LibreChat's Files/process.js and strategies.js
 * Centralizes file validation, image processing (sharp), and storage.
 *
 * Storage is pluggable via strategies:
 *  - 'memory' (default): keeps buffers in a Map — good for stateless web calls
 *  - 'local':            writes files to a directory on disk
 *  - custom:             any object with { save(id, buffer, meta), read(id), delete(id) }
 *
 * sharp is loaded lazily and is optional: if the native module is missing,
 * image processing degrades to pass-through (original bytes are kept).
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'];
const MAX_FILE_SIZE_MB = 20;
// OpenAI vision detail:high typically caps the long edge at 1568px; anything
// above that mostly wastes tokens and inflates request payloads.
const DEFAULT_MAX_DIMENSION = 1568;
const DEFAULT_QUALITY = 85;

// ---------------------------------------------------------------------------
// Optional sharp loading (lazy + memoized, never throws)
// ---------------------------------------------------------------------------
let sharpPromise = null;
function loadSharp() {
  if (!sharpPromise) {
    sharpPromise = (async () => {
      try {
        return require('sharp');
      } catch {
        return null;
      }
    })();
  }
  return sharpPromise;
}

// ---------------------------------------------------------------------------
// Storage strategies
// ---------------------------------------------------------------------------

class MemoryStorage {
  constructor() {
    this.files = new Map();
  }
  async save(id, buffer, meta = {}) {
    this.files.set(id, { buffer, meta });
    return { id, size: buffer.length, meta };
  }
  async read(id) {
    const entry = this.files.get(id);
    return entry ? { buffer: entry.buffer, meta: entry.meta } : null;
  }
  async delete(id) {
    return this.files.delete(id);
  }
  async list() {
    return Array.from(this.files.keys());
  }
}

class LocalStorage {
  constructor({ dir } = {}) {
    this.dir = dir || path.join(process.cwd(), '.bahai-uploads');
    fs.mkdirSync(this.dir, { recursive: true });
  }
  _resolve(id) {
    return path.join(this.dir, path.basename(String(id)));
  }
  async save(id, buffer, meta = {}) {
    const filePath = this._resolve(id);
    fs.writeFileSync(filePath, buffer);
    return { id, filePath, size: buffer.length, meta };
  }
  async read(id) {
    const filePath = this._resolve(id);
    if (!fs.existsSync(filePath)) return null;
    return { buffer: fs.readFileSync(filePath), meta: { filePath } };
  }
  async delete(id) {
    const filePath = this._resolve(id);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }
  async list() {
    return fs.existsSync(this.dir) ? fs.readdirSync(this.dir) : [];
  }
}

function createStorageStrategy(type = 'memory', options = {}) {
  if (type && typeof type !== 'string') {
    // Custom strategy object passed directly
    return type;
  }
  switch (String(type || 'memory').toLowerCase()) {
    case 'local':
    case 'disk':
    case 'filesystem':
      return new LocalStorage(options);
    case 'memory':
    default:
      return new MemoryStorage();
  }
}

// ---------------------------------------------------------------------------
// Data URL helpers
// ---------------------------------------------------------------------------

function isDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:');
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return null;
  const mimeType = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';
  const buffer = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');
  return { mimeType, buffer };
}

function encodeDataUrl(buffer, mimeType) {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function filterFile(file) {
  const mimeType = String(file?.mimetype || file?.type || '');
  const isImage = SUPPORTED_IMAGE_TYPES.includes(mimeType);
  const sizeMB = (file?.size || file?.buffer?.length || 0) / (1024 * 1024);

  if (sizeMB > MAX_FILE_SIZE_MB) {
    throw new Error(`File size exceeds ${MAX_FILE_SIZE_MB}MB limit`);
  }
  return { isImage, sizeMB, mimeType };
}

function sanitizeFilename(name = '') {
  const base = path.basename(String(name || 'attachment'));
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
  return clean || 'attachment';
}

function generateFileId(originalName = '') {
  const hash = crypto.randomBytes(16).toString('hex');
  const ext = path.extname(originalName || '').toLowerCase() || '';
  return `${hash}${ext}`;
}

// ---------------------------------------------------------------------------
// Image processing (sharp, optional)
// ---------------------------------------------------------------------------

/**
 * Resize + re-encode an image buffer with sharp.
 * Returns null when sharp is unavailable or the buffer is not a decodable image.
 */
async function processImageBuffer(buffer, {
  maxDimension = DEFAULT_MAX_DIMENSION,
  quality = DEFAULT_QUALITY,
  format = 'jpeg',
} = {}) {
  const sharp = await loadSharp();
  if (!sharp || !buffer || !buffer.length) return null;
  try {
    let image = sharp(buffer, { failOn: 'none' });
    const metadata = await image.metadata();
    if (!metadata || !metadata.width || !metadata.height) return null;
    const longEdge = Math.max(metadata.width, metadata.height);
    if (longEdge > maxDimension) {
      const scale = maxDimension / longEdge;
      image = image.resize({
        width: Math.round(metadata.width * scale),
        height: Math.round(metadata.height * scale),
        fit: 'inside',
        withoutEnlargement: true,
      });
    }
    let output;
    if (format === 'webp') {
      output = await image.webp({ quality }).toBuffer();
    } else if (format === 'png') {
      output = await image.png({ compressionLevel: 6 }).toBuffer();
    } else {
      output = await image.jpeg({ quality, mozjpeg: true }).toBuffer();
    }
    // Avoid re-encoding when the output is bigger than the input (e.g. tiny PNGs)
    return output.length < buffer.length ? output : buffer;
  } catch {
    return null;
  }
}

/**
 * Resize/compress a data:image URL (best-effort).
 * Returns the original URL on any failure so callers never break on sharp issues.
 */
async function resizeImageDataUrl(dataUrl, options = {}) {
  if (!isDataUrl(dataUrl)) return dataUrl;
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded || !decoded.buffer || !decoded.buffer.length) return dataUrl;
  if (String(decoded.mimeType).startsWith('image/gif')) return dataUrl; // keep animation
  const output = await processImageBuffer(decoded.buffer, options);
  if (!output || output.length >= decoded.buffer.length) return dataUrl;
  const targetMime = options.format === 'webp' ? 'image/webp' : (options.format === 'png' ? 'image/png' : 'image/jpeg');
  return encodeDataUrl(output, targetMime);
}

// ---------------------------------------------------------------------------
// Main pipeline entry points
// ---------------------------------------------------------------------------

/**
 * Process an image file (from multer-style object or { name, buffer/dataUrl, mimetype }).
 * Returns metadata + processed base64/dataUrl + optionally stored id.
 */
async function processImageFile(file, options = {}) {
  const { isImage } = filterFile(file);
  if (!isImage) {
    throw new Error('File is not a supported image type');
  }

  const originalName = sanitizeFilename(file?.name || 'image');
  const mimeType = file?.mimetype || file?.type || 'image/png';
  const fileId = options.fileId || generateFileId(originalName);

  let buffer = file?.buffer;
  if (!buffer && isDataUrl(file?.url)) {
    buffer = decodeDataUrl(file.url)?.buffer;
  }
  if (!buffer) {
    throw new Error('Image file has no readable content');
  }

  // Re-encode large images to shrink vision payloads (best-effort)
  const processed = await processImageBuffer(buffer, {
    maxDimension: options.maxDimension || DEFAULT_MAX_DIMENSION,
    quality: options.quality || DEFAULT_QUALITY,
    format: options.format || (mimeType === 'image/png' ? 'png' : 'jpeg'),
  });
  const finalBuffer = processed || buffer;
  const finalMime = processed
    ? (options.format === 'webp' ? 'image/webp' : (options.format === 'png' ? 'image/png' : mimeType))
    : mimeType;

  let storageResult = null;
  if (options.storage) {
    const strategy = typeof options.storage === 'string'
      ? createStorageStrategy(options.storage, options.storageOptions)
      : options.storage;
    storageResult = await strategy.save(fileId, finalBuffer, {
      originalName,
      mimeType: finalMime,
      width: options.width,
      height: options.height,
    });
  }

  return {
    id: fileId,
    filename: fileId,
    originalName,
    mimeType: finalMime,
    url: encodeDataUrl(finalBuffer, finalMime),
    dataUrl: encodeDataUrl(finalBuffer, finalMime),
    buffer: finalBuffer,
    size: finalBuffer.length,
    processed: Boolean(processed),
    storage: storageResult,
  };
}

/**
 * Generic upload dispatch: images go through sharp, documents pass through with
 * their content available for downstream extraction.
 */
async function processFileUpload(file, userOptions = {}) {
  const { isImage, mimeType } = filterFile(file);
  const originalName = sanitizeFilename(file?.name || 'attachment');
  const fileId = userOptions.fileId || generateFileId(originalName);

  let buffer = file?.buffer;
  if (!buffer && isDataUrl(file?.url)) {
    buffer = decodeDataUrl(file.url)?.buffer;
  }

  if (isImage) {
    const processed = await processImageFile({ ...file, buffer }, userOptions);
    return { ...processed, type: 'image' };
  }

  let storageResult = null;
  if (userOptions.storage) {
    const strategy = typeof userOptions.storage === 'string'
      ? createStorageStrategy(userOptions.storage, userOptions.storageOptions)
      : userOptions.storage;
    storageResult = await strategy.save(fileId, buffer || Buffer.alloc(0), { originalName, mimeType });
  }

  return {
    id: fileId,
    filename: fileId,
    originalName,
    mimeType,
    type: 'document',
    url: buffer ? encodeDataUrl(buffer, mimeType) : '',
    buffer: buffer || Buffer.alloc(0),
    size: buffer ? buffer.length : 0,
    storage: storageResult,
  };
}

async function processDeleteRequest(fileId, filePath, options = {}) {
  try {
    if (options.storage) {
      const strategy = typeof options.storage === 'string'
        ? createStorageStrategy(options.storage, options.storageOptions)
        : options.storage;
      const removed = await strategy.delete(fileId);
      return { success: removed, message: removed ? 'File deleted successfully' : 'File not found' };
    }
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return { success: true, message: 'File deleted successfully' };
    }
    return { success: false, message: 'File not found' };
  } catch (error) {
    console.error(`Error deleting file ${fileId}:`, error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  SUPPORTED_IMAGE_TYPES,
  MAX_FILE_SIZE_MB,
  DEFAULT_MAX_DIMENSION,
  MemoryStorage,
  LocalStorage,
  createStorageStrategy,
  filterFile,
  processImageFile,
  processFileUpload,
  processDeleteRequest,
  processImageBuffer,
  resizeImageDataUrl,
  decodeDataUrl,
  encodeDataUrl,
  isDataUrl,
  sanitizeFilename,
  generateFileId,
};
