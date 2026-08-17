// Zentraler "Dokument oeffnen"-Helfer (Read-only-Ansicht, KEIN Checkout).
//
// Bisher hatte jede Stelle (Dokumente.jsx, DokumenteWidget, Abschluss-
// dokumentation, ...) ihre eigene Kopie dieser Logik -- teils OHNE den
// Legacy-Prefix-Strip, was bei alten Zeilen kaputte Signed-URLs ergab.
// Regeln (Scout-Befund 2026-07-26):
//   1. sharepoint_web_url gesetzt -> direkt oeffnen (SharePoint-Dokument).
//   2. sonst storage_path im Bucket "dokumente" signieren (600s) --
//      Legacy-Zeilen tragen den Prefix "dokumente/" im Pfad, der NICHT
//      Teil des Bucket-Pfads ist und vorher entfernt werden muss.
import { supabase } from "@/api/supabaseClient";

export async function openDokument(doc) {
  if (!doc) return false;
  if (doc.sharepoint_web_url) {
    window.open(doc.sharepoint_web_url, "_blank", "noopener");
    return true;
  }
  if (!doc.storage_path) return false;
  const path = doc.storage_path.replace(/^dokumente\//, "");
  const { data, error } = await supabase.storage.from("dokumente").createSignedUrl(path, 600);
  if (error || !data?.signedUrl) return false;
  window.open(data.signedUrl, "_blank", "noopener");
  return true;
}
