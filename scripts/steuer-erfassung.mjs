#!/usr/bin/env node
/**
 * Erfassungs-Agent, Stufe 1: vom Belegstapel zur Arbeitsliste — ohne Browser.
 *
 * Bisher lief die Erkennung nur im Belegsortierungs-Modul, also im Browser mit
 * einem Menschen davor. Damit war der Erfassungs-Agent auf halbem Weg: er
 * konnte eine bereits sortierte Ablage vorlesen (steuer-arbeitsliste.mjs),
 * aber einen frisch eingegangenen Stapel nicht anfassen.
 *
 * Dieses Skript schliesst die Lücke. Es fährt dieselbe Pipeline wie das Modul
 * — dieselben Bibliotheken, keine zweite Wahrheit:
 *
 *     PDF → Text je Seite → Belegtrennung → Doppelerkennung
 *         → Regel-Triage → Belegart → Position → Beträge
 *
 * Heraus fällt exakt die JSON-Struktur, die steuer-arbeitsliste.mjs mit
 * «--datei» liest. Beide Schritte zusammen:
 *
 *   node scripts/steuer-erfassung.mjs --ordner ./belege --jahr 2025 \
 *        --json /tmp/belege.json
 *   node scripts/steuer-arbeitsliste.mjs --datei /tmp/belege.json \
 *        --mandant "Muster" --jahr 2025
 *
 * ── Was dieses Skript BEWUSST nicht tut ───────────────────────────────────
 *
 * Keine KI. Das Modul im Browser ruft bei unsicheren Belegen die Edge Function
 * (Infomaniak, CH-Cloud) — hier läuft nur die Regelstufe. Das ist kein
 * Sparprogramm, sondern die Bedingung dafür, dass ein Lauf nachvollziehbar
 * bleibt: gleiche Belege, gleiches Ergebnis, jede Zuordnung auf eine Regel
 * zurückführbar. Was die Regeln nicht sicher entscheiden, wird als offen
 * ausgewiesen und gehört in die Durchsicht — nicht geraten.
 *
 * Keine OCR im selben Lauf. Gelesen wird die eingebettete Textebene; Seiten
 * ohne eine solche werden gezählt und namentlich gemeldet, nicht
 * stillschweigend als leerer Beleg durchgereicht — ein unbemerkt
 * übersprungener Beleg ist der teurere Fehler.
 *
 * Wer sie trotzdem lesen will, lässt vorher `steuer-ocr.mjs` laufen und gibt
 * dessen Ausgabe mit «--ocr» mit. Getrennte Schritte, weil OCR rund sieben
 * Sekunden je Seite kostet: einmal lesen, danach beliebig oft auswerten —
 * und weil so sichtbar bleibt, welche Zahl aus einer Textebene stammt und
 * welche aus einer Mustererkennung.
 *
 * Nichts wird eingereicht und nichts in ein Portal getippt. Vgl.
 * docs/steuern-np-recherche.md §4.
 *
 * ⚠ Die geschriebene JSON enthält den erkannten Volltext der Belege, also auch
 *   AHV-Nummern, Kontonummern und Diagnosen. Sie ist Arbeitsmaterial und
 *   gehört behandelt wie der Papierstapel selbst — nicht in ein Repository,
 *   nicht in einen Chat, nicht in einen geteilten Ordner.
 */

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { triageRegeln } from '../src/lib/steuerBelege/triage.js';
import { trenneBelege, seitenLabel } from '../src/lib/steuerBelege/belegTrennung.js';
import { positionenFuer, offeneDimensionen } from '../src/lib/steuerBelege/belegartZuPosition.js';
import { findeSeiten } from '../src/lib/steuerBelege/betrag.js';
import { findeDoppel } from '../src/lib/steuerBelege/doppelErkennung.js';
import { RELEVANZ } from '../src/lib/steuerBelege/belegarten.js';
import { KATALOG_NACH_ID } from '../src/forms/steuer_np_katalog.js';

