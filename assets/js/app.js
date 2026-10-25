/* Debt Free — application shell: state, rendering and interactions. */
import {
  buildPlan, simulate, monthDate, monthKey, monthOffset, targetId, payoffOrder, monthAllocation, dailyCost,
  contractTerms, buyoutCompare,
} from './engine.js';
import {
  CURRENCIES, parseAmount, parseRate, formatMoney, formatCompact, toInputValue, formatRate, localeFor, normalizeDigits,
} from './money.js';
import { translator, LANGS } from './i18n.js';
import { openStore, sanitizeDebt, parseBackup, makeBackup, DEFAULT_SETTINGS, KINDS } from './store.js';
import {
  h, s, put, icon, money, openSheet, confirmSheet, toast, initToasts, setUiStrings, celebrate, download,
} from './ui.js';
import { renderChart } from './chart.js';

// Loaded on first use (story card, calendar file, encrypted backups): smaller first load.
const lazy = {};
const load = name => (lazy[name] ||= import(`./${name}.js`));

const APP_URL = 'debt-free-tracker-phi.vercel.app';
const KIND_ICONS = { card: 'card', personal: 'personal', car: 'car', home: 'home', bnpl: 'bnpl', family: 'family', other: 'other' };
const GUIDES = ['guides/snowball-vs-avalanche.html', 'guides/flat-vs-reducing-rate.html', 'guides/debt-buyout.html'];
const MAX_BACKUP_BYTES = 6_000_000;

const state = {
  store: null,
  debts: [],
  settings: { ...DEFAULT_SETTINGS },
  plan: null,
  now: new Date(),
  scheduleOpen: false,
  printing: false,
  lumpOpen: false,
  installPrompt: null,
  startOffset: 1, // 0: the plan starts this month (its payments aren't logged yet), 1: next month
  month: null,    // this month's logged vs planned payments
};

let t = translator('ar');
const $ = id => document.getElementById(id);
const fmt = () => ({ lang: t.lang, currency: state.settings.currency });
const M = (fils, cls) => money(fils, fmt(), cls);
const ms = fils => formatMoney(fils, fmt());
const decimals = () => (CURRENCIES[state.settings.currency] || CURRENCIES.KWD).decimals;
const dtf = opts => new Intl.DateTimeFormat(localeFor(t.lang), opts);
const monthYear = d => dtf({ month: 'long', year: 'numeric' }).format(d);
// full year on purpose: "29 مايو" / "May 29" would read as a day of the month
const monthShort = d => dtf({ month: 'short', year: 'numeric' }).format(d);
const dayDate = d => dtf({ day: 'numeric', month: 'long', year: 'numeric' }).format(d);
const planDate = m => monthDate(state.now, m - 1 + state.startOffset);
// calendar months from now until plan month m (0 = it falls in this month)
const monthsUntil = m => Math.max(0, m - 1 + state.startOffset);
const untilText = m => (monthsUntil(m) ? t.s.heroIn(t.duration(monthsUntil(m))) : t.s.heroThisMonth);
const monthIndex = d => d.getFullYear() * 12 + d.getMonth();
const indexDate = i => new Date(Math.floor(i / 12), i % 12, 1);
const indexKey = i => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
const keyIndex = key => {
  const m = /^(\d{4})-(\d{2})$/.exec(key || '');
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
};
const currencySymbol = () => (CURRENCIES[state.settings.currency] || CURRENCIES.KWD)[t.lang];
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ */
/* derived data                                                        */
/* ------------------------------------------------------------------ */

const engineDebts = () => state.debts.map(d => ({
  id: d.id, balance: d.balanceFils, minPayment: d.minFils, rate: d.rate, priority: d.priority,
}));

function lumpSum() {
  const { lumpFils, lumpMonth, lumpRepeat } = state.settings;
  if (!lumpFils || !lumpMonth) return null;
  const offset = monthOffset(state.now, lumpMonth); // calendar months from now, next month = 1
  if (offset < 1) return null;
  return { month: offset + 1 - state.startOffset, amount: lumpFils, every: lumpRepeat ? 12 : 0 };
}

/** Payments logged in the current calendar month, per debt and in total. */
function paidThisMonth() {
  const now = monthIndex(state.now);
  const byId = {};
  let total = 0;
  for (const d of state.debts) {
    for (const p of d.payments) {
      if (monthIndex(new Date(p.at)) !== now) continue;
      byId[d.id] = (byId[d.id] || 0) + p.fils;
      total += p.fils;
    }
  }
  return { byId, total };
}

/**
 * Is this month's payment done? Logged payments that reach the monthly budget
 * (minimums + extra), or the user saying their balances already include it.
 * Until then the plan starts this month and only asks for what's left.
 */
function monthStatus() {
  const paid = paidThisMonth();
  const open = state.debts.filter(d => d.balanceFils > 0);
  const budget = (state.settings.rollover ? state.debts : open).reduce((a, d) => a + d.minFils, 0) + state.settings.extraFils;
  const planned = Math.min(budget, paid.total + open.reduce((a, d) => a + d.balanceFils, 0));
  const marked = state.settings.coveredMonth === monthKey(state.now, 0);
  return { paid, planned, marked, covered: marked || (planned > 0 && paid.total >= planned) };
}

function recompute() {
  state.now = new Date();
  state.month = monthStatus();
  state.startOffset = state.month.covered ? 1 : 0;
  state.plan = buildPlan(engineDebts(), {
    strategy: state.settings.strategy,
    extra: state.settings.extraFils,
    rollover: state.settings.rollover,
    lumpSum: lumpSum(),
    firstMonthPaid: state.month.covered ? null : state.month.paid.byId,
  });
}

/** Freedom month (absolute month index) on the current plan, or null. */
function projectedEnd() {
  const cur = state.plan.current;
  return cur.status === 'ok' ? monthIndex(planDate(cur.months)) : null;
}

function totals() {
  const open = state.debts.filter(d => d.balanceFils > 0);
  const balance = open.reduce((a, d) => a + d.balanceFils, 0);
  const original = state.debts.reduce((a, d) => a + Math.max(d.originalFils, d.balanceFils), 0);
  const pct = original ? Math.max(0, Math.min(100, Math.floor((1 - balance / original) * 100))) : 0;
  const minimums = (state.settings.rollover ? state.debts : open).reduce((a, d) => a + d.minFils, 0);
  return { open, balance, original, pct, minimums, all: state.debts.length };
}

const strategyName = key => ({ avalanche: t.s.avalanche, custom: t.s.custom }[key] || t.s.snowball);
const kindLabel = kind => t.s.kinds[kind] || t.s.kinds.other;

/* ------------------------------------------------------------------ */
/* persistence                                                         */
/* ------------------------------------------------------------------ */

async function saveSettings(partial) {
  Object.assign(state.settings, partial);
  try {
    await state.store.putSettings(partial);
  } catch {
    toast(t.s.toastSaveErr, { tone: 'danger' });
  }
}

async function saveDebt(debt) {
  try {
    const id = await state.store.putDebt(debt);
    debt.id = id;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    return true;
  } catch {
    toast(t.s.toastSaveErr, { tone: 'danger' });
    return false;
  }
}

async function replaceAll(debts, settings) {
  try {
    state.debts = await state.store.replaceAll(debts, settings);
    state.settings = { ...settings };
    return true;
  } catch {
    toast(t.s.toastSaveErr, { tone: 'danger' });
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* chrome: language, theme, app bar                                    */
/* ------------------------------------------------------------------ */

const systemDark = matchMedia('(prefers-color-scheme: dark)');
const resolvedTheme = () => (state.settings.theme === 'system' ? (systemDark.matches ? 'dark' : 'light') : state.settings.theme);

function applyChrome() {
  t = translator(state.settings.lang, state.settings.terms);
  setUiStrings({ close: t.s.close, cancel: t.s.cancel, confirm: t.s.confirmTitle });
  const root = document.documentElement;
  root.lang = t.lang;
  root.dir = t.dir;
  root.dataset.theme = resolvedTheme();
  document.title = `${t.s.appName} — ${t.s.appTagline}`;
  try {
    localStorage.setItem('df-prefs', JSON.stringify({ lang: t.lang, theme: state.settings.theme }));
  } catch { /* private mode: cosmetic only */ }

  $('skip-link').textContent = t.s.skip;
  $('brand-name').textContent = t.s.appName;
  $('brand-tag').textContent = t.s.appTagline;
  const lang = $('lang-btn');
  put(lang, icon('languages', { size: 18 }), h('span', { text: t.s.langSwitch }));
  lang.setAttribute('aria-label', t.s.langSwitchAria);
  lang.lang = t.lang === 'ar' ? 'en' : 'ar';
  const th = $('theme-btn');
  const themeIcon = { system: 'auto', light: 'sun', dark: 'moon' }[state.settings.theme];
  put(th, icon(themeIcon, { size: 18 }));
  th.setAttribute('aria-label', `${t.s.themeAria}: ${t.s.themeNames[state.settings.theme]}`);
  th.title = t.s.themeNames[state.settings.theme];
  const inst = $('install-btn');
  inst.hidden = !state.installPrompt;
  put(inst, icon('smartphone', { size: 18 }), h('span', { text: t.s.install }));
  inst.setAttribute('aria-label', t.s.installAria);
}

/* ------------------------------------------------------------------ */
/* hero                                                                */
/* ------------------------------------------------------------------ */

function progressRing(pct) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const svg = s('svg', { viewBox: '0 0 112 112', class: 'ring', 'aria-hidden': 'true' },
    s('defs', {}, s('linearGradient', { id: 'ring-grad', x1: '0', y1: '0', x2: '1', y2: '1' },
      s('stop', { offset: '0', 'stop-color': '#34d399' }), s('stop', { offset: '1', 'stop-color': '#f5c66b' }))),
    s('circle', { cx: 56, cy: 56, r, class: 'ring-track' }),
    pct > 0 ? s('circle', {
      cx: 56, cy: 56, r, class: 'ring-value', 'stroke-dasharray': `${(c * pct) / 100} ${c}`, transform: 'rotate(-90 56 56)',
    }) : null);
  return h('div', { class: 'hero-ring', role: 'img', 'aria-label': t.s.progressLabel(pct) },
    svg,
    h('div', { class: 'ring-center' }, h('b', { text: `${pct}%` }), h('span', { text: t.lang === 'ar' ? 'مسدَّد' : 'paid' })));
}

function stat(label, value, extraCls = '') {
  return h('div', { class: `stat ${extraCls}`.trim() }, h('dt', { text: label }), h('dd', {}, value));
}

function renderHero() {
  const body = $('hero-body');
  const tot = totals();
  if (!state.debts.length) {
    put(body, h('div', { class: 'hero-empty' },
      h('p', { class: 'eyebrow' }, icon('sparkles', { size: 16 }), h('span', { text: t.s.appTagline })),
      h('h2', { class: 'hero-title', text: t.s.heroEmptyTitle }),
      h('p', { class: 'hero-lead', text: t.s.heroEmptySub }),
      h('div', { class: 'hero-ctas' },
        h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => openDebtForm() }, icon('plus'), h('span', { text: t.s.ctaAddFirst })),
        h('button', { type: 'button', class: 'btn btn-hero-ghost btn-lg', onclick: loadSample }, icon('sparkles'), h('span', { text: t.s.ctaSample }))),
      h('ul', { class: 'trust' }, t.s.trust.map((txt, i) => h('li', {}, icon(['lock', 'smartphone', 'shield'][i], { size: 16 }), h('span', { text: txt })))),
    ));
    return;
  }

  const cur = state.plan.current;
  let figure;
  let sub;
  let tone = '';
  if (cur.status === 'done' || tot.balance === 0) {
    figure = t.s.heroDone;
    sub = t.s.heroDoneSub;
    tone = 'is-done';
  } else if (cur.status === 'never') {
    figure = t.s.heroNever;
    sub = t.s.heroNeverSub;
    tone = 'is-never';
  } else {
    figure = monthYear(planDate(cur.months));
    sub = `${untilText(cur.months)} · ${t.s.heroPayments(cur.months)}`;
  }
  const daily = tone === 'is-done' ? 0 : dailyCost(engineDebts());

  const stats = h('dl', { class: 'hero-stats' },
    stat(t.s.statRemaining, M(tot.balance)),
    stat(t.s.statMonthly, M(cur.budget || 0)),
    stat(t.term.projected, cur.status === 'never' ? h('span', { text: '—' }) : M(cur.totalInterest)),
    stat(t.s.statActive, h('span', { text: t.s.statActiveValue(tot.open.length, tot.all) })));

  put(body, 
    h('div', { class: `hero-grid ${tone}`.trim() },
      h('div', { class: 'hero-main' },
        h('p', { class: 'eyebrow' }, icon(tone === 'is-done' ? 'party' : 'flag', { size: 16 }), h('span', { text: t.s.heroEyebrow })),
        h('p', { class: 'hero-figure', text: figure }),
        h('p', { class: 'hero-sub', text: sub }),
        daily > 0 ? h('p', { class: 'hero-cost' }, icon('flame', { size: 16 }), h('span', { text: t.s.dailyCost(ms(daily)) })) : null),
      progressRing(tot.pct)),
    stats,
  );
}

/* ------------------------------------------------------------------ */
/* demo banner & onboarding                                            */
/* ------------------------------------------------------------------ */

