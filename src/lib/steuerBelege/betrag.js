// Beträge aus einem Beleg auslesen — immer BEIDE Seiten.
//
// Die Steuererklärung hat zwei Dimensionen, und jeder Beleg bedient eine oder
// beide: der Lohnausweis nur das Einkommen, der Autokaufvertrag nur das
// Vermögen, der Bank-Steuerausweis beide (Ertrag + Steuerwert 31.12.), der
// Hypothekarausweis beide (Schuldzins als Abzug + Restschuld). Gesucht wird
// deshalb je Position mit ZWEI Ankertafeln — was auf einer Seite nichts hat,
// bleibt dort leer.
//
// Die Anker sind bewusst OCR-tolerant — auf einem Scan wird aus «11.» leicht
// «ll.» und aus «'» ein «’» oder gar nichts. Und sie sind GEORDNET: der erste
// Treffer gewinnt. Beim Vergütungsauftrag steht «Total Auszahlung» (der Betrag
// dieses Belegs) VOR dem kumulierten «Gesamttotal» über alle bisherigen —
// wer das generische «total» zuerst sucht, addiert die Baukosten doppelt.

/** Anker für die EINKOMMENSSEITE (Einkünfte und Abzüge), je Position. */
export const ANKER_EINKOMMEN = {
  lohn_haupt:  ['nettolohn', 'netto lohn', 'lohn netto', 'ziffer 11'],
  lohn_neben:  ['nettolohn', 'netto lohn', 'ziffer 11'],
  selbstaendig: ['reingewinn', 'jahresgewinn', 'gewinn'],
  rente_ahv:   ['jahresrente', 'total rente', 'rente'],
  rente_pk:    ['jahresrente', 'total rente', 'rente'],
  rente_saeule3: ['kapitalleistung', 'jahresrente', 'rente'],
  ersatz:      ['total taggelder', 'taggeld'],
  alimente_erhalten: ['unterhaltsbeitrag', 'alimente'],
  wertschriften: ['bruttoertrag', 'zinsertrag', 'habenzins', 'dividende', 'ertrag'],
  beteiligung_qualifiziert: ['bruttodividende', 'dividende', 'bruttoertrag'],
  liegenschaft_ertrag: ['mietzins', 'mietertrag', 'eigenmietwert'],
  // «total» steht bewusst ganz hinten: beim Vergütungsauftrag ist «Total
  // Auszahlung» der Betrag dieses Belegs, «Gesamttotal» das kumulierte
  // Bausummen-Total. (Die GVZ-Falle «Versicherungssumme Total 6'500'000»
  // fängt der Sperr-Kontext in sucheMitAnkern.)
  liegenschaftsunterhalt: ['total auszahlung', 'rechnungsbetrag', 'endbetrag',
                           'zu bezahlen', 'zahlbetrag', 'total'],
  schulden:    ['schuldzins', 'hypothekarzins', 'zinsaufwand', 'sollzins', 'zinsen'],
  berufsauslagen_fahrkosten:  ['abonnement', 'total'],
  berufsauslagen_verpflegung: ['total'],
  berufsauslagen_uebrige:     ['total'],
  weiterbildung: ['kurskosten', 'kursgeld', 'total', 'rechnungsbetrag'],
  saeule_3a:   ['einzahlung', 'geleistete beitraege', 'total beitraege', 'beitrag'],
  einkauf_pk:  ['einkaufssumme', 'freiwilliger einkauf', 'einkauf'],
  ahv_beitraege: ['jahresbeitrag', 'beitrag'],
  versicherungspraemien: ['total praemien', 'praemien total', 'jahrespraemie', 'praemie'],
  krankheitskosten: ['selbst getragen', 'selbstbehalt', 'franchise', 'zu ihren lasten'],
  behinderungskosten: ['total', 'betrag'],
  alimente_bezahlt: ['unterhaltsbeitrag', 'alimente'],
  kinderbetreuung: ['total', 'rechnungsbetrag'],
  spenden:     ['spende', 'zuwendung', 'betrag'],
  parteispenden: ['spende', 'zuwendung'],
  uebrige_abzuege: ['depotgebuehr', 'verwaltungsgebuehr', 'gebuehren', 'total'],
};

