/**
 * index-document – Supabase Edge Function
 *
 * Extrahiert Text aus hochgeladenen Dokumenten (Excel, Word, PDF, Text)
 * und speichert ihn in content_text der dokumente-Tabelle.
 * Der PostgreSQL-Trigger aktualisiert danach automatisch den search_vector.
 *
 * Aufrufe:
 *  A) Database Webhook (automatisch bei INSERT):
 *     POST /index-document  Body: { type: "INSERT", record: { id, storage_path, ... } }
 *
 *  B) Einzeldokument manuell:
 *     POST /index-document  Body: { doc_id: "uuid" }
 *
 *  C) Batch – nicht indexierte Dokumente, in Haeppchen:
 *     POST /index-document  Body: { batch: true, limit?: 5 }
 *     Antwort enthaelt "remaining" -- so lange erneut aufrufen, bis 0.
 *     Die Haeppchen sind noetig, weil ein Scan im OCR-Container Minuten
 *     braucht und die Edge Function eine Laufzeitgrenze hat.
 *
 * OCR: Scans, Bilder sowie .doc und .rtf gehen an den OCR-Container, sofern
 * OCR_URL gesetzt ist (siehe ../_shared/ocrClient.ts). Ohne OCR_URL verhaelt
 * sich alles wie vorher -- so laeuft smartis.me unveraendert weiter, nur ohne
 * Volltext bei Scans.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ocrConfigured, needsOcr, ocrExtract } from "../_shared/ocrClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Service-Role-Client (kein RLS)
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ── Textextraktion ────────────────────────────────────────────────────────────

async function extractText(
  buffer: ArrayBuffer,
  filename: string,
  mimeType: string,
): Promise<string> {
  const name = (filename || "").toLowerCase();

  // ── Excel (.xlsx / .xls / .csv) ──
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
    try {
      const XLSX = await import("npm:xlsx@0.18.5");
      const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
      let text = "";
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        // deno-lint-ignore no-explicit-any
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
        text += rows.map((r) => r.join(" ")).join("\n") + "\n";
      }
      return text.trim().slice(0, 100_000);
    } catch (e) {
      console.error("[index-document] Excel-Extraktion fehlgeschlagen:", e);
    }
  }

  // ── Word (.docx) ──
  if (name.endsWith(".docx")) {
    try {
      const JSZip = (await import("npm:jszip@3.10.1")).default;
      const zip = await JSZip.loadAsync(buffer);
      const xml = (await zip.file("word/document.xml")?.async("text")) || "";
      return xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 100_000);
    } catch (e) {
      console.error("[index-document] Word-Extraktion fehlgeschlagen:", e);
    }
  }

  // ── PDF ──
  if (name.endsWith(".pdf") || mimeType === "application/pdf") {
    try {
      // pdf-parse funktioniert in Deno via npm-Kompatibilität
      const pdfParse = (await import("npm:pdf-parse@1.1.1")).default;
      const result = await pdfParse(Buffer.from(buffer));
      return result.text.slice(0, 100_000);
    } catch {
      // Fallback: einfache Regex-Extraktion aus PDF-Rohtext
      try {
        const raw = new TextDecoder("latin1").decode(buffer);
        const chunks: string[] = [];
        const btEt = /BT([\s\S]*?)ET/g;
        let m;
        while ((m = btEt.exec(raw)) !== null) {
          const parens = m[1].match(/\(([^)\\]|\\.)*\)/g) || [];
          for (const p of parens) {
            const inner = p
              .slice(1, -1)
              .replace(/\\n/g, "\n")
              .replace(/\\r/g, "")
              .replace(/\\t/g, " ")
              .replace(/\\\\/g, "\\")
              .replace(/\\\(/g, "(")
              .replace(/\\\)/g, ")");
            if (inner.trim()) chunks.push(inner);
          }
        }
        return chunks.join(" ").trim().slice(0, 100_000);
      } catch (e2) {
        console.error("[index-document] PDF-Extraktion fehlgeschlagen:", e2);
      }
    }
  }

  // ── Plaintext (.txt / .md / .csv) ──
  if (
    mimeType?.startsWith("text/") ||
    name.endsWith(".txt") ||
    name.endsWith(".md")
  ) {
    return new TextDecoder().decode(buffer).slice(0, 100_000);
  }

  return "";
}

// -- Postgres-Sicherung -------------------------------------------------------

/**
 * PostgREST schickt den Update-Body durch `jsonb`. Dort sind das Null-Zeichen
 * U+0000 ("unsupported Unicode escape sequence") und ungepaarte Surrogate
 * ("invalid Unicode surrogate pair") nicht darstellbar - beides kommt in
 * extrahiertem Text regelmaessig vor (kaputte PDF-Zeichentabellen, UTF-16-
 * Dateien, ein slice() mitten durch ein Surrogatpaar). Ohne diese Bereinigung
 * schlaegt das Update fehl und das Dokument bleibt unindexiert.
 * Gegenstueck im Frontend: src/lib/pgSafeText.js
 */