function renderDemoBanner() {
  const el = $('demo-banner');
  const show = state.settings.demo && state.debts.some(d => d.demo);
  el.hidden = !show;
  if (!show) return;
  put(el, 
    icon('info', { size: 18 }),
    h('span', { text: t.s.demoBanner }),
    h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: exitDemo, text: t.s.demoExit }),
  );
}

function renderOnboarding() {
  const el = $('onboarding');
  const show = !state.debts.length;
  el.hidden = !show;
  $('layout').hidden = show;
  if (!show) return;
  put(el, h('div', { class: 'card onboarding-card' },
    h('h2', { class: 'card-title', text: t.s.stepsTitle }),
    h('ol', { class: 'steps' }, t.s.steps.map(([title, text], i) => h('li', { class: 'step' },
      h('span', { class: 'step-num', text: String(i + 1) }),
      h('div', {}, h('h3', { text: title }), h('p', { text: text }))))),
    h('div', { class: 'methods' },
      methodCard('snowball', 'snowflake', t.s.snowball, t.s.snowballDesc),
      methodCard('avalanche', 'mountain', t.s.avalanche, t.term.avalancheDesc))));
}

function methodCard(key, ic, title, text) {
  return h('div', { class: `method method-${key}` },
    h('span', { class: `chip-icon series-bg-${key}` }, icon(ic)),
    h('div', {}, h('h3', { text: title }), h('p', { text: text })));
}

/* ------------------------------------------------------------------ */
/* monthly check-in, streak and goal                                   */
/* ------------------------------------------------------------------ */

/** Consecutive months with logged payments, ending this month or last. */
function streak() {
  const months = new Set();
  for (const d of state.debts) for (const p of d.payments) months.add(monthIndex(new Date(p.at)));
  const marked = keyIndex(state.settings.coveredMonth);
  if (marked !== null) months.add(marked);
  let i = monthIndex(state.now);
  if (!months.has(i)) i -= 1;
  let n = 0;
  while (months.has(i) && n < 600) {
    n += 1;
    i -= 1;
  }
  return n;
}

async function setGoal(index) {
  await saveSettings({ goalMonth: indexKey(index), goalSetAt: new Date().toISOString() });
  render();
  toast(t.s.toastGoal);
}

function goalLine() {
  const end = projectedEnd();
  if (end === null) return null;
  const goal = keyIndex(state.settings.goalMonth);
  if (goal === null) {
    return h('button', { type: 'button', class: 'link-btn', 'data-fk': 'goal-set', onclick: () => setGoal(end) },
      icon('target', { size: 16 }), h('span', { text: t.s.goalSetCta(monthYear(indexDate(end))) }));
  }
  const diff = goal - end;
  const level = diff >= 0 ? 'ok' : 'warn';
  const text = diff > 0 ? t.s.goalAhead(t.duration(diff)) : diff < 0 ? t.s.goalBehind(t.duration(-diff)) : t.s.goalOnTrack;
  return h('div', { class: 'goal' },
    h('span', { class: `status status-${level}` }, icon(diff >= 0 ? 'trendingDown' : 'alert', { size: 14 }), text),
    h('span', { class: 'goal-date', text: t.s.goalLabel(monthYear(indexDate(goal))) }),
    diff !== 0 ? h('button', { type: 'button', class: 'link-btn', 'data-fk': 'goal-reset', onclick: () => setGoal(end), text: t.s.goalReset }) : null);
}

function renderCheckin() {
  const el = $('checkin');
  const open = state.debts.filter(d => d.balanceFils > 0);
  el.hidden = !open.length;
  if (!open.length) return;
  const { paid, planned, covered, marked } = state.month;
  const now = monthIndex(state.now);
  const fresh = !paid.total && open.every(d => monthIndex(new Date(d.createdAt)) === now);
  let sub;
  if (covered) sub = marked && !paid.total ? t.s.checkinCoveredDone : t.s.checkinDone;
  else if (paid.total) sub = t.s.checkinProgress(ms(paid.total), ms(planned));
  else sub = t.s.checkinPlanned(ms(planned), open.length);
  const pct = planned ? Math.min(100, Math.floor((paid.total / planned) * 100)) : 0;
  const bar = paid.total && !marked
    ? h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': sub }, h('i'))
    : null;
  if (bar) bar.firstChild.style.setProperty('--p', `${pct}%`);
  const n = streak();
  put(el,
    h('div', { class: 'checkin-main' },
      h('span', { class: `chip-icon${covered ? ' chip-done' : ''}` }, icon(covered ? 'checkCircle' : 'calendarCheck')),
      h('div', { class: 'checkin-text' },
        h('h2', { id: 'checkin-title', text: t.s.checkinTitle(monthYear(state.now)) }),
        h('p', { class: 'card-sub', text: covered ? sub : `${sub} · ${t.s.checkinAsk}` })),
      covered ? null : h('div', { class: 'checkin-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', 'data-fk': 'checkin', onclick: openCheckin },
          icon('calendarCheck', { size: 18 }), h('span', { text: paid.total ? t.s.checkinRest : t.s.checkinBtn })),
        fresh ? h('button', { type: 'button', class: 'link-btn', 'data-fk': 'checkin-covered', onclick: markCovered, text: t.s.checkinCovered }) : null)),
    bar,
    h('div', { class: 'checkin-meta' },
      n >= 2 ? h('span', { class: 'streak' }, icon('trophy', { size: 15 }), h('span', { text: t.s.streak(n) })) : null,
      goalLine()),
  );
}

async function markCovered() {
  await saveSettings({ coveredMonth: monthKey(state.now, 0) });
  render();
}

/** Log every planned payment for this month in one sheet (one undo). */
function openCheckin() {
  const alloc = monthAllocation(engineDebts(), {
    strategy: state.settings.strategy,
    extra: state.settings.extraFils,
    rollover: state.settings.rollover,
    firstMonthPaid: state.month.paid.byId,
  });
  const rank = new Map(payoffOrder(engineDebts(), state.settings.strategy).map((id, i) => [id, i]));
  const open = state.debts.filter(d => d.balanceFils > 0).sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
  const rows = open.map(d => {
    const id = `ci-${d.id}`;
    const input = h('input', {
      type: 'text', id, inputmode: 'decimal', autocomplete: 'off', dir: 'ltr', class: 'input', enterkeyhint: 'next',
      value: toInputValue(Math.min(alloc[d.id] || 0, d.balanceFils)),
    });
    const err = h('p', { class: 'field-error', id: `${id}-err`, hidden: true });
    const row = h('li', { class: 'ci-row' },
      h('span', { class: `kind-chip kind-${d.kind} is-sm` }, icon(KIND_ICONS[d.kind] || 'other', { size: 16 })),
      h('label', { class: 'ci-name', for: id }, h('b', { text: d.name }), h('small', {}, h('span', { text: `${t.s.payBalance}: ` }), M(d.balanceFils))),
      h('div', { class: 'input-group ci-input' }, input, h('span', { class: 'suffix', text: currencySymbol() })),
      err);
    return { d, input, err, row };
  });
  const total = h('p', { class: 'ci-total', 'aria-live': 'polite' });
  const read = () => rows.map(r => ({ r, v: parseAmount(r.input.value, { decimals: decimals() }) }));
  const update = () => {
    const sum = read().reduce((a, { r, v }) => a + (v.ok ? Math.min(v.fils, r.d.balanceFils) : 0), 0);
    put(total, h('span', { text: `${t.s.checkinTotal}: ` }), M(sum));
  };
  rows.forEach(r => r.input.addEventListener('input', () => {
    showFieldError(r.input, r.err, '');
    update();
  }));
  update();
  const formId = 'checkin-form';
  const form = h('form', { id: formId, class: 'form', novalidate: true },
    h('p', { class: 'hint', text: t.s.checkinSheetHint }),
    h('ul', { class: 'ci-list' }, rows.map(r => r.row)),
    total);
  const confirm = h('button', { type: 'submit', form: formId, class: 'btn btn-primary' }, icon('check'), h('span', { text: t.s.checkinConfirm }));
  const cancel = h('button', { type: 'button', class: 'btn btn-ghost', text: t.s.cancel });
  const sheet = openSheet({ title: t.s.checkinTitle(monthYear(state.now)), content: form, actions: [confirm, cancel], focus: rows.length ? rows[0].input : cancel });
  cancel.addEventListener('click', () => sheet.close());
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const pays = [];
    let firstBad = null;
    for (const { r, v } of read()) {
      if (!v.ok && v.error !== 'empty') {
        showFieldError(r.input, r.err, errorText(v.error));
        firstBad = firstBad || r.input;
      } else if (v.ok && v.fils > 0) {
        pays.push({ d: r.d, fils: Math.min(v.fils, r.d.balanceFils) });
      }
    }
    if (firstBad) {
      firstBad.focus();
      return;
    }
    if (!pays.length) {
      toast(t.s.checkinNothing);
      return;
    }
    const before = pays.map(({ d }) => ({ d, snap: { balanceFils: d.balanceFils, paidAt: d.paidAt, payments: d.payments.slice() } }));
    const at = new Date().toISOString();
    const stamp = Date.now().toString(36);
    pays.forEach(({ d, fils }, i) => {
      d.balanceFils -= fils;
      d.payments.push({ id: `p${stamp}${i}`, at, fils });
      if (d.balanceFils === 0) d.paidAt = at;
    });
    try {
      await state.store.putDebts(pays.map(x => x.d));
    } catch {
      before.forEach(({ d, snap }) => Object.assign(d, snap));
      toast(t.s.toastSaveErr, { tone: 'danger' });
      return;
    }
    sheet.close();
    render();
    const cleared = pays.some(x => x.d.balanceFils === 0);
    const allDone = state.debts.every(x => x.balanceFils === 0);
    if (cleared) celebrate($('confetti'), { big: allDone });
    const sum = pays.reduce((a, x) => a + x.fils, 0);
    toast(allDone ? t.s.celebrateAll : t.s.toastCheckin(pays.length, ms(sum)), {
      tone: cleared ? 'success' : '',
      action: t.s.undo,
      onAction: async () => {
        before.forEach(({ d, snap }) => Object.assign(d, snap));
        try {
          await state.store.putDebts(before.map(b => b.d));
        } catch {
          toast(t.s.toastSaveErr, { tone: 'danger' });
        }
        render();
      },
    });
  });
}

/* ------------------------------------------------------------------ */
/* plan card (built once, updated in place so inputs keep focus)       */
/* ------------------------------------------------------------------ */

const plan = {};

function buildPlanCard() {
  const root = $('plan');
  plan.title = h('h2', { id: 'plan-title' });
  plan.strategyLabel = h('p', { class: 'field-label', id: 'strategy-label' });
  plan.options = {};
  const group = h('div', { class: 'strategy', role: 'radiogroup', 'aria-labelledby': 'strategy-label' });
  for (const key of ['snowball', 'avalanche', 'custom']) {
    const input = h('input', { type: 'radio', name: 'strategy', value: key, class: 'sr-only' });
    input.addEventListener('change', () => setStrategy(key));
    const o = {
      input,
      name: h('span', { class: 'strat-name' }),
      desc: h('span', { class: 'strat-desc' }),
      months: h('b', { class: 'strat-months' }),
      cost: h('span', { class: 'strat-cost' }),
      badges: h('span', { class: 'strat-badges' }),
    };
    o.label = h('label', { class: `strat-option strat-${key}` }, input,
      h('span', { class: 'strat-head' }, h('span', { class: `chart-key series-${key}` }), o.name, h('span', { class: 'strat-check' }, icon('checkCircle', { size: 18 }))),
      o.desc,
      h('span', { class: 'strat-result' }, o.months, o.cost),
      o.badges);
    plan.options[key] = o;
    group.append(o.label);
  }
  plan.customHint = h('p', { class: 'hint custom-hint', hidden: true });
  plan.verdict = h('div', { class: 'verdict', 'aria-live': 'polite' });
  plan.never = h('div', { class: 'callout callout-danger', hidden: true });

  // extra payment
  plan.extraLabel = h('label', { class: 'field-label', for: 'extra-input', id: 'extra-label' });
  plan.extraValue = h('output', { class: 'extra-value', for: 'extra-input extra-range' });
  plan.extraRange = h('input', { type: 'range', id: 'extra-range', min: '0', step: '5', 'aria-labelledby': 'extra-label' });
  plan.extraInput = h('input', {
    type: 'text', id: 'extra-input', inputmode: 'decimal', autocomplete: 'off', dir: 'ltr', class: 'input', enterkeyhint: 'done',
  });
  plan.extraSuffix = h('span', { class: 'suffix' });
  plan.extraErr = h('p', { class: 'field-error', id: 'extra-err', hidden: true });
  plan.extraHint = h('p', { class: 'hint' });
  plan.impact = h('p', { class: 'impact', 'aria-live': 'polite' });
  plan.budget = h('p', { class: 'budget-line' });
  plan.extraRange.addEventListener('input', () => {
    const fils = Math.round(Number(plan.extraRange.value) * 1000);
    plan.extraInput.value = toInputValue(fils);
    setExtraLive(fils);
  });
  plan.extraRange.addEventListener('change', () => commitExtra());
  plan.extraInput.addEventListener('input', () => {
    const r = parseAmount(plan.extraInput.value, { decimals: decimals() });
    const ok = r.ok || r.error === 'empty';
    showFieldError(plan.extraInput, plan.extraErr, ok ? '' : errorText(r.error));
    if (ok) setExtraLive(r.ok ? r.fils : 0);
  });
  plan.extraInput.addEventListener('change', () => commitExtra());

  // rollover
  plan.rollInput = h('input', { type: 'checkbox', role: 'switch', id: 'rollover', class: 'switch-input' });
  plan.rollInput.addEventListener('change', async () => {
    await saveSettings({ rollover: plan.rollInput.checked });
    render();
  });
  plan.rollLabel = h('b');
  plan.rollHint = h('small');

  // lump sum
  plan.lump = h('div', { class: 'lump' });

  plan.dti = h('div', { class: 'dti', hidden: true });

  put(root, 
    h('header', { class: 'card-head' }, h('span', { class: 'chip-icon' }, icon('target')), plan.title),
    plan.strategyLabel, group, plan.customHint, plan.verdict, plan.never,
    h('div', { class: 'extra' },
      h('div', { class: 'extra-head' }, plan.extraLabel, plan.extraValue),
      plan.extraRange,
      h('div', { class: 'input-group' }, plan.extraInput, plan.extraSuffix),
      plan.extraErr, plan.extraHint, plan.impact, plan.budget),
    h('label', { class: 'switch-row', for: 'rollover' }, plan.rollInput, h('span', { class: 'switch-ui', 'aria-hidden': 'true' }),
      h('span', { class: 'switch-text' }, plan.rollLabel, plan.rollHint)),
    plan.lump,
    plan.dti,
  );
}

