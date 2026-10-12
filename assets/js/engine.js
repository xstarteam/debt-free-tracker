/* Debt Free — payoff engine.
 *
 * Pure functions, no DOM. Every amount is an integer number of fils
 * (1 KWD = 1000 fils) so the plan is exact: interest is rounded to the
 * nearest fil each month, the way a bank statement is.
 *
 * Model (standard snowball / avalanche):
 *   - The monthly budget is fixed: the sum of every debt's minimum payment
 *     plus the extra payment. When a debt is cleared, its minimum keeps
 *     rolling forward to the next target ("rollover"). Turning rollover off
 *     models someone who stops paying that money once a debt is gone.
 *   - Each month: interest accrues, every open debt gets its minimum, then
 *     whatever is left attacks debts in strategy order.
 */

export const MAX_MONTHS = 600; // 50 years: past this a plan "never" ends
const STALL_WINDOW = 12;       // no progress for a year => never ends
const NO_PRIORITY = 1e9;       // custom order: debts without a position go last

export const STRATEGIES = Object.freeze(['snowball', 'avalanche', 'custom']);

const sumOf = (list, key) => list.reduce((s, d) => s + d[key], 0);
const strategyOf = key => (STRATEGIES.includes(key) ? key : 'snowball');

function comparator(strategy) {
  if (strategy === 'avalanche') return (a, b) => (b.rate - a.rate) || (a.balance - b.balance) || (a.idx - b.idx);
  if (strategy === 'custom') return (a, b) => (a.priority - b.priority) || (a.idx - b.idx);
  return (a, b) => (a.balance - b.balance) || (b.rate - a.rate) || (a.idx - b.idx);
}

/** One month of interest in fils, rounded to the nearest fil. */
export function monthlyInterest(balance, rate) {
  if (balance <= 0 || rate <= 0) return 0;
  return Math.round((balance * rate) / 1200);
}

function normalize(debts) {
  return debts.map((d, idx) => ({
    id: d.id,
    idx,
    rate: Number.isFinite(+d.rate) ? Math.max(0, +d.rate) : 0,
    minPayment: Math.max(0, Math.round(+d.minPayment || 0)),
    balance: Math.max(0, Math.round(+d.balance || 0)),
    priority: Number.isFinite(d.priority) ? d.priority : NO_PRIORITY,
  }));
}

function normalizeLump(lumpSum) {
  if (!lumpSum || !(lumpSum.amount > 0) || !(lumpSum.month >= 1)) return null;
  const every = Math.floor(+lumpSum.every || 0);
  return { month: Math.floor(lumpSum.month), amount: Math.round(lumpSum.amount), every: every > 0 ? every : 0 };
}

/** Lump-sum money landing in month m (a yearly bonus repeats every 12). */
function lumpAt(lump, m) {
  if (!lump) return 0;
  if (m === lump.month) return lump.amount;
  return lump.every && m > lump.month && (m - lump.month) % lump.every === 0 ? lump.amount : 0;
}

/** Minimums first, then everything left to debts in strategy order. */
function payMonth(open, budget, byId) {
  let paid = 0;
  const pay = (d, p) => {
    d.balance -= p;
    paid += p;
    budget -= p;
    if (byId) byId[d.id] = (byId[d.id] || 0) + p;
  };
  for (const d of open) pay(d, Math.min(d.minPayment, d.balance, budget));
  for (const d of open) {
    if (budget <= 0) break;
    pay(d, Math.min(budget, d.balance));
  }
  return paid;
}

function accrue(open) {
  let interest = 0;
  for (const d of open) {
    const i = monthlyInterest(d.balance, d.rate);
    d.balance += i;
    interest += i;
  }
  return interest;
}

/**
 * Simulate a payoff plan month by month.
 *
 * @param {Array<{id:*, balance:number, minPayment:number, rate:number, priority?:number}>} debts
 *        balance / minPayment in integer fils, rate = annual % (APR)
 * @param {object} [opts]
 * @param {'snowball'|'avalanche'|'custom'} [opts.strategy='snowball']  custom = ascending priority
 * @param {number}  [opts.extra=0]        extra monthly payment, fils
 * @param {boolean} [opts.rollover=true]  roll cleared minimums forward
 * @param {{month:number, amount:number, every?:number}|null} [opts.lumpSum]
 *        payment in month N (1 = next month), repeating every `every` months when set
 * @param {number}  [opts.maxMonths=MAX_MONTHS]
 */
