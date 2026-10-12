// Money tests — X Star test-evidence §8 cases plus Arabic input handling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount, parseRate, formatMoney, moneyParts, formatCompact,
  toInputValue, normalizeDigits, formatRate,
} from '../assets/js/money.js';

const fils = s => {
  const r = parseAmount(s);
  assert.equal(r.ok, true, `expected "${s}" to parse, got ${r.error}`);
  return r.fils;
};

test('parse "1.500" KD -> 1500 fils', () => assert.equal(fils('1.500'), 1500));
test('parse "1.5" and "1.50" -> 1500 fils', () => {
  assert.equal(fils('1.5'), 1500);
  assert.equal(fils('1.50'), 1500);
});
test('parse "0.001" -> 1 fils; "0.0005" rejected (no sub-fils)', () => {
  assert.equal(fils('0.001'), 1);
  assert.deepEqual(parseAmount('0.0005'), { ok: false, error: 'precision' });
});
test('trailing zeros past three decimals are harmless', () => assert.equal(fils('1.5000'), 1500));
test('negative amounts rejected at input', () => {
  assert.deepEqual(parseAmount('-5'), { ok: false, error: 'negative' });
  assert.deepEqual(parseAmount('-0.500'), { ok: false, error: 'negative' });
});
test('zero allowed only where the field allows it', () => {
  assert.deepEqual(parseAmount('0'), { ok: true, fils: 0 });
  assert.deepEqual(parseAmount('0', { allowZero: false }), { ok: false, error: 'zero' });
});
test('empty and garbage are rejected', () => {
  assert.equal(parseAmount('').error, 'empty');
  assert.equal(parseAmount('   ').error, 'empty');
  assert.equal(parseAmount('12a3').error, 'invalid');
  assert.equal(parseAmount('1.2.3').error, 'invalid');
  assert.equal(parseAmount('.').error, 'invalid');
});
test('Arabic-Indic and Persian digits are accepted', () => {
  assert.equal(normalizeDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
  assert.equal(normalizeDigits('۰۱۲۳۴۵۶۷۸۹'), '0123456789');
  assert.equal(fils('٥٠٠'), 500000);
  assert.equal(fils('١٢٬٥٠٠٫٧٥'), 12500750); // Arabic thousands + decimal separators
});
test('thousands separators and currency labels are ignored', () => {
  assert.equal(fils('1,200.500'), 1200500);
  assert.equal(fils('1,200.500 د.ك'), 1200500);
  assert.equal(fils('KWD 75'), 75000);
  assert.equal(fils(' 75 '), 75000);
});
test('two-decimal currencies reject a third decimal', () => {
  assert.deepEqual(parseAmount('1.005', { decimals: 2 }), { ok: false, error: 'precision' });
  assert.deepEqual(parseAmount('1.25', { decimals: 2 }), { ok: true, fils: 1250 });
});
test('absurdly large amounts rejected', () => {
  assert.equal(parseAmount('999999999999').error, 'tooLarge');
});

test('format 1500 fils -> 1.500 (Latin digits in both languages)', () => {
  assert.equal(formatMoney(1500, { lang: 'en' }), 'KWD 1.500');
  assert.equal(formatMoney(1500, { lang: 'ar' }), '1.500 د.ك');
  assert.equal(formatMoney(17000000, { lang: 'ar' }), '17,000.000 د.ك');
  assert.doesNotMatch(formatMoney(17000000, { lang: 'ar' }), /[٠-٩٫٬]/);
});
test('format rounds two-decimal currencies to the cent', () => {
  assert.equal(formatMoney(1255, { lang: 'en', currency: 'SAR' }), 'SAR 1.26');
  assert.deepEqual(moneyParts(1250, { lang: 'en', currency: 'AED' }).dec, '25');
});
test('negative display keeps the sign (refund/adjustment views)', () => {
  assert.equal(moneyParts(-2500, { lang: 'en' }).sign, '-');
  assert.equal(moneyParts(0, { lang: 'en' }).sign, '');
});
test('sum of line items stays integer', () => {
  const items = ['0.001', '0.002', '1.997', '0.1', '0.2'].map(fils);
  const total = items.reduce((a, b) => a + b, 0);
  assert.equal(total, 2300);
  assert.ok(Number.isInteger(total));
  assert.equal(formatMoney(total, { lang: 'en' }), 'KWD 2.300');
});
test('input round-trip keeps exact fils', () => {
  for (const v of [0, 1, 999, 1000, 1500, 1200500, 75000, 123456789]) {
    assert.equal(fils(toInputValue(v)), v);
  }
  assert.equal(toInputValue(1500), '1.5');
  assert.equal(toInputValue(75000), '75');
});
test('compact axis labels', () => {
  assert.equal(formatCompact(20000000, { lang: 'en' }), '20K');
  assert.equal(formatCompact(20000000, { lang: 'ar' }), '20 ألف'); // ICU keeps number and unit together
});
test('rates: parse and format', () => {
  assert.deepEqual(parseRate('5.5'), { ok: true, rate: 5.5 });
  assert.deepEqual(parseRate('٧٫٢٥%'), { ok: true, rate: 7.25 });
  assert.deepEqual(parseRate(''), { ok: true, rate: 0 });
  assert.equal(parseRate('-1').ok, false);
  assert.equal(parseRate('150').ok, false);
  assert.equal(formatRate(5.5, 'ar'), '5.5%');
});
