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
 * Die Liste ist eine echte Spaltenliste: Name, Kategorie, Jahr, Geaendert,
 * Groesse. Ein Klick auf den Spaltenkopf sortiert (auf, ab, dann wieder die
 * Reihenfolge der Seite). Welche Spalten Platz haben, entscheidet die Breite
 * der Listenspalte -- schmal bleibt nur der Name stehen.
 *
 * Die Metadaten werden direkt in der Spalte bearbeitet, nicht im Dialog:
 * tippen oder auswaehlen, dann Speichern (oder Strg+Enter). Esc verwirft.
 * Ist ein Dokument von jemand anderem ausgecheckt, bleibt alles gesperrt.
 *
 * Die Vorschau selbst ist DocPreviewContent -- derselbe Renderer wie im
 * Hover-Fenster (PDF, Excel, Word, Bild, Text; alles lokal).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, Lock, Pencil, Check,
  ChevronUp, ChevronDown, Loader2, X,
} from "lucide-react";
import DocPreviewContent, { previewChrome, Centered } from "./DocPreviewContent";
import TagSelectWidget from "./TagSelectWidget";
import { prettyDisplayName } from "@/lib/docFileName";

const WIDTH_KEY = "dokPanelWidths";
const META_KEY  = "dokPanelMetaOpen";
const SORT_KEY  = "dokPanelSort";
const MIN_LIST = 220, MIN_META = 200, MIN_PREVIEW = 260;

function loadWidths() {
  try {
    const v = JSON.parse(localStorage.getItem(WIDTH_KEY));
    if (v && v.list >= MIN_LIST && v.meta >= MIN_META) return v;
  } catch { /* ignore */ }
  return { list: 460, meta: 300 };
}

// ── Spalten der Liste ────────────────────────────────────────────────────
// need = ab welcher Breite der Listenspalte die Spalte eingeblendet wird.
const COLUMNS = [
  { key: "name", label: "Name",     width: "minmax(0,1fr)", need: 0,   align: "left"  },
  { key: "cat",  label: "Kategorie", width: "96px",         need: 470, align: "left"  },
  { key: "year", label: "Jahr",     width: "46px",          need: 300, align: "right" },
  { key: "upd",  label: "Geändert", width: "92px",          need: 380, align: "right" },
  { key: "size", label: "Grösse",   width: "62px",          need: 560, align: "right" },
];

function loadSort() {
  try {
    const v = JSON.parse(localStorage.getItem(SORT_KEY));
    if (v && COLUMNS.some(c => c.key === v.key) && (v.dir === "asc" || v.dir === "desc")) return v;
  } catch { /* ignore */ }
  return null;   // null = Reihenfolge der Seite (deren Sortier-Menue)
}

