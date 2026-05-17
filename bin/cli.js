#!/usr/bin/env node

const path = require('path');
const { exec } = require('child_process');

// Force standalone LOCAL MODE
process.env.LOCAL_MODE = 'true';
process.env.PORT = process.env.PORT || '3001';

console.log(`
\x1b[36m██████╗  █████╗ ██╗  ██╗ █████╗ ██╗
██╔══██╗██╔══██╗██║  ██║██╔══██╗██║
██████╔╝███████║███████║███████║██║
██╔══██╗██╔══██║██╔══██║██╔══██║██║
██████╔╝██║  ██║██║  ██║██║  ██║██║
╚══════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝\x1b[0m
     \x1b[35mSüni İntellekt Agent v1.0.0\x1b[0m
`);

console.log('⚡ Lokal/Standalone rejim başladılır...');
console.log('📁 Hazırkı qovluq:', process.cwd());

// Import backend/index.js to start the server!
require(path.join(__dirname, '../backend/index.js'));

// Open browser automatically
const url = `http://localhost:${process.env.PORT}`;
setTimeout(() => {
  console.log(`\n🚀 Brauzer açılır: ${url}`);
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${opener} ${url}`, (err) => {
    if (err) {
      console.log(`⚠️ Brauzeri avtomatik aça bilmədim. Zəhmət olmasa linkə əllə daxil olun: ${url}`);
    }
  });
}, 1500);
