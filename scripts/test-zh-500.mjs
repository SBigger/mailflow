// Testlauf für src/forms/zh_500.js – befüllt das ZH-Formular mit Beispieldaten
// und schreibt das Ergebnis nach <out>. Nur ein Entwickler-Hilfsmittel.
//   node scripts/test-zh-500.mjs [ausgabe.pdf]
import { readFile, writeFile } from 'node:fs/promises';
import { fillPdfBytes } from '../src/lib/pdfFill.js';
import { ZH_500 } from '../src/forms/zh_500.js';

const OUT = process.argv[2] ?? 'zh_500_test.pdf';

const felder = {
  firma_name: 'Muster Handels AG',
  hauptsitz: 'Seestrasse 42',
  hauptsitz_plz: '8002',
  hauptsitz_ort: 'Zürich',
  gemeinde: 'Zürich',
  register_nr: 'J1234567890',
  zweck: 'Handel mit Konsumgütern aller Art',
  gruendungsdatum: '2011-04-05',
  hr_eintrag: '2011-04-12',
  gj_von: '2025-01-01',
  gj_bis: '2025-12-31',
  organ_vr: 'Anna Muster, Seestrasse 42, 8002 Zürich',
  organ_gl: 'Anna Muster',
  organ_rw: 'Artis Treuhand GmbH',
  revisionsstelle: 'Opting-out',
  rueckfragen: 'Sascha Bigger, Artis Treuhand GmbH',
  vertreter_artis: true,
  vertreter_che: '123456789',

  // A. Reingewinn
  reingewinn_buch: 248500,
  aufr_abschreibungen: 12000,
  aufr_verdeckte_gewinn: 8500,
  aufr_verdeckte_gewinn_txt: 'Privatanteil Fahrzeug',
  aufr_bussen: 450,
  abzug_vorsorge: 15000,
  abzug_gemeinnuetzig: 5000,
  abzug_gewinne_liegenschaften: 30000,   // nur Staatssteuer
  vorjahresverluste: 40000,
  vorjahresverluste_bund: 35000,         // Bund weicht ab
  anteil_ausserkantonal: 0,
  beteiligungsabzug_pct: 12.5,

  // B. Gewinnverwendung
  gv_vortrag_vorjahr: 95000,
  gv_reingewinn_er: 248500,
  gv_dividende_pct: 20,
  gv_dividende: 100000,
  gv_gesetzl_gewinnres: 12425,
  gv_freiw_gewinnres: 50000,

  // C. Eigenkapital
  ek_stichtag: '2025-12-31',
  ek_kapital: 500000,
  ek_gesetzl_kapitalres: 50000,
  ek_gesetzl_gewinnres: 112425,
  ek_freiw_gewinnres: 250000,
  ek_gewinnvortrag: 181075,
  ek_verlustvortrag: 0,
  ek_ermaessigung: 0,

  // D. Weitere Angaben
  ab_jahr_1: '2019',
  ab_bez_1: 'Liegenschaft Seestrasse 42',
  ab_auf_1: 200000,
  ab_ab_1: 20000,
  gestehungskosten_72a: 'nein',
  bemerkungen: 'Jahresrechnung 2025 liegt bei.',
  beilage_1: 'Aufstellung Vorjahresverluste',
  ort_datum: 'Zürich, 10. August 2026',
};

const src = await readFile('public/zh/500_STE_2025.pdf');
const out = await fillPdfBytes(ZH_500, felder, new Uint8Array(src));
await writeFile(OUT, out);

// Erwartungswerte zur Kontrolle
const z3ss = 248500 + 12000 + 8500 + 450;
const z43ss = 15000 + 5000 + 30000;
console.log(`geschrieben: ${OUT} (${out.length} Bytes)`);
console.log(`erwartet Staat  – Z3 ${z3ss} · Z4.3 ${z43ss} · Z5 ${z3ss - z43ss} · Z7 ${z3ss - z43ss - 40000}`);
console.log(`erwartet Bund   – Z3 ${z3ss} · Z4.3 ${15000 + 5000} · Z5 ${z3ss - 20000} · Z7 ${z3ss - 20000 - 35000}`);
console.log(`erwartet Z16 ${500000 + 50000 + 112425 + 250000 + 181075} · Strichcode J12345678902025000100102 61`);
