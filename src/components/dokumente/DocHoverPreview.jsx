/**
 * DocHoverPreview.jsx — Vorschau-Fenster (oeffnet beim Hover ueber das Augen-Symbol).
 *
 * Bleibt offen, per Kopfzeile VERSCHIEBBAR, an der Ecke GROESSENVERSTELLBAR
 * (Groesse + Position werden in localStorage gemerkt), Schliessen per ×.
 * Theme-abhaengiger Rahmen: artis = gruen, light = weiss, sonst dunkel.
 * Rendert KOMPLETT LOKAL (keine externen Dienste, kein SharePoint):
 *   Bild | PDF (alle Seiten, blaetterbar) | Excel (alle Blaetter) | Word (docx) | Text.
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
const PLACE_KEY = "docPreviewPlacement";

const blobCache = new Map();  // doc.id -> { url, blob }

async function getBlob(doc, url) {
  const c = blobCache.get(doc?.id);
  if (c && c.url === url) return c.blob;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("Download fehlgeschlagen (" + resp.status + ")");
  const blob = await resp.blob();
  blobCache.set(doc?.id, { url, blob });
  return blob;
}

function loadPlace() {
  try { const s = JSON.parse(localStorage.getItem(PLACE_KEY)); if (s && s.w >= MIN_W && s.h >= MIN_H) return s; } catch { /* ignore */ }
  return null;
}
function savePlace(b) { try { localStorage.setItem(PLACE_KEY, JSON.stringify({ w: b.w, h: b.h, left: b.left, top: b.top })); } catch { /* ignore */ } }

// Theme-Farben fuer Rahmen/Kopf/Inhalt.
function chrome(theme) {
  if (theme === "artis") return {
    border: "#4a7a4f", headBg: "#4a7a4f", headFg: "#ffffff", headBorder: "#3c6741",
    btn: "#d9ead9", btnHover: "#ffffff", body: "#eef3ee", fg: "#1f2a1f", faint: "#5d7a5d",
    cellBorder: "#cddccd", headerRow: "#dce9dc", rowAlt: "#f3f8f3",
    tabBar: "#e4efe4", tabActive: "#ffffff", tabActiveFg: "#1f2a1f", tabFg: "#5d7a5d", tabAccent: "#4a7a4f",
  };
  if (theme === "light") return {
    border: "#cfcfdf", headBg: "#ffffff", headFg: "#1a1a2e", headBorder: "#e6e6ee",
    btn: "#9a9ab0", btnHover: "#1a1a2e", body: "#f4f4f8", fg: "#1a1a2e", faint: "#7a7a9a",
    cellBorder: "#dcdce6", headerRow: "#e8e8f0", rowAlt: "#f7f7fb",
    tabBar: "#eeeef4", tabActive: "#ffffff", tabActiveFg: "#1a1a2e", tabFg: "#7a7a9a", tabAccent: "#7c3aed",
  };
  return {
    border: "#3a3a3a", headBg: "#222222", headFg: "#eeeeee", headBorder: "#333333",
    btn: "#999999", btnHover: "#ffffff", body: "#151515", fg: "#dddddd", faint: "#777777",
    cellBorder: "#2c2c2c", headerRow: "#252525", rowAlt: "#1b1b1b",
    tabBar: "#111111", tabActive: "#252525", tabActiveFg: "#ffffff", tabFg: "#888888", tabAccent: "#4a7a4f",
  };
}

