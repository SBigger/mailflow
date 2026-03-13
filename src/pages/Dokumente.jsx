import React, { useState, useMemo, useEffect, useRef, useContext } from "react";
import { Search, Upload, Download, Trash2, ChevronDown, ChevronRight, X, Pencil, Lock, LockOpen, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeContext } from "@/Layout";
import { supabase, entities } from "@/api/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import TagSelectWidget from "@/components/dokumente/TagSelectWidget";
import CheckinDialog from "@/components/dokumente/CheckinDialog";
import { useAuth } from "@/lib/AuthContext";
import { saveHandle, loadHandle, deleteHandle } from "@/lib/fileHandleDB";

const BUCKET   = "dokumente";
const CUR_YEAR = new Date().getFullYear();

const CATEGORIES = [
  { key: "rechnungswesen", label: "01 - Rechnungswesen", icon: "\uD83D\uDCCA" },
  { key: "steuern",        label: "02 - Steuern",        icon: "\uD83D\uDCB0" },
  { key: "mwst",           label: "03 - Mehrwertsteuer", icon: "\uD83E\uDDFE" },
  { key: "revision",       label: "04 - Revision",       icon: "\uD83D\uDD0D" },
  { key: "rechtsberatung", label: "05 - Rechtsberatung", icon: "\u2696\uFE0F" },
  { key: "personal",       label: "06 - Personal",       icon: "\uD83D\uDC65" },
  { key: "korrespondenz",  label: "09 - Korrespondenz",  icon: "\u2709\uFE0F" },
];

function getFileInfo(mimeType, filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  if (mimeType === "application/pdf" || ext === "pdf")             return { label: "PDF", color: "#dc2626" };
  if (mimeType?.includes("spreadsheet") || ["xls","xlsx","csv"].includes(ext)) return { label: "XLS", color: "#16a34a" };
  if (mimeType?.includes("word") || ["doc","docx"].includes(ext)) return { label: "DOC", color: "#2563eb" };
  if (mimeType?.startsWith("image/"))                              return { label: "IMG", color: "#7c3aed" };
  if (["zip","rar","7z"].includes(ext))                           return { label: "ZIP", color: "#d97706" };
  return { label: ext.toUpperCase() || "FILE", color: "#71717a" };
}
function detectYear(filename) {
  const m = (filename || "").match(/\b(20\d{2})\b/);
  return m ? parseInt(m[1]) : null;
}
function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

