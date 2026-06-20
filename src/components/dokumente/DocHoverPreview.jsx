/**
 * DocHoverPreview.jsx — Vorschau-Fenster (oeffnet beim Hover ueber das Augen-Symbol).
 *
 * Das Fenster BLEIBT offen (kein Auto-Schliessen), ist per Kopfzeile VERSCHIEBBAR
 * und an der unteren rechten Ecke in der GROESSE verstellbar. Schliessen per ×.
 * Rendert KOMPLETT LOKAL (keine externen Dienste, kein SharePoint):
 *   Bild | PDF (1. Seite) | Excel (xlsx) | Word (docx, mammoth) | Text.
 * Laedt die Bytes einmalig (Cache pro doc.id).
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";

if (pdfjsLib?.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.js",
    import.meta.url,
  ).href;
}

const MAX_BYTES = 15 * 1024 * 1024;  // ueber 15 MB keine Auto-Vorschau (Bandbreite)
const MIN_W = 280, MIN_H = 220;

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

export default function DocHoverPreview({ doc, url, rect, onClose }) {
  const [st, setSt] = useState({ kind: "loading", payload: null, error: null });
  const [pdfImg, setPdfImg] = useState(null);
  const objUrlRef = useRef(null);

  // ── Fenster-Geometrie (verschiebbar + groessenverstellbar) ──
  const [box, setBox] = useState(() => {
    const w = 440, h = 540;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    let left = (rect?.left ?? 240) - w - 12;            // links neben dem Icon
    if (left < 8) left = Math.min((rect?.right ?? 8) + 12, vw - w - 8);
    left = Math.max(8, Math.min(left, vw - w - 8));
    const top = Math.max(8, Math.min((rect?.top ?? 100) - 30, vh - h - 8));
    return { left, top, w, h };
  });
  const dragRef = useRef(null);

  const onHeaderDown = (e) => {
    e.preventDefault();
    dragRef.current = { mode: "move", sx: e.clientX, sy: e.clientY, box: { ...box } };
    attach();
  };
  const onResizeDown = (e) => {
    e.preventDefault(); e.stopPropagation();
    dragRef.current = { mode: "resize", sx: e.clientX, sy: e.clientY, box: { ...box } };
    attach();
  };
  const attach = () => {
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const onMove = (ev) => {
    const d = dragRef.current; if (!d) return;
    const dx = ev.clientX - d.sx, dy = ev.clientY - d.sy;
    if (d.mode === "move") {
      const vw = window.innerWidth, vh = window.innerHeight;
      setBox(b => ({ ...b,
        left: Math.max(8, Math.min(d.box.left + dx, vw - b.w - 8)),
        top:  Math.max(8, Math.min(d.box.top + dy,  vh - 40)) }));
    } else {
      setBox(b => ({ ...b,
        w: Math.max(MIN_W, d.box.w + dx),
        h: Math.max(MIN_H, d.box.h + dy) }));
    }
  };
  const onUp = () => {
    dragRef.current = null;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };
  useEffect(() => () => onUp(), []);  // Cleanup falls beim Unmount noch gezogen

  // ── Inhalt laden ──
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

        if (/\.(png|jpe?g|webp|bmp|gif|svg)$/.test(name) || (blob.type || "").startsWith("image/")) {
          const o = URL.createObjectURL(blob);
          objUrlRef.current = o;
          if (!cancelled) setSt({ kind: "img", payload: o, error: null });
          return;
        }
        if (name.endsWith(".pdf") || blob.type === "application/pdf") {
          const buf = await blob.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
          const page = await pdf.getPage(1);
          const vp = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          canvas.width = vp.width; canvas.height = vp.height;
          await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
          if (!cancelled) { setPdfImg(canvas.toDataURL("image/jpeg", 0.85)); setSt({ kind: "pdf", payload: pdf.numPages, error: null }); }
          return;
        }
        if (/\.(xlsx|xls|xlsm|xlsb|ods|csv)$/.test(name)) {
          const { read, utils } = await import("xlsx");
          const buf = await blob.arrayBuffer();
          const wb = read(new Uint8Array(buf), { type: "array", cellDates: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }).slice(0, 200);
          if (!cancelled) setSt({ kind: "excel", payload: { rows, more: wb.SheetNames.length > 1 }, error: null });
          return;
        }
        if (/\.(docx|docm)$/.test(name)) {
          const buf = await blob.arrayBuffer();
          const mod = await import("mammoth/mammoth.browser");
          const mammoth = mod.default || mod;
          const { value } = await mammoth.convertToHtml({ arrayBuffer: buf });
          if (!cancelled) setSt({ kind: "word", payload: value || "", error: null });
          return;
        }
        if (/\.(txt|md|json|xml|log|csv)$/.test(name) || (blob.type || "").startsWith("text/")) {
          const txt = await blob.text();
          if (!cancelled) setSt({ kind: "text", payload: txt.slice(0, 8000), error: null });
          return;
        }
        if (!cancelled) setSt({ kind: "none", payload: null, error: null });
      } catch (e) {
        if (!cancelled) setSt({ kind: "error", payload: null, error: e.message });
      }
    })();

    return () => { cancelled = true; if (objUrlRef.current) { URL.revokeObjectURL(objUrlRef.current); objUrlRef.current = null; } };
  }, [doc.id, url]);

  return (
    <div style={{
      position: "fixed", left: box.left, top: box.top, width: box.w, height: box.h, zIndex: 4000,
      background: "#1b1b1b", border: "1px solid #3a3a3a", borderRadius: 10,
      boxShadow: "0 14px 48px rgba(0,0,0,0.6)", overflow: "hidden",
      display: "flex", flexDirection: "column", color: "#ddd",
    }}>
      {/* Kopf = Drag-Griff */}
      <div onMouseDown={onHeaderDown}
        style={{ flexShrink: 0, padding: "7px 8px 7px 12px", borderBottom: "1px solid #333",
          display: "flex", alignItems: "center", gap: 6, background: "#222", cursor: "move", userSelect: "none" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#eee", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {doc.name || doc.filename}
        </span>
        <button onClick={onClose} onMouseDown={e => e.stopPropagation()} title="Schließen"
          style={{ background: "none", border: "none", cursor: "pointer", color: "#999", display: "flex", padding: 2, borderRadius: 4 }}
          onMouseEnter={e => e.currentTarget.style.color = "#fff"}
          onMouseLeave={e => e.currentTarget.style.color = "#999"}>
          <X size={15} />
        </button>
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
                        maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", fontWeight: ri === 0 ? 600 : 400 }}>{String(c ?? "")}</td>
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
              style={{ background: "#fff", color: "#1a1a1a", padding: "22px 24px", borderRadius: 3,
                fontFamily: "Calibri, 'Segoe UI', Arial, sans-serif", fontSize: 13, lineHeight: 1.55 }}
              dangerouslySetInnerHTML={{ __html: st.payload || "<p style='color:#888'>Keine Textvorschau.</p>" }} />
          </div>
        )}

        {st.kind === "text" && (
          <pre style={{ margin: 0, padding: 12, fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#ccc" }}>{st.payload}</pre>
        )}
      </div>

      {/* Resize-Griff unten rechts */}
      <div onMouseDown={onResizeDown} title="Größe ziehen"
        style={{ position: "absolute", right: 0, bottom: 0, width: 16, height: 16, cursor: "nwse-resize",
          background: "linear-gradient(135deg, transparent 50%, #555 50%, #555 60%, transparent 60%, transparent 72%, #555 72%, #555 82%, transparent 82%)" }} />
    </div>
  );
}

function Centered({ children }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
      color: "#888", fontSize: 12, padding: 20 }}>{children}</div>
  );
}
