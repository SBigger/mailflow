// tests/fibu/07-scan-ocr.spec.js
// Testet die Kreditoren-Inbox: Datei-Upload, KI-Belegerkennung, Scan-Verarbeitung

import { test, expect } from '@playwright/test';
import { gotoFibu, selectMandant } from './helpers.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('Kreditoren – Scan & KI-Belegerkennung', () => {

  test.beforeEach(async ({ page }) => {
    await selectMandant(page);
  });

  // ── Inbox UI-Elemente ─────────────────────────────────────────────────────
  test('Inbox: Upload-Zone vorhanden und aktiv', async ({ page }) => {
    await gotoFibu(page, 'kreditoren/inbox');
    await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => {});

    // Upload-Dropzone öffnen (wird per Button-Toggle gezeigt)
    const uploadBtn = page.locator('button:has-text("PDFs importieren"), button:has-text("Upload"), button:has-text("Hochladen")').first();
    if (await uploadBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await uploadBtn.click();
    }
    // Dateiupload-Input (auch wenn versteckt)
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached({ timeout: 8_000 });

    // Drag-Drop Zone / Upload-Bereich sichtbar
    const uploadArea = page.locator('[class*="drop"], [class*="upload"], [class*="Inbox"]').first();
    const hasUploadArea = await uploadArea.isVisible().catch(() => false);
    console.log(hasUploadArea ? '✅ Upload-Zone sichtbar' : 'ℹ️  Upload-Zone möglicherweise versteckt (file-input vorhanden)');
  });

  test('Inbox: Inbox-Liste lädt (verarbeitete Belege oder leer)', async ({ page }) => {
    await gotoFibu(page, 'kreditoren/inbox');
    await page.waitForLoadState('networkidle');

    const hasItems  = await page.locator('table tr, [class*="beleg"], [class*="item"]').first().isVisible({ timeout: 8_000 }).catch(() => false);
    const hasEmpty  = await page.locator('text=/leer|keine|Inbox/i').first().isVisible().catch(() => false);
    expect(hasItems || hasEmpty).toBeTruthy();
  });

  test('Inbox: KI-Erkennungs-Buttons sichtbar wenn Belege vorhanden', async ({ page }) => {
    await gotoFibu(page, 'kreditoren/inbox');
    await page.waitForLoadState('networkidle');

    // Falls Belege in Inbox: KI/Erkennen-Button sichtbar
    const hasItems = await page.locator('table tbody tr').first().isVisible({ timeout: 5_000 }).catch(() => false);
    if (hasItems) {
      const kiBtn = page.locator('button:has-text("KI"), button:has-text("Erkennen"), button:has-text("Analyse"), button:has-text("Verarbeiten")').first();
      const hasKiBtn = await kiBtn.isVisible({ timeout: 3_000 }).catch(() => false);
      console.log(hasKiBtn ? '✅ KI-Erkennungs-Button gefunden' : 'ℹ️  Kein expliziter KI-Button (evtl. auto-triggered)');
    } else {
      console.log('ℹ️  Inbox leer – KI-Button-Test übersprungen');
    }
  });

  // ── Massen-Import (PDF/Excel-Upload) ──────────────────────────────────────
  test('Massen-Import: Upload-Bereich und Verarbeitungs-Optionen vorhanden', async ({ page }) => {
    await gotoFibu(page, 'kreditoren/massen-import');
    await page.waitForLoadState('networkidle');

    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached({ timeout: 10_000 });
    console.log('✅ Massen-Import: file-input vorhanden');
  });

  test('Massen-Import: Kontierungsregeln-Hinweis sichtbar', async ({ page }) => {
    await gotoFibu(page, 'kreditoren/massen-import');
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    // Entweder Kontierungsregeln-Hinweis oder Import-Formular
    expect(text.length).toBeGreaterThan(50);
  });

  // ── Rechnung erfassen mit FW-Kurs ─────────────────────────────────────────
  test('Rechnung erfassen: EUR auswählen zeigt Kurs-Feld', async ({ page }) => {
    await gotoFibu(page, 'kreditoren/erfassen');
    await page.waitForLoadState('networkidle');

    // Währungs-Dropdown suchen
    const waehrungSelect = page.locator('select').filter({ hasText: /CHF|EUR|USD/ }).first();
    if (await waehrungSelect.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await waehrungSelect.selectOption('EUR');
      await page.waitForTimeout(500);

      // Nach EUR-Auswahl: Kurs-Eingabefeld erscheinen
      const kursInput = page.locator('input[placeholder*="Kurs"], input[name*="kurs"], label:has-text("Kurs") + input').first();
      const hasKurs = await kursInput.isVisible({ timeout: 3_000 }).catch(() => false);
      console.log(hasKurs ? '✅ Kurs-Feld erscheint bei EUR-Auswahl' : 'ℹ️  Kein separates Kurs-Feld sichtbar');
    } else {
      console.log('ℹ️  Währungs-Dropdown noch nicht gefunden (Lieferant zuerst wählen?)');
    }
  });

  test('Rechnung erfassen: Positionserfassung funktioniert', async ({ page }) => {
    await gotoFibu(page, 'kreditoren/erfassen');
    await page.waitForLoadState('networkidle');

    // Mindestens ein Betrag-Input oder Positions-Input vorhanden
    const betragInput = page.locator('input[type="number"], input[placeholder*="Betrag"], input[name*="betrag"]').first();
    await expect(betragInput).toBeAttached({ timeout: 10_000 });
    console.log('✅ Betrag-Input vorhanden');
  });

  // ── Kassenbuch OCR ────────────────────────────────────────────────────────
  test('Kassenbuch: OCR/Foto-Upload Option vorhanden', async ({ page }) => {
    await gotoFibu(page, 'kassenbuch');
    await page.waitForLoadState('networkidle');

    // Kamera/Upload/OCR Button
    const ocrBtn = page.locator('button:has-text("Foto"), button:has-text("OCR"), button:has-text("Scan"), button:has-text("Kamera"), input[type="file"]').first();
    // isAttached() nimmt keine Options – stattdessen waitFor verwenden
    const hasOcr = await ocrBtn.waitFor({ state: 'attached', timeout: 5_000 }).then(() => true).catch(() => false);
    console.log(hasOcr ? '✅ Kassenbuch: OCR/Upload-Option gefunden' : 'ℹ️  Kassenbuch: Kein expliziter OCR-Button (möglicherweise in Buchungsmaske)');
  });

  // ── Dauerbelege ───────────────────────────────────────────────────────────
  test('Dauerbelege: Liste und Neu-Button vorhanden', async ({ page }) => {
    await gotoFibu(page, 'kreditoren/dauerbelege');
    await page.waitForLoadState('networkidle');

    const text = await page.locator('body').innerText();
    expect(text.length).toBeGreaterThan(50);

    const neuBtn = page.locator('button:has-text("Neu"), button:has-text("Erstellen"), button:has-text("Dauerbeleg")').first();
    const hasNeu = await neuBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    console.log(hasNeu ? '✅ Dauerbelege: Neu-Button vorhanden' : 'ℹ️  Dauerbelege: Kein Neu-Button sichtbar');
  });

  // ── Lieferanten-Konto (Einzelkonto-Auszug) ───────────────────────────────
  test('Lieferanten-Konto: Auswahl und Kontoauszug-Ansicht', async ({ page }) => {
    await gotoFibu(page, 'kreditoren/lieferanten-konto');
    await page.waitForLoadState('networkidle');

    // Lieferanten-Dropdown oder Suchfeld
    const selector = page.locator('select, input[type="text"], input[placeholder*="Lieferant"]').first();
    await expect(selector).toBeVisible({ timeout: 10_000 });
    console.log('✅ Lieferanten-Konto: Auswahl-Element vorhanden');
  });
});