function sliderBounds() {
  // Sensible range: about half the monthly minimums, on a round number.
  const target = Math.max(100, totals().minimums / 2000);
  const extra = state.settings.extraFils / 1000;
  const max = [100, 200, 300, 500, 750, 1000, 2000, 5000, 10000, 50000].find(v => v >= target && v >= extra) || Math.ceil(extra / 1000) * 1000;
  const step = max <= 300 ? 5 : max <= 1000 ? 10 : max <= 5000 ? 50 : 100;
  return { max, step };
}

function setExtraLive(fils) {
  state.settings.extraFils = fils;
  scheduleRender();
}

let extraTimer = null;
function commitExtra() {
  clearTimeout(extraTimer);
  extraTimer = setTimeout(() => saveSettings({ extraFils: state.settings.extraFils }), 200);
}

function updatePlanCard() {
  const p = state.plan;
  const S = p.snowball;
  const A = p.avalanche;
  plan.title.textContent = t.s.planTitle;
  plan.strategyLabel.textContent = t.s.strategyLabel;

  const okBoth = S.status === 'ok' && A.status === 'ok';
  const dInt = S.totalInterest - A.totalInterest;
  const dMon = S.months - A.months;
  const cheaper = okBoth && Math.abs(dInt) >= 500 ? (dInt > 0 ? 'avalanche' : 'snowball') : null;
  const faster = okBoth && dMon !== 0 ? (dMon > 0 ? 'avalanche' : 'snowball') : null;

  for (const key of ['snowball', 'avalanche', 'custom']) {
    const o = plan.options[key];
    const r = p[key]; // custom is only simulated while selected
    o.input.checked = state.settings.strategy === key;
    o.label.classList.toggle('is-selected', o.input.checked);
    o.name.textContent = strategyName(key);
    o.desc.textContent = { avalanche: t.term.avalancheDesc, custom: t.s.customDesc }[key] || t.s.snowballDesc;
    o.months.textContent = r ? (r.status === 'ok' ? t.duration(r.months) : '—') : '';
    put(o.cost, ...(r && r.status === 'ok' ? [h('span', { text: `${t.term.short} ` }), M(r.totalInterest)] : []));
    put(o.badges, 
      faster === key ? h('span', { class: 'badge badge-fast' }, icon('trendingDown', { size: 14 }), t.s.badgeFaster) : null,
      cheaper === key ? h('span', { class: 'badge badge-save' }, icon('piggy', { size: 14 }), t.s.badgeCheaper) : null,
    );
  }

  plan.customHint.hidden = state.settings.strategy !== 'custom';
  plan.customHint.textContent = t.s.customHint;

  // verdict
  if (!okBoth) {
    plan.verdict.hidden = true;
  } else {
    plan.verdict.hidden = false;
    let text;
    const best = cheaper || faster;
    if (cheaper) {
      text = t.s.verdictSave(strategyName(cheaper), ms(Math.abs(dInt)));
      if (faster === cheaper) text += t.s.verdictFaster(t.duration(Math.abs(dMon)));
      else if (!faster) text += t.s.verdictSameTime;
      else text += t.s.verdictOtherFaster(strategyName(faster), t.duration(Math.abs(dMon)));
      text += '.';
    } else if (faster) {
      text = t.s.verdictOnlyFaster(strategyName(faster), t.duration(Math.abs(dMon)));
    } else {
      text = t.s.verdictEqual;
    }
    const kids = [icon('sparkles', { size: 18 }), h('span', { text })];
    if (best && best !== state.settings.strategy) {
      kids.push(h('button', { type: 'button', class: 'btn btn-sm btn-soft', onclick: () => setStrategy(best), text: t.s.verdictApply(strategyName(best)) }));
    }
    put(plan.verdict, ...kids);
  }

  // never-ending plan
  const cur = p.current;
  plan.never.hidden = cur.status !== 'never';
  if (cur.status === 'never') {
    const unit = 1000;
    const need = Math.ceil(p.minExtra / unit) * unit;
    const need5 = Math.ceil(p.minExtra5y / unit) * unit;
    const apply = fils => async () => {
      await saveSettings({ extraFils: fils });
      render();
    };
    put(plan.never,
      icon('alert', { size: 20 }),
      h('div', {},
        h('b', { text: t.s.neverTitle }),
        h('p', { text: t.s.neverBody(ms(need), ms(need5)) }),
        h('div', { class: 'callout-actions' },
          h('button', { type: 'button', class: 'btn btn-sm btn-danger-solid', text: t.s.neverApply5(ms(need5)), onclick: apply(need5) }),
          h('button', { type: 'button', class: 'btn btn-sm btn-ghost', text: t.s.neverApply(ms(need)), onclick: apply(need) }))),
    );
  }

  // extra payment
  const { max, step } = sliderBounds();
  plan.extraLabel.textContent = t.s.extraLabel;
  put(plan.extraValue, M(state.settings.extraFils));
  plan.extraRange.max = String(max);
  plan.extraRange.step = String(step);
  if (document.activeElement !== plan.extraRange) plan.extraRange.value = String(state.settings.extraFils / 1000);
  plan.extraRange.style.setProperty('--fill', `${Math.min(100, (state.settings.extraFils / 1000 / max) * 100)}%`);
  plan.extraRange.setAttribute('aria-valuetext', ms(state.settings.extraFils));
  if (document.activeElement !== plan.extraInput) {
    plan.extraInput.value = toInputValue(state.settings.extraFils);
    showFieldError(plan.extraInput, plan.extraErr, '');
  }
  plan.extraInput.setAttribute('aria-label', t.s.extraLabel);
  plan.extraSuffix.textContent = (CURRENCIES[state.settings.currency] || CURRENCIES.KWD)[t.lang];
  plan.extraHint.textContent = t.s.extraHint;

  const base = p.baseline;
  const boosted = state.settings.extraFils > 0 || !!lumpSum();
  let impact = '';
  if (boosted && cur.status === 'ok') {
    if (base.status === 'never') impact = t.s.extraMakesItEnd(t.duration(cur.months));
    else {
      const savedM = base.months - cur.months;
      const savedI = base.totalInterest - cur.totalInterest;
      if (savedM > 0) impact = t.s.extraImpact(ms(Math.max(0, savedI)), t.duration(savedM));
      else if (savedI > 0) impact = t.s.extraImpactInterest(ms(savedI));
    }
  }
  put(plan.impact, ...(impact ? [icon('trendingDown', { size: 18 }), h('span', { text: impact })] : [h('span', { class: 'muted', text: boosted ? '' : t.s.extraNone })]));
  plan.impact.classList.toggle('is-positive', !!impact);
  const tot = totals();
  put(plan.budget,
    h('b', {}, h('span', { text: `${t.s.statMonthly}: ` }), M(cur.budget || tot.minimums + state.settings.extraFils)),
    h('span', { class: 'budget-breakdown', text: t.s.budgetLine(ms(tot.minimums), ms(state.settings.extraFils)) }),
  );

  plan.rollInput.checked = state.settings.rollover;
  plan.rollLabel.textContent = t.s.rolloverLabel;
  plan.rollHint.textContent = t.s.rolloverHint;

  renderLump();
  renderDti();
}

function renderLump() {
  const el = plan.lump;
  const active = state.settings.lumpFils > 0 || state.lumpOpen;
  if (!active) {
    put(el, h('button', {
      type: 'button',
      class: 'btn btn-ghost btn-block lump-add',
      'data-fk': 'lump-add',
      onclick: () => {
        state.lumpOpen = true;
        renderLump();
        $('lump-amount').focus();
      },
    }, icon('gift'), h('span', { text: t.s.lumpAdd })));
    return;
  }
  if ($('lump-amount') && el.contains(document.activeElement)) return; // keep typing undisturbed
  const amount = h('input', {
    type: 'text', id: 'lump-amount', inputmode: 'decimal', autocomplete: 'off', dir: 'ltr', class: 'input',
    value: state.settings.lumpFils ? toInputValue(state.settings.lumpFils) : '',
  });
  const err = h('p', { class: 'field-error', id: 'lump-err', hidden: true });
  const months = [];
  for (let i = 1; i <= 36; i++) months.push({ key: monthKey(state.now, i), label: monthYear(planDate(i)) });
  const current = state.settings.lumpMonth || months[2].key;
  const expired = state.settings.lumpMonth && monthOffset(state.now, state.settings.lumpMonth) < 1;
  const select = h('select', { id: 'lump-month', class: 'input' }, months.map(m => h('option', { value: m.key, text: m.label, selected: m.key === current })));
  const commit = async () => {
    const r = parseAmount(amount.value, { decimals: decimals() });
    const ok = r.ok || r.error === 'empty';
    showFieldError(amount, err, ok ? '' : errorText(r.error));
    if (!ok) return;
    await saveSettings({ lumpFils: r.ok ? r.fils : 0, lumpMonth: select.value });
    render();
  };
  const repeat = h('input', { type: 'checkbox', id: 'lump-repeat', class: 'check-input', checked: state.settings.lumpRepeat });
  repeat.addEventListener('change', async () => {
    await saveSettings({ lumpRepeat: repeat.checked });
    render();
  });
  amount.addEventListener('change', commit);
  amount.addEventListener('input', () => {
    const r = parseAmount(amount.value, { decimals: decimals() });
    if (r.ok || r.error === 'empty') {
      state.settings.lumpFils = r.ok ? r.fils : 0;
      state.settings.lumpMonth = select.value;
      scheduleRender();
    }
  });
  select.addEventListener('change', commit);
  put(el, 
    h('div', { class: 'lump-head' },
      h('span', { class: 'chip-icon chip-gold' }, icon('gift', { size: 18 })),
      h('div', {}, h('b', { text: t.s.lumpTitle }), h('small', { text: t.s.lumpHint })),
      h('button', {
        type: 'button',
        class: 'btn btn-ghost btn-icon',
        'aria-label': t.s.lumpRemove,
        onclick: async () => {
          state.lumpOpen = false;
          await saveSettings({ lumpFils: 0, lumpMonth: '', lumpRepeat: false });
          render();
        },
      }, icon('x'))),
    h('div', { class: 'lump-fields' },
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'lump-amount', text: t.s.lumpAmount }),
        h('div', { class: 'input-group' }, amount, h('span', { class: 'suffix', text: (CURRENCIES[state.settings.currency] || CURRENCIES.KWD)[t.lang] })), err),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'lump-month', text: t.s.lumpMonth }), select)),
    h('label', { class: 'check-row', for: 'lump-repeat' }, repeat, h('span', {}, icon('repeat', { size: 16 }), h('span', { text: t.s.lumpRepeat }))),
    expired ? h('p', { class: 'field-error', text: t.s.lumpExpired }) : null,
  );
}

function renderDti() {
  const el = plan.dti;
  const income = state.settings.incomeFils;
  const tot = totals();
  if (!tot.open.length) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  if (!income) {
    put(el, h('button', {
      type: 'button',
      class: 'link-btn',
      onclick: () => {
        const input = $('salary-input');
        input.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
        input.focus({ preventScroll: true });
      },
    }, icon('scale', { size: 16 }), h('span', { text: t.s.dtiSetup })));
    return;
  }
  const budget = state.plan.current.budget || tot.minimums;
  const pct = Math.round((budget / income) * 100);
  const level = pct <= 30 ? 'ok' : pct <= 40 ? 'warn' : 'high';
  const bar = h('div', { class: `meter meter-${level}`, role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.min(100, pct)), 'aria-label': t.s.dtiTitle },
    h('i'), h('span', { class: 'meter-cap', 'aria-hidden': 'true' }));
  bar.firstChild.style.setProperty('--p', `${Math.min(100, pct)}%`);
  put(el, 
    h('div', { class: 'dti-head' },
      h('b', { text: t.s.dtiTitle }),
      h('span', { class: `status status-${level}` }, icon(level === 'ok' ? 'checkCircle' : 'alert', { size: 14 }), { ok: t.s.dtiOk, warn: t.s.dtiWarn, high: t.s.dtiHigh }[level])),
    h('p', { class: 'dti-value', text: t.s.dtiValue(pct) }),
    bar,
    h('p', { class: 'hint', text: t.s.dtiNote }),
  );
}

