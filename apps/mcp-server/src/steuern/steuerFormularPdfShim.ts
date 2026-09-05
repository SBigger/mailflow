/**
 * Ersatz fuer src/lib/steuerFormularPdf.js im Server-Kontext: loest den
 * Marker "storage:<pfad>" ueber den Service-Role-Client zu einer Signed URL
 * des Buckets "steuerformulare" auf. Wird ueber aliasLoader.ts eingeblendet.
 */
import { supabase } from "../supabase.js";

const BUCKET = "steuerformulare";
const MARKER = "storage:";
const cache = new Map<string, { url: string; bis: number }>();

export function istStoragePfad(pdfUrl: unknown): boolean {
  return typeof pdfUrl === "string" && pdfUrl.startsWith(MARKER);
}

export async function resolveFormularPdfUrl(pdfUrl: string): Promise<string> {
  if (!istStoragePfad(pdfUrl)) {
    // Relative Pfade (z.B. /pdf-estv/...) laufen im Frontend ueber Vercel-Rewrites; hier auf smartis.me umbiegen.
    if (pdfUrl.startsWith("/")) return "https://smartis.me" + pdfUrl;
    return pdfUrl;
  }
  const pfad = pdfUrl.slice(MARKER.length);
  const c = cache.get(pfad);
  if (c && c.bis - 60_000 > Date.now()) return c.url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(pfad, 3600);
  if (error || !data?.signedUrl) throw new Error(`Formular-PDF "${pfad}" nicht ladbar: ${error?.message ?? "keine URL"}`);
  cache.set(pfad, { url: data.signedUrl, bis: Date.now() + 3600_000 });
  return data.signedUrl;
}
