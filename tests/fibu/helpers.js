// tests/fibu/helpers.js – Wiederverwendbare Hilfsfunktionen

import { expect } from '@playwright/test';

// Wird pro Test-Worker einmal gesetzt und danach wiederverwendet
let _mandantId = null;

/** Navigiert zur Mandanten-Auswahl, klickt den ersten Mandanten,
 *  und speichert die mandantId für alle weiteren Navigationen. */
export async function selectMandant(page) {
  // Falls mandantId bereits bekannt: direkt zu FiBu navigieren
  if (_mandantId) {
    await page.goto(`/fibu/${_mandantId}/kreditoren`);
    await page.waitForLoadState('networkidle');
    return;
  }

  // Mandanten-Auswahl öffnen
  await page.goto('/fibu');
  await page.waitForLoadState('networkidle');

  // Falls direkt in FiBu gelandet (redirected): mandantId aus URL holen
  const urlNow = page.url();
  const m = urlNow.match(/\/fibu\/([0-9a-f-]{36})\//);
  if (m) {
    _mandantId = m[1];
    return;
  }

  // Mandanten-Liste: ersten Mandanten anklicken
  const mandantBtn = page.locator('button, [role="button"], li, [class*="mandant"]')
    .filter({ hasText: /GmbH|AG|Treuhand|Einzelfirma|[A-Z][a-z]+/ })
    .first();

  await expect(mandantBtn).toBeVisible({ timeout: 15_000 });
  await mandantBtn.click();
  await page.waitForLoadState('networkidle');

  // mandantId aus der neuen URL extrahieren
  const urlAfter = page.url();
  const match = urlAfter.match(/\/fibu\/([0-9a-f-]{36})\//);
  if (!match) throw new Error(`Konnte mandantId nicht aus URL extrahieren: ${urlAfter}`);
  _mandantId = match[1];
}

/** Navigiert zu einer FiBu-Unterseite unter dem aktuellen Mandanten */
export async function gotoFibu(page, subPath) {
  if (!_mandantId) await selectMandant(page);
  await page.goto(`/fibu/${_mandantId}/${subPath}`);
  // networkidle kann bei Seiten mit Polling/WebSocket nie feuern → kurz warten, dann weiter
  await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => {});
  // Spinner abwarten
  await page.waitForSelector('text=/Lädt…|Loading/i', { state: 'hidden', timeout: 10_000 }).catch(() => {});
}

/** Sammelt Console-Errors der Seite */
export function collectErrors(page) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

/** Prüft dass kein React-Crash sichtbar ist */
export async function expectNocrash(page) {
  await expect(page.locator('text=/Something went wrong|Cannot read properties of undefined/i')).toHaveCount(0);
}

/** Wartet bis eine Tabelle mit Daten oder "keine Daten"-Meldung erscheint */
export async function waitForTable(page) {
  await page.waitForFunction(() => {
    const hasTable = document.querySelector('table tr') !== null;
    const bodyText = document.body.innerText || '';
    const hasEmpty = /keine|leer|vorhanden|Keine offenen/i.test(bodyText);
    return hasTable || hasEmpty;
  }, { timeout: 15_000 });
}
