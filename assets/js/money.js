/* Debt Free — money parsing and formatting.
 *
 * Storage and arithmetic use integer fils (thousandths of the currency unit).
 * Display always uses Latin digits, in Arabic and English alike, so a
 * screen never mixes ١٧ and 17 and a decimal point never reads as a comma.
 */

export const CURRENCIES = Object.freeze({
  KWD: { decimals: 3, ar: 'د.ك', en: 'KWD' },
  SAR: { decimals: 2, ar: 'ر.س', en: 'SAR' },
  AED: { decimals: 2, ar: 'د.إ', en: 'AED' },
  QAR: { decimals: 2, ar: 'ر.ق', en: 'QAR' },
  BHD: { decimals: 3, ar: 'د.ب', en: 'BHD' },
  OMR: { decimals: 3, ar: 'ر.ع', en: 'OMR' },
  USD: { decimals: 2, ar: 'دولار', en: 'USD' },
});

export const MAX_FILS = 100_000_000_000; // 100,000,000.000

const LOCALES = { ar: 'ar-KW-u-nu-latn', en: 'en-US' };
export const localeFor = lang => LOCALES[lang] || LOCALES.ar;

const currencyOf = code => CURRENCIES[code] || CURRENCIES.KWD;

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits to ASCII. */
export function normalizeDigits(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06F0));
}

const CURRENCY_TOKENS = /(د\.ك|ر\.س|د\.إ|ر\.ق|د\.ب|ر\.ع|دولار|KWD|KD|SAR|AED|QAR|BHD|OMR|USD|\$)/gi;

function cleanNumber(input) {
  return normalizeDigits(input)
    .replace(CURRENCY_TOKENS, '')
    .replace(/[\s  ‎‏,٬،]/g, '') // spaces, marks, thousands separators
    .replace(/٫/g, '.');                                    // Arabic decimal separator
}

/**
 * Parse a typed amount into integer fils.
 * Commas are thousands separators; "." or "٫" is the decimal point.
 * @returns {{ok:true, fils:number} | {ok:false, error:'empty'|'invalid'|'negative'|'precision'|'tooLarge'|'zero'}}
 */
export function parseAmount(input, { decimals = 3, allowZero = true } = {}) {
  const s = cleanNumber(input);
  if (!s) return { ok: false, error: 'empty' };
  if (/^-/.test(s)) return { ok: false, error: 'negative' };
  if (!/^\+?(\d+\.?\d*|\.\d+)$/.test(s)) return { ok: false, error: 'invalid' };
  const [intPart, fracPart = ''] = s.replace(/^\+/, '').split('.');
  if (/[1-9]/.test(fracPart.slice(decimals))) return { ok: false, error: 'precision' };
  const fils = Number(intPart || '0') * 1000 + Number((fracPart + '000').slice(0, 3));
  if (!Number.isSafeInteger(fils) || fils > MAX_FILS) return { ok: false, error: 'tooLarge' };
  if (fils === 0 && !allowZero) return { ok: false, error: 'zero' };
  return { ok: true, fils };
}

/** Parse an annual percentage rate (0–100, up to 3 decimals). */
export function parseRate(input) {
  const s = cleanNumber(input).replace(/%/g, '');
  if (!s) return { ok: true, rate: 0 };
  if (/^-/.test(s)) return { ok: false, error: 'negative' };
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return { ok: false, error: 'invalid' };
  const rate = Number(s);
  if (!(rate >= 0 && rate <= 100)) return { ok: false, error: 'tooLarge' };
  return { ok: true, rate: Math.round(rate * 1000) / 1000 };
}

const groupers = new Map();
function grouper(lang) {
  if (!groupers.has(lang)) {
    groupers.set(lang, new Intl.NumberFormat(localeFor(lang), { maximumFractionDigits: 0 }));
  }
  return groupers.get(lang);
}

/** Split an amount into display parts: sign, grouped integer, decimals, symbol. */
export function moneyParts(fils, { lang = 'ar', currency = 'KWD' } = {}) {
  const cur = currencyOf(currency);
  let v = Math.abs(Math.round(+fils || 0));
  if (cur.decimals === 2) v = Math.round(v / 10) * 10;
  const whole = Math.trunc(v / 1000);
  const frac = v % 1000;
  return {
    sign: fils < 0 && v > 0 ? '-' : '',
    int: grouper(lang).format(whole),
    dec: cur.decimals === 3 ? String(frac).padStart(3, '0') : String(frac / 10).padStart(2, '0'),
    symbol: cur[lang] || cur.en,
    decimals: cur.decimals,
  };
}

/** "17,000.000 د.ك" in Arabic, "KWD 17,000.000" in English. */
export function formatMoney(fils, opts = {}) {
  const p = moneyParts(fils, opts);
  const num = `${p.sign}${p.int}.${p.dec}`;
  return opts.lang === 'en' ? `${p.symbol} ${num}` : `${num} ${p.symbol}`;
}

/** Plain number for axis ticks: 20K / 20 ألف. */
export function formatCompact(fils, { lang = 'ar' } = {}) {
  return new Intl.NumberFormat(localeFor(lang), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format((+fils || 0) / 1000);
}

/** Shortest exact string for an input field: 1200, 1200.5, 0.001. */
export function toInputValue(fils) {
  const v = Math.max(0, Math.round(+fils || 0));
  const whole = Math.trunc(v / 1000);
  const frac = String(v % 1000).padStart(3, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

/** "5.5%" — Latin digits, trailing zeros trimmed. */
export function formatRate(rate, lang = 'ar') {
  const n = new Intl.NumberFormat(localeFor(lang), { maximumFractionDigits: 3 }).format(+rate || 0);
  return `${n}%`;
}

/** Plain grouped integer (months, counts) in Latin digits. */
export function formatInt(n, lang = 'ar') {
  return grouper(lang).format(Math.round(+n || 0));
}
