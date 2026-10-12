/* Debt Free — balance chart (inline SVG, no dependencies).
 *
 * Two series (snowball / avalanche) over months. Follows the dataviz rules:
 * 2px round lines, 10% area wash on the selected series, solid hairline
 * grid, compact y ticks, a crosshair + tooltip listing every series (pointer,
 * touch and keyboard), and time flowing with the reading direction.
 */
import { h, s } from './ui.js';

function niceStep(range, count) {
  const raw = range / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function ticksFor(max, count = 4) {
  if (max <= 0) return [0];
  const step = niceStep(max, count);
  const top = Math.ceil(max / step) * step;
  const out = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(v);
  return out;
}

function pathFor(points, x, y) {
  return points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
}

/**
 * opts = {
 *   series: [{ key, label, values:number[] (index 0 = today), events?: {index:[labels]} }],
 *   selected, rtl, labelAt(i) -> string, tickLabelAt(i) -> string,
 *   formatValue(v) -> string, formatTick(v) -> string, ariaLabel, hint
 * }
 */
export function renderChart(root, opts) {
  let st = root.__chart;
  if (!st) {
    st = { root, index: null, opts };
    const svg = s('svg', { class: 'chart-svg', role: 'img' });
    const tip = h('div', { class: 'chart-tip', 'aria-hidden': 'true' });
    root.append(svg, tip);
    root.tabIndex = 0;
    st.svg = svg;
    st.tip = tip;
    bind(st);
    if ('ResizeObserver' in window) {
      let w = 0;
      new ResizeObserver(entries => {
        const cw = Math.round(entries[0].contentRect.width);
        if (cw && cw !== w) {
          w = cw;
          draw(st);
        }
      }).observe(root);
    }
    root.__chart = st;
  }
  st.opts = opts;
  draw(st);
}

function layout(st) {
  const width = Math.max(280, Math.round(st.root.clientWidth || 600));
  const height = width < 520 ? 230 : 290;
  const { rtl } = st.opts;
  const n = Math.max(2, ...st.opts.series.map(se => se.values.length));
  const max = Math.max(1, ...st.opts.series.flatMap(se => se.values));
  const ticks = ticksFor(max, width < 520 ? 3 : 4);
  const top = ticks[ticks.length - 1] || 1;
  const yLabelW = 46;
  const m = { top: 14, bottom: 30, start: yLabelW + 6, end: 14 };
  const plotW = width - m.start - m.end;
  const plotH = height - m.top - m.bottom;
  const x0 = rtl ? width - m.start : m.start; // "today" sits at the reading start
  const dir = rtl ? -1 : 1;
  const x = i => x0 + dir * (i / (n - 1)) * plotW;
  const y = v => m.top + plotH - (v / top) * plotH;
  return { width, height, n, ticks, top, m, plotW, plotH, x, y, x0, dir };
}

function draw(st) {
  const { svg, opts } = st;
  const L = layout(st);
  st.L = L;
  const { width, height, x, y, m, ticks, n } = L;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('aria-label', opts.ariaLabel || '');
  svg.replaceChildren();

  // grid + y ticks
  // SVG text anchors follow `direction`: "start" is the reading start (right in RTL)
  svg.setAttribute('direction', opts.rtl ? 'rtl' : 'ltr');
  const grid = s('g', { class: 'chart-grid' });
  const plotLeft = opts.rtl ? m.end : m.start;
  const plotRight = opts.rtl ? width - m.start : width - m.end;
  const yLabelX = opts.rtl ? width - 4 : 4;
  for (const t of ticks) {
    const yy = Math.round(y(t)) + 0.5;
    grid.append(s('line', { x1: plotLeft, x2: plotRight, y1: yy, y2: yy, class: t === 0 ? 'chart-base' : 'chart-line-grid' }));
    grid.append(s('text', { x: yLabelX, y: yy + 4, class: 'chart-tick', 'text-anchor': 'start' }, opts.formatTick(t)));
  }
  svg.append(grid);

  // x ticks: today + evenly spaced months
  const xg = s('g', { class: 'chart-x' });
  const slots = Math.max(2, Math.min(n - 1, Math.floor(width / 118)));
  const used = new Set();
  for (let k = 0; k <= slots; k++) {
    const i = Math.round((k / slots) * (n - 1));
    if (used.has(i)) continue;
    used.add(i);
    const anchor = k === 0 ? 'start' : k === slots ? 'end' : 'middle';
    xg.append(s('text', { x: x(i), y: height - 8, class: 'chart-tick', 'text-anchor': anchor }, opts.tickLabelAt(i)));
  }
  svg.append(xg);

  // series: unselected first so the selected one sits on top
  const ordered = [...opts.series].sort((a, b) => (a.key === opts.selected) - (b.key === opts.selected));
  for (const se of ordered) {
    if (se.values.length < 2) continue;
    const isSel = se.key === opts.selected;
    if (isSel) {
      const last = se.values.length - 1;
      const area = `${pathFor(se.values, x, y)}L${x(last).toFixed(1)} ${y(0).toFixed(1)}L${x(0).toFixed(1)} ${y(0).toFixed(1)}Z`;
      svg.append(s('path', { d: area, class: `chart-area series-${se.key}` }));
    }
    svg.append(s('path', { d: pathFor(se.values, x, y), class: `chart-path series-${se.key}${isSel ? ' is-selected' : ''}` }));
  }
  // milestone dots on the selected series, end dots on both
  for (const se of opts.series) {
    const isSel = se.key === opts.selected;
    if (isSel && se.events) {
      for (const idx of Object.keys(se.events).map(Number)) {
        if (idx >= se.values.length - 1) continue;
        svg.append(s('circle', { cx: x(idx), cy: y(se.values[idx]), r: 4, class: `chart-dot series-${se.key}` }));
      }
    }
    const last = se.values.length - 1;
    if (last > 0) svg.append(s('circle', { cx: x(last), cy: y(se.values[last]), r: isSel ? 5 : 4, class: `chart-dot series-${se.key}` }));
  }

  // crosshair layer
  const cross = s('g', { class: 'chart-cross', visibility: 'hidden' });
  cross.append(s('line', { y1: m.top, y2: height - m.bottom, class: 'chart-cross-line' }));
  for (const se of opts.series) cross.append(s('circle', { r: 5, class: `chart-dot series-${se.key}`, 'data-key': se.key }));
  svg.append(cross);
  st.cross = cross;

  // generous hit area over the whole plot
  const hit = s('rect', { x: 0, y: 0, width, height, class: 'chart-hit' });
  svg.append(hit);

  if (st.index !== null) show(st, Math.min(st.index, n - 1));
}

function nearestIndex(st, clientX) {
  const rect = st.svg.getBoundingClientRect();
  const px = ((clientX - rect.left) / rect.width) * st.L.width;
  const { x0, dir, plotW, n } = st.L;
  const t = ((px - x0) * dir) / plotW;
  return Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
}

function show(st, i) {
  const { opts, L, cross, tip } = st;
  st.index = i;
  const xx = Math.round(L.x(i)) + 0.5;
  cross.setAttribute('visibility', 'visible');
  const line = cross.querySelector('line');
  line.setAttribute('x1', xx);
  line.setAttribute('x2', xx);
  for (const dot of cross.querySelectorAll('circle')) {
    const se = opts.series.find(v => v.key === dot.dataset.key);
    const has = se && i < se.values.length;
    dot.setAttribute('visibility', has ? 'visible' : 'hidden');
    if (has) {
      dot.setAttribute('cx', xx);
      dot.setAttribute('cy', L.y(se.values[i]));
    }
  }

  // tooltip: values lead, labels follow; text via textContent only
  const rows = [h('div', { class: 'chart-tip-date', text: opts.labelAt(i) })];
  for (const se of opts.series) {
    const v = i < se.values.length ? se.values[i] : 0;
    rows.push(h('div', { class: 'chart-tip-row' },
      h('span', { class: `chart-key series-${se.key}` }),
      h('b', { text: opts.formatValue(v) }),
      h('span', { class: 'chart-tip-label', text: se.label }),
    ));
  }
  const sel = opts.series.find(v => v.key === opts.selected);
  for (const label of (sel && sel.events && sel.events[i]) || []) {
    rows.push(h('div', { class: 'chart-tip-event', text: `✓ ${label}` }));
  }
  tip.replaceChildren(...rows);
  tip.classList.add('on');
  const rootW = st.root.clientWidth;
  const scale = st.svg.getBoundingClientRect().width / L.width || 1;
  const px = xx * scale;
  const tw = tip.offsetWidth;
  let left = px + 14;
  if (left + tw > rootW - 4) left = px - tw - 14;
  tip.style.setProperty('--tip-x', `${Math.max(4, left)}px`);
}

function hide(st) {
  st.index = null;
  if (st.cross) st.cross.setAttribute('visibility', 'hidden');
  st.tip.classList.remove('on');
}

function bind(st) {
  const { root } = st;
  root.addEventListener('pointermove', e => show(st, nearestIndex(st, e.clientX)));
  root.addEventListener('pointerdown', e => show(st, nearestIndex(st, e.clientX)));
  root.addEventListener('pointerleave', e => {
    if (e.pointerType === 'mouse') hide(st);
  });
  root.addEventListener('focus', () => show(st, st.index ?? 0));
  root.addEventListener('blur', () => hide(st));
  root.addEventListener('keydown', e => {
    if (!st.L) return;
    const fwd = st.opts.rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = st.opts.rtl ? 'ArrowRight' : 'ArrowLeft';
    const cur = st.index ?? 0;
    let next = null;
    if (e.key === fwd) next = cur + 1;
    else if (e.key === back) next = cur - 1;
    else if (e.key === 'PageDown') next = cur + 12;
    else if (e.key === 'PageUp') next = cur - 12;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = st.L.n - 1;
    else if (e.key === 'Escape') {
      hide(st);
      return;
    }
    if (next === null) return;
    e.preventDefault();
    show(st, Math.max(0, Math.min(st.L.n - 1, next)));
  });
}