// pdfjs liegt als UMD-Bundle vor und will require. Die legacy-Variante ist die
// einzige, die ohne Browser-Globals auskommt.
//
// Beim Laden sucht sie das Paket «canvas» und meldet zweimal, dass sie
// DOMMatrix und Path2D nicht ersetzen kann. Für uns ist das folgenlos —
// gerendert wird hier nichts, nur die Textebene gelesen. Die Meldung sieht
// aber nach Fehler aus und steht über jedem Lauf, also wird sie für die Dauer
// des Ladens stummgeschaltet. Sie geht über console.LOG, nicht console.warn:
// pdfjs' eigenes warn() schreibt mit «Warning: »-Präfix auf log.
const require = createRequire(import.meta.url);
const logAlt = console.log;
console.log = () => {};
let pdfjs;
try {
  pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
} finally {
  // finally, nicht danach: scheitert das Laden, bliebe console.log sonst
  // stumm und die Fehlermeldung unsichtbar.
  console.log = logAlt;
}

// Ohne diesen Pfad sucht pdfjs die Standardschriften über eine URL und meldet
// je Datei einen Fehlschlag. Für die Textebene braucht es sie nicht, aber die
// Meldungen verdecken die echten Hinweise.
const SCHRIFTEN = join(
  dirname(require.resolve('pdfjs-dist/legacy/build/pdf.js')), '..', '..', 'standard_fonts/');

// ══════════════════════════════════════════════════════════════════════════
// Pipeline
// ══════════════════════════════════════════════════════════════════════════

/** Alle PDFs unter einem Pfad, rekursiv, in stabiler Reihenfolge. */
export function sammlePdfs(pfad) {
  // Ein vertippter Ordner ist der häufigste Fehlaufruf und verdient eine
  // Meldung statt eines Stacktraces aus readdirSync.
  try {
    if (!statSync(pfad).isDirectory()) throw new Error(`«${pfad}» ist kein Verzeichnis.`);
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`Verzeichnis «${pfad}» gibt es nicht.`);
    throw e;
  }
  const gefunden = [];
  const gehe = (p) => {
    for (const eintrag of readdirSync(p).sort()) {
      const voll = join(p, eintrag);
      if (statSync(voll).isDirectory()) gehe(voll);
      else if (extname(eintrag).toLowerCase() === '.pdf') gefunden.push(voll);
    }
  };
  gehe(pfad);
  return gefunden;
}

/**
 * Ab wie vielen Zeichen eine Seite eine brauchbare Textebene hat.
 *
 * Derselbe Wert, den `extractPageTexts` im Browser-Modul im Mittel verlangt
 * (50 × Seiten × 0.3 = 15 Zeichen je Seite) — nur wird er hier JE SEITE
 * geprüft statt über die ganze Datei gemittelt. Der Unterschied ist nicht
 * kosmetisch: an einem echten Beilagenbündel (Deckblatt mit Verzeichnis,
 * dahinter 75 gescannte Seiten) reichten die 1394 Zeichen des Deckblatts, um
 * die Datei-Schwelle von 1140 zu reissen. Die Datei galt als digital, die 75
 * Scanseiten wurden ohne Textinhalt an das Deckblatt geklebt und meldeten sich
 * als EIN Beleg. Genau der stille Verlust, den dieses Skript verhindern soll.
 */
const TEXT_MINDEST = 15;

/**
 * Text je Seite aus der eingebetteten Textebene.
 *
 * Die Zusammensetzung des Seitentexts ist bewusst identisch zu
 * `extractPageTexts` in src/lib/batchAiSuggest.js — weicht das ab, trennt der
 * Node-Lauf den Stapel anders als der Browser, und zwei Läufe über denselben
 * Ordner wären nicht mehr vergleichbar. Nur die Scan-Erkennung ist feiner,
 * siehe TEXT_MINDEST.
 *
 * @returns {{seiten: string[], scanSeiten: number[], scan: boolean,
 *            seitenGesamt: number}}
 *          scanSeiten sind die 1-basierten Seiten ohne Textebene;
 *          scan=true heisst: die ganze Datei ist ein Scan.
 */
export async function seitenTexte(datei, maxSeiten = 40) {
  const daten = new Uint8Array(readFileSync(datei));
  const pdf = await pdfjs.getDocument({
    data: daten, isEvalSupported: false, standardFontDataUrl: SCHRIFTEN,
  }).promise;
  const anzahl = Math.min(pdf.numPages, maxSeiten);

  const texte = [];
  for (let i = 1; i <= anzahl; i++) {
    const seite = await pdf.getPage(i);
    const inhalt = await seite.getTextContent();
    texte.push(inhalt.items.map(it => it.str).join(' ').trim());
  }
  const seitenGesamt = pdf.numPages;
  await pdf.destroy();

  const scanSeiten = texte
    .map((t, i) => (t.length < TEXT_MINDEST ? i + 1 : 0))
    .filter(Boolean);
  return {
    seiten: texte, scanSeiten,
    scan: scanSeiten.length === texte.length,
    seitenGesamt,
  };
}

