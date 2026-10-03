// Verifies every named import in src/ resolves to a real export, and reports
// imports that are never used in the file.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const ROOT = resolve('src');
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
})(ROOT);

const exportsOf = new Map();
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s+(?:const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]+)\}/gm)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim();
      if (n) names.add(n);
    }
  }
  if (/^export\s+default/m.test(src)) names.add('default');
  exportsOf.set(file, names);
}

let problems = 0;
const unused = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const importRe = /import\s+(?:([A-Za-z0-9_$]+)\s*,\s*)?(?:\{([^}]*)\}|([A-Za-z0-9_$]+))\s+from\s+['"]([^'"]+)['"]/g;
  const usedText = src.replace(importRe, '');
  for (const m of src.matchAll(importRe)) {
    const defaultName = m[1];
    const namedRaw = m[2];
    const bareName = m[3];
    const spec = m[4];
    if (spec.includes('vendor/')) continue;
    const target = resolve(dirname(file), spec);
    if (!exportsOf.has(target)) {
      console.log(`UNRESOLVED MODULE ${file} -> ${spec}`);
      problems++;
      continue;
    }
    const avail = exportsOf.get(target);
    if (bareName && !avail.has('default')) {
      console.log(`MISSING DEFAULT ${file}: '${spec}' has no default export`);
      problems++;
    }
    if (namedRaw) {
      for (const part of namedRaw.split(',')) {
        const n = part.trim().split(/\s+as\s+/)[0].trim();
        if (!n) continue;
        if (!avail.has(n)) {
          console.log(`MISSING EXPORT  ${file}: '${n}' not exported by ${spec}`);
          problems++;
        }
        const local = part.trim().split(/\s+as\s+/).pop().trim();
        if (!new RegExp(`\\b${local}\\b`).test(usedText)) {
          unused.push(`${file}: ${local} (from ${spec})`);
        }
      }
    }
    if (bareName && !avail.has('default')) {
      console.log(`MISSING DEFAULT ${file}: '${spec}' has no default export`);
      problems++;
    }
    if (defaultName && !new RegExp(`\\b${defaultName}\\b`).test(usedText)) {
      unused.push(`${file}: ${defaultName} (from ${spec})`);
    }
  }
}

if (unused.length) {
  console.log('\nUNUSED IMPORTS:');
  for (const u of unused) console.log('  ' + u);
}
console.log(`\n${problems} unresolved import problem(s), ${unused.length} unused import(s)`);