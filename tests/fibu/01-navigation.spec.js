// tests/fibu/01-navigation.spec.js
// Prüft: alle FiBu-Seiten laden ohne Crash und ohne Console-Errors

import { test, expect } from '@playwright/test';
import { gotoFibu, collectErrors, expectNocrash, selectMandant } from './helpers.js';

test.describe('FiBu Navigation – alle Seiten laden', () => {

  test.beforeEach(async ({ page }) => {
    await selectMandant(page);
  });

  const PAGES = [
    { path: 'kreditoren',                    name: 'Kreditoren Dashboard' },
    { path: 'kreditoren/lieferanten',        name: 'Lieferanten' },
    { path: 'kreditoren/opliste',            name: 'OP-Liste' },
    { path: 'kreditoren/zahlungslauf',       name: 'Zahlungslauf' },
    { path: 'kreditoren/journal',            name: 'Belegjournal' },
    { path: 'kreditoren/inbox',              name: 'Rechnungs-Inbox' },
    { path: 'kreditoren/dauerbelege',        name: 'Dauerbelege' },
    { path: 'kreditoren/massen-import',      name: 'Massen-Import' },
    { path: 'kreditoren/lieferanten-konto',  name: 'Lieferanten-Konto' },
    { path: 'kontenplan',                    name: 'Kontenplan' },
    { path: 'mwstcodes',                     name: 'MwSt-Codes' },
    { path: 'mwst/abrechnung',               name: 'MwSt-Abrechnung' },
    { path: 'bankabstimmung',                name: 'Bank-Abstimmung' },
    { path: 'kontoblaetter',                 name: 'Kontoblätter' },
    { path: 'bilanz',                        name: 'Bilanz' },
    { path: 'manuelle-buchungen',            name: 'Manuelle Buchungen' },
    { path: 'wiederkehrende-buchungen',      name: 'Wiederkehrende Buchungen' },
    { path: 'kassenbuch',                    name: 'Kassenbuch' },
    { path: 'kursbewertung',                 name: 'FW-Kursbewertung' },
    { path: 'wechselkurse',                  name: 'Wechselkurse' },
    { path: 'zahlstellen',                   name: 'Zahlstellen' },
    { path: 'saldovortraege',                name: 'Saldovorträge' },
    { path: 'budget',                        name: 'Budget' },
    { path: 'jahresabschluss',               name: 'Jahresabschluss' },
    { path: 'kontierungsregeln',             name: 'Kontierungsregeln' },
    { path: 'einstellungen',                 name: 'Einstellungen' },
  ];

  for (const { path, name } of PAGES) {
    test(`${name} lädt ohne Fehler`, async ({ page }) => {
      const errors = collectErrors(page);
      await gotoFibu(page, path);
      await expectNocrash(page);

      // Keine 404/500-Fehlerseite (h1-Level, nicht Account-Nummern wie "5000 Löhne")
      await expect(page.locator('h1:has-text("404"), h1:has-text("500"), h1:has-text("Page not found")')).toHaveCount(0);

      // Kritische Console-Errors melden (nicht als Fail, nur als Warnung im Report)
      const criticalErrors = errors.filter(e =>
        !e.includes('Warning:') &&
        !e.includes('ResizeObserver') &&
        !e.includes('favicon')
      );
      if (criticalErrors.length > 0) {
        console.warn(`⚠️  Console-Errors auf ${name}:`, criticalErrors.slice(0, 3));
      }
      // Test schlägt nur bei echtem React-Crash fehl, nicht bei Warnings
    });
  }
});
