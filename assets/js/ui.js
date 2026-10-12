/* Debt Free — DOM helpers, dialogs, toasts, celebration.
 * User text only ever reaches the DOM through textContent (never innerHTML).
 */
import { ICONS } from './icons.js';
import { moneyParts } from './money.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ui = { close: 'إغلاق', cancel: 'إلغاء', confirm: 'تأكيد' };

/** Strings the helpers need, refreshed when the language changes. */
export function setUiStrings(strings) {
  Object.assign(ui, strings);
}

function appendAll(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Replace an element's children, skipping null/false (unlike replaceChildren). */
export function put(el, ...children) {
  el.replaceChildren();
  appendAll(el, children);
  return el;
}

/** h('button', {class, text, onclick, ...attrs}, ...children) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value') el.value = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  appendAll(el, children);
  return el;
}

/** SVG element with attributes (no inline styles: CSP style-src 'self'). */
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
  }
  appendAll(el, children);
  return el;
}

/** Lucide icon (trusted static markup). */
export function icon(name, { size = 20, cls = '' } = {}) {
  const el = s('svg', {
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true', focusable: 'false', class: `icon ${cls}`.trim(),
  });
  el.innerHTML = ICONS[name] || '';
  return el;
}

/** Money with quieter decimals: 17,000<small>.000</small> د.ك */
export function money(fils, { lang = 'ar', currency = 'KWD' } = {}, cls = '') {
  const p = moneyParts(fils, { lang, currency });
  const num = [h('span', { class: 'm-int', text: p.sign + p.int }), h('span', { class: 'm-dec', text: `.${p.dec}` })];
  const cur = h('span', { class: 'm-cur', text: p.symbol });
  return h('span', { class: `money ${cls}`.trim() }, lang === 'en' ? [cur, ' ', num] : [num, ' ', cur]);
}

let uid = 0;
export const nextId = (prefix = 'id') => `${prefix}-${++uid}`;

/* ---------------- dialogs ---------------- */

/**
 * Open a modal sheet (native <dialog>: focus trap, Esc, top layer).
 * Bottom sheet on phones, centred card on larger screens.
 */
export function openSheet({ title, content, actions = [], size = '', onClose, focus }) {
  const previous = document.activeElement;
  const titleId = nextId('sheet-title');
  const closeBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-icon sheet-close', 'aria-label': ui.close }, icon('x'));
  const body = h('div', { class: 'sheet-body' }, content);
  const inner = h('div', { class: 'sheet-inner' },
    h('header', { class: 'sheet-head' }, h('h2', { id: titleId, class: 'sheet-title', text: title }), closeBtn),
    body,
    actions.length ? h('footer', { class: 'sheet-foot' }, actions) : null,
  );
  const dlg = h('dialog', { class: `sheet ${size}`.trim(), 'aria-labelledby': titleId }, inner);
  let closed = false;
  const close = result => {
    if (closed) return;
    closed = true;
    dlg.classList.add('closing');
    const finish = () => {
      if (dlg.open) dlg.close();
      dlg.remove();
      if (onClose) onClose(result);
      // Re-renders replace nodes; find the trigger's successor by its focus key.
      let target = previous;
      if (target && !target.isConnected && target.dataset && target.dataset.fk) {
        target = document.querySelector(`[data-fk="${CSS.escape(target.dataset.fk)}"]`);
      }
      if (target && target.isConnected && typeof target.focus === 'function') target.focus();
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else setTimeout(finish, 160);
  };
  closeBtn.addEventListener('click', () => close());
  dlg.addEventListener('cancel', e => {
    e.preventDefault();
    close();
  });
  dlg.addEventListener('mousedown', e => {
    if (e.target === dlg) close(); // backdrop
  });
  document.body.append(dlg);
  dlg.showModal();
  if (focus) focus.focus();
  return { dlg, body, close };
}

/** Promise<boolean> confirmation with an explicit, labelled confirm button. */
export function confirmSheet({ title, message, confirmLabel, danger = false }) {
  return new Promise(resolve => {
    let answer = false;
    const yes = h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, text: confirmLabel || ui.confirm });
    const no = h('button', { type: 'button', class: 'btn btn-ghost', text: ui.cancel });
    const sheet = openSheet({
      title,
      size: 'sheet-sm',
      content: h('p', { class: 'sheet-text', text: message }),
      actions: [yes, no],
      focus: no,
      onClose: () => resolve(answer),
    });
    yes.addEventListener('click', () => {
      answer = true;
      sheet.close();
    });
    no.addEventListener('click', () => sheet.close());
  });
}

/* ---------------- toasts ---------------- */

let toastRoot = null;
export function initToasts(root) {
  toastRoot = root;
}

/** Transient message; optional action (e.g. Undo). Announced via aria-live. */
export function toast(message, { action, onAction, timeout = 5000, tone = '' } = {}) {
  if (!toastRoot) return () => {};
  while (toastRoot.children.length >= 3) toastRoot.firstElementChild.remove();
  let timer = null;
  const el = h('div', { class: `toast ${tone}`.trim() }, h('span', { class: 'toast-msg', text: message }));
  const dismiss = () => {
    clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
  };
  if (action) {
    el.append(h('button', {
      type: 'button',
      class: 'toast-action',
      text: action,
      onclick: () => {
        dismiss();
        if (onAction) onAction();
      },
    }));
  }
  el.append(h('button', { type: 'button', class: 'toast-close', 'aria-label': ui.close, onclick: dismiss }, icon('x', { size: 16 })));
  toastRoot.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  if (timeout) timer = setTimeout(dismiss, timeout);
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('focusin', () => clearTimeout(timer));
  return dismiss;
}

/* ---------------- celebration ---------------- */

export function celebrate(canvas, { big = false } = {}) {
  if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  canvas.classList.add('on');
  const colors = ['#34d399', '#f5c66b', '#60a5fa', '#ffffff', '#10b981', '#fbbf24'];
  const parts = Array.from({ length: big ? 220 : 120 }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3,
    y: H * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 13 - 5,
    r: Math.random() * 6 + 4,
    a: Math.random() * Math.PI,
    va: (Math.random() - 0.5) * 0.3,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  const life = big ? 2600 : 1800;
  const frame = now => {
    const t = now - start;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.38;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.a += p.va;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t / life);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      ctx.restore();
    }
    if (t < life) requestAnimationFrame(frame);
    else {
      ctx.clearRect(0, 0, W, H);
      canvas.classList.remove('on');
    }
  };
  requestAnimationFrame(frame);
}

/** Trigger a file download from a Blob. */
export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, class: 'sr-only' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