// ─── Upload-Dialog ─────────────────────────────────────────────────────────
function UploadDialog({ customers, preCustomer, allTags, onCancel, onUpload, s, border, accent }) {
  const [file,       setFile]       = useState(null);
  const [custId,     setCustId]     = useState(preCustomer?.id || "");
  const [name,       setName]       = useState("");
  const [category,   setCategory]   = useState("steuern");
  const [year,       setYear]       = useState(String(CUR_YEAR));
  const [tagIds,     setTagIds]     = useState([]);
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

  const handleUpload = async () => {
    if (!file || !custId || !name.trim()) { toast.error("Bitte Datei, Kunde und Name ausfullen"); return; }
    if (!year || isNaN(parseInt(year)))   { toast.error("Bitte ein gueltiges Jahr eingeben"); return; }
    setUploading(true);
    try {
      const safe        = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${custId}/${category}/${year}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      await entities.Dokument.create({ customer_id: custId, category, year: parseInt(year), name: name.trim(), filename: file.name, storage_path: storagePath, file_size: file.size, file_type: file.type, tag_ids: tagIds, notes });
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
      <div style={{ background: s.cardBg, border: "1px solid " + border, borderRadius: 12, padding: 24, width: 520, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ color: s.textMain, fontSize: 14, fontWeight: 700 }}>Dokument hochladen</h3>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted }}><X size={18} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Datei */}
          <div onClick={() => fileRef.current?.click()}
            style={{ border: "2px dashed " + (file ? accent : border), borderRadius: 8, padding: 14, textAlign: "center", cursor: "pointer", color: file ? accent : s.textMuted, fontSize: 13 }}>
            {file ? `${file.name} (${formatBytes(file.size)})` : "Datei auswaehlen oder hierher ziehen"}
            <input ref={fileRef} type="file" style={{ display: "none" }} onChange={e => e.target.files[0] && pickFile(e.target.files[0])} />
          </div>
          {/* Kunde */}
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Kunde *</label>
            <select value={custId} onChange={e => setCustId(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
              <option value="">-- Kunde waehlen --</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
          {/* Name */}
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Anzeigename *</label>
            <input value={name} onChange={e => setName(e.target.value)} style={inp} placeholder="Dateiname (ohne Endung)" />
          </div>
          {/* Kategorie + Jahr */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Kategorie</label>
              <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Jahr *</label>
              <input type="number" value={year} min="2000" max="2099" onChange={e => setYear(e.target.value)} style={{ ...inp, borderColor: !year ? "#ef4444" : (s.inputBorder || border) }} placeholder="z.B. 2025" />
            </div>
          </div>
          {/* Tags */}
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Tags</label>
            <TagSelectWidget value={tagIds} onChange={setTagIds} allTags={allTags} s={s} border={border} accent={accent} />
          </div>
          {/* Notiz */}
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Notiz (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inp, resize: "none" }} placeholder="Kurze Bemerkung..." />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          <Button variant="outline" onClick={onCancel} style={{ color: s.textMuted, borderColor: border }}>Abbrechen</Button>
          <Button onClick={handleUpload} disabled={uploading || !file || !custId || !year} style={{ background: accent, color: "#fff" }}>
            {uploading ? "Laedt hoch..." : "Hochladen"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit-Dialog ───────────────────────────────────────────────────────────
function EditDialog({ doc, allTags, onCancel, onSave, s, border, accent }) {
  const [name,     setName]     = useState(doc.name || "");
  const [category, setCategory] = useState(doc.category || "steuern");
  const [year,     setYear]     = useState(String(doc.year || CUR_YEAR));
  const [tagIds,   setTagIds]   = useState(doc.tag_ids || []);
  const [notes,    setNotes]    = useState(doc.notes || "");
  const [saving,   setSaving]   = useState(false);

  const inp = { background: s.inputBg, border: "1px solid " + (s.inputBorder || border), color: s.textMain, borderRadius: 6, padding: "5px 8px", fontSize: 13, width: "100%", outline: "none" };

  const handleSave = async () => {
    if (!name.trim() || !year || isNaN(parseInt(year))) { toast.error("Name und Jahr sind Pflicht"); return; }
    setSaving(true);
    try {
      await entities.Dokument.update(doc.id, { name: name.trim(), category, year: parseInt(year), tag_ids: tagIds, notes });
      toast.success("Gespeichert");
      onSave();
    } catch (e) {
      toast.error("Fehler: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: s.cardBg, border: "1px solid " + border, borderRadius: 12, padding: 24, width: 480, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ color: s.textMain, fontSize: 14, fontWeight: 700 }}>Dokument bearbeiten</h3>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted }}><X size={18} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Datei</label>
            <div style={{ fontSize: 12, color: s.textMuted, padding: "5px 8px", background: s.sidebarBg, borderRadius: 6, border: "1px solid " + border }}>{doc.filename}</div>
          </div>
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Anzeigename *</label>
            <input value={name} onChange={e => setName(e.target.value)} style={inp} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Kategorie</label>
              <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Jahr *</label>
              <input type="number" value={year} min="2000" max="2099" onChange={e => setYear(e.target.value)} style={{ ...inp, borderColor: !year ? "#ef4444" : (s.inputBorder || border) }} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Tags</label>
            <TagSelectWidget value={tagIds} onChange={setTagIds} allTags={allTags} s={s} border={border} accent={accent} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Notiz</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inp, resize: "none" }} placeholder="Kurze Bemerkung..." />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          <Button variant="outline" onClick={onCancel} style={{ color: s.textMuted, borderColor: border }}>Abbrechen</Button>
          <Button onClick={handleSave} disabled={saving} style={{ background: accent, color: "#fff" }}>
            {saving ? "Speichert..." : "Speichern"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Hauptseite ────────────────────────────────────────────────────────────
export default function Dokumente() {
  const { theme } = useContext(ThemeContext);
  const { user }  = useAuth();
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const s = {
    cardBg:    isArtis ? "#ffffff" : isLight ? "#ffffff" : "#27272a",
    border:    isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "#3f3f46",
    textMain:  isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7",
    textMuted: isArtis ? "#6b826b" : isLight ? "#7a7a9a" : "#71717a",
    inputBg:   isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(24,24,27,0.8)",
    inputBorder: isArtis ? "#bfcfbf" : isLight ? "#c8c8dc" : "#3f3f46",
    sidebarBg: isArtis ? "#f5f8f5" : isLight ? "#f5f5fc" : "#1f1f23",
    selBg:     isArtis ? "rgba(122,155,127,0.18)" : isLight ? "rgba(99,102,241,0.13)" : "rgba(99,102,241,0.18)",
    rowHover:  isArtis ? "rgba(122,155,127,0.07)" : isLight ? "rgba(99,102,241,0.05)" : "rgba(255,255,255,0.03)",
  };
  const border = s.border;
  const accent = isArtis ? "#4a7a4f" : "#7c3aed";
  const queryClient = useQueryClient();

  const [selCustomerId, setSelCustomerId] = useState(null);
  const [selCat,        setSelCat]        = useState(null);
  const [selYear,       setSelYear]       = useState(null);
  const [expandedC,     setExpandedC]     = useState({});
  const [expandedCat,   setExpandedCat]   = useState({});
  const [custSearch,    setCustSearch]    = useState("");
  const [fileSearch,    setFileSearch]    = useState("");
  const [showUpload,    setShowUpload]    = useState(false);
  const [editDoc,        setEditDoc]        = useState(null);
  const [checkinDoc,     setCheckinDoc]     = useState(null);
  const [checkinHandle,  setCheckinHandle]  = useState(null);
  const [signedUrls,    setSignedUrls]    = useState({});

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn:  () => entities.Customer.list("company_name"),
  });
  const { data: allDoks = [], isLoading } = useQuery({
    queryKey: ["dokumente-all"],
    queryFn:  () => entities.Dokument.list("-created_at", 5000),
  });
  const { data: allTags = [] } = useQuery({
    queryKey: ["dok_tags"],
    queryFn:  () => entities.DokTag.list("sort_order"),
  });

  // Tag-Resolver
  const getTag   = (id) => allTags.find(t => t.id === id);
  const tagLabel = (id) => { const t = getTag(id); if (!t) return null; const p = t.parent_id ? getTag(t.parent_id) : null; return p ? `${p.name} / ${t.name}` : t.name; };
  const tagColor = (id) => { const t = getTag(id); if (!t) return accent; return (t.parent_id ? getTag(t.parent_id)?.color : null) || t.color || accent; };

  // Baum
  const tree = useMemo(() => {
    const q = custSearch.toLowerCase();
    return customers.filter(c => {
      const has    = allDoks.some(d => d.customer_id === c.id);
      const match  = !q || c.company_name.toLowerCase().includes(q);
      return has && match;
    }).map(c => {
      const docs = allDoks.filter(d => d.customer_id === c.id);
      const cats = CATEGORIES.map(cat => {
        const cd = docs.filter(d => d.category === cat.key);
        if (!cd.length) return null;
        const years  = [...new Set(cd.map(d => d.year).filter(Boolean))].sort((a, b) => b - a);
        const noYear = cd.filter(d => !d.year).length;
        return { ...cat, count: cd.length, years, noYear };
      }).filter(Boolean);
      return { ...c, docCount: docs.length, cats };
    });
  }, [customers, allDoks, custSearch]);

  // Rechts: gefilterte Docs
  const selCustomer = customers.find(c => c.id === selCustomerId) || null;
  const filtered = useMemo(() => {
    if (!selCustomerId) return [];
    let list = allDoks.filter(d => d.customer_id === selCustomerId);
    if (selCat)              list = list.filter(d => d.category === selCat);
    if (selYear === "__none__") list = list.filter(d => !d.year);
    else if (selYear !== null)  list = list.filter(d => d.year === selYear);
    if (fileSearch.trim()) {
      const q = fileSearch.toLowerCase();
      list = list.filter(d => d.name.toLowerCase().includes(q));
    }
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [allDoks, selCustomerId, selCat, selYear, fileSearch]);

  const breadcrumb = useMemo(() => {
    if (!selCustomer) return "Alle Dokumente";
    const parts = [selCustomer.company_name];
    if (selCat) { const c = CATEGORIES.find(x => x.key === selCat); if (c) parts.push(c.icon + " " + c.label); }
    if (selYear) parts.push(selYear === "__none__" ? "Kein Jahr" : String(selYear));
    return parts.join(" \u203a ");
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
    if (!window.confirm(`"${doc.name}" wirklich loeschen?`)) return;
    await supabase.storage.from(BUCKET).remove([doc.storage_path]);
    await entities.Dokument.delete(doc.id);
    queryClient.invalidateQueries({ queryKey: ["dokumente-all"] });
    queryClient.invalidateQueries({ queryKey: ["dokumente"] });
    setSignedUrls(prev => { const n = { ...prev }; delete n[doc.id]; return n; });
    toast.success("Dokument geloescht");
  };

  const handleCheckout = async (doc) => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      await entities.Dokument.update(doc.id, {
        checked_out_by:      authUser.id,
        checked_out_by_name: user?.full_name || authUser.email,
        checked_out_at:      new Date().toISOString(),
      });
      queryClient.invalidateQueries({ queryKey: ["dokumente-all"] });
      queryClient.invalidateQueries({ queryKey: ["dokumente"] });

      const { data: urlData } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 300);
      if (!urlData?.signedUrl) { toast.error("Fehler beim Erstellen der Download-URL"); return; }
      const resp = await fetch(urlData.signedUrl);
      const blob = await resp.blob();

      if ("showSaveFilePicker" in window) {
        try {
          const handle = await window.showSaveFilePicker({ suggestedName: doc.filename });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          await saveHandle(doc.id, handle);
          toast.success("Ausgecheckt – Datei gespeichert. Beim Einchecken automatisch hochgeladen.");
        } catch (e) {
          if (e.name !== "AbortError") throw e;
          window.open(urlData.signedUrl, "_blank");
          toast.success("Ausgecheckt – Datei heruntergeladen.");
        }
      } else {
        window.open(urlData.signedUrl, "_blank");
        toast.success("Ausgecheckt – Datei heruntergeladen.");
      }
    } catch (err) { toast.error("Fehler: " + err.message); }
  };

  const openCheckin = async (doc) => {
    const handle = await loadHandle(doc.id).catch(() => null);
    setCheckinHandle(handle || null);
    setCheckinDoc(doc);
  };

  const handleCheckin = async (doc, file) => {
    try {
      if (file) {
        await supabase.storage.from(BUCKET).remove([doc.storage_path]);
        const safe    = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const newPath = `${doc.customer_id}/${doc.category}/${doc.year}/${Date.now()}-${safe}`;
        const { error } = await supabase.storage.from(BUCKET).upload(newPath, file, { contentType: file.type });
        if (error) throw error;
        await entities.Dokument.update(doc.id, {
          storage_path: newPath, filename: file.name,
          file_size: file.size, file_type: file.type,
          checked_out_by: null, checked_out_by_name: null, checked_out_at: null,
        });
        await deleteHandle(doc.id).catch(() => {});
        setSignedUrls(prev => { const n = { ...prev }; delete n[doc.id]; return n; });
        toast.success("Eingecheckt & neue Version hochgeladen");
      } else {
        await entities.Dokument.update(doc.id, {
          checked_out_by: null, checked_out_by_name: null, checked_out_at: null,
        });
        toast.success("Entsperrt");
      }
    } catch (err) { toast.error("Fehler: " + err.message); }
    setCheckinDoc(null); setCheckinHandle(null);
    queryClient.invalidateQueries({ queryKey: ["dokumente-all"] });
    queryClient.invalidateQueries({ queryKey: ["dokumente"] });
  };


  const selectCustomer = (id) => { setSelCustomerId(id); setSelCat(null); setSelYear(null); setExpandedC(p => ({ ...p, [id]: true })); };
  const selectCat      = (cid, ck) => { setSelCustomerId(cid); setSelCat(ck); setSelYear(null); setExpandedCat(p => ({ ...p, [cid + "_" + ck]: true })); };

  const treeItem = { display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", cursor: "pointer", borderRadius: 5, fontSize: 12, userSelect: "none" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: s.cardBg }}>

      {/* Header */}
      <div style={{ padding: "12px 20px", borderBottom: "1px solid " + border, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: s.textMain }}>Dokumente</span>
        <span style={{ fontSize: 12, color: s.textMuted }}>({allDoks.length} Dok., {tree.length} Kunden)</span>
        <div style={{ flex: 1 }} />
        <Button onClick={() => setShowUpload(true)} style={{ background: accent, color: "#fff", fontSize: 12, height: 32, display: "flex", alignItems: "center", gap: 5 }}>
          <Upload size={13} /> Hochladen
        </Button>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ═══ LINKS: Baum ═══════════════════════════════════════════════ */}
        <div style={{ width: 260, flexShrink: 0, borderRight: "1px solid " + border, background: s.sidebarBg, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid " + border, position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", color: s.textMuted, pointerEvents: "none" }} />
            <input value={custSearch} onChange={e => setCustSearch(e.target.value)} placeholder="Kunde suchen..."
              style={{ background: s.inputBg, border: "1px solid " + border, color: s.textMain, borderRadius: 6, padding: "4px 8px 4px 24px", fontSize: 12, width: "100%", outline: "none" }} />
          </div>

          {/* "Alle" Root */}
          <div onClick={() => { setSelCustomerId(null); setSelCat(null); setSelYear(null); }}
            style={{ ...treeItem, margin: "4px 6px", background: !selCustomerId ? s.selBg : "transparent", color: !selCustomerId ? accent : s.textMain, fontWeight: !selCustomerId ? 600 : 400 }}>
            <span style={{ fontSize: 14 }}>{"\uD83D\uDCC1"}</span>
            <span style={{ flex: 1 }}>Alle Dokumente</span>
            <span style={{ fontSize: 10, color: s.textMuted, background: border, borderRadius: 8, padding: "1px 5px" }}>{allDoks.length}</span>
          </div>

          <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
            {isLoading ? <div style={{ padding: 16, color: s.textMuted, fontSize: 12 }}>Laedt...</div>
              : tree.length === 0 ? <div style={{ padding: 16, color: s.textMuted, fontSize: 12 }}>Keine Dokumente</div>
              : tree.map(cust => {
                const isCustSel = selCustomerId === cust.id && !selCat;
                const isExp     = expandedC[cust.id];
                return (
                  <div key={cust.id} style={{ margin: "1px 6px" }}>
                    <div onClick={() => selectCustomer(cust.id)}
                      style={{ ...treeItem, background: selCustomerId === cust.id ? s.selBg + (isCustSel ? "" : "88") : "transparent", color: selCustomerId === cust.id ? accent : s.textMain, fontWeight: selCustomerId === cust.id ? 600 : 400 }}>
                      <span onClick={e => { e.stopPropagation(); setExpandedC(p => ({ ...p, [cust.id]: !p[cust.id] })); }}
                        style={{ display: "flex", alignItems: "center", color: s.textMuted, flexShrink: 0, width: 14 }}>
                        {isExp ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                      </span>
                      <span style={{ fontSize: 13 }}>{isExp ? "\uD83D\uDCC2" : "\uD83D\uDCC1"}</span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cust.company_name}</span>
                      <span style={{ fontSize: 10, color: s.textMuted, background: border, borderRadius: 8, padding: "1px 5px", flexShrink: 0 }}>{cust.docCount}</span>
                    </div>

                    {isExp && cust.cats.map(cat => {
                      const ck      = cust.id + "_" + cat.key;
                      const catSel  = selCustomerId === cust.id && selCat === cat.key && selYear === null;
                      const catExp  = expandedCat[ck];
                      return (
                        <div key={cat.key} style={{ paddingLeft: 14 }}>
                          <div onClick={() => selectCat(cust.id, cat.key)}
                            style={{ ...treeItem, background: catSel ? s.selBg : "transparent", color: (selCustomerId === cust.id && selCat === cat.key) ? accent : s.textMain, fontWeight: catSel ? 600 : 400 }}>
                            <span onClick={e => { e.stopPropagation(); setExpandedCat(p => ({ ...p, [ck]: !p[ck] })); }}
                              style={{ display: "flex", alignItems: "center", color: s.textMuted, flexShrink: 0, width: 14 }}>
                              {cat.years.length > 0 || cat.noYear > 0
                                ? (catExp ? <ChevronDown size={11} /> : <ChevronRight size={11} />)
                                : <span style={{ width: 11 }} />}
                            </span>
                            <span style={{ fontSize: 12 }}>{cat.icon}</span>
                            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.label}</span>
                            <span style={{ fontSize: 10, color: s.textMuted, background: border, borderRadius: 8, padding: "1px 5px", flexShrink: 0 }}>{cat.count}</span>
                          </div>

                          {catExp && (
                            <div style={{ paddingLeft: 14 }}>
                              {cat.years.map(yr => {
                                const yrSel = selCustomerId === cust.id && selCat === cat.key && selYear === yr;
                                const cnt   = allDoks.filter(d => d.customer_id === cust.id && d.category === cat.key && d.year === yr).length;
                                return (
                                  <div key={yr} onClick={() => { setSelCustomerId(cust.id); setSelCat(cat.key); setSelYear(yr); }}
                                    style={{ ...treeItem, background: yrSel ? s.selBg : "transparent", color: yrSel ? accent : s.textMain, fontWeight: yrSel ? 600 : 400 }}>
                                    <span style={{ width: 14, flexShrink: 0 }} />
                                    <span style={{ fontSize: 12 }}>{"\uD83D\uDCC5"}</span>
                                    <span style={{ flex: 1 }}>{yr}</span>
                                    <span style={{ fontSize: 10, color: s.textMuted, background: border, borderRadius: 8, padding: "1px 5px", flexShrink: 0 }}>{cnt}</span>
                                  </div>
                                );
                              })}
                              {cat.noYear > 0 && (
                                <div onClick={() => { setSelCustomerId(cust.id); setSelCat(cat.key); setSelYear("__none__"); }}
                                  style={{ ...treeItem, background: (selCustomerId === cust.id && selCat === cat.key && selYear === "__none__") ? s.selBg : "transparent", color: s.textMuted, fontStyle: "italic" }}>
                                  <span style={{ width: 14, flexShrink: 0 }} />
                                  <span style={{ fontSize: 12 }}>{"\uD83D\uDCC4"}</span>
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

        {/* ═══ RECHTS: Dateiliste ════════════════════════════════════════ */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
          {/* Topbar */}
          <div style={{ padding: "8px 16px", borderBottom: "1px solid " + border, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: accent, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{breadcrumb}</span>
            <span style={{ fontSize: 11, color: s.textMuted, flexShrink: 0 }}>({filtered.length})</span>
            <div style={{ flex: 1 }} />
            <div style={{ position: "relative" }}>
              <Search size={13} style={{ position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", color: s.textMuted, pointerEvents: "none" }} />
              <input value={fileSearch} onChange={e => setFileSearch(e.target.value)} placeholder="Suchen..."
                style={{ background: s.inputBg, border: "1px solid " + border, color: s.textMain, borderRadius: 6, padding: "4px 8px 4px 24px", fontSize: 12, width: 180, outline: "none" }} />
            </div>
          </div>

          {/* Liste */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {!selCustomerId ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: s.textMuted, gap: 10 }}>
                <span style={{ fontSize: 48 }}>{"\uD83D\uDCC1"}</span>
                <span style={{ fontSize: 14 }}>Kunden in der Ordnerstruktur auswaehlen</span>
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: s.textMuted, gap: 10 }}>
                <span style={{ fontSize: 36 }}>{"\uD83D\uDCC2"}</span>
                <span style={{ fontSize: 13 }}>Keine Dokumente in diesem Ordner</span>
              </div>
            ) : (
              filtered.map(doc => {
                const fi            = getFileInfo(doc.file_type, doc.filename);
                const cat           = CATEGORIES.find(c => c.key === doc.category);
                const ids           = doc.tag_ids || [];
                const isCheckedOut  = !!doc.checked_out_by;
                const isMyCheckout  = doc.checked_out_by === user?.id;
                const lockedByOther = isCheckedOut && !isMyCheckout;
                const isAdmin       = user?.role === 'admin';
                return (
                  <div key={doc.id}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 16px", borderBottom: "1px solid " + border + "55", transition: "background 0.1s" }}
                    onMouseEnter={e => e.currentTarget.style.background = s.rowHover}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    {/* Typ */}
                    <span style={{ background: fi.color, color: "#fff", borderRadius: 4, padding: "2px 5px", fontSize: 10, fontWeight: 700, flexShrink: 0, minWidth: 36, textAlign: "center" }}>{fi.label}</span>
                    {/* Name + Tags */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ fontSize: 13, color: s.textMain, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500, flex: 1 }}>{doc.name}</div>
                      {isCheckedOut && (
                        <span title={"Ausgecheckt von " + doc.checked_out_by_name + " am " + (doc.checked_out_at ? new Date(doc.checked_out_at).toLocaleDateString("de-CH") : "")}
                          style={{ fontSize: 10, color: isMyCheckout ? accent : "#f59e0b",
                            background: isMyCheckout ? accent + "18" : "#f59e0b18",
                            border: "1px solid " + (isMyCheckout ? accent + "44" : "#f59e0b44"),
                            borderRadius: 8, padding: "1px 6px", flexShrink: 0,
                            display: "flex", alignItems: "center", gap: 3 }}>
                          <Lock size={9} />
                          {isMyCheckout ? "Ich" : doc.checked_out_by_name}
                        </span>
                      )}
                    </div>
                      <div style={{ display: "flex", gap: 4, marginTop: 2, flexWrap: "wrap", alignItems: "center" }}>
                        {!selCat && cat && (
                          <span style={{ fontSize: 10, background: s.sidebarBg, color: s.textMuted, border: "1px solid " + border, borderRadius: 8, padding: "1px 6px" }}>{cat.icon} {cat.label}</span>
                        )}
                        {ids.slice(0, 4).map(id => {
                          const lbl = tagLabel(id);
                          const col = tagColor(id);
                          if (!lbl) return null;
                          return (
                            <span key={id} style={{ background: col + "22", color: col, border: "1px solid " + col + "55", borderRadius: 8, padding: "1px 7px", fontSize: 10, display: "flex", alignItems: "center", gap: 3 }}>
                              <span style={{ width: 5, height: 5, borderRadius: "50%", background: col }} />
                              {lbl}
                            </span>
                          );
                        })}
                        {ids.length > 4 && <span style={{ fontSize: 10, color: s.textMuted }}>+{ids.length - 4}</span>}
                        {doc.notes && <span style={{ fontSize: 10, color: s.textMuted, fontStyle: "italic" }}>{doc.notes}</span>}
                      </div>
                    </div>
                    {/* Jahr */}
                    {doc.year && <span style={{ fontSize: 11, color: s.textMuted, background: s.sidebarBg, border: "1px solid " + border, borderRadius: 6, padding: "2px 7px", flexShrink: 0 }}>{doc.year}</span>}
                    {/* Groesse */}
                    <span style={{ fontSize: 11, color: s.textMuted, flexShrink: 0, width: 55, textAlign: "right" }}>{formatBytes(doc.file_size)}</span>
                    {/* Checkout / Checkin */}
                    {!isCheckedOut && (
                      <button onClick={() => handleCheckout(doc)} title="Auschecken"
                        style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}>
                        <LockOpen size={14} />
                      </button>
                    )}
                    {isMyCheckout && (
                      <button onClick={() => openCheckin(doc)} title="Einchecken"
                        style={{ background: "none", border: "none", cursor: "pointer", color: accent, display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}>
                        <Lock size={14} />
                      </button>
                    )}
                    {lockedByOther && isAdmin && (
                      <button onClick={() => handleCheckin(doc, null)} title="Sperre aufheben (Admin)"
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}>
                        <ShieldAlert size={14} />
                      </button>
                    )}
                    {/* Edit */}
                    <button onClick={() => setEditDoc(doc)} title="Bearbeiten"
                      style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}>
                      <Pencil size={14} />
                    </button>
                    {/* Download */}
                    <button onClick={() => { const u = signedUrls[doc.id]; if (u) window.open(u, "_blank"); else toast.error("URL noch nicht bereit, kurz warten."); }}
                      title="Herunterladen" style={{ background: "none", border: "none", cursor: "pointer", color: accent, display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}>
                      <Download size={15} />
                    </button>
                    {/* Loeschen */}
                    <button onClick={() => !lockedByOther && handleDelete(doc)} title={lockedByOther ? "Gesperrt – kann nicht geloescht werden" : "Loeschen"}
                      style={{ background: "none", border: "none", cursor: lockedByOther ? "not-allowed" : "pointer", color: lockedByOther ? s.textMuted + "44" : "#ef4444", display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Dialoge */}
      {showUpload && (
        <UploadDialog customers={customers} preCustomer={selCustomer} allTags={allTags}
          onCancel={() => setShowUpload(false)}
          onUpload={() => { queryClient.invalidateQueries({ queryKey: ["dokumente-all"] }); queryClient.invalidateQueries({ queryKey: ["dokumente"] }); setShowUpload(false); }}
          s={s} border={border} accent={accent} />
      )}
      {editDoc && (
        <EditDialog doc={editDoc} allTags={allTags}
          onCancel={() => setEditDoc(null)}
          onSave={() => { queryClient.invalidateQueries({ queryKey: ["dokumente-all"] }); queryClient.invalidateQueries({ queryKey: ["dokumente"] }); setEditDoc(null); }}
          s={s} border={border} accent={accent} />
      )}
      {checkinDoc && (
        <CheckinDialog doc={checkinDoc} fileHandle={checkinHandle}
          onCancel={() => { setCheckinDoc(null); setCheckinHandle(null); }}
          onCheckin={(file) => handleCheckin(checkinDoc, file)}
          s={s} border={border} accent={accent} />
      )}
    </div>
  );
}
