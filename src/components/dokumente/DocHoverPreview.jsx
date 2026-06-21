/**
 * DocHoverPreview.jsx — Vorschau-Fenster (oeffnet beim Hover ueber das Augen-Symbol).
 *
 * Bleibt offen, per Kopfzeile VERSCHIEBBAR, an der Ecke GROESSENVERSTELLBAR
 * (Groesse wird in localStorage gemerkt), Schliessen per ×.
 * Rendert KOMPLETT LOKAL (keine externen Dienste, kein SharePoint):
 *   Bild | PDF (alle Seiten, blaetterbar) | Excel (alle Blaetter) | Word (docx) | Text.
 * Laedt die Bytes einmalig (Cache pro doc.id).
 */
import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";

if (pdfjsLib?.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.js",
    import.meta.url,
  ).href;
}

const MAX_BYTES = 15 * 1024 * 1024;
const MIN_W = 280, MIN_H = 220;
const SIZE_KEY = "docPreviewSize";

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

function loadSize() {
  try { const s = JSON.parse(localStorage.getItem(SIZE_KEY)); if (s && s.w >= MIN_W && s.h >= MIN_H) return s; } catch { /* ignore */ }
  return { w: 440, h: 540 };
}
function saveSize(w, h) { try { localStorage.setItem(SIZE_KEY, JSON.stringify({ w, h })); } catch { /* ignore */ } }

