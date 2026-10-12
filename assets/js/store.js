/* Debt Free — local persistence (IndexedDB), schema migration and backups.
 *
 * Schema v2 stores every amount as integer fils (v1 stored floats). Old
 * records are migrated in place on first load and v1 backups still import,
 * so no stored data is ever broken by an update.
 */
import { CURRENCIES, MAX_FILS } from './money.js';

const DB_NAME = 'debtfree_db';
const DB_VERSION = 1; // object stores unchanged since v1; record shape is versioned below
export const SCHEMA = 2;

export const KINDS = Object.freeze(['card', 'personal', 'car', 'home', 'bnpl', 'family', 'other']);

export const DEFAULT_SETTINGS = Object.freeze({
  lang: 'ar',
  theme: 'system',
  strategy: 'snowball',
  extraFils: 0,
  rollover: true,
  lumpFils: 0,
  lumpMonth: '',
  lumpRepeat: false,
  currency: 'KWD',
  terms: 'interest',
  incomeFils: 0,
  lastBackupAt: '',
  demo: false,
  remindDay: 25,
  goalMonth: '',
  goalSetAt: '',
  coveredMonth: '',
});

const ENUMS = {
  lang: ['ar', 'en'],
  theme: ['system', 'light', 'dark'],
  strategy: ['snowball', 'avalanche', 'custom'],
  currency: Object.keys(CURRENCIES),
  terms: ['interest', 'profit'],
};

const MAX_DEBTS = 500;
const MAX_PAYMENTS = 2000;
const MAX_PRIORITY = 100_000;
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const filsOrNull = v => (Number.isFinite(v) && v >= 0 && v <= MAX_FILS ? Math.round(v) : null);
const floatToFils = v => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? filsOrNull(Math.round(n * 1000)) : null;
};
const isoOr = (v, fallback) => {
  const d = new Date(typeof v === 'string' || typeof v === 'number' ? v : NaN);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
};
const cleanName = v => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);

/** Validate a settings object; unknown keys are dropped, bad values fall back. */
export function sanitizeSettings(raw, base = DEFAULT_SETTINGS) {
  const out = { ...base };
  if (!isObj(raw)) return out;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (ENUMS[key]) {
      if (ENUMS[key].includes(v)) out[key] = v;
    } else if (key === 'extraFils' || key === 'lumpFils' || key === 'incomeFils') {
      const f = filsOrNull(v);
      if (f !== null) out[key] = f;
    } else if (key === 'rollover' || key === 'demo' || key === 'lumpRepeat') {
      if (typeof v === 'boolean') out[key] = v;
    } else if (key === 'lumpMonth' || key === 'goalMonth' || key === 'coveredMonth') {
      if (v === '' || MONTH_KEY.test(v)) out[key] = v;
    } else if (key === 'lastBackupAt' || key === 'goalSetAt') {
      out[key] = v ? isoOr(v, '') : '';
    } else if (key === 'remindDay') {
      if (Number.isInteger(v) && v >= 1 && v <= 28) out[key] = v;
    }
  }
  // v1 kept the extra payment as a float under "extra"
  if (!('extraFils' in raw) && 'extra' in raw) {
    const f = floatToFils(raw.extra);
    if (f !== null) out.extraFils = f;
  }
  return out;
}

/** Validate one debt (v1 or v2 shape) into a v2 record, or null if unusable. */
export function sanitizeDebt(raw) {
  if (!isObj(raw)) return null;
  const v1 = !('balanceFils' in raw) && 'balance' in raw;
  const name = cleanName(raw.name);
  const balanceFils = v1 ? floatToFils(raw.balance) : filsOrNull(raw.balanceFils);
  const minFils = v1 ? floatToFils(raw.minPayment) : filsOrNull(raw.minFils);
  const originalRaw = v1 ? floatToFils(raw.originalAmount) : filsOrNull(raw.originalFils);
  const rate = Number(v1 ? raw.interestRate : raw.rate);
  if (!name || balanceFils === null || minFils === null) return null;

  const payments = (Array.isArray(raw.payments) ? raw.payments : [])
    .slice(-MAX_PAYMENTS)
    .map((p, i) => {
      if (!isObj(p)) return null;
      const fils = v1 || !('fils' in p) ? floatToFils(p.amount) : filsOrNull(p.fils);
      if (!fils) return null;
      return {
        id: typeof p.id === 'string' && p.id ? p.id.slice(0, 40) : `p${i}-${Date.now().toString(36)}`,
        at: isoOr(p.at ?? p.date, new Date().toISOString()),
        fils,
      };
    })
    .filter(Boolean);

  const debt = {
    name,
    kind: KINDS.includes(raw.kind) ? raw.kind : 'other',
    balanceFils,
    minFils,
    originalFils: Math.max(originalRaw ?? 0, balanceFils),
    rate: Number.isFinite(rate) && rate >= 0 && rate <= 100 ? Math.round(rate * 1000) / 1000 : 0,
    createdAt: isoOr(raw.createdAt, new Date().toISOString()),
    payments,
    paidAt: balanceFils === 0 ? isoOr(raw.paidAt, payments.at(-1)?.at || new Date().toISOString()) : '',
    demo: raw.demo === true,
  };
  // position in a custom payoff order (v2.1); absent = after the ranked debts
  if (Number.isInteger(raw.priority) && raw.priority >= 0 && raw.priority <= MAX_PRIORITY) debt.priority = raw.priority;
  if (Number.isSafeInteger(raw.id) && raw.id > 0) debt.id = raw.id;
  return debt;
}

