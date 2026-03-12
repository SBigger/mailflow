import React, { useState, useMemo, useEffect, useContext, useRef } from "react";
import { Upload, Search, X, Download, Trash2, ChevronDown, ChevronRight, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeContext } from "@/Layout";
import { supabase, entities } from "@/api/supabaseClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  return { label: "FILE", color: "#6b7280" };
}

function formatBytes(b) {
  if (!b) return "";
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return Math.round(b / 1024) + " KB";
  return (b / (1024 * 1024)).toFixed(1) + " MB";
}

function detectYear(filename) {
  const m = (filename || "").match(/\b(20\d{2})\b/);
  return m ? parseInt(m[1]) : null;
}

const TAG_PALETTE = ["#7c3aed","#0ea5e9","#16a34a","#d97706","#dc2626","#0891b2","#059669"];
function tagColor(tag) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) & 0xfffffff;
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
              <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Jahr (optional)</label>
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
          <Button onClick={onUpload} disabled={uploading}
            style={{ background: accent, color: "#fff", display: "flex", alignItems: "center", gap: 6 }}>
            {uploading ? "⏳ Lädt hoch..." : <><Upload size={13} /> Hochladen</>}
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
  };
  const queryClient = useQueryClient();
  const fileInputRef = useRef();

  const [search,       setSearch]       = useState("");
  const [activeTags,   setActiveTags]   = useState([]);
  const [openCats,     setOpenCats]     = useState({ steuern: true });
  const [openYears,    setOpenYears]    = useState({});
  const [dragOver,     setDragOver]     = useState(false);
  const [uploading,    setUploading]    = useState(false);
  const [uploadDialog, setUploadDialog] = useState(null);
  const [signedUrls,   setSignedUrls]   = useState({});

  // Theme helpers
  const border  = isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "rgba(63,63,70,0.5)";
  const inputBg = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(24,24,27,0.7)";
  const hoverBg = isArtis ? "rgba(122,155,127,0.09)" : isLight ? "rgba(99,102,241,0.06)" : "rgba(255,255,255,0.04)";
  const accent  = isArtis ? "#4a7a4f" : "#7c3aed";

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: dokumente = [], isLoading } = useQuery({
    queryKey: ["dokumente", customer?.id],
    queryFn:  () => entities.Dokument.filter({ customer_id: customer.id }, "-created_at"),
    enabled:  !!customer?.id,
  });

  // All tags
  const allTags = useMemo(() => {
    const set = new Set();
    dokumente.forEach(d => (d.tags || []).forEach(t => set.add(t)));
    return [...set].sort();
  }, [dokumente]);

  // Filtered
  const filtered = useMemo(() => {
    let list = dokumente;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(d =>
        d.name.toLowerCase().includes(q) ||
        (d.tags || []).some(t => t.toLowerCase().includes(q)) ||
        (d.notes || "").toLowerCase().includes(q)
      );
    }
    if (activeTags.length > 0)
      list = list.filter(d => activeTags.every(at => (d.tags || []).includes(at)));
    return list;
  }, [dokumente, search, activeTags]);

  // Grouped: category → year → items
  const grouped = useMemo(() => {
    const map = {};
    CATEGORIES.forEach(c => { map[c.key] = {}; });
    filtered.forEach(d => {
      if (!map[d.category]) map[d.category] = {};
      const yr = d.year ? String(d.year) : "–";
      if (!map[d.category][yr]) map[d.category][yr] = [];
      map[d.category][yr].push(d);
    });
    return map;
  }, [filtered]);

  const catCounts = useMemo(() => {
    const map = {};
    CATEGORIES.forEach(c => { map[c.key] = 0; });
    filtered.forEach(d => { if (map[d.category] !== undefined) map[d.category]++; });
    return map;
  }, [filtered]);

  // Signed URLs
  useEffect(() => {
    const missing = filtered.map(d => d.storage_path).filter(p => !signedUrls[p]);
    if (!missing.length) return;
    Promise.all(missing.map(async path => {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
      return [path, data?.signedUrl];
    })).then(pairs => {
      const obj = {};
      pairs.forEach(([p, u]) => { if (u) obj[p] = u; });
      setSignedUrls(prev => ({ ...prev, ...obj }));
    });
  }, [filtered]);

  // ── Delete ────────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async (doc) => {
      await supabase.storage.from(BUCKET).remove([doc.storage_path]);
      await entities.Dokument.delete(doc.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dokumente", customer?.id] });
      toast.success("Dokument gelöscht");
    },
    onError: e => toast.error("Fehler beim Löschen: " + e.message),
  });

  const handleDelete = doc => {
    if (!window.confirm('"' + doc.name + '" wirklich löschen?')) return;
    deleteMutation.mutate(doc);
  };

  // ── Upload ────────────────────────────────────────────────────────────────
  const openUploadDialog = file => {
    setUploadDialog({
      file, name: file.name.replace(/\.[^.]+$/, ""),
      category: "steuern", year: detectYear(file.name),
      tags: [], tagInput: "", notes: "",
    });
  };

  const handleUpload = async () => {
    if (!uploadDialog) return;
    setUploading(true);
    try {
      const { file, name, category, year, tags, notes } = uploadDialog;
      const safe  = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const yrPart = year ? String(year) : "allgemein";
      const path  = customer.id + "/" + category + "/" + yrPart + "/" + Date.now() + "-" + safe;

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (upErr) throw upErr;

      await entities.Dokument.create({
        customer_id: customer.id, category,
        year: year || null,
        name: name || file.name,
        filename: file.name,
        storage_path: path,
        file_size: file.size,
        file_type: file.type || null,
        tags: tags || [],
        notes: notes || null,
      });

      queryClient.invalidateQueries({ queryKey: ["dokumente", customer?.id] });
      toast.success("Dokument hochgeladen ✓");
      setUploadDialog(null);
      setOpenCats(prev => ({ ...prev, [category]: true }));
      if (year) setOpenYears(prev => ({ ...prev, [category + "_" + String(year)]: true }));
    } catch (e) {
      toast.error("Upload fehlgeschlagen: " + e.message);
    } finally {
      setUploading(false);
    }
  };

  // ── Drag & Drop ───────────────────────────────────────────────────────────
  const handleDrop = e => {
    e.preventDefault(); setDragOver(false);
    const files = [...(e.dataTransfer.files || [])];
    if (files[0]) openUploadDialog(files[0]);
  };

  const toggleTag = tag =>
    setActiveTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
      onDrop={handleDrop}
      style={{ minHeight: 200, position: "relative" }}
    >
      {/* Drag-over overlay */}
      {dragOver && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 50, borderRadius: 10,
          background: accent + "18", border: "2px dashed " + accent,
          display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none",
        }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: accent }}>📂 Hier ablegen</span>
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {/* Search */}
        <div style={{ position: "relative" }}>
          <Search size={13} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: s.textMuted, pointerEvents: "none" }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Suchen..."
            style={{ background: inputBg, border: "1px solid " + border, color: s.textMain, borderRadius: 6, padding: "4px 8px 4px 26px", fontSize: 12, width: 160, outline: "none" }}
          />
          {search && (
            <button onClick={() => setSearch("")}
              style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: s.textMuted }}>
              <X size={12} />
            </button>
          )}
        </div>

        {/* Tag filter chips */}
        {allTags.map(tag => (
          <button key={tag} onClick={() => toggleTag(tag)} style={{
            background: activeTags.includes(tag) ? tagColor(tag) : tagColor(tag) + "18",
            border: "1px solid " + tagColor(tag) + (activeTags.includes(tag) ? "" : "60"),
            color: activeTags.includes(tag) ? "#fff" : tagColor(tag),
            borderRadius: 12, padding: "2px 9px", fontSize: 11, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 4,
          }}>
            <Tag size={9} />{tag}
          </button>
        ))}
        {activeTags.length > 0 && (
          <button onClick={() => setActiveTags([])}
            style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, fontSize: 11, textDecoration: "underline" }}>
            Filter löschen
          </button>
        )}

        {/* Upload button */}
        <Button size="sm" onClick={() => fileInputRef.current?.click()}
          style={{ marginLeft: "auto", background: accent, color: "#fff", display: "flex", alignItems: "center", gap: 6 }}>
          <Upload size={13} /> Hochladen
        </Button>
        <input ref={fileInputRef} type="file" multiple className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) openUploadDialog(f); e.target.value = ""; }}
        />
      </div>

      {/* Empty state */}
      {!isLoading && dokumente.length === 0 && (
        <div style={{ border: "2px dashed " + border, borderRadius: 12, padding: "36px 20px", textAlign: "center", color: s.textMuted }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
          <div style={{ fontSize: 13, marginBottom: 4 }}>Noch keine Dokumente</div>
          <div style={{ fontSize: 12 }}>Datei per Drag &amp; Drop ablegen oder "Hochladen" klicken</div>
        </div>
      )}

      {/* Category accordion */}
      {CATEGORIES.map(cat => {
        const count    = catCounts[cat.key] || 0;
        const isOpen   = !!openCats[cat.key];
        const yearMap  = grouped[cat.key] || {};
        const sortedYears = Object.keys(yearMap).sort((a, b) => {
          if (a === "–") return 1; if (b === "–") return -1;
          return parseInt(b) - parseInt(a);
        });

        return (
          <div key={cat.key} style={{ marginBottom: 3 }}>
            {/* Category header */}
            <button
              onClick={() => setOpenCats(prev => ({ ...prev, [cat.key]: !prev[cat.key] }))}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                background: isOpen ? hoverBg : "none", border: "none", borderRadius: 8,
                padding: "7px 10px", cursor: "pointer",
                color: count > 0 ? s.textMain : s.textMuted,
                opacity: dokumente.length > 0 && count === 0 ? 0.5 : 1,
              }}
            >
              {isOpen ? <ChevronDown size={15} style={{ flexShrink: 0 }} /> : <ChevronRight size={15} style={{ flexShrink: 0 }} />}
              <span style={{ fontSize: 14 }}>{cat.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{cat.label}</span>
              <span style={{
                background: count > 0 ? accent : border, color: count > 0 ? "#fff" : s.textMuted,
                borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 600,
              }}>{count}</span>
            </button>

            {/* Year groups */}
            {isOpen && sortedYears.map(yr => {
              const yrKey    = cat.key + "_" + yr;
              const yrOpen   = openYears[yrKey] !== false; // default open
              const yrItems  = yearMap[yr];

              return (
                <div key={yr} style={{ marginLeft: 24, marginTop: 1 }}>
                  <button
                    onClick={() => setOpenYears(prev => ({ ...prev, [yrKey]: !yrOpen }))}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left",
                      background: "none", border: "none", borderRadius: 6, padding: "3px 8px",
                      cursor: "pointer", color: s.textMuted,
                    }}
                  >
                    {yrOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{yr}</span>
                    <span style={{ fontSize: 11, opacity: 0.6 }}>({yrItems.length})</span>
                  </button>

                  {/* File rows */}
                  {yrOpen && yrItems.map(doc => {
                    const fi  = getFileInfo(doc.file_type, doc.filename);
                    const url = signedUrls[doc.storage_path];
                    return (
                      <div
                        key={doc.id}
                        title={doc.notes || undefined}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "5px 8px 5px 32px", borderRadius: 6,
                          borderBottom: "1px solid " + border + "40",
                          transition: "background 0.1s",
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = hoverBg}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      >
                        {/* File type badge */}
                        <span style={{
                          background: fi.color + "20", color: fi.color,
                          borderRadius: 4, padding: "1px 5px",
                          fontSize: 10, fontWeight: 700, flexShrink: 0, letterSpacing: "0.03em",
                        }}>{fi.label}</span>

                        {/* Name */}
                        <span style={{ fontSize: 12, color: s.textMain, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          title={doc.filename}>
                          {doc.name}
                        </span>

                        {/* Tags */}
                        {(doc.tags || []).map(tag => (
                          <button key={tag} onClick={() => toggleTag(tag)} style={{
                            background: tagColor(tag) + "20", border: "1px solid " + tagColor(tag) + "50",
                            color: tagColor(tag), borderRadius: 8, padding: "1px 6px",
                            fontSize: 10, cursor: "pointer", flexShrink: 0,
                          }}>{tag}</button>
                        ))}

                        {/* Size */}
                        <span style={{ fontSize: 10, color: s.textMuted, flexShrink: 0 }}>{formatBytes(doc.file_size)}</span>

                        {/* Download */}
                        <a href={url || "#"} target="_blank" rel="noopener noreferrer"
                          title={url ? "Herunterladen / Öffnen" : "URL wird geladen..."}
                          onClick={e => { if (!url) { e.preventDefault(); toast.info("Signierte URL wird erstellt..."); } }}
                          style={{ color: s.textMuted, flexShrink: 0, display: "flex", alignItems: "center" }}>
                          <Download size={14} />
                        </a>

                        {/* Delete */}
                        <button onClick={() => handleDelete(doc)} title="Löschen"
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", flexShrink: 0, display: "flex", alignItems: "center" }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {isOpen && sortedYears.length === 0 && (
              <div style={{ marginLeft: 44, padding: "3px 8px", fontSize: 11, color: s.textMuted }}>
                Keine Dokumente
              </div>
            )}
          </div>
        );
      })}

      {/* Upload Dialog */}
      {uploadDialog && (
        <UploadDialog
          dialog={uploadDialog}
          onChange={setUploadDialog}
          onCancel={() => setUploadDialog(null)}
          onUpload={handleUpload}
          uploading={uploading}
          s={s} border={border} accent={accent}
        />
      )}
    </div>
  );
}