export default function DocHoverPreview({ doc, url, rect, onClose }) {
  const [st, setSt] = useState({ kind: "loading", payload: null, error: null });

  // PDF-State
  const pdfDocRef = useRef(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfNum, setPdfNum]   = useState(1);
  const [pdfImg, setPdfImg]   = useState(null);

  // Excel-State
  const [excel, setExcel] = useState(null);  // { sheets:[{name,rows}], active }

  const objUrlRef = useRef(null);

  // ── Fenster-Geometrie (verschiebbar + groessenverstellbar, Groesse gemerkt) ──
  const [box, setBox] = useState(() => {
    const { w, h } = loadSize();
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    let left = (rect?.left ?? 240) - w - 12;
    if (left < 8) left = Math.min((rect?.right ?? 8) + 12, vw - w - 8);
    left = Math.max(8, Math.min(left, vw - w - 8));
    const top = Math.max(8, Math.min((rect?.top ?? 100) - 30, vh - h - 8));
    return { left, top, w, h };
  });
  const boxRef = useRef(box);
  const dragRef = useRef(null);

  const onHeaderDown = (e) => {
    e.preventDefault();
    dragRef.current = { mode: "move", sx: e.clientX, sy: e.clientY, box: { ...boxRef.current } };
    attach();
  };
  const onResizeDown = (e) => {
    e.preventDefault(); e.stopPropagation();
    dragRef.current = { mode: "resize", sx: e.clientX, sy: e.clientY, box: { ...boxRef.current } };
    attach();
  };
  const attach = () => {
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const onMove = (ev) => {
    const d = dragRef.current; if (!d) return;
    const dx = ev.clientX - d.sx, dy = ev.clientY - d.sy;
    setBox(() => {
      let nb;
      if (d.mode === "move") {
        const vw = window.innerWidth, vh = window.innerHeight;
        nb = { ...d.box,
          left: Math.max(8, Math.min(d.box.left + dx, vw - d.box.w - 8)),
          top:  Math.max(8, Math.min(d.box.top + dy,  vh - 40)) };
      } else {
        nb = { ...d.box, w: Math.max(MIN_W, d.box.w + dx), h: Math.max(MIN_H, d.box.h + dy) };
      }
      boxRef.current = nb;
      return nb;
    });
  };
  const onUp = () => {
    const d = dragRef.current;
    if (d && d.mode === "resize") saveSize(boxRef.current.w, boxRef.current.h);
    dragRef.current = null;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };
  useEffect(() => () => onUp(), []);

  // ── Inhalt laden ──
  useEffect(() => {
    let cancelled = false;
    setSt({ kind: "loading", payload: null, error: null });
    setPdfImg(null); pdfDocRef.current = null; setExcel(null);
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
          if (cancelled) return;
          pdfDocRef.current = pdf;
          setPdfNum(pdf.numPages); setPdfPage(1);
          setSt({ kind: "pdf", payload: null, error: null });
          return;
        }
        if (/\.(xlsx|xls|xlsm|xlsb|ods|csv)$/.test(name)) {
          const { read, utils } = await import("xlsx");
          const buf = await blob.arrayBuffer();
          const wb = read(new Uint8Array(buf), { type: "array", cellDates: true });
          const sheets = wb.SheetNames.map(nm => ({
            name: nm,
            rows: utils.sheet_to_json(wb.Sheets[nm], { header: 1, raw: false, defval: "" }).slice(0, 1000),
          }));
          if (!cancelled) { setExcel({ sheets, active: 0 }); setSt({ kind: "excel", payload: null, error: null }); }
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
          if (!cancelled) setSt({ kind: "text", payload: txt.slice(0, 12000), error: null });
          return;
        }
        if (!cancelled) setSt({ kind: "none", payload: null, error: null });
      } catch (e) {
        if (!cancelled) setSt({ kind: "error", payload: null, error: e.message });
      }
    })();

    return () => { cancelled = true; if (objUrlRef.current) { URL.revokeObjectURL(objUrlRef.current); objUrlRef.current = null; } };
  }, [doc.id, url]);

  // ── PDF-Seite rendern (bei Seitenwechsel) ──
  useEffect(() => {
    if (st.kind !== "pdf" || !pdfDocRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await pdfDocRef.current.getPage(pdfPage);
        const vp = page.getViewport({ scale: 1.6 });
        const canvas = document.createElement("canvas");
        canvas.width = vp.width; canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
        if (!cancelled) setPdfImg(canvas.toDataURL("image/jpeg", 0.85));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [st.kind, pdfPage]);

  const excelRows = excel?.sheets?.[excel.active]?.rows || [];

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
        {/* PDF-Blaetter-Navigation */}
        {st.kind === "pdf" && pdfNum > 1 && (
          <span onMouseDown={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 4, marginRight: 4 }}>
            <button onClick={() => setPdfPage(p => Math.max(1, p - 1))} disabled={pdfPage <= 1}
              style={navBtn(pdfPage > 1)}><ChevronLeft size={14} /></button>
            <span style={{ fontSize: 10, color: "#aaa", minWidth: 54, textAlign: "center" }}>{pdfPage} / {pdfNum}</span>
            <button onClick={() => setPdfPage(p => Math.min(pdfNum, p + 1))} disabled={pdfPage >= pdfNum}
              style={navBtn(pdfPage < pdfNum)}><ChevronRight size={14} /></button>
          </span>
        )}
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
          <div style={{ padding: 10, display: "flex", justifyContent: "center" }}>
            {pdfImg
              ? <img src={pdfImg} alt="" style={{ maxWidth: "100%", borderRadius: 3, boxShadow: "0 2px 12px rgba(0,0,0,0.5)" }} />
              : <span style={{ color: "#777", fontSize: 12, padding: 30 }}>Seite wird gerendert…</span>}
          </div>
        )}

        {st.kind === "excel" && (
          <div style={{ overflow: "auto", padding: 4 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 11, color: "#ddd" }}>
              <tbody>
                {excelRows.map((row, ri) => (
                  <tr key={ri} style={{ background: ri === 0 ? "#252525" : ri % 2 ? "#1b1b1b" : "transparent" }}>
                    {(row.length ? row : [""]).map((c, ci) => (
                      <td key={ci} style={{ border: "1px solid #2c2c2c", padding: "2px 6px", whiteSpace: "nowrap",
                        maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", fontWeight: ri === 0 ? 600 : 400 }}>{String(c ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
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

      {/* Excel-Blatt-Tabs */}
      {st.kind === "excel" && excel && excel.sheets.length > 1 && (
        <div style={{ flexShrink: 0, display: "flex", borderTop: "1px solid #333", background: "#111", overflowX: "auto" }}>
          {excel.sheets.map((sh, i) => (
            <button key={i} onClick={() => setExcel(e => ({ ...e, active: i }))}
              style={{ padding: "4px 12px", fontSize: 10, border: "none", cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
                borderRight: "1px solid #2a2a2a",
                background: i === excel.active ? "#252525" : "transparent",
                color: i === excel.active ? "#fff" : "#888",
                borderTop: `2px solid ${i === excel.active ? "#4a7a4f" : "transparent"}` }}>
              {sh.name}
            </button>
          ))}
        </div>
      )}

      {/* Resize-Griff unten rechts */}
      <div onMouseDown={onResizeDown} title="Größe ziehen"
        style={{ position: "absolute", right: 0, bottom: 0, width: 16, height: 16, cursor: "nwse-resize",
          background: "linear-gradient(135deg, transparent 50%, #555 50%, #555 60%, transparent 60%, transparent 72%, #555 72%, #555 82%, transparent 82%)" }} />
    </div>
  );
}

function navBtn(enabled) {
  return { background: "none", border: "none", cursor: enabled ? "pointer" : "default",
    color: enabled ? "#ccc" : "#555", display: "flex", padding: 2 };
}

function Centered({ children }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
      color: "#888", fontSize: 12, padding: 20 }}>{children}</div>
  );
}