const fmtDate  = (v) => v ? new Date(v).toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" }) : "—";
const fmtDay   = (v) => v ? new Date(v).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";
const fmtSize  = (b) => !b ? "—" : b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(0) + " KB" : (b / 1048576).toFixed(1) + " MB";

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
  onEditDoc,              // (doc) => void   Bearbeiten-Dialog (alle Felder)
  onSaveMeta,             // async (doc, patch) => boolean   Inline-Speichern
  filterTagsForCategory,  // (allTags, category) => Tag[]
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
  const [sort, setSort]         = useState(loadSort);
  const wrapRef = useRef(null);
  const dragRef = useRef(null);
  // Merkt, ob in der Metadaten-Spalte etwas Ungespeichertes steht. Ohne das
  // waere ein Klick auf die naechste Zeile ein stiller Verlust der Eingaben.
  const metaDirty = useRef(false);

  const selectDoc = (id) => {
    if (id === selId) return;
    if (metaDirty.current &&
        !window.confirm("Die Metadaten wurden geändert und noch nicht gespeichert. Änderungen verwerfen?")) return;
    metaDirty.current = false;
    setSelId(id);
  };

  const catLabel = useCallback((key) => {
    const c = categories.find(x => x.key === key);
    return c ? c.label : (key || "");
  }, [categories]);

  // Sortierung der Liste. Ohne eigene Spalten-Sortierung bleibt die
  // Reihenfolge, die die Seite liefert (deren Sortier-Menue).
  const rows = useMemo(() => {
    if (!sort) return docs;
    const dir = sort.dir === "desc" ? -1 : 1;
    const val = (d) => {
      switch (sort.key) {
        case "cat":  return catLabel(d.category);
        case "year": return d.year || 0;
        case "upd":  return new Date(d.updated_at || d.created_at || 0).getTime();
        case "size": return d.file_size || 0;
        default:     return prettyDisplayName(d);
      }
    };
    return [...docs].sort((a, b) => {
      const x = val(a), y = val(b);
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      return String(x).localeCompare(String(y), "de-CH", { numeric: true, sensitivity: "base" }) * dir;
    });
  }, [docs, sort, catLabel]);

  const selected = useMemo(() => rows.find(d => d.id === selId) || null, [rows, selId]);

  // Sichtbare Spalten nach verfuegbarer Breite.
  const visibleCols = useMemo(() => COLUMNS.filter(c => widths.list >= c.need), [widths.list]);
  const gridCols = useMemo(
    () => visibleCols.map(c => c.width).join(" ") + " 16px",   // letzte Spalte: Schloss
    [visibleCols],
  );

  const toggleSort = (key) => {
    setSort(prev => {
      const next = !prev || prev.key !== key ? { key, dir: "asc" }
                 : prev.dir === "asc"        ? { key, dir: "desc" }
                 : null;
      try {
        if (next) localStorage.setItem(SORT_KEY, JSON.stringify(next));
        else localStorage.removeItem(SORT_KEY);
      } catch { /* ignore */ }
      return next;
    });
  };

  // Erste Zeile automatisch waehlen, und bei Filterwechsel nachziehen, wenn das
  // bisher gewaehlte Dokument nicht mehr in der Liste steht.
  useEffect(() => {
    if (!rows.length) { setSelId(null); return; }
    if (!rows.some(d => d.id === selId)) setSelId(rows[0].id);
  }, [rows, selId]);

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
    const i = rows.findIndex(d => d.id === selId);
    const next = e.key === "ArrowDown" ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
    if (rows[next]) selectDoc(rows[next].id);
  };

  const { kind, pdfPage, pdfNum, setPdfPage, excel, setExcel } = pv;

  const cellStyle = (col) => ({
    minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    textAlign: col.align, fontSize: col.key === "name" ? 12 : 11,
  });

  return (
    <div ref={wrapRef} style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>

      {/* ── Spalte 1: Liste ─────────────────────────────────────────── */}
      <div style={{ width: widths.list, flexShrink: 0, display: "flex", flexDirection: "column",
        minWidth: 0, borderRight: "1px solid " + border }}>

        {/* Spaltenkoepfe -- Klick sortiert (auf, ab, Reihenfolge der Seite) */}
        <div style={{ flexShrink: 0, display: "grid", gridTemplateColumns: gridCols, gap: 8,
          padding: "5px 10px", borderBottom: "1px solid " + border,
          background: s.sidebarBg || s.inputBg, userSelect: "none" }}>
          {visibleCols.map(col => {
            const active = sort?.key === col.key;
            return (
              <button key={col.key} onClick={() => toggleSort(col.key)}
                title={active
                  ? (sort.dir === "asc" ? "Absteigend sortieren" : "Sortierung aufheben")
                  : "Nach " + col.label + " sortieren"}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0,
                  display: "flex", alignItems: "center", gap: 2, minWidth: 0,
                  justifyContent: col.align === "right" ? "flex-end" : "flex-start",
                  color: active ? accent : s.textMuted, fontSize: 10, fontWeight: active ? 700 : 600,
                  letterSpacing: 0.3, textTransform: "uppercase" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{col.label}</span>
                {active && (sort.dir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
              </button>
            );
          })}
          <span />
        </div>

        {/* Zeilen */}
        <div tabIndex={0} onKeyDown={onListKey} style={{ flex: 1, minHeight: 0, overflowY: "auto", outline: "none" }}>
          {rows.length === 0 ? (
            <div style={{ padding: 20, fontSize: 12, color: s.textMuted, textAlign: "center" }}>
              Keine Dokumente in diesem Ordner
            </div>
          ) : rows.map(doc => {
            const fi   = getFileInfo(doc.file_type, doc.filename);
            const isSel = doc.id === selId;
            const locked = !!doc.checked_out_by;
            const mine   = doc.checked_out_by === user?.id;
            const cell = (col) => {
              switch (col.key) {
                case "cat":  return catLabel(doc.category) || "—";
                case "year": return doc.year || "—";
                case "upd":  return fmtDay(doc.updated_at || doc.created_at);
                case "size": return fmtSize(doc.file_size);
                default:     return null;
              }
            };
            return (
              <div key={doc.id} data-doc-id={doc.id}
                onClick={() => selectDoc(doc.id)}
                onDoubleClick={() => onOpenDoc?.(doc)}
                title={prettyDisplayName(doc)}
                style={{ display: "grid", gridTemplateColumns: gridCols, gap: 8, alignItems: "center",
                  padding: "7px 10px", borderBottom: "1px solid " + border + "44", cursor: "pointer",
                  background: isSel ? accent + "1f" : (doc.id === highlightDocId ? accent + "12" : "transparent"),
                  boxShadow: isSel ? "inset 3px 0 0 " + accent : "none" }}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = s.rowHover; }}
                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = doc.id === highlightDocId ? accent + "12" : "transparent"; }}>
                {visibleCols.map(col => col.key === "name" ? (
                  <span key={col.key} style={{ ...cellStyle(col), display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ background: fi.color, color: "#fff", borderRadius: 4, padding: "2px 4px",
                      fontSize: 9, fontWeight: 700, flexShrink: 0, minWidth: 32, textAlign: "center" }}>{fi.label}</span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      color: s.textMain, fontWeight: isSel ? 600 : 400 }}>
                      {prettyDisplayName(doc)}
                    </span>
                  </span>
                ) : (
                  <span key={col.key} style={{ ...cellStyle(col), color: s.textMuted }}>{cell(col)}</span>
                ))}
                <span style={{ display: "flex", justifyContent: "center" }}>
                  {locked && (
                    <Lock size={11} style={{ flexShrink: 0, color: mine ? accent : "#f59e0b" }}
                      title={"Ausgecheckt von " + (doc.checked_out_by_name || "")} />
                  )}
                </span>
              </div>
            );
          })}
        </div>
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
            <MetaColumn key={selected.id} doc={selected} s={s} border={border} accent={accent}
              allTags={allTags} categories={categories} user={user}
              onEditDoc={onEditDoc} onSaveMeta={onSaveMeta}
              filterTagsForCategory={filterTagsForCategory}
              onDirtyChange={(v) => { metaDirty.current = v; }} />
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