async function setStrategy(key) {
  if (state.settings.strategy === key) return;
  if (key === 'custom' && !(await ensurePriorities())) return;
  await saveSettings({ strategy: key });
  render();
}

/** Save a new custom order (ids, first = paid first); all or nothing. */
async function savePriorities(ids) {
  const changed = [];
  ids.forEach((id, i) => {
    const d = state.debts.find(x => x.id === id);
    if (d && d.priority !== i) changed.push({ d, before: d.priority, after: i });
  });
  if (!changed.length) return true;
  changed.forEach(c => { c.d.priority = c.after; });
  try {
    await state.store.putDebts(changed.map(c => c.d));
    return true;
  } catch {
    changed.forEach(c => {
      if (c.before === undefined) delete c.d.priority;
      else c.d.priority = c.before;
    });
    toast(t.s.toastSaveErr, { tone: 'danger' });
    return false;
  }
}

/** First switch to "my own order": start from the order on screen so nothing jumps. */
async function ensurePriorities() {
  const open = state.debts.filter(d => d.balanceFils > 0);
  if (open.every(d => Number.isInteger(d.priority))) return true;
  const shown = state.plan.current.order.filter(id => open.some(d => d.id === id));
  const rest = open.map(d => d.id).filter(id => !shown.includes(id));
  return savePriorities([...shown, ...rest]);
}

async function moveDebt(id, dir) {
  const ids = payoffOrder(engineDebts(), 'custom');
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  if (!(await savePriorities(ids))) return;
  render();
  // keep focus on the arrow that was pressed (or its sibling once at the edge)
  for (const key of [`${dir < 0 ? 'up' : 'down'}-${id}`, `${dir < 0 ? 'down' : 'up'}-${id}`]) {
    const el = document.querySelector(`[data-fk="${key}"]`);
    if (el && !el.disabled) {
      el.focus();
      break;
    }
  }
  const d = state.debts.find(x => x.id === id);
  toast(t.s.orderMoved(d.name, j + 1), { timeout: 2500 });
}

/* ------------------------------------------------------------------ */
/* debts                                                               */
/* ------------------------------------------------------------------ */

function payoffLabel(id) {
  const m = state.plan.current.payoffMonth[id];
  return m ? t.s.payoffBy(monthYear(planDate(m))) : t.s.payoffNever;
}

function debtCard(d, rank, isTarget, underwater, reorder) {
  const pct = d.originalFils ? Math.max(0, Math.min(100, Math.floor((1 - d.balanceFils / d.originalFils) * 100))) : 0;
  const bar = h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': t.s.paidPct(pct) }, h('i'));
  bar.firstChild.style.setProperty('--p', `${pct}%`);
  const neverPaid = !state.plan.current.payoffMonth[d.id];
  return h('article', { class: `debt-card${isTarget ? ' is-target' : ''}`, 'aria-labelledby': `debt-${d.id}-name` },
    h('div', { class: 'debt-top' },
      h('span', { class: `kind-chip kind-${d.kind}` }, icon(KIND_ICONS[d.kind] || 'other')),
      h('div', { class: 'debt-title' },
        h('h3', { id: `debt-${d.id}-name`, text: d.name }),
        h('span', { class: 'debt-kind', text: kindLabel(d.kind) })),
      rank ? h('span', { class: 'order-badge', title: t.s.orderAria(rank), 'aria-label': t.s.orderAria(rank), text: String(rank) }) : null,
      reorder ? h('div', { class: 'reorder' },
        h('button', {
          type: 'button', class: 'btn btn-ghost btn-icon btn-xs', 'data-fk': `up-${d.id}`, 'aria-label': t.s.moveUp(d.name),
          disabled: reorder.first, onclick: () => moveDebt(d.id, -1),
        }, icon('arrowUp', { size: 16 })),
        h('button', {
          type: 'button', class: 'btn btn-ghost btn-icon btn-xs', 'data-fk': `down-${d.id}`, 'aria-label': t.s.moveDown(d.name),
          disabled: reorder.last, onclick: () => moveDebt(d.id, 1),
        }, icon('arrowDown', { size: 16 }))) : null),
    isTarget ? h('p', { class: 'target-tag' }, icon('target', { size: 14 }), h('span', { text: t.s.target })) : null,
    h('div', { class: 'debt-balance' }, M(d.balanceFils, 'money-lg'),
      d.originalFils > d.balanceFils ? h('span', { class: 'of' }, h('span', { text: t.lang === 'ar' ? 'من ' : 'of ' }), M(d.originalFils)) : null),
    bar,
    h('div', { class: 'debt-meta' },
      h('span', { class: `payoff${neverPaid ? ' is-never' : ''}` }, icon(neverPaid ? 'alert' : 'calendar', { size: 15 }), h('span', { text: payoffLabel(d.id) })),
      h('span', { class: 'pct', text: t.s.paidPct(pct) })),
    h('ul', { class: 'debt-facts' },
      h('li', {}, h('span', { text: t.s.minPay }), M(d.minFils)),
      h('li', {}, h('span', { text: t.term.column }),
        h('b', { text: d.rate > 0 ? formatRate(d.rate, t.lang) : t.term.free }))),
    underwater ? h('p', { class: 'debt-warn' }, icon('alert', { size: 15 }), h('span', { text: t.term.under(ms(underwater.interest)) })) : null,
    h('div', { class: 'debt-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', 'data-fk': `pay-${d.id}`, onclick: () => openPayment(d.id) }, icon('handCoins', { size: 18 }), h('span', { text: t.s.logPayment })),
      h('button', { type: 'button', class: 'btn btn-ghost', 'data-fk': `details-${d.id}`, onclick: () => openDetails(d.id) }, h('span', { text: t.s.details }))),
  );
}

