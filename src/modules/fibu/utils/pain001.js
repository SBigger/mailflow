// =====================================================================
// pain.001.001.09 Generator – Swiss Payment Standards (SPS 2025/2026)
// ISO 20022 Customer Credit Transfer Initiation
//
// Unterstützt:
//  - Zahlungsart 1: QR-IBAN + QR-Referenz (QRR, 27-stellig)
//  - Zahlungsart 3: IBAN-Zahlung Inland CHF/EUR, optional SCOR-Referenz (ISO 11649)
//  - Strukturierte Adresse (ab Nov 2026 obligatorisch: TwnNm + Ctry)
//
// Quelle: SIX "Customer Credit Transfer – Swiss Implementation Guidelines"
// https://www.six-group.com/.../ig-credit-transfer-sps-2025-en.pdf
// =====================================================================

// ── XML-Escaping (KRITISCH – Lieferantennamen mit & < > kommen vor) ──
export function xmlEsc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── IBAN normalisieren (Leerzeichen entfernen, Grossbuchstaben) ──
export function normIban(iban) {
  return String(iban || '').replace(/\s+/g, '').toUpperCase();
}

// ── QR-IBAN-Erkennung: IID (Stellen 5–9) im Bereich 30000–31999 ──
export function isQrIban(iban) {
  const n = normIban(iban);
  if (!/^CH|^LI/.test(n) || n.length < 9) return false;
  const iid = parseInt(n.slice(4, 9), 10);
  return iid >= 30000 && iid <= 31999;
}

// ── IBAN-Prüfung (Format + Mod-97-Prüfsumme) ──
export function isValidIban(iban) {
  const n = normIban(iban);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(n)) return false;
  const rearr = n.slice(4) + n.slice(0, 4);
  const digits = rearr.replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55);
  // Mod-97 in Blöcken (Big-Int-frei)
  let rem = 0;
  for (let i = 0; i < digits.length; i++) {
    rem = (rem * 10 + (digits.charCodeAt(i) - 48)) % 97;
  }
  return rem === 1;
}

// ── Referenztyp ermitteln ──────────────────────────────────────────
// QRR  – 27-stellige QR-Referenz (nur mit QR-IBAN gültig)
// SCOR – ISO-11649 Creditor Reference ("RF..")
// null – unstrukturiert → landet in <Ustrd>
export function detectReference(creditorIban, rawRef) {
  const ref = String(rawRef || '').replace(/\s+/g, '');
  if (!ref) return { type: null, ref: '' };
  if (/^RF[0-9A-Z]{3,23}$/i.test(ref)) return { type: 'SCOR', ref: ref.toUpperCase() };
  if (/^[0-9]{27}$/.test(ref) && isQrIban(creditorIban)) return { type: 'QRR', ref };
  return { type: null, ref };
}

// ── Zahlungsart bestimmen (für UI-Anzeige) ──
export function paymentType(creditorIban, rawRef) {
  const { type } = detectReference(creditorIban, rawRef);
  if (type === 'QRR') return { code: '1', label: 'QR-Referenz' };
  if (type === 'SCOR') return { code: '3', label: 'IBAN + SCOR' };
  return { code: '3', label: 'IBAN' };
}

// ── EndToEndId säubern: max. 35 Zeichen, keine Sonderzeichen ──
function endToEndId(s) {
  const clean = String(s || '').replace(/[^A-Za-z0-9.\-]/g, '').slice(0, 35);
  return clean || 'NOTPROVIDED';
}

