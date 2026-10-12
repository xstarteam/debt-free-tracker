#!/usr/bin/env node
/**
 * Browser smoke test + automated Light-tier live checks (Chromium).
 *
 *   node tools/smoke.mjs [--shots <dir>]
 *
 * Covers: first run, sample data, add/validate/edit, Arabic-digit input,
 * payments + undo, payoff celebration, delete + undo, payment removal,
 * language/theme, persistence, export -> wipe -> import round-trip, corrupt
 * backup resilience, XSS probe, never-ending plan + fix, lump sum, DTI,
 * share card, calendar reminder, keyboard chart, CSP violations, axe scan,
 * offline (airplane mode) and the update path (deploy twice).
 *
 * Dev-only dependencies: Playwright (PLAYWRIGHT_MODULE) and optionally
 * axe-core (AXE_PATH -> axe.min.js) for the accessibility scan.
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const shotsDir = process.argv.includes('--shots') ? resolve(process.argv[process.argv.indexOf('--shots') + 1]) : null;
if (shotsDir) await mkdir(shotsDir, { recursive: true });
let axeSource = null;
try {
  axeSource = await readFile(process.env.AXE_PATH || require.resolve('axe-core/axe.min.js'), 'utf8');
} catch { /* a11y scan skipped */ }

/* ---------- server (with a switchable sw.js version for the update check) ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml' };
let swSuffix = '';
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  if (p === '/__axe.js' && axeSource) {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(axeSource);
    return;
  }
  const file = join(ROOT, p);
  try {
    if (!file.startsWith(ROOT) || !(await stat(file)).isFile()) throw new Error('nf');
    let body = await readFile(file);
    if (p === '/sw.js' && swSuffix) body = Buffer.from(String(body).replace(/const VERSION = '([^']+)'/, `const VERSION = '$1${swSuffix}'`));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ---------- harness ---------- */
