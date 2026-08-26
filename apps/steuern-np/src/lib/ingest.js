/**
 * Ingest: Datei → Extraktion → Triage → lokale Datenbank.
 *
 * Ein Beleg durchläuft immer dieselben Schritte, und jeder hinterlässt
 * eine Spur, die im Review nachvollziehbar ist:
 *
 *   1. Hash bilden          → Duplikatserkennung
 *   2. Text/XML extrahieren → bestimmt zugleich die Parse-Methode
 *   3. Triage               → Belegart, Relevanz, Confidence
 *   4. Datei ablegen        → neben der Anwendung, nur wenn kein Duplikat
 *   5. Beleg speichern
 *   6. Positionen ableiten  → eCH-0196 strukturiert, sonst Vorschlag
 *                             aus der Belegart über das SG-Formular
 *
 * Alles lokal. Die Dateien verlassen das Laufwerk nicht.
 */

import { extractBeleg, dateiHash } from "./dokumentText.js";
import { triageRegeln } from "./triage.js";
import { parseESteuerauszug } from "./ech0196.js";
import { positionenFuerBelegart } from "./sgFormular.js";
import * as db from "./db.js";

/**
 * Leitet Positionsvorschläge aus einem eSteuerauszug ab.
 * Diese Werte sind belegt, nicht geraten — entsprechend hohe Confidence.
 */
function positionenAusSteuerauszug(ergebnis) {
  if (!ergebnis?.ok) return [];
  const raus = [];
  const nimm = (ziffer, bezeichnung, betrag) => {
    if (betrag == null || betrag === 0) return;
    raus.push({
      ziffer, bezeichnung, betrag: Number(betrag.toFixed(2)),
      herkunft: "ech0196", confidence: ergebnis.confidence,
    });
  };
  nimm("140", "Bruttoertrag Wertschriften", ergebnis.summen.bruttoertrag);
  nimm("400", "Steuerwert Wertschriften und Guthaben", ergebnis.summen.steuerwert);
  const schuldzinsen = ergebnis.konten.reduce((s, k) => s + (k.schuldzins || 0), 0);
  nimm("210", "Schuldzinsen", schuldzinsen);
  return raus;
}

/**
 * Verarbeitet eine einzelne Datei.
 *
 * @param {File} datei
 * @param {object} ctx  { mandantId, deklarationId, periode, bekannteHashes, benutzerId }
 * @param {(schritt: string, info?: string) => void} [onStage]
 */
export async function belegVerarbeiten(datei, ctx, onStage) {
  const { mandantId, deklarationId, periode, bekannteHashes = [] } = ctx;
  const melde = (s, i) => { try { onStage?.(s, i); } catch { /* egal */ } };

  if (!mandantId || !deklarationId) {
    throw new Error("Mandant und Deklaration sind erforderlich");
  }

  melde("hash", "Prüfsumme");
  const hash = await dateiHash(datei);

  melde("extract", "Inhalt lesen");
  const { text, xml, parseMethode } = await extractBeleg(datei, {
    onStage: (s, i) => melde(s, i),
  });

  melde("triage", "Einordnen");
  const triage = triageRegeln(
    { text, dateiname: datei.name, parseMethode, dateiHash: hash },
    { periode, bekannteHashes }
  );

  const istDuplikat = triage.grund === "duplikat";

  // ─── Datei ablegen ──────────────────────────────────────────────
  let ablage = null;
  if (!istDuplikat && typeof window !== "undefined" && window.steuerAPI) {
    melde("ablegen", "Datei ablegen");
    const puffer = await datei.arrayBuffer();
    ablage = await window.steuerAPI.belegAblegen({
      mandantId, deklarationId,
      dateiname: `${hash.slice(0, 8)}-${datei.name}`,
      daten: new Uint8Array(puffer),
    });
  }

  // ─── Beleg speichern ────────────────────────────────────────────
  melde("save", "Speichern");
  const beleg = await db.belegAnlegen({
    mandant_id: mandantId,
    deklaration_id: deklarationId,
    dateiname: datei.name,
    ablage,
    datei_hash: hash,
    belegart: triage.belegart || null,
    parse_methode: parseMethode,
    relevanz: triage.relevanz,
    relevanz_grund: triage.grund || null,
    confidence: triage.confidence,
    begruendung: triage.begruendung,
    periode_beleg: triage.periodeBeleg ?? null,
    roh_text: (text || "").slice(0, 100000) || null,
  });

  // ─── Positionen ableiten ────────────────────────────────────────
  let vorschlaege = [];
  let warnungen = [];

  if (parseMethode === "ech0196" && xml) {
    const ergebnis = parseESteuerauszug(xml);
    vorschlaege = positionenAusSteuerauszug(ergebnis);
    warnungen = ergebnis.warnungen || [];
  } else if (triage.belegart && triage.relevanz === "relevant") {
    // Kein Betrag, aber die Zielposition ist bekannt: als offener
    // Vorschlag anlegen, damit er in der Zuweisung auftaucht.
    vorschlaege = positionenFuerBelegart(triage.belegart).map(p => ({
      ziffer: p.ziffer, bezeichnung: p.label, betrag: null,
      herkunft: "vorschlag", confidence: triage.confidence,
    }));
  }

  let angelegt = 0;
  for (const v of vorschlaege) {
    try {
      await db.positionAnlegen({
        mandant_id: mandantId, deklaration_id: deklarationId, beleg_id: beleg.id, ...v,
      });
      angelegt++;
    } catch (e) {
      console.warn("[Ingest] Position nicht angelegt:", e.message);
    }
  }

  melde("fertig", istDuplikat ? "Duplikat" : "Fertig");

  return { belegId: beleg.id, hash, triage, positionen: angelegt, warnungen,
           uebersprungen: istDuplikat };
}

/**
 * Verarbeitet einen Stapel. Sequenziell, damit OCR nicht von zwanzig
 * Dateien gleichzeitig beansprucht wird — und damit die Duplikatserkennung
 * Belege aus demselben Stapel mitbekommt.
 */
export async function stapelVerarbeiten(dateien, ctx, onProgress) {
  const hashes = [...(ctx.bekannteHashes || [])];
  const ergebnisse = [];

  for (let i = 0; i < dateien.length; i++) {
    const datei = dateien[i];
    try {
      const r = await belegVerarbeiten(
        datei, { ...ctx, bekannteHashes: hashes },
        (schritt, info) => onProgress?.({ index: i, gesamt: dateien.length, datei, schritt, info })
      );
      if (r.hash && !r.uebersprungen) hashes.push(r.hash);
      ergebnisse.push({ datei, ...r });
    } catch (e) {
      // Ein kaputter Beleg darf den Stapel nicht abbrechen.
      console.error("[Ingest] Fehler bei", datei.name, e);
      ergebnisse.push({ datei, fehler: e.message || String(e) });
      onProgress?.({ index: i, gesamt: dateien.length, datei, schritt: "fehler", info: e.message });
    }
  }
  return ergebnisse;
}
