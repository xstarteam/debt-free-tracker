#!/usr/bin/env node
/**
 * Regenerate every binary asset from source: app icons, favicon, the social
 * preview image and the PWA install screenshots.
 *
 *   node tools/make-assets.mjs            # all
 *   node tools/make-assets.mjs icons og   # some
 *
 * Needs Playwright with Chromium (dev-only; the app itself has zero deps):
 *   npm i -g playwright && npx playwright install chromium
 * or point PLAYWRIGHT_MODULE at an existing install.
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMG = join(ROOT, 'assets/img');
let playwright;
try {
  playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
} catch {
  console.error('Playwright not found. Install it (npm i -g playwright) or set PLAYWRIGHT_MODULE.');
  process.exit(1);
}

/* ---------- the mark: progress ring closing on a check ---------- */
const MARK = `
  <path d="M32 15A17 17 0 1 1 16.03 26.19" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
  <path d="M24.5 32.5l5 5L40 26" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="16.03" cy="26.19" r="3.6" fill="#fcd34d"/>`;
const GRAD = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#10b981"/><stop offset="1" stop-color="#065f46"/></linearGradient></defs>';
const iconSvg = ({ rounded = true, scale = 1 } = {}) => {
  const t = scale === 1 ? '' : ` transform="translate(${32 - 32 * scale} ${32 - 32 * scale}) scale(${scale})"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${GRAD}<rect width="64" height="64"${rounded ? ' rx="16"' : ''} fill="url(#g)"/><g${t}>${MARK}</g></svg>`;
};

/* ---------- tiny static server for the app + fonts ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function serve() {
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = join(ROOT, p);
    try {
      if (!file.startsWith(ROOT) || !(await stat(file)).isFile()) throw new Error('nf');
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

/** ICO container holding PNG images (supported by every current browser). */
function ico(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([head, dir, ...images.map(x => x.png)]);
}

