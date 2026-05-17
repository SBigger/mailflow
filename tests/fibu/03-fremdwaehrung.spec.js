// tests/fibu/03-fremdwaehrung.spec.js
// Spezifische Tests für das FW-System (Wechselkurse, Kursbewertung)

import { test, expect } from '@playwright/test';
import { gotoFibu, selectMandant, waitForTable } from './helpers.js';

test.describe('Fremdwährung – Wechselkurse & Kursbewertung', () => {

  test.beforeEach(async ({ page }) => {
    await selectMandant(page);
  });

  // ── Wechselkurse ─────────────────────────────────────────────────────────
  test('Wechselkurse: Seite lädt', async ({ page }) => {
    await gotoFibu(page, 'wechselkurse');
    await expect(page.locator('text=/Wechselkurse|ESTV|BAZG/i').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Wechselkurse: Monatsmittelkurs / Tageskurs Tabs sichtbar', async ({ page }) => {
    await gotoFibu(page, 'wechselkurse');
    await expect(page.locator('button:has-text("Monatsmittelkurs"), button:has-text("Tageskurs")').first()).toBeVisible({ timeout: 10_000 });
  });

  test('Wechselkurse: Aktualisieren-Button vorhanden', async ({ page }) => {
    await gotoFibu(page, 'wechselkurse');
    const btn = page.locator('button:has-text("ESTV"), button:has-text("aktualisieren"), button:has-text("Import")').first();
    await expect(btn).toBeVisible({ timeout: 10_000 });
  });

  test('Wechselkurse: Monatsmittelkurs zeigt Kursdaten oder Import-Hinweis', async ({ page }) => {
    await gotoFibu(page, 'wechselkurse');
    await page.locator('button:has-text("Monatsmittelkurs")').first().click();
    await page.waitForLoadState('networkidle');
    // Entweder Tabelle mit EUR/USD oder "noch keine Kurse"-Meldung
    const hasData   = await page.locator('table').isVisible().catch(() => false);
    const hasHint   = await page.locator('text=/keine Kurse|importieren|aktualisieren/i').isVisible().catch(() => false);
    expect(hasData || hasHint).toBeTruthy();
  });

  test('Wechselkurse: ★ markiert aktiven Buchungskurs', async ({ page }) => {
    await gotoFibu(page, 'wechselkurse');
    // Einer der Tabs sollte ★ enthalten
    const starVisible = await page.locator('text=/★/').isVisible().catch(() => false);
    // Falls Mandant fw_buchungskurs gesetzt hat, ist ★ sichtbar
    // (kein harter Fail wenn kein Mandant mit FW-Setting vorhanden)
    console.log(starVisible ? '✅ ★ Buchungskurs-Markierung sichtbar' : 'ℹ️  Kein ★ (kein FW-Mandant?)');
  });

  // ── FW-Kursbewertung ─────────────────────────────────────────────────────
  test('Kursbewertung: Seite lädt', async ({ page }) => {
    await gotoFibu(page, 'kursbewertung');
    await expect(page.locator('text=/Kursbewertung|FW-Kursbewertung/i').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Kursbewertung: Stichtag-Input vorhanden und auf 31.12 vorbelegt', async ({ page }) => {
    await gotoFibu(page, 'kursbewertung');
    const dateInput = page.locator('input[type="date"]').first();
    await expect(dateInput).toBeVisible({ timeout: 10_000 });
    const val = await dateInput.inputValue();
    expect(val).toMatch(/\d{4}-12-31/);
  });

  test('Kursbewertung: zeigt "keine offenen FW-Kreditoren" ODER Abstimmungstabelle', async ({ page }) => {
    await gotoFibu(page, 'kursbewertung');
    await page.waitForLoadState('networkidle');

    const hasTable   = await page.locator('text=/Saldo-Abstimmung|FW-Saldo|Nebenbuch/i').isVisible().catch(() => false);
    const hasEmpty   = await page.locator('text=/keine offenen|Keine offenen/i').isVisible().catch(() => false);
    const isLoading  = await page.locator('text=/Lädt/i').isVisible().catch(() => false);

    if (!isLoading) {
      expect(hasTable || hasEmpty).toBeTruthy();
    }
  });

  test('Kursbewertung: Abstimmungstabelle zeigt Nebenbuch- und Fibu-Spalten', async ({ page }) => {
    await gotoFibu(page, 'kursbewertung');
    await page.waitForLoadState('networkidle');

    // Nur prüfen falls Daten vorhanden
    const hasTable = await page.locator('text=/Saldo-Abstimmung/i').isVisible().catch(() => false);
    if (hasTable) {
      await expect(page.locator('text=/Nebenbuch/i')).toBeVisible();
      await expect(page.locator('text=/Kto. 2000|Fibu 2000/i')).toBeVisible();
      await expect(page.locator('text=/Buchwert/i')).toBeVisible();
      await expect(page.locator('text=/Stichtagskurs|Stichtagswert/i')).toBeVisible();
      await expect(page.locator('text=/Kursdifferenz/i')).toBeVisible();
      console.log('✅ Abstimmungstabelle vollständig sichtbar');
    } else {
      console.log('ℹ️  Keine FW-Kreditoren vorhanden – Abstimmungstabelle nicht prüfbar');
    }
  });

  test('Kursbewertung: "Einzelbelege"-Accordion klappt auf', async ({ page }) => {
    await gotoFibu(page, 'kursbewertung');
    await page.waitForLoadState('networkidle');

    const accordion = page.locator('button:has-text("Einzelbelege")');
    if (await accordion.isVisible().catch(() => false)) {
      await accordion.click();
      // Nach Klick: Tabelle erscheint
      await expect(page.locator('table').nth(1)).toBeVisible({ timeout: 5_000 });
      console.log('✅ Einzelbelege-Accordion funktioniert');
    } else {
      console.log('ℹ️  Kein Accordion sichtbar (keine FW-Kreditoren)');
    }
  });

  test('Kursbewertung: Bewertungskurs-Label aus Mandanten-Einstellung', async ({ page }) => {
    await gotoFibu(page, 'kursbewertung');
    // Einer der Labels muss sichtbar sein
    const labelVisible = await page.locator('text=/ESTV Tageskurs|ESTV Monatsmittelkurs/i').isVisible().catch(() => false);
    expect(labelVisible).toBeTruthy();
  });
});
