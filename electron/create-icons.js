#!/usr/bin/env node
/**
 * Icon Generator for bahAI Desktop App
 * 
 * Usage: node create-icons.js
 * 
 * This creates a simple placeholder icon.
 * For production, replace icons/icon.png with your actual 1024x1024 icon
 * and use tools like electron-icon-maker to generate .icns and .ico files.
 * 
 * To generate proper icons from a PNG:
 *   npx electron-icon-maker --input=icon-source.png --output=icons
 */

const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Create a simple SVG icon as placeholder
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6366f1"/>
      <stop offset="100%" style="stop-color:#8b5cf6"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="220" fill="url(#bg)"/>
  <text x="512" y="620" font-family="SF Pro Display, -apple-system, sans-serif" font-size="480" font-weight="900" fill="white" text-anchor="middle">b</text>
  <text x="512" y="820" font-family="SF Pro Display, -apple-system, sans-serif" font-size="160" font-weight="600" fill="rgba(255,255,255,0.8)" text-anchor="middle">AI</text>
</svg>`;

fs.writeFileSync(path.join(iconsDir, 'icon.svg'), svg);
console.log('✅ Icon SVG created at electron/icons/icon.svg');
console.log('');
console.log('📋 Next steps:');
console.log('   1. Convert SVG to 1024x1024 PNG (use any image editor)');
console.log('   2. Run: npx electron-icon-maker --input=icons/icon.png --output=icons');
console.log('   3. This will generate .icns (macOS) and .ico (Windows) files');