export function simulate(debts, opts = {}) {
  const strategy = strategyOf(opts.strategy);
  const extra = Math.max(0, Math.round(+opts.extra || 0));
  const rollover = opts.rollover !== false;
  const lump = normalizeLump(opts.lumpSum);
  const maxMonths = opts.maxMonths || MAX_MONTHS;

  const all = normalize(debts);
  const startTotal = sumOf(all, 'balance');
  const committed = sumOf(all, 'minPayment');
  const result = {
    strategy,
    status: 'ok',
    months: 0,
    startTotal,
    totalInterest: 0,
    totalPaid: 0,
    budget: (rollover ? committed : sumOf(all.filter(d => d.balance > 0), 'minPayment')) + extra,
    timeline: [],
    payoffMonth: {},
    order: [],
  };
  if (startTotal === 0) {
    result.status = all.length ? 'done' : 'empty';
    return result;
  }

  const byStrategy = comparator(strategy);
  const totals = [startTotal];

  for (let m = 1; m <= maxMonths; m++) {
    const open = all.filter(d => d.balance > 0).sort(byStrategy);
    const interest = accrue(open);
    const budget = (rollover ? committed : sumOf(open, 'minPayment')) + extra + lumpAt(lump, m);
    const paid = payMonth(open, budget);

    const events = [];
    for (const d of open) {
      if (d.balance === 0) {
        result.payoffMonth[d.id] = m;
        result.order.push(d.id);
        events.push(d.id);
      }
    }

    const total = sumOf(all, 'balance');
    totals.push(total);
    result.totalInterest += interest;
    result.totalPaid += paid;
    result.timeline.push({ month: m, paid, interest, balance: total, events });

    if (total === 0) {
      result.months = m;
      return result;
    }
    const stalled = m >= STALL_WINDOW && total >= totals[m - STALL_WINDOW]
      && !(lump && lump.month > m);
    if (stalled) break;
  }

  result.status = 'never';
  result.months = result.timeline.length;
  return result;
}

/**
 * What the plan pays each debt next month (month 1): the amounts a monthly
 * check-in pre-fills. Returns { [id]: fils } for debts that receive money.
 */
export function monthAllocation(debts, opts = {}) {
  const strategy = strategyOf(opts.strategy);
  const extra = Math.max(0, Math.round(+opts.extra || 0));
  const rollover = opts.rollover !== false;
  const all = normalize(debts);
  const open = all.filter(d => d.balance > 0).sort(comparator(strategy));
  accrue(open);
  const budget = (rollover ? sumOf(all, 'minPayment') : sumOf(open, 'minPayment')) + extra + lumpAt(normalizeLump(opts.lumpSum), 1);
  const byId = {};
  payMonth(open, budget, byId);
  for (const id of Object.keys(byId)) if (!byId[id]) delete byId[id];
  return byId;
}

/**
 * Smallest extra monthly payment (fils) that makes the plan finish within
 * maxMonths, or 0 if it already does. Binary search over whole fils.
 */
