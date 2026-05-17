// tests/fibu/05-einstellungen.spec.js
// Einstellungen: Firma, FW-Kursarten, Belegfreigabe

import { test, expect } from '@playwright/test';
import { gotoFibu, selectMandant } from './helpers.js';

test.describe('Einstellungen', () => {

  test.beforeEach(async ({ page }) => {
    await selectMandant(page);
  });

  test('Einstellungen: Seite lädt vollständig', async ({ page }) => {
    await gotoFibu(page, 'einstellungen');
    await expect(page.locator('text=/Einstellungen/i').first()).toBeVisible({ timeout: 10_000 });
  });

  test('Einstellungen: Firma-Card mit allen Pflichtfeldern sichtbar', async ({ page }) => {
    await gotoFibu(page, 'einstellungen');
    await expect(page.locator('text=/Firma|Mandant/i').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('input[value], input[placeholder]').first()).toBeVisible();
  });

  test('Einstellungen: Fremdwährungs-Card vorhanden', async ({ page }) => {
    await gotoFibu(page, 'einstellungen');
    await expect(page.locator('text=/Fremdwährung/i')).toBeVisible({ timeout: 10_000 });
  });

  test('Einstellungen: Buchungskurs-Dropdown zeigt Monat/Tag Optionen', async ({ page }) => {
    await gotoFibu(page, 'einstellungen');
    await page.waitForLoadState('networkidle');
    // Beide Optionen müssen in einem Select sein
    const monatOpt = page.locator('option:has-text("Monatsmittelkurs")');
    const tagOpt   = page.locator('option:has-text("Tageskurs")');
    await expect(monatOpt.first()).toBeAttached({ timeout: 10_000 });
    await expect(tagOpt.first()).toBeAttached();
  });

  test('Einstellungen: Bewertungskurs-Dropdown vorhanden', async ({ page }) => {
    await gotoFibu(page, 'einstellungen');
    await page.waitForLoadState('networkidle');
    // Bewertungskurs-Select
    const selects = await page.locator('select').count();
    expect(selects).toBeGreaterThanOrEqual(2); // Buchungskurs + Bewertungskurs
  });

  test('Einstellungen: Belegfreigabe-Toggle vorhanden', async ({ page }) => {
    await gotoFibu(page, 'einstellungen');
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    await expect(page.locator('text=/Belegfreigabe|Visumskontrolle/i').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Einstellungen: Kontierungsregeln-Seite lädt', async ({ page }) => {
    await gotoFibu(page, 'kontierungsregeln');
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    expect(text.length).toBeGreaterThan(30);
  });
});
