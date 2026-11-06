import { defineConfig, devices } from '@playwright/test';

const base = process.env.VITE_BASE && process.env.VITE_BASE !== './' ? process.env.VITE_BASE : '/';

export default defineConfig({
  testDir: 'e2e',
  // A stray test.only must not turn CI green with one test.
  forbidOnly: !!process.env.CI,
  // Planning a whole trip through the UI takes up to ~25 s on a slow runner (sync, T4).
  timeout: 60_000,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  use: {
    baseURL: `http://localhost:4173${base}`,
    trace: 'retain-on-failure',
    // No transitions: checks (axe contrast) see final colours, not a fade between themes.
    reducedMotion: 'reduce',
    // Cloud sessions ship one preinstalled Chromium; CI installs the matching one.
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    // One column, as each screen is on its own; the columns of a wide screen (useColumns.ts,
    // from 860 px) have their own test at their own size (e2e/columns.spec.ts).
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 840, height: 800 } },
    },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
});