/**
 * Die Seiten einer Datei in Belege zerlegen — Textseiten über die
 * Belegtrennung, Scanseiten als eigene, ausdrücklich markierte Abschnitte.
 *
 * Warum getrennt: `trenneBelege` entscheidet am Briefkopf, ob eine Seite einen
 * neuen Beleg beginnt. Eine Seite ohne Textebene hat keinen Briefkopf, gilt
 * damit als «gleicher Absender wie davor» und hängt sich an den Vorgänger.
 * Ein Deckblatt mit 75 Scans dahinter würde so zu einem Beleg. Scanseiten
 * dürfen deshalb gar nicht erst in die Trennung.
 */
function zerlegeInTeile(seiten, scanSeiten) {
  const istScan = new Set(scanSeiten);

  // Zusammenhängende Läufe gleicher Art bilden.
  const laeufe = [];
  for (let i = 0; i < seiten.length; i++) {
    const scan = istScan.has(i + 1);
    const letzter = laeufe[laeufe.length - 1];
    if (letzter && letzter.scan === scan) letzter.bis = i + 1;
    else laeufe.push({ von: i + 1, bis: i + 1, scan });
  }

  const teile = [];
  for (const lauf of laeufe) {
    if (lauf.scan) {
      teile.push({
        von: lauf.von, bis: lauf.bis, text: '',
        grund: 'ohne Textebene', ocrNoetig: true,
      });
      continue;
    }
    // Seitennummern des Abschnitts wieder auf die Datei umrechnen.
    for (const t of trenneBelege(seiten.slice(lauf.von - 1, lauf.bis))) {
      teile.push({
        ...t,
        von: t.von + lauf.von - 1,
        bis: t.bis + lauf.von - 1,
        ocrNoetig: false,
      });
    }
  }
  return teile;
}

/** Inhalts-Hash wie belegHelfer.dateiHash, nur mit Node-Krypto. */
export function inhaltsHash(datei) {
  return createHash('sha256').update(readFileSync(datei)).digest('hex');
}

/**
 * Einen Ordner voller Belege erfassen.
 *
 * @param {{ordner: string, jahr: number, maxSeiten?: number,
 *          ocr?: {[dateiname: string]: {[seite: number]: {text, vertrauen}}}}} auftrag
 * @returns {Promise<{dateien: string[], belege: object[],
 *                    scans: object[], fehler: object[]}>}
 */
