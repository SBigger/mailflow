import React, { useState, useMemo, useEffect, useRef, useContext } from "react";
import { Search, Upload, Download, Trash2, ChevronDown, ChevronRight, X, FolderOpen, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeContext } from "@/Layout";
import { supabase, entities } from "@/api/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const BUCKET = "dokumente";

const CATEGORIES = [
  { key: "rechnungswesen",  label: "01 - Rechnungswesen",  icon: "📊" },
  { key: "steuern",         label: "02 - Steuern",         icon: "💰" },
  { key: "mwst",            label: "03 - Mehrwertsteuer",  icon: "🧾" },
  { key: "revision",        label: "04 - Revision",        icon: "🔍" },
  { key: "rechtsberatung",  label: "05 - Rechtsberatung",  icon: "⚖️" },
  { key: "personal",        label: "06 - Personal",        icon: "👥" },
  { key: "korrespondenz",   label: "09 - Korrespondenz",   icon: "✉️" },
];

function getFileInfo(mimeType, filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  if (mimeType === "application/pdf" || ext === "pdf")   return { label: "PDF", color: "#dc2626" };
  if (mimeType?.includes("spreadsheet") || ["xls","xlsx","csv"].includes(ext)) return { label: "XLS", color: "#16a34a" };
  if (mimeType?.includes("word") || ["doc","docx"].includes(ext)) return { label: "DOC", color: "#2563eb" };
  if (mimeType?.startsWith("image/")) return { label: "IMG", color: "#7c3aed" };
  if (["zip","rar","7z"].includes(ext)) return { label: "ZIP", color: "#d97706" };
  const ext2 = ext.toUpperCase();
  return { label: ext2 || "FILE", color: "#71717a" };
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

// ─── Upload Dialog ───────────────────────────────────────────────────────────
function UploadDialog({ customers, preCustomer, onCancel, onUpload, s, border, accent }) {
  const [file,       setFile]       = useState(null);
  const [customerId, setCustomerId] = useState(preCustomer?.id || "");
  const [name,       setName]       = useState("");
  const [category,   setCategory]   = useState("steuern");
  const [year,       setYear]       = useState("");
  const [tags,       setTags]       = useState([]);
  const [tagInput,   setTagInput]   = useState("");
  const [notes,      setNotes]      = useState("");
  const [uploading,  setUploading]  = useState(false);
  const fileRef = useRef();

  const inp = { background: s.inputBg, border: "1px solid " + (s.inputBorder || border), color: s.textMain, borderRadius: 6, padding: "5px 8px", fontSize: 13, width: "100%", outline: "none" };

  const pickFile = (f) => {
    setFile(f);
    setName(f.name.replace(/\.[^.]+$/, ""));
    const y = detectYear(f.name);
    if (y) setYear(String(y));
  };

  const addTag = () => {
    const t = tagInput.trim().replace(/,+$/, "");
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput("");
  };

  const handleUpload = async () => {
    if (!file || !customerId || !name) { toast.error("Bitte Datei, Kunde und Name ausfüllen"); return; }
    setUploading(true);
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${customerId}/${category}/${year || "allgemein"}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      await entities.Dokument.create({ customer_id: customerId, category, year: year ? parseInt(year) : null, name, filename: file.name, storage_path: storagePath, file_size: file.size, file_type: file.type, tags, notes });
      toast.success("Dokument hochgeladen");
      onUpload();
    } catch (err) {
      console.error("Upload error:", err);
      toast.error("Fehler: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: s.cardBg, border: "1px solid " + border, borderRadius: 12, padding: 24, width: 500 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ color: s.textMain, fontSize: 14, fontWeight: 700 }}>📂 Dokument hochladen</h3>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted }}><X size={18} /></button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Datei-Drop */}
          <div
            onClick={() => fileRef.current?.click()}
            style={{ border: "2px dashed " + (file ? accent : border), borderRadius: 8, padding: "14px", textAlign: "center", cursor: "pointer", color: file ? accent : s.textMuted, fontSize: 13 }}
          >
            {file ? `📄 ${file.name} (${formatBytes(file.size)})` : "Datei auswählen oder hierher ziehen"}
            <input ref={fileRef} type="file" style={{ display: "none" }} onChange={e => e.target.files[0] && pickFile(e.target.files[0])} />
          </div>

          {/* Kunde */}
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Kunde</label>
            <select value={customerId} onChange={e => setCustomerId(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
              <option value="">— Kunde wählen —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>

          {/* Name */}
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Anzeigename</label>
            <input value={name} onChange={e => setName(e.target.value)} style={inp} placeholder="Dateiname (ohne Endung)" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Kategorie</label>
              <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Jahr</label>
              <input type="number" value={year} min="2000" max="2099" onChange={e => setYear(e.target.value)} style={inp} placeholder="z.B. 2025" />
            </div>
          </div>

          {/* Tags */}
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Tags <small style={{ opacity: 0.6 }}>(Enter)</small></label>
            <input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }} placeholder="Tag + Enter" style={inp} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
              {tags.map(t => (
                <span key={t} style={{ background: accent, color: "#fff", borderRadius: 10, padding: "2px 8px", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                  {t}<button onClick={() => setTags(tags.filter(x => x !== t))} style={{ background: "none", border: "none", cursor: "pointer", color: "#fff", padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
                </span>
              ))}
            </div>
          </div>

          {/* Notiz */}
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Notiz (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inp, resize: "none" }} placeholder="Kurze Bemerkung…" />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          <Button variant="outline" onClick={onCancel} style={{ color: s.textMuted, borderColor: border }}>Abbrechen</Button>
          <Button onClick={handleUpload} disabled={uploading || !file || !customerId} style={{ background: accent, color: "#fff" }}>
            {uploading ? "Lädt hoch…" : "Hochladen"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function Dokumente() {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const s = {
    cardBg:      isArtis ? "#ffffff" : isLight ? "#ffffff" : "#27272a",
    border:      isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "#3f3f46",
    textMain:    isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7",
    textMuted:   isArtis ? "#6b826b" : isLight ? "#7a7a9a" : "#71717a",
    inputBg:     isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(24,24,27,0.8)",
    inputBorder: isArtis ? "#bfcfbf" : isLight ? "#c8c8dc" : "#3f3f46",
    accentBg:    isArtis ? "#7a9b7f" : "#6366f1",
    sidebarBg:   isArtis ? "#f5f8f5" : isLight ? "#f5f5fc" : "#1f1f23",
    selBg:       isArtis ? "rgba(122,155,127,0.18)" : isLight ? "rgba(99,102,241,0.13)" : "rgba(99,102,241,0.18)",
    rowHover:    isArtis ? "rgba(122,155,127,0.07)" : isLight ? "rgba(99,102,241,0.05)" : "rgba(255,255,255,0.03)",
  };
  const border = s.border;
  const accent = isArtis ? "#4a7a4f" : "#7c3aed";

  const queryClient = useQueryClient();

  // Selection
  const [selCustomerId, setSelCustomerId] = useState(null);
  const [selCat,        setSelCat]        = useState(null);
  const [selYear,       setSelYear]       = useState(null);
  const [expandedC,     setExpandedC]     = useState({});
  const [expandedCat,   setExpandedCat]   = useState({});
  const [custSearch,    setCustSearch]    = useState("");
  const [fileSearch,    setFileSearch]    = useState("");
  const [showUpload,    setShowUpload]    = useState(false);
  const [signedUrls,    setSignedUrls]    = useState({});

  // Data
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn:  () => entities.Customer.list("company_name"),
  });

  const { data: allDoks = [], isLoading } = useQuery({
    queryKey: ["dokumente-all"],
    queryFn:  () => entities.Dokument.list("-created_at", 5000),
  });

  // Tree: welche Kunden haben Dokumente?
  const tree = useMemo(() => {
    const q = custSearch.toLowerCase();
    return customers
      .filter(c => {
        const hasDok = allDoks.some(d => d.customer_id === c.id);
        const matchSearch = !q || c.company_name.toLowerCase().includes(q);
        return hasDok && matchSearch;
      })
      .map(c => {
        const docs = allDoks.filter(d => d.customer_id === c.id);
        const cats = CATEGORIES.map(cat => {
          const catDocs = docs.filter(d => d.category === cat.key);
          if (catDocs.length === 0) return null;
          const years = [...new Set(catDocs.map(d => d.year).filter(Boolean))].sort((a, b) => b - a);
          const noYear = catDocs.filter(d => !d.year).length;
          return { ...cat, count: catDocs.length, years, noYear };
        }).filter(Boolean);
        return { ...c, docCount: docs.length, cats };
      });
  }, [customers, allDoks, custSearch]);

  // Gefilterte Docs für rechte Seite
  const selCustomer = customers.find(c => c.id === selCustomerId) || null;
  const filtered = useMemo(() => {
    if (!selCustomerId) return [];
    let list = allDoks.filter(d => d.customer_id === selCustomerId);
    if (selCat) list = list.filter(d => d.category === selCat);
    if (selYear === "__none__") list = list.filter(d => !d.year);
    else if (selYear !== null) list = list.filter(d => d.year === selYear);
    if (fileSearch.trim()) {
      const q = fileSearch.toLowerCase();
      list = list.filter(d => d.name.toLowerCase().includes(q) || (d.tags || []).some(t => t.toLowerCase().includes(q)));
    }
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [allDoks, selCustomerId, selCat, selYear, fileSearch]);

  // Breadcrumb
  const breadcrumb = useMemo(() => {
    if (!selCustomer) return "Alle Dokumente";
    const parts = [selCustomer.company_name];
    if (selCat) { const cat = CATEGORIES.find(c => c.key === selCat); if (cat) parts.push(cat.icon + " " + cat.label); }
    if (selYear) parts.push(selYear === "__none__" ? "Kein Jahr" : String(selYear));
    return parts.join(" › ");
  }, [selCustomer, selCat, selYear]);

  // Signed URLs
  useEffect(() => {
    const missing = filtered.filter(d => !signedUrls[d.id]);
    if (!missing.length) return;
    missing.forEach(async doc => {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 3600);
      if (data?.signedUrl) setSignedUrls(prev => ({ ...prev, [doc.id]: data.signedUrl }));
    });
  }, [filtered]);

  const handleDelete = async (doc) => {
    if (!window.confirm(`"${doc.name}" wirklich löschen?`)) return;
    await supabase.storage.from(BUCKET).remove([doc.storage_path]);
    await entities.Dokument.delete(doc.id);
    queryClient.invalidateQueries({ queryKey: ["dokumente-all"] });
    setSignedUrls(prev => { const n = { ...prev }; delete n[doc.id]; return n; });
    toast.success("Dokument gelöscht");
  };

  const selectCustomer = (id) => {
    setSelCustomerId(id);
    setSelCat(null);
    setSelYear(null);
    setExpandedC(prev => ({ ...prev, [id]: true }));
  };

  const selectCat = (custId, catKey) => {
    setSelCustomerId(custId);
    setSelCat(catKey);
    setSelYear(null);
    const ck = custId + "_" + catKey;
    setExpandedCat(prev => ({ ...prev, [ck]: true }));
  };

  const treeItemBase = { display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", cursor: "pointer", borderRadius: 5, fontSize: 12, userSelect: "none" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: s.cardBg }}>
      {/* Page Header */}
      <div style={{ padding: "12px 20px", borderBottom: "1px solid " + border, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: s.textMain }}>📁 Dokumente</span>
        <span style={{ fontSize: 12, color: s.textMuted }}>({allDoks.length} Dokumente, {tree.length} Kunden)</span>
        <div style={{ flex: 1 }} />
        <Button onClick={() => setShowUpload(true)} style={{ background: accent, color: "#fff", fontSize: 12, height: 32, display: "flex", alignItems: "center", gap: 5 }}>
          <Upload size={13} /> Hochladen
        </Button>
      </div>

      {/* Main Split */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ═══ LEFT – Kunden-Ordner-Baum ═══════════════════════════════════════ */}
        <div style={{ width: 260, flexShrink: 0, borderRight: "1px solid " + border, background: s.sidebarBg, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Kunden-Suche */}
          <div style={{ padding: "8px 10px", borderBottom: "1px solid " + border, position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", color: s.textMuted, pointerEvents: "none" }} />
            <input
              value={custSearch}
              onChange={e => setCustSearch(e.target.value)}
              placeholder="Kunde suchen…"
              style={{ background: s.inputBg, border: "1px solid " + border, color: s.textMain, borderRadius: 6, padding: "4px 8px 4px 24px", fontSize: 12, width: "100%", outline: "none" }}
            />
          </div>

          {/* Alle Dok. Root */}
          <div
            onClick={() => { setSelCustomerId(null); setSelCat(null); setSelYear(null); }}
            style={{ ...treeItemBase, margin: "4px 6px", background: !selCustomerId ? s.selBg : "transparent", color: !selCustomerId ? accent : s.textMain, fontWeight: !selCustomerId ? 600 : 400 }}
          >
            <span style={{ fontSize: 14 }}>📁</span>
            <span style={{ flex: 1 }}>Alle Dokumente</span>
            <span style={{ fontSize: 10, color: s.textMuted, background: border, borderRadius: 8, padding: "1px 5px" }}>{allDoks.length}</span>
          </div>

          {/* Kunden-Liste */}
          <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
            {isLoading ? (
              <div style={{ padding: 16, color: s.textMuted, fontSize: 12 }}>Lädt…</div>
            ) : tree.length === 0 ? (
              <div style={{ padding: 16, color: s.textMuted, fontSize: 12 }}>Keine Dokumente</div>
            ) : tree.map(cust => {
              const isCustSel = selCustomerId === cust.id && !selCat;
              const isExpanded = expandedC[cust.id];

              return (
                <div key={cust.id} style={{ margin: "1px 6px" }}>
                  {/* Kunde-Zeile */}
                  <div
                    style={{ ...treeItemBase, background: selCustomerId === cust.id ? (isCustSel ? s.selBg : s.selBg + "66") : "transparent", color: selCustomerId === cust.id ? accent : s.textMain, fontWeight: selCustomerId === cust.id ? 600 : 400 }}
                    onClick={() => selectCustomer(cust.id)}
                  >
                    <span
                      onClick={e => { e.stopPropagation(); setExpandedC(prev => ({ ...prev, [cust.id]: !prev[cust.id] })); }}
                      style={{ display: "flex", alignItems: "center", color: s.textMuted, flexShrink: 0, width: 14 }}
                    >
                      {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    </span>
                    <span style={{ fontSize: 13 }}>{isExpanded ? "📂" : "📁"}</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cust.company_name}</span>
                    <span style={{ fontSize: 10, color: s.textMuted, background: border, borderRadius: 8, padding: "1px 5px", flexShrink: 0 }}>{cust.docCount}</span>
                  </div>

                  {/* Kategorie-Sub-Items */}
                  {isExpanded && cust.cats.map(cat => {
                    const ck = cust.id + "_" + cat.key;
                    const isCatSel = selCustomerId === cust.id && selCat === cat.key && selYear === null;
                    const isCatExp = expandedCat[ck];

                    return (
                      <div key={cat.key} style={{ paddingLeft: 14 }}>
                        <div
                          style={{ ...treeItemBase, background: isCatSel ? s.selBg : "transparent", color: (selCustomerId === cust.id && selCat === cat.key) ? accent : s.textMain, fontWeight: isCatSel ? 600 : 400 }}
                          onClick={() => selectCat(cust.id, cat.key)}
                        >
                          <span
                            onClick={e => { e.stopPropagation(); setExpandedCat(prev => ({ ...prev, [ck]: !prev[ck] })); }}
                            style={{ display: "flex", alignItems: "center", color: s.textMuted, flexShrink: 0, width: 14 }}
                          >
                            {cat.years.length > 0 || cat.noYear > 0
                              ? (isCatExp ? <ChevronDown size={11} /> : <ChevronRight size={11} />)
                              : <span style={{ width: 11 }} />}
                          </span>
                          <span style={{ fontSize: 12 }}>{cat.icon}</span>
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.label}</span>
                          <span style={{ fontSize: 10, color: s.textMuted, background: border, borderRadius: 8, padding: "1px 5px", flexShrink: 0 }}>{cat.count}</span>
                        </div>

                        {/* Jahr-Sub-Items */}
                        {isCatExp && (
                          <div style={{ paddingLeft: 14 }}>
                            {cat.years.map(year => {
                              const isYearSel = selCustomerId === cust.id && selCat === cat.key && selYear === year;
                              const cnt = allDoks.filter(d => d.customer_id === cust.id && d.category === cat.key && d.year === year).length;
                              return (
                                <div
                                  key={year}
                                  onClick={() => { setSelCustomerId(cust.id); setSelCat(cat.key); setSelYear(year); }}
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
                                onClick={() => { setSelCustomerId(cust.id); setSelCat(cat.key); setSelYear("__none__"); }}
                                style={{ ...treeItemBase, background: (selCustomerId === cust.id && selCat === cat.key && selYear === "__none__") ? s.selBg : "transparent", color: s.textMuted, fontStyle: "italic" }}
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
              );
            })}
          </div>
        </div>

        {/* ═══ RIGHT – Dateiliste ══════════════════════════════════════════════ */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
          {/* Top Bar */}
          <div style={{ padding: "8px 16px", borderBottom: "1px solid " + border, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: accent, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{breadcrumb}</span>
            <span style={{ fontSize: 11, color: s.textMuted, flexShrink: 0 }}>({filtered.length})</span>
            <div style={{ flex: 1 }} />
            <div style={{ position: "relative" }}>
              <Search size={13} style={{ position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", color: s.textMuted, pointerEvents: "none" }} />
              <input value={fileSearch} onChange={e => setFileSearch(e.target.value)} placeholder="Suchen…"
                style={{ background: s.inputBg, border: "1px solid " + border, color: s.textMain, borderRadius: 6, padding: "4px 8px 4px 24px", fontSize: 12, width: 180, outline: "none" }} />
            </div>
          </div>

          {/* File List */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {!selCustomerId ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: s.textMuted, gap: 10 }}>
                <span style={{ fontSize: 48 }}>📁</span>
                <span style={{ fontSize: 14 }}>Kunden in der Ordnerstruktur auswählen</span>
                <span style={{ fontSize: 12, opacity: 0.7 }}>Klicke links auf einen Kunden um seine Dokumente zu sehen</span>
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: s.textMuted, gap: 10 }}>
                <span style={{ fontSize: 36 }}>📂</span>
                <span style={{ fontSize: 13 }}>Keine Dokumente in diesem Ordner</span>
              </div>
            ) : (
              filtered.map(doc => {
                const fi = getFileInfo(doc.file_type, doc.filename);
                const cat = CATEGORIES.find(c => c.key === doc.category);
                return (
                  <div key={doc.id}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 16px", borderBottom: "1px solid " + border + "55", transition: "background 0.1s" }}
                    onMouseEnter={e => e.currentTarget.style.background = s.rowHover}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    {/* Typ-Badge */}
                    <span style={{ background: fi.color, color: "#fff", borderRadius: 4, padding: "2px 5px", fontSize: 10, fontWeight: 700, flexShrink: 0, minWidth: 36, textAlign: "center" }}>{fi.label}</span>

                    {/* Name + Tags */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: s.textMain, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{doc.name}</div>
                      <div style={{ display: "flex", gap: 4, marginTop: 2, flexWrap: "wrap", alignItems: "center" }}>
                        {/* Kategorie-Badge wenn nicht in Kategorie-Ansicht */}
                        {!selCat && cat && (
                          <span style={{ fontSize: 10, background: s.sidebarBg, color: s.textMuted, border: "1px solid " + border, borderRadius: 8, padding: "1px 6px" }}>
                            {cat.icon} {cat.label}
                          </span>
                        )}
                        {(doc.tags || []).map(t => (
                          <span key={t} style={{ background: accent + "33", color: accent, borderRadius: 8, padding: "1px 7px", fontSize: 10, border: "1px solid " + accent + "55" }}>{t}</span>
                        ))}
                        {doc.notes && <span style={{ fontSize: 10, color: s.textMuted, fontStyle: "italic" }}>{doc.notes}</span>}
                      </div>
                    </div>

                    {/* Jahr */}
                    {doc.year && (
                      <span style={{ fontSize: 11, color: s.textMuted, background: s.sidebarBg, border: "1px solid " + border, borderRadius: 6, padding: "2px 7px", flexShrink: 0 }}>{doc.year}</span>
                    )}

                    {/* Grösse */}
                    <span style={{ fontSize: 11, color: s.textMuted, flexShrink: 0, width: 55, textAlign: "right" }}>{formatBytes(doc.file_size)}</span>

                    {/* Download */}
                    <button onClick={() => { const url = signedUrls[doc.id]; if (url) window.open(url, "_blank"); else toast.error("URL noch nicht bereit, kurz warten."); }}
                      title="Herunterladen" style={{ background: "none", border: "none", cursor: "pointer", color: accent, display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}>
                      <Download size={15} />
                    </button>

                    {/* Löschen */}
                    <button onClick={() => handleDelete(doc)} title="Löschen"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Upload Dialog */}
      {showUpload && (
        <UploadDialog
          customers={customers}
          preCustomer={selCustomer}
          onCancel={() => setShowUpload(false)}
          onUpload={() => { queryClient.invalidateQueries({ queryKey: ["dokumente-all"] }); setShowUpload(false); }}
          s={s}
          border={border}
          accent={accent}
        />
      )}
    </div>
  );
}
