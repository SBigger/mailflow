/**
 * camt.053 XML Parser — Schweizer Bankkontoauszüge
 *
 * Unterstützt alle gängigen Swiss-Bank-Varianten:
 *   • camt.053.001.02  — ältere Banken (kein Pty-Wrapper, Sts als Text)
 *   • camt.053.001.04  — Standard, Swiss SIC *.ch.02 (PostFinance, ZKB, Raiffeisen, Valiant)
 *   • camt.053.001.08  — neueste Version (UBS/CS, Sts als Cd-Element)
 *
 * Besondere Behandlung:
 *   • RVCD / RVDB (Reversal-Buchungen) → Richtung wird umgekehrt
 *   • RmtInf/Strd als Array (ISO 20022 erlaubt mehrere Strd-Blöcke)
 *   • CdOrPrtry/Prtry für Swiss-SIC-spezifische Referenztypen (QRR, SCOR, ESR)
 *   • PostFinance: AddtlTxInf als Verwendungszweck-Fallback
 *   • ZKB: Strd/AddtlRmtInf-Array
 *   • Valiant / ältere Banken: fehlende TxDtls → Ntry-Level-Felder
 *   • Batch-Buchungen (BtchBookg): TxDtls-Beträge statt Ntry-Betrag
 */
import { XMLParser } from 'fast-xml-parser';

const PARSER = new XMLParser({
  ignoreAttributes:    false,
  attributeNamePrefix: '@_',
  removeNSPrefix:      true,   // namespace-agnostisch (.02 / .04 / .08 / CH-SIC)
  isArray: (name) => [
    'Ntry', 'TxDtls', 'NtryDtls', 'Stmt', 'Bal',
    'Strd',           // RmtInf kann mehrere Strd-Blöcke haben (.04+)
    'AddtlRmtInf',    // ZKB: bis zu 3 × 140 Zeichen im Strd-Block
    'Ustrd',          // defensive: manche Implementierungen senden Array
  ].includes(name),
  parseTagValue: true,
  trimValues:    true,
});

// ── Primitiv-Helfer ─────────────────────────────────────────────────
function str(val) {
  if (val == null) return null;
  if (typeof val === 'object' && val['#text'] != null) return String(val['#text']).trim() || null;
  if (Array.isArray(val))  return val.map(v => str(v)).filter(Boolean).join(' ') || null;
  if (typeof val === 'string') return val.trim() || null;
  return String(val).trim() || null;
}