export async function erfasseOrdner({ ordner, jahr, maxSeiten = 40, ocr = null }) {
  const dateien = sammlePdfs(ordner);
  const belege = [];
  const bekannteHashes = [];
  const scans = [];       // Dateien ohne Textebene — brauchen OCR
  const fehler = [];

  for (const datei of dateien) {
    const name = basename(datei);
    let gelesen;
    try {
      gelesen = await seitenTexte(datei, maxSeiten);
    } catch (e) {
      fehler.push({ name, meldung: e.message });
      continue;
    }

    if (gelesen.scan) {
      scans.push({ name, seiten: gelesen.seitenGesamt, seitenOhneText: gelesen.seitenGesamt });
      continue;
    }
    // Erkannten Text einsetzen, wo die Textebene nichts hergab. Was von der
    // OCR kommt, bleibt als solches erkennbar (quelle: 'ocr') — eine gelesene
    // Zahl und eine erratene Zahl duerfen im Report nicht gleich aussehen.
    const ocrSeiten = ocr?.[name] || null;
    const nochScan = [];
    for (const nr of gelesen.scanSeiten) {
      const treffer = ocrSeiten?.[nr];
      if (treffer?.text) gelesen.seiten[nr - 1] = treffer.text;
      else nochScan.push(nr);
    }
    gelesen.scanSeiten = nochScan;

    // Teil-Scan: die Datei hat Text, aber nicht ueberall, und die OCR hat die
    // Luecke nicht geschlossen. Sie wird verarbeitet UND die Luecke gemeldet.
    if (gelesen.scanSeiten.length) {
      scans.push({ name, seiten: gelesen.seitenGesamt,
                   seitenOhneText: gelesen.scanSeiten.length, teilweise: true });
    }

    const hash = inhaltsHash(datei);
    const teile = zerlegeInTeile(gelesen.seiten, gelesen.scanSeiten);

    for (const teil of teile) {
      const teilName = teile.length > 1 ? `${name} · ${seitenLabel(teil)}` : name;
      const teilHash = `${hash}#${teil.von}-${teil.bis}`;

      // Seiten ohne Textebene können die Regeln nicht beurteilen. Sie werden
      // als Beleg geführt, damit sie in der Zählung auftauchen, aber als
      // «braucht OCR» markiert statt als offene Entscheidung.
      if (teil.ocrNoetig) {
        belege.push({
          id: teilHash, name: teilName, hash: teilHash, dateiPfad: datei,
          vonSeite: teil.von, bisSeite: teil.bis, trennGrund: teil.grund,
          text: '', belegart: null, confidence: 0,
          begruendung: 'Keine Textebene — nicht gelesen, OCR nötig.',
          quelle: 'regel', merkmale: [], periodeBeleg: null,
          relevanz: null, relevanzGrund: null,
          position: null, kandidaten: [], kandidatenGrund: null, dimensionen: [],
          einkommen: null, vermoegen: null, betragQuelle: null, betragAnker: null,
          vonHand: false, doppelVerdacht: null, ocrNoetig: true,
        });
        continue;
      }

      // Doppelverdacht wird MARKIERT, nicht weggeworfen — gleiche Begründung
      // wie im Modul: ein still verschwundener Beleg ist der teurere Fehler.
      const doppel = findeDoppel({ text: teil.text }, belege.filter(b => b.text));

      const tri = triageRegeln(
        { text: teil.text, dateiname: name, parseMethode: 'ocr', dateiHash: teilHash },
        { periode: jahr, bekannteHashes },
      );
      bekannteHashes.push(teilHash);

      const zuord = tri.belegart ? positionenFuer(tri.belegart) : { positionen: [], offen: true };
      const vorschlag = zuord.positionen || [];
      // Nur eine eindeutige Zuordnung wird gesetzt. Zwei Kandidaten sind eine
      // Frage an den Menschen, keine Münze zum Werfen.
      const position = tri.grund === 'duplikat' ? '_aussortiert'
                     : (vorschlag.length === 1 ? vorschlag[0].id : null);

      const p = position ? KATALOG_NACH_ID[position] : null;
      const t = p && (p.einkommen || p.vermoegen) ? findeSeiten(teil.text, position) : null;
      const hatBetrag = t && (t.einkommen != null || t.vermoegen != null);

      belege.push({
        id: teilHash,
        name: teilName,
        hash: teilHash,
        dateiPfad: datei,
        vonSeite: teil.von, bisSeite: teil.bis, trennGrund: teil.grund,
        text: teil.text,

        belegart: tri.belegart,
        confidence: tri.confidence,
        begruendung: tri.begruendung,
        quelle: 'regel',
        merkmale: tri.merkmale || [],
        periodeBeleg: tri.periodeBeleg,
        // «nicht relevant» ist eine Aussage, keine Ratlosigkeit — Werbung und
        // Mahnungen sind erkannt worden. Ohne dieses Feld landen sie im Report
        // bei den unentschiedenen Belegen und blähen die Prüfliste auf.
        relevanz: tri.relevanz,
        relevanzGrund: tri.grund || null,

        position,
        kandidaten: vorschlag.length > 1 ? vorschlag.map(x => x.id)
                  : (zuord.kandidaten || []).map(x => x.id),
        kandidatenGrund: zuord.grund || null,
        dimensionen: offeneDimensionen(vorschlag),

        einkommen: hatBetrag ? t.einkommen : null,
        vermoegen: hatBetrag ? t.vermoegen : null,
        betragQuelle: hatBetrag ? 'regel' : null,
        betragAnker: hatBetrag ? t.anker : null,

        vonHand: false,
        doppelVerdacht: doppel ? { name: doppel.name, score: doppel.score } : null,
        ocrNoetig: false,
      });
    }
  }

  return { dateien, belege, scans, fehler };
}