/** Parse a backup file (v1 or v2). Never throws. */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (!isObj(data) || !Array.isArray(data.debts) || data.debts.length > MAX_DEBTS) return { ok: false };
  const debts = data.debts.map(sanitizeDebt).filter(Boolean).map(({ id, ...d }) => d);
  if (data.debts.length && !debts.length) return { ok: false };
  const settings = sanitizeSettings(isObj(data.settings) ? data.settings : {});
  return { ok: true, debts, settings };
}

/** Serialize a backup (schema v2). */
export function makeBackup(debts, settings) {
  const { lastBackupAt, demo, ...keep } = settings;
  return JSON.stringify({
    app: 'debt-free',
    version: SCHEMA,
    exportedAt: new Date().toISOString(),
    settings: keep,
    debts: debts.map(({ id, ...d }) => d),
  }, null, 2);
}

/* ---------------- IndexedDB ---------------- */

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
}

function openDB() {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('debts')) db.createObjectStore('debts', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

class IdbStore {
  constructor(db) {
    this.db = db;
    this.persistent = true;
  }

  async loadAll() {
    const tx = this.db.transaction(['debts', 'settings'], 'readonly');
    const [rawDebts, rows] = await Promise.all([
      promisify(tx.objectStore('debts').getAll()),
      promisify(tx.objectStore('settings').getAll()),
    ]);
    const rawSettings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    const settings = sanitizeSettings(rawSettings);
    const debts = [];
    const migrate = [];
    for (const raw of rawDebts) {
      const d = sanitizeDebt(raw);
      if (!d) continue;
      d.id = raw.id;
      debts.push(d);
      if (!('balanceFils' in raw)) migrate.push(d);
    }
    if (migrate.length || rawSettings.schema !== SCHEMA) {
      const wtx = this.db.transaction(['debts', 'settings'], 'readwrite');
      const finished = done(wtx);
      migrate.forEach(d => wtx.objectStore('debts').put(d));
      const st = wtx.objectStore('settings');
      if ('extra' in rawSettings) st.delete('extra');
      Object.entries(settings).forEach(([key, value]) => st.put({ key, value }));
      st.put({ key: 'schema', value: SCHEMA });
      await finished;
    }
    return { debts, settings };
  }

  async putDebt(debt) {
    const tx = this.db.transaction('debts', 'readwrite');
    const finished = done(tx);
    const id = await promisify(tx.objectStore('debts').put(debt));
    await finished;
    return id;
  }

  /** Several debts in one transaction: all saved or none (monthly check-in, reorder). */
  async putDebts(debts) {
    const tx = this.db.transaction('debts', 'readwrite');
    const finished = done(tx);
    const store = tx.objectStore('debts');
    debts.forEach(d => store.put(d));
    await finished;
  }

  async deleteDebt(id) {
    const tx = this.db.transaction('debts', 'readwrite');
    const finished = done(tx);
    tx.objectStore('debts').delete(id);
    await finished;
  }

  async putSettings(partial) {
    const tx = this.db.transaction('settings', 'readwrite');
    const finished = done(tx);
    const st = tx.objectStore('settings');
    Object.entries(partial).forEach(([key, value]) => st.put({ key, value }));
    await finished;
  }

  /** Replace everything atomically (restore, sample data, erase). */
  async replaceAll(debts, settings) {
    const tx = this.db.transaction(['debts', 'settings'], 'readwrite');
    const finished = done(tx);
    const ds = tx.objectStore('debts');
    const st = tx.objectStore('settings');
    ds.clear();
    st.clear();
    const ids = debts.map(d => {
      const { id, ...rest } = d;
      return promisify(ds.add(rest));
    });
    Object.entries(settings).forEach(([key, value]) => st.put({ key, value }));
    st.put({ key: 'schema', value: SCHEMA });
    const assigned = await Promise.all(ids);
    await finished;
    return debts.map((d, i) => ({ ...d, id: assigned[i] }));
  }
}

/** Fallback when IndexedDB is unavailable: same API, nothing survives a reload. */
class MemoryStore {
  constructor() {
    this.persistent = false;
    this.next = 1;
  }

  async loadAll() {
    return { debts: [], settings: { ...DEFAULT_SETTINGS } };
  }

  async putDebt(debt) {
    return debt.id ?? this.next++;
  }

  async putDebts() {}

  async deleteDebt() {}

  async putSettings() {}

  async replaceAll(debts) {
    return debts.map(d => ({ ...d, id: this.next++ }));
  }
}

export async function openStore() {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no indexedDB');
    const store = new IdbStore(await openDB());
    await store.loadAll(); // proves read access (and migrates) before we rely on it
    return store;
  } catch {
    return new MemoryStore();
  }
}
