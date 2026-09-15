/**
 * Betragserkennung: Silbentreffer dürfen keine Zahl liefern.
 *
 * Die Ankersuche arbeitet bewusst auf dem rohen Text, weil Belege ihre
 * Begriffe zusammensetzen — «Bruttoertrag», «Mietertrag», «Kapitalertrag»
 * sollen alle auf «ertrag» ansprechen. Der Preis sind Silbentreffer.
 *
 * An einem echten Kontoauszug wurde «Übertrag auf Hypothek Nr. 94124208
 * 718.65» zu einem Wertschriftenertrag von 718.65. Das ist die teuerste Sorte
 * Fehler hier: eine Zahl, die stimmen könnte, an einer Stelle, an der sie
 * nicht hingehört — niemand stutzt, und sie geht so in die Erklärung.
 *
 *   node --test tests/steuern/*.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findeSeiten } from '../../src/lib/steuerBelege/betrag.js';

// ── Die Silben, die gestolpert sind ───────────────────────────────────────

test('«Übertrag» ist kein Ertrag', () => {
  const t = findeSeiten('19.05.2025 Übertrag auf Hypothek Nr. 94124208  718.65', 'wertschriften');
  assert.equal(t.einkommen, null, 'Kontoübertrag darf kein Wertschriftenertrag werden');
});

test('«Vertrag» ist kein Ertrag', () => {
  const t = findeSeiten('Vertrag Nr. 4711 · vereinbarte Summe 9 999.00', 'wertschriften');
  assert.equal(t.einkommen, null);
});

test('«Wertschriftenverzeichnis» ist kein Wert', () => {
  // «wert» ist der schwächste Anker der Bargeld-Position und steht in jeder
  // Überschrift eines Wertschriftenverzeichnisses.
  const t = findeSeiten('Wertschriftenverzeichnis 2025 Seite 3 von 12  4 812.00', 'bargeld');
  assert.equal(t.vermoegen, null);
});

// ── Was weiterhin greifen muss ────────────────────────────────────────────

test('zusammengesetzte Begriffe sprechen weiter an', () => {
  for (const [text, position, erwartet, seite] of [
    ['Bruttoertrag 2025            1 234.50', 'wertschriften', 1234.5, 'einkommen'],
    ['Mietertrag Liegenschaft     18 400.00', 'liegenschaft_ertrag', 18400, 'einkommen'],
    ['Steuerwert per 31.12.2025   45 213.85', 'wertschriften', 45213.85, 'vermoegen'],
  ]) {
    const t = findeSeiten(text, position);
    assert.equal(t[seite], erwartet, `${text.trim()} → ${seite}`);
  }
});

test('ein Anker, der selbst das ganze Wort ist, bleibt gültig', () => {
  // Die Sperre darf nur greifen, wenn der Anker als Silbe in einem ANDEREN
  // Wort steckt. «Betrag» als Anker muss «Betrag» bleiben.
  const t = findeSeiten('Rechnungsbetrag                2 251.70', 'liegenschaftsunterhalt');
  assert.equal(t.einkommen, 2251.7);
});

test('«Ertrag» allein greift weiterhin', () => {
  const t = findeSeiten('Ertrag im Jahr 2025            536.65', 'wertschriften');
  assert.equal(t.einkommen, 536.65);
});
