/**
 * docFileName.js — saubere Dateinamen fuer Download, ZIP und Versand.
 *
 * In den Dokumentnamen stecken interne Nummern, die den Kunden nichts angehen:
 *   1. Upload-Zeitstempel vorne:  "20260707121813_Aktivierungen 2025-26"
 *   2. Storage-Key vorne:         "steuern_2026_1776068445256@M2-20 Umsatzabstimmung"
 *   3. M-Files-Objekt-ID hinten:  "... - Aerne Engineering AG (ID 66287)"
 *
 * BEWUSST NICHT entfernt werden fachliche Nummern, die zum Namen gehoeren:
 *   "250325 - Versand - ..."      (Datum JJMMTT aus der M-Files-Konvention)
 *   "2025-Q3 - MWST - ..."        (Periode)
 *   "2026-04 - Reporting - ..."   (Jahr-Monat)
 *   "M2-20 Umsatzabstimmung"      (Abschlussregister)
 *   "Rechnung 63156778"           (Belegnummer des Kunden)
 * Deshalb sind die Muster unten eng gefasst statt "alles was mit Ziffern beginnt".
 */

// 1) Upload-Zeitstempel: genau 14 Ziffern (JJJJMMTTHHMMSS) + Unterstrich.
const RE_UPLOAD_STAMP = /^\d{14}_/;

// 2) Storage-Key: <kategorie>_<jahr>_<epoch-ms>@
const RE_STORAGE_KEY = /^[a-z]+_\d{4}_\d{13}@/;

// 3) M-Files-Objekt-ID am Ende, in den drei Schreibweisen, die real vorkommen:
//    " (ID 66287)" | "__ID_66287_" | "_(ID_66287)"
const RE_MFILES_ID = /[\s_]*[(_]ID[\s_]\d{3,}[)_]?\s*$/;

/**
 * Interne Nummern aus einem Dokumentnamen entfernen.
 * Gibt bei leerem Ergebnis den Originalnamen zurueck (nie einen leeren Namen liefern).
 */
export function stripInternalNumbers(raw) {
  const original = String(raw ?? "").trim();
  if (!original) return "";

  let out = original;
  out = out.replace(RE_UPLOAD_STAMP, "");
  out = out.replace(RE_STORAGE_KEY, "");
  out = out.replace(RE_MFILES_ID, "");

  // Aus M-Files exportierte Namen tragen Unterstriche statt Leerzeichen.
  // Nur umwandeln, wenn der Name gar keine Leerzeichen hat UND mindestens zwei
  // Unterstriche zeigt -- so bleiben Belegnummern wie "1634_001" unangetastet.
  if (!/\s/.test(out) && (out.match(/_/g) || []).length >= 2) {
    out = out.replace(/_/g, " ");
  }

  out = out.replace(/\s{2,}/g, " ").replace(/[\s_-]+$/, "").trim();
  return out || original;
}

/** Dateiendung aus dem Original-Dateinamen (inkl. Punkt, sonst ""). */
export function extensionOf(filename) {
  const f = String(filename ?? "");
  const dot = f.lastIndexOf(".");
  const slash = Math.max(f.lastIndexOf("/"), f.lastIndexOf("\\"));
  return dot > slash && dot > 0 ? f.slice(dot) : "";
}

/** Fuer Windows/macOS unzulaessige Zeichen ersetzen. */
export function sanitizeFileName(name) {
  return String(name ?? "").replace(/[\\/:*?"<>|]/g, "_").trim();
}

/**
 * Fertiger Dateiname fuer Download / ZIP-Eintrag / Mailanhang:
 * bereinigter Anzeigename + Original-Endung, sonderzeichensicher.
 */
export function prettyDownloadName(doc, fallback = "Dokument") {
  const ext = extensionOf(doc?.filename) || extensionOf(doc?.name);
  const base = sanitizeFileName(
    stripInternalNumbers(doc?.name) ||
    stripInternalNumbers(stripExtension(doc?.filename)) ||
    fallback,
  ) || fallback;
  return base.toLowerCase().endsWith(ext.toLowerCase()) ? base : base + ext;
}

function stripExtension(filename) {
  const f = String(filename ?? "");
  const ext = extensionOf(f);
  return ext ? f.slice(0, -ext.length) : f;
}

/** Reiner Anzeigename ohne Endung und ohne interne Nummern (fuer Listen/Panels). */
export function prettyDisplayName(doc, fallback = "Dokument") {
  return (
    stripInternalNumbers(doc?.name) ||
    stripInternalNumbers(stripExtension(doc?.filename)) ||
    fallback
  );
}
