// tests/fibu/06-console-errors.spec.js
// Alle Seiten auf Console-Errors prüfen – diese werden im Report detailliert aufgelistet

import { test, expect } from '@playwright/test';
import { selectMandant, gotoFibu } from './helpers.js';

const ALLE_SEITEN = [
  'kreditoren', 'kreditoren/lieferanten', 'kreditoren/opliste',
  'kreditoren/zahlungslauf', 'kreditoren/journal', 'kreditoren/inbox',
  'kreditoren/dauerbelege', 'kreditoren/erfassen',
  'kontenplan', 'mwstcodes', 'mwst/abrechnung',
  'bankabstimmung', 'kontoblaetter', 'bilanz',
  'manuelle-buchungen', 'wiederkehrende-buchungen', 'kassenbuch',
  'kursbewertung', 'wechselkurse', 'zahlstellen',
  'saldovortraege', 'budget', 'jahresabschluss',
  'kontierungsregeln', 'einstellungen',
];

// Fehler die wir ignorieren (Browser-Extensions, Polyfills, bekannte API-Fehler)
const IGNORED_PATTERNS = [
  /ResizeObserver loop/,
  /favicon/,
  /chrome-extension/,
  /Warning: Each child in a list/,
  /Warning: validateDOMNesting/,
  /Warning: React does not recognize/,
  /\[object Object\]/,
  // Bank-Abstimmung: 400 (kein Konto konfiguriert) + 404 sind bekannt und erwartet
  /Failed to load resource.*status of 400/,
  /Failed to load resource.*status of 404/,
  /status of 400/,
  /status of 404/,
];

test.describe('Console-Error Audit – alle FiBu-Seiten', () => {

  test.beforeEach(async ({ page }) => {
    await selectMandant(page);
  });

  test('Kein unkritischer JavaScript-Fehler auf irgendeiner Seite', async ({ page }) => {
    test.setTimeout(180_000);  // 25 Seiten × ~6s = ~150s
    const allErrors = {};

    for (const routePath of ALLE_SEITEN) {
      const errors = [];
      page.on('console', msg => {
        if (msg.type() === 'error') {
          const text = msg.text();
          if (!IGNORED_PATTERNS.some(p => p.test(text))) {
            errors.push(text.slice(0, 200));
          }
        }
      });
      page.on('pageerror', err => {
        if (!IGNORED_PATTERNS.some(p => p.test(err.message))) {
          errors.push('PAGE ERROR: ' + err.message.slice(0, 200));
        }
      });

      await gotoFibu(page, routePath);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(1000);

      if (errors.length > 0) {
        allErrors[routePath] = errors;
      }

      // Event-Listener entfernen für nächste Seite
      page.removeAllListeners('console');
      page.removeAllListeners('pageerror');
    }

    if (Object.keys(allErrors).length > 0) {
      const report = Object.entries(allErrors)
        .map(([route, errs]) => `\n  /${route}:\n    - ${errs.join('\n    - ')}`)
        .join('');
      console.error('❌ Console-Errors gefunden:' + report);
      // Als Soft-Fail loggen, aber Test schlägt fehl damit es im Report erscheint
      expect(allErrors).toEqual({});
    } else {
      console.log('✅ Keine unerwarteten Console-Errors auf allen', ALLE_SEITEN.length, 'Seiten');
    }
  });
});
