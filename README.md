# محرر الديون — Debt Free Tracker

<div dir="rtl">

## نظرة عامة

**محرر الديون** تطبيق ويب لتخطيط سداد الديون ومتابعتها. يحسب لك تاريخ حريتك المالية،
ويقارن بين استراتيجيتَي السداد — **كرة الثلج ❄️** و **الانهيار الجليدي 🏔️** — ليبيّن لك
أيهما ينهي ديونك أسرع وأيهما يوفّر فوائد أكثر.

## الخصوصية أولاً

بياناتك **لا تغادر جهازك أبداً**. لا خوادم، ولا حسابات، ولا تتبّع، ولا تحليلات.
كل شيء يُحفظ محلياً في متصفحك عبر IndexedDB، ويمكنك تصدير نسخة احتياطية أو
مسح كل شيء متى شئت.

## المميزات

- حساب تاريخ التحرر من الديون وإجمالي الفوائد المتوقعة
- مقارنة مباشرة بين كرة الثلج والانهيار الجليدي
- دفعة إضافية شهرية لرؤية أثرها فوراً
- جدول سداد شهري ورسم بياني لتناقص الديون
- عربي (RTL) وإنجليزي (LTR) — الوضع الليلي والنهاري
- يعمل بدون إنترنت، وقابل للتثبيت على الجوال (PWA)
- تصدير واستعادة نسخة احتياطية بصيغة JSON

## التشغيل

افتح `index.html` مباشرة في المتصفح، أو شغّل خادماً محلياً:

```bash
python -m http.server 8080
```

لا توجد خطوة بناء ولا اعتماديات — التطبيق ملف HTML واحد مكتفٍ بذاته.

</div>

---

## Overview

**Debt Free Tracker** is a web app for planning and tracking debt payoff. It calculates
your financial freedom date and compares the two payoff strategies — **Snowball ❄️** and
**Avalanche 🏔️** — showing which clears your debts sooner and which saves more interest.

## Privacy first

Your data **never leaves your device**. No servers, no accounts, no tracking, no analytics.
Everything is stored locally in your browser via IndexedDB. Export a backup or wipe
everything at any time.

## Features

- Debt-free date and projected total interest
- Side-by-side Snowball vs. Avalanche comparison
- Extra monthly payment with instant impact
- Monthly amortization table and payoff chart
- Arabic (RTL) and English (LTR), dark and light themes
- Works offline, installable on mobile (PWA)
- JSON backup export and restore

## Running it

Open `index.html` in a browser, or serve it locally:

```bash
python -m http.server 8080
```

No build step, no dependencies — the app is a single self-contained HTML file.

## Project structure

| File | Purpose |
|---|---|
| `index.html` | The deployed app (single file: logic, CSS, i18n) |
| `debt-free-tracker.html` | Original source file, kept verbatim |
| `manifest.json` | PWA manifest |
| `sw.js` | Service worker — offline caching only |
| `icon-192.png`, `icon-512.png`, `favicon.ico` | App icons |
| `tools/make-icons.py` | Regenerates the icons locally (Pillow) |

---

Built by **X Star Software** — [@xstar.kw](https://www.instagram.com/xstar.kw)
