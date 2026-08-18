// Ein PDF in einzelne Belege zerlegen.
//
// Ein eingescanntes Bündel enthält selten einen Beleg. Der Umbau-Ordner eines
// Mandanten hat 38 Seiten und darauf 30 Vergütungsaufträge — jeder ein eigener
// Beleg mit eigenem Datum und eigenem Betrag. Wer nur die erste Seite ansieht,
// erfasst einen von dreissig.
//
// Getrennt wird über die Seite selbst, nicht über Bildvergleich:
//
//   Fortsetzung   «Seite 2», «Übertrag», «Fortsetzung» — die Seite gehört zur
//                 vorherigen. Das sind gedruckte Wörter und damit das
//                 verlässlichste Signal überhaupt.
//   Neuer Beleg   Adressblock, Belegnummer mit Datum, Ortszeile mit Datum.
//                 So beginnt in der Schweiz praktisch jedes Geschäftspapier.
//
// Alles OCR-tolerant: aus «Übertrag» wird «Ubertrag», aus «Vergütungsauftrag»
// wird «Vergiitungsauftrag». Umlaute werden deshalb flachgeklopft und die
// Muster bleiben grosszügig.

/** Umlaute und Schreibweisen einebnen – OCR verschluckt sie regelmässig. */
function flach(s) {
  return String(s || '').toLowerCase()
    .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
    .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u')
    .replace(/ii/g, 'u')             // OCR macht aus «ü» oft «ii»
    .replace(/[^a-z0-9\s.,:\/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// «Seite: 2», «Seite 2 von 5», «Blatt 3», «- 2 -»
const FORTSETZUNG = [
  /\bseite\s*:?\s*([2-9]|[1-9]\d)\b/,
  /\bblatt\s*:?\s*([2-9]|[1-9]\d)\b/,
  /\bubertrag\b/,
  /\bfortsetzung\b/,
  /\bseite\s*([2-9]|[1-9]\d)\s*(von|\/)\s*\d+/,
];

// Beginn eines Geschäftspapiers.
//
// Die Muster fangen, wo immer möglich, den KONKRETEN WERT mit (Nummer oder
// Datum) — die Briefpapier-Regel vergleicht den ganzen Treffer mit der
// Vorseite: gleiche Rechnungsnummer wiederholt = Fortsetzung, NEUE Nummer =
// neuer Beleg. Ohne den Wert im Treffer erstickte die Briefpapier-Regel
// ganze Stapel gleicher Absender («Stadtwerke-Rechnung um Rechnung») zu
// einem einzigen Beleg, weil «rechnung nr» auf jeder Seite gleich aussieht.
const NEUER_BELEG = [
  // Belegnummer mit Datum: «Vergütungsauftrag Nr. 38.01 vom 31.01.2025»
  /\b(nr\.?|nummer)\s*[\d.\/-]{2,12}\s*vom\s*\d{1,2}[.\s]/,
  // Belegnummer mit Wert: «Rechnung Nr. 3291314.13»
  /\b(rechnung|gutschrift|quittung|beleg|auftrag|bescheinigung|ausweis|auszug)s?[\s.-]*(nr\.?|nummer)\s*[.:]?\s*[a-z]?\d[\d.\/-]{1,14}/,
  /\brechnungs-?nr\.?\s*[.:]?\s*[a-z]?\d[\d.\/-]{1,14}/,
  // Rechnungsdatum mit Wert: «Rechnungsdatum: 12.05.2025» / «Rechnung vom 12.05.2025»
  /\brechnungsdatum\s*[.:]?\s*\d{1,2}[.]\s?\d{1,2}[.]\s?\d{2,4}/,
  /\b(rechnung|gutschrift)\s*vom\s*\d{1,2}[.]\s?\d{1,2}[.]\s?\d{2,4}/,
  // Formen ohne lesbaren Wert (OCR frisst die Nummer): bleiben als schwaches
  // Signal drin — die Briefpapier-Regel unterdrückt sie bei Wiederholung.
  /\b(rechnung|gutschrift|quittung|beleg|auftrag|bescheinigung|ausweis|auszug)\s*(nr\.?|nummer)/,
  /\brechnungsdatum\b/,
  // Ortszeile mit ausgeschriebenem Datum: «Schmerikon, 16. Januar 2025»
  /\b[a-z]{3,},\s*\d{1,2}\.\s*(januar|februar|marz|april|mai|juni|juli|august|september|oktober|november|dezember)\s*\d{4}/,
  // Empfängerblock
  /\b(bauherr|empfanger|kunde|kundin|versicherte person|zahlbar durch)\b/,
];

// ── Kopf-Evidenz ─────────────────────────────────────────────────────────
//
// Woran ein Beleg anfängt, ist am Papier abgelesen und nicht geraten: JEDES
// Geschäftspapier trägt oben einen Kopf — Absender mit Strasse, Postfach,
// Telefon oder Web, und/oder den Empfänger mit PLZ und Ort. Eine RÜCKSEITE
// hat das nicht; sie beginnt mitten im Stoff («Kontoauszug», «Übertrag»).
//
// Gemessen am Versicherungsbündel eines Mandanten (7 Seiten, 5 Belege): Die
// alte Regel «irgendwo im Kopfbereich steht eine PLZ» riss die Rückseiten der
// Allianz-Rechnungen ab, weil in deren Tabelle unter «Versicherte Orte» eine
// PLZ steht. Mit der Kopf-Evidenz bleiben sie bei ihrer Vorderseite.
const STRASSE = /\b[a-z]{3,}(strasse|gasse|weg|platz|allee|ring|damm)\s+\d{1,4}\b/;
// PLZ + Ort — NICHT hinter Ziffer/Punkt (sonst wird «08.11.2024
// Folgeprämie» zur Adresse) und der Ort braucht drei Buchstaben
// (sonst macht OCR-Schrott «2023 a...» eine Adresse daraus).
const PLZ_ORT = /(?<![\d.,])(1[0-9]{3}|[2-9][0-9]{3})\s+[a-z]{3,}/;
const KONTAKT = /(postfach|telefon|tel\.|www\.|@[a-z0-9-]+\.(ch|com|li|de))/;
// Das Datum im Kopf gehört zur Evidenz: Derselbe Absender schickt im
// selben Umschlag mehrere Schreiben (Police, Bauzeitversicherung,
// Prämienrechnung) — sie unterscheiden sich am Datum, nicht am Briefkopf.
const DATUM = /\b\d{1,2}\.\s?(januar|februar|marz|april|mai|juni|juli|august|september|oktober|november|dezember)\s?\d{4}|\b\d{1,2}\.\d{1,2}\.\d{4}\b/;

/**
 * Kopfmerkmale der ersten Zeilen einer Seite.
 *
 *   absender  Strasse, PLZ+Ort, Postfach/Telefon/Web — der BRIEFKOPF.
 *             Fehlt er ganz, ist die Seite eine Rückseite oder ein
 *             Anhangsblatt und beginnt keinen neuen Beleg.
 *   merkmale  Briefkopf PLUS Datum. Das Datum unterscheidet zwei Schreiben
 *             DESSELBEN Absenders (Police, Bauzeitversicherung, Rechnung im
 *             selben Umschlag) — aber nur, wenn überhaupt ein Kopf da ist.
 *             Sonst würde das «Kontostand vom …» einer Rückseite zählen.
 */
export function kopfEvidenz(seitenText, zeilen = 12) {
  const kopf = flach(
    String(seitenText || '').split('\n').filter(z => z.trim()).slice(0, zeilen).join(' ')
  );
  const absender = [];
  for (const m of [STRASSE, PLZ_ORT, KONTAKT]) {
    const t = kopf.match(m);
    if (t) absender.push(t[0].trim());
  }
  const merkmale = [...absender];
  if (absender.length) {
    const d = kopf.match(DATUM);
    if (d) merkmale.push(d[0].trim());
  }
  return { absender, merkmale };
}

/**
 * Entscheidet für eine Seite, ob sie einen neuen Beleg beginnt.
 *
 * @param {string} seitenText   OCR-Text der Seite
 * @param {number} nummer       1-basierte Seitennummer im PDF
 * @param {string} vorherText   OCR-Text der Seite davor (fürs Briefpapier)
 * @returns {{neu:boolean, grund:string}}
 */
export function beginntNeuenBeleg(seitenText, nummer, vorherText = '') {
  if (nummer === 1) return { neu: true, grund: 'erste Seite' };

  const t = flach(seitenText);
  // Der Kopfbereich entscheidet – weiter unten stehen Tabellen und Summen,
  // in denen zufällig Datumsangaben und Nummern vorkommen.
  const kopf = t.slice(0, 700);
  const vorher = flach(vorherText);

  // Briefpapier-Regel: Was auf der Seite davor IDENTISCH vorkam, ist
  // Kopf- oder Fusszeile des Absenders, kein Beleganfang. Die ZKB druckt
  // «Horgen, 31. Dezember 2025» auf jede Seite ihres Steuerausweises –
  // ohne diese Regel zerfiel der 15-Seiter in zehn Einzelbelege.
  // Eine Belegnummer mit Datum («Nr. 38.01 vom …») ändert sich je Beleg
  // und bleibt damit ein gültiges Signal.
  const istBriefpapier = (treffer) => vorher.includes(flach(treffer).trim());

  for (const m of FORTSETZUNG) {
    const treffer = kopf.match(m);
    if (treffer) return { neu: false, grund: `Fortsetzung («${treffer[0].trim()}»)` };
  }

  // Ohne Briefkopf kein neuer Beleg: Rückseiten und Anhangsblätter beginnen
  // mitten im Stoff. Das ist die verlässlichste Bremse gegen Übertrennung.
  const evidenz = kopfEvidenz(seitenText);
  if (!evidenz.absender.length) return { neu: false, grund: 'kein Briefkopf – Rückseite' };

  for (const m of NEUER_BELEG) {
    const treffer = kopf.match(m);
    if (!treffer) continue;
    if (istBriefpapier(treffer[0])) continue;   // wiederkehrend = Briefpapier
    return { neu: true, grund: `neuer Beleg («${treffer[0].trim().slice(0, 40)}»)` };
  }

  // Briefkopf vorhanden und anders als auf der Vorseite → neues Papier.
  const evidenzVorher = kopfEvidenz(vorherText).merkmale;
  const neuerKopf = evidenz.merkmale.find(x => !evidenzVorher.includes(x));
  if (neuerKopf) return { neu: true, grund: `neuer Briefkopf («${neuerKopf.slice(0, 34)}»)` };

  // Gleicher Briefkopf wie davor: mehrseitiges Schreiben desselben Absenders.
  return { neu: false, grund: 'gleicher Briefkopf wie davor' };
}

/**
 * Zerlegt eine Folge von Seitentexten in Belege.
 *
 * @param {string[]} seiten  OCR-Text je Seite, in Reihenfolge
 * @returns {Array<{von:number, bis:number, grund:string, text:string}>}
 *          von/bis sind 1-basiert und einschliesslich
 */
export function trenneBelege(seiten) {
  if (!seiten?.length) return [];
  const belege = [];
  for (let i = 0; i < seiten.length; i++) {
    const { neu, grund } = beginntNeuenBeleg(seiten[i], i + 1, seiten[i - 1] || '');
    if (neu || !belege.length) {
      belege.push({ von: i + 1, bis: i + 1, grund, text: seiten[i] || '' });
    } else {
      const letzter = belege[belege.length - 1];
      letzter.bis = i + 1;
      letzter.text += '\n' + (seiten[i] || '');
    }
  }
  return belege;
}

/** Lesbare Bezeichnung: «Seiten 3–5» oder «Seite 7». */
export function seitenLabel(beleg) {
  return beleg.von === beleg.bis ? `Seite ${beleg.von}` : `Seiten ${beleg.von}–${beleg.bis}`;
}
