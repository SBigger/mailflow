/**
 * Erfassungs-Agent: vom PDF-Stapel zur Arbeitsliste.
 *
 * Die Belege werden zur Laufzeit als PDF mit echter Textebene erzeugt, statt
 * Beispieldateien mitzuliefern. Zwei Gründe: ein Steuerbeleg aus dem Alltag
 * gehört nicht ins Repository, und der Test prüft so wirklich den ganzen Weg
 * — pdfjs liest denselben Weg wie im Ernstfall, nicht eine vorbereitete
 * Textdatei.
 *
 *   node --test tests/steuern/*.test.mjs
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { erfasseOrdner, gruppiere } from '../../scripts/steuer-erfassung.mjs';

// ── Belege ────────────────────────────────────────────────────────────────
// Bewusst ohne Umlaute geschrieben: die Standardschrift von pdf-lib kann sie
// nicht kodieren. Die Triage arbeitet ohnehin auf umlautflachem Text.

const LOHNAUSWEIS = [[
  'Muster Maschinenbau AG', 'Industriestrasse 12, 8500 Frauenfeld', '',
  'LOHNAUSWEIS', 'fuer die Steuererklaerung 2025', '',
  'Arbeitnehmer: Peter Muster, 756.1234.5678.90',
  'Arbeitgeber: Muster Maschinenbau AG', '',
  'Bruttolohn total                     98 400.00',
  'AHV/IV/EO-Beitraege                   5 215.20',
  'ALV-Beitraege                         1 082.40',
  'Beitraege BVG                         4 356.00', '',
  'Nettolohn                            87 451.20',
]];

const SAEULE3A = [[
  'Thurgauer Kantonalbank', '8500 Frauenfeld', '',
  'Vorsorgebescheinigung Saeule 3a', 'Steuerjahr 2025', '',
  'Vorsorgenehmer: Peter Muster', 'Konto-Nr. 3a-88.221.045', '',
  'Einzahlung im Kalenderjahr 2025        7 056.00',
]];

const SALDO = [[
  'Thurgauer Kantonalbank', '8500 Frauenfeld', '',
  'Saldobestaetigung per 31.12.2025', '',
  'Kontoinhaber: Peter Muster', 'Privatkonto CH52 0078 4016 1234 5678 9', '',
  'Saldo per 31.12.2025                  45 213.85',
  'Zinsertrag 2025                          112.50',
]];

const WERBUNG = [[
  'SuperSparAbo', '', 'Jetzt profitieren!', '',
  'Newsletter: unverbindlich und kostenlos testen.',
  'Werbung - dieses Schreiben ist unverbindlich.',
]];

// Zwei verschiedene Absender in EINER Datei — muss in zwei Belege zerfallen.
const STAPEL = [
  ['Helvetia Krankenversicherung AG', '9001 St. Gallen', '',
   'Praemienbescheinigung 2025', '', 'Versicherter: Peter Muster',
   'Jahrespraemie                          4 812.00'],
  ['Gemeinde Frauenfeld', 'Rathausplatz 1, 8500 Frauenfeld', '',
   'Liegenschaftenschatzung', '', 'Eigentuemer: Peter Muster',
   'Amtlicher Wert                       620 000.00',
   'Eigenmietwert                         18 400.00'],
];

async function alsPdf(seiten) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const zeilen of seiten) {
    const s = doc.addPage([595, 842]);
    let y = 790;
    for (const z of zeilen) { s.drawText(z, { x: 50, y, size: 11, font }); y -= 18; }
  }
  return doc.save();
}

let ordner;
let ergebnis;
let gruppen;
const belegVon = name => ergebnis.belege.find(b => b.name.startsWith(name));

before(async () => {
  ordner = mkdtempSync(join(tmpdir(), 'steuer-erfassung-'));
  for (const [name, seiten] of [
    ['lohnausweis-muster.pdf', LOHNAUSWEIS],
    ['lohnausweis-zweitexemplar.pdf', LOHNAUSWEIS],
    ['saeule3a-tkb.pdf', SAEULE3A],
    ['saldobestaetigung-tkb.pdf', SALDO],
    ['stapel-kk-und-liegenschaft.pdf', STAPEL],
    ['werbung-abo.pdf', WERBUNG],
  ]) {
    writeFileSync(join(ordner, name), await alsPdf(seiten));
  }
  ergebnis = await erfasseOrdner({ ordner, jahr: 2025 });
  gruppen = gruppiere(ergebnis.belege);
});

after(() => rmSync(ordner, { recursive: true, force: true }));

// ── Einlesen und Trennen ──────────────────────────────────────────────────

test('liest alle PDFs des Ordners, keine als Scan verkannt', () => {
  assert.equal(ergebnis.dateien.length, 6);
  assert.deepEqual(ergebnis.fehler, []);
  // Digitale Textebene vorhanden: nichts darf im OCR-Topf landen.
  assert.deepEqual(ergebnis.scans, []);
});

test('zerlegt ein Buendel mit zwei Absendern in zwei Belege', () => {
  const teile = ergebnis.belege.filter(b => b.name.startsWith('stapel-'));
  assert.equal(teile.length, 2);
  assert.deepEqual(teile.map(t => [t.vonSeite, t.bisSeite]), [[1, 1], [2, 2]]);
});

// ── Zuordnung ─────────────────────────────────────────────────────────────

test('ordnet den Lohnausweis dem Haupterwerb zu und liest den Nettolohn', () => {
  const b = belegVon('lohnausweis-muster.pdf');
  assert.equal(b.belegart, 'lohnausweis');
  assert.equal(b.position, 'lohn_haupt');
  assert.equal(b.einkommen, 87451.2);
  assert.equal(b.betragQuelle, 'regel');
  // Nicht der Bruttolohn — der steht weiter oben auf demselben Blatt.
  assert.notEqual(b.einkommen, 98400);
});

test('liest bei der Saldobestaetigung beide Seiten: Ertrag und Vermoegen', () => {
  const b = belegVon('saldobestaetigung-tkb.pdf');
  assert.equal(b.position, 'wertschriften');
  assert.equal(b.einkommen, 112.5);
  assert.equal(b.vermoegen, 45213.85);
});

test('erkennt die Saeule-3a-Bescheinigung als Abzug', () => {
  const b = belegVon('saeule3a-tkb.pdf');
  assert.equal(b.position, 'saeule_3a');
  assert.equal(b.einkommen, 7056);
});

test('meldet ein Doppel, statt es unbemerkt mitzuzaehlen', () => {
  assert.equal(gruppen.duplikate.length, 1);
  assert.equal(gruppen.duplikate[0].position, '_aussortiert');
});

// ── Was der Agent NICHT entscheidet ───────────────────────────────────────

test('raet bei mehreren moeglichen Positionen nicht, sondern legt vor', () => {
  const b = belegVon('stapel-kk-und-liegenschaft.pdf · Seite 2');
  assert.equal(b.belegart, 'liegenschaft');
  assert.equal(b.position, null, 'mehrdeutige Belege duerfen nicht gesetzt werden');
  assert.ok(b.kandidaten.length >= 2, 'die Kandidaten muessen genannt sein');
  assert.ok(b.kandidatenGrund, 'und woran sie sich unterscheiden');
});

test('haelt nicht relevante Belege von den offenen getrennt', () => {
  // Werbung ist erkannt, nicht ratlos liegengeblieben. Landet sie bei den
  // offenen Belegen, blaeht sie die Prueflisten des Menschen auf.
  assert.equal(gruppen.nichtRelevant.length, 1);
  assert.equal(gruppen.nichtRelevant[0].relevanzGrund, 'werbung');
  assert.ok(!gruppen.offen.some(b => b.name.startsWith('werbung-')));
});

test('setzt bei keinem Beleg eine Handbestaetigung vor', () => {
  // vonHand=false ueber die ganze Linie: die Arbeitsliste zaehlt daraus die
  // geprueften Belege, und geprueft hat hier noch niemand.
  assert.ok(ergebnis.belege.every(b => b.vonHand === false));
});

// ── Uebergabe an die Arbeitsliste ─────────────────────────────────────────

test('liefert genau die Felder, die steuer-arbeitsliste.mjs liest', () => {
  for (const b of ergebnis.belege) {
    assert.ok('position' in b && 'einkommen' in b && 'vermoegen' in b
              && 'vonHand' in b && 'betragQuelle' in b, `unvollstaendig: ${b.name}`);
    assert.ok(b.einkommen === null || typeof b.einkommen === 'number');
    assert.ok(b.vermoegen === null || typeof b.vermoegen === 'number');
  }
});

test('die Summen der Arbeitsliste stimmen mit den Belegen ueberein', () => {
  // Nachgerechnet wie in steuer-arbeitsliste.mjs: je Position aufsummiert.
  const proPosition = new Map();
  for (const b of gruppen.zugeordnet) {
    const p = proPosition.get(b.position) || { einkommen: 0, vermoegen: 0 };
    p.einkommen += Number(b.einkommen) || 0;
    p.vermoegen += Number(b.vermoegen) || 0;
    proPosition.set(b.position, p);
  }
  assert.equal(proPosition.get('lohn_haupt').einkommen, 87451.2);
  assert.equal(proPosition.get('wertschriften').vermoegen, 45213.85);
  assert.equal(proPosition.get('saeule_3a').einkommen, 7056);
  // Das Doppel darf den Lohn nicht verdoppeln.
  assert.notEqual(proPosition.get('lohn_haupt').einkommen, 174902.4);
});

// ── Was nicht gelesen werden kann, muss auffallen ─────────────────────────
//
// Der teuerste Fehler dieses Agenten wäre nicht eine falsche Zahl, sondern
// ein Beleg, der unbemerkt gar nicht erst ankommt. Beide Wege dorthin —
// Scan ohne Textebene und kaputte Datei — sind hier festgenagelt.

test('meldet Scans ohne Textebene, statt sie leer durchzureichen', async () => {
  const ordner2 = mkdtempSync(join(tmpdir(), 'steuer-scan-'));
  try {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    doc.addPage([595, 842]);
    writeFileSync(join(ordner2, 'scan.pdf'), await doc.save());

    const r = await erfasseOrdner({ ordner: ordner2, jahr: 2025 });
    assert.equal(r.belege.length, 0, 'ein Scan darf keinen leeren Beleg erzeugen');
    assert.equal(r.scans.length, 1);
    assert.equal(r.scans[0].name, 'scan.pdf');
    assert.equal(r.scans[0].seiten, 2);
  } finally {
    rmSync(ordner2, { recursive: true, force: true });
  }
});

test('meldet unlesbare Dateien namentlich', async () => {
  const ordner3 = mkdtempSync(join(tmpdir(), 'steuer-kaputt-'));
  try {
    writeFileSync(join(ordner3, 'kaputt.pdf'), 'kein PDF, nur Text');
    const r = await erfasseOrdner({ ordner: ordner3, jahr: 2025 });
    assert.equal(r.belege.length, 0);
    assert.equal(r.fehler.length, 1);
    assert.equal(r.fehler[0].name, 'kaputt.pdf');
    assert.ok(r.fehler[0].meldung, 'die Ursache muss dabeistehen');
  } finally {
    rmSync(ordner3, { recursive: true, force: true });
  }
});

test('nennt einen fehlenden Ordner beim Namen', async () => {
  await assert.rejects(
    () => erfasseOrdner({ ordner: join(tmpdir(), 'gibt-es-sicher-nicht-4711'), jahr: 2025 }),
    /gibt es nicht/,
  );
});

test('verliert Scanseiten nicht hinter einem Deckblatt mit Textebene', async () => {
  // Der Fall aus der Praxis: ein Beilagenbündel aus dem Belegsortierungs-Modul
  // — Seite 1 ein generiertes Verzeichnis mit Text, dahinter lauter Scans.
  // Über die ganze Datei gemittelt riss der Text des Deckblatts die
  // Scan-Schwelle, die Datei galt als digital, und die Scanseiten hängten sich
  // mangels Briefkopf an das Deckblatt: EIN Beleg, 75 Seiten unbemerkt weg.
  const ordner4 = mkdtempSync(join(tmpdir(), 'steuer-deckblatt-'));
  try {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const deck = doc.addPage([595, 842]);
    let y = 790;
    for (const z of [
      'Beilagenverzeichnis', 'Dominik Muster', 'Steuerperiode 2025',
      '51 Beilagen - erstellt 19.08.2026', 'Wertschriftenverzeichnis',
      'Konto / Depot / Titel   02.pdf - Seite 1',
      'Liegenschaftenverzeichnis',
      'Ertrag / Eigenmietwert / Mieterspiegel   05.pdf - Seite 2',
    ]) { deck.drawText(z, { x: 50, y, size: 11, font }); y -= 18; }
    for (let i = 0; i < 8; i++) doc.addPage([595, 842]);   // Scans ohne Text
    writeFileSync(join(ordner4, 'beilagen.pdf'), await doc.save());

    const r = await erfasseOrdner({ ordner: ordner4, jahr: 2025 });
    const g = gruppiere(r.belege);

    // Das Deckblatt und der Scanblock sind zwei Belege, nicht einer.
    assert.equal(r.belege.length, 2);
    const deckblatt = r.belege.find(b => !b.ocrNoetig);
    const scanblock = r.belege.find(b => b.ocrNoetig);
    assert.ok(deckblatt && scanblock, 'Deckblatt und Scanblock muessen getrennt sein');
    assert.deepEqual([deckblatt.vonSeite, deckblatt.bisSeite], [1, 1]);
    assert.deepEqual([scanblock.vonSeite, scanblock.bisSeite], [2, 9]);

    // Die Luecke muss gemeldet sein — als Teil-Scan, nicht als Ganz-Scan.
    assert.equal(r.scans.length, 1);
    assert.equal(r.scans[0].teilweise, true);
    assert.equal(r.scans[0].seitenOhneText, 8);
    assert.equal(r.scans[0].seiten, 9);

    // Und sie darf nicht als offene Entscheidung durchgehen: es gibt nichts
    // zu entscheiden, solange die Seiten niemand gelesen hat.
    assert.equal(g.ocrNoetig.length, 1);
    assert.ok(!g.offen.some(b => b.ocrNoetig));
    assert.equal(scanblock.position, null);
  } finally {
    rmSync(ordner4, { recursive: true, force: true });
  }
});
