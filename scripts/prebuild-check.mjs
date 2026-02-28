import fs from 'node:fs';

const file = 'src/pages/Settings.tsx';
const src = fs.readFileSync(file, 'utf8');

const forbidden = [
  '<<<<<<<',
  '=======',
  '>>>>>>>',
];

for (const token of forbidden) {
  if (src.includes(token)) {
    console.error(`[prebuild-check] Merge conflict marker found in ${file}: ${token}`);
    process.exit(1);
  }
}

const setNameMatches = src.match(/setEditTokenName/g) ?? [];
if (setNameMatches.length > 1) {
  console.error('[prebuild-check] Duplicate setEditTokenName declaration pattern detected.');
  process.exit(1);
}

const setValueMatches = src.match(/setEditTokenValue/g) ?? [];
if (setValueMatches.length > 1) {
  console.error('[prebuild-check] Duplicate setEditTokenValue declaration pattern detected.');
  process.exit(1);
}

console.log('[prebuild-check] Settings.tsx sanity checks passed.');
