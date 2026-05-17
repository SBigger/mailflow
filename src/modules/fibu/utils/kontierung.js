// =====================================================================
// FiBu: Kontierungs-Helfer
//  - findKontoVorschlag: Stichwort-Regeln gegen Belegtexte matchen
//  - istEigeneFirma:     erkennt den eigenen Mandanten (≠ Lieferant)
// =====================================================================

const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/[.,\-/]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Sucht in einer Liste von Texten (Dateiname, Belegtext, Lieferantenname …)
 * nach dem ersten passenden Stichwort und gibt das vorgeschlagene Konto zurück.
 *
 * @param {string[]} texte    zu durchsuchende Texte
 * @param {object[]} regeln   [{ stichwort, konto_nr, mwst_code, sortierung }]
 * @returns {{konto_nr, mwst_code}|null}
 */
export function findKontoVorschlag(texte, regeln) {
  if (!regeln || regeln.length === 0) return null;
  const hay = texte.filter(Boolean).map(norm).join(' | ');
  if (!hay) return null;
  const sorted = [...regeln].sort((a, b) => (a.sortierung ?? 0) - (b.sortierung ?? 0));
  for (const r of sorted) {
    const sw = norm(r.stichwort);
    if (sw && hay.includes(sw)) {
      return { konto_nr: r.konto_nr, mwst_code: r.mwst_code || null };
    }
  }
  return null;
}

/**
 * Prüft, ob ein erkannter Name der eigene Mandant ist (Empfänger der
 * Rechnung – darf NICHT als Lieferant erfasst werden).
 */
export function istEigeneFirma(name, mandant) {
  if (!name || !mandant?.name) return false;
  const n = norm(name);
  const m = norm(mandant.name);
  if (!n || !m) return false;
  // Rechtsform-Suffixe weglassen für robusteren Vergleich
  const strip = (x) => x.replace(/\b(ag|gmbh|sa|sarl|kg|kollektivgesellschaft|treuhand)\b/g, '').replace(/\s+/g, ' ').trim();
  const ns = strip(n), ms = strip(m);
  if (n === m) return true;
  if (n.includes(m) || m.includes(n)) return true;
  if (ns && ms && (ns === ms || ns.includes(ms) || ms.includes(ns))) return true;
  return false;
}