function renderDebts() {
  const el = $('debts');
  const p = state.plan.current;
  const open = state.debts.filter(d => d.balanceFils > 0);
  const paid = state.debts.filter(d => d.balanceFils === 0);
  const custom = state.settings.strategy === 'custom';
  // custom: the user's own order; otherwise the order debts get paid off
  const rankOf = new Map((custom ? payoffOrder(engineDebts(), 'custom') : p.order).map((id, i) => [id, i + 1]));
  const target = targetId(engineDebts(), state.settings.strategy);
  const under = new Map(state.plan.underwater.map(u => [u.id, u]));
  open.sort((a, b) => (rankOf.get(a.id) ?? 1e9) - (rankOf.get(b.id) ?? 1e9));
  const reorderFor = d => (custom ? { first: rankOf.get(d.id) === 1, last: rankOf.get(d.id) === open.length } : null);

  put(el, 
    h('header', { class: 'section-head' },
      h('h2', { id: 'debts-title' }, h('span', { text: t.s.debtsTitle }), h('span', { class: 'count', text: String(open.length) })),
      h('button', { type: 'button', class: 'btn btn-primary', 'data-fk': 'add-debt', onclick: () => openDebtForm() }, icon('plus'), h('span', { text: t.s.addDebt }))),
    h('div', { class: 'debt-grid' }, open.map(d => debtCard(d, rankOf.get(d.id), d.id === target, under.get(d.id), reorderFor(d)))),
    paid.length ? h('details', { class: 'paid-group' },
      h('summary', {}, icon('badgeCheck', { size: 18 }), h('span', { text: t.s.paidOffTitle(paid.length) }), icon('chevronDown', { size: 18, cls: 'chev' })),
      h('ul', {}, paid.map(d => h('li', {},
        h('span', { class: `kind-chip kind-${d.kind} is-sm` }, icon(KIND_ICONS[d.kind] || 'other', { size: 16 })),
        h('div', {}, h('b', { text: d.name }), h('small', { text: t.s.paidOffOn(dayDate(new Date(d.paidAt || d.createdAt))) })),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-fk': `details-${d.id}`, onclick: () => openDetails(d.id), text: t.s.details }))))) : null,
  );
}

/* ------------------------------------------------------------------ */
/* chart, milestones, schedule                                         */
/* ------------------------------------------------------------------ */

function seriesFor(sim, key) {
  const values = [sim.startTotal, ...sim.timeline.map(r => r.balance)];
  const names = new Map(state.debts.map(d => [d.id, d.name]));
  const events = {};
  sim.timeline.forEach((r, i) => {
    if (r.events.length) events[i + 1] = r.events.map(id => t.s.milestone(names.get(id) || ''));
  });
  return { key, label: strategyName(key), values, events };
}

const seriesKeys = () => (state.plan.custom ? ['snowball', 'avalanche', 'custom'] : ['snowball', 'avalanche']);

function renderChartCard() {
  const p = state.plan;
  const head = $('chart-head');
  put(head, 
    h('div', {}, h('h2', { id: 'chart-title', text: t.s.chartTitle }), h('p', { class: 'card-sub', text: state.plan.custom ? t.s.chartSub3 : t.s.chartSub })),
    h('ul', { class: 'legend' }, seriesKeys().map(key => h('li', { class: key === state.settings.strategy ? 'is-selected' : '' },
      h('span', { class: `chart-key series-${key}` }), h('span', { text: strategyName(key) })))),
  );
  const cur = p.current;
  const aria = cur.status === 'ok'
    ? t.s.chartAria(ms(cur.startTotal), t.duration(cur.months), monthYear(planDate(cur.months)))
    : t.s.chartNeverAria;
  const root = $('chart');
  root.setAttribute('aria-label', `${aria} ${t.s.chartHint}`);
  renderChart(root, {
    series: seriesKeys().map(key => seriesFor(p[key], key)),
    selected: state.settings.strategy,
    rtl: t.dir === 'rtl',
    labelAt: i => (i === 0 ? t.s.today : monthYear(planDate(i))),
    tickLabelAt: i => (i === 0 ? t.s.today : monthShort(planDate(i))),
    formatValue: v => ms(v),
    formatTick: v => formatCompact(v, { lang: t.lang }),
    ariaLabel: aria,
  });
  $('chart-hint').textContent = t.s.chartHint;
}

function renderMilestones() {
  const el = $('milestones');
  const cur = state.plan.current;
  const names = new Map(state.debts.map(d => [d.id, d]));
  const items = [];
  cur.timeline.forEach(r => {
    r.events.forEach(id => {
      const d = names.get(id);
      if (d) items.push({ month: r.month, d });
    });
  });
  put(el, 
    h('header', { class: 'card-head' }, h('span', { class: 'chip-icon chip-gold' }, icon('flag')), h('h2', { text: t.s.milestonesTitle })),
    items.length ? h('ol', { class: 'timeline' }, items.map((it, i) => {
      const last = i === items.length - 1 && cur.status === 'ok';
      return h('li', { class: last ? 'is-final' : '' },
        h('span', { class: 'tl-dot', 'aria-hidden': 'true' }, icon(last ? 'party' : 'check', { size: 14 })),
        h('div', { class: 'tl-body' },
          h('b', { text: monthYear(planDate(it.month)) }),
          h('span', { text: last ? `${t.s.milestone(it.d.name)} — ${t.s.milestoneFinal}` : t.s.milestone(it.d.name) }),
          h('small', { text: untilText(it.month) })));
    })) : h('p', { class: 'muted', text: cur.status === 'never' ? t.s.heroNeverSub : '—' }),
  );
}

function renderSchedule() {
  const el = $('schedule');
  const cur = state.plan.current;
  const names = new Map(state.debts.map(d => [d.id, d.name]));
  const rows = cur.timeline;
  const limit = state.scheduleOpen || state.printing ? rows.length : 12;
  const body = h('tbody');
  let year = null;
  rows.forEach((r, i) => {
    const visible = i < limit || r.events.length;
    if (!visible) return;
    const date = planDate(r.month);
    if (date.getFullYear() !== year) {
      year = date.getFullYear();
      body.append(h('tr', { class: 'year-row' }, h('th', { colspan: '4', scope: 'colgroup', text: String(year) })));
    }
    body.append(h('tr', { class: r.events.length ? 'has-event' : '' },
      h('th', { scope: 'row' },
        h('span', { class: 'sch-month', text: dtf({ month: 'long' }).format(date) }),
        r.events.length ? h('span', { class: 'sch-events' }, r.events.map(id => h('span', { class: 'pill' }, icon('check', { size: 12 }), h('span', { text: names.get(id) || '' })))) : null),
      h('td', {}, M(r.paid)),
      h('td', { class: 'col-interest' }, M(r.interest)),
      h('td', {}, M(r.balance))));
  });
  const table = h('table', { class: 'schedule' },
    h('caption', { class: 'sr-only', text: t.s.scheduleTitle }),
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col', text: t.s.thMonth }),
      h('th', { scope: 'col', text: t.s.thPaid }),
      h('th', { scope: 'col', class: 'col-interest', text: t.term.column }),
      h('th', { scope: 'col', text: t.s.thBalance }))),
    body);
  const more = rows.length > 12 ? h('button', {
    type: 'button',
    class: 'btn btn-ghost btn-block no-print',
    'data-fk': 'schedule-toggle',
    'aria-expanded': String(state.scheduleOpen),
    onclick: () => {
      state.scheduleOpen = !state.scheduleOpen;
      renderSchedule();
      const btn = document.querySelector('[data-fk="schedule-toggle"]');
      if (btn) btn.focus();
    },
  }, icon('list', { size: 18 }), h('span', { text: state.scheduleOpen ? t.s.showLess : t.s.showAll(rows.length) })) : null;
  put(el, 
    h('header', { class: 'card-head' }, h('span', { class: 'chip-icon' }, icon('calendar')), h('h2', { id: 'schedule-title', text: t.s.scheduleTitle })),
    h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-labelledby': 'schedule-title' }, table),
    more,
  );
}

/* ------------------------------------------------------------------ */
/* tools                                                               */
/* ------------------------------------------------------------------ */

const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function tool(ic, title, hint, onclick, fk) {
  return h('button', { type: 'button', class: 'tool', onclick, 'data-fk': fk },
    h('span', { class: 'chip-icon' }, icon(ic)),
    h('span', { class: 'tool-text' }, h('b', { text: title }), h('small', { text: hint })));
}

function renderTools() {
  const el = $('tools');
  const has = state.debts.length > 0;
  const tiles = [];
  if (state.debts.some(d => d.balanceFils > 0)) tiles.push(tool('calculator', t.s.buyoutTool, t.s.buyoutHint, openBuyout, 'tool-buyout'));
  if (has) {
    tiles.push(tool('printer', t.s.printPlan, t.s.printHint, () => window.print(), 'tool-print'));
    tiles.push(tool('share', t.s.shareCard, t.s.shareHint, openShareCard, 'tool-share'));
    tiles.push(tool('calendar', t.s.reminder, t.s.reminderHint, openReminder, 'tool-reminder'));
  }
  if (!isStandalone() && (state.installPrompt || isIOS())) {
    tiles.push(tool('smartphone', t.s.installTitle, state.installPrompt ? t.s.installHint : t.s.installIOS, installApp, 'tool-install'));
  }
  el.hidden = !tiles.length;
  put(el, h('h2', { class: 'section-title', text: t.s.toolsTitle }), h('div', { class: 'tools-grid' }, tiles));
}

async function installApp() {
  if (state.installPrompt) {
    state.installPrompt.prompt();
    await state.installPrompt.userChoice.catch(() => {});
    state.installPrompt = null;
    render();
  } else {
    toast(t.s.installIOS, { timeout: 9000 });
  }
}

async function openShareCard() {
  const tot = totals();
  const cur = state.plan.current;
  const done = tot.balance === 0;
  const { makeProgressCard } = await load('share');
  const blob = await makeProgressCard({
    rtl: t.dir === 'rtl',
    appName: t.s.appName,
    title: t.s.shareTitle,
    pct: tot.pct,
    progressText: done ? t.s.shareDone : t.s.shareProgress(tot.pct),
    subText: done ? t.s.heroDoneSub
      : cur.status !== 'ok' ? t.s.appTagline
        : monthsUntil(cur.months) ? t.s.shareRemaining(t.duration(monthsUntil(cur.months))) : t.s.shareLastMonth,
    footer: t.s.shareFooter,
    url: APP_URL,
  });
  if (!blob) return;
  const file = new File([blob], 'debt-free-progress.png', { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  const img = h('img', { src: url, alt: t.s.shareProgress(tot.pct), class: 'share-preview' });
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  const actions = [];
  if (canShare) {
    actions.push(h('button', {
      type: 'button',
      class: 'btn btn-primary',
      onclick: async () => {
        try {
          await navigator.share({ files: [file], title: t.s.shareTitle });
        } catch { /* user cancelled */ }
      },
    }, icon('share'), h('span', { text: t.s.shareCard })));
  }
  actions.push(h('button', {
    type: 'button',
    class: `btn ${canShare ? 'btn-ghost' : 'btn-primary'}`,
    onclick: () => {
      download(blob, 'debt-free-progress.png');
      toast(t.s.toastShared);
    },
  }, icon('download'), h('span', { text: t.s.shareDownload })));
  openSheet({
    title: t.s.shareCard,
    content: [img, h('p', { class: 'hint center', text: t.s.shareHint })],
    actions,
    onClose: () => URL.revokeObjectURL(url),
  });
}

function openReminder() {
  const day = h('select', { id: 'remind-day', class: 'input' },
    Array.from({ length: 28 }, (_, i) => h('option', { value: String(i + 1), text: String(i + 1), selected: i + 1 === state.settings.remindDay })));
  const btn = h('button', { type: 'button', class: 'btn btn-primary' }, icon('download'), h('span', { text: t.s.reminderDownload }));
  const sheet = openSheet({
    title: t.s.reminderTitle,
    size: 'sheet-sm',
    content: [
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'remind-day', text: t.s.reminderDay }), day),
      h('p', { class: 'hint', text: t.s.reminderHint }),
    ],
    actions: [btn],
    focus: day,
  });
  btn.addEventListener('click', async () => {
    const { makeReminderICS } = await load('share');
    const d = Number(day.value);
    await saveSettings({ remindDay: d });
    const lines = state.debts.filter(x => x.balanceFils > 0).map(x => `${x.name}: ${ms(x.minFils)}`);
    const ics = makeReminderICS({ day: d, title: t.s.reminderEventTitle, description: lines.join('\n') });
    download(new Blob([ics], { type: 'text/calendar;charset=utf-8' }), 'debt-free-reminder.ics');
    sheet.close();
    toast(t.s.toastReminder);
  });
}

/** Whole number field (months, installment counts); Arabic-Indic digits accepted. */
function parseWhole(value, { min = 0, max = 600 } = {}) {
  const v = normalizeDigits(value).trim();
  if (!v) return { ok: false, error: 'empty' };
  if (!/^\d+$/.test(v)) return { ok: false, error: 'whole' };
  const n = Number(v);
  return n >= min && n <= max ? { ok: true, n } : { ok: false, error: 'range' };
}

function wholeField({ id, label, value = '' }) {
  const input = h('input', { type: 'text', id, inputmode: 'numeric', autocomplete: 'off', dir: 'ltr', class: 'input', value, enterkeyhint: 'next' });
  const err = h('p', { class: 'field-error', id: `${id}-err`, hidden: true });
  return { input, err, field: h('div', { class: 'field' }, h('label', { class: 'field-label', for: id, text: label }), input, err) };
}

function rateField({ id, label, value = '' }) {
  const input = h('input', { type: 'text', id, inputmode: 'decimal', autocomplete: 'off', dir: 'ltr', class: 'input', value, enterkeyhint: 'next' });
  const err = h('p', { class: 'field-error', id: `${id}-err`, hidden: true });
  return {
    input,
    err,
    field: h('div', { class: 'field' }, h('label', { class: 'field-label', for: id, text: label }),
      h('div', { class: 'input-group' }, input, h('span', { class: 'suffix', text: '%' })), err),
  };
}

function methodPicker(name, initial, onChange) {
  const seg = segmented(name, ['flat', 'reducing'], onChange);
  seg.inputs.flat.label.textContent = t.s.contractFlat;
  seg.inputs.reducing.label.textContent = t.s.contractReducing;
  seg.inputs[initial].input.checked = true;
  const labelId = `${name}-label`;
  seg.group.setAttribute('aria-labelledby', labelId);
  return h('div', { class: 'field' }, h('p', { class: 'field-label', id: labelId, text: t.s.contractMethod }), seg.group);
}

/** Debt buyout / consolidation: current loans vs the bank's offer. */
function openBuyout() {
  const open = state.debts.filter(d => d.balanceFils > 0);
  if (!open.length) {
    toast(t.s.buyoutEmpty);
    return;
  }
  const anyRated = open.some(d => d.rate > 0);
  const picks = open.map(d => {
    const input = h('input', { type: 'checkbox', id: `bo-${d.id}`, class: 'check-input', checked: anyRated ? d.rate > 0 : true });
    input.addEventListener('change', () => update());
    return {
      d,
      input,
      row: h('li', {}, h('label', { class: 'check-row bo-pick', for: `bo-${d.id}` }, input,
        h('span', { class: 'bo-name', text: d.name }),
        h('span', { class: 'bo-meta' }, M(d.balanceFils), h('small', { text: d.rate > 0 ? formatRate(d.rate, t.lang) : t.term.free })))),
    };
  });
  const rate = rateField({ id: 'bo-rate', label: t.term.offerRate, value: '5' });
  const months = wholeField({ id: 'bo-months', label: t.s.buyoutMonths, value: '60' });
  const fees = moneyField({ id: 'bo-fees', label: t.s.buyoutFees, optional: true });
  let method = 'reducing';
  const methodField = methodPicker('bo-method', method, v => {
    method = v;
    update();
  });
  const out = h('div', { class: 'bo-out', 'aria-live': 'polite' });
  [rate.input, months.input, fees.input].forEach(el => el.addEventListener('input', () => update()));

  function update() {
    const chosen = picks.filter(p => p.input.checked).map(p => p.d);
    const r = parseRate(rate.input.value);
    const n = parseWhole(months.input.value, { min: 1, max: 600 });
    const f = parseAmount(fees.input.value, { decimals: decimals() });
    showFieldError(rate.input, rate.err, r.ok ? '' : t.s.errors.rate);
    showFieldError(months.input, months.err, n.ok || n.error === 'empty' ? '' : t.s.errors[n.error === 'whole' ? 'whole' : 'months']);
    showFieldError(fees.input, fees.err, f.ok || f.error === 'empty' ? '' : errorText(f.error));
    if (!chosen.length) {
      put(out, h('p', { class: 'field-error' }, icon('alert', { size: 14 }), h('span', { text: t.s.errors.pickDebt })));
      return;
    }
    if (!r.ok || !n.ok || !(f.ok || f.error === 'empty')) {
      put(out);
      return;
    }
    const res = buyoutCompare(
      chosen.map(d => ({ id: d.id, balance: d.balanceFils, minPayment: d.minFils, rate: d.rate, priority: d.priority })),
      { rate: r.rate, method, months: n.n, fees: f.ok ? f.fils : 0 },
      { strategy: state.settings.strategy },
    );
    if (!res) {
      put(out);
      return;
    }
    const cur = res.current;
    const off = res.offer;
    const ok = cur.status === 'ok';
    const cell = v => (v === null ? h('span', { text: '—' }) : M(v));
    const table = h('table', { class: 'bo-table' },
      h('caption', { class: 'sr-only', text: t.s.buyoutTitle }),
      h('thead', {}, h('tr', {}, h('td'), h('th', { scope: 'col', text: t.s.buyoutCurrent }), h('th', { scope: 'col', text: t.s.buyoutOffer }))),
      h('tbody', {},
        h('tr', {}, h('th', { scope: 'row', text: t.s.buyoutRowInstallment }), h('td', {}, M(cur.installment)), h('td', {}, M(off.installment))),
        h('tr', {}, h('th', { scope: 'row', text: t.s.buyoutRowTerm }), h('td', { text: ok ? t.duration(cur.months) : '—' }), h('td', { text: t.duration(off.months) })),
        h('tr', {}, h('th', { scope: 'row', text: t.term.costRow }), h('td', {}, cell(cur.cost)), h('td', {}, M(off.cost))),
        h('tr', { class: 'bo-total' }, h('th', { scope: 'row', text: t.s.buyoutRowTotal }), h('td', {}, cell(cur.total)), h('td', {}, M(off.total)))));
    let verdict;
    let tone = 'good';
    if (!ok) verdict = t.s.buyoutNever;
    else {
      const saves = res.saving >= 1000;
      const costs = res.saving <= -1000;
      tone = saves ? 'good' : costs ? 'bad' : 'neutral';
      verdict = saves ? t.s.buyoutSaves(ms(res.saving)) : costs ? t.s.buyoutCosts(ms(-res.saving)) : t.s.buyoutSame;
      if (res.monthlyRelief > 0) verdict += t.s.buyoutLower(ms(res.monthlyRelief));
      else if (res.monthlyRelief < 0) verdict += t.s.buyoutHigher(ms(-res.monthlyRelief), saves);
      else verdict += '.';
    }
    put(out,
      h('p', { class: `bo-verdict is-${tone}` }, icon(tone === 'bad' ? 'alert' : 'sparkles', { size: 18 }), h('span', { text: verdict })),
      method === 'flat' && r.rate > 0 ? h('p', { class: 'hint', text: t.s.contractFlatNote(formatRate(r.rate, t.lang), formatRate(off.apr, t.lang)) }) : null,
      h('div', { class: 'table-wrap' }, table),
      h('p', { class: 'hint', text: t.s.buyoutTip }));
  }

  const content = h('div', { class: 'form' },
    h('fieldset', { class: 'bo-debts' }, h('legend', { class: 'field-label', text: t.s.buyoutDebts }), h('ul', {}, picks.map(p => p.row))),
    h('div', { class: 'field-row' }, rate.field, months.field),
    methodField,
    fees.field,
    out,
    h('p', { class: 'hint', text: t.s.buyoutDisclaimer }));
  const done = h('button', { type: 'button', class: 'btn btn-ghost', text: t.s.close });
  const sheet = openSheet({ title: t.s.buyoutTitle, content, actions: [done], focus: rate.input });
  done.addEventListener('click', () => sheet.close());
  update();
}

/* ------------------------------------------------------------------ */
/* settings & data                                                     */
/* ------------------------------------------------------------------ */

const settingsUI = {};

function segmented(name, options, onChange) {
  const group = h('div', { class: 'segmented', role: 'radiogroup' });
  const inputs = {};
  for (const opt of options) {
    const input = h('input', { type: 'radio', name, value: opt, class: 'sr-only', id: `${name}-${opt}` });
    input.addEventListener('change', () => onChange(opt));
    const label = h('label', { for: `${name}-${opt}` });
    inputs[opt] = { input, label };
    group.append(input, label);
  }
  return { group, inputs };
}

function buildSettings() {
  const root = $('settings');
  const ui = settingsUI;
  ui.title = h('h2', { id: 'settings-title' });
  ui.currencyLabel = h('label', { class: 'field-label', for: 'currency-select' });
  ui.currency = h('select', { id: 'currency-select', class: 'input' });
  ui.currency.addEventListener('change', async () => {
    await saveSettings({ currency: ui.currency.value });
    render();
  });
  ui.termsLabel = h('p', { class: 'field-label', id: 'terms-label' });
  ui.terms = segmented('terms', ['interest', 'profit'], async v => {
    await saveSettings({ terms: v });
    render();
  });
  ui.terms.group.setAttribute('aria-labelledby', 'terms-label');
  ui.salaryLabel = h('label', { class: 'field-label', for: 'salary-input' });
  ui.salary = h('input', { type: 'text', id: 'salary-input', inputmode: 'decimal', autocomplete: 'off', dir: 'ltr', class: 'input' });
  ui.salarySuffix = h('span', { class: 'suffix' });
  ui.salaryErr = h('p', { class: 'field-error', id: 'salary-err', hidden: true });
  ui.salaryHint = h('p', { class: 'hint', id: 'salary-hint' });
  ui.salary.setAttribute('aria-describedby', 'salary-hint');
  ui.salary.addEventListener('change', async () => {
    const r = parseAmount(ui.salary.value, { decimals: decimals() });
    const ok = r.ok || r.error === 'empty';
    showFieldError(ui.salary, ui.salaryErr, ok ? '' : errorText(r.error));
    if (!ok) return;
    await saveSettings({ incomeFils: r.ok ? r.fils : 0 });
    render();
  });
  ui.themeLabel = h('p', { class: 'field-label', id: 'theme-label' });
  ui.theme = segmented('theme', ['system', 'light', 'dark'], async v => {
    await saveSettings({ theme: v });
    render();
  });
  ui.theme.group.setAttribute('aria-labelledby', 'theme-label');
  ui.langLabel = h('p', { class: 'field-label', id: 'lang-label' });
  ui.lang = segmented('lang', LANGS, async v => {
    await saveSettings({ lang: v });
    render();
  });
  ui.lang.group.setAttribute('aria-labelledby', 'lang-label');

  put(root, 
    h('header', { class: 'card-head' }, h('span', { class: 'chip-icon' }, icon('scale')), ui.title),
    h('div', { class: 'settings-grid' },
      h('div', { class: 'field' }, ui.currencyLabel, ui.currency),
      h('div', { class: 'field' }, ui.salaryLabel, h('div', { class: 'input-group' }, ui.salary, ui.salarySuffix), ui.salaryErr, ui.salaryHint),
      h('div', { class: 'field' }, ui.termsLabel, ui.terms.group),
      h('div', { class: 'field' }, ui.themeLabel, ui.theme.group),
      h('div', { class: 'field' }, ui.langLabel, ui.lang.group)),
  );

  // data card
  const data = $('data');
  ui.dataTitle = h('h2', { id: 'data-title' });
  ui.privacy = h('p', { class: 'privacy' });
  ui.backupBtn = h('button', { type: 'button', class: 'btn btn-soft', onclick: exportBackup });
  ui.restoreBtn = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => $('import-file').click() });
  ui.backupStatus = h('p', { class: 'backup-status' });
  ui.dangerTitle = h('h3');
  ui.clearBtn = h('button', { type: 'button', class: 'btn btn-danger', onclick: clearAll });
  put(data, 
    h('header', { class: 'card-head' }, h('span', { class: 'chip-icon' }, icon('shield')), ui.dataTitle),
    ui.privacy,
    h('div', { class: 'data-actions' }, ui.backupBtn, ui.restoreBtn),
    ui.backupStatus,
    h('div', { class: 'danger-zone' }, ui.dangerTitle, ui.clearBtn),
  );
}

