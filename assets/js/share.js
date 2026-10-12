/* Debt Free — progress story card (no amounts) and calendar reminder (.ics). */

const FONT = '"IBM Plex Sans Arabic", system-ui, sans-serif';

function ring(ctx, cx, cy, r, width, pct) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  if (pct <= 0) {
    ctx.restore();
    return;
  }
  const grad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  grad.addColorStop(0, '#34d399');
  grad.addColorStop(1, '#f5c66b');
  ctx.strokeStyle = grad;
  ctx.beginPath();
  const start = -Math.PI / 2;
  ctx.arc(cx, cy, r, start, start + Math.PI * 2 * Math.min(1, pct / 100));
  ctx.stroke();
  ctx.restore();
}

function mark(ctx, x, y, size) {
  const k = size / 64;
  const g = ctx.createLinearGradient(x, y, x + size, y + size);
  g.addColorStop(0, '#10b981');
  g.addColorStop(1, '#065f46');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, 16 * k);
  ctx.fill();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5 * k;
  ctx.beginPath();
  ctx.arc(x + 32 * k, y + 32 * k, 17 * k, -Math.PI / 2, (200 / 180) * Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 24.5 * k, y + 32.5 * k);
  ctx.lineTo(x + 29.5 * k, y + 37.5 * k);
  ctx.lineTo(x + 40 * k, y + 26 * k);
  ctx.stroke();
  ctx.fillStyle = '#fcd34d';
  ctx.beginPath();
  ctx.arc(x + 16.03 * k, y + 26.19 * k, 3.6 * k, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Render a 1080x1920 story card. Contains percentages and durations only —
 * never balances — so it is safe to post publicly.
 */
export async function makeProgressCard({ rtl, appName, title, progressText, subText, pct, footer, url }) {
  if (document.fonts && document.fonts.load) {
    await Promise.all([document.fonts.load(`700 64px ${FONT}`), document.fonts.load(`500 40px ${FONT}`)]).catch(() => {});
  }
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#071021');
  bg.addColorStop(1, '#04140f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  for (const [gx, gy, gr, col] of [[W * 0.85, 260, 700, 'rgba(16,185,129,0.30)'], [W * 0.1, H - 200, 800, 'rgba(59,130,246,0.18)']]) {
    const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    glow.addColorStop(0, col);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }

  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  mark(ctx, W / 2 - 56, 170, 112);
  ctx.fillStyle = '#f1f5f9';
  ctx.font = `700 52px ${FONT}`;
  ctx.fillText(appName, W / 2, 360);
  ctx.fillStyle = 'rgba(241,245,249,0.7)';
  ctx.font = `500 38px ${FONT}`;
  ctx.fillText(title, W / 2, 420);

  ring(ctx, W / 2, 900, 300, 46, pct);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 168px ${FONT}`;
  ctx.direction = 'ltr';
  ctx.fillText(`${pct}%`, W / 2, 960);
  ctx.direction = rtl ? 'rtl' : 'ltr';

  ctx.fillStyle = '#f5c66b';
  ctx.font = `700 70px ${FONT}`;
  ctx.fillText(progressText, W / 2, 1360);
  ctx.fillStyle = 'rgba(241,245,249,0.82)';
  ctx.font = `500 46px ${FONT}`;
  ctx.fillText(subText, W / 2, 1450);

  ctx.fillStyle = 'rgba(241,245,249,0.62)';
  ctx.font = `500 34px ${FONT}`;
  ctx.fillText(footer, W / 2, H - 190);
  ctx.direction = 'ltr';
  ctx.fillStyle = 'rgba(241,245,249,0.45)';
  ctx.font = `500 30px ${FONT}`;
  ctx.fillText(url, W / 2, H - 135);

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

/* ---------------- .ics ---------------- */

const enc = new TextEncoder();

function escapeText(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 line folding at 75 octets without splitting a UTF-8 character. */
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const pad = n => String(n).padStart(2, '0');

/** Monthly recurring all-day reminder with a 9:00 alert. */
export function makeReminderICS({ day, title, description, now = new Date() }) {
  let start = new Date(now.getFullYear(), now.getMonth(), day);
  if (start < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    start = new Date(now.getFullYear(), now.getMonth() + 1, day);
  }
  const date = `${start.getFullYear()}${pad(start.getMonth() + 1)}${pad(start.getDate())}`;
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//X Star Software//Debt Free//AR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:debtfree-reminder-${stamp}@debt-free-tracker`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${date}`,
    `RRULE:FREQ=MONTHLY;BYMONTHDAY=${day}`,
    `SUMMARY:${escapeText(title)}`,
    `DESCRIPTION:${escapeText(description)}`,
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:PT9H',
    `DESCRIPTION:${escapeText(title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
