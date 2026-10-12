import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  simulate, buildPlan, minExtraToFinish, underwaterDebts, monthlyInterest,
  monthOffset, monthKey, MAX_MONTHS, targetId, payoffOrder, monthAllocation, dailyCost,
  flatToApr, contractTerms, buyoutCompare,
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

/* ---------------- v2.1 ---------------- */

test('custom order sends the extra money to the user\'s first pick', () => {
  const rank = { personal: 0, car: 1, card: 2, tabby: 3 };
  const debts = sample().map(d => ({ ...d, priority: rank[d.id] }));
  assert.equal(targetId(debts, 'custom'), 'personal');
  assert.deepEqual(payoffOrder(debts, 'custom'), ['personal', 'car', 'card', 'tabby']);
  const c = simulate(debts, { strategy: 'custom', extra: KD(50) });
  const s = simulate(debts, { strategy: 'snowball', extra: KD(50) });
  assert.equal(c.status, 'ok');
  assert.ok(c.payoffMonth.personal < s.payoffMonth.personal, 'personal is cleared sooner when it is first');
  assert.equal(c.totalPaid, c.startTotal + c.totalInterest);
  // debts without a position go after the ranked ones
  const partial = sample().map(d => (d.id === 'car' ? { ...d, priority: 0 } : d));
  assert.equal(targetId(partial, 'custom'), 'car');
});

test('buildPlan follows the custom order and rejects unknown strategies', () => {
  const rank = { tabby: 0, personal: 1, car: 2, card: 3 };
  const debts = sample().map(d => ({ ...d, priority: rank[d.id] }));
  const plan = buildPlan(debts, { strategy: 'custom', extra: KD(50) });
  assert.equal(plan.selected, 'custom');
  assert.equal(plan.current, plan.custom);
  assert.ok(plan.custom.totalInterest >= plan.avalanche.totalInterest, 'avalanche stays the cheapest');
  assert.equal(buildPlan(debts, { strategy: 'nonsense' }).selected, 'snowball');
  assert.equal(buildPlan(debts, { strategy: 'snowball' }).custom, null);
});

test('a yearly bonus repeats every 12 months', () => {
  const debts = [{ id: 'a', balance: KD(3000), minPayment: KD(100), rate: 0 }];
  const once = simulate(debts, { lumpSum: { month: 3, amount: KD(500) } });
  const yearly = simulate(debts, { lumpSum: { month: 3, amount: KD(500), every: 12 } });
  assert.equal(once.months, 25);
  assert.equal(yearly.months, 20);
  assert.equal(yearly.timeline[2].paid, KD(600));
  assert.equal(yearly.timeline[14].paid, KD(600)); // month 15 = 3 + 12
  assert.equal(yearly.timeline[13].paid, KD(100));
});

test('next month allocation: every minimum, the extra to the target', () => {
  const snow = monthAllocation(sample(), { strategy: 'snowball', extra: KD(50) });
  assert.deepEqual(snow, { tabby: KD(125), card: KD(60), car: KD(180), personal: KD(250) });
  const aval = monthAllocation(sample(), { strategy: 'avalanche', extra: KD(50) });
  assert.equal(aval.card, KD(110));
  const total = Object.values(snow).reduce((a, b) => a + b, 0);
  assert.equal(total, simulate(sample(), { strategy: 'snowball', extra: KD(50) }).timeline[0].paid);
});

test('daily cost of today\'s balances', () => {
  // first-month interest is 100.292 KWD; x 12 / 365 = 3.297 KWD a day
  assert.equal(dailyCost(sample()), 3297);
  assert.equal(dailyCost([{ id: 'a', balance: KD(500), minPayment: KD(50), rate: 0 }]), 0);
});

test('a flat-rate contract converts to its real reducing rate', () => {
  const apr = flatToApr(4, 60);
  assert.ok(apr > 7.41 && apr < 7.43, `apr ${apr}`);
  const c = contractTerms({ principal: KD(10000), rate: 4, months: 60, method: 'flat' });
  assert.equal(c.installment, KD(200));
  assert.equal(c.balance, KD(10000));
  assert.equal(c.totalCost, KD(2000));
  // fed the converted figures, the engine reproduces the contract
  const real = simulate([{ id: 'car', balance: c.balance, minPayment: c.installment, rate: c.apr }]);
  assert.equal(real.months, 60);
  assert.ok(Math.abs(real.totalInterest - KD(2000)) < KD(1), `interest ${real.totalInterest}`);
  // typed as a plain 4%, the same loan looks 5 months shorter and less than half the cost
  const naive = simulate([{ id: 'car', balance: KD(10000), minPayment: KD(200), rate: 4 }]);
  assert.equal(naive.months, 55);
  assert.ok(naive.totalInterest < KD(1000));
});

test('contract balance after installments already paid', () => {
  const c = contractTerms({ principal: KD(10000), rate: 4, months: 60, paid: 12, method: 'flat' });
  assert.equal(c.remaining, 48);
  assert.ok(c.balance > KD(8000) && c.balance < KD(10000), `balance ${c.balance}`);
  const sim = simulate([{ id: 'car', balance: c.balance, minPayment: c.installment, rate: c.apr }]);
  assert.equal(sim.months, 48);
  assert.ok(Math.abs(sim.totalInterest - c.remainingCost) < KD(1), `${sim.totalInterest} vs ${c.remainingCost}`);
  assert.equal(contractTerms({ principal: KD(10000), rate: 4, months: 60, paid: 60, method: 'flat' }).balance, 0);
  // reducing-rate contract: the standard annuity installment
  assert.equal(contractTerms({ principal: KD(10000), rate: 5, months: 60, method: 'reducing' }).installment, 188712);
  assert.equal(contractTerms({ principal: KD(1200), rate: 0, months: 12, method: 'flat' }).installment, KD(100));
  assert.equal(contractTerms({ principal: 0, rate: 4, months: 12 }), null);
  assert.equal(contractTerms({ principal: KD(100), rate: 4, months: 0 }), null);
});

test('debt buyout compares total cost, term and installment', () => {
  const debts = [
    { id: 'card', balance: KD(1200), minPayment: KD(60), rate: 18 },
    { id: 'personal', balance: KD(9000), minPayment: KD(250), rate: 7 },
  ];
  const r = buyoutCompare(debts, { rate: 5, method: 'reducing', months: 48, fees: KD(50) });
  assert.equal(r.amount, KD(10200));
  assert.equal(r.current.installment, KD(310));
  assert.equal(r.current.status, 'ok');
  assert.equal(r.offer.fees, KD(50));
  assert.equal(r.offer.total, r.amount + r.offer.cost);
  assert.equal(r.saving, r.current.total - r.offer.total);
  assert.equal(r.monthlyRelief, r.current.installment - r.offer.installment);
  // a cheaper rate over a much longer term lowers the installment but costs more in total
  const long = buyoutCompare(debts, { rate: 5, method: 'reducing', months: 120 });
  assert.ok(long.monthlyRelief > r.monthlyRelief);
  assert.ok(long.offer.cost > r.offer.cost, 'longer term, more total cost');
  assert.equal(buyoutCompare([], { rate: 5, months: 12 }), null);
});
