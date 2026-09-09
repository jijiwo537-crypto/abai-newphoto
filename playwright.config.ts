import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'symbol-visual.spec.ts',
  timeout: 240000,
  fullyParallel: false,
  reporter: [['line']],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173/tests/symbol-visual.html',
    timeout: 120000,
    reuseExistingServer: false,
  },
  use: { baseURL: 'http://127.0.0.1:5173', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit-iphone', use: { ...devices['iPhone 13'] } },
  ],
});