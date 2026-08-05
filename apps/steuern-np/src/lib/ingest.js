/**
 * Ingest: Datei → Extraktion → Triage → Datenbank.
 *
 * Schliesst die Kette, die bisher aus Einzelteilen bestand. Ein Beleg
 * durchläuft immer dieselben Schritte, und jeder Schritt hinterlässt eine
 * Spur, die im Review nachvollziehbar ist:
 *
 *   1. Hash bilden          → Duplikatserkennung
 *   2. Text/XML extrahieren → bestimmt zugleich die Parse-Methode
 *   3. Triage               → Belegart, Relevanz, Confidence
 *   4. Hochladen            → nur wenn kein Duplikat
 *   5. Beleg speichern
 *   6. Positionen ableiten  → eCH-0196 strukturiert, sonst aus der KI-Antwort
 *
 * Duplikate werden vollständig erfasst, aber nicht hochgeladen: der Beleg
 * ist bereits im Dossier, die Zeile dokumentiert nur, dass er nochmals kam.
 */

import { supabase } from "@/api/supabaseClient";
import { extractBeleg, dateiHash } from "./dokumentText.js";
import { triageMitKi } from "./triage.js";
import { parseESteuerauszug, zuPositionen } from "./ech0196.js";
import { echPfadFuer } from "./belegarten.js";

/**
 * Verarbeitet eine einzelne Datei.
 *
 * @param {File} datei
 * @param {object} ctx  { mandantId, deklarationId, periode, bekannteHashes }
 * @param {(schritt: string, info?: string) => void} [onStage]
 * @returns {Promise<{belegId: string|null, triage: object, positionen: number, uebersprungen: boolean}>}
 */
export async function belegVerarbeiten(datei, ctx, onStage) {
  const { mandantId, deklarationId, periode, bekannteHashes = [] } = ctx;
  const melde = (s, i) => { try { onStage?.(s, i); } catch { /* egal */ } };

  if (!mandantId || !deklarationId) {
    throw new Error("mandantId und deklarationId sind erforderlich");
  }

  // ─── 1. Hash ────────────────────────────────────────────────────
  melde("hash", "Prüfsumme wird gebildet…");
  const hash = await dateiHash(datei);

  // ─── 2. Extraktion ──────────────────────────────────────────────
  melde("extract", "Inhalt wird gelesen…");
  const { text, xml, parseMethode } = await extractBeleg(datei, {
    onStage: (s, i) => melde(s, i),
  });

  // ─── 3. Triage ──────────────────────────────────────────────────
  melde("triage", "Beleg wird eingeordnet…");
  const triage = await triageMitKi(
    supabase,
    { text, dateiname: datei.name, parseMethode, dateiHash: hash },
    { periode, bekannteHashes }
  );

  const istDuplikat = triage.grund === "duplikat";

  // ─── 4. Upload ──────────────────────────────────────────────────
  // Pfad muss zur Storage-Policy passen: <mandant_id>/<deklaration_id>/…
  let storagePath = null;
  if (!istDuplikat) {
    melde("upload", "Datei wird abgelegt…");
    const sicher = datei.name.replace(/[^\w.\-]+/g, "_").slice(-120);
    storagePath = `${mandantId}/${deklarationId}/${hash.slice(0, 12)}-${sicher}`;
    const { error } = await supabase.storage
      .from("belege")
      .upload(storagePath, datei, { upsert: false, contentType: datei.type || undefined });
    // Ein bereits vorhandenes Objekt ist kein Fehler — derselbe Inhalt liegt schon da.
    if (error && !/exists/i.test(error.message)) {
      throw new Error(`Upload fehlgeschlagen: ${error.message}`);
    }
  }

  // ─── 5. Beleg speichern ─────────────────────────────────────────
  melde("save", "Beleg wird gespeichert…");
  const { data: beleg, error: belegFehler } = await supabase
    .from("belege")
    .insert({
      mandant_id: mandantId,
      deklaration_id: deklarationId,
      storage_path: storagePath,
      dateiname: datei.name,
      datei_hash: hash,
      quelle: "upload",
      belegart: triage.belegart || null,
      parse_methode: parseMethode,
      relevanz: triage.relevanz,
      relevanz_grund: triage.grund || null,
      confidence: triage.confidence,
      periode_beleg: triage.periodeBeleg ?? null,
      roh_text: (text || "").slice(0, 100000) || null,
      roh_xml: xml || null,
    })
    .select("id")
    .single();

  if (belegFehler) throw new Error(`Beleg speichern fehlgeschlagen: ${belegFehler.message}`);

  // ─── 6. Positionen ──────────────────────────────────────────────
  let positionen = [];

  if (parseMethode === "ech0196" && xml) {
    // Strukturierte Quelle: die Werte sind belegt, nicht geraten.
    const ergebnis = parseESteuerauszug(xml);
    positionen = zuPositionen(ergebnis);
    if (ergebnis.warnungen?.length) {
      melde("warnung", ergebnis.warnungen.join(" "));
    }
  } else if (Array.isArray(triage.positionen) && triage.positionen.length) {
    // Aus der KI-Antwort — nur was die Edge Function gegen den Belegtext
    // geprüft hat, kommt hier überhaupt an.
    const pfad = echPfadFuer(triage.belegart);
    positionen = triage.positionen
      .filter(p => Number.isFinite(p.wert_num))
      .map(p => ({
        ech_pfad: pfad || "mainForm.unzugeordnet",
        bezeichnung: p.bezeichnung || null,
        wert_num: p.wert_num,
        waehrung: "CHF",
        herkunft: "ki",
        confidence: triage.confidence,
      }));
  }

  if (positionen.length) {
    const { error } = await supabase.from("positionen").insert(
      positionen.map(p => ({
        ...p,
        mandant_id: mandantId,
        deklaration_id: deklarationId,
        beleg_id: beleg.id,
      }))
    );
    if (error) {
      // Der Beleg bleibt bestehen; nur die Positionen fehlen. Das ist im
      // Review sichtbar und von Hand nachtragbar — besser als ein Rollback,
      // der die hochgeladene Datei verwaisen liesse.
      console.warn("[Ingest] Positionen speichern fehlgeschlagen:", error.message);
      melde("warnung", `Positionen konnten nicht gespeichert werden: ${error.message}`);
      positionen = [];
    }
  }

  melde("fertig", istDuplikat ? "Duplikat erkannt" : "Fertig");

  return {
    belegId: beleg.id,
    hash,
    triage,
    positionen: positionen.length,
    uebersprungen: istDuplikat,
  };
}

/**
 * Verarbeitet einen Stapel. Sequenziell, damit OCR und Edge Function nicht
 * gleichzeitig von zwanzig Dateien beansprucht werden — und damit die
 * Duplikatserkennung Belege aus demselben Stapel mitbekommt.
 */
export async function stapelVerarbeiten(dateien, ctx, onProgress) {
  const hashes = [...(ctx.bekannteHashes || [])];
  const ergebnisse = [];

  for (let i = 0; i < dateien.length; i++) {
    const datei = dateien[i];
    try {
      const r = await belegVerarbeiten(
        datei,
        { ...ctx, bekannteHashes: hashes },
        (schritt, info) => onProgress?.({ index: i, gesamt: dateien.length, datei, schritt, info })
      );
      // Hash kommt aus dem Durchlauf zurück — nicht nochmals rechnen.
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
