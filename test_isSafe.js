const path = require('path');
const ALLOWED_DIRS = [
  path.resolve(__dirname, '..'),
  path.resolve(process.env.HOME || '/')
];
const filePath = '/Users/macbookair/Documents/ironwaves-pos-platform';
const resolvedPath = path.resolve(filePath);

const isAllowedGlobally = ALLOWED_DIRS.some(base => {
  const relGlobally = path.relative(base, resolvedPath);
  return !relGlobally.startsWith('..') && !path.isAbsolute(relGlobally);
});

console.log("isAllowedGlobally:", isAllowedGlobally);
console.log("HOME:", process.env.HOME);
