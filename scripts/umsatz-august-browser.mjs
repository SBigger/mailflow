#!/usr/bin/env node
/**
 * Browser-gestützter Umsatz-Report für August 2026
 * Öffnet smartis.me Fibu-Dashboard und scraped die Daten
 */

import chromium from '@playwright/test';

const config = {
  headless: false,  // Fenster sichtbar für Debugging
  slowMo: 500,      // Langsam, um UI zu folgen
};

async function generateReport() {
  console.log('📊 Starte Umsatz-Bericht für August 2026\n');

  let browser;
  try {
    // Browser starten
    browser = await chromium.chromium.launch(config);
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('🌐 Öffne smartis.me...');
    await page.goto('https://smartis.me', { waitUntil: 'networkidle' });

    // Kurz warten, falls Login-Screen
    await page.waitForTimeout(2000);

    // Zu Fibu > Debitoren navigieren
    console.log('📍 Navigiere zu Debitoren-Übersicht...');

    // Versuche, das Fibu-Menü zu finden
    const fibuLink = page.locator('text=Fibu');
    if (await fibuLink.isVisible()) {
      await fibuLink.click();
      await page.waitForTimeout(1000);
    }

    // Debitoren-Link
    const debitorenLink = page.locator('text=Debitoren');
    if (await debitorenLink.isVisible()) {
      await debitorenLink.click();
      await page.waitForTimeout(2000);
    }

    // Tabelle mit Rechnungen sollte jetzt sichtbar sein
    console.log('📋 Lese Rechnungstabelle...\n');

    // Extrahiere alle Tabellen-Zeilen
    const rows = await page.locator('table tbody tr').all();
    console.log(`✅ Gefunden: ${rows.length} Rechnungen\n`);

    let augustTotal = 0;
    let count = 0;

    for (const row of rows) {
      const cells = await row.locator('td').all();
      if (cells.length < 5) continue;

      const dateText = await cells[1]?.textContent() || '';  // Belegdatum
      const amountText = await cells[3]?.textContent() || ''; // Betrag
      const statusText = await cells[4]?.textContent() || ''; // Status

      // Filter: nur August (08.)
      if (!dateText.includes('08.')) continue;

      count++;
      const amount = parseFloat(amountText.replace(/[^\d.,]/g, '').replace('.', '').replace(',', '.'));

      if (!isNaN(amount)) {
        augustTotal += amount;
        console.log(`  • ${dateText} | CHF ${amount.toFixed(2)} | ${statusText.trim()}`);
      }
    }

    console.log(`\n=====================================`);
    console.log(`📊 August 2026 Summe: CHF ${augustTotal.toFixed(2)}`);
    console.log(`📈 Rechnungen: ${count}\n`);

    await context.close();

  } catch (error) {
    console.error('❌ Fehler:', error.message);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

generateReport();
