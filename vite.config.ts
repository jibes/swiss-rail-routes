/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Origin of the OJP Worker (repo variable OJP_WORKER_URL in CI); added to the CSP connect-src.
const ojpUrl = process.env.VITE_OJP_URL ?? '';
const ojpOrigin = ojpUrl ? new URL(ojpUrl).origin : '';

const build = {
  sha: execSync('git rev-parse --short HEAD').toString().trim(),
  time: new Date().toISOString(),
  version: (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version,
};

export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  define: { __BUILD__: JSON.stringify(build) },
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'] },
  plugins: [
    react(),
    {
      name: 'csp-connect',
      transformIndexHtml: (html) =>
        ojpOrigin ? html.replace("connect-src 'self'", `connect-src 'self' ${ojpOrigin}`) : html,
    },
    {
      name: 'version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(build) });
      },
    },
    VitePWA({
      registerType: 'prompt',
      injectRegister: false, // registerSW() in App drives the update banner
      manifest: {
        name: 'Viadukt – Swiss rail day trips',
        short_name: 'Viadukt',
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: '#f7f7f5',
        background_color: '#f7f7f5',
        icons: [
          { src: 'icons/192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        clientsClaim: true,
        // mjs: MapLibre's worker; without it the map breaks offline and after a deploy.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,wasm,json}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // stops.v1.json
        navigateFallback: 'index.html',
      },
    }),
  ],
});