export default function DocHoverPreview({ doc, url, rect, theme, onClose }) {
  const C = chrome(theme);
  const [st, setSt] = useState({ kind: "loading", payload: null, error: null });

  const pdfDocRef = useRef(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfNum, setPdfNum]   = useState(1);
  const [pdfImg, setPdfImg]   = useState(null);

  const [excel, setExcel] = useState(null);  // { sheets:[{name,rows}], active }
  const objUrlRef = useRef(null);

  // ── Fenster-Geometrie (verschiebbar + groessenverstellbar, gemerkt) ──
  const [box, setBox] = useState(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const saved = loadPlace();
    const w = saved?.w ?? 440, h = saved?.h ?? 540;
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      return { left: Math.max(8, Math.min(saved.left, vw - w - 8)), top: Math.max(8, Math.min(saved.top, vh - 40)), w, h };
    }
    let left = (rect?.left ?? 240) - w - 12;
    if (left < 8) left = Math.min((rect?.right ?? 8) + 12, vw - w - 8);
    left = Math.max(8, Math.min(left, vw - w - 8));
    const top = Math.max(8, Math.min((rect?.top ?? 100) - 30, vh - h - 8));
    return { left, top, w, h };
  });
  const boxRef = useRef(box);
  const dragRef = useRef(null);

  const onHeaderDown = (e) => { e.preventDefault(); dragRef.current = { mode: "move", sx: e.clientX, sy: e.clientY, box: { ...boxRef.current } }; attach(); };
  const onResizeDown = (e) => { e.preventDefault(); e.stopPropagation(); dragRef.current = { mode: "resize", sx: e.clientX, sy: e.clientY, box: { ...boxRef.current } }; attach(); };
  const attach = () => { document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp); };
  const onMove = (ev) => {
    const d = dragRef.current; if (!d) return;
    const dx = ev.clientX - d.sx, dy = ev.clientY - d.sy;
    setBox(() => {
      let nb;
      if (d.mode === "move") {
        const vw = window.innerWidth, vh = window.innerHeight;
        nb = { ...d.box, left: Math.max(8, Math.min(d.box.left + dx, vw - d.box.w - 8)), top: Math.max(8, Math.min(d.box.top + dy, vh - 40)) };
      } else {
        nb = { ...d.box, w: Math.max(MIN_W, d.box.w + dx), h: Math.max(MIN_H, d.box.h + dy) };
      }
      boxRef.current = nb;
      return nb;
    });
  };
  const onUp = () => {
    const d = dragRef.current;
    if (d) savePlace(boxRef.current);
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
    const name = (doc?.filename || doc?.name || "").toLowerCase();

    (async () => {
      try {
        if (doc?.file_size && doc?.file_size > MAX_BYTES) { if (!cancelled) setSt({ kind: "toobig" }); return; }
        const blob = await getBlob(doc, url);
        if (cancelled) return;

        if (/\.(png|jpe?g|webp|bmp|gif|svg)$/.test(name) || (blob.type || "").startsWith("image/")) {
          const o = URL.createObjectURL(blob); objUrlRef.current = o;
          if (!cancelled) setSt({ kind: "img", payload: o }); return;
        }
        if (name.endsWith(".pdf") || blob.type === "application/pdf") {
          const buf = await blob.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
          if (cancelled) return;
          pdfDocRef.current = pdf; setPdfNum(pdf.numPages); setPdfPage(1); setSt({ kind: "pdf" }); return;
        }
        if (/\.(xlsx|xls|xlsm|xlsb|ods|csv)$/.test(name)) {
          const { read, utils } = await import("xlsx");
          const buf = await blob.arrayBuffer();
          const wb = read(new Uint8Array(buf), { type: "array", cellDates: true });
          const sheets = wb.SheetNames.map(nm => ({ name: nm, rows: utils.sheet_to_json(wb.Sheets[nm], { header: 1, raw: false, defval: "" }).slice(0, 1000) }));
          if (!cancelled) { setExcel({ sheets, active: 0 }); setSt({ kind: "excel" }); } return;
        }
        if (/\.(docx|docm)$/.test(name)) {
          const buf = await blob.arrayBuffer();
          const mod = await import("mammoth/mammoth.browser");
          const mammoth = mod.default || mod;
          const { value } = await mammoth.convertToHtml({ arrayBuffer: buf });
          if (!cancelled) setSt({ kind: "word", payload: value || "" }); return;
        }
        if (/\.(txt|md|json|xml|log|csv)$/.test(name) || (blob.type || "").startsWith("text/")) {
          const txt = await blob.text();
          if (!cancelled) setSt({ kind: "text", payload: txt.slice(0, 12000) }); return;
        }
        if (!cancelled) setSt({ kind: "none" });
      } catch (e) {
        if (!cancelled) setSt({ kind: "error", error: e.message });
      }
    })();

    return () => { cancelled = true; if (objUrlRef.current) { URL.revokeObjectURL(objUrlRef.current); objUrlRef.current = null; } };
  }, [doc?.id, url]);

  // ── PDF-Seite rendern ──
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
      background: C.body, border: "1px solid " + C.border, borderRadius: 10,
      boxShadow: "0 14px 48px rgba(0,0,0,0.45)", overflow: "hidden",
      display: "flex", flexDirection: "column", color: C.fg,
    }}>
      {/* Kopf = Drag-Griff */}
      <div onMouseDown={onHeaderDown}
        style={{ flexShrink: 0, padding: "7px 8px 7px 12px", borderBottom: "1px solid " + C.headBorder,
          display: "flex", alignItems: "center", gap: 6, background: C.headBg, cursor: "move", userSelect: "none" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: C.headFg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {doc?.name || doc?.filename}
        </span>
        {st.kind === "pdf" && pdfNum > 1 && (
          <span onMouseDown={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 4, marginRight: 4 }}>
            <button onClick={() => setPdfPage(p => Math.max(1, p - 1))} disabled={pdfPage <= 1} style={navBtn(pdfPage > 1, C)}><ChevronLeft size={14} /></button>
            <span style={{ fontSize: 10, color: C.headFg, opacity: 0.85, minWidth: 54, textAlign: "center" }}>{pdfPage} / {pdfNum}</span>
            <button onClick={() => setPdfPage(p => Math.min(pdfNum, p + 1))} disabled={pdfPage >= pdfNum} style={navBtn(pdfPage < pdfNum, C)}><ChevronRight size={14} /></button>
          </span>
        )}
        <button onClick={onClose} onMouseDown={e => e.stopPropagation()} title="Schließen"
          style={{ background: "none", border: "none", cursor: "pointer", color: C.headFg, opacity: 0.75, display: "flex", padding: 2, borderRadius: 4 }}
          onMouseEnter={e => e.currentTarget.style.opacity = "1"}
          onMouseLeave={e => e.currentTarget.style.opacity = "0.75"}>
          <X size={15} />
        </button>
      </div>

      {/* Inhalt */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: C.body }}>
        {st.kind === "loading" && <Centered c={C}>Lade Vorschau…</Centered>}
        {st.kind === "toobig"  && <Centered c={C}>Datei zu groß für die Schnell-Vorschau<br/>(über 15 MB) – bitte herunterladen.</Centered>}
        {st.kind === "none"    && <Centered c={C}>Keine Vorschau für diesen Dateityp.</Centered>}
        {st.kind === "error"   && <Centered c={C}>⚠ {st.error}</Centered>}

        {st.kind === "img" && (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 10 }}>
            <img src={st.payload} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 4 }} />
          </div>
        )}

        {st.kind === "pdf" && (
          <div style={{ padding: 10, display: "flex", justifyContent: "center" }}>
            {pdfImg
              ? <img src={pdfImg} alt="" style={{ maxWidth: "100%", borderRadius: 3, boxShadow: "0 2px 12px rgba(0,0,0,0.3)" }} />
              : <span style={{ color: C.faint, fontSize: 12, padding: 30 }}>Seite wird gerendert…</span>}
          </div>
        )}

        {st.kind === "excel" && (
          <div style={{ overflow: "auto", padding: 4 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 11, color: C.fg }}>
              <tbody>
                {excelRows.map((row, ri) => (
                  <tr key={ri} style={{ background: ri === 0 ? C.headerRow : ri % 2 ? C.rowAlt : "transparent" }}>
                    {(row.length ? row : [""]).map((cell, ci) => (
                      <td key={ci} style={{ border: "1px solid " + C.cellBorder, padding: "2px 6px", whiteSpace: "nowrap",
                        maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", fontWeight: ri === 0 ? 600 : 400 }}>{String(cell ?? "")}</td>
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
          <pre style={{ margin: 0, padding: 12, fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", color: C.fg }}>{st.payload}</pre>
        )}
      </div>

      {/* Excel-Blatt-Tabs */}
      {st.kind === "excel" && excel && excel.sheets.length > 1 && (
        <div style={{ flexShrink: 0, display: "flex", borderTop: "1px solid " + C.headBorder, background: C.tabBar, overflowX: "auto" }}>
          {excel.sheets.map((sh, i) => (
            <button key={i} onClick={() => setExcel(e => ({ ...e, active: i }))}
              style={{ padding: "4px 12px", fontSize: 10, border: "none", cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
                borderRight: "1px solid " + C.cellBorder,
                background: i === excel.active ? C.tabActive : "transparent",
                color: i === excel.active ? C.tabActiveFg : C.tabFg,
                borderTop: `2px solid ${i === excel.active ? C.tabAccent : "transparent"}` }}>
              {sh.name}
            </button>
          ))}
        </div>
      )}

      {/* Resize-Griff unten rechts */}
      <div onMouseDown={onResizeDown} title="Größe ziehen"
        style={{ position: "absolute", right: 0, bottom: 0, width: 16, height: 16, cursor: "nwse-resize",
          background: `linear-gradient(135deg, transparent 50%, ${C.faint} 50%, ${C.faint} 60%, transparent 60%, transparent 72%, ${C.faint} 72%, ${C.faint} 82%, transparent 82%)` }} />
    </div>
  );
}

function navBtn(enabled, C) {
  return { background: "none", border: "none", cursor: enabled ? "pointer" : "default",
    color: C.headFg, opacity: enabled ? 0.85 : 0.35, display: "flex", padding: 2 };
}

function Centered({ children, c }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
      color: c?.faint || "#888", fontSize: 12, padding: 20 }}>{children}</div>
  );
}