function scrubPgText(s: string): string {
  let out = s.indexOf("\u0000") === -1 ? s : s.replace(/\u0000/g, "");
  if (/[\uD800-\uDFFF]/.test(out)) {
    // deno-lint-ignore no-explicit-any
    const anyOut = out as any;
    out = typeof anyOut.toWellFormed === "function"
      ? anyOut.toWellFormed()
      : out.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "\uFFFD")
           .replace(/([^\uD800-\uDBFF]|^)([\uDC00-\uDFFF])/g, "$1\uFFFD");
  }
  return out;
}

// ── Einzeldokument indexieren ─────────────────────────────────────────────────

async function indexOne(docId: string): Promise<{ status: string; chars: number; quelle?: string }> {
  const { data: doc, error } = await supabase
    .from("dokumente")
    .select("id, filename, storage_path, file_type, content_text")
    .eq("id", docId)
    .single();

  if (error || !doc) throw new Error("Dokument nicht gefunden: " + docId);
  if (!doc.storage_path) return { status: "no_storage_path", chars: 0 };
  if (doc.content_text)  return { status: "already_indexed", chars: doc.content_text.length };

  const { data: fileData, error: dlErr } = await supabase.storage
    .from("dokumente")
    .download(doc.storage_path);

  if (dlErr || !fileData) throw new Error("Download fehlgeschlagen: " + dlErr?.message);

  const buffer   = await fileData.arrayBuffer();
  const filename = doc.filename || "";
  const mime     = doc.file_type || "";

  // 1) Lokal, so weit es geht: Textebene im PDF, Excel, Word, Klartext.
  let text   = scrubPgText(await extractText(buffer, filename, mime));
  let quelle = text ? "lokal" : "leer";

  // 2) Reicht das nicht (Scan, Bild, .doc, .rtf), uebernimmt der OCR-Container.
  //    Ohne OCR_URL wird der Schritt still uebersprungen.
  if (needsOcr(filename, mime, text)) {
    if (ocrConfigured()) {
      const ocrText = scrubPgText(await ocrExtract(buffer, filename, mime));
      if (ocrText.trim().length > text.trim().length) {
        text   = ocrText;
        quelle = "ocr";
      }
    } else {
      quelle = "ocr_nicht_konfiguriert";
    }
  }

  if (text) {
    const { error: updErr } = await supabase
      .from("dokumente")
      .update({ content_text: text })
      .eq("id", docId);
    if (updErr) throw new Error("Update fehlgeschlagen: " + updErr.message);
  }

  return { status: text ? "indexed" : "kein_text", chars: text.length, quelle };
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();

    // ── C) Batch-Modus, in Haeppchen mit Cursor ──
    // Frueher lief hier eine Schleife ueber ALLE offenen Dokumente. Mit dem
    // OCR-Container dauert ein einzelner Scan Sekunden bis Minuten, damit
    // liefe der Aufruf in die Laufzeitgrenze der Edge Function.
    //
    // Der Cursor (nach id aufsteigend) ist wichtig, nicht nur die Haeppchen:
    // Ein Scan, den auch die OCR nicht lesen kann, bleibt ohne content_text
    // und waere beim naechsten Durchgang wieder in der Auswahl. Ein Aufrufer,
    // der bis "fertig" wiederholt, haenge sonst ewig an denselben Dateien.
    //
    //   POST { batch: true, limit: 5 }              erster Durchgang
    //   POST { batch: true, limit: 5, after: "<last_id>" }   naechster
    // wiederholen, bis "fertig": true.
    if (payload.batch === true) {
      const limit = Math.max(1, Math.min(50, Number(payload.limit) || 5));
      const after = typeof payload.after === "string" ? payload.after : null;

      let q = supabase
        .from("dokumente")
        .select("id", { count: "exact" })
        .or("content_text.is.null,content_text.eq.")
        .not("storage_path", "is", null)
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .limit(limit);
      if (after) q = q.gt("id", after);

      const { data: docs, count } = await q;
      const ids = (docs || []).map((d) => d.id);

      let indexed = 0;
      let ohneText = 0;
      const errors: string[] = [];

      for (const id of ids) {
        try {
          const r = await indexOne(id);
          if (r.status === "indexed") indexed++;
          else ohneText++;
        } catch (e) {
          console.error("[index-document] Batch-Fehler:", id, e);
          errors.push(id + ": " + String(e));
        }
      }

      return new Response(
        JSON.stringify({
          status:       "batch_done",
          verarbeitet:  ids.length,
          indexed,
          ohne_text:    ohneText,
          last_id:      ids.length ? ids[ids.length - 1] : after,
          fertig:       ids.length < limit,
          offen_gesamt: count ?? null,
          ocr:          ocrConfigured() ? "aktiv" : "nicht konfiguriert",
          errors,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── A) Database Webhook ──
    if (payload.type === "INSERT" && payload.record) {
      const r = payload.record;
      // Nur verarbeiten wenn storage_path vorhanden und content_text leer
      if (!r.storage_path || r.content_text) {
        return new Response(
          JSON.stringify({ status: "skipped" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const result = await indexOne(r.id);
      return new Response(
        JSON.stringify({ doc_id: r.id, ...result }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── B) Einzeldokument ──
    const docId = payload.doc_id;
    if (!docId) {
      return new Response(
        JSON.stringify({ error: "Kein doc_id oder batch:true angegeben" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = await indexOne(docId);
    return new Response(
      JSON.stringify({ doc_id: docId, ...result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[index-document] Fehler:", e);
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
