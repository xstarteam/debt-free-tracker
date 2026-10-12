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

export const STRATEGIES = Object.freeze(['snowball', 'avalanche']);

const sumOf = (list, key) => list.reduce((s, d) => s + d[key], 0);

function comparator(strategy) {
  return strategy === 'avalanche'
    ? (a, b) => (b.rate - a.rate) || (a.balance - b.balance) || (a.idx - b.idx)
    : (a, b) => (a.balance - b.balance) || (b.rate - a.rate) || (a.idx - b.idx);
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
  }));
}

/**
 * Simulate a payoff plan month by month.
 *
 * @param {Array<{id:*, balance:number, minPayment:number, rate:number}>} debts
 *        balance / minPayment in integer fils, rate = annual % (APR)
 * @param {object} [opts]
 * @param {'snowball'|'avalanche'} [opts.strategy='snowball']
 * @param {number}  [opts.extra=0]        extra monthly payment, fils
 * @param {boolean} [opts.rollover=true]  roll cleared minimums forward
 * @param {{month:number, amount:number}|null} [opts.lumpSum]  one-off payment in month N (1 = next month)
 * @param {number}  [opts.maxMonths=MAX_MONTHS]
 */
export function simulate(debts, opts = {}) {
  const strategy = opts.strategy === 'avalanche' ? 'avalanche' : 'snowball';
  const extra = Math.max(0, Math.round(+opts.extra || 0));
  const rollover = opts.rollover !== false;
  const lump = opts.lumpSum && opts.lumpSum.amount > 0 && opts.lumpSum.month >= 1
    ? { month: Math.floor(opts.lumpSum.month), amount: Math.round(opts.lumpSum.amount) }
    : null;
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
    let interest = 0;
    let paid = 0;

    for (const d of open) {
      const i = monthlyInterest(d.balance, d.rate);
      d.balance += i;
      interest += i;
    }

    let budget = (rollover ? committed : sumOf(open, 'minPayment')) + extra
      + (lump && lump.month === m ? lump.amount : 0);

    // 1) every open debt gets its contractual minimum
    for (const d of open) {
      const p = Math.min(d.minPayment, d.balance, budget);
      d.balance -= p;
      paid += p;
      budget -= p;
    }
    // 2) the rest (extra + rolled-over minimums + lump sum) hits the target
    for (const d of open) {
      if (budget <= 0) break;
      const p = Math.min(budget, d.balance);
      d.balance -= p;
      paid += p;
      budget -= p;
    }

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
  const open = normalize(debts).filter(d => d.balance > 0).sort(comparator(strategy));
  return open.length ? open[0].id : null;
}

/** Debts whose minimum does not even cover their own monthly interest. */
export function underwaterDebts(debts) {
  return normalize(debts)
    .filter(d => d.balance > 0 && d.minPayment <= monthlyInterest(d.balance, d.rate))
    .map(d => ({ id: d.id, interest: monthlyInterest(d.balance, d.rate) }));
}

/**
 * Everything the UI needs in one pass: both strategies with the user's
 * settings, plus a no-extras baseline for the selected strategy so the
 * impact of the extra payment / lump sum can be shown.
 */
export function buildPlan(debts, settings = {}) {
  const base = {
    extra: settings.extra || 0,
    rollover: settings.rollover !== false,
    lumpSum: settings.lumpSum || null,
  };
  const selected = settings.strategy === 'avalanche' ? 'avalanche' : 'snowball';
  const snowball = simulate(debts, { ...base, strategy: 'snowball' });
  const avalanche = simulate(debts, { ...base, strategy: 'avalanche' });
  const current = selected === 'avalanche' ? avalanche : snowball;
  const hasBoost = base.extra > 0 || !!(base.lumpSum && base.lumpSum.amount > 0);
  const baseline = hasBoost
    ? simulate(debts, { rollover: base.rollover, strategy: selected })
    : current;
  return {
    selected,
    current,
    other: selected === 'avalanche' ? snowball : avalanche,
    snowball,
    avalanche,
    baseline,
    minExtra: current.status === 'never' ? minExtraToFinish(debts, base) : 0,
    minExtra5y: current.status === 'never' ? minExtraToFinish(debts, { ...base, maxMonths: 60 }) : 0,
    underwater: underwaterDebts(debts),
  };
}

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
