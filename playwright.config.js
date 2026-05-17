// playwright.config.js – FiBu E2E Test Suite
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.playwright'), override: false });

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,          // sequentiell – Supabase-RLS braucht klaren Mandanten-State
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],

  use: {
    baseURL: BASE_URL,
    headless: true,
    channel: 'chrome',               // nutzt installierten Google Chrome
    viewport: { width: 1400, height: 900 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    storageState: 'tests/setup/.auth-state.json',
  },

  projects: [
    // 1. Auth-Setup – läuft zuerst, speichert Session
    {
      name: 'setup',
      testMatch: '**/setup/auth.setup.js',
      use: { storageState: undefined },  // kein gespeicherter State hier
    },
    // 2. Alle FiBu-Tests
    {
      name: 'fibu',
      testMatch: '**/fibu/*.spec.js',
      dependencies: ['setup'],
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: true,   // nimmt laufenden Dev-Server, startet keinen neuen
    timeout: 30_000,
  },
});
