/**
 * DocPanelView.jsx — dreispaltige Panel-Ansicht im e-Binder (M-Files-Stil).
 *
 *   Liste  |  Metadaten  |  Vorschau
 *
 * Ein Klick auf eine Zeile fuellt Metadaten UND Vorschau -- nichts oeffnet
 * sich als Fenster ueber der Seite. Die beiden Trenner lassen sich ziehen,
 * die Breiten werden pro Geraet gemerkt; die mittlere Spalte laesst sich
 * zuklappen, dann bleiben Liste + Vorschau.
 *
 * Die Vorschau selbst ist DocPreviewContent -- derselbe Renderer wie im
 * Hover-Fenster (PDF, Excel, Word, Bild, Text; alles lokal).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, Lock, Pencil, Check,
} from "lucide-react";
import DocPreviewContent, { previewChrome, Centered } from "./DocPreviewContent";
import { prettyDisplayName } from "@/lib/docFileName";

const WIDTH_KEY = "dokPanelWidths";
const META_KEY  = "dokPanelMetaOpen";
const MIN_LIST = 220, MIN_META = 200, MIN_PREVIEW = 260;

function loadWidths() {
  try {
    const v = JSON.parse(localStorage.getItem(WIDTH_KEY));
    if (v && v.list >= MIN_LIST && v.meta >= MIN_META) return v;
  } catch { /* ignore */ }
  return { list: 320, meta: 300 };
}

