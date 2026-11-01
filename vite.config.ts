/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const build = {
  sha: execSync('git rev-parse --short HEAD').toString().trim(),
  time: new Date().toISOString(),
};

export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  define: { __BUILD__: JSON.stringify(build) },
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'] },
  plugins: [
    react(),
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
        name: 'Swiss Rail Day-Trip Planner',
        short_name: 'Rail Day Trip',
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: '#14161a',
        background_color: '#14161a',
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
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
});
