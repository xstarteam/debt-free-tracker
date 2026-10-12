import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  simulate, buildPlan, minExtraToFinish, underwaterDebts, monthlyInterest,
  monthOffset, monthKey, MAX_MONTHS,
} from '../assets/js/engine.js';

const KD = n => Math.round(n * 1000);

// The demo portfolio used throughout the review (17,000 KWD).
const sample = () => [
  { id: 'card', balance: KD(1200), minPayment: KD(60), rate: 18 },
  { id: 'car', balance: KD(6500), minPayment: KD(180), rate: 5.5 },
  { id: 'personal', balance: KD(9000), minPayment: KD(250), rate: 7 },
  { id: 'tabby', balance: KD(300), minPayment: KD(75), rate: 0 },
];

test('freed minimums roll over every month (the v1 bug)', () => {
  const debts = [
    { id: 'a', balance: KD(500), minPayment: KD(100), rate: 0 },
    { id: 'b', balance: KD(5000), minPayment: KD(100), rate: 0 },
  ];
  // a clears in month 5, then b gets 200/month: 4500 / 200 = 22.5 -> 23 more months
  assert.equal(simulate(debts, { strategy: 'snowball' }).months, 28);
  assert.equal(simulate(debts, { strategy: 'avalanche' }).months, 28);
  // Without rollover the freed 100 is spent elsewhere: b takes 50 months.
  assert.equal(simulate(debts, { rollover: false }).months, 50);
});

test('budget stays constant while debts are cleared', () => {
  const plan = simulate(sample(), { strategy: 'snowball', extra: KD(50) });
  assert.equal(plan.status, 'ok');
  assert.equal(plan.budget, KD(615));
  // every full month pays exactly the budget; only the last month can be smaller
  plan.timeline.slice(0, -1).forEach(row => assert.equal(row.paid, KD(615)));
  assert.ok(plan.timeline.at(-1).paid <= KD(615));
});

test('snowball attacks the smallest balance, avalanche the highest rate', () => {
  const s = simulate(sample(), { strategy: 'snowball', extra: KD(50) });
  const a = simulate(sample(), { strategy: 'avalanche', extra: KD(50) });
  assert.deepEqual(s.order, ['tabby', 'card', 'car', 'personal']);
  assert.deepEqual(a.order.slice(0, 2), ['tabby', 'card']); // tabby clears on its own minimum first
  assert.ok(a.payoffMonth.personal < a.payoffMonth.car, 'avalanche: 7% before 5.5%');
  assert.ok(a.totalInterest <= s.totalInterest, 'avalanche never costs more interest');
});

test('sample portfolio matches the corrected plan (31 months)', () => {
  const s = simulate(sample(), { strategy: 'snowball', extra: KD(50) });
  const a = simulate(sample(), { strategy: 'avalanche', extra: KD(50) });
  assert.equal(s.months, 31);
  assert.equal(a.months, 31);
  // within 1 KWD of the float reference computed during the review
  assert.ok(Math.abs(s.totalInterest - KD(1531.436)) < KD(1), `snowball interest ${s.totalInterest}`);
  assert.ok(Math.abs(a.totalInterest - KD(1484.896)) < KD(1), `avalanche interest ${a.totalInterest}`);
});

test('paying a debt early never pushes the freedom date later', () => {
  const before = simulate(sample(), { strategy: 'snowball', extra: KD(50) });
  const after = simulate(
    sample().map(d => (d.id === 'tabby' ? { ...d, balance: 0 } : d)),
    { strategy: 'snowball', extra: KD(50) },
  );
  assert.ok(after.months <= before.months, `${after.months} > ${before.months}`);
  assert.ok(after.totalInterest <= before.totalInterest);
});

test('money is exact: every value is an integer and paid = start + interest', () => {
  for (const strategy of ['snowball', 'avalanche']) {
    const p = simulate(sample(), { strategy, extra: KD(37.125) });
    for (const row of p.timeline) {
      for (const k of ['paid', 'interest', 'balance']) assert.ok(Number.isInteger(row[k]), `${k} ${row[k]}`);
    }
    assert.equal(p.totalPaid, p.startTotal + p.totalInterest);
    assert.equal(p.timeline.at(-1).balance, 0);
  }
});

test('interest is rounded to the nearest fil', () => {
  assert.equal(monthlyInterest(KD(1000), 12), KD(10));
  assert.equal(monthlyInterest(1, 18), 0);
  assert.equal(monthlyInterest(KD(1200), 18), KD(18));
  assert.equal(monthlyInterest(KD(100), 0), 0);
});

test('a plan that can never end is detected early, not after 50 years', () => {
  const debts = [{ id: 'x', balance: KD(10000), minPayment: KD(50), rate: 24 }];
  const p = simulate(debts);
  assert.equal(p.status, 'never');
  assert.ok(p.months <= 13, `stopped at month ${p.months}`);
  assert.ok(p.totalInterest < KD(5000), 'no billion-dinar interest');
  assert.deepEqual(underwaterDebts(debts), [{ id: 'x', interest: KD(200) }]);
});

test('minimum extra to finish is exact to the fil', () => {
  const debts = [{ id: 'x', balance: KD(10000), minPayment: KD(50), rate: 24 }];
  const need = minExtraToFinish(debts);
  assert.ok(need > KD(150));
  assert.equal(simulate(debts, { extra: need }).status, 'ok');
  assert.equal(simulate(debts, { extra: need - 1 }).status, 'never');
  assert.equal(minExtraToFinish(sample()), 0);
});

test('lump sum lands in its month', () => {
  const debts = [{ id: 'a', balance: KD(1000), minPayment: KD(100), rate: 0 }];
  assert.equal(simulate(debts).months, 10);
  const p = simulate(debts, { lumpSum: { month: 3, amount: KD(500) } });
  assert.equal(p.months, 5);
  assert.equal(p.timeline[2].paid, KD(600));
});

test('zero-interest debt: interest stays zero', () => {
  const p = simulate([{ id: 'a', balance: KD(1000), minPayment: KD(100), rate: 0 }]);
  assert.equal(p.months, 10);
  assert.equal(p.totalInterest, 0);
  assert.equal(p.timeline.length, 10);
});

test('empty and fully-paid portfolios', () => {
  assert.equal(simulate([]).status, 'empty');
  assert.equal(simulate([{ id: 'a', balance: 0, minPayment: KD(10), rate: 5 }]).status, 'done');
});

test('buildPlan exposes the impact of extras against a baseline', () => {
  const plan = buildPlan(sample(), { strategy: 'avalanche', extra: KD(100) });
  assert.equal(plan.selected, 'avalanche');
  assert.equal(plan.current, plan.avalanche);
  assert.ok(plan.baseline.months > plan.current.months);
  assert.ok(plan.baseline.totalInterest > plan.current.totalInterest);
  assert.equal(plan.minExtra, 0);
  const none = buildPlan(sample(), { strategy: 'snowball' });
  assert.equal(none.baseline, none.current);
});

test('plan horizon is capped', () => {
  const p = simulate([{ id: 'slow', balance: KD(100000), minPayment: KD(10), rate: 0 }]);
  assert.equal(p.status, 'never');
  assert.ok(p.months <= MAX_MONTHS);
});

test('month helpers', () => {
  const from = new Date(2026, 9, 12); // 12 Oct 2026
  assert.equal(monthKey(from, 1), '2026-11');
  assert.equal(monthOffset(from, '2026-11'), 1);
  assert.equal(monthOffset(from, '2027-10'), 12);
  assert.equal(monthOffset(from, 'garbage'), 0);
});
