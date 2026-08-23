/**
 * DocHoverPreview.jsx — Vorschau-Fenster (oeffnet beim Hover ueber das Augen-Symbol).
 *
 * Bleibt offen, per Kopfzeile VERSCHIEBBAR, an der Ecke GROESSENVERSTELLBAR
 * (Groesse + Position werden in localStorage gemerkt), Schliessen per ×.
 * Theme-abhaengiger Rahmen: artis = gruen, light = weiss, sonst dunkel.
 *
 * Der eigentliche Inhalt kommt aus DocPreviewContent -- demselben Renderer,
 * den auch die angedockte Panel-Ansicht benutzt. Hier drin steckt nur noch die
 * Fenster-Mechanik (Verschieben, Groesse, Kopfleiste).
 */
import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import DocPreviewContent, { previewChrome } from "./DocPreviewContent";

const MIN_W = 280, MIN_H = 220;
const PLACE_KEY = "docPreviewPlacement";

function loadPlace() {
  try { const s = JSON.parse(localStorage.getItem(PLACE_KEY)); if (s && s.w >= MIN_W && s.h >= MIN_H) return s; } catch { /* ignore */ }
  return null;
}
function savePlace(b) { try { localStorage.setItem(PLACE_KEY, JSON.stringify({ w: b.w, h: b.h, left: b.left, top: b.top })); } catch { /* ignore */ } }

export default function DocHoverPreview({ doc, url, rect, theme, onClose }) {
  const C = previewChrome(theme);

  // Zustand des Renderers (Dateityp, PDF-Seiten, Excel-Blaetter) fuer die Kopfleiste.
  const [pv, setPv] = useState({ kind: "loading", pdfPage: 1, pdfNum: 1, setPdfPage: null, excel: null, setExcel: null });

  // Esc schließt das Fenster — auch als Rettung, falls mal etwas hakt.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  const { kind, pdfPage, pdfNum, setPdfPage, excel, setExcel } = pv;

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
        {/* Blaettern: PDF-Seiten und PowerPoint-Folien teilen sich dieselbe Leiste. */}
          {(kind === "pdf" || kind === "pptx") && pdfNum > 1 && (
          <span onMouseDown={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 4, marginRight: 4 }}>
            <button onClick={() => setPdfPage?.(p => Math.max(1, p - 1))} disabled={pdfPage <= 1} style={navBtn(pdfPage > 1, C)}><ChevronLeft size={14} /></button>
            <span style={{ fontSize: 10, color: C.headFg, opacity: 0.85, minWidth: 54, textAlign: "center" }}>{pdfPage} / {pdfNum}</span>
            <button onClick={() => setPdfPage?.(p => Math.min(pdfNum, p + 1))} disabled={pdfPage >= pdfNum} style={navBtn(pdfPage < pdfNum, C)}><ChevronRight size={14} /></button>
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
        <DocPreviewContent doc={doc} url={url} C={C} onStatus={setPv} />
      </div>

      {/* Excel-Blatt-Tabs */}
      {kind === "excel" && excel && excel.sheets.length > 1 && (
        <div style={{ flexShrink: 0, display: "flex", borderTop: "1px solid " + C.headBorder, background: C.tabBar, overflowX: "auto" }}>
          {excel.sheets.map((sh, i) => (
            <button key={i} onClick={() => setExcel?.(e => ({ ...e, active: i }))}
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
