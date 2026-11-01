// Renders public/icons/icon.svg (rounded tile) and maskable.svg (full bleed, motif in the safe
// zone) to the PNG sizes in the manifest. Both SVGs come from `python3 scripts/logo-sets.py --apply`.
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const [name, size, src] of [
  ['192', 192, 'icon'],
  ['512', 512, 'icon'],
  ['maskable-512', 512, 'maskable'],
]) {
  const svg = await readFile(`public/icons/${src}.svg`, 'utf8');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`,
  );
  await page.screenshot({ path: `public/icons/${name}.png`, omitBackground: true });
}
await browser.close();
