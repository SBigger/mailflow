import React, { useState, useMemo, useEffect, useContext, useRef } from "react";
import { Upload, Search, X, Download, Trash2, ChevronDown, ChevronRight, FolderOpen, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeContext } from "@/Layout";
import { supabase, entities } from "@/api/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const BUCKET = "dokumente";

const CATEGORIES = [
  { key: "betriebswirtschaft", label: "Betriebswirtschaft", icon: "📊" },
  { key: "steuern",            label: "Steuern",            icon: "💰" },
  { key: "mwst",               label: "MWST",               icon: "🧾" },
  { key: "personal",           label: "Personal",           icon: "👥" },
  { key: "korrespondenz",      label: "Korrespondenz",      icon: "✉️" },
];

function getFileInfo(mimeType, filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  if (mimeType === "application/pdf" || ext === "pdf")
    return { label: "PDF", color: "#dc2626" };
  if (mimeType?.includes("spreadsheet") || ["xls","xlsx","csv"].includes(ext))
    return { label: "XLS", color: "#16a34a" };
  if (mimeType?.includes("word") || ["doc","docx"].includes(ext))
    return { label: "DOC", color: "#2563eb" };
  if (mimeType?.startsWith("image/"))
    return { label: "IMG", color: "#7c3aed" };
  if (["zip","rar","7z"].includes(ext))
    return { label: "ZIP", color: "#d97706" };
  return { label: ext.toUpperCase() || "FILE", color: "#71717a" };
}

function detectYear(filename) {
  const m = (filename || "").match(/\b(20\d{2})\b/);
  return m ? parseInt(m[1]) : null;
}

function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

const TAG_PALETTE = [
  "#7c3aed","#2563eb","#0891b2","#059669","#d97706","#dc2626","#db2777","#4f46e5",
];
function tagColor(tag) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) & 0xffff;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