function updateSettings() {
  const ui = settingsUI;
  ui.title.textContent = t.s.settingsTitle;
  ui.currencyLabel.textContent = t.s.currency;
  put(ui.currency, ...Object.keys(CURRENCIES).map(code => h('option', {
    value: code, text: `${t.s.currencyNames[code]} (${CURRENCIES[code][t.lang]})`, selected: code === state.settings.currency,
  })));
  ui.termsLabel.textContent = t.s.terms;
  ui.terms.inputs.interest.label.textContent = t.s.termsInterest;
  ui.terms.inputs.profit.label.textContent = t.s.termsProfit;
  ui.terms.inputs[state.settings.terms].input.checked = true;
  put(ui.salaryLabel, h('span', { text: t.s.salary }), h('span', { class: 'optional', text: ` (${t.s.fOptional})` }));
  if (document.activeElement !== ui.salary) ui.salary.value = state.settings.incomeFils ? toInputValue(state.settings.incomeFils) : '';
  ui.salarySuffix.textContent = (CURRENCIES[state.settings.currency] || CURRENCIES.KWD)[t.lang];
  ui.salaryHint.textContent = t.s.salaryHint;
  ui.themeLabel.textContent = t.s.appearance;
  for (const k of ['system', 'light', 'dark']) ui.theme.inputs[k].label.textContent = t.s.themeNames[k];
  ui.theme.inputs[state.settings.theme].input.checked = true;
  ui.langLabel.textContent = t.s.language;
  ui.lang.inputs.ar.label.textContent = 'العربية';
  ui.lang.inputs.ar.label.lang = 'ar';
  ui.lang.inputs.en.label.textContent = 'English';
  ui.lang.inputs.en.label.lang = 'en';
  ui.lang.inputs[state.settings.lang].input.checked = true;

  ui.dataTitle.textContent = t.s.dataTitle;
  put(ui.privacy, icon('lock', { size: 16 }), h('span', { text: t.s.dataPrivacy }));
  put(ui.backupBtn, icon('download', { size: 18 }), h('span', { text: t.s.backup }));
  put(ui.restoreBtn, icon('upload', { size: 18 }), h('span', { text: t.s.restore }));
  const last = state.settings.lastBackupAt;
  ui.backupStatus.className = `backup-status${!last && state.debts.length ? ' is-warn' : ''}`;
  put(ui.backupStatus, 
    icon(last ? 'checkCircle' : 'info', { size: 16 }),
    h('span', { text: last ? t.s.lastBackup(dayDate(new Date(last))) : t.s.noBackup }),
  );
  ui.dangerTitle.textContent = t.s.dangerTitle;
  put(ui.clearBtn, icon('trash', { size: 18 }), h('span', { text: t.s.clearAll }));
}

function passphraseField(id, { hint = '', autocomplete = 'new-password' } = {}) {
  const input = h('input', { type: 'password', id, class: 'input', autocomplete, dir: 'auto', spellcheck: 'false' });
  const show = h('button', { type: 'button', class: 'btn btn-ghost btn-icon pass-toggle', 'aria-label': t.s.showPassphrase, 'aria-pressed': 'false', 'aria-controls': id }, icon('eye', { size: 18 }));
  show.addEventListener('click', () => {
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    show.setAttribute('aria-pressed', String(reveal));
    put(show, icon(reveal ? 'eyeOff' : 'eye', { size: 18 }));
    input.focus();
  });
  const err = h('p', { class: 'field-error', id: `${id}-err`, hidden: true });
  const hintEl = hint ? h('p', { class: 'hint', id: `${id}-hint`, text: hint }) : null;
  if (hintEl) input.setAttribute('aria-describedby', hintEl.id);
  const field = h('div', { class: 'field' },
    h('label', { class: 'field-label', for: id, text: t.s.passphrase }),
    h('div', { class: 'pass-group' }, input, show), err, hintEl);
  return { field, input, err };
}

/** Backup: plain JSON, or encrypted with a passphrase where Web Crypto exists. */
async function exportBackup() {
  const { canEncrypt, MIN_PASSPHRASE } = await load('vault');
  if (!canEncrypt()) {
    saveBackupFile(null);
    return;
  }
  const encrypt = h('input', { type: 'checkbox', role: 'switch', id: 'bk-encrypt', class: 'switch-input' });
  const pass = passphraseField('bk-pass', { hint: t.s.passphraseHint(MIN_PASSPHRASE) });
  pass.field.hidden = true;
  encrypt.addEventListener('change', () => {
    pass.field.hidden = !encrypt.checked;
    if (encrypt.checked) pass.input.focus();
  });
  const formId = 'backup-form';
  const save = h('button', { type: 'submit', form: formId, class: 'btn btn-primary' }, icon('download', { size: 18 }), h('span', { text: t.s.backupSave }));
  const cancel = h('button', { type: 'button', class: 'btn btn-ghost', text: t.s.cancel });
  const form = h('form', { id: formId, class: 'form', novalidate: true },
    h('label', { class: 'switch-row', for: 'bk-encrypt' }, encrypt, h('span', { class: 'switch-ui', 'aria-hidden': 'true' }),
      h('span', { class: 'switch-text' }, h('b', {}, icon('keyRound', { size: 16 }), h('span', { text: t.s.backupEncrypt })), h('small', { text: t.s.backupEncryptHint }))),
    pass.field);
  const sheet = openSheet({ title: t.s.backup, content: form, actions: [save, cancel], size: 'sheet-sm', focus: encrypt });
  cancel.addEventListener('click', () => sheet.close());
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const secret = encrypt.checked ? pass.input.value : null;
    if (secret !== null && [...secret].length < MIN_PASSPHRASE) {
      showFieldError(pass.input, pass.err, t.s.errors.passphrase(MIN_PASSPHRASE));
      pass.input.focus();
      return;
    }
    save.disabled = true;
    try {
      await saveBackupFile(secret);
      sheet.close();
    } catch {
      save.disabled = false;
      toast(t.s.toastSaveErr, { tone: 'danger' });
    }
  });
}

async function saveBackupFile(passphrase) {
  let text = makeBackup(state.debts, state.settings);
  if (passphrase) text = await (await load('vault')).encryptBackup(text, passphrase);
  const day = new Date().toISOString().slice(0, 10);
  download(new Blob([text], { type: 'application/json' }), `debt-free-backup-${day}${passphrase ? '-encrypted' : ''}.json`);
  await saveSettings({ lastBackupAt: new Date().toISOString() });
  render();
  toast(passphrase ? t.s.toastExportedEncrypted : t.s.toastExported);
}

/** Ask for the passphrase of an encrypted backup; resolves the plain text or null. */
function askPassphrase(file) {
  return new Promise(resolve => {
    let plain = null;
    const pass = passphraseField('rs-pass', { autocomplete: 'current-password' });
    const formId = 'restore-pass-form';
    const openBtn = h('button', { type: 'submit', form: formId, class: 'btn btn-primary' }, icon('keyRound', { size: 18 }), h('span', { text: t.s.restoreOpen }));
    const cancel = h('button', { type: 'button', class: 'btn btn-ghost', text: t.s.cancel });
    const form = h('form', { id: formId, class: 'form', novalidate: true }, h('p', { class: 'sheet-text', text: t.s.restorePassText }), pass.field);
    const sheet = openSheet({
      title: t.s.restorePassTitle, content: form, actions: [openBtn, cancel], size: 'sheet-sm', focus: pass.input, onClose: () => resolve(plain),
    });
    cancel.addEventListener('click', () => sheet.close());
    form.addEventListener('submit', async e => {
      e.preventDefault();
      openBtn.disabled = true;
      const out = await (await load('vault')).decryptBackup(file, pass.input.value);
      openBtn.disabled = false;
      if (out.ok) {
        plain = out.text;
        sheet.close();
      } else if (out.error === 'format') {
        sheet.close();
        toast(t.s.toastImportErr, { tone: 'danger' });
      } else {
        showFieldError(pass.input, pass.err, t.s.errors.wrongPassphrase);
        pass.input.select();
      }
    });
  });
}

async function importBackup(file) {
  if (file.size > MAX_BACKUP_BYTES) {
    toast(t.s.toastImportErr, { tone: 'danger' });
    return;
  }
  let text = await file.text().catch(() => '');
  let data = null;
  try {
    data = JSON.parse(text);
  } catch { /* parseBackup reports it */ }
  if ((await load('vault')).isEncrypted(data)) {
    text = await askPassphrase(data);
    if (text === null) return; // cancelled, or a damaged file (already reported)
  }
  const parsed = parseBackup(text);
  if (!parsed.ok) {
    toast(t.s.toastImportErr, { tone: 'danger' });
    return;
  }
  const ok = await confirmSheet({ title: t.s.restore, message: t.s.restoreConfirm(parsed.debts.length), confirmLabel: t.s.restoreBtn });
  if (!ok) return;
  const settings = { ...parsed.settings, lastBackupAt: state.settings.lastBackupAt, demo: false };
  if (await replaceAll(parsed.debts, settings)) {
    render();
    toast(t.s.toastImported(parsed.debts.length));
  }
}

