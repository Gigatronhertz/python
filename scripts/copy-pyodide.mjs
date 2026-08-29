// Copies the Pyodide runtime into public/ so it is served same-origin.
// Cross-origin isolation (COOP/COEP) is required for SharedArrayBuffer, and
// CDN-hosted Pyodide does not send the CORP header that require-corp demands.
import { mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pyodide');
const dest = join(root, 'public', 'pyodide');

const FILES = [
  'pyodide.mjs',
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
];

if (!existsSync(src)) {
  console.error('pyodide not installed — run `npm install` first.');
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
let total = 0;
for (const f of FILES) {
  const from = join(src, f);
  if (!existsSync(from)) {
    console.error(`missing ${f} in node_modules/pyodide`);
    process.exit(1);
  }
  copyFileSync(from, join(dest, f));
  total += statSync(from).size;
}
console.log(`pyodide -> public/pyodide (${FILES.length} files, ${(total / 1e6).toFixed(1)} MB)`);
