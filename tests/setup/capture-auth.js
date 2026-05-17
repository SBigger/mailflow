#!/usr/bin/env node
// tests/setup/capture-auth.js
// Öffnet einen Browser, wartet auf manuellen Login, speichert dann die Session.
// Einmalig ausführen: node tests/setup/capture-auth.js

import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, '.auth-state.json');
const BASE_URL  = process.env.TEST_BASE_URL || 'http://localhost:3000';

console.log('\n🔐 Artis FiBu – Auth Session Capture');
console.log('====================================');
console.log('Ein Browser öffnet sich. Bitte einloggen.');
console.log('Nach dem Login wird die Session automatisch gespeichert.\n');

const browser = await chromium.launch({
  headless: false,
  channel: 'chrome',   // nutzt installierten Google Chrome (kein Download nötig)
  args: ['--start-maximized'],
});

const context = await browser.newContext({ viewport: null });
const page    = await context.newPage();

await page.goto(BASE_URL);
console.log('⏳ Warte auf Login...');

// Warte bis die App weg vom Login ist (irgendeine andere Seite)
// Nach Login → /Dashboard oder /Dokumente (App.jsx Routing)
try {
  await page.waitForURL(
    url => url.pathname !== '/' && !url.pathname.includes('login') && !url.pathname.includes('auth'),
    { timeout: 5 * 60 * 1000 }  // 5 Minuten Zeit zum Einloggen
  );
} catch {
  // Fallback: Supabase-Token im localStorage prüfen
  const hasToken = await page.evaluate(() =>
    Object.keys(localStorage).some(k => k.includes('supabase') || k.includes('sb-'))
  ).catch(() => false);
  if (!hasToken) throw new Error('Login nicht erkannt – bitte nochmal versuchen');
}

// Kurz warten damit alle Tokens im localStorage gelanden sind
await page.waitForTimeout(2000);

// Session speichern
await context.storageState({ path: AUTH_FILE });
console.log('\n✅ Session gespeichert:', AUTH_FILE);
console.log('   Du kannst diesen Browser jetzt schliessen.');
console.log('\n🚀 Starte nun die Tests mit:');
console.log('   npx playwright test --project=fibu\n');

// Browser offen lassen bis der User ihn schliesst
await page.waitForTimeout(5000);
await browser.close();
