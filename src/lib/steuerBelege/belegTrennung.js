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

// Beginn eines Geschäftspapiers
const NEUER_BELEG = [
  // Belegnummer mit Datum: «Vergütungsauftrag Nr. 38.01 vom 31.01.2025»
  /\b(nr\.?|nummer)\s*[\d.\/-]{2,12}\s*vom\s*\d{1,2}[.\s]/,
  /\b(rechnung|gutschrift|quittung|beleg|auftrag|bescheinigung|ausweis|auszug)\s*(nr\.?|nummer)/,
  /\brechnungsdatum\b/,
  /\brechnungs-?nr\b/,
  // Ortszeile mit ausgeschriebenem Datum: «Schmerikon, 16. Januar 2025»
  /\b[a-z]{3,},\s*\d{1,2}\.\s*(januar|februar|marz|april|mai|juni|juli|august|september|oktober|november|dezember)\s*\d{4}/,
  // Empfängerblock
  /\b(bauherr|empfanger|kunde|kundin|versicherte person|zahlbar durch)\b/,
];

// Schweizer Adresszeile: 4-stellige PLZ + Ort
const ADRESSE = /\b(1[0-9]{3}|[2-9][0-9]{3})\s+[a-z][a-z.\s-]{2,24}\b/;

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

  for (const m of NEUER_BELEG) {
    const treffer = kopf.match(m);
    if (!treffer) continue;
    if (istBriefpapier(treffer[0])) continue;   // wiederkehrend = Briefpapier
    return { neu: true, grund: `neuer Beleg («${treffer[0].trim().slice(0, 40)}»)` };
  }

  const adr = kopf.match(ADRESSE);
  if (adr && !istBriefpapier(adr[0])) return { neu: true, grund: 'Adressblock im Kopf' };

  // Nichts erkannt: zur vorherigen Seite schlagen. Zusammenlassen ist die
  // vorsichtigere Annahme – ein zu gross geratener Beleg faellt beim
  // Durchsehen auf, ein zerrissener nicht.
  return { neu: false, grund: 'kein Trennsignal' };
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
