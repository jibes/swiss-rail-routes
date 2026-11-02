import { defineConfig, devices } from '@playwright/test';

const base = process.env.VITE_BASE && process.env.VITE_BASE !== './' ? process.env.VITE_BASE : '/';

export default defineConfig({
  testDir: 'e2e',
  // A stray test.only must not turn CI green with one test.
  forbidOnly: !!process.env.CI,
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
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
});
