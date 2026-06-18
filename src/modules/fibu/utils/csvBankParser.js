/**
 * csvBankParser.js — Flexibler CSV-Bankkontoauszug-Parser
 *
 * Unterstützt gängige Schweizer Bank-Exports:
 *   • PostFinance    — Buchungsdatum;Buchungstext;Betrag;Avisierungstext
 *   • UBS / CS       — Valutadatum;Buchungsdatum;Buchungstext;Belastung CHF;Gutschrift CHF
 *   • Raiffeisen     — Ähnlich PostFinance
 *   • ZKB            — Ähnlich PostFinance
 *   • Generisch      — Datum + Beschreibung + Betrag (pos/neg)
 *
 * Output-Format identisch zu parseCamt053:
 *   { transactions: [...], kontoIban: null, warnings: [] }
 */

// ── Hilfsfunktionen ───────────────────────────────────────────────

/**
 * Datum parsen — unterstützt DD.MM.YYYY, YYYY-MM-DD, D.M.YYYY, DD/MM/YYYY
 */
function parseDate(raw) {
  if (!raw) return null;
  const s = raw.trim();
  // ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Swiss: DD.MM.YYYY oder D.M.YYYY
  const dotMatch = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotMatch) {
    const [, d, m, y] = dotMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Slash: DD/MM/YYYY
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, d, m, y] = slashMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

/**
 * Betrag parsen — Schweizer Format mit ' als Tausender-Trennzeichen
 * Gibt signed float zurück (negativ = Belastung)
 */
