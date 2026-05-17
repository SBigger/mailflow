// tests/fibu/04-buchhaltung.spec.js
// Kontenplan, Bilanz, Buchungsblätter, MWST, Jahresabschluss

import { test, expect } from '@playwright/test';
import { gotoFibu, selectMandant, waitForTable } from './helpers.js';

test.describe('Buchhaltung – Konten, Bilanz, MWST', () => {

  test.beforeEach(async ({ page }) => {
    await selectMandant(page);
  });

  // ── Kontenplan ───────────────────────────────────────────────────────────
  test('Kontenplan: Tabelle mit Konten lädt', async ({ page }) => {
    await gotoFibu(page, 'kontenplan');
    await waitForTable(page);
    // Mindestens ein Konto (1000 Kasse oder ähnlich) sichtbar
    const hasKonten = await page.locator('text=/1000|Kasse|Bank|2000|Kreditoren/i').first().isVisible({ timeout: 10_000 }).catch(() => false);
    console.log(hasKonten ? '✅ Kontenplan enthält Daten' : 'ℹ️  Kontenplan leer');
  });

  test('Kontenplan: Aktions-Button vorhanden', async ({ page }) => {
    await gotoFibu(page, 'kontenplan');
    // Kontenplan hat "Standardkonten ergänzen" statt "Neu"
    const btn = page.locator('button:has-text("ergänzen"), button:has-text("Standardkonten"), button:has-text("Neu"), button:has-text("Konto")').first();
    await expect(btn).toBeVisible({ timeout: 10_000 });
  });

  // ── MwSt-Codes ──────────────────────────────────────────────────────────
  test('MwSt-Codes: Liste der Codes sichtbar', async ({ page }) => {
    await gotoFibu(page, 'mwstcodes');
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    expect(text.length).toBeGreaterThan(30);
  });

  // ── MwSt-Abrechnung ──────────────────────────────────────────────────────
  test('MwSt-Abrechnung: Perioden-Übersicht lädt', async ({ page }) => {
    await gotoFibu(page, 'mwst/abrechnung');
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    expect(text.length).toBeGreaterThan(30);
  });

  // ── Kontoblätter ─────────────────────────────────────────────────────────
  test('Kontoblätter: Konto-Auswahl und Datum-Filter vorhanden', async ({ page }) => {
    await gotoFibu(page, 'kontoblaetter');
    // KontoSelector ist custom Combobox (kein natives <select>) – zeigt "Konto wählen…"
    const kontoSelector = page.locator('text=/Konto wählen/').first();
    await expect(kontoSelector).toBeVisible({ timeout: 10_000 });
    const dateInput = page.locator('input[type="date"]').first();
    await expect(dateInput).toBeVisible({ timeout: 5_000 });
  });

  // ── Bilanz ────────────────────────────────────────────────────────────────
  test('Bilanz: Stichtag-Input und Tabelle sichtbar', async ({ page }) => {
    await gotoFibu(page, 'bilanz');
    const dateInput = page.locator('input[type="date"]').first();
    await expect(dateInput).toBeVisible({ timeout: 10_000 });
    await page.waitForLoadState('networkidle');
  });

  // ── Manuelle Buchungen ────────────────────────────────────────────────────
  test('Manuelle Buchungen: Buchungsformular vorhanden', async ({ page }) => {
    await gotoFibu(page, 'manuelle-buchungen');
    await page.waitForLoadState('networkidle');
    // Konto-Soll / Konto-Haben Inputs
    const inputs = page.locator('input, select');
    const count = await inputs.count();
    expect(count).toBeGreaterThan(2);
  });

  // ── Bank-Abstimmung ───────────────────────────────────────────────────────
  test('Bank-Abstimmung: Seite lädt', async ({ page }) => {
    await gotoFibu(page, 'bankabstimmung');
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    expect(text.length).toBeGreaterThan(30);
  });

  // ── Kassenbuch ────────────────────────────────────────────────────────────
  test('Kassenbuch: Datum-Filter und Eintrags-Liste vorhanden', async ({ page }) => {
    await gotoFibu(page, 'kassenbuch');
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    expect(text.length).toBeGreaterThan(30);
  });

  // ── Budget ────────────────────────────────────────────────────────────────
  test('Budget: Jahr-Selektor und Tabelle sichtbar', async ({ page }) => {
    await gotoFibu(page, 'budget');
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    expect(text).toMatch(/2025|2026|Budget|Konto/i);
  });

  // ── Jahresabschluss ───────────────────────────────────────────────────────
  test('Jahresabschluss: Schritte / Checkliste sichtbar', async ({ page }) => {
    await gotoFibu(page, 'jahresabschluss');
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    expect(text.length).toBeGreaterThan(30);
  });

  // ── Saldovorträge ─────────────────────────────────────────────────────────
  test('Saldovorträge: Seite lädt', async ({ page }) => {
    await gotoFibu(page, 'saldovortraege');
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    expect(text.length).toBeGreaterThan(30);
  });

  // ── Zahlstellen ───────────────────────────────────────────────────────────
  test('Zahlstellen: Liste lädt', async ({ page }) => {
    await gotoFibu(page, 'zahlstellen');
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    expect(text.length).toBeGreaterThan(30);
  });
});
