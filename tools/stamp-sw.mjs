#!/usr/bin/env node
/**
 * Regenerate the precache block in sw.js: the list of runtime files and a
 * VERSION derived from their contents. Run after changing any shipped file:
 *
 *   node tools/stamp-sw.mjs          # rewrite sw.js
 *   node tools/stamp-sw.mjs --check  # exit 1 if sw.js is stale (CI)
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_VERSION = '2.0.0';

/** Everything the app needs to run offline. Screenshots / OG image are not runtime. */
export async function runtimeFiles() {
  const list = ['index.html', 'manifest.json', 'favicon.ico', 'assets/app.css'];
  const js = (await readdir(join(ROOT, 'assets/js'))).filter(f => f.endsWith('.js')).sort();
  const fonts = (await readdir(join(ROOT, 'assets/fonts'))).filter(f => f.endsWith('.woff2')).sort();
  list.push(...js.map(f => `assets/js/${f}`), ...fonts.map(f => `assets/fonts/${f}`));
  list.push('assets/img/icon.svg', 'assets/img/icon-192.png', 'assets/img/icon-512.png', 'assets/img/icon-maskable-512.png', 'assets/img/apple-touch-icon.png');
  return list;
}

export async function precacheBlock() {
  const files = await runtimeFiles();
  const hash = createHash('sha256');
  for (const f of files) {
    hash.update(f);
    hash.update(await readFile(join(ROOT, f)));
  }
  const version = `${APP_VERSION}-${hash.digest('hex').slice(0, 10)}`;
  const urls = ['/', ...files.map(f => `/${f}`)];
  return `// <precache>\nconst VERSION = '${version}';\nconst PRECACHE = [\n${urls.map(u => `  '${u}',`).join('\n')}\n];\n// </precache>`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const swPath = join(ROOT, 'sw.js');
  const sw = await readFile(swPath, 'utf8');
  const block = await precacheBlock();
  const next = sw.replace(/\/\/ <precache>[\s\S]*?\/\/ <\/precache>/, block);
  if (process.argv.includes('--check')) {
    if (next !== sw) {
      console.error('sw.js precache block is stale — run: node tools/stamp-sw.mjs');
      process.exit(1);
    }
    console.log('sw.js precache block is current');
  } else {
    await writeFile(swPath, next);
    console.log(block.split('\n')[1]);
  }
}
