/**
 * DocHoverPreview.jsx — kleines Vorschau-Popup beim Maus-Hover ueber das Augen-Symbol.
 *
 * Rendert KOMPLETT LOKAL (keine externen Dienste, kein SharePoint):
 *   Bild | PDF (1. Seite) | Excel (xlsx) | Word (docx, mammoth) | Text.
 * Bekommt eine bereits abrufbare URL (Supabase Signed-URL) + die Position des
 * Ankers (Icon), positioniert sich links daneben und laedt die Bytes einmalig
 * (Cache pro doc.id), damit wiederholtes Hovern nicht erneut herunterlaedt.
 */
import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";

if (pdfjsLib?.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.js",
    import.meta.url,
  ).href;
}

const W = 380;          // Popup-Breite
const H = 460;          // Popup-Hoehe
const MAX_BYTES = 15 * 1024 * 1024;  // ueber 15 MB keine Auto-Vorschau (Bandbreite)

const blobCache = new Map();  // doc.id -> { url, blob }

async function getBlob(doc, url) {
  const c = blobCache.get(doc.id);
  if (c && c.url === url) return c.blob;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("Download fehlgeschlagen (" + resp.status + ")");
  const blob = await resp.blob();
  blobCache.set(doc.id, { url, blob });
  return blob;
}

