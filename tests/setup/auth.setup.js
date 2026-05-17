// tests/setup/auth.setup.js
// Prüft ob eine gültige Auth-Session vorhanden ist.
// Falls nicht: Fehlermeldung mit Anweisung zum capture-auth.js Script.

import { test as setup, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, '.auth-state.json');

setup('Auth-Session vorhanden', async ({ page }) => {
  // Prüfen ob Session-Datei existiert
  if (!fs.existsSync(AUTH_FILE)) {
    throw new Error(
      '\n❌ Keine Auth-Session gefunden!\n\n' +
      '   Bitte einmalig ausführen:\n' +
      '   node tests/setup/capture-auth.js\n\n' +
      '   Ein Browser öffnet sich → einloggen → Session wird gespeichert.\n'
    );
  }

  // Prüfen ob Session noch gültig ist (< 23h alt)
  const age = Date.now() - fs.statSync(AUTH_FILE).mtimeMs;
  if (age > 23 * 60 * 60 * 1000) {
    console.warn('⚠️  Auth-Session älter als 23h – empfehle neu einloggen via capture-auth.js');
  }

  // Kurz verifizieren dass die App mit dieser Session erreichbar ist
  await page.goto('/Dashboard');
  await page.waitForLoadState('networkidle');

  // Nicht auf Login-Seite gelandet = eingeloggt
  const currentUrl = page.url();
  const isLoggedIn = !currentUrl.includes('login') && currentUrl !== 'http://localhost:3000/';
  if (!isLoggedIn) {
    // Session ungültig – neu erfassen
    fs.unlinkSync(AUTH_FILE);
    throw new Error(
      '\n❌ Session abgelaufen oder ungültig!\n\n' +
      '   Bitte erneut ausführen:\n' +
      '   node tests/setup/capture-auth.js\n'
    );
  }

  console.log('✅ Auth-Session gültig (Alter:', Math.round(age / 60000), 'min)');
});
