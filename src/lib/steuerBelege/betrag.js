// Betrag aus einem Beleg auslesen.
//
// Der Katalog sagt bei jeder Position, WELCHER Betrag gesucht wird — beim
// Lohnausweis der Nettolohn nach Ziffer 11, bei der Säule 3a die Einzahlung,
// bei der Bank der Bestand per 31.12. Genau das ist der Unterschied zwischen
// Raten und Auslesen: gesucht wird nicht «eine Zahl», sondern eine bestimmte.
//
// Zwei Stufen wie bei der Zuordnung: erst Anker im Text, dann erst die KI.
// Die Anker sind bewusst OCR-tolerant — auf einem Scan wird aus «11.» leicht
// «ll.» und aus «'» ein «’» oder gar nichts.

/** Ankerbegriffe je Katalogposition, in absteigender Verlässlichkeit. */
export const ANKER = {
  lohn_haupt:  ['nettolohn', 'netto lohn', 'lohn netto', 'ziffer 11', 'total brutto'],
  lohn_neben:  ['nettolohn', 'netto lohn', 'ziffer 11'],
  saeule_3a:   ['einzahlung', 'beitrag', 'geleistete beitraege', 'total beitraege'],
  einkauf_pk:  ['einkaufssumme', 'einkauf', 'freiwilliger einkauf'],
  versicherungspraemien: ['total praemien', 'praemien total', 'jahrespraemie', 'praemie'],
  krankheitskosten:      ['selbst getragen', 'selbstbehalt', 'franchise', 'zu ihren lasten'],
  schulden:              ['restschuld', 'kapitalbetrag', 'darlehensbetrag', 'saldo per', 'saldo'],
  wertschriften:         ['steuerwert', 'saldo per', 'kontostand', 'guthaben per', 'saldo'],
  beteiligung_qualifiziert: ['steuerwert', 'nennwert'],
  krypto:                ['bestand', 'steuerwert', 'saldo'],
  selbstaendig:          ['reingewinn', 'gewinn', 'jahresgewinn'],
  rente_ahv:   ['jahresrente', 'total rente', 'rente'],
  rente_pk:    ['jahresrente', 'total rente', 'rente'],
  spenden:     ['spende', 'zuwendung', 'betrag'],
  liegenschaftsunterhalt: ['total', 'rechnungsbetrag', 'endbetrag', 'zu bezahlen'],
  liegenschaft_ertrag:    ['mietzins', 'mietertrag', 'eigenmietwert'],
  liegenschaften:         ['steuerwert', 'amtlicher wert', 'verkehrswert'],
  weiterbildung:          ['kurskosten', 'total', 'rechnungsbetrag'],
  kinderbetreuung:        ['total', 'rechnungsbetrag'],
  ek_kapital:             ['einbezahlt', 'aktienkapital', 'stammkapital'],
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

/**
 * Sucht den Betrag zu einer Position.
 *
 * @returns {{betrag:number, anker:string, confidence:number}|null}
 */
export function findeBetrag(text, positionId) {
  if (!text) return null;
  const anker = ANKER[positionId];
  if (!anker?.length) return null;

  const t = flach(text);

  for (let i = 0; i < anker.length; i++) {
    const a = flach(anker[i]);
    let ab = 0;
    while (true) {
      const treffer = t.indexOf(a, ab);
      if (treffer < 0) break;
      ab = treffer + a.length;

      // Der Betrag steht rechts vom Begriff oder in derselben Zeile darunter.
      const fenster = t.slice(treffer, treffer + 160);
      const zahlen = fenster.match(BETRAG_MUSTER) || [];
      for (const z of zahlen) {
        const n = alsZahl(z);
        // Jahreszahlen und Ziffernnummern aussortieren – sie stehen überall
        if (n == null || n === 0) continue;
        if (n >= 1900 && n <= 2100 && !/[.,]\d{2}$/.test(z)) continue;
        if (Math.abs(n) < 10) continue;
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

/** Kurzer Ausschnitt rund um den Anker – für die Rückfrage an die KI. */
export function ausschnittUmAnker(text, positionId, zeichen = 900) {
  if (!text) return '';
  const anker = ANKER[positionId] || [];
  const t = flach(text);
  for (const a of anker) {
    const i = t.indexOf(flach(a));
    if (i >= 0) {
      const von = Math.max(0, i - Math.floor(zeichen / 3));
      return text.slice(von, von + zeichen);
    }
  }
  return text.slice(0, zeichen);
}

/**
 * Anker für das ZWEITE Betragsfeld der verschmolzenen Positionen — dort, wo
 * ein Beleg zwei Werte liefert (Wertschriften: Ertrag neben dem Steuerwert;
 * Schulden: Zins neben der Restschuld; Selbständige: Eigenkapital neben dem
 * Gewinn).
 */
export const ANKER2 = {
  wertschriften: ['bruttoertrag', 'zinsertrag', 'ertrag', 'dividende', 'habenzins'],
  beteiligung_qualifiziert: ['bruttodividende', 'dividende', 'bruttoertrag'],
  schulden:      ['schuldzins', 'zinsen', 'hypothekarzins', 'zinsaufwand', 'sollzins'],
  selbstaendig:  ['eigenkapital', 'kapital per'],
};

/** Beide Beträge einer Position suchen. betrag2 nur, wo ANKER2 etwas kennt. */
export function findeBetraege(text, positionId) {
  const erster = findeBetrag(text, positionId);
  const zweite = ANKER2[positionId];
  let betrag2 = null;
  if (zweite?.length && text) {
    const gemerkt = ANKER[positionId];
    ANKER[positionId] = zweite;               // kurzzeitig umhaengen, gleiche Suche
    const t = findeBetrag(text, positionId);
    ANKER[positionId] = gemerkt;
    if (t && t.betrag !== erster?.betrag) betrag2 = t.betrag;
  }
  return {
    betrag:  erster?.betrag ?? null,
    anker:   erster?.anker ?? null,
    confidence: erster?.confidence ?? null,
    betrag2,
  };
}
