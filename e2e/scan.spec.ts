import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderSVG } from 'uqr';
import { newKey } from '../src/core/sync';
import { answerWorker, expect, test } from './fixtures';

// The camera is a file: Chromium plays an MJPEG as the webcam. The frame shows the code that
// Settings → Add a device shows, so this reads it as a phone would (through jsQR: headless
// Linux Chromium has no BarcodeDetector).
test('scans the sync code with the camera into the key field', async ({
  page,
  playwright,
  baseURL,
}) => {
  const key = newKey();
  const link = `https://jibes.github.io/swiss-rail-routes/#/sync/${key}`;
  await page.setViewportSize({ width: 640, height: 480 });
  await page.setContent(
    `<body style="margin:0;background:#fff;display:grid;place-items:center;height:480px">
      <div style="width:400px;height:400px">${renderSVG(link, { border: 2 }).replace('<svg ', '<svg width="400" height="400" ')}</div></body>`,
  );
  const frame = await page.screenshot({ type: 'jpeg', quality: 95 });
  const file = join(tmpdir(), `srr-scan-${process.pid}.mjpeg`);
  writeFileSync(file, Buffer.concat([frame, frame, frame]));

  const browser = await playwright.chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${file}`,
    ],
  });
  const ctx = await browser.newContext({ baseURL, permissions: ['camera'] });
  const phone = await ctx.newPage();
  await answerWorker(phone);
  await phone.goto('./#/settings');
  await phone.getByRole('button', { name: 'I have a key' }).click();
  await phone.getByRole('button', { name: 'Scan code' }).click();
  await expect(phone.getByLabel('Key from your other device')).toHaveValue(key, {
    timeout: 15_000,
  });
  await expect(phone.getByRole('button', { name: 'Close camera' })).toHaveCount(0);
  await expect(phone.getByRole('button', { name: 'Join sync' })).toBeEnabled();
  await browser.close();
});
