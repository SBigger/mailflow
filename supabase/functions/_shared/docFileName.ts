/**
 * docFileName.ts — saubere Dateinamen fuer alles, was das Haus verlaesst.
 *
 * Spiegelt src/lib/docFileName.js. Die Signed URL setzt den Dateinamen per
 * Content-Disposition, und der schlaegt jedes a.download im Browser -- deshalb
 * muss die Bereinigung AUCH hier passieren, nicht nur im Frontend.
 *
 * Entfernt werden nur eindeutig interne Nummern:
 *   "20260707121813_..."                  Upload-Zeitstempel
 *   "steuern_2026_1776068445256@..."      Storage-Key
 *   "... (ID 66287)" / "..__ID_66287_"    M-Files-Objekt-ID
 * Erhalten bleiben fachliche Nummern: "250325 - Versand - ...", "2025-Q3 - ...",
 * "2026-04 - ...", "M2-20 ...", "Rechnung 63156778".
 */

const RE_UPLOAD_STAMP = /^\d{14}_/;
const RE_STORAGE_KEY = /^[a-z]+_\d{4}_\d{13}@/;
const RE_MFILES_ID = /[\s_]*[(_]ID[\s_]\d{3,}[)_]?\s*$/;

export function stripInternalNumbers(raw: string | null | undefined): string {
  const original = String(raw ?? "").trim();
  if (!original) return "";

  let out = original;
  out = out.replace(RE_UPLOAD_STAMP, "");
  out = out.replace(RE_STORAGE_KEY, "");
  out = out.replace(RE_MFILES_ID, "");

  if (!/\s/.test(out) && (out.match(/_/g) || []).length >= 2) {
    out = out.replace(/_/g, " ");
  }

  out = out.replace(/\s{2,}/g, " ").replace(/[\s_-]+$/, "").trim();
  return out || original;
}

function extensionOf(filename: string | null | undefined): string {
  const f = String(filename ?? "");
  const dot = f.lastIndexOf(".");
  const slash = Math.max(f.lastIndexOf("/"), f.lastIndexOf("\\"));
  return dot > slash && dot > 0 ? f.slice(dot) : "";
}

function stripExtension(filename: string | null | undefined): string {
  const f = String(filename ?? "");
  const ext = extensionOf(f);
  return ext ? f.slice(0, -ext.length) : f;
}

/** Anzeigename ohne interne Nummern + Original-Endung, sonderzeichensicher. */
export function prettyDownloadName(
  doc: { name?: string | null; filename?: string | null },
  fallback = "Dokument",
): string {
  const ext = extensionOf(doc?.filename) || extensionOf(doc?.name);
  const base =
    (stripInternalNumbers(doc?.name) ||
      stripInternalNumbers(stripExtension(doc?.filename)) ||
      fallback)
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim() || fallback;
  return base.toLowerCase().endsWith(ext.toLowerCase()) ? base : base + ext;
}