function num(val) {
  if (val == null) return null;
  const s = str(val) ?? String(val);
  return parseFloat(s.replace(/'/g, '').replace(/,/g, '.')) || null;
}

function ccy(amtNode) {
  return amtNode?.['@_Ccy'] ?? null;
}

function dateStr(node) {
  const d = str(node?.Dt) ?? str(node?.DtTm);
  return d?.substring(0, 10) ?? null;
}

/** Bereinigt E2E-ID: NOTPROVIDED / NOT PROVIDED / NONREF → null */
function cleanE2E(val) {
  const s = str(val);
  if (!s) return null;
  const upper = s.toUpperCase().replace(/\s+/g, '');
  if (upper === 'NOTPROVIDED' || upper === 'NONREF' || upper === 'NONE') return null;
  return s;
}

// ── QRR-Validierung ─────────────────────────────────────────────────
/** Validiert Schweizer QRR (27 Stellen, Modulo-10-rekursiv) */
export function isValidQRR(ref) {
  if (!ref || !/^\d{27}$/.test(ref)) return false;
  const table = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];
  let carry = 0;
  for (let i = 0; i < 26; i++) carry = table[(carry + parseInt(ref[i])) % 10];
  return (10 - carry) % 10 === parseInt(ref[26]);
}

/** Normalisiert QRR: Leerzeichen entfernen, 27 Stellen prüfen */
export function normalizeQRR(ref) {
  if (!ref) return null;
  const clean = ref.replace(/\s/g, '');
  return /^\d{27}$/.test(clean) ? clean : null;
}

// ── Referenz aus RmtInf extrahieren ─────────────────────────────────
/**
 * Durchsucht alle Strd-Blöcke nach CdtrRefInf.
 * Swiss-SIC nutzt Prtry statt Cd für QRR/SCOR/ESR.
 * Gibt { refTyp, refNr } zurück oder { null, null }.
 */
function extractRef(rmtInf) {
  if (!rmtInf) return { refTyp: null, refNr: null };

  // Strd ist als Array konfiguriert; wenn nicht vorhanden → leeres Array
  const strds = Array.isArray(rmtInf.Strd) ? rmtInf.Strd : (rmtInf.Strd ? [rmtInf.Strd] : []);

  for (const strd of strds) {
    const cri  = strd?.CdtrRefInf;
    if (!cri) continue;

    // Typ: ISO Cd (QRR, SCOR) oder proprietäres Prtry (Swiss-SIC: QRR, SCOR, ESR)
    const refTyp = str(cri?.Tp?.CdOrPrtry?.Cd)
                ?? str(cri?.Tp?.CdOrPrtry?.Prtry)
                ?? null;
    const rawRef = str(cri?.Ref);
    if (!rawRef) continue;

    // QRR: 27-stellig normalisieren + validieren
    if (!refTyp || refTyp === 'QRR' || refTyp === 'ESR') {
      const qrr = normalizeQRR(rawRef);
      if (qrr) return { refTyp: 'QRR', refNr: qrr };
    }
    // SCOR oder sonstige Referenz
    return { refTyp: refTyp ?? 'REF', refNr: rawRef };
  }

  return { refTyp: null, refNr: null };
}

// ── Verwendungszweck aus RmtInf ─────────────────────────────────────
/**
 * Priorisierung:
 *  1. Strd/AddtlRmtInf (ZKB: strukturierter Freitext)
 *  2. Ustrd (Standard-Freitext, max. 140 Zeichen)
 */
function extractVwz(rmtInf) {
  if (!rmtInf) return null;

  // 1. AddtlRmtInf aus Strd-Blöcken (ZKB, Raiffeisen)
  const strds = Array.isArray(rmtInf.Strd) ? rmtInf.Strd : (rmtInf.Strd ? [rmtInf.Strd] : []);
  for (const strd of strds) {
    const addl = strd?.AddtlRmtInf;
    if (!addl) continue;
    const parts = (Array.isArray(addl) ? addl : [addl]).map(str).filter(Boolean);
    if (parts.length) return parts.join(' / ');
  }

  // 2. Ustrd (kann Array sein)
  const ustrdArr = Array.isArray(rmtInf.Ustrd) ? rmtInf.Ustrd : (rmtInf.Ustrd ? [rmtInf.Ustrd] : []);
  const ustrd = ustrdArr.map(str).filter(Boolean).join(' ');
  if (ustrd) return ustrd;

  return null;
}

// ── Gegenpartei-Name aus RltdPties ──────────────────────────────────
/**
 * Versucht Reihenfolge:
 *   .04/.08: Pty/Nm  (mit Pty-Wrapper)
 *   .02:     Nm      (direkt)
 */
function gpName(parties, isEin) {
  const side = isEin ? parties?.Dbtr : parties?.Cdtr;
  return str(side?.Pty?.Nm) ?? str(side?.Nm) ?? null;
}

function gpIban(parties, isEin) {
  const acct = isEin ? parties?.DbtrAcct : parties?.CdtrAcct;
  return str(acct?.Id?.IBAN) ?? null;
}

// ── Einzelne Ntry-Entry parsen ───────────────────────────────────────
function parseSingleEntry(ntry, kontoIban) {
  const ntryBetrag = num(ntry?.Amt);
  const ntryWaehrung = ccy(ntry?.Amt) ?? 'CHF';
  const buchDatum  = dateStr(ntry?.BookgDt);
  const valDatum   = dateStr(ntry?.ValDt);
  const zusatz     = str(ntry?.AddtlNtryInf);

  // Nur gebuchte Einträge (BOOK), keine vorläufigen (PDNG / INFO / FWAV)
  const statusCode = str(ntry?.Sts?.Cd) ?? str(ntry?.Sts);
  if (statusCode && statusCode !== 'BOOK') return [];

  // Richtung: CRDT/RVDB → eingang; DBIT/RVCD → ausgang
  // RVCD = Reversal Credit (Rückbuchung eines Eingangs → ist jetzt ein Ausgang)
  // RVDB = Reversal Debit  (Rückbuchung eines Ausgangs → ist jetzt ein Eingang)
  const cdtDbt = str(ntry?.CdtDbtInd)?.toUpperCase();
  const richtung = (cdtDbt === 'CRDT' || cdtDbt === 'RVDB') ? 'eingang' : 'ausgang';
  const isReversal = cdtDbt === 'RVCD' || cdtDbt === 'RVDB';

  // NtryDtls: Array (durch isArray konfiguriert)
  const ntryDtlsList = Array.isArray(ntry?.NtryDtls)
    ? ntry.NtryDtls
    : (ntry?.NtryDtls ? [ntry.NtryDtls] : []);

  // ── Kein NtryDtls (Valiant, ältere Banken): direkt aus Ntry ────
  if (ntryDtlsList.length === 0) {
    return [{
      konto_iban:       kontoIban,
      buchungsdatum:    buchDatum,
      valutadatum:      valDatum,
      betrag:           ntryBetrag,
      waehrung:         ntryWaehrung,
      richtung,
      is_reversal:      isReversal,
      gegenpartei_name: null,
      gegenpartei_iban: null,
      referenz_typ:     null,
      referenz_nr:      null,
      end_to_end_id:    null,
      verwendungszweck: zusatz,
      zusatzinfo:       zusatz,
      status:           'offen',
    }];
  }

  const results = [];

  for (const dtls of ntryDtlsList) {
    // TxDtls: Array; falls nicht vorhanden → [{} ] (Ntry-Level-Fallback)
    const txArr = Array.isArray(dtls?.TxDtls)
      ? (dtls.TxDtls.length ? dtls.TxDtls : [{}])
      : (dtls?.TxDtls ? [dtls.TxDtls] : [{}]);

    for (const tx of txArr) {
      const rmtInf = tx?.RmtInf;

      // Referenz
      const { refTyp, refNr } = extractRef(rmtInf);

      // E2E-ID bereinigen
      const e2e = cleanE2E(tx?.Refs?.EndToEndId);

      // Gegenpartei-Name und IBAN
      const parties = tx?.RltdPties;
      const isEin   = richtung === 'eingang';
      const name    = gpName(parties, isEin);
      const iban    = gpIban(parties, isEin);

      // Betrag: Batch-Einzelbeträge aus AmtDtls, sonst Ntry-Betrag
      const txBetrag = num(tx?.AmtDtls?.TxAmt?.Amt)
                    ?? num(tx?.AmtDtls?.InstdAmt?.Amt)
                    ?? ntryBetrag;
      const txWaehrung = ccy(tx?.AmtDtls?.TxAmt?.Amt)
                      ?? ccy(tx?.AmtDtls?.InstdAmt?.Amt)
                      ?? ntryWaehrung;

      // Verwendungszweck: strukturiert → Freitext → AddtlTxInf → AddtlNtryInf
      const vwz = extractVwz(rmtInf)
               ?? str(tx?.AddtlTxInf)   // PostFinance
               ?? zusatz;

      results.push({
        konto_iban:       kontoIban,
        buchungsdatum:    buchDatum,
        valutadatum:      valDatum,
        betrag:           txBetrag,
        waehrung:         txWaehrung,
        richtung,
        is_reversal:      isReversal || undefined,
        gegenpartei_name: name,
        gegenpartei_iban: iban,
        referenz_typ:     refTyp,
        referenz_nr:      refNr,
        end_to_end_id:    e2e,
        verwendungszweck: vwz,
        zusatzinfo:       zusatz,
        status:           'offen',
      });
    }
  }

  return results;
}

// ── Hauptfunktion ────────────────────────────────────────────────────
/**
 * Parst ein camt.053 XML-Dokument.
 *
 * @param {string} xmlString
 * @returns {{
 *   transactions: object[],
 *   kontoIban: string|null,
 *   saldoEroeffnung: number|null,
 *   saldoSchluss: number|null,
 *   version: string|null
 * }}
 */
export function parseCamt053(xmlString) {
  const doc = PARSER.parse(xmlString);

  // Namespace-robuste Dok-Navigation
  const root = doc?.Document?.BkToCstmrStmt ?? doc?.BkToCstmrStmt;
  if (!root) throw new Error('Kein gültiges camt.053 Dokument (BkToCstmrStmt fehlt)');

  // Version aus GrpHdr erkennen (informativ)
  const msgId  = str(root?.GrpHdr?.MsgId) ?? '';
  const version = msgId.match(/camt\.053\.001\.(\d+)/i)?.[0] ?? null;

  const stmts = Array.isArray(root.Stmt) ? root.Stmt : [root.Stmt];
  const allTx = [];
  let kontoIban       = null;
  let saldoEroeffnung = null;
  let saldoSchluss    = null;

  for (const stmt of stmts) {
    const iban = str(stmt?.Acct?.Id?.IBAN)
              ?? str(stmt?.Acct?.Id?.Othr?.Id)
              ?? null;
    if (!kontoIban) kontoIban = iban;

    // Salden: OPBD = Opening Booked, CLBD = Closing Booked
    // Alternativ: OPAV / CLAV (Available) — falls CLBD fehlt
    const bals = Array.isArray(stmt?.Bal) ? stmt.Bal : (stmt?.Bal ? [stmt.Bal] : []);
    for (const bal of bals) {
      const code = str(bal?.Tp?.CdOrPrtry?.Cd) ?? str(bal?.Tp?.CdOrPrtry?.Prtry);
      const amt  = num(bal?.Amt);
      const sign = str(bal?.CdtDbtInd) === 'CRDT' ? 1 : -1;
      if (code === 'OPBD' || code === 'OPAV') saldoEroeffnung ??= (amt ?? 0) * sign;
      if (code === 'CLBD' || code === 'CLAV') saldoSchluss    ??= (amt ?? 0) * sign;
    }

    const entries = Array.isArray(stmt?.Ntry)
      ? stmt.Ntry
      : (stmt?.Ntry ? [stmt.Ntry] : []);

    for (const ntry of entries) {
      allTx.push(...parseSingleEntry(ntry, iban ?? kontoIban));
    }
  }

  // is_reversal nur wenn true mitliefern (kein falscher undefined-Wert in DB)
  const transactions = allTx.map(tx => {
    if (!tx.is_reversal) {
      const { is_reversal: _, ...rest } = tx;
      return rest;
    }
    return tx;
  });

  return { transactions, kontoIban, saldoEroeffnung, saldoSchluss, version };
}
