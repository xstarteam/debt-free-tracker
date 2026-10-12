#!/usr/bin/env node
/**
 * Deploy-set verification (the "build" check for this no-build static app):
 *   - every JS file parses
 *   - sw.js precache block matches the shipped files (content-hash version)
 *   - every local file referenced by a page (app + guides) or manifest.json exists
 *   - zero runtime requests to third-party hosts (privacy promise, Light L3)
 *   - every page's CSP meta matches the one served by vercel.json; no inline scripts
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

// CSP served as a header (the meta tags must match it)
const vercel = JSON.parse(await readFile(join(ROOT, 'vercel.json'), 'utf8'));
const headerCsp = vercel.headers.flatMap(h => h.headers).find(h => h.key === 'Content-Security-Policy')?.value;
const norm = v => (v || '').split(';').map(s => s.trim()).filter(s => s && !/^(frame-ancestors|upgrade-insecure-requests)/.test(s)).sort().join('; ');
if (/unsafe-inline|unsafe-eval/.test(headerCsp || '')) fail('CSP allows unsafe-inline/unsafe-eval');

// 3–5. every page: local references resolve, nothing third-party, no inline
// script (JSON-LD data blocks only), CSP meta identical to the header
const SITE = 'https://debt-free-tracker-phi.vercel.app/';
const pages = ['index.html', ...(await readdir(join(ROOT, 'guides'))).filter(f => f.endsWith('.html')).sort().map(f => `guides/${f}`)];
const attr = t => (t.match(/\s(?:src|href)="([^"]+)"/) || [])[1];
let refCount = 0;
for (const page of pages) {
  const src = await readFile(join(ROOT, page), 'utf8');
  // <link rel="canonical"> only names the page; it is never fetched
  const tags = [...src.matchAll(/<(?:script|link|a|img)\b[^>]*>/g)].map(m => m[0]).filter(t => !/rel="(?:canonical|alternate)"/.test(t));
  for (const r of tags.map(attr).filter(Boolean)) {
    if (/^(?:[a-z]+:|#)/i.test(r)) continue; // external link or fragment
    const path = new URL(r, SITE + page).pathname.replace(/^\//, '');
    const file = !path ? 'index.html' : path.endsWith('/') ? `${path}index.html` : path;
    refCount += 1;
    if (!(await exists(file))) fail(`${page} references missing file: ${r}`);
  }
  const external = tags.filter(t => /^<(?:script|link|img)/.test(t)).map(attr).filter(r => r && /^https?:/i.test(r));
  if (external.length) fail(`${page} loads third-party resources: ${external.join(', ')}`);
  const inline = [...src.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>/g)].map(m => m[0]).filter(t => !/type="application\/ld\+json"/.test(t));
  if (inline.length) fail(`${page} has an inline script`);
  const meta = (src.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];
  if (!meta) fail(`${page} has no CSP meta tag`);
  else if (norm(meta) !== norm(headerCsp)) fail(`CSP differs between ${page} and vercel.json`);
}
const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
const manifestFiles = [...manifest.icons, ...(manifest.screenshots || [])].map(i => i.src);
for (const f of manifestFiles) if (!(await exists(f))) fail(`manifest.json references missing file: ${f}`);
if (!failures.some(f => f.includes('references missing'))) ok(`${refCount} page + ${manifestFiles.length} manifest references resolve (${pages.length} pages)`);

for (const f of ['assets/app.css', 'assets/guide.css']) {
  const css = await readFile(join(ROOT, f), 'utf8');
  if (/url\(\s*['"]?https?:/i.test(css)) fail(`${f} loads a third-party url()`);
}
for (const f of jsFiles.filter(x => x.startsWith('assets/') || x === 'sw.js')) {
  const src = await readFile(join(ROOT, f), 'utf8');
  if (/(?:fetch|import)\s*\(\s*['"`]https?:/i.test(src) || /from\s+['"]https?:/i.test(src)) fail(`${f} requests a third-party URL`);
}
if (!failures.some(f => f.includes('third-party'))) ok('zero third-party runtime requests');
if (!failures.some(f => /CSP|inline script/.test(f))) ok(`CSP meta matches vercel.json header on every page, no inline scripts`);

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall deploy checks passed');
process.exit(failures.length ? 1 : 0);