function parseAmount(raw) {
  if (raw == null || raw.toString().trim() === '') return null;
  const s = raw.toString().trim().replace(/'/g, '').replace(/\xa0/g, '').replace(/ /g, '');

  // Deutsches Format: Komma als Dezimaltrenner (z.B. "100,50" oder "1.234,56")
  if (/,\d+$/.test(s) && !/\.\d{1,2}$/.test(s)) {
    const normalized = s.replace(/\./g, '').replace(',', '.');
    const val = parseFloat(normalized);
    return isNaN(val) ? null : val;
  }

  // Englisches / CH-Format: Punkt als Dezimal, Komma als Tausender
  const normalized = s.replace(/,(?=\d{3}(\.|$))/g, '');
  const val = parseFloat(normalized);
  return isNaN(val) ? null : val;
}

/**
 * CSV-Text in Zeilen + Spalten aufteilen
 * Erkennt Semikolon oder Komma als Trenner
 */
function parseCsvLines(text) {
  // Zeilenenden normalisieren
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) return { separator: ';', header: [], rows: [] };

  // Trennzeichen erkennen: Semikolon hat Vorrang (CH-Norm)
  const sep = lines[0].includes(';') ? ';' : ',';

  // Einfaches CSV-Parsing (ohne Anführungszeichen-Handling)
  const parseRow = (line) =>
    line.split(sep).map(c => c.trim().replace(/^["']|["']$/g, ''));

  const header = parseRow(lines[0]).map(h => h.toLowerCase());
  const rows   = lines.slice(1).map(parseRow);

  return { separator: sep, header, rows };
}

/**
 * Spaltenindex anhand von Suchwörtern finden
 */
function findCol(header, ...terms) {
  for (const term of terms) {
    const idx = header.findIndex(h => h.includes(term.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

// ── Format-Erkennungen ────────────────────────────────────────────

/**
 * PostFinance / ZKB / Raiffeisen Format:
 *   Buchungsdatum ; Buchungstext ; Betrag ; ...
 */
function detectPostFinance(header) {
  const hasDate    = findCol(header, 'buchungsdatum', 'datum', 'date') >= 0;
  const hasText    = findCol(header, 'buchungstext', 'text', 'beschreibung', 'description') >= 0;
  const hasAmount  = findCol(header, 'betrag', 'amount') >= 0;
  return hasDate && hasText && hasAmount;
}

/**
 * UBS / CS Format:
 *   Valutadatum ; Buchungsdatum ; Buchungstext ; Belastung CHF ; Gutschrift CHF
 */
function detectUBS(header) {
  const hasDebit  = findCol(header, 'belastung', 'debit', 'abbuchung') >= 0;
  const hasCredit = findCol(header, 'gutschrift', 'credit', 'zuschrift', 'gutschr') >= 0;
  return hasDebit && hasCredit;
}

// ── Haupt-Parser ─────────────────────────────────────────────────

/**
 * CSV-Bankkontoauszug parsen
 *
 * @param {string} text - Inhalt der CSV-Datei
 * @returns {{ transactions: object[], kontoIban: null, warnings: string[] }}
 */
export function parseCsvBank(text) {
  const warnings = [];
  const { header, rows } = parseCsvLines(text);

  if (header.length === 0) {
    return { transactions: [], kontoIban: null, warnings: ['Leere oder ungültige CSV-Datei'] };
  }

  // ── Spalten-Mapping ─────────────────────────────────────────────
  let transactions = [];

  if (detectUBS(header)) {
    // ── UBS/CS: separate Belastung- und Gutschrift-Spalten ────────
    const iValuta  = findCol(header, 'valutadatum', 'wertstellung');
    const iDate    = findCol(header, 'buchungsdatum', 'buchungs', 'datum', 'date');
    const iText    = findCol(header, 'buchungstext', 'text', 'beschreibung', 'description', 'mitteilung');
    const iDebit   = findCol(header, 'belastung', 'debit', 'abbuchung');
    const iCredit  = findCol(header, 'gutschrift', 'credit', 'zuschrift', 'gutschr');
    const iIban    = findCol(header, 'iban', 'konto');

    for (const row of rows) {
      const datum   = parseDate(row[iDate] ?? row[iValuta]);
      if (!datum) continue;

      const debit  = parseAmount(row[iDebit]);
      const credit = parseAmount(row[iCredit]);

      let betrag, richtung;
      if (credit && credit > 0) {
        betrag = credit; richtung = 'eingang';
      } else if (debit && debit > 0) {
        betrag = debit; richtung = 'ausgang';
      } else {
        continue; // Saldo-Zeile o.ä.
      }

      transactions.push({
        buchungsdatum:    datum,
        valutadatum:      iValuta >= 0 ? parseDate(row[iValuta]) : null,
        betrag:           Math.round(betrag * 100) / 100,
        waehrung:         'CHF',
        richtung,
        gegenpartei_name: iIban >= 0 ? (row[iIban] || null) : null,
        gegenpartei_iban: null,
        referenz_typ:     null,
        referenz_nr:      null,
        end_to_end_id:    null,
        verwendungszweck: iText >= 0 ? (row[iText] || null) : null,
        zusatzinfo:       null,
        status:           'offen',
      });
    }

  } else if (detectPostFinance(header)) {
    // ── PostFinance / Raiffeisen / ZKB: einzelne Betrag-Spalte ──
    const iDate   = findCol(header, 'buchungsdatum', 'datum', 'date');
    const iValuta = findCol(header, 'valuta', 'wert', 'value');
    const iText   = findCol(header, 'buchungstext', 'text', 'beschreibung', 'description', 'mitteilung', 'avisierungstext');
    const iAmt    = findCol(header, 'betrag', 'amount', 'betrag chf', 'umsatz');
    const iCurr   = findCol(header, 'währung', 'currency', 'whrg');

    for (const row of rows) {
      const datum  = parseDate(row[iDate]);
      if (!datum) continue;
      const rawAmt = parseAmount(row[iAmt]);
      if (rawAmt === null || rawAmt === 0) continue;

      const waehrung = iCurr >= 0 ? (row[iCurr] || 'CHF') : 'CHF';

      transactions.push({
        buchungsdatum:    datum,
        valutadatum:      iValuta >= 0 ? parseDate(row[iValuta]) : null,
        betrag:           Math.round(Math.abs(rawAmt) * 100) / 100,
        waehrung:         waehrung.trim() || 'CHF',
        richtung:         rawAmt >= 0 ? 'eingang' : 'ausgang',
        gegenpartei_name: null,
        gegenpartei_iban: null,
        referenz_typ:     null,
        referenz_nr:      null,
        end_to_end_id:    null,
        verwendungszweck: iText >= 0 ? (row[iText] || null) : null,
        zusatzinfo:       null,
        status:           'offen',
      });
    }

  } else {
    // ── Generisch: Spalte 0=Datum, 1=Text, 2=Betrag ───────────────
    warnings.push('Format nicht erkannt — generisches Parsing (Spalte 0=Datum, 1=Text, 2=Betrag)');
    for (const row of rows) {
      if (row.length < 3) continue;
      const datum  = parseDate(row[0]);
      if (!datum) continue;
      const rawAmt = parseAmount(row[2]);
      if (rawAmt === null || rawAmt === 0) continue;

      transactions.push({
        buchungsdatum:    datum,
        valutadatum:      null,
        betrag:           Math.round(Math.abs(rawAmt) * 100) / 100,
        waehrung:         'CHF',
        richtung:         rawAmt >= 0 ? 'eingang' : 'ausgang',
        gegenpartei_name: null,
        gegenpartei_iban: null,
        referenz_typ:     null,
        referenz_nr:      null,
        end_to_end_id:    null,
        verwendungszweck: row[1] || null,
        zusatzinfo:       null,
        status:           'offen',
      });
    }
  }

  if (transactions.length === 0) {
    warnings.push('Keine Transaktionen erkannt — bitte CSV-Format prüfen.');
  }

  return { transactions, kontoIban: null, warnings };
}
