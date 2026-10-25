// Copies the Pyodide runtime into public/ so it is served same-origin.
// Cross-origin isolation (COOP/COEP) is required for SharedArrayBuffer, and
// CDN-hosted Pyodide does not send the CORP header that require-corp demands.
//
// The npm package carries only the core runtime, so the few extra wheels we
// offer (pygame-ce) are fetched from the Pyodide CDN once, checked against the
// sha256 in pyodide-lock.json, and vendored next to it.
import { createHash } from 'node:crypto';
import { mkdirSync, copyFileSync, existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pyodide');
const dest = join(root, 'public', 'pyodide');

// Lock-file package names to vendor. Anything else the user imports is not
// available offline, and the worker only ever asks for these.
const PACKAGES = ['pygame-ce'];

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

const lock = JSON.parse(readFileSync(join(src, 'pyodide-lock.json'), 'utf8'));
const { version } = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'));
const cdn = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

for (const name of PACKAGES) {
  const pkg = lock.packages[name];
  if (!pkg) {
    console.error(`${name} is not in pyodide-lock.json`);
    process.exit(1);
  }
  const out = join(dest, pkg.file_name);
  if (existsSync(out) && sha256(readFileSync(out)) === pkg.sha256) continue;

  const res = await fetch(cdn + pkg.file_name);
  if (!res.ok) {
    console.error(`could not download ${pkg.file_name}: HTTP ${res.status}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== pkg.sha256) {
    console.error(`${pkg.file_name}: sha256 mismatch`);
    process.exit(1);
  }
  writeFileSync(out, buf);
  console.log(`${name} -> public/pyodide/${pkg.file_name} (${(buf.length / 1e6).toFixed(1)} MB)`);
}