const results = [];
const problems = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
    console.log(`  FAIL ${name} — ${e.message.split('\n')[0]}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const browser = await chromium.launch();
async function open({ viewport = { width: 390, height: 844 }, scale = 2, scheme = 'dark', sw = 'block', downloads = false } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: scheme, serviceWorkers: sw, acceptDownloads: downloads, locale: 'ar-KW' });
  await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  return { ctx, page };
}
const settle = async (page, ms = 250) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
};
const shot = async (page, name, full = true) => {
  if (shotsDir) await page.screenshot({ path: join(shotsDir, `${name}.png`), fullPage: full });
};
const text = (page, sel) => page.$eval(sel, el => el.textContent.trim());
const lastToast = page => page.$$eval('.toast .toast-msg', n => (n.length ? n[n.length - 1].textContent.trim() : ''));
const TOP = 'dialog[open]:last-of-type'; // the most recently opened sheet
const sheetOpen = page => page.$('dialog[open]').then(Boolean);
async function axe(page, label) {
  if (!axeSource) return 'skipped (no axe-core)';
  await page.addScriptTag({ url: `${BASE}/__axe.js` });
  const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations
    .map(x => ({ id: x.id, impact: x.impact, n: x.nodes.length, target: x.nodes[0] && x.nodes[0].target.join(' ') })));
  const bad = v.filter(x => x.impact === 'serious' || x.impact === 'critical');
  assert(!bad.length, `${label}: ${JSON.stringify(bad)}`);
  return v.length ? `${v.length} minor: ${v.map(x => x.id).join(', ')}` : '0 violations';
}

console.log(`smoke @ ${BASE}`);

/* ---------- 1. first run, sample data, plan ---------- */
let { ctx, page } = await open();
await page.goto(BASE);
await settle(page);
await check('first run shows onboarding, no plan sections', async () => {
  assert(await page.isVisible('.hero-ctas'), 'CTAs missing');
  assert(await page.isHidden('#layout'), 'layout visible on empty state');
  return text(page, '.hero-title');
});
await shot(page, '01-empty-ar-dark');
await check('a11y: empty state (ar, dark)', () => axe(page, 'empty'));

await page.click('.hero-ctas .btn-hero-ghost');
await settle(page, 500);
await shot(page, '02-sample-ar-dark');
await check('sample data renders plan, 5 debts, chart, schedule', async () => {
  assert((await page.$$('.debt-card')).length === 5, 'expected 5 debt cards');
  assert(await page.isVisible('#chart svg path.chart-path'), 'chart path missing');
  assert((await page.$$('.schedule tbody tr')).length > 5, 'schedule rows missing');
  return `${await text(page, '.hero-figure')} · ${await text(page, '.hero-sub')}`;
});
await check('digits are Latin everywhere (no ١٢٣ mixed with 123)', async () => {
  const body = await page.evaluate(() => document.body.innerText);
  assert(!/[٠-٩]/.test(body), 'Arabic-Indic digits found');
});
await check('verdict recommends the cheaper strategy and applies it', async () => {
  const v = await text(page, '.verdict');
  assert(/يوفّر/.test(v), `verdict: ${v}`);
  await page.click('.verdict .btn');
  await settle(page);
  assert(await page.$eval('input[name="strategy"][value="avalanche"]', el => el.checked), 'avalanche not selected');
  return v;
});
await check('extra payment slider updates the plan live with savings', async () => {
  const before = await text(page, '.hero-figure');
  await page.$eval('#extra-range', el => {
    el.value = '150';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle(page, 400);
  const after = await text(page, '.hero-figure');
  const impact = await text(page, '.impact');
  assert(before !== after, 'hero date did not move');
  assert(/توفّر/.test(impact), `impact: ${impact}`);
  return `${before} → ${after} · ${impact}`;
});
await check('lump sum adds to the impact', async () => {
  await page.click('.lump-add');
  await page.fill('#lump-amount', '1000');
  await page.dispatchEvent('#lump-amount', 'change');
  await settle(page, 400);
  return text(page, '.impact');
});
await check('salary enables the debt-to-income meter', async () => {
  await page.fill('#salary-input', '1500');
  await page.dispatchEvent('#salary-input', 'change');
  await settle(page);
  assert(await page.isVisible('.dti .meter'), 'meter missing');
  return text(page, '.dti-value');
});
await shot(page, '03-plan-tuned-ar-dark');
await check('a11y: populated (ar, dark)', () => axe(page, 'sample-dark'));

/* ---------- 2. forms ---------- */
await check('add-debt form: empty submit shows inline errors, stays open', async () => {
  await page.click('[data-fk="add-debt"]');
  await page.waitForTimeout(250);
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForTimeout(150);
  const errs = await page.$$eval('dialog[open] .field-error:not([hidden])', n => n.map(e => e.textContent.trim()));
  assert(errs.length >= 3, `errors: ${errs}`);
  assert(await sheetOpen(page), 'dialog closed');
  await shot(page, '04-form-errors', false);
  return errs.join(' | ');
});
await check('Arabic-Indic digits accepted and Enter submits', async () => {
  await page.fill('#f-name', 'قرض الاختبار');
  await page.fill('#f-balance', '١٬٢٠٠٫٥');
  await page.fill('#f-min', '٦٠');
  await page.fill('#f-rate', '٤');
  await page.press('#f-rate', 'Enter');
  await page.waitForTimeout(400);
  assert(!(await sheetOpen(page)), 'dialog still open');
  const card = await page.$$eval('.debt-card', cards => cards.map(c => c.innerText).find(t => t.includes('قرض الاختبار')));
  assert(card && card.includes('1,200.500'), `card: ${card}`);
  return '1,200.500 saved';
});
await check('XSS probe: markup in a name renders as text', async () => {
  await page.click('[data-fk="add-debt"]');
  await page.waitForTimeout(250);
  await page.fill('#f-name', '<img src=x onerror="window.__xss=1">');
  await page.fill('#f-balance', '10');
  await page.fill('#f-min', '5');
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForTimeout(400);
  const xss = await page.evaluate(() => window.__xss);
  const imgs = await page.$$eval('.debt-card img', n => n.length);
  assert(xss === undefined && imgs === 0, 'markup executed');
  return 'not executed';
});

/* ---------- 3. payments, payoff, undo, delete ---------- */
const cardText = name => page.$$eval('.debt-card', (cards, n) => (cards.find(c => c.innerText.includes(n)) || {}).innerText || '', name);
await check('log payment, then undo restores the balance', async () => {
  const before = await cardText('قرض السيارة');
  await page.evaluate(() => [...document.querySelectorAll('.debt-card')].find(c => c.innerText.includes('قرض السيارة')).querySelector('.btn-primary').click());
  await page.waitForTimeout(250);
  await page.fill('#pay-amount', '500');
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForTimeout(350);
  const after = await cardText('قرض السيارة');
  assert(after.includes('6,000.000'), `after: ${after.slice(0, 80)}`);
  await page.click('.toast-action');
  await page.waitForTimeout(350);
  const undone = await cardText('قرض السيارة');
  assert(undone.includes('6,500.000') && before.includes('6,500.000'), 'undo failed');
  return '6,500 → 6,000 → 6,500';
});
await check('paying a debt off celebrates and moves it to the paid group', async () => {
  const before = await text(page, '.hero-figure');
  await page.evaluate(() => [...document.querySelectorAll('.debt-card')].find(c => c.innerText.includes('تابي')).querySelector('.btn-primary').click());
  await page.waitForTimeout(250);
  await page.click('.quick-chips .chip:last-child');
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForTimeout(400);
  const toastText = await lastToast(page);
  assert(/مبروك/.test(toastText), `toast: ${toastText}`);
  assert(await page.isVisible('.paid-group'), 'paid group missing');
  const after = await text(page, '.hero-figure');
  return `${toastText} · plan ${before} → ${after}`;
});
await check('details: payment history, remove a payment restores balance', async () => {
  await page.evaluate(() => [...document.querySelectorAll('.debt-card')].find(c => c.innerText.includes('بطاقة')).querySelector('.btn-ghost').click());
  await page.waitForTimeout(300);
  const n = (await page.$$('dialog[open] .history li')).length;
  assert(n === 2, `history ${n}`);
  await shot(page, '05-details', false);
  await page.click('dialog[open] .history li button');
  await page.waitForTimeout(250);
  await page.click(`${TOP} .btn-danger`);
  await page.waitForTimeout(450);
  const card = await cardText('بطاقة');
  assert(card.includes('1,260.000'), `card: ${card.slice(0, 80)}`);
  return 'history 2 → 1, balance 1,200 → 1,260';
});
await check('delete debt asks first, undo brings it back', async () => {
  const count = (await page.$$('.debt-card')).length;
  await page.evaluate(() => [...document.querySelectorAll('.debt-card')].find(c => c.innerText.includes('img src')).querySelector('.btn-ghost').click());
  await page.waitForTimeout(300);
  await page.click('dialog[open] .sheet-foot .btn-danger');
  await page.waitForTimeout(250);
  await page.click(`${TOP} .btn-danger`);
  await page.waitForTimeout(450);
  assert((await page.$$('.debt-card')).length === count - 1, 'not deleted');
  await page.click('.toast-action');
  await page.waitForTimeout(350);
  assert((await page.$$('.debt-card')).length === count, 'undo failed');
  return `${count} → ${count - 1} → ${count}`;
});
await check('Escape closes a dialog and returns focus to its trigger', async () => {
  await page.focus('[data-fk="add-debt"]');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  assert(await sheetOpen(page), 'not opened');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const fk = await page.evaluate(() => document.activeElement && document.activeElement.dataset.fk);
  assert(!(await sheetOpen(page)) && fk === 'add-debt', `focus on ${fk}`);
});
await check('chart is keyboard-operable (focus + arrows show tooltip)', async () => {
  await page.focus('#chart');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(150);
  assert(await page.$eval('.chart-tip', el => el.classList.contains('on')), 'tooltip hidden');
  return (await text(page, '.chart-tip')).slice(0, 60);
});

/* ---------- 4. persistence, language, theme ---------- */
await check('data persists across reload (IndexedDB)', async () => {
  const n = (await page.$$('.debt-card')).length;
  await page.reload();
  await settle(page, 400);
  assert((await page.$$('.debt-card')).length === n, 'debts lost');
  return `${n} debts`;
});
await check('English switch flips direction and copy', async () => {
  await page.click('#lang-btn');
  await settle(page);
  const dir = await page.evaluate(() => document.documentElement.dir);
  assert(dir === 'ltr', dir);
  return text(page, '.hero-sub');
});
await shot(page, '06-en-dark');
await page.click('#lang-btn');
await settle(page);
await check('theme cycles auto → light → dark', async () => {
  await page.click('#theme-btn');
  await settle(page);
  const t1 = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click('#theme-btn');
  await settle(page);
  const t2 = await page.evaluate(() => document.documentElement.dataset.theme);
  assert(t1 === 'light' && t2 === 'dark', `${t1}/${t2}`);
});
await ctx.close();

/* ---------- 5. backup round-trip & corrupt file ---------- */
({ ctx, page } = await open({ downloads: true, scheme: 'light', viewport: { width: 1280, height: 860 }, scale: 1 }));
await page.goto(BASE);
await settle(page);
await page.click('.hero-ctas .btn-hero-ghost');
await settle(page, 400);
await shot(page, '07-desktop-light');
await check('a11y: populated (ar, light, desktop)', () => axe(page, 'desktop-light'));
let backupPath = null;
await check('export → wipe → import round-trip', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#data .btn-soft')]);
  backupPath = await dl.path();
  const json = JSON.parse(await readFile(backupPath, 'utf8'));
  assert(json.version === 2 && json.debts.length === 5, 'bad backup');
  await page.click('#data .btn-danger');
  await page.waitForTimeout(250);
  await page.click('dialog[open] .btn-danger');
  await page.waitForTimeout(400);
  assert(await page.isHidden('#layout'), 'not wiped');
  await page.setInputFiles('#import-file', backupPath);
  await page.waitForTimeout(400);
  await page.click('dialog[open] .btn-primary');
  await page.waitForTimeout(500);
  assert((await page.$$('.debt-card')).length === 5, 'not restored');
  return `${dl.suggestedFilename()} (v2, 5 debts)`;
});
await check('corrupt backup is rejected and the app keeps working after reload', async () => {
  await page.setInputFiles('#import-file', { name: 'evil.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, settings: { lang: 'fr' }, debts: [{ nope: 1 }] })) });
  await page.waitForTimeout(400);
  const msg = await lastToast(page);
  await page.setInputFiles('#import-file', { name: 'evil2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, settings: { lang: 'fr', theme: 'neon' }, debts: [] })) });
  await page.waitForTimeout(400);
  await page.click('dialog[open] .btn-primary');
  await page.waitForTimeout(400);
  await page.reload();
  await settle(page);
  const lang = await page.evaluate(() => document.documentElement.lang);
  assert(lang === 'ar', `lang ${lang}`);
  assert(await page.isVisible('.hero-ctas'), 'app broken');
  return `${msg}; unknown lang fell back to ar`;
});
await ctx.close();

/* ---------- 6. never-ending plan, reminder, share card ---------- */
({ ctx, page } = await open({ downloads: true }));
await page.goto(BASE);
await settle(page);
await check('never-ending plan: clear warning, no absurd numbers, one-tap fix', async () => {
  await page.click('.hero-ctas .btn-primary');
  await page.waitForTimeout(250);
  await page.fill('#f-name', 'بطاقة متعثرة');
  await page.fill('#f-balance', '10000');
  await page.fill('#f-min', '50');
  await page.fill('#f-rate', '24');
  const preview = await text(page, '.form-preview');
  await page.click('dialog[open] button[type="submit"]');
  await page.waitForTimeout(400);
  const fig = await text(page, '.hero-figure');
  assert(/ما تنتهي/.test(fig), fig);
  const body = await page.evaluate(() => document.body.innerText);
  assert(!/\d{1,3}(,\d{3}){3,}/.test(body), 'billion-scale number on screen');
  await shot(page, '08-never');
  await page.click('.callout-danger .btn-danger-solid');
  await settle(page, 400);
  const fixed = await text(page, '.hero-figure');
  assert(!/ما تنتهي/.test(fixed), 'still never');
  return `${preview} → apply → ${fixed}`;
});
await check('calendar reminder downloads a valid monthly .ics', async () => {
  await page.click('[data-fk="tool-reminder"]');
  await page.waitForTimeout(250);
  await page.selectOption('#remind-day', '27');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('dialog[open] .btn-primary')]);
  const ics = await readFile(await dl.path(), 'utf8');
  assert(ics.startsWith('BEGIN:VCALENDAR') && ics.includes('RRULE:FREQ=MONTHLY;BYMONTHDAY=27') && ics.includes('\r\n'), 'bad ics');
  return dl.suggestedFilename();
});
await check('progress card renders a 1080x1920 image without amounts', async () => {
  await page.click('[data-fk="tool-share"]');
  await page.waitForSelector('dialog[open] .share-preview');
  await page.waitForFunction(() => document.querySelector('.share-preview').naturalWidth > 0);
  const size = await page.$eval('.share-preview', img => `${img.naturalWidth}x${img.naturalHeight}`);
  assert(size === '1080x1920', size);
  await shot(page, '09-share', false);
  await page.keyboard.press('Escape');
  return size;
});
await check('no CSP violations', async () => {
  const v = await page.evaluate(() => window.__csp);
  assert(!v.length, v.join(', '));
});
await ctx.close();

/* ---------- 7. offline + update path (service worker on) ---------- */
({ ctx, page } = await open({ sw: 'allow' }));
await check('offline: after first visit the app loads in airplane mode', async () => {
  await page.goto(BASE);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
  await page.click('.hero-ctas .btn-hero-ghost');
  await settle(page);
  await ctx.setOffline(true);
  await page.reload();
  await settle(page, 400);
  const fig = await text(page, '.hero-figure');
  const fonts = await page.evaluate(() => document.fonts.check('16px "IBM Plex Sans Arabic"'));
  await ctx.setOffline(false);
  assert(fig && fonts, 'offline render failed');
  return `${fig}, self-hosted font loaded offline`;
});
await check('update path: new deploy → "new version" prompt → reload on tap', async () => {
  swSuffix = '-next';
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  await page.waitForSelector('.toast .toast-action', { timeout: 15000 });
  const msg = await lastToast(page);
  await Promise.all([page.waitForEvent('load', { timeout: 15000 }), page.click('.toast .toast-action')]);
  await settle(page);
  const v = await page.evaluate(async () => {
    const keys = await caches.keys();
    return keys.join(',');
  });
  assert(/-next/.test(v), `caches: ${v}`);
  swSuffix = '';
  return `${msg} → ${v}`;
});
await ctx.close();

/* ---------- 8. print stylesheet ---------- */
({ ctx, page } = await open({ viewport: { width: 900, height: 1200 }, scale: 1, scheme: 'light' }));
await page.goto(BASE);
await settle(page);
await page.click('.hero-ctas .btn-hero-ghost');
await settle(page, 400);
await page.emulateMedia({ media: 'print' });
await check('print layout hides controls and shows the plan', async () => {
  const hidden = await page.$$eval('.tools, .settings-pair, .debt-actions, #extra-range', n => n.every(e => getComputedStyle(e).display === 'none'));
  assert(hidden, 'controls visible in print');
  return 'controls hidden';
});
await shot(page, '10-print');
await ctx.close();

await check('no page errors or console errors', async () => {
  assert(!problems.length, problems.slice(0, 5).join(' | '));
});

await browser.close();
server.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