async function clearAll() {
  const ok = await confirmSheet({ title: t.s.clearAll, message: t.s.clearConfirm, confirmLabel: t.s.clearBtn, danger: true });
  if (!ok) return;
  const keep = { ...DEFAULT_SETTINGS, lang: state.settings.lang, theme: state.settings.theme, currency: state.settings.currency };
  if (await replaceAll([], keep)) {
    state.lumpOpen = false;
    render();
    toast(t.s.toastCleared);
  }
}

/* ------------------------------------------------------------------ */
/* sample data                                                         */
/* ------------------------------------------------------------------ */

function sampleDebts() {
  const KD = v => Math.round(v * 1000);
  const spec = [
    { bal: 1200, min: 60, rate: 18, orig: 1500, paid: 2 },
    { bal: 6500, min: 180, rate: 5.5, orig: 9000, paid: 3 },
    { bal: 9000, min: 250, rate: 7, orig: 12000, paid: 2 },
    { bal: 300, min: 75, rate: 0, orig: 600, paid: 4 },
    { bal: 400, min: 50, rate: 0, orig: 500, paid: 2 },
  ];
  const now = new Date();
  return spec.map((x, i) => {
    const [name, kind] = t.s.sample[i];
    const payments = Array.from({ length: x.paid }, (_, k) => ({
      id: `s${i}-${k}`,
      at: new Date(now.getFullYear(), now.getMonth() - (x.paid - k), 25, 10).toISOString(),
      fils: KD(x.min),
    }));
    return sanitizeDebt({
      name, kind, balanceFils: KD(x.bal), minFils: KD(x.min), originalFils: KD(x.orig), rate: x.rate,
      createdAt: new Date(now.getFullYear(), now.getMonth() - 6, 1).toISOString(), payments, demo: true,
    });
  });
}

async function loadSample() {
  const settings = {
    ...state.settings, demo: true, strategy: 'snowball', extraFils: 0, lumpFils: 0, lumpMonth: '', lumpRepeat: false, goalMonth: '', coveredMonth: '',
  };
  if (await replaceAll(sampleDebts(), settings)) {
    recompute();
    const end = projectedEnd();
    if (end !== null) await saveSettings({ goalMonth: indexKey(end), goalSetAt: new Date().toISOString() });
    render();
    $('main').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
  }
}

async function exitDemo() {
  const ok = await confirmSheet({ title: t.s.demoExit, message: t.s.demoExitConfirm, confirmLabel: t.s.demoExit });
  if (!ok) return;
  const mine = state.debts.filter(d => !d.demo);
  const settings = {
    ...state.settings, demo: false, extraFils: 0, lumpFils: 0, lumpMonth: '', lumpRepeat: false, goalMonth: '', goalSetAt: '', coveredMonth: '',
  };
  if (await replaceAll(mine, settings)) {
    state.lumpOpen = false;
    render();
  }
}

/* ------------------------------------------------------------------ */
/* forms                                                               */
/* ------------------------------------------------------------------ */

function errorText(code) {
  if (code === 'precision') return t.s.errors.precision(decimals());
  return t.s.errors[code] || t.s.errors.invalid;
}

function showFieldError(input, errEl, message) {
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  input.classList.toggle('is-invalid', !!message);
  if (errEl) {
    errEl.hidden = !message;
    put(errEl, ...(message ? [icon('alert', { size: 14 }), h('span', { text: message })] : []));
    const ids = new Set((input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
    if (message) ids.add(errEl.id);
    else ids.delete(errEl.id);
    if (ids.size) input.setAttribute('aria-describedby', [...ids].join(' '));
    else input.removeAttribute('aria-describedby');
  }
}

function moneyField({ id, label, value = '', optional = false, hint }) {
  const input = h('input', { type: 'text', id, name: id, inputmode: 'decimal', autocomplete: 'off', dir: 'ltr', class: 'input', value, enterkeyhint: 'next' });
  const err = h('p', { class: 'field-error', id: `${id}-err`, hidden: true });
  const hintEl = hint ? h('p', { class: 'hint', id: `${id}-hint`, text: hint }) : null;
  if (hintEl) input.setAttribute('aria-describedby', hintEl.id);
  if (!optional) input.setAttribute('aria-required', 'true');
  const field = h('div', { class: 'field' },
    h('label', { class: 'field-label', for: id }, h('span', { text: label }), optional ? h('span', { class: 'optional', text: ` (${t.s.fOptional})` }) : null),
    h('div', { class: 'input-group' }, input, h('span', { class: 'suffix', text: (CURRENCIES[state.settings.currency] || CURRENCIES.KWD)[t.lang] })),
    err, hintEl);
  return { field, input, err };
}

/**
 * "From your contract": amount financed, rate (flat or reducing), term and
 * installments paid -> installment, remaining balance and the real rate.
 */
function contractPanel(onApply) {
  const toggle = h('button', { type: 'button', class: 'link-btn contract-toggle', 'aria-expanded': 'false', 'aria-controls': 'contract-panel' },
    icon('fileText', { size: 16 }), h('span', { text: t.s.contractToggle }));
  const principal = moneyField({ id: 'c-principal', label: t.s.contractPrincipal });
  const rate = rateField({ id: 'c-rate', label: t.term.contractRate });
  const months = wholeField({ id: 'c-months', label: t.s.contractMonths });
  const paid = wholeField({ id: 'c-paid', label: t.s.contractPaid, value: '0' });
  const result = h('div', { class: 'contract-result', 'aria-live': 'polite' });
  const apply = h('button', { type: 'button', class: 'btn btn-soft', disabled: true }, icon('check', { size: 18 }), h('span', { text: t.s.contractApply }));
  let method = 'flat';

  const compute = (show = false) => {
    const P = parseAmount(principal.input.value, { decimals: decimals(), allowZero: false });
    const r = parseRate(rate.input.value);
    const n = parseWhole(months.input.value, { min: 1, max: 600 });
    const k = parseWhole(paid.input.value || '0', { min: 0, max: 600 });
    const wholeErr = (v, fallback) => (v.error === 'whole' ? t.s.errors.whole : v.error === 'empty' ? t.s.errors.empty : fallback);
    const errs = [
      [principal, P.ok ? '' : errorText(P.error)],
      [rate, r.ok ? '' : t.s.errors.rate],
      [months, n.ok ? '' : wholeErr(n, t.s.errors.months)],
      [paid, !k.ok ? wholeErr(k, t.s.errors.paid) : n.ok && k.n >= n.n ? t.s.errors.paid : ''],
    ];
    for (const [f, msg] of errs) if (show || !msg) showFieldError(f.input, f.err, msg);
    const terms = errs.every(([, msg]) => !msg)
      ? contractTerms({ principal: P.fils, rate: r.rate, months: n.n, paid: k.n, method })
      : null;
    apply.disabled = !terms;
    if (!terms) {
      put(result);
      return null;
    }
    put(result,
      h('dl', { class: 'contract-figures' },
        h('div', {}, h('dt', { text: t.s.minPay }), h('dd', {}, M(terms.installment))),
        h('div', {}, h('dt', { text: t.s.statRemaining }), h('dd', {}, M(terms.balance))),
        h('div', {}, h('dt', { text: t.s.contractRealRate }), h('dd', { text: formatRate(terms.apr, t.lang) }))),
      method === 'flat' && r.rate > 0 ? h('p', { class: 'hint', text: t.s.contractFlatNote(formatRate(r.rate, t.lang), formatRate(terms.apr, t.lang)) }) : null);
    return { ...terms, principal: P.fils };
  };

  [principal.input, rate.input, months.input, paid.input].forEach(el => {
    el.addEventListener('input', () => compute());
    // Enter inside the helper applies it instead of submitting the debt form
    el.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (compute(true)) apply.click();
    });
  });
  const methodField = methodPicker('c-method', method, v => {
    method = v;
    compute();
  });
  const panel = h('div', { class: 'contract', id: 'contract-panel', hidden: true },
    h('p', { class: 'contract-title' }, icon('fileText', { size: 16 }), h('span', { text: t.s.contractTitle })),
    principal.field,
    h('div', { class: 'field-row' }, rate.field, months.field),
    methodField,
    paid.field,
    result,
    apply);
  toggle.addEventListener('click', () => {
    const opening = panel.hidden;
    panel.hidden = !opening;
    toggle.setAttribute('aria-expanded', String(opening));
    if (opening) principal.input.focus();
  });
  apply.addEventListener('click', () => {
    const terms = compute(true);
    if (!terms) return;
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    onApply(terms);
  });
  return { toggle, panel };
}

function openDebtForm(id = null) {
  const existing = id ? state.debts.find(d => d.id === id) : null;
  const formId = 'debt-form';
  const name = h('input', {
    type: 'text', id: 'f-name', class: 'input', maxlength: '40', autocomplete: 'off', placeholder: t.s.fNamePh,
    value: existing ? existing.name : '', 'aria-required': 'true', enterkeyhint: 'next',
  });
  const nameErr = h('p', { class: 'field-error', id: 'f-name-err', hidden: true });
  let kind = existing ? existing.kind : 'personal';
  const kinds = h('div', { class: 'kind-picker', role: 'radiogroup', 'aria-labelledby': 'f-kind-label' }, KINDS.map(k => {
    const input = h('input', { type: 'radio', name: 'kind', value: k, id: `kind-${k}`, class: 'sr-only', checked: k === kind });
    input.addEventListener('change', () => {
      kind = k;
    });
    return [input, h('label', { for: `kind-${k}`, class: `kind-option kind-${k}` }, icon(KIND_ICONS[k], { size: 18 }), h('span', { text: kindLabel(k) }))];
  }));
  const bal = moneyField({ id: 'f-balance', label: t.s.fBalance, value: existing ? toInputValue(existing.balanceFils) : '' });
  const min = moneyField({ id: 'f-min', label: t.s.fMin, value: existing ? toInputValue(existing.minFils) : '' });
  const rateInput = h('input', {
    type: 'text', id: 'f-rate', inputmode: 'decimal', autocomplete: 'off', dir: 'ltr', class: 'input',
    value: existing ? String(existing.rate) : '0', 'aria-describedby': 'f-rate-hint', enterkeyhint: 'next',
  });
  const rateErr = h('p', { class: 'field-error', id: 'f-rate-err', hidden: true });
  const orig = moneyField({
    id: 'f-original', label: t.s.fOriginal, optional: true, hint: t.s.fOriginalHint,
    value: existing && existing.originalFils > existing.balanceFils ? toInputValue(existing.originalFils) : '',
  });
  const preview = h('p', { class: 'form-preview', 'aria-live': 'polite' });
  const applied = h('p', { class: 'form-preview is-good', hidden: true }, icon('checkCircle', { size: 16 }), h('span', { text: t.s.contractApplied }));
  const contract = contractPanel(terms => {
    bal.input.value = toInputValue(terms.balance);
    min.input.value = toInputValue(terms.installment);
    rateInput.value = String(terms.apr);
    orig.input.value = toInputValue(terms.principal);
    applied.hidden = false;
    validate();
    bal.input.focus();
  });

  const read = () => {
    const d = decimals();
    return {
      name: name.value.replace(/\s+/g, ' ').trim(),
      bal: parseAmount(bal.input.value, { decimals: d }),
      min: parseAmount(min.input.value, { decimals: d }),
      rate: parseRate(rateInput.value),
      orig: parseAmount(orig.input.value, { decimals: d }),
    };
  };
  let touched = false;
  const validate = (show = touched) => {
    const v = read();
    const errs = {
      name: v.name ? '' : t.s.errors.name,
      bal: v.bal.ok ? (v.bal.fils > 0 || existing ? '' : t.s.errors.zero) : errorText(v.bal.error),
      min: v.min.ok ? (v.min.fils > 0 ? '' : t.s.errors.zero) : errorText(v.min.error),
      rate: v.rate.ok ? '' : t.s.errors.rate,
      orig: v.orig.ok || v.orig.error === 'empty'
        ? (v.orig.ok && v.bal.ok && v.orig.fils > 0 && v.orig.fils < v.bal.fils ? t.s.errors.original : '')
        : errorText(v.orig.error),
    };
    if (show) {
      showFieldError(name, nameErr, errs.name);
      showFieldError(bal.input, bal.err, errs.bal);
      showFieldError(min.input, min.err, errs.min);
      showFieldError(rateInput, rateErr, errs.rate);
      showFieldError(orig.input, orig.err, errs.orig);
    }
    // live preview of this debt on its own
    if (v.bal.ok && v.min.ok && v.rate.ok && v.bal.fils > 0 && v.min.fils > 0) {
      const sim = simulate([{ id: 'x', balance: v.bal.fils, minPayment: v.min.fils, rate: v.rate.rate }]);
      const interest = Math.round((v.bal.fils * v.rate.rate) / 1200);
      if (sim.status === 'ok') put(preview, icon('calendar', { size: 16 }), h('span', { text: t.s.formPreview(t.duration(sim.months)) }));
      else put(preview, icon('alert', { size: 16 }), h('span', { text: t.term.under(ms(interest)) }));
      preview.classList.toggle('is-warn', sim.status !== 'ok');
    } else put(preview);
    return { v, ok: Object.values(errs).every(e => !e) };
  };
  [name, bal.input, min.input, rateInput, orig.input].forEach(el => el.addEventListener('input', () => validate()));

  const save = h('button', { type: 'submit', form: formId, class: 'btn btn-primary' }, icon('check'), h('span', { text: t.s.save }));
  const cancel = h('button', { type: 'button', class: 'btn btn-ghost', text: t.s.cancel });
  const form = h('form', { id: formId, class: 'form', novalidate: true },
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'f-name', text: t.s.fName }), name, nameErr),
    h('div', { class: 'field' }, h('p', { class: 'field-label', id: 'f-kind-label', text: t.s.fKind }), kinds),
    h('div', { class: 'field-row' }, bal.field, min.field),
    h('div', { class: 'field' },
      h('label', { class: 'field-label', for: 'f-rate', text: t.term.rate }),
      h('div', { class: 'input-group' }, rateInput, h('span', { class: 'suffix', text: '%' })),
      rateErr,
      h('p', { class: 'hint', id: 'f-rate-hint', text: state.settings.terms === 'profit' ? t.s.fRateHintProfit : t.s.fRateHint })),
    h('div', { class: 'field' }, contract.toggle, contract.panel, applied),
    orig.field,
    preview);
  const sheet = openSheet({
    title: existing ? t.s.editTitle : t.s.addTitle,
    content: form,
    actions: [save, cancel],
    focus: name,
  });
  cancel.addEventListener('click', () => sheet.close());
  validate(false);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    touched = true;
    const { v, ok } = validate(true);
    if (!ok) {
      const first = form.querySelector('[aria-invalid="true"]');
      if (first) first.focus();
      return;
    }
    const base = existing ? { ...existing } : { createdAt: new Date().toISOString(), payments: [], demo: false };
    const balanceFils = v.bal.fils;
    const debt = sanitizeDebt({
      ...base,
      name: v.name,
      kind,
      balanceFils,
      minFils: v.min.fils,
      rate: v.rate.rate,
      // an entered original wins (validated >= balance); otherwise keep what we had
      originalFils: v.orig.ok && v.orig.fils > 0 ? v.orig.fils : Math.max(existing ? existing.originalFils : 0, balanceFils),
      paidAt: balanceFils === 0 ? (existing && existing.paidAt) || new Date().toISOString() : '',
    });
    if (existing) debt.id = existing.id;
    if (!(await saveDebt(debt))) return;
    if (existing) Object.assign(existing, debt);
    else state.debts.push(debt);
    sheet.close();
    render();
    toast(t.s.toastSaved);
  });
}