// ── Metadaten-Spalte: direkt bearbeitbar ───────────────────────────────
// Wird per key={doc.id} neu aufgebaut, darum startet der Entwurf immer sauber
// beim gewaehlten Dokument.
function MetaColumn({ doc, s, border, accent, allTags, categories, user, onEditDoc, onSaveMeta, filterTagsForCategory, onDirtyChange }) {
  const lockedByOther = !!doc.checked_out_by && doc.checked_out_by !== user?.id;
  const readOnly = lockedByOther || !onSaveMeta;

  const [name,     setName]     = useState(doc.name || "");
  const [category, setCategory] = useState(doc.category || "");
  const [year,     setYear]     = useState(doc.year ? String(doc.year) : "");
  const [tagIds,   setTagIds]   = useState(doc.tag_ids || []);
  const [notes,    setNotes]    = useState(doc.notes || "");
  const [saving,   setSaving]   = useState(false);

  // Tags auf die gewaehlte Kategorie einschraenken -- gleiche Regel wie im Dialog.
  const filteredTags = useMemo(
    () => (filterTagsForCategory ? filterTagsForCategory(allTags, category) : allTags),
    [allTags, category, filterTagsForCategory],
  );

  const sameTags = (a, b) => a.length === b.length && a.every(x => b.includes(x));
  const dirty =
    name !== (doc.name || "") ||
    category !== (doc.category || "") ||
    year !== (doc.year ? String(doc.year) : "") ||
    notes !== (doc.notes || "") ||
    !sameTags(tagIds, doc.tag_ids || []);

  // Der Panel meldet beim Zeilenwechsel eine Rueckfrage, wenn hier etwas offen ist.
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const reset = () => {
    setName(doc.name || "");
    setCategory(doc.category || "");
    setYear(doc.year ? String(doc.year) : "");
    setTagIds(doc.tag_ids || []);
    setNotes(doc.notes || "");
  };

  // Kategorie gewechselt: Tags wegnehmen, die dort nicht mehr hingehoeren.
  const chooseCategory = (key) => {
    setCategory(key);
    const valid = new Set((filterTagsForCategory ? filterTagsForCategory(allTags, key) : allTags).map(t => t.id));
    setTagIds(prev => prev.filter(id => valid.has(id)));
  };

  // Pflichtfelder: Speichern bleibt gesperrt, statt eine Meldung zu werfen.
  const invalid = !name.trim() || !year || isNaN(parseInt(year));

  const save = async () => {
    if (!dirty || saving || invalid) return;
    setSaving(true);
    // Fehlermeldung und Neuladen der Liste macht die Seite (onSaveMeta).
    await onSaveMeta(doc, {
      name: name.trim(),
      category,
      year: parseInt(year),
      tag_ids: tagIds,
      notes,
    });
    setSaving(false);
  };

  const onKey = (e) => {
    if (e.key === "Escape" && dirty) { e.preventDefault(); reset(); }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!invalid) save(); }
  };

  const inp = {
    background: readOnly ? "transparent" : s.inputBg,
    border: "1px solid " + (readOnly ? "transparent" : (s.inputBorder || border)),
    color: s.textMain, borderRadius: 6, padding: "4px 7px", fontSize: 12, width: "100%", outline: "none",
  };

  return (
    <div style={{ padding: "10px 12px", paddingBottom: dirty ? 58 : 12 }} onKeyDown={onKey}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: 0.3, textTransform: "uppercase" }}>Metadaten</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => onEditDoc?.(doc)} title="Alle Felder im Dialog (auch Kunde wechseln)"
          style={{ background: "none", border: "1px solid " + border, borderRadius: 6, cursor: "pointer",
            color: s.textMuted, display: "flex", alignItems: "center", gap: 4, padding: "2px 7px", fontSize: 11 }}>
          <Pencil size={11} /> Alle Felder
        </button>
      </div>

      {lockedByOther && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, padding: "5px 8px",
          borderRadius: 6, background: "#f59e0b1f", color: "#b45309", fontSize: 11 }}>
          <Lock size={12} />
          Ausgecheckt von {doc.checked_out_by_name || "jemand anderem"} — schreibgeschützt.
        </div>
      )}

      <Field label="Dokument Name" s={s}>
        <input value={name} onChange={e => setName(e.target.value)} readOnly={readOnly} style={inp} />
      </Field>

      <Field label="Kategorie" s={s}>
        <select value={category} onChange={e => chooseCategory(e.target.value)} disabled={readOnly}
          style={{ ...inp, cursor: readOnly ? "default" : "pointer" }}>
          <option value="">— keine —</option>
          {categories.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
        </select>
      </Field>

      <Field label="Jahr" s={s}>
        <input type="number" value={year} onChange={e => setYear(e.target.value)} readOnly={readOnly}
          style={{ ...inp, width: 90 }} />
      </Field>

      <Field label="Schlagworte" s={s}>
        {readOnly ? (
          <TagChips tagIds={tagIds} allTags={allTags} accent={accent} />
        ) : (
          <TagSelectWidget value={tagIds} onChange={setTagIds} allTags={filteredTags}
            s={s} border={border} accent={accent} />
        )}
      </Field>

      <Field label="Bemerkung" s={s}>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} readOnly={readOnly} rows={3}
          style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} />
      </Field>

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

      {/* Speicherleiste -- erscheint erst, wenn wirklich etwas geaendert wurde */}
      {dirty && !readOnly && (
        <div style={{ position: "sticky", bottom: 0, marginTop: 12, marginLeft: -12, marginRight: -12,
          padding: "8px 12px", borderTop: "1px solid " + border, background: s.sidebarBg || s.inputBg,
          display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={save} disabled={saving || invalid}
            title={invalid ? "Name und Jahr sind Pflicht" : "Speichern (Strg+Enter)"}
            style={{ background: invalid ? border : accent, color: "#fff", border: "none", borderRadius: 6,
              padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: saving || invalid ? "default" : "pointer",
              display: "flex", alignItems: "center", gap: 5, opacity: saving ? 0.7 : 1 }}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Speichern
          </button>
          <button onClick={reset} disabled={saving} title="Änderungen verwerfen (Esc)"
            style={{ background: "none", border: "1px solid " + border, color: s.textMuted, borderRadius: 6,
              padding: "5px 10px", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
            <X size={12} /> Verwerfen
          </button>
          {invalid && <span style={{ fontSize: 10, color: "#ef4444" }}>Name und Jahr sind Pflicht</span>}
        </div>
      )}
    </div>
  );
}

function TagChips({ tagIds, allTags, accent }) {
  const tags = (tagIds || []).map(id => allTags.find(t => t.id === id)).filter(Boolean);
  if (!tags.length) return <span style={{ fontSize: 12 }}>—</span>;
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {tags.map(t => (
        <span key={t.id} style={{ fontSize: 10, background: (t.color || accent) + "22",
          color: t.color || accent, border: "1px solid " + (t.color || accent) + "55",
          borderRadius: 8, padding: "1px 7px" }}>{t.name}</span>
      ))}
    </span>
  );
}

// Feld mit Beschriftung darueber (Eingaben brauchen mehr Platz als reiner Text).
function Field({ label, children, s }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: s.textMuted, marginBottom: 3 }}>{label}</div>
      {children}
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