/** Die Belege in die Gruppen teilen, nach denen der Report gegliedert ist. */
export function gruppiere(belege) {
  const zugeordnet = belege.filter(b => b.position && b.position !== '_aussortiert');
  return {
    zugeordnet,
    duplikate: belege.filter(b => b.position === '_aussortiert'),
    // Nicht relevant heisst: die Regeln haben den Beleg eingeordnet und er
    // gehört nicht in die Erklärung. Aussortiert wird trotzdem nicht
    // automatisch — das bleibt wie im Modul die Entscheidung des Menschen,
    // hier steht nur der Vorschlag. Getrennt von den offenen Belegen, weil es
    // zwei verschiedene Arten von Arbeit sind: bestätigen gegenüber entscheiden.
    nichtRelevant: belege.filter(b => !b.position && b.relevanz === RELEVANZ.NICHT_RELEVANT),
    // Seiten ohne Textebene sind keine offene Entscheidung — es gibt nichts
    // zu entscheiden, solange niemand sie gelesen hat. Eigene Gruppe, sonst
    // sieht die Prüfliste nach Arbeit aus, die hier gar nicht möglich ist.
    ocrNoetig: belege.filter(b => b.ocrNoetig),
    offen: belege.filter(b => !b.position && !b.ocrNoetig
                           && b.relevanz !== RELEVANZ.NICHT_RELEVANT),
    ohneBetrag: zugeordnet.filter(b => {
      const p = KATALOG_NACH_ID[b.position];
      return (p?.einkommen && b.einkommen == null) || (p?.vermoegen && b.vermoegen == null);
    }),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// Aufruf von der Kommandozeile
// ══════════════════════════════════════════════════════════════════════════

function argument(name, standard = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : standard;
}

async function hauptlauf() {
  const ordner = argument('ordner');
  const jahr = Number(argument('jahr', new Date().getFullYear() - 1));
  const jsonZiel = argument('json');
  const maxSeiten = Number(argument('maxseiten', 40));
  const ocrDatei = argument('ocr');

  if (!ordner) {
    console.error(`Aufruf: node scripts/steuer-erfassung.mjs --ordner <pfad> [--jahr 2025] [--json out.json]

  --ordner     Verzeichnis mit den Belegen (PDF), wird rekursiv gelesen
  --jahr       Steuerperiode; steuert die Periodenprüfung  (Vorgabe: Vorjahr)
  --json       Datei für die Ausgabe, direkt weiterverwendbar mit
               steuer-arbeitsliste.mjs --datei
  --maxseiten  Seitenobergrenze je PDF                     (Vorgabe: 40)
  --ocr        Ausgabe von steuer-ocr.mjs; fuellt die Seiten ohne Textebene`);
    process.exit(1);
  }

  // Die OCR-Ausgabe steht je Datei und Seite bereit — steuer-ocr.mjs schreibt
  // eine Datei je PDF, hier wird nach Dateiname geschluesselt.
  let ocr = null;
  if (ocrDatei) {
    try {
      const roh = JSON.parse(readFileSync(ocrDatei, 'utf-8'));
      const name = basename(roh.datei || '');
      ocr = { [name]: Object.fromEntries(
        (roh.seiten || []).filter(x => x.text).map(x => [x.nr, x])) };
      const gelesen = Object.keys(ocr[name]).length;
      console.log(`OCR-Text eingelesen: ${gelesen} Seiten aus «${name}»\n`);
    } catch (e) {
      console.error(`OCR-Datei «${ocrDatei}» nicht lesbar: ${e.message}`);
      process.exit(2);
    }
  }

  let lauf;
  try {
    lauf = await erfasseOrdner({ ordner, jahr, maxSeiten, ocr });
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const { dateien, belege, scans, fehler } = lauf;
  if (!dateien.length) {
    console.error(`Keine PDF unter «${ordner}» gefunden.`);
    process.exit(2);
  }

  if (jsonZiel) writeFileSync(jsonZiel, JSON.stringify(belege, null, 2), 'utf-8');

  const { zugeordnet, duplikate, nichtRelevant, offen, ohneBetrag, ocrNoetig }
    = gruppiere(belege);

  console.log(`ERFASSUNG  Steuerjahr ${jahr}`);
  console.log(`${dateien.length} Datei${dateien.length === 1 ? '' : 'en'} gelesen · ${belege.length} Belege erkannt\n`);
  console.log(`  ${zugeordnet.length} eindeutig zugeordnet`);
  console.log(`  ${offen.length} offen — Zuordnung von Hand`);
  console.log(`  ${ocrNoetig.length} ohne Textebene — nicht gelesen, OCR nötig`);
  console.log(`  ${nichtRelevant.length} nicht relevant — Vorschlag: aussortieren`);
  console.log(`  ${duplikate.length} als Doppel aussortiert`);
  console.log(`  ${ohneBetrag.length} zugeordnet, aber ohne Betrag`);

  if (scans.length) {
    console.log(`\n⚠ ${scans.length} Datei${scans.length === 1 ? '' : 'en'} mit Seiten ohne Textebene.`);
    console.log('  Das sind Scans; sie brauchen OCR und gehören ins Belegsortierungs-Modul.');
    for (const s of scans) {
      console.log(s.teilweise
        ? `    · ${s.name}: ${s.seitenOhneText} von ${s.seiten} Seiten ohne Text — Rest verarbeitet`
        : `    · ${s.name}: alle ${s.seiten} Seiten ohne Text — nicht verarbeitet`);
    }
  }
  if (fehler.length) {
    console.log(`\n⚠ ${fehler.length} Datei${fehler.length === 1 ? '' : 'en'} nicht lesbar:`);
    for (const f of fehler) console.log(`    · ${f.name}: ${f.meldung}`);
  }

  if (offen.length) {
    console.log('\nOFFEN — diese Belege brauchen eine Entscheidung:');
    for (const b of offen) {
      const wie = b.kandidaten.length
        ? `${b.kandidaten.length} Kandidaten (${b.kandidatenGrund || 'Unterscheidung unklar'})`
        : (b.belegart ? `Belegart «${b.belegart}», aber kein Ziel` : 'Belegart nicht erkannt');
      console.log(`  · ${b.name} — ${wie}`);
    }
  }

  if (ocrNoetig.length) {
    console.log('\nOHNE TEXTEBENE — diese Seiten hat niemand gelesen:');
    for (const b of ocrNoetig) {
      const n = b.bisSeite - b.vonSeite + 1;
      console.log(`  · ${b.name} (${n} Seite${n === 1 ? '' : 'n'})`);
    }
    console.log('  Sie zählen oben NICHT als erfasst. Im Belegsortierungs-Modul einlesen.');
  }

  if (nichtRelevant.length) {
    console.log('\nNICHT RELEVANT — Vorschlag zum Aussortieren, bitte kurz bestätigen:');
    for (const b of nichtRelevant) {
      console.log(`  · ${b.name} — Muster «${b.relevanzGrund || 'unbekannt'}»`);
    }
  }

  // Ein zugeordneter Beleg ohne Betrag ist die unauffälligste Lücke im Stapel:
  // er zählt oben als erfasst, trägt in der Arbeitsliste aber nichts bei.
  // Darum namentlich, mit der Angabe, welche Seite fehlt.
  if (ohneBetrag.length) {
    console.log('\nZUGEORDNET, ABER OHNE BETRAG — Zahl von Hand nachtragen:');
    for (const b of ohneBetrag) {
      const p = KATALOG_NACH_ID[b.position];
      const fehlt = [
        p?.einkommen && b.einkommen == null ? p.einkommen : null,
        p?.vermoegen && b.vermoegen == null ? p.vermoegen : null,
      ].filter(Boolean).join(' + ');
      console.log(`  · ${b.name} → ${p?.label || b.position}: ${fehlt} nicht gefunden`);
    }
  }

  const abweichend = belege.filter(b => b.periodeBeleg && b.periodeBeleg !== jahr);
  if (abweichend.length) {
    console.log(`\n⚠ ${abweichend.length} Beleg${abweichend.length === 1 ? '' : 'e'} aus einer anderen Periode:`);
    for (const b of abweichend) console.log(`    · ${b.name} → ${b.periodeBeleg}`);
  }

  if (jsonZiel) {
    console.log(`\nGeschrieben: ${jsonZiel}`);
    console.log(`Weiter mit:  node scripts/steuer-arbeitsliste.mjs --datei ${jsonZiel} --mandant "…" --jahr ${jahr}`);
  } else {
    console.log('\nOhne --json wird nichts gespeichert. Für die Arbeitsliste --json setzen.');
  }
}

// Nur beim direkten Aufruf laufen — importiert wird die Datei vom Test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await hauptlauf();
}