/** Anker für die VERMÖGENSSEITE (Bestand per 31.12.), je Position. */
export const ANKER_VERMOEGEN = {
  wertschriften: ['steuerwert', 'saldo per', 'kontostand', 'guthaben per', 'saldo'],
  beteiligung_qualifiziert: ['steuerwert', 'nennwert'],
  krypto:        ['bestand', 'steuerwert', 'saldo'],
  liegenschaften: ['steuerwert', 'amtlicher wert', 'verkehrswert'],
  schulden:      ['restschuld', 'kapitalbetrag', 'darlehensbetrag', 'saldo per', 'saldo'],
  selbstaendig:  ['eigenkapital', 'kapital per'],
  bargeld:       ['bestand', 'steuerwert', 'wert'],
  lebensversicherung: ['rueckkaufswert', 'steuerwert'],
  fahrzeuge:     ['zeitwert', 'kaufpreis', 'eurotax'],
  uebriges_vermoegen: ['darlehensbetrag', 'nominalwert', 'wert per'],
};

function flach(s) {
  return String(s || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u')
    .replace(/[^a-z0-9\s.,'’-]/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Wandelt eine Schweizer Betragsschreibweise in eine Zahl.
 * 112'480.00 · 112’480 · 112 480,00 · 112480.-
 * Gibt null zurück, wenn es keine plausible Zahl ist.
 */
export function alsZahl(roh) {
  if (!roh) return null;
  let s = String(roh).trim()
    .replace(/cHF|chf|fr\.?/gi, '')
    .replace(/[’'`´]/g, '')          // Tausendertrennzeichen aller Schreibweisen
    .replace(/\s(?=\d{3}\b)/g, '')   // Leerzeichen als Trenner
    .replace(/[.,]-$/, '')           // «1200.-»
    .trim();
  // letztes , oder . mit genau zwei Stellen ist der Dezimalpunkt
  const dez = s.match(/^(-?[\d.,]+?)[.,](\d{2})$/);
  if (dez) s = dez[1].replace(/[.,]/g, '') + '.' + dez[2];
  else     s = s.replace(/[.,]/g, '');
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) > 500_000_000) return null;   // OCR-Unfug
  return n;
}

const BETRAG_MUSTER = /-?\d{1,3}(?:[’'`\s.]\d{3})+(?:[.,]\d{2})?|-?\d+[.,]\d{2}\b|-?\d{4,9}\b/g;

// Steht so etwas DIREKT VOR dem Ankertreffer, beschriftet die Zahl daneben
// keinen Betrag der Erklärung: «Versicherungssumme Total CHF 6'500'000» ist
// der Gebäudewert, «Kunden-Nr. 160947» eine Nummer. Gemessen an der GVZ-
// Bauzeitversicherung und der GVA-Prämienrechnung dieses Mandats.
const SPERR_KONTEXT = [
  'versicherungssumme', 'versicherungswert', 'deckungssumme', 'garantiesumme',
  'gebaudewert', 'neuwert', 'kunden-nr', 'kundennummer', 'rechnungs-nr',
  'rechnungsnummer', 'baukosten',
];

/**
 * Kern der Suche: erster Anker, der im Text eine plausible Zahl neben sich hat.
 *
 * @param {string}   text
 * @param {string[]} anker  geordnet, verlässlichster zuerst
 * @param {number}   max    Obergrenze für plausible Werte dieser Seite
 * @returns {{betrag:number, anker:string, confidence:number}|null}
 */
/**
 * Wörter, die einen Anker als Silbe enthalten, aber etwas anderes meinen.
 *
 * Die Ankersuche arbeitet auf dem rohen Text, weil Belege ihre Begriffe
 * beliebig zusammensetzen — «Bruttoertrag», «Mietertrag», «Kapitalertrag»
 * sollen alle auf «ertrag» ansprechen. Der Preis dafür sind Silbentreffer:
 * an einem echten Kontoauszug wurde «Übertrag auf Hypothek Nr. 94124208
 * 718.65» zu einem Wertschriftenertrag von 718.65. Das ist die teuerste Sorte
 * Fehler, die dieses Modul machen kann — eine Zahl, die stimmen könnte, an
 * einer Stelle, an der sie nicht hingehört, und niemand stutzt.
 *
 * Gesperrt wird nur, wenn das umgebende Wort NICHT der Anker selbst ist:
 * «Betrag» als Anker bleibt «Betrag».
 */
const SILBEN_SPERRE = ['ubertrag', 'vertrag', 'wertschrift'];

/** Das ganze Wort um eine Fundstelle herum. */
function wortUm(t, von, bis) {
  let a = von, e = bis;
  while (a > 0 && /[a-z0-9]/.test(t[a - 1])) a--;
  while (e < t.length && /[a-z0-9]/.test(t[e])) e++;
  return t.slice(a, e);
}

function sucheMitAnkern(text, anker, max = 500_000_000) {
  if (!text || !anker?.length) return null;
  const t = flach(text);

  for (let i = 0; i < anker.length; i++) {
    const a = flach(anker[i]);
    let ab = 0;
    while (true) {
      const treffer = t.indexOf(a, ab);
      if (treffer < 0) break;
      ab = treffer + a.length;

      // Silbentreffer: steckt der Anker nur als Teil eines Wortes drin, das
      // etwas anderes meint, zaehlt das Vorkommen nicht.
      const wort = wortUm(t, treffer, treffer + a.length);
      if (wort !== a && SILBEN_SPERRE.some(x => wort.startsWith(x))) continue;

      // Sperr-Kontext: beschriftet der Text davor eine Summe, die kein
      // Erklärungsbetrag ist, zählt dieses Vorkommen nicht.
      const davor = t.slice(Math.max(0, treffer - 60), treffer);
      if (SPERR_KONTEXT.some(x => davor.includes(x))) continue;

      // Der Betrag steht rechts vom Begriff oder in derselben Zeile darunter.
      const fenster = t.slice(treffer, treffer + 160);
      const zahlen = fenster.match(BETRAG_MUSTER) || [];
      for (const z of zahlen) {
        const n = alsZahl(z);
        // Jahreszahlen und Ziffernnummern aussortieren – sie stehen überall
        if (n == null || n === 0) continue;
        if (n >= 1900 && n <= 2100 && !/[.,]\d{2}$/.test(z)) continue;
        if (Math.abs(n) < 10 || Math.abs(n) > max) continue;
        // Daten aussortieren: «31.12» sieht aus wie ein Betrag mit Rappen,
        // ist aber der Stichtag («Restschuld per 31.12.»). Tag ≤ 31 und
        // Nachkommateil, der als Monat taugt → kein Betrag.
        if (/^\d{1,2}[.,]\d{2}$/.test(z) && n < 32) {
          const monat = Number.parseInt(z.slice(-2), 10);
          if (monat >= 1 && monat <= 12) continue;
        }
        return {
          betrag: n,
          anker: anker[i],
          // Der erste Ankerbegriff ist der verlässlichste; danach sinkt es.
          confidence: Math.max(0.35, 0.8 - i * 0.12),
        };
      }
    }
  }
  return null;
}

/**
 * Beide Seiten einer Position suchen.
 *
 * @returns {{einkommen:number|null, vermoegen:number|null,
 *            anker:string|null, confidence:number|null}}
 */
export function findeSeiten(text, positionId) {
  // Einkommensseite: über 10 Mio ist bei einer Privatperson kein Lohn, keine
  // Prämie und kein Unterhalt, sondern zusammengeklebte OCR-Ziffern (gemessen:
  // «107'144'154.10» aus einer Handwerkerrechnung). Vermögensseite lässt mehr
  // zu — Liegenschaften und Depots erreichen echte zweistellige Millionen.
  const e = sucheMitAnkern(text, ANKER_EINKOMMEN[positionId], 10_000_000);
  const v = sucheMitAnkern(text, ANKER_VERMOEGEN[positionId]);
  // Beide Anker auf derselben Zahl (etwa «Saldo» und «Ertrag» im gleichen
  // Fenster): dann zählt nur die verlässlichere Seite.
  if (e && v && e.betrag === v.betrag) {
    if (e.confidence >= v.confidence) return sammle(e, null);
    return sammle(null, v);
  }
  return sammle(e, v);
}

function sammle(e, v) {
  return {
    einkommen: e?.betrag ?? null,
    vermoegen: v?.betrag ?? null,
    anker: e?.anker ?? v?.anker ?? null,
    confidence: Math.max(e?.confidence ?? 0, v?.confidence ?? 0) || null,
  };
}