// ─── Upload-Dialog ────────────────────────────────────────────────────────────
function UploadDialog({ dialog, onChange, onCancel, onUpload, uploading, s, border, accent }) {
  const inp = {
    background: s.inputBg || s.cardBg,
    border: "1px solid " + (s.inputBorder || border),
    color: s.textMain, borderRadius: 6, padding: "5px 8px",
    fontSize: 13, width: "100%", outline: "none",
  };

  const addTag = () => {
    const t = (dialog.tagInput || "").trim().replace(/,+$/, "");
    if (t && !(dialog.tags || []).includes(t))
      onChange({ ...dialog, tags: [...(dialog.tags || []), t], tagInput: "" });
    else
      onChange({ ...dialog, tagInput: "" });
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: s.cardBg, border: "1px solid " + border, borderRadius: 12, padding: 24, width: 480 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ color: s.textMain, fontSize: 14, fontWeight: 700 }}>📂 Dokument hochladen</h3>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted }}><X size={18} /></button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Anzeigename</label>
            <input value={dialog.name} onChange={e => onChange({ ...dialog, name: e.target.value })} style={inp} />
            <div style={{ fontSize: 10, color: s.textMuted, marginTop: 2 }}>Datei: {dialog.file.name} ({formatBytes(dialog.file.size)})</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Kategorie</label>
              <select value={dialog.category} onChange={e => onChange({ ...dialog, category: e.target.value })}
                style={{ ...inp, cursor: "pointer" }}>
                {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Jahr</label>
              <input type="number" value={dialog.year || ""} min="2000" max="2099"
                onChange={e => onChange({ ...dialog, year: e.target.value ? parseInt(e.target.value) : null })}
                style={inp} placeholder="z.B. 2025" />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Tags <small style={{ opacity: 0.6 }}>(Enter zum Hinzufügen)</small></label>
            <input
              value={dialog.tagInput || ""}
              onChange={e => onChange({ ...dialog, tagInput: e.target.value })}
              onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }}
              placeholder="Tag eingeben + Enter"
              style={inp}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
              {(dialog.tags || []).map(t => (
                <span key={t} style={{ background: tagColor(t), color: "#fff", borderRadius: 10, padding: "2px 8px", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                  {t}
                  <button onClick={() => onChange({ ...dialog, tags: (dialog.tags || []).filter(x => x !== t) })}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#fff", padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
                </span>
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Notiz (optional)</label>
            <textarea value={dialog.notes || ""} onChange={e => onChange({ ...dialog, notes: e.target.value })}
              rows={2} style={{ ...inp, resize: "none" }} placeholder="Kurze Bemerkung..." />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          <Button variant="outline" onClick={onCancel} style={{ color: s.textMuted, borderColor: border }}>Abbrechen</Button>
          <Button onClick={onUpload} disabled={uploading} style={{ background: accent, color: "#fff" }}>
            {uploading ? "Lädt hoch…" : "Hochladen"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CustomerDokumenteTab({ customer }) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const s = {
    cardBg:      isArtis ? "#ffffff"             : isLight ? "#ffffff"             : "#27272a",
    border:      isArtis ? "#ccd8cc"             : isLight ? "#d4d4e8"             : "#3f3f46",
    textMain:    isArtis ? "#2d3a2d"             : isLight ? "#1a1a2e"             : "#e4e4e7",
    textMuted:   isArtis ? "#6b826b"             : isLight ? "#7a7a9a"             : "#71717a",
    inputBg:     isArtis ? "#ffffff"             : isLight ? "#ffffff"             : "rgba(24,24,27,0.8)",
    inputBorder: isArtis ? "#bfcfbf"             : isLight ? "#c8c8dc"             : "#3f3f46",
    accentBg:    isArtis ? "#7a9b7f"             : "#6366f1",
    sidebarBg:   isArtis ? "#f5f8f5"             : isLight ? "#f5f5fc"             : "#1f1f23",
    rowHover:    isArtis ? "rgba(122,155,127,0.09)" : isLight ? "rgba(99,102,241,0.06)" : "rgba(255,255,255,0.04)",
    selBg:       isArtis ? "rgba(122,155,127,0.18)" : isLight ? "rgba(99,102,241,0.13)" : "rgba(99,102,241,0.18)",
  };
  const border  = s.border;
  const accent  = isArtis ? "#4a7a4f" : "#7c3aed";

  const queryClient = useQueryClient();
  const fileInputRef = useRef();

  // Selection state
  const [selCat,  setSelCat]  = useState(null); // null = alle
  const [selYear, setSelYear] = useState(null); // null = alle Jahre der Kategorie
  const [expandedCats, setExpandedCats] = useState({});
  const [search,  setSearch]  = useState("");
  const [uploading,    setUploading]    = useState(false);
  const [uploadDialog, setUploadDialog] = useState(null);
  const [dragOver,     setDragOver]     = useState(false);
  const [signedUrls,   setSignedUrls]   = useState({});

  // ── Data ────────────────────────────────────────────────────────────────────
  const { data: dokumente = [], isLoading } = useQuery({
    queryKey: ["dokumente", customer?.id],
    queryFn:  () => entities.Dokument.filter({ customer_id: customer.id }, "-created_at"),
    enabled:  !!customer?.id,
  });

  // ── Tree structure for left panel ──────────────────────────────────────────
  const tree = useMemo(() => {
    return CATEGORIES.map(cat => {
      const catDocs = dokumente.filter(d => d.category === cat.key);
      const yearSet = new Set(catDocs.map(d => d.year).filter(Boolean));
      const years = [...yearSet].sort((a, b) => b - a);
      const noYear = catDocs.filter(d => !d.year).length;
      return { ...cat, count: catDocs.length, years, noYear };
    });
  }, [dokumente]);

  // ── Filtered docs for right panel ──────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = dokumente;
    if (selCat)  list = list.filter(d => d.category === selCat);
    if (selYear !== null && selYear !== undefined) {
      if (selYear === "__none__") list = list.filter(d => !d.year);
      else list = list.filter(d => d.year === selYear);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(d =>
        d.name.toLowerCase().includes(q) ||
        (d.tags || []).some(t => t.toLowerCase().includes(q)) ||
        (d.notes || "").toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [dokumente, selCat, selYear, search]);

  // ── Breadcrumb ──────────────────────────────────────────────────────────────
  const breadcrumb = useMemo(() => {
    if (!selCat) return { icon: "📁", label: "Alle Dokumente", count: dokumente.length };
    const cat = CATEGORIES.find(c => c.key === selCat);
    if (!selYear) return { icon: cat.icon, label: cat.label, count: filtered.length };
    const yrLabel = selYear === "__none__" ? "Kein Jahr" : String(selYear);
    return { icon: cat.icon, label: cat.label + " / " + yrLabel, count: filtered.length };
  }, [selCat, selYear, dokumente.length, filtered.length]);

  // ── Signed URLs ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const missing = filtered.filter(d => !signedUrls[d.id]);
    if (missing.length === 0) return;
    missing.forEach(async doc => {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 3600);
      if (data?.signedUrl) setSignedUrls(prev => ({ ...prev, [doc.id]: data.signedUrl }));
    });
  }, [filtered]);

  // ── Upload ───────────────────────────────────────────────────────────────────
  const openUploadDialog = (file) => {
    const detectedYear = detectYear(file.name);
    setUploadDialog({
      file,
      name:     file.name.replace(/\.[^.]+$/, ""),
      category: selCat || "korrespondenz",
      year:     detectedYear || (selYear && selYear !== "__none__" ? selYear : null),
      tags:     [],
      tagInput: "",
      notes:    "",
    });
  };

  const handleUpload = async () => {
    if (!uploadDialog) return;
    setUploading(true);
    try {
      const { file, name, category, year, tags, notes } = uploadDialog;
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${customer.id}/${category}/${year || "allgemein"}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, file, { upsert: false });
      if (upErr) throw upErr;
      await entities.Dokument.create({
        customer_id: customer.id, category, year: year || null,
        name, filename: file.name, storage_path: storagePath,
        file_size: file.size, file_type: file.type, tags, notes,
      });
      queryClient.invalidateQueries({ queryKey: ["dokumente", customer.id] });
      toast.success("Dokument hochgeladen");
      setUploadDialog(null);
    } catch (err) {
      toast.error("Fehler beim Hochladen: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc) => {
    if (!window.confirm(`"${doc.name}" wirklich löschen?`)) return;
    await supabase.storage.from(BUCKET).remove([doc.storage_path]);
    await entities.Dokument.delete(doc.id);
    queryClient.invalidateQueries({ queryKey: ["dokumente", customer.id] });
    setSignedUrls(prev => { const n = { ...prev }; delete n[doc.id]; return n; });
    toast.success("Dokument gelöscht");
  };

  // ── Drag & Drop ──────────────────────────────────────────────────────────────
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...(e.dataTransfer.files || [])];
    if (files.length > 0) openUploadDialog(files[0]);
  };

  // ── Tree toggle ──────────────────────────────────────────────────────────────
  const toggleCat = (key) => {
    setExpandedCats(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const selectCat = (key) => {
    setSelCat(key);
    setSelYear(null);
    setExpandedCats(prev => ({ ...prev, [key]: true }));
  };

  const selectYear = (catKey, year) => {
    setSelCat(catKey);
    setSelYear(year);
  };

  // ── Styles ───────────────────────────────────────────────────────────────────
  const treeItemBase = {
    display: "flex", alignItems: "center", gap: 5,
    padding: "5px 10px", cursor: "pointer", borderRadius: 5,
    fontSize: 12, userSelect: "none", transition: "background 0.1s",
  };

  return (
    <div
      style={{ display: "flex", height: "calc(100vh - 260px)", minHeight: 420, border: "1px solid " + border, borderRadius: 10, overflow: "hidden", background: s.cardBg }}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* ═══ LEFT PANEL – Explorer Tree ════════════════════════════════════════ */}
      <div style={{ width: 210, flexShrink: 0, borderRight: "1px solid " + border, background: s.sidebarBg, display: "flex", flexDirection: "column", overflowY: "auto" }}>
        {/* Header */}
        <div style={{ padding: "10px 12px 8px", borderBottom: "1px solid " + border }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: s.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Ordner</span>
        </div>

        {/* Alle Dokumente */}
        <div
          onClick={() => { setSelCat(null); setSelYear(null); }}
          style={{ ...treeItemBase, margin: "4px 6px", background: !selCat ? s.selBg : "transparent", color: !selCat ? accent : s.textMain, fontWeight: !selCat ? 600 : 400 }}
        >
          <span style={{ fontSize: 14 }}>📁</span>
          <span style={{ flex: 1 }}>Alle Dokumente</span>
          <span style={{ fontSize: 10, color: s.textMuted, background: border, borderRadius: 8, padding: "1px 5px" }}>{dokumente.length}</span>
        </div>

        {/* Categories */}
        {tree.map(cat => {
          const isCatSel = selCat === cat.key && selYear === null;
          const isExpanded = expandedCats[cat.key];
          const hasYears = cat.years.length > 0 || cat.noYear > 0;

          return (
            <div key={cat.key} style={{ margin: "1px 6px" }}>
              {/* Category row */}
              <div
                style={{ ...treeItemBase, background: isCatSel ? s.selBg : "transparent", color: selCat === cat.key ? accent : s.textMain, fontWeight: selCat === cat.key ? 600 : 400 }}
                onClick={() => selectCat(cat.key)}
              >
                <span
                  onClick={e => { e.stopPropagation(); if (hasYears) toggleCat(cat.key); }}
                  style={{ display: "flex", alignItems: "center", color: s.textMuted, flexShrink: 0, width: 14 }}
                >
                  {hasYears
                    ? (isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />)
                    : <span style={{ width: 11 }} />
                  }
                </span>
                <span style={{ fontSize: 13 }}>{cat.icon}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.label}</span>
                {cat.count > 0 && (
                  <span style={{ fontSize: 10, color: s.textMuted, background: border, borderRadius: 8, padding: "1px 5px", flexShrink: 0 }}>{cat.count}</span>
                )}
              </div>

              {/* Year sub-items */}
              {isExpanded && (
                <div style={{ paddingLeft: 10 }}>
                  {cat.years.map(year => {
                    const isYearSel = selCat === cat.key && selYear === year;
                    const cnt = dokumente.filter(d => d.category === cat.key && d.year === year).length;
                    return (
                      <div
                        key={year}
                        onClick={() => selectYear(cat.key, year)}
                        style={{ ...treeItemBase, background: isYearSel ? s.selBg : "transparent", color: isYearSel ? accent : s.textMain, fontWeight: isYearSel ? 600 : 400 }}
                      >
                        <span style={{ width: 14, flexShrink: 0 }} />
                        <span style={{ fontSize: 12 }}>📅</span>
                        <span style={{ flex: 1 }}>{year}</span>
                        <span style={{ fontSize: 10, color: s.textMuted, background: border, borderRadius: 8, padding: "1px 5px", flexShrink: 0 }}>{cnt}</span>
                      </div>
                    );
                  })}
                  {cat.noYear > 0 && (
                    <div
                      onClick={() => selectYear(cat.key, "__none__")}
                      style={{ ...treeItemBase, background: (selCat === cat.key && selYear === "__none__") ? s.selBg : "transparent", color: (selCat === cat.key && selYear === "__none__") ? accent : s.textMuted, fontStyle: "italic" }}
                    >
                      <span style={{ width: 14, flexShrink: 0 }} />
                      <span style={{ fontSize: 12 }}>📄</span>
                      <span style={{ flex: 1 }}>Kein Jahr</span>
                      <span style={{ fontSize: 10, color: s.textMuted, background: border, borderRadius: 8, padding: "1px 5px", flexShrink: 0 }}>{cat.noYear}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ═══ RIGHT PANEL – File List ════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Top Bar */}
        <div style={{ padding: "8px 14px", borderBottom: "1px solid " + border, display: "flex", alignItems: "center", gap: 10, background: s.cardBg }}>
          {/* Breadcrumb */}
          <span style={{ fontSize: 13, fontWeight: 600, color: accent }}>
            {breadcrumb.icon} {breadcrumb.label}
          </span>
          <span style={{ fontSize: 11, color: s.textMuted }}>({breadcrumb.count} Dok.)</span>
          <div style={{ flex: 1 }} />
          {/* Search */}
          <div style={{ position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", color: s.textMuted, pointerEvents: "none" }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Suchen…"
              style={{ background: s.inputBg, border: "1px solid " + border, color: s.textMain, borderRadius: 6, padding: "4px 8px 4px 24px", fontSize: 12, width: 160, outline: "none" }}
            />
          </div>
          {/* Upload Button */}
          <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={e => { if (e.target.files[0]) { openUploadDialog(e.target.files[0]); e.target.value = ""; } }} />
          <Button
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            style={{ background: accent, color: "#fff", fontSize: 12, height: 30, gap: 5, display: "flex", alignItems: "center" }}
          >
            <Upload size={12} /> Hochladen
          </Button>
        </div>

        {/* File List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {isLoading ? (
            <div style={{ padding: 24, color: s.textMuted, fontSize: 13, textAlign: "center" }}>Lade…</div>
          ) : filtered.length === 0 ? (
            <div
              style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: s.textMuted, gap: 10, padding: 32,
                border: dragOver ? "2px dashed " + accent : "2px dashed transparent", borderRadius: 8, margin: 16, transition: "border 0.2s" }}
            >
              <span style={{ fontSize: 36 }}>📂</span>
              <span style={{ fontSize: 13 }}>{dragOver ? "Datei loslassen zum Hochladen" : "Keine Dokumente"}</span>
              <span style={{ fontSize: 11, opacity: 0.7 }}>Datei hierher ziehen oder «Hochladen» klicken</span>
            </div>
          ) : (
            filtered.map(doc => {
              const fi = getFileInfo(doc.file_type, doc.filename);
              return (
                <div
                  key={doc.id}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 16px", borderBottom: "1px solid " + border + "55", transition: "background 0.1s" }}
                  onMouseEnter={e => e.currentTarget.style.background = s.rowHover}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  {/* File type badge */}
                  <span style={{ background: fi.color, color: "#fff", borderRadius: 4, padding: "2px 5px", fontSize: 10, fontWeight: 700, flexShrink: 0, minWidth: 34, textAlign: "center" }}>
                    {fi.label}
                  </span>

                  {/* Name + Tags + Notes */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: s.textMain, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>
                      {doc.name}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3, alignItems: "center" }}>
                      {/* Category badge (when viewing "alle") */}
                      {!selCat && (() => {
                        const cat = CATEGORIES.find(c => c.key === doc.category);
                        return cat ? (
                          <span style={{ fontSize: 10, background: s.sidebarBg, color: s.textMuted, border: "1px solid " + border, borderRadius: 8, padding: "1px 6px" }}>
                            {cat.icon} {cat.label}
                          </span>
                        ) : null;
                      })()}
                      {(doc.tags || []).map(t => (
                        <span key={t} style={{ background: tagColor(t), color: "#fff", borderRadius: 8, padding: "1px 7px", fontSize: 10 }}>
                          {t}
                        </span>
                      ))}
                      {doc.notes && (
                        <span style={{ fontSize: 10, color: s.textMuted, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                          {doc.notes}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Jahr */}
                  {doc.year && (
                    <span style={{ fontSize: 11, color: s.textMuted, background: s.sidebarBg, border: "1px solid " + border, borderRadius: 6, padding: "2px 7px", flexShrink: 0 }}>
                      {doc.year}
                    </span>
                  )}

                  {/* File size */}
                  <span style={{ fontSize: 11, color: s.textMuted, flexShrink: 0, width: 52, textAlign: "right" }}>
                    {formatBytes(doc.file_size)}
                  </span>

                  {/* Download */}
                  <button
                    onClick={() => { const url = signedUrls[doc.id]; if (url) window.open(url, "_blank"); else toast.error("URL noch nicht bereit, bitte kurz warten."); }}
                    title="Herunterladen"
                    style={{ background: "none", border: "none", cursor: "pointer", color: accent, display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}
                  >
                    <Download size={15} />
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(doc)}
                    title="Löschen"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Upload Dialog */}
      {uploadDialog && (
        <UploadDialog
          dialog={uploadDialog}
          onChange={setUploadDialog}
          onCancel={() => setUploadDialog(null)}
          onUpload={handleUpload}
          uploading={uploading}
          s={s}
          border={border}
          accent={accent}
        />
      )}
    </div>
  );
}
