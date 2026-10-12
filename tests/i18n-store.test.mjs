import { test } from 'node:test';
import assert from 'node:assert/strict';
import { count, duration, translator } from '../assets/js/i18n.js';
import { sanitizeDebt, sanitizeSettings, parseBackup, makeBackup, DEFAULT_SETTINGS } from '../assets/js/store.js';

test('Arabic month counts follow the dual / plural rules', () => {
  assert.equal(count('ar', 'month', 1), 'شهر واحد');
  assert.equal(count('ar', 'month', 2), 'شهرين');
  assert.equal(count('ar', 'month', 3), '3 أشهر');
  assert.equal(count('ar', 'month', 10), '10 أشهر');
  assert.equal(count('ar', 'month', 11), '11 شهراً');
  assert.equal(count('ar', 'month', 99), '99 شهراً');
  assert.equal(count('ar', 'month', 100), '100 شهر');
  assert.equal(count('ar', 'debt', 5), '5 ديون');
});

test('durations read naturally in both languages', () => {
  assert.equal(duration('ar', 1), 'شهر واحد');
  assert.equal(duration('ar', 12), 'سنة');
  assert.equal(duration('ar', 24), 'سنتين');
  assert.equal(duration('ar', 27), 'سنتين و3 أشهر');
  assert.equal(duration('ar', 31), 'سنتين و7 أشهر');
  assert.equal(duration('ar', 13), 'سنة وشهر');
  assert.equal(duration('ar', 38), '3 سنوات وشهرين');
  assert.equal(duration('en', 1), '1 month');
  assert.equal(duration('en', 27), '2 years, 3 months');
  assert.equal(duration('en', 12), '1 year');
});

test('translator falls back to Arabic for unknown languages', () => {
  const t = translator('fr');
  assert.equal(t.lang, 'ar');
  assert.equal(t.dir, 'rtl');
  assert.equal(translator('en', 'profit').term.projected, 'Projected profit');
  assert.equal(translator('ar', 'nonsense').term.word, 'الفائدة');
});

test('v1 debts (floats) migrate to integer fils', () => {
  const v1 = {
    id: 7, name: '  قرض   السيارة ', originalAmount: 8000, balance: 6500.5, minPayment: 180,
    interestRate: 5.5, createdAt: '2026-07-20T10:00:00.000Z',
    payments: [{ date: '2026-08-01T09:00:00.000Z', amount: 180.25 }],
  };
  const d = sanitizeDebt(v1);
  assert.equal(d.id, 7);
  assert.equal(d.name, 'قرض السيارة');
  assert.equal(d.balanceFils, 6500500);
  assert.equal(d.minFils, 180000);
  assert.equal(d.originalFils, 8000000);
  assert.equal(d.rate, 5.5);
  assert.equal(d.kind, 'other');
  assert.equal(d.payments[0].fils, 180250);
  assert.equal(d.payments[0].at, '2026-08-01T09:00:00.000Z');
});

test('unusable debts are dropped, hostile values neutralised', () => {
  assert.equal(sanitizeDebt(null), null);
  assert.equal(sanitizeDebt({ name: '', balanceFils: 5, minFils: 1 }), null);
  assert.equal(sanitizeDebt({ name: 'x', balanceFils: -5, minFils: 1 }), null);
  assert.equal(sanitizeDebt({ name: 'x', balanceFils: 'lots', minFils: 1 }), null);
  const d = sanitizeDebt({
    name: '<img src=x onerror=alert(1)>', balanceFils: 1000, minFils: 100, rate: '<b>',
    kind: 'rocket', originalFils: 10, payments: 'nope',
  });
  assert.equal(d.name, '<img src=x onerror=alert(1)>'); // kept as text; rendering uses textContent
  assert.equal(d.rate, 0);
  assert.equal(d.kind, 'other');
  assert.equal(d.originalFils, 1000);
  assert.deepEqual(d.payments, []);
});

test('settings: unknown keys and bad enums fall back (the v1 "lang: fr" brick)', () => {
  const s = sanitizeSettings({ lang: 'fr', theme: 'neon', strategy: 'yolo', extraFils: -1, currency: 'XYZ', evil: 1 });
  assert.deepEqual(s, { ...DEFAULT_SETTINGS });
  assert.equal(sanitizeSettings({ extra: 50.5 }).extraFils, 50500); // v1 key
  assert.equal(sanitizeSettings({ lumpMonth: '2027-13' }).lumpMonth, '');
  assert.equal(sanitizeSettings({ lumpMonth: '2027-01' }).lumpMonth, '2027-01');
});

test('backups: v2 round-trip and v1 import', () => {
  const debts = [sanitizeDebt({ name: 'A', balanceFils: 5000, minFils: 1000, rate: 3 })];
  const settings = { ...DEFAULT_SETTINGS, lang: 'en', extraFils: 2500, lastBackupAt: '2026-01-01T00:00:00.000Z', demo: true };
  const parsed = parseBackup(makeBackup(debts, settings));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.debts[0].balanceFils, 5000);
  assert.equal(parsed.settings.lang, 'en');
  assert.equal(parsed.settings.extraFils, 2500);
  assert.equal(parsed.settings.demo, false, 'demo flag is not carried in backups');

  const v1 = JSON.stringify({ version: 1, settings: { lang: 'ar', extra: 20 }, debts: [{ name: 'B', balance: 100, minPayment: 10, interestRate: 0, originalAmount: 100 }] });
  const p1 = parseBackup(v1);
  assert.equal(p1.ok, true);
  assert.equal(p1.debts[0].balanceFils, 100000);
  assert.equal(p1.settings.extraFils, 20000);
});

test('backups: garbage is rejected without throwing', () => {
  for (const bad of ['', 'not json', '[]', '{"debts": "x"}', '{"debts":[{"nope":1}]}', 'null']) {
    assert.equal(parseBackup(bad).ok, false, bad);
  }
  assert.equal(parseBackup('{"debts": []}').ok, true);
});
