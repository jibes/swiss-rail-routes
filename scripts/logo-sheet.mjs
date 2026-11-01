import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const all = [
  ['a-line', 'A · Die Linie'],
  ['b-loop', 'B · Rundreise'],
  ['c-daylight', 'C · Tageslicht'],
  ['d-spiral', 'D · Kehrtunnel'],
  ['e-summit', 'E · Gipfel'],
  ['f-viaduct', 'F · Viadukt'],
  ['g-dayarc', 'G · Tagesbogen'],
  ['h-vanish', 'H · Fluchtpunkt'],
];
const variants = [
  ['variants/h1-fluchtpunkt', 'H1 · Fluchtpunkt'],
  ['variants/h2-fluchtpunkt-tag', 'H2 · Fluchtpunkt, Tag'],
  ['variants/h3-fluchtpunkt-nacht', 'H3 · Fluchtpunkt, Nacht'],
  ['variants/a1-linie-kraeftig', 'A1 · Linie, kräftig'],
  ['variants/a2-linie-bogen', 'A2 · Linie, Bogen'],
  ['variants/a3-linie-hell', 'A3 · Linie, hell'],
  ['variants/d1-kehrtunnel', 'D1 · Kehrtunnel'],
  ['variants/d2-kehrtunnel-geometrisch', 'D2 · Kehrtunnel, geometrisch'],
  ['variants/d3-kehrtunnel-hell', 'D3 · Kehrtunnel, hell'],
];
// `node scripts/logo-sheet.mjs` → comparison.png; `… variants` → variants.png (3 a row);
// `… d e f` renders only those sets to a scratch file.
const only = process.argv.slice(2);
const isVariants = only[0] === 'variants';
const sets = isVariants ? variants : only.length ? all.filter(([k]) => only.includes(k[0])) : all;
const out = isVariants
  ? 'docs/design/logos/variants.png'
  : only.length
    ? '/tmp/logo-sheet.png'
    : 'docs/design/logos/comparison.png';
const width = isVariants ? 1150 : 1440;
const read = (k, f) =>
  'data:image/svg+xml;base64,' +
  Buffer.from(readFileSync(`docs/design/logos/${k}/${f}.svg`)).toString('base64');
const col = ([k, title]) => `
<section>
  <h2>${title}</h2>
  <img class="big" src="${read(k, 'icon')}">
  <div class="row">
    <img class="sq" src="${read(k, 'icon')}"><img class="circle" src="${read(k, 'icon')}">
    <span class="mono"><img src="${read(k, 'monochrome')}"></span>
  </div>
  <div class="home light"><img src="${read(k, 'icon')}"><span>Rail Day Trip</span></div>
  <div class="home dark"><img src="${read(k, 'icon')}"><span>Rail Day Trip</span></div>
  <div class="tab"><img width="16" height="16" src="${read(k, 'favicon')}"><span>Swiss Rail Day-Trip</span><img width="32" height="32" src="${read(k, 'favicon')}"></div>
</section>`;
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:40px;background:#ececE8;font-family:system-ui,sans-serif;color:#121314;display:flex;flex-wrap:wrap;gap:32px;width:${width}px}
section{background:#fff;border-radius:24px;padding:28px;width:300px;display:flex;flex-direction:column;gap:18px;align-items:center}
h2{margin:0;font-size:20px}
.big{width:200px;height:200px;border-radius:44px;box-shadow:0 8px 30px rgb(0 0 0/.15)}
.row{display:flex;gap:16px;align-items:center}
.sq{width:72px;height:72px;border-radius:22px}.circle{width:72px;height:72px;border-radius:50%}
.mono{width:72px;height:72px;border-radius:50%;background:#dfe3f3;display:grid;place-items:center}
.mono img{width:72px;height:72px;filter:invert(23%) sepia(30%) saturate(900%) hue-rotate(190deg)}
.home{width:100%;border-radius:16px;padding:16px;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:12px}
.home img{width:56px;height:56px;border-radius:50%}
.light{background:linear-gradient(135deg,#cfe0ee,#f3e7d8)}.dark{background:linear-gradient(135deg,#1c2433,#0b0d12);color:#fff}
.tab{display:flex;align-items:center;gap:8px;background:#f1f3f4;border-radius:10px 10px 0 0;padding:8px 12px;font-size:13px;width:100%}
.tab span{flex:1}
</style>${sets.map(col).join('')}`;
writeFileSync('docs/design/logos/.sheet.html', html);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await b.newPage({ viewport: { width: width + 80, height: 900 }, deviceScaleFactor: 2 });
await p.goto('file://' + process.cwd() + '/docs/design/logos/.sheet.html');
await p.screenshot({ path: out, fullPage: true });
await b.close();