export function minExtraToFinish(debts, opts = {}) {
  const run = extra => simulate(debts, { ...opts, extra }).status === 'ok';
  if (run(Math.max(0, Math.round(+opts.extra || 0)))) return 0;
  let lo = 0;
  let hi = 1000;
  const cap = Math.max(1000, sumOf(normalize(debts), 'balance') * 4);
  while (!run(hi)) {
    lo = hi;
    hi *= 2;
    if (hi > cap) return cap;
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (run(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** The debt that receives any extra money this month under a strategy. */
export function targetId(debts, strategy) {
  const open = normalize(debts).filter(d => d.balance > 0).sort(comparator(strategyOf(strategy)));
  return open.length ? open[0].id : null;
}

/** Debts in the order a strategy pays them (open debts only). */
export function payoffOrder(debts, strategy) {
  return normalize(debts).filter(d => d.balance > 0).sort(comparator(strategyOf(strategy))).map(d => d.id);
}

/** Debts whose minimum does not even cover their own monthly interest. */
export function underwaterDebts(debts) {
  return normalize(debts)
    .filter(d => d.balance > 0 && d.minPayment <= monthlyInterest(d.balance, d.rate))
    .map(d => ({ id: d.id, interest: monthlyInterest(d.balance, d.rate) }));
}

/** What today's balances cost per day, in fils (a month of interest x 12 / 365). */
export function dailyCost(debts) {
  const month = normalize(debts).reduce((s, d) => s + monthlyInterest(d.balance, d.rate), 0);
  return Math.round((month * 12) / 365);
}

/**
 * Everything the UI needs in one pass: both reference strategies (plus the
 * custom order when selected) with the user's settings, and a no-extras
 * baseline for the selected strategy so the impact of extras can be shown.
 */
export function buildPlan(debts, settings = {}) {
  const base = {
    extra: settings.extra || 0,
    rollover: settings.rollover !== false,
    lumpSum: settings.lumpSum || null,
  };
  const selected = strategyOf(settings.strategy);
  const snowball = simulate(debts, { ...base, strategy: 'snowball' });
  const avalanche = simulate(debts, { ...base, strategy: 'avalanche' });
  const custom = selected === 'custom' ? simulate(debts, { ...base, strategy: 'custom' }) : null;
  const current = { snowball, avalanche, custom }[selected];
  const hasBoost = base.extra > 0 || !!(base.lumpSum && base.lumpSum.amount > 0);
  const baseline = hasBoost
    ? simulate(debts, { rollover: base.rollover, strategy: selected })
    : current;
  const never = current.status === 'never';
  return {
    selected,
    current,
    snowball,
    avalanche,
    custom,
    baseline,
    minExtra: never ? minExtraToFinish(debts, { ...base, strategy: selected }) : 0,
    minExtra5y: never ? minExtraToFinish(debts, { ...base, strategy: selected, maxMonths: 60 }) : 0,
    underwater: underwaterDebts(debts),
  };
}

/* ---------------- contracts: flat vs reducing rates ---------------- */

/** Annuity factor: present value of 1 per month for n months at monthly rate i. */
const annuity = (i, n) => (i > 0 ? (1 - (1 + i) ** -n) / i : n);

/**
 * Monthly reducing-balance rate equivalent to a flat rate charged on the
 * original amount for `months` months (same installment, same term).
 */
export function flatMonthlyRate(flatRate, months) {
  const n = Math.floor(months);
  if (!(flatRate > 0) || n < 1) return 0;
  const target = n / (1 + (flatRate / 100) * (n / 12)); // annuity factor the installment implies
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (annuity(mid, n) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Effective annual rate (APR, %) of a flat-rate contract, floored to 0.001. */
export function flatToApr(flatRate, months) {
  return Math.floor(flatMonthlyRate(flatRate, months) * 1200 * 1000) / 1000;
}

/**
 * Work out a debt from its contract: amount financed, annual rate, term and
 * installments already paid. `method` is 'flat' (rate on the original amount
 * for the whole term) or 'reducing' (rate on the remaining balance).
 *
 * The balance is the outstanding principal on the reducing basis, so the
 * engine (balance + installment + APR) reproduces the contract's payments.
 * The APR is floored so a plan never runs a month past the contract.
 */
export function contractTerms({ principal, rate = 0, months, paid = 0, method = 'flat' }) {
  const P = Math.max(0, Math.round(+principal || 0));
  const n = Math.floor(+months || 0);
  if (!P || n < 1 || !(rate >= 0)) return null;
  const k = Math.min(n, Math.max(0, Math.floor(+paid || 0)));
  const flat = method === 'flat';
  const i = flat ? flatMonthlyRate(rate, n) : rate / 1200;
  const installment = flat
    ? Math.round((P * (1 + (rate / 100) * (n / 12))) / n)
    : Math.round(P / annuity(i, n));
  const left = n - k;
  let balance = P;
  if (left === 0) balance = 0;
  else if (k > 0) balance = Math.min(P, Math.round(installment * annuity(i, left)));
  return {
    installment,
    apr: flat ? flatToApr(rate, n) : Math.round(rate * 1000) / 1000,
    balance,
    months: n,
    remaining: left,
    totalCost: Math.max(0, installment * n - P),
    remainingCost: Math.max(0, installment * left - balance),
  };
}

/**
 * Debt buyout / consolidation: keep paying the selected debts as they are
 * (their own installments, freed ones rolling over) versus one new loan for
 * the combined balance. Fees are paid on top, not financed.
 */
export function buyoutCompare(debts, { rate = 0, method = 'reducing', months, fees = 0 }, { strategy = 'avalanche' } = {}) {
  const open = normalize(debts).filter(d => d.balance > 0);
  const amount = sumOf(open, 'balance');
  const terms = contractTerms({ principal: amount, rate, months, method });
  if (!amount || !terms) return null;
  const sim = simulate(open, { strategy });
  const ok = sim.status === 'ok';
  const fee = Math.max(0, Math.round(+fees || 0));
  const current = {
    installment: sumOf(open, 'minPayment'),
    status: sim.status,
    months: ok ? sim.months : null,
    cost: ok ? sim.totalInterest : null,
    total: ok ? amount + sim.totalInterest : null,
  };
  const offer = {
    installment: terms.installment,
    months: terms.months,
    apr: terms.apr,
    cost: terms.totalCost + fee,
    fees: fee,
    total: amount + terms.totalCost + fee,
  };
  return {
    amount,
    current,
    offer,
    saving: ok ? current.total - offer.total : null,
    monthsSooner: ok ? current.months - offer.months : null,
    monthlyRelief: current.installment - offer.installment,
  };
}

/* ---------------- dates ---------------- */

/** Calendar month N months after `from` (month 1 = next month). */
export function monthDate(from, n) {
  return new Date(from.getFullYear(), from.getMonth() + n, 1);
}

/** Months from `from` to a 'YYYY-MM' key (next month = 1). */
export function monthOffset(from, key) {
  const m = /^(\d{4})-(\d{2})$/.exec(key || '');
  if (!m) return 0;
  return (Number(m[1]) - from.getFullYear()) * 12 + (Number(m[2]) - 1 - from.getMonth());
}

/** 'YYYY-MM' key for N months after `from`. */
export function monthKey(from, n) {
  const d = monthDate(from, n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
