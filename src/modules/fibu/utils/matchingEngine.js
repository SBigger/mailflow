/**
 * Matching-Engine: Bankbewegungen ↔ Offene Posten
 *
 * Priorität:
 *  1. QRR-Referenz exakt           → 100%   Auto-Match
 *  2. End-to-End-ID enthält Beleg# → 95%    Auto-Match
 *  3. Betrag exakt + IBAN          → 90%    1-Klick
 *  4. Betrag exakt + Name fuzzy    → 70-85% Vorschlag
 *  5. Betrag ±Skonto + Name        → 60-75% Vorschlag
 *  6. Manuell                      → —
 */

// ── Text-Normalisierung ────────────────────────────────────────────
function normalize(str) {
  if (!str) return '';
  return str
    .toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // Umlaute → ASCII
    .replace(/\bAG\b|\bGMBH\b|\bSA\b|\bSÀRL\b|\bLTD\b|\bLLC\b|\bCO\b/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token-Overlap-Score: wie viele signifikante Tokens teilen str1 und str2? */
function tokenScore(a, b) {
  if (!a || !b) return 0;
  const ta = new Set(normalize(a).split(' ').filter(t => t.length > 2));
  const tb = new Set(normalize(b).split(' ').filter(t => t.length > 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  const inter = [...ta].filter(t => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return inter / union;
}

/** Betrag-Score mit Skonto-Toleranz */
function amountScore(txBetrag, opBetrag) {
  if (!txBetrag || !opBetrag) return 0;
  if (Math.abs(txBetrag - opBetrag) < 0.01) return 1.0;          // exact
  const ratio = Math.abs(txBetrag - opBetrag) / Math.max(txBetrag, opBetrag);
  if (ratio <= 0.001) return 0.99;  // Rundung
  if (ratio <= 0.02)  return 0.85;  // kleiner Skonto / Spesen
  if (ratio <= 0.04)  return 0.70;  // grosser Skonto
  return 0;
}

/**
 * Berechnet Match-Score zwischen einer Banktransaktion und einem offenen Posten.
 *
 * @param {object} tx  - Banktransaktion (aus fibu_bank_transaktionen)
 * @param {object} op  - Offener Posten  ({ id, typ, beleg_nr, name, iban, betrag_brutto, betrag_offen, qr_referenz })
 * @returns {{ score: number, method: string, dims: object }}
 */
export function scoreMatch(tx, op) {
  const dims = {};

  // 1. QRR-Referenz exakt
  if (tx.referenz_nr && op.qr_referenz) {
    const txRef = tx.referenz_nr.replace(/\s/g, '');
    const opRef = op.qr_referenz.replace(/\s/g, '');
    if (txRef === opRef) {
      dims.qrr = 1.0;
      dims.betrag = amountScore(tx.betrag, op.betrag_offen ?? op.betrag_brutto);
      return { score: 1.0, method: 'QRR', dims };
    }
  }

  // 2. End-to-End-ID enthält Belegnummer
  if (tx.end_to_end_id && op.beleg_nr) {
    const e2e = tx.end_to_end_id.toUpperCase();
    const bn  = op.beleg_nr.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (e2e.includes(bn) || e2e === bn) {
      dims.e2e = 1.0;
      return { score: 0.95, method: 'E2E', dims };
    }
  }

  // 3. Kombinierter Score: Betrag + Name + IBAN
  const betrag  = amountScore(tx.betrag, op.betrag_offen ?? op.betrag_brutto);
  const name    = tokenScore(tx.gegenpartei_name, op.name);
  const ibanOk  = tx.gegenpartei_iban && op.iban && tx.gegenpartei_iban === op.iban ? 1 : 0;

  dims.betrag = betrag;
  dims.name   = name;
  dims.iban   = ibanOk;

  // Betrag allein ohne Match → kein Vorschlag
  if (betrag === 0) return { score: 0, method: 'none', dims };

  let score;
  let method;

  if (betrag >= 0.99 && ibanOk) {
    score  = 0.90 + name * 0.08;
    method = 'AMOUNT_IBAN';
  } else if (betrag >= 0.99 && name >= 0.6) {
    score  = 0.75 + name * 0.15;
    method = 'AMOUNT_NAME';
  } else if (betrag >= 0.99) {
    score  = 0.55 + name * 0.20;
    method = 'AMOUNT_ONLY';
  } else if (betrag >= 0.70 && name >= 0.5) {
    score  = betrag * 0.5 + name * 0.4;
    method = 'FUZZY';
  } else {
    return { score: 0, method: 'none', dims };
  }

  return { score: Math.min(Math.round(score * 100) / 100, 0.99), method, dims };
}

/**
 * Auto-Matching: alle offenen Transaktionen gegen alle offenen Posten
 * Gibt geordnete Vorschläge zurück, priorisiert nach Score.
 *
 * @param {array} transactions - Bank-Transaktionen
 * @param {array} openItems    - Offene Posten (Kreditoren + Debitoren)
 * @returns {array} matchResults: [{ tx_id, op_id, op_typ, score, method, autoApply }]
 */
export function autoMatch(transactions, openItems) {
  const results      = [];
  const usedTxIds    = new Set();
  const usedOpIds    = new Set();

  // Nach Verarbeitungspriorität sortieren: zuerst QRR-Kandidaten
  const txSorted = [...transactions]
    .filter(tx => tx.status === 'offen')
    .sort((a, b) => (b.referenz_nr ? 1 : 0) - (a.referenz_nr ? 1 : 0));

  for (const tx of txSorted) {
    if (usedTxIds.has(tx.id)) continue;

    let best = null;

    for (const op of openItems) {
      if (usedOpIds.has(op.id)) continue;
      // Richtungscheck: eingang → debitor, ausgang → kreditor
      if (tx.richtung === 'ausgang' && op.typ !== 'kreditor') continue;
      if (tx.richtung === 'eingang' && op.typ !== 'debitor')  continue;

      const result = scoreMatch(tx, op);
      if (result.score > (best?.score ?? 0)) {
        best = { op, ...result };
      }
    }

    if (best && best.score >= 0.60) {
      const autoApply = best.score >= 0.95;
      results.push({
        tx_id:     tx.id,
        op_id:     best.op.id,
        op_typ:    best.op.typ,
        score:     best.score,
        method:    best.method,
        dims:      best.dims,
        autoApply,
      });
      if (autoApply) {
        usedTxIds.add(tx.id);
        usedOpIds.add(best.op.id);
      }
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

/** Konfidenz-Label und Farbe */
export function confidenceInfo(score) {
  if (score >= 0.95) return { label: 'Exakt',    color: '#22c55e', bg: '#dcfce7', dot: '🟢' };
  if (score >= 0.85) return { label: 'Sehr gut', color: '#84cc16', bg: '#f0fdf4', dot: '🟢' };
  if (score >= 0.70) return { label: 'Gut',      color: '#eab308', bg: '#fefce8', dot: '🟡' };
  if (score >= 0.60) return { label: 'Möglich',  color: '#f97316', bg: '#fff7ed', dot: '🟠' };
  return                     { label: 'Schwach',  color: '#ef4444', bg: '#fef2f2', dot: '🔴' };
}