export default function DocHoverPreview({ doc, url, rect, onEnter, onLeave }) {
  const [st, setSt] = useState({ kind: "loading", payload: null, error: null });
  const [pdfImg, setPdfImg] = useState(null);
  const objUrlRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setSt({ kind: "loading", payload: null, error: null });
    setPdfImg(null);
    const name = (doc.filename || doc.name || "").toLowerCase();

    (async () => {
      try {
        if (doc.file_size && doc.file_size > MAX_BYTES) {
          if (!cancelled) setSt({ kind: "toobig", payload: null, error: null });
          return;
        }
        const blob = await getBlob(doc, url);
        if (cancelled) return;
        const file = new File([blob], doc.filename || doc.name || "datei", { type: blob.type });

        // ── Bild ──
        if (/\.(png|jpe?g|webp|bmp|gif|svg)$/.test(name) || (blob.type || "").startsWith("image/")) {
          const o = URL.createObjectURL(blob);
          objUrlRef.current = o;
          if (!cancelled) setSt({ kind: "img", payload: o, error: null });
          return;
        }
        // ── PDF (nur 1. Seite) ──
        if (name.endsWith(".pdf") || blob.type === "application/pdf") {
          const buf = await blob.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
          const page = await pdf.getPage(1);
          const vp = page.getViewport({ scale: 1.4 });
          const canvas = document.createElement("canvas");
          canvas.width = vp.width; canvas.height = vp.height;
          await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
          if (!cancelled) { setPdfImg(canvas.toDataURL("image/jpeg", 0.85)); setSt({ kind: "pdf", payload: pdf.numPages, error: null }); }
          return;
        }
        // ── Excel ──
        if (/\.(xlsx|xls|xlsm|xlsb|ods|csv)$/.test(name)) {
          const { read, utils } = await import("xlsx");
          const buf = await blob.arrayBuffer();
          const wb = read(new Uint8Array(buf), { type: "array", cellDates: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }).slice(0, 60);
          if (!cancelled) setSt({ kind: "excel", payload: { rows, sheet: wb.SheetNames[0], more: wb.SheetNames.length > 1 }, error: null });
          return;
        }
        // ── Word ──
        if (/\.(docx|docm)$/.test(name)) {
          const buf = await blob.arrayBuffer();
          const mod = await import("mammoth/mammoth.browser");
          const mammoth = mod.default || mod;
          const { value } = await mammoth.convertToHtml({ arrayBuffer: buf });
          if (!cancelled) setSt({ kind: "word", payload: value || "", error: null });
          return;
        }
        // ── Text ──
        if (/\.(txt|md|json|xml|log)$/.test(name) || (blob.type || "").startsWith("text/")) {
          const txt = await blob.text();
          if (!cancelled) setSt({ kind: "text", payload: txt.slice(0, 4000), error: null });
          return;
        }
        if (!cancelled) setSt({ kind: "none", payload: null, error: null });
      } catch (e) {
        if (!cancelled) setSt({ kind: "error", payload: null, error: e.message });
      }
    })();

    return () => { cancelled = true; if (objUrlRef.current) { URL.revokeObjectURL(objUrlRef.current); objUrlRef.current = null; } };
  }, [doc.id, url]);

  // Position: links neben dem Icon, in den Viewport geklemmt.
  const left = Math.max(8, (rect?.left ?? 200) - W - 10);
  const top  = Math.min(Math.max(8, (rect?.top ?? 100) - H / 2 + 12), (typeof window !== "undefined" ? window.innerHeight : 800) - H - 8);

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        position: "fixed", left, top, width: W, height: H, zIndex: 4000,
        background: "#1b1b1b", border: "1px solid #3a3a3a", borderRadius: 10,
        boxShadow: "0 12px 40px rgba(0,0,0,0.55)", overflow: "hidden",
        display: "flex", flexDirection: "column", color: "#ddd",
      }}>
      {/* Kopf */}
      <div style={{ flexShrink: 0, padding: "7px 10px", borderBottom: "1px solid #333", display: "flex", alignItems: "center", gap: 6, background: "#222" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#eee", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {doc.name || doc.filename}
        </span>
      </div>

      {/* Inhalt */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: st.kind === "word" ? "#2a2a2a" : "#151515" }}>
        {st.kind === "loading" && <Centered>Lade Vorschau…</Centered>}
        {st.kind === "toobig"  && <Centered>Datei zu groß für die Schnell-Vorschau<br/>(über 15 MB) – bitte herunterladen.</Centered>}
        {st.kind === "none"    && <Centered>Keine Vorschau für diesen Dateityp.</Centered>}
        {st.kind === "error"   && <Centered>⚠ {st.error}</Centered>}

        {st.kind === "img" && (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 10 }}>
            <img src={st.payload} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 4 }} />
          </div>
        )}

        {st.kind === "pdf" && (
          <div style={{ padding: 10, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <img src={pdfImg} alt="" style={{ maxWidth: "100%", borderRadius: 3, boxShadow: "0 2px 12px rgba(0,0,0,0.5)" }} />
            <span style={{ fontSize: 10, color: "#777" }}>Seite 1 von {st.payload}</span>
          </div>
        )}

        {st.kind === "excel" && (
          <div style={{ overflow: "auto", padding: 4 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 11, color: "#ddd" }}>
              <tbody>
                {st.payload.rows.map((row, ri) => (
                  <tr key={ri} style={{ background: ri === 0 ? "#252525" : ri % 2 ? "#1b1b1b" : "transparent" }}>
                    {(row.length ? row : [""]).map((c, ci) => (
                      <td key={ci} style={{ border: "1px solid #2c2c2c", padding: "2px 6px", whiteSpace: "nowrap",
                        maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", fontWeight: ri === 0 ? 600 : 400 }}>{String(c ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {st.payload.more && <div style={{ fontSize: 9, color: "#666", padding: "4px 6px" }}>weitere Blätter vorhanden…</div>}
          </div>
        )}

        {st.kind === "word" && (
          <div style={{ padding: 12 }}>
            <style>{`
              .hov-word table { border-collapse: collapse; width: 100%; margin: 6px 0; }
              .hov-word td, .hov-word th { border: 1px solid #ccc; padding: 3px 6px; font-size: 11px; vertical-align: top; }
              .hov-word img { max-width: 100%; height: auto; }
              .hov-word p { margin: 0 0 0.5em; } .hov-word h1,.hov-word h2,.hov-word h3 { margin: .5em 0 .25em; }
            `}</style>
            <div className="hov-word"
              style={{ background: "#fff", color: "#1a1a1a", padding: "20px 22px", borderRadius: 3,
                fontFamily: "Calibri, 'Segoe UI', Arial, sans-serif", fontSize: 12.5, lineHeight: 1.5 }}
              dangerouslySetInnerHTML={{ __html: st.payload || "<p style='color:#888'>Keine Textvorschau.</p>" }} />
          </div>
        )}

        {st.kind === "text" && (
          <pre style={{ margin: 0, padding: 12, fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#ccc" }}>{st.payload}</pre>
        )}
      </div>
    </div>
  );
}

function Centered({ children }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
      color: "#888", fontSize: 12, padding: 20 }}>{children}</div>
  );
}
