#!/usr/bin/env node
/**
 * Deploy-set verification (the "build" check for this no-build static app):
 *   - every JS file parses
 *   - sw.js precache block matches the shipped files (content-hash version)
 *   - every local file referenced by index.html / manifest.json exists
 *   - zero runtime requests to third-party hosts (privacy promise, Light L3)
 *   - the CSP in index.html matches the one served by vercel.json
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { precacheBlock } from './stamp-sw.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const ok = msg => console.log(`  ok  ${msg}`);
const fail = msg => {
  failures.push(msg);
  console.log(`  FAIL ${msg}`);
};
const exists = async p => stat(join(ROOT, p)).then(s => s.isFile(), () => false);

// 1. syntax
const jsFiles = [
  'sw.js',
  ...(await readdir(join(ROOT, 'assets/js'))).filter(f => f.endsWith('.js')).map(f => `assets/js/${f}`),
  ...(await readdir(join(ROOT, 'tools'))).filter(f => f.endsWith('.mjs')).map(f => `tools/${f}`),
];
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', join(ROOT, f)], { stdio: 'pipe' });
  } catch (e) {
    fail(`syntax: ${f}\n${e.stderr}`);
  }
}
ok(`${jsFiles.length} JS files parse`);

// 2. service worker precache
const sw = await readFile(join(ROOT, 'sw.js'), 'utf8');
const block = await precacheBlock();
if (sw.includes(block)) ok(`sw.js precache current (${block.split('\n')[1].trim()})`);
else fail('sw.js precache block is stale — run: node tools/stamp-sw.mjs');

// 3. local references
const html = await readFile(join(ROOT, 'index.html'), 'utf8');
// <link rel="canonical"> only names the page; it is never fetched
const tags = [...html.matchAll(/<(?:script|link)\b[^>]*>/g)].map(m => m[0]).filter(t => !/rel="(?:canonical|alternate)"/.test(t));
const refs = tags.map(t => (t.match(/\s(?:src|href)="([^"]+)"/) || [])[1]).filter(Boolean);
const local = refs.filter(r => !/^[a-z]+:/i.test(r) && !r.startsWith('#'));
for (const r of local) if (!(await exists(r.replace(/^\.?\//, '').split('?')[0]))) fail(`index.html references missing file: ${r}`);
const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
const manifestFiles = [...manifest.icons, ...(manifest.screenshots || [])].map(i => i.src);
for (const f of manifestFiles) if (!(await exists(f))) fail(`manifest.json references missing file: ${f}`);
ok(`${local.length} index.html + ${manifestFiles.length} manifest references resolve`);

// 4. no third-party runtime requests
const external = refs.filter(r => /^https?:/i.test(r));
if (external.length) fail(`index.html loads third-party resources: ${external.join(', ')}`);
const css = await readFile(join(ROOT, 'assets/app.css'), 'utf8');
if (/url\(\s*['"]?https?:/i.test(css)) fail('app.css loads a third-party url()');
for (const f of jsFiles.filter(x => x.startsWith('assets/') || x === 'sw.js')) {
  const src = await readFile(join(ROOT, f), 'utf8');
  if (/(?:fetch|import)\s*\(\s*['"`]https?:/i.test(src) || /from\s+['"]https?:/i.test(src)) fail(`${f} requests a third-party URL`);
}
if (!failures.some(f => f.includes('third-party'))) ok('zero third-party runtime requests');

// 5. CSP parity
const metaCsp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];
const vercel = JSON.parse(await readFile(join(ROOT, 'vercel.json'), 'utf8'));
const headerCsp = vercel.headers.flatMap(h => h.headers).find(h => h.key === 'Content-Security-Policy')?.value;
const norm = v => (v || '').split(';').map(s => s.trim()).filter(s => s && !/^(frame-ancestors|upgrade-insecure-requests)/.test(s)).sort().join('; ');
if (!metaCsp) fail('index.html has no CSP meta tag');
else if (norm(metaCsp) !== norm(headerCsp)) fail('CSP differs between index.html and vercel.json');
else ok('CSP meta matches vercel.json header');
if (/unsafe-inline|unsafe-eval/.test(`${metaCsp} ${headerCsp}`)) fail('CSP allows unsafe-inline/unsafe-eval');

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall deploy checks passed');
process.exit(failures.length ? 1 : 0);