// ── Strukturierte Adresse rendern (ab Nov 2026 Pflicht) ──
// addr: { street, postCode, town, country }
function postalAddress(addr, indent) {
  if (!addr || (!addr.town && !addr.country)) return [];
  const i = indent;
  const out = [`${i}<PstlAdr>`];
  if (addr.street)   out.push(`${i}  <StrtNm>${xmlEsc(addr.street.slice(0, 70))}</StrtNm>`);
  if (addr.postCode) out.push(`${i}  <PstCd>${xmlEsc(addr.postCode.slice(0, 16))}</PstCd>`);
  if (addr.town)     out.push(`${i}  <TwnNm>${xmlEsc(addr.town.slice(0, 35))}</TwnNm>`);
  out.push(`${i}  <Ctry>${xmlEsc((addr.country || 'CH').slice(0, 2).toUpperCase())}</Ctry>`);
  out.push(`${i}</PstlAdr>`);
  return out;
}

// ── Betrag auf 2 Nachkommastellen (Punkt als Dezimaltrenner) ──
function amt(n) {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
}

// =====================================================================
// Haupt-Generator
//
// input = {
//   msgId:        string  (max 35, eindeutig)
//   debtorName:   string
//   debtorAddr:   { street, postCode, town, country }
//   debtorIban:   string
//   debtorBic:    string  (optional – sonst NOTPROVIDED)
//   executionDate:string  'YYYY-MM-DD'
//   currency:     'CHF'   (Default)
//   payments: [{
//     endToEndId:    string
//     amount:        number
//     currency:      string (optional, sonst input.currency)
//     creditorName:  string
//     creditorAddr:  { street, postCode, town, country }
//     creditorIban:  string
//     reference:     string  (QR- oder SCOR-Referenz, optional)
//     message:       string  (unstrukturierte Mitteilung, optional)
//   }]
// }
// =====================================================================
export function generatePain001(input) {
  const {
    msgId,
    debtorName,
    debtorAddr,
    debtorIban,
    debtorBic,
    executionDate,
    currency = 'CHF',
    payments = [],
  } = input;

  const now      = new Date().toISOString().replace(/\.\d{3}Z$/, '');
  const nbOfTxs  = payments.length;
  const ctrlSum  = amt(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const pmtInfId = `${msgId}-PMT`;

  const L = [];
  L.push('<?xml version="1.0" encoding="UTF-8"?>');
  L.push('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09" '
       + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">');
  L.push('  <CstmrCdtTrfInitn>');

  // ── Group Header ──
  L.push('    <GrpHdr>');
  L.push(`      <MsgId>${xmlEsc(msgId)}</MsgId>`);
  L.push(`      <CreDtTm>${now}</CreDtTm>`);
  L.push(`      <NbOfTxs>${nbOfTxs}</NbOfTxs>`);
  L.push(`      <CtrlSum>${ctrlSum}</CtrlSum>`);
  L.push('      <InitgPty>');
  L.push(`        <Nm>${xmlEsc(debtorName)}</Nm>`);
  L.push('      </InitgPty>');
  L.push('    </GrpHdr>');

  // ── Payment Information (ein Sammelblock) ──
  L.push('    <PmtInf>');
  L.push(`      <PmtInfId>${xmlEsc(pmtInfId)}</PmtInfId>`);
  L.push('      <PmtMtd>TRF</PmtMtd>');
  L.push('      <BtchBookg>true</BtchBookg>');
  L.push(`      <NbOfTxs>${nbOfTxs}</NbOfTxs>`);
  L.push(`      <CtrlSum>${ctrlSum}</CtrlSum>`);
  L.push(`      <ReqdExctnDt><Dt>${xmlEsc(executionDate)}</Dt></ReqdExctnDt>`);

  // Debtor
  L.push('      <Dbtr>');
  L.push(`        <Nm>${xmlEsc(debtorName)}</Nm>`);
  postalAddress(debtorAddr, '        ').forEach((l) => L.push(l));
  L.push('      </Dbtr>');
  L.push('      <DbtrAcct>');
  L.push(`        <Id><IBAN>${xmlEsc(normIban(debtorIban))}</IBAN></Id>`);
  L.push('      </DbtrAcct>');
  if (debtorBic && debtorBic.trim()) {
    L.push('      <DbtrAgt>');
    L.push('        <FinInstnId>');
    L.push(`          <BICFI>${xmlEsc(debtorBic.trim().toUpperCase())}</BICFI>`);
    L.push('        </FinInstnId>');
    L.push('      </DbtrAgt>');
  }
  // Kein DbtrAgt ohne BIC – Bank routet via Debtor-IBAN (SIX SPS 2025)
  L.push('      <ChrgBr>SLEV</ChrgBr>');

  // ── Einzeltransaktionen ──
  payments.forEach((p, idx) => {
    const ccy   = p.currency || currency;
    const cIban = normIban(p.creditorIban);
    const { type, ref } = detectReference(cIban, p.reference);

    L.push('      <CdtTrfTxInf>');
    L.push('        <PmtId>');
    L.push(`          <InstrId>${xmlEsc(pmtInfId)}-${idx + 1}</InstrId>`);
    L.push(`          <EndToEndId>${xmlEsc(endToEndId(p.endToEndId))}</EndToEndId>`);
    L.push('        </PmtId>');
    L.push(`        <Amt><InstdAmt Ccy="${xmlEsc(ccy)}">${amt(p.amount)}</InstdAmt></Amt>`);
    // CdtrAgt entfällt bei Inland-IBAN (CH/LI) – Zahlungsart 1 & 3
    L.push('        <Cdtr>');
    L.push(`          <Nm>${xmlEsc((p.creditorName || '').slice(0, 70))}</Nm>`);
    postalAddress(p.creditorAddr, '          ').forEach((l) => L.push(l));
    L.push('        </Cdtr>');
    L.push('        <CdtrAcct>');
    L.push(`          <Id><IBAN>${xmlEsc(cIban)}</IBAN></Id>`);
    L.push('        </CdtrAcct>');

    // Remittance Information
    if (type === 'QRR') {
      L.push('        <RmtInf>');
      L.push('          <Strd>');
      L.push('            <CdtrRefInf>');
      L.push('              <Tp><CdOrPrtry><Prtry>QRR</Prtry></CdOrPrtry></Tp>');
      L.push(`              <Ref>${xmlEsc(ref)}</Ref>`);
      L.push('            </CdtrRefInf>');
      L.push('          </Strd>');
      L.push('        </RmtInf>');
    } else if (type === 'SCOR') {
      L.push('        <RmtInf>');
      L.push('          <Strd>');
      L.push('            <CdtrRefInf>');
      L.push('              <Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp>');
      L.push(`              <Ref>${xmlEsc(ref)}</Ref>`);
      L.push('            </CdtrRefInf>');
      L.push('          </Strd>');
      L.push('        </RmtInf>');
    } else {
      const msg = (p.message || p.endToEndId || '').slice(0, 140);
      if (msg) {
        L.push('        <RmtInf>');
        L.push(`          <Ustrd>${xmlEsc(msg)}</Ustrd>`);
        L.push('        </RmtInf>');
      }
    }

    L.push('      </CdtTrfTxInf>');
  });

  L.push('    </PmtInf>');
  L.push('  </CstmrCdtTrfInitn>');
  L.push('</Document>');

  return L.join('\n');
}

// ── Validierung einer Zahlungsposition (für die Prüfungs-Ansicht) ──
// Gibt Array von Fehlermeldungen zurück (leer = OK).
export function validatePayment(p) {
  const errs = [];
  const iban = normIban(p.creditorIban);
  if (!iban)              errs.push('IBAN fehlt');
  else if (!isValidIban(iban)) errs.push('IBAN ungültig (Prüfziffer)');
  if (!p.creditorName)    errs.push('Empfängername fehlt');
  if (!(Number(p.amount) > 0)) errs.push('Betrag ist 0 oder negativ');
  // QR-IBAN verlangt zwingend eine QR-Referenz
  if (isQrIban(iban)) {
    const { type } = detectReference(iban, p.reference);
    if (type !== 'QRR') errs.push('QR-IBAN ohne gültige QR-Referenz (27-stellig)');
  }
  return errs;
}
