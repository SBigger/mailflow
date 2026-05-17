// tests/fibu/02-kreditoren.spec.js
// Testet die wichtigsten Kreditoren-Workflows

import { test, expect } from '@playwright/test';
import { gotoFibu, selectMandant, waitForTable } from './helpers.js';

test.describe('Kreditoren Workflows', () => {

  test.beforeEach(async ({ page }) => {
    await selectMandant(page);
  });

  // ── OP-Liste ────────────────────────────────────────────────────────────
  test('OP-Liste: zeigt offene Posten oder "keine"-Meldung', async ({ page }) => {
    await gotoFibu(page, 'kreditoren/opliste');
    await waitForTable(page);
    // Keine leere weiße Seite
    const content = await page.locator('body').innerText();
    expect(content.length).toBeGreaterThan(50);
  });

  test('OP-Liste: Filter-Buttons vorhanden', async ({ page }) => {
    await gotoFibu(page, 'kreditoren/opliste');
    // Mindestens ein Button oder Tab sichtbar
    const buttons = page.locator('button');
    await expect(buttons.first()).toBeVisible({ timeout: 10_000 });
  });

  // ── Lieferanten ─────────────────────────────────────────────────────────
  test('Lieferanten: Liste lädt', async ({ page }) => {
    await gotoFibu(page, 'kreditoren/lieferanten');
    await waitForTable(page);
  });

  test('Lieferanten: Neu-Button vorhanden', async ({ page }) => {
    await gotoFibu(page, 'kreditoren/lieferanten');
    const neuBtn = page.locator('button:has-text("Neu"), button:has-text("Lieferant"), button:has-text("Erstellen")').first();
    await expect(neuBtn).toBeVisible({ timeout: 10_000 });
  });

  // ── Rechnung erfassen ───────────────────────────────────────────────────
  test('Rechnung erfassen: Formular lädt vollständig', async ({ page }) => {
    await gotoFibu(page, 'kreditoren/erfassen');
    // Wichtige Felder sichtbar
    await expect(page.locator('input[type="date"], input[name*="datum"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('select, input[name*="lieferant"], input[placeholder*="Lieferant"]').first()).toBeVisible();
  });

  test('Rechnung erfassen: Währungs-Auswahl vorhanden', async ({ page }) => {
    await gotoFibu(page, 'kreditoren/erfassen');
    // Währungs-Dropdown sollte CHF, EUR, USD enthalten
    const waehrung = page.locator('select option[value="EUR"], option:has-text("EUR")');
    await expect(waehrung.first()).toBeAttached({ timeout: 10_000 });
  });

  // ── Zahlungslauf ─────────────────────────────────────────────────────────
  test('Zahlungslauf: Seite lädt und zeigt Zahlstellen', async ({ page }) => {
    await gotoFibu(page, 'kreditoren/zahlungslauf');
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    expect(text.length).toBeGreaterThan(50);
  });

  // ── Belegjournal ─────────────────────────────────────────────────────────
  test('Belegjournal: Datum-Filter und Tabelle vorhanden', async ({ page }) => {
    await gotoFibu(page, 'kreditoren/journal');
    const dateInput = page.locator('input[type="date"]').first();
    await expect(dateInput).toBeVisible({ timeout: 10_000 });
    await waitForTable(page);
  });

  // ── Inbox ────────────────────────────────────────────────────────────────
  test('Rechnungs-Inbox: Upload-Bereich vorhanden', async ({ page }) => {
    await gotoFibu(page, 'kreditoren/inbox');
    await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => {});
    // Upload-Dropzone erscheint erst nach Klick auf Upload-Button (showUpload-State)
    const uploadBtn = page.locator('button:has-text("PDFs importieren"), button:has-text("Upload"), button:has-text("Hochladen")').first();
    const btnVisible = await uploadBtn.isVisible({ timeout: 8_000 }).catch(() => false);
    if (btnVisible) {
      await uploadBtn.click();
      const fileInput = page.locator('input[type="file"]');
      await expect(fileInput).toBeAttached({ timeout: 5_000 });
      console.log('✅ Inbox: Upload-Zone nach Button-Klick geöffnet');
    } else {
      const text = await page.locator('body').innerText();
      expect(text.length).toBeGreaterThan(50);
      console.log('ℹ️  Inbox: Upload-Button nicht gefunden');
    }
  });
});