export default function DocPanelView({
  docs,
  theme,
  s,
  border,
  accent,
  allTags = [],
  categories = [],
  user,
  getFileInfo,
  getPreviewUrl,          // async (doc) => signedUrl | null
  onOpenDoc,              // (doc) => void   Auschecken / Oeffnen
  onEditDoc,              // (doc) => void   Bearbeiten-Dialog
  renderActions,          // (doc) => ReactNode  Aktionsleiste der Zeile
  highlightDocId,
}) {
  const C = previewChrome(theme);

  const [selId, setSelId] = useState(null);
  const [url, setUrl]     = useState(null);
  const [urlBusy, setUrlBusy] = useState(false);
  const [pv, setPv]       = useState({ kind: "idle", pdfPage: 1, pdfNum: 1, setPdfPage: null, excel: null, setExcel: null });

  const [widths, setWidths]   = useState(loadWidths);
  const [metaOpen, setMetaOpen] = useState(() => localStorage.getItem(META_KEY) !== "0");
  const wrapRef = useRef(null);
  const dragRef = useRef(null);

  const selected = useMemo(() => docs.find(d => d.id === selId) || null, [docs, selId]);

  // Erste Zeile automatisch waehlen, und bei Filterwechsel nachziehen, wenn das
  // bisher gewaehlte Dokument nicht mehr in der Liste steht.
  useEffect(() => {
    if (!docs.length) { setSelId(null); return; }
    if (!docs.some(d => d.id === selId)) setSelId(docs[0].id);
  }, [docs, selId]);

  // Signed URL fuer das gewaehlte Dokument holen.
  useEffect(() => {
    let cancelled = false;
    if (!selected?.storage_path) { setUrl(null); return; }
    setUrlBusy(true);
    (async () => {
      const u = await getPreviewUrl(selected);
      if (!cancelled) { setUrl(u || null); setUrlBusy(false); }
    })();
    return () => { cancelled = true; };
  }, [selected?.id, selected?.storage_path, getPreviewUrl]);

  // ── Trenner ziehen ──
  const startDrag = (which) => (e) => {
    e.preventDefault();
    dragRef.current = { which, sx: e.clientX, start: { ...widths } };
    document.addEventListener("mousemove", onDrag);
    document.addEventListener("mouseup", endDrag);
  };
  const onDrag = useCallback((ev) => {
    const d = dragRef.current; if (!d) return;
    const total = wrapRef.current?.clientWidth || 1200;
    const dx = ev.clientX - d.sx;
    setWidths(() => {
      const next = { ...d.start };
      if (d.which === "list") {
        next.list = Math.max(MIN_LIST, d.start.list + dx);
        const rest = total - next.list - (metaOpen ? next.meta : 0);
        if (rest < MIN_PREVIEW) next.list = Math.max(MIN_LIST, total - (metaOpen ? next.meta : 0) - MIN_PREVIEW);
      } else {
        next.meta = Math.max(MIN_META, d.start.meta + dx);
        const rest = total - next.list - next.meta;
        if (rest < MIN_PREVIEW) next.meta = Math.max(MIN_META, total - next.list - MIN_PREVIEW);
      }
      return next;
    });
  }, [metaOpen]);
  const endDrag = useCallback(() => {
    dragRef.current = null;
    document.removeEventListener("mousemove", onDrag);
    document.removeEventListener("mouseup", endDrag);
    setWidths(w => { try { localStorage.setItem(WIDTH_KEY, JSON.stringify(w)); } catch { /* ignore */ } return w; });
  }, [onDrag]);
  useEffect(() => () => endDrag(), [endDrag]);

  const toggleMeta = () => setMetaOpen(v => {
    const n = !v;
    try { localStorage.setItem(META_KEY, n ? "1" : "0"); } catch { /* ignore */ }
    return n;
  });

  // Pfeiltasten blaettern durch die Liste (wie in M-Files).
  const onListKey = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = docs.findIndex(d => d.id === selId);
    const next = e.key === "ArrowDown" ? Math.min(docs.length - 1, i + 1) : Math.max(0, i - 1);
    if (docs[next]) setSelId(docs[next].id);
  };

  const { kind, pdfPage, pdfNum, setPdfPage, excel, setExcel } = pv;

  return (
    <div ref={wrapRef} style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>

      {/* ── Spalte 1: Liste ─────────────────────────────────────────── */}
      <div tabIndex={0} onKeyDown={onListKey}
        style={{ width: widths.list, flexShrink: 0, overflowY: "auto", outline: "none",
          borderRight: "1px solid " + border }}>
        {docs.length === 0 ? (
          <div style={{ padding: 20, fontSize: 12, color: s.textMuted, textAlign: "center" }}>
            Keine Dokumente in diesem Ordner
          </div>
        ) : docs.map(doc => {
          const fi   = getFileInfo(doc.file_type, doc.filename);
          const isSel = doc.id === selId;
          const locked = !!doc.checked_out_by;
          const mine   = doc.checked_out_by === user?.id;
          return (
            <div key={doc.id} data-doc-id={doc.id}
              onClick={() => setSelId(doc.id)}
              onDoubleClick={() => onOpenDoc?.(doc)}
              title={prettyDisplayName(doc)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                borderBottom: "1px solid " + border + "44", cursor: "pointer",
                background: isSel ? accent + "1f" : (doc.id === highlightDocId ? accent + "12" : "transparent"),
                boxShadow: isSel ? "inset 3px 0 0 " + accent : "none" }}
              onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = s.rowHover; }}
              onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = doc.id === highlightDocId ? accent + "12" : "transparent"; }}>
              <span style={{ background: fi.color, color: "#fff", borderRadius: 4, padding: "2px 4px",
                fontSize: 9, fontWeight: 700, flexShrink: 0, minWidth: 32, textAlign: "center" }}>{fi.label}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: s.textMain,
                fontWeight: isSel ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {prettyDisplayName(doc)}
              </span>
              {locked && (
                <Lock size={11} style={{ flexShrink: 0, color: mine ? accent : "#f59e0b" }}
                  title={"Ausgecheckt von " + (doc.checked_out_by_name || "")} />
              )}
            </div>
          );
        })}
      </div>

      <Splitter onMouseDown={startDrag("list")} border={border} accent={accent} />

      {/* ── Spalte 2: Metadaten ─────────────────────────────────────── */}
      {metaOpen && (<>
        <div style={{ width: widths.meta, flexShrink: 0, overflowY: "auto", borderRight: "1px solid " + border,
          background: s.sidebarBg || "transparent" }}>
          {!selected ? (
            <div style={{ padding: 20, fontSize: 12, color: s.textMuted, textAlign: "center" }}>
              Kein Dokument gewählt
            </div>
          ) : (
            <MetaColumn doc={selected} s={s} border={border} accent={accent}
              allTags={allTags} categories={categories} onEditDoc={onEditDoc} />
          )}
        </div>
        <Splitter onMouseDown={startDrag("meta")} border={border} accent={accent} />
      </>)}

      {/* ── Spalte 3: Vorschau ──────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: C.body }}>
        {/* Kopfleiste der Vorschau */}
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6,
          padding: "5px 8px 5px 10px", borderBottom: "1px solid " + C.headBorder, background: C.headBg }}>
          <button onClick={toggleMeta} title={metaOpen ? "Metadaten ausblenden" : "Metadaten einblenden"}
            style={{ background: "none", border: "none", cursor: "pointer", color: C.headFg, opacity: 0.8, display: "flex", padding: 2 }}>
            {metaOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
          </button>
          <span style={{ fontSize: 11, fontWeight: 600, color: C.headFg, flex: 1,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {selected ? prettyDisplayName(selected) : "Vorschau"}
          </span>
          {kind === "pdf" && pdfNum > 1 && (
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button onClick={() => setPdfPage?.(p => Math.max(1, p - 1))} disabled={pdfPage <= 1} style={navBtn(pdfPage > 1, C)}><ChevronLeft size={14} /></button>
              <span style={{ fontSize: 10, color: C.headFg, opacity: 0.85, minWidth: 54, textAlign: "center" }}>{pdfPage} / {pdfNum}</span>
              <button onClick={() => setPdfPage?.(p => Math.min(pdfNum, p + 1))} disabled={pdfPage >= pdfNum} style={navBtn(pdfPage < pdfNum, C)}><ChevronRight size={14} /></button>
            </span>
          )}
        </div>

        {/* Inhalt */}
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {!selected ? (
            <Centered c={C}>Dokument in der Liste anklicken</Centered>
          ) : !selected.storage_path ? (
            <Centered c={C}>Für dieses Dokument liegt keine Datei im Speicher.</Centered>
          ) : urlBusy && !url ? (
            <Centered c={C}>Lade Vorschau…</Centered>
          ) : (
            <DocPreviewContent doc={selected} url={url} C={C} onStatus={setPv} pdfScale={2} />
          )}
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

        {/* Aktionsleiste zum gewaehlten Dokument */}
        {selected && renderActions && (
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 2, justifyContent: "flex-end",
            padding: "4px 8px", borderTop: "1px solid " + C.headBorder, background: C.tabBar }}>
            {renderActions(selected)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Metadaten-Spalte ───────────────────────────────────────────────────
function MetaColumn({ doc, s, border, accent, allTags, categories, onEditDoc }) {
  const cat  = categories.find(c => c.key === doc.category);
  const tags = (doc.tag_ids || []).map(id => allTags.find(t => t.id === id)).filter(Boolean);
  const fmtDate = (v) => v ? new Date(v).toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" }) : "—";
  const fmtSize = (b) => !b ? "—" : b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(0) + " KB" : (b / 1048576).toFixed(1) + " MB";

  return (
    <div style={{ padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: 0.3, textTransform: "uppercase" }}>Metadaten</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => onEditDoc?.(doc)} title="Bearbeiten"
          style={{ background: "none", border: "1px solid " + border, borderRadius: 6, cursor: "pointer",
            color: s.textMuted, display: "flex", alignItems: "center", gap: 4, padding: "2px 7px", fontSize: 11 }}>
          <Pencil size={11} /> Bearbeiten
        </button>
      </div>

      <Row label="Dokument Name" s={s}><span style={{ wordBreak: "break-word" }}>{prettyDisplayName(doc)}</span></Row>
      <Row label="Kategorie" s={s}>{cat ? (cat.icon + " " + cat.label) : (doc.category || "—")}</Row>
      <Row label="Jahr" s={s}>{doc.year || "—"}</Row>
      <Row label="Schlagworte" s={s}>
        {tags.length === 0 ? "—" : (
          <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {tags.map(t => (
              <span key={t.id} style={{ fontSize: 10, background: (t.color || accent) + "22",
                color: t.color || accent, border: "1px solid " + (t.color || accent) + "55",
                borderRadius: 8, padding: "1px 7px" }}>{t.name}</span>
            ))}
          </span>
        )}
      </Row>
      <Row label="Bemerkung" s={s}><span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{doc.notes || "—"}</span></Row>

      <div style={{ height: 1, background: border, margin: "12px 0" }} />

      <Row label="Dateiname" s={s} muted><span style={{ wordBreak: "break-all" }}>{doc.filename || "—"}</span></Row>
      <Row label="Grösse" s={s} muted>{fmtSize(doc.file_size)}</Row>
      <Row label="Erstellt" s={s} muted>{fmtDate(doc.created_at)}</Row>
      <Row label="Geändert" s={s} muted>{fmtDate(doc.updated_at)}</Row>
      <Row label="Status" s={s} muted>
        {doc.checked_out_by
          ? <span style={{ color: "#f59e0b", display: "flex", alignItems: "center", gap: 4 }}><Lock size={11} /> {doc.checked_out_by_name || "ausgecheckt"}</span>
          : <span style={{ color: "#10b981", display: "flex", alignItems: "center", gap: 4 }}><Check size={11} /> eingecheckt</span>}
      </Row>
    </div>
  );
}

function Row({ label, children, s, muted }) {
  return (
    <div style={{ display: "flex", gap: 8, padding: "3px 0", alignItems: "flex-start" }}>
      <span style={{ width: 105, flexShrink: 0, fontSize: 11, color: s.textMuted, paddingTop: 1 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: muted ? s.textMuted : s.textMain }}>{children}</span>
    </div>
  );
}

function Splitter({ onMouseDown, border, accent }) {
  return (
    <div onMouseDown={onMouseDown} title="Breite ziehen"
      style={{ width: 5, flexShrink: 0, cursor: "col-resize", background: "transparent" }}
      onMouseEnter={e => e.currentTarget.style.background = accent + "55"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"} />
  );
}

function navBtn(enabled, C) {
  return { background: "none", border: "none", cursor: enabled ? "pointer" : "default",
    color: C.headFg, opacity: enabled ? 0.85 : 0.35, display: "flex", padding: 2 };
}