async function renderSvg(page, svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div></body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

async function icons(browser) {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await writeFile(join(IMG, 'icon.svg'), `${iconSvg()}\n`);
  await writeFile(join(IMG, 'icon-192.png'), await renderSvg(page, iconSvg(), 192));
  await writeFile(join(IMG, 'icon-512.png'), await renderSvg(page, iconSvg(), 512));
  await writeFile(join(IMG, 'icon-maskable-512.png'), await renderSvg(page, iconSvg({ rounded: false, scale: 0.86 }), 512));
  await writeFile(join(IMG, 'apple-touch-icon.png'), await renderSvg(page, iconSvg({ rounded: false }), 180));
  const sizes = [16, 32, 48];
  const pngs = [];
  for (const size of sizes) pngs.push({ size, png: await renderSvg(page, iconSvg(), size) });
  await writeFile(join(ROOT, 'favicon.ico'), ico(pngs));
  await page.close();
  console.log('icons: icon.svg, icon-192/512, icon-maskable-512, apple-touch-icon, favicon.ico');
}

async function og(browser, base) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const font = w => `@font-face{font-family:P;font-weight:${w};src:url(${base}/assets/fonts/plex-arabic-arabic-${w}.woff2) format("woff2");unicode-range:U+0600-06FF,U+FB50-FDFF,U+FE70-FEFC}@font-face{font-family:P;font-weight:${w};src:url(${base}/assets/fonts/plex-arabic-latin-${w}.woff2) format("woff2");unicode-range:U+0000-00FF,U+2000-206F}`;
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
${font(400)}${font(600)}${font(700)}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;font-family:P,sans-serif;color:#f1f5f9;
 background:radial-gradient(760px 460px at 92% -10%,rgba(16,185,129,.34),transparent 62%),radial-gradient(700px 420px at 0% 115%,rgba(59,130,246,.24),transparent 60%),linear-gradient(180deg,#071226,#060b16);}
.dots{position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.08) 1px,transparent 1px);background-size:22px 22px;-webkit-mask-image:linear-gradient(to bottom,rgba(0,0,0,.7),transparent 85%)}
.wrap{position:relative;display:flex;align-items:center;justify-content:space-between;gap:48px;height:100%;padding:0 72px}
.brand{display:flex;align-items:center;gap:18px}
.brand svg{width:84px;height:84px;border-radius:22px;box-shadow:0 14px 34px -12px rgba(16,185,129,.8)}
.brand b{font-size:52px;font-weight:700;line-height:1.1}
h1{font-size:46px;font-weight:700;line-height:1.3;margin:34px 0 22px;max-width:560px}
.chips{display:flex;flex-wrap:wrap;gap:10px;max-width:560px}
.chips span{padding:8px 16px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);font-size:21px;font-weight:400;color:rgba(241,245,249,.85)}
.card{flex:none;width:400px;padding:30px;border-radius:30px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(8px)}
.eyebrow{font-size:20px;color:rgba(241,245,249,.7)}
.date{font-size:76px;font-weight:700;line-height:1.1;margin:8px 0 6px;background:linear-gradient(120deg,#fde68a,#f5c66b 45%,#e9a23b);-webkit-background-clip:text;color:transparent}
.sub{font-size:20px;color:rgba(241,245,249,.7)}
.row{display:flex;align-items:center;gap:18px;margin-top:22px}
.ring{position:relative;width:96px;height:96px}.ring svg{width:100%;height:100%}.ring span{position:absolute;inset:0;display:grid;place-items:center;font-size:26px;font-weight:700}
.lines{flex:1;display:grid;gap:10px}
.line{height:10px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden}
.line i{display:block;height:100%;border-radius:99px;background:linear-gradient(270deg,#34d399,#f5c66b);margin-inline-start:auto}
.foot{position:absolute;bottom:26px;left:72px;right:72px;display:flex;justify-content:space-between;font-size:18px;color:rgba(241,245,249,.55)}
</style></head><body><div class="dots"></div><div class="wrap">
<div>
 <div class="brand">${iconSvg()}<b>محرر الديون</b></div>
 <h1>اعرف بالضبط متى تتحرر من ديونك</h1>
 <div class="chips"><span>كرة الثلج أو الانهيار الجليدي</span><span>بدون حسابات</span><span>يعمل بدون إنترنت</span><span>بياناتك على جهازك</span></div>
</div>
<div class="card">
 <div class="eyebrow">تاريخ تحررك من الديون</div>
 <div class="date">مايو 2029</div>
 <div class="sub">بعد سنتين و7 أشهر</div>
 <div class="row">
  <div class="ring"><svg viewBox="0 0 112 112"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#f5c66b"/></linearGradient></defs><circle cx="56" cy="56" r="46" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="11"/><circle cx="56" cy="56" r="46" fill="none" stroke="url(#rg)" stroke-width="11" stroke-linecap="round" stroke-dasharray="${(2 * Math.PI * 46 * 0.42).toFixed(1)} 400" transform="rotate(-90 56 56)"/></svg><span>42%</span></div>
  <div class="lines"><div class="line"><i style="width:82%"></i></div><div class="line"><i style="width:55%"></i></div><div class="line"><i style="width:31%"></i></div></div>
 </div>
</div>
</div>
<div class="foot"><span dir="ltr">X Star Software · @xstar.kw</span><span dir="ltr">debt-free-tracker-phi.vercel.app</span></div>
</body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(IMG, 'og-image.png') });
  await page.close();
  console.log('og: assets/img/og-image.png (1200x630)');
}

async function screenshots(browser, base) {
  const shots = [
    { file: 'screenshot-narrow.png', viewport: { width: 390, height: 844 }, scale: 2 },
    { file: 'screenshot-wide.png', viewport: { width: 1280, height: 800 }, scale: 1 },
  ];
  for (const s of shots) {
    const ctx = await browser.newContext({ viewport: s.viewport, deviceScaleFactor: s.scale, colorScheme: 'dark', serviceWorkers: 'block', locale: 'ar-KW' });
    const page = await ctx.newPage();
    await page.goto(`${base}/`);
    await page.click('.hero-ctas .btn-hero-ghost');
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
      document.getElementById('demo-banner').hidden = true;
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(IMG, s.file) });
    await ctx.close();
    console.log(`screenshot: assets/img/${s.file}`);
  }
}

const want = new Set(process.argv.slice(2));
const all = want.size === 0;
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch();
try {
  if (all || want.has('icons')) await icons(browser);
  if (all || want.has('og')) await og(browser, base);
  if (all || want.has('screenshots')) await screenshots(browser, base);
} finally {
  await browser.close();
  server.close();
}
await readFile(join(IMG, 'icon.svg')); // sanity: the mark exists
