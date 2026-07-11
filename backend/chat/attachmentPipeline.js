/**
 * bahAI - Attachment Pipeline
 * Transplanted and adapted from LibreChat's Files/process.js and strategies.js
 * Centralizes file uploading, validation, and deletion logic.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// In a full implementation, we'd require Sharp for image processing or text extraction libs.

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE_MB = 20;

function filterFile(file) {
  const isImage = SUPPORTED_IMAGE_TYPES.includes(file.mimetype || file.type);
  const sizeMB = (file.size || 0) / (1024 * 1024);

  if (sizeMB > MAX_FILE_SIZE_MB) {
    throw new Error(`File size exceeds ${MAX_FILE_SIZE_MB}MB limit`);
  }

  return { isImage, sizeMB };
}

async function processImageFile(file, options = {}) {
  // Skeleton for image processing (resizing, converting to WebP/Base64)
  // LibreChat uses sharp here.
  const { isImage } = filterFile(file);
  if (!isImage) {
    throw new Error('File is not a supported image type');
  }

  // Generate a safe unique filename
  const fileHash = crypto.randomBytes(16).toString('hex');
  const ext = path.extname(file.name || '').toLowerCase() || '.png';
  const newFilename = `${fileHash}${ext}`;

  return {
    filename: newFilename,
    originalName: file.name,
    mimeType: file.mimetype || file.type,
    // Add processed buffer/base64 here
  };
}

async function processFileUpload(file, userOptions) {
  const { isImage } = filterFile(file);
  
  if (isImage) {
    return await processImageFile(file, userOptions);
  }

  // Process text/document file
  const fileHash = crypto.randomBytes(16).toString('hex');
  const ext = path.extname(file.name || '').toLowerCase() || '.txt';
  const newFilename = `${fileHash}${ext}`;

  return {
    filename: newFilename,
    originalName: file.name,
    mimeType: file.mimetype || file.type,
  };
}

async function processDeleteRequest(fileId, filePath) {
  // Skeleton for deleting a file securely
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return { success: true, message: 'File deleted successfully' };
  } catch (error) {
    console.error(`Error deleting file ${fileId}:`, error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  filterFile,
  processImageFile,
  processFileUpload,
  processDeleteRequest
};