function openPayment(id) {
  const d = state.debts.find(x => x.id === id);
  if (!d) return;
  const amt = moneyField({ id: 'pay-amount', label: t.s.payAmount });
  amt.input.setAttribute('enterkeyhint', 'done');
  const note = h('p', { class: 'form-preview is-good', hidden: true }, icon('party', { size: 16 }), h('span', { text: t.s.payClears }));
  const quick = h('div', { class: 'quick-chips' },
    h('button', { type: 'button', class: 'chip', onclick: () => fill(Math.min(d.minFils, d.balanceFils)) }, h('span', { text: `${t.s.payQuickMin} · ` }), M(Math.min(d.minFils, d.balanceFils))),
    h('button', { type: 'button', class: 'chip', onclick: () => fill(d.balanceFils) }, h('span', { text: `${t.s.payQuickFull} · ` }), M(d.balanceFils)));
  const check = () => {
    const r = parseAmount(amt.input.value, { decimals: decimals() });
    note.hidden = !(r.ok && r.fils >= d.balanceFils);
    return r;
  };
  function fill(fils) {
    amt.input.value = toInputValue(fils);
    check();
    amt.input.focus();
  }
  amt.input.addEventListener('input', () => {
    check();
    showFieldError(amt.input, amt.err, '');
  });
  const formId = 'pay-form';
  const form = h('form', { id: formId, class: 'form', novalidate: true },
    h('div', { class: 'pay-summary' },
      h('span', { class: `kind-chip kind-${d.kind}` }, icon(KIND_ICONS[d.kind] || 'other')),
      h('div', {}, h('b', { text: d.name }), h('small', {}, h('span', { text: `${t.s.payBalance}: ` }), M(d.balanceFils)))),
    amt.field, quick, note);
  const confirm = h('button', { type: 'submit', form: formId, class: 'btn btn-primary' }, icon('check'), h('span', { text: t.s.payConfirm }));
  const cancel = h('button', { type: 'button', class: 'btn btn-ghost', text: t.s.cancel });
  const sheet = openSheet({ title: t.s.payTitle, content: form, actions: [confirm, cancel], focus: amt.input, size: 'sheet-sm' });
  cancel.addEventListener('click', () => sheet.close());
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const r = check();
    if (!r.ok || r.fils <= 0) {
      showFieldError(amt.input, amt.err, r.ok ? t.s.errors.zero : errorText(r.error));
      amt.input.focus();
      return;
    }
    const before = { balanceFils: d.balanceFils, paidAt: d.paidAt, payments: d.payments.slice() };
    const fils = Math.min(r.fils, d.balanceFils);
    d.balanceFils -= fils;
    d.payments.push({ id: `p${Date.now().toString(36)}`, at: new Date().toISOString(), fils });
    if (d.balanceFils === 0) d.paidAt = new Date().toISOString();
    if (!(await saveDebt(d))) {
      Object.assign(d, before);
      return;
    }
    sheet.close();
    render();
    const cleared = d.balanceFils === 0;
    const allDone = cleared && state.debts.every(x => x.balanceFils === 0);
    if (cleared) celebrate($('confetti'), { big: allDone });
    toast(allDone ? t.s.celebrateAll : cleared ? t.s.celebrate(d.name) : t.s.toastPaid(ms(fils)), {
      tone: cleared ? 'success' : '',
      action: t.s.undo,
      onAction: async () => {
        Object.assign(d, before);
        await saveDebt(d);
        render();
      },
    });
  });
}

function openDetails(id) {
  const d = state.debts.find(x => x.id === id);
  if (!d) return;
  const p = state.plan.current;
  const rank = p.order.indexOf(d.id);
  const facts = [
    [t.s.payBalance, M(d.balanceFils)],
    [t.s.statOriginal, M(d.originalFils)],
    [t.s.statPaid, M(Math.max(0, d.originalFils - d.balanceFils))],
    [t.s.minPay, M(d.minFils)],
    [t.term.column, h('span', { text: d.rate > 0 ? formatRate(d.rate, t.lang) : t.term.free })],
  ];
  if (d.balanceFils > 0) {
    facts.push([t.s.statPayoff, h('span', { text: p.payoffMonth[d.id] ? monthYear(planDate(p.payoffMonth[d.id])) : '—' })]);
    if (rank >= 0) facts.push([t.s.statOrder, h('span', { text: String(rank + 1) })]);
  }
  const history = d.payments.slice().reverse();
  let sheet = null;
  const list = history.length
    ? h('ul', { class: 'history' }, history.map(pm => h('li', {},
      h('span', { class: 'chip-icon chip-sm' }, icon('check', { size: 14 })),
      h('div', {}, M(pm.fils), h('small', { text: dayDate(new Date(pm.at)) })),
      h('button', {
        type: 'button',
        class: 'btn btn-ghost btn-icon',
        'aria-label': `${t.s.removePayment} ${ms(pm.fils)}`,
        onclick: async () => {
          const ok = await confirmSheet({ title: t.s.removePayment, message: t.s.removePaymentConfirm(ms(pm.fils)), confirmLabel: t.s.delete, danger: true });
          if (!ok) return;
          d.payments = d.payments.filter(x => x.id !== pm.id);
          d.balanceFils = Math.min(d.balanceFils + pm.fils, 100_000_000_000);
          d.originalFils = Math.max(d.originalFils, d.balanceFils);
          d.paidAt = d.balanceFils === 0 ? d.paidAt : '';
          await saveDebt(d);
          sheet.close();
          render();
          toast(t.s.toastPaymentRemoved);
        },
      }, icon('trash', { size: 16 })))))
    : h('p', { class: 'muted', text: t.s.historyEmpty });
  const edit = h('button', { type: 'button', class: 'btn btn-soft' }, icon('pencil', { size: 18 }), h('span', { text: t.s.edit }));
  const del = h('button', { type: 'button', class: 'btn btn-danger' }, icon('trash', { size: 18 }), h('span', { text: t.s.deleteDebt }));
  const actions = [edit, del];
  if (d.balanceFils > 0) {
    actions.unshift(h('button', {
      type: 'button',
      class: 'btn btn-primary',
      onclick: () => {
        sheet.close();
        setTimeout(() => openPayment(d.id), 180);
      },
    }, icon('handCoins', { size: 18 }), h('span', { text: t.s.logPayment })));
  }
  sheet = openSheet({
    title: d.name,
    content: [
      h('p', { class: 'details-kind' }, h('span', { class: `kind-chip kind-${d.kind} is-sm` }, icon(KIND_ICONS[d.kind] || 'other', { size: 16 })), h('span', { text: kindLabel(d.kind) })),
      h('dl', { class: 'facts' }, facts.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', {}, v)))),
      h('h3', { class: 'sub-title', text: t.s.detailsHistory }),
      list,
    ],
    actions,
  });
  edit.addEventListener('click', () => {
    sheet.close();
    setTimeout(() => openDebtForm(d.id), 180);
  });
  del.addEventListener('click', async () => {
    const ok = await confirmSheet({ title: t.s.deleteDebt, message: t.s.deleteDebtConfirm(d.name), confirmLabel: t.s.delete, danger: true });
    if (!ok) return;
    try {
      await state.store.deleteDebt(d.id);
    } catch {
      toast(t.s.toastSaveErr, { tone: 'danger' });
      return;
    }
    state.debts = state.debts.filter(x => x.id !== d.id);
    sheet.close();
    render();
    toast(t.s.toastDeleted, {
      action: t.s.undo,
      onAction: async () => {
        if (await saveDebt(d)) {
          state.debts.push(d);
          render();
        }
      },
    });
  });
}

/* ------------------------------------------------------------------ */
/* render loop                                                         */
/* ------------------------------------------------------------------ */

function renderFooter() {
  put($('footer-guides'),
    h('h2', { class: 'footer-guides-title', id: 'guides-title' }, icon('bookOpen', { size: 16 }), h('span', { text: t.s.guidesTitle })),
    h('ul', {}, GUIDES.map((href, i) => h('li', {}, h('a', { href, hreflang: 'ar', text: t.s.guides[i] })))));
  put($('footer-privacy'), icon('lock', { size: 16 }), h('span', { text: t.s.footerPrivacy }));
  $('footer-disclaimer').textContent = t.s.footerDisclaimer;
  $('footer-built').textContent = t.s.builtBy;
  $('print-meta').textContent = `${t.s.appName} · ${dayDate(new Date())}`;
}

function render() {
  recompute();
  applyChrome();
  renderHero();
  renderDemoBanner();
  renderOnboarding();
  renderCheckin();
  if (state.debts.length) {
    updatePlanCard();
    renderDebts();
    renderChartCard();
    renderMilestones();
    renderSchedule();
  }
  renderTools();
  updateSettings();
  renderFooter();
  $('storage-warning').hidden = state.store.persistent;
  $('storage-warning-text').textContent = t.s.toastStorage;
}

let frame = 0;
function scheduleRender() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    render();
  });
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then(reg => {
    const offer = worker => toast(t.s.toastUpdate, {
      timeout: 0,
      action: t.s.toastUpdateBtn,
      onAction: () => worker.postMessage({ type: 'SKIP_WAITING' }),
    });
    if (reg.waiting && hadController) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
  }).catch(() => { /* offline support unavailable; the app still works */ });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}

function handleLaunchAction() {
  const params = new URLSearchParams(location.search);
  const action = params.get('action');
  if (!action) return;
  history.replaceState(null, '', location.pathname);
  if (action === 'add') openDebtForm();
  if (action === 'pay') {
    const id = targetId(engineDebts(), state.settings.strategy);
    if (id !== null) openPayment(id);
  }
  if (action === 'checkin' && state.debts.some(d => d.balanceFils > 0) && !state.month.covered) openCheckin();
  if (action === 'buyout') openBuyout();
}

async function init() {
  initToasts($('toasts'));
  state.store = await openStore();
  const { debts, settings } = await state.store.loadAll();
  state.debts = debts;
  state.settings = settings;
  buildPlanCard();
  buildSettings();

  $('lang-btn').addEventListener('click', async () => {
    await saveSettings({ lang: state.settings.lang === 'ar' ? 'en' : 'ar' });
    render();
  });
  $('theme-btn').addEventListener('click', async () => {
    const order = ['system', 'light', 'dark'];
    await saveSettings({ theme: order[(order.indexOf(state.settings.theme) + 1) % order.length] });
    render();
  });
  $('install-btn').addEventListener('click', installApp);
  $('import-file').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) importBackup(file);
  });
  systemDark.addEventListener('change', () => {
    if (state.settings.theme === 'system') applyChrome();
  });
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    state.installPrompt = e;
    render();
  });
  window.addEventListener('appinstalled', () => {
    state.installPrompt = null;
    render();
  });
  window.addEventListener('beforeprint', () => {
    state.printing = true;
    if (state.debts.length) renderSchedule();
  });
  window.addEventListener('afterprint', () => {
    state.printing = false;
    if (state.debts.length) renderSchedule();
  });

  render();
  // Reveal once fonts are in (or after 800ms) so text doesn't reflow on screen.
  await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 800))]);
  document.documentElement.classList.remove('is-loading');
  if (!state.store.persistent) toast(t.s.toastStorage, { tone: 'danger', timeout: 9000 });
  handleLaunchAction();
  registerServiceWorker();
}

init();
