import React, { useState, useMemo, useEffect, useRef, useContext } from "react";
import { Search, Upload, Download, Trash2, ChevronDown, ChevronRight, X, Pencil, Lock, LockOpen, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeContext } from "@/Layout";
import { supabase, entities } from "@/api/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import TagSelectWidget from "@/components/dokumente/TagSelectWidget";
import { useAuth } from "@/lib/AuthContext";

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

function safeName(name) {
  return (name || "")
    .replace(/[äÄ]/g, "ae").replace(/[öÖ]/g, "oe").replace(/[üÜ]/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

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
    if (!file || !custId || !name.trim()) { toast.error("Bitte Datei, Kunde und Name ausfüllen"); return; }
    if (!year || isNaN(parseInt(year)))   { toast.error("Bitte ein gültiges Jahr eingeben"); return; }
    setUploading(true);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const cleanName = safeName(file.name);

      // 1. DB-Eintrag anlegen (um die ID zu erhalten)
      const { data: newDoc, error: dbErr } = await supabase.from("dokumente")
        .insert({
          customer_id: custId, category, year: parseInt(year),
          name: name.trim(), filename: file.name,
          storage_path: "", file_size: file.size, file_type: file.type,
          tag_ids: tagIds, notes, created_by: authUser?.id,
        })
        .select("id").single();
      if (dbErr) throw new Error(dbErr.message);

      // 2. Datei in Supabase Storage hochladen
      const storagePath = `dokumente/${newDoc.id}/${Date.now()}-${cleanName}`;
      const { error: storErr } = await supabase.storage.from(BUCKET)
        .upload(storagePath, file, { upsert: true, contentType: file.type || "application/octet-stream" });
      if (storErr) {
        try { await supabase.from("dokumente").delete().eq("id", newDoc.id); } catch {}
        throw new Error("Storage-Upload: " + storErr.message);
      }

      // 3. storage_path aktualisieren
      await supabase.from("dokumente").update({ storage_path: storagePath }).eq("id", newDoc.id);

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
      <div style={{ background: s.cardBg, border: "1px solid " + border, borderRadius: 12, padding: 24, width: 680, minWidth: 420, minHeight: 420, maxWidth: "95vw", maxHeight: "92vh", overflow: "auto", resize: "both", position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ color: s.textMain, fontSize: 14, fontWeight: 700 }}>Dokument hochladen</h3>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted }}><X size={18} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Datei */}
          <div onClick={() => fileRef.current?.click()}
            style={{ border: "2px dashed " + (file ? accent : border), borderRadius: 8, padding: 14, textAlign: "center", cursor: "pointer", color: file ? accent : s.textMuted, fontSize: 13 }}>
            {file ? `${file.name} (${formatBytes(file.size)})` : "Datei auswählen oder hierher ziehen"}
            <input ref={fileRef} type="file" style={{ display: "none" }} onChange={e => e.target.files[0] && pickFile(e.target.files[0])} />
          </div>
          {/* Kunde */}
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Kunde *</label>
            <select value={custId} onChange={e => setCustId(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
              <option value="">-- Kunde wählen --</option>
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
            <TagSelectWidget value={tagIds} onChange={setTagIds} onCategoryChange={setCategory} allTags={allTags} s={s} border={border} accent={accent} />
          </div>
          {/* Notiz */}
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Notiz (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inp, resize: "vertical" }} placeholder="Kurze Bemerkung..." />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          <Button variant="outline" onClick={onCancel} style={{ color: s.textMuted, borderColor: border }}>Abbrechen</Button>
          <Button onClick={handleUpload} disabled={uploading || !file || !custId || !year} style={{ background: accent, color: "#fff" }}>
            {uploading ? "Lädt hoch..." : "Hochladen"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit-Dialog ───────────────────────────────────────────────────────────
function EditDialog({ doc, allTags, customers = [], onCancel, onSave, s, border, accent }) {
  const [name,       setName]       = useState(doc.name || "");
  const [customerId, setCustomerId] = useState(doc.customer_id || "");
  const [category,   setCategory]   = useState(doc.category || "steuern");
  const [year,       setYear]       = useState(String(doc.year || CUR_YEAR));
  const [tagIds,     setTagIds]     = useState(doc.tag_ids || []);
  const [notes,      setNotes]      = useState(doc.notes || "");
  const [saving,     setSaving]     = useState(false);

  const inp = { background: s.inputBg, border: "1px solid " + (s.inputBorder || border), color: s.textMain, borderRadius: 6, padding: "5px 8px", fontSize: 13, width: "100%", outline: "none" };

  const handleSave = async () => {
    if (!name.trim() || !year || isNaN(parseInt(year))) { toast.error("Name und Jahr sind Pflicht"); return; }
    if (!customerId) { toast.error("Bitte einen Kunden auswählen"); return; }
    setSaving(true);
    try {
      const { data: updated, error } = await supabase.from("dokumente").update({
        customer_id: customerId, name: name.trim(), category, year: parseInt(year), tag_ids: tagIds, notes,
      }).eq("id", doc.id).select("id");
      if (error) throw new Error(error.message);
      if (!updated || updated.length === 0) throw new Error("Keine Zeile aktualisiert – bitte Seite neu laden");
      toast.success("Gespeichert");
      onSave();
    } catch (e) {
      toast.error("Fehler: " + e.message);
    } finally { setSaving(false); }
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
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Unternehmen *</label>
            <select value={customerId} onChange={e => setCustomerId(e.target.value)}
              style={{ ...inp, cursor: "pointer", borderColor: !customerId ? "#ef4444" : (s.inputBorder || border) }}>
              <option value="">-- Kunde wählen --</option>
              {customers.slice().sort((a,b) => (a.company_name||"").localeCompare(b.company_name||"")).map(cx =>
                <option key={cx.id} value={cx.id}>{cx.company_name}</option>
              )}
            </select>
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
            <TagSelectWidget value={tagIds} onChange={setTagIds} onCategoryChange={setCategory} allTags={allTags} s={s} border={border} accent={accent} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Notiz</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inp, resize: "vertical" }} placeholder="Kurze Bemerkung..." />
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
  const [editDoc,       setEditDoc]       = useState(null);
  const [signedUrls,    setSignedUrls]    = useState({});
  const [pageTab,       setPageTab]       = useState("alle");

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

  // Von aktuellem User ausgecheckte Dokumente
  const myCheckedOutDocs = useMemo(() =>
    allDoks.filter(d => d.checked_out_by && d.checked_out_by === user?.id),
    [allDoks, user]
  );

  // Tag-Resolver
  const getTag   = (id) => allTags.find(t => t.id === id);
  const tagLabel = (id) => { const t = getTag(id); if (!t) return null; const p = t.parent_id ? getTag(t.parent_id) : null; return p ? `${p.name} / ${t.name}` : t.name; };
  const tagColor = (id) => { const t = getTag(id); if (!t) return accent; return (t.parent_id ? getTag(t.parent_id)?.color : null) || t.color || accent; };

  // Baum
  const tree = useMemo(() => {
    const q = custSearch.toLowerCase();
    return customers.filter(c => {
      const has   = allDoks.some(d => d.customer_id === c.id);
      const match = !q || c.company_name.toLowerCase().includes(q);
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

  // Gefilterte Docs
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

  // Signed URLs für Dokumente mit storage_path
  useEffect(() => {
    const miss = filtered.filter(d => d.storage_path && !signedUrls[d.id]);
    if (!miss.length) return;
    miss.forEach(async doc => {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 3600);
      if (data?.signedUrl) setSignedUrls(prev => ({ ...prev, [doc.id]: data.signedUrl }));
    });
  }, [filtered]);

  // ── Delete ──────────────────────────────────────────────────────────────
  const handleDelete = async (doc) => {
    if (!window.confirm(`"${doc.name}" wirklich löschen?`)) return;
    try {
      if (doc.storage_path) {
        await supabase.storage.from(BUCKET).remove([doc.storage_path]).catch(() => {});
      }
      await entities.Dokument.delete(doc.id);
      queryClient.invalidateQueries({ queryKey: ["dokumente-all"] });
      queryClient.invalidateQueries({ queryKey: ["dokumente"] });
      setSignedUrls(prev => { const n = { ...prev }; delete n[doc.id]; return n; });
      toast.success("Dokument gelöscht");
    } catch (err) { toast.error("Fehler: " + err.message); }
  };

  // ── Checkout (via Artis Agent) ───────────────────────────────────────────
  const handleCheckout = async (doc) => {
    try {
      if (!doc.storage_path) {
        toast.error("Datei nicht verfügbar (kein Storage-Pfad). Bitte erneut hochladen.");
        return;
      }
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const { data: { session } }        = await supabase.auth.getSession();
      const jwt = session?.access_token || "";

      // Checkout-Sperre in DB setzen
      await entities.Dokument.update(doc.id, {
        checked_out_by:      authUser.id,
        checked_out_by_name: user?.full_name || authUser.email,
        checked_out_at:      new Date().toISOString(),
      });
      queryClient.invalidateQueries({ queryKey: ["dokumente-all"] });
      queryClient.invalidateQueries({ queryKey: ["dokumente"] });

      // Signed URL (4 Stunden)
      const { data: urlData } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 4 * 3600);
      const download_url = urlData?.signedUrl || "";
      if (!download_url) { toast.error("Download-URL nicht verfügbar"); return; }

      // Kurzlebigen Agent-Token erstellen
      const { data: tokenRow, error: tokenErr } = await supabase
        .from("agent_tokens")
        .insert({ doc_id: doc.id, item_id: '', filename: doc.filename, jwt, user_id: authUser.id, download_url })
        .select("id").single();
      if (tokenErr || !tokenRow) { toast.error("Fehler: " + (tokenErr?.message || "Token-Fehler")); return; }

      const uri = "artis-open://checkout?token=" + tokenRow.id;
      const _a = document.createElement("a");
      _a.href = uri;
      document.body.appendChild(_a); _a.click(); document.body.removeChild(_a);
      toast.success("Artis Agent öffnet die Datei – wird beim Schließen automatisch eingecheckt.");
    } catch (err) { toast.error("Fehler: " + err.message); }
  };

  // ── Checkin (manuell aus Webapp) ─────────────────────────────────────────
  const handleCheckin = async (doc, file) => {
    try {
      if (file) {
        // Neue Version hochladen
        const cleanName   = safeName(file.name);
        const storagePath = `dokumente/${doc.id}/${Date.now()}-${cleanName}`;
        if (doc.storage_path) {
          await supabase.storage.from(BUCKET).remove([doc.storage_path]).catch(() => {});
        }
        const { error: storErr } = await supabase.storage.from(BUCKET)
          .upload(storagePath, file, { upsert: true, contentType: file.type || "application/octet-stream" });
        if (storErr) throw new Error("Storage-Upload: " + storErr.message);
        await entities.Dokument.update(doc.id, {
          storage_path: storagePath, filename: file.name, file_size: file.size, file_type: file.type,
          checked_out_by: null, checked_out_by_name: null, checked_out_at: null,
        });
        setSignedUrls(prev => { const n = { ...prev }; delete n[doc.id]; return n; });
        toast.success("Eingecheckt – neue Version gespeichert.");
      } else {
        // Nur Sperre aufheben
        await entities.Dokument.update(doc.id, {
          checked_out_by: null, checked_out_by_name: null, checked_out_at: null,
        });
        toast.success("Eingecheckt.");
      }
    } catch (err) { toast.error("Fehler: " + err.message); }
    queryClient.invalidateQueries({ queryKey: ["dokumente-all"] });
    queryClient.invalidateQueries({ queryKey: ["dokumente"] });
  };

  const openCheckin = (doc) => handleCheckin(doc, null);

  const selectCustomer = (id) => { setSelCustomerId(id); setSelCat(null); setSelYear(null); setExpandedC(p => ({ ...p, [id]: true })); };
  const selectCat      = (cid, ck) => { setSelCustomerId(cid); setSelCat(ck); setSelYear(null); setExpandedCat(p => ({ ...p, [cid + "_" + ck]: true })); };

  const treeItem = { display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", cursor: "pointer", borderRadius: 5, fontSize: 12, userSelect: "none" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: s.cardBg }}>

      {/* Header */}
      <div style={{ padding: "12px 20px", borderBottom: "1px solid " + border, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: s.textMain }}>Dokumente</span>
        <div style={{ display: "flex", gap: 2, background: s.sidebarBg, border: "1px solid " + border, borderRadius: 8, padding: 3 }}>
          {[["alle", "Alle Dokumente"], ["ausgecheckt", "Ausgecheckt"]].map(([key, label]) => (
            <button key={key} onClick={() => setPageTab(key)}
              style={{ padding: "4px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: pageTab === key ? 600 : 400,
                background: pageTab === key ? accent : "transparent",
                color: pageTab === key ? "#fff" : s.textMuted, transition: "all 0.15s" }}>
              {label}{key === "ausgecheckt" && myCheckedOutDocs.length > 0 ? " (" + myCheckedOutDocs.length + ")" : ""}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: s.textMuted }}>{allDoks.length} Dok.</span>
        <Button onClick={() => setShowUpload(true)} style={{ background: accent, color: "#fff", fontSize: 12, height: 32, display: "flex", alignItems: "center", gap: 5 }}>
          <Upload size={13} /> Hochladen
        </Button>
      </div>

      {/* Tab: Ausgecheckte Dokumente */}
      {pageTab === "ausgecheckt" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {myCheckedOutDocs.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "50%", color: s.textMuted, gap: 10 }}>
              <span style={{ fontSize: 40 }}>&#128275;</span>
              <span style={{ fontSize: 14 }}>Keine Dokumente ausgecheckt</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 860 }}>
              <div style={{ fontSize: 12, color: s.textMuted, marginBottom: 4 }}>
                {myCheckedOutDocs.length} Dokument{myCheckedOutDocs.length !== 1 ? "e" : ""} von dir ausgecheckt
              </div>
              {myCheckedOutDocs.map(doc => {
                const fi   = getFileInfo(doc.file_type, doc.filename);
                const cat  = CATEGORIES.find(cx => cx.key === doc.category);
                const cust = customers.find(cx => cx.id === doc.customer_id);
                return (
                  <div key={doc.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: s.cardBg,
                    border: "1px solid " + accent + "44", borderRadius: 10, borderLeft: "3px solid " + accent }}>
                    <span style={{ background: fi.color, color: "#fff", borderRadius: 4, padding: "2px 6px", fontSize: 10, fontWeight: 700, flexShrink: 0, minWidth: 36, textAlign: "center" }}>{fi.label}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: s.textMain, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</div>
                      <div style={{ fontSize: 11, color: s.textMuted, marginTop: 3 }}>
                        {cust?.company_name || "Unbekannter Kunde"}
                        {cat ? " · " + cat.icon + " " + cat.label : ""}
                        {doc.year ? " · " + doc.year : ""}
                        {doc.checked_out_at ? " · seit " + new Date(doc.checked_out_at).toLocaleDateString("de-CH") : ""}
                      </div>
                    </div>
                    <button onClick={() => openCheckin(doc)}
                      style={{ background: accent, color: "#fff", border: "none", borderRadius: 7, padding: "6px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <Lock size={13} /> Einchecken
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab: Alle Dokumente */}
      {pageTab === "alle" && (
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ═══ LINKS: Baum ════════════════════════════════════════════════ */}
        <div style={{ width: 260, flexShrink: 0, borderRight: "1px solid " + border, background: s.sidebarBg, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid " + border, position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", color: s.textMuted, pointerEvents: "none" }} />
            <input value={custSearch} onChange={e => setCustSearch(e.target.value)} placeholder="Kunde suchen..."
              style={{ background: s.inputBg, border: "1px solid " + border, color: s.textMain, borderRadius: 6, padding: "4px 8px 4px 24px", fontSize: 12, width: "100%", outline: "none" }} />
          </div>

          <div onClick={() => { setSelCustomerId(null); setSelCat(null); setSelYear(null); }}
            style={{ ...treeItem, margin: "4px 6px", background: !selCustomerId ? s.selBg : "transparent", color: !selCustomerId ? accent : s.textMain, fontWeight: !selCustomerId ? 600 : 400 }}>
            <span style={{ fontSize: 14 }}>{"\uD83D\uDCC1"}</span>
            <span style={{ flex: 1 }}>Alle Dokumente</span>
            <span style={{ fontSize: 10, color: s.textMuted, background: border, borderRadius: 8, padding: "1px 5px" }}>{allDoks.length}</span>
          </div>

          <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
            {isLoading ? <div style={{ padding: 16, color: s.textMuted, fontSize: 12 }}>Lädt...</div>
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

          <div style={{ flex: 1, overflowY: "auto" }}>
            {!selCustomerId ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: s.textMuted, gap: 10 }}>
                <span style={{ fontSize: 48 }}>{"\uD83D\uDCC1"}</span>
                <span style={{ fontSize: 14 }}>Kunden in der Ordnerstruktur auswählen</span>
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
                const isAdmin       = user?.role === "admin";
                const docUrl        = signedUrls[doc.id] || "";
                return (
                  <div key={doc.id}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 16px", borderBottom: "1px solid " + border + "55", transition: "background 0.1s" }}
                    onMouseEnter={e => e.currentTarget.style.background = s.rowHover}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    {/* Typ */}
                    <span onClick={() => { if (!isCheckedOut) handleCheckout(doc); else if (isMyCheckout) openCheckin(doc); else if (docUrl) window.open(docUrl, "_blank"); }}
                      style={{ background: fi.color, color: "#fff", borderRadius: 4, padding: "2px 5px", fontSize: 10, fontWeight: 700, flexShrink: 0, minWidth: 36, textAlign: "center", cursor: "pointer" }}>{fi.label}</span>
                    {/* Name + Tags */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div onClick={() => { if (!isCheckedOut) handleCheckout(doc); else if (isMyCheckout) openCheckin(doc); else if (docUrl) window.open(docUrl, "_blank"); }}
                          style={{ fontSize: 13, color: s.textMain, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500, flex: 1, cursor: "pointer" }}>{doc.name}</div>
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
                    {doc.year && <span style={{ fontSize: 11, color: s.textMuted, background: s.sidebarBg, border: "1px solid " + border, borderRadius: 6, padding: "2px 7px", flexShrink: 0 }}>{doc.year}</span>}
                    <span style={{ fontSize: 11, color: s.textMuted, flexShrink: 0, width: 55, textAlign: "right" }}>{formatBytes(doc.file_size)}</span>
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
                    <button onClick={() => setEditDoc(doc)} title="Bearbeiten"
                      style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}>
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => { if (docUrl) window.open(docUrl, "_blank"); else toast.error("URL nicht verfügbar."); }}
                      title="Herunterladen" style={{ background: "none", border: "none", cursor: "pointer", color: accent, display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}>
                      <Download size={15} />
                    </button>
                    <button onClick={() => !lockedByOther && handleDelete(doc)} title={lockedByOther ? "Gesperrt – kann nicht gelöscht werden" : "Löschen"}
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
      )}

      {/* Dialoge */}
      {showUpload && (
        <UploadDialog customers={customers} preCustomer={selCustomer} allTags={allTags}
          onCancel={() => setShowUpload(false)}
          onUpload={() => { queryClient.invalidateQueries({ queryKey: ["dokumente-all"] }); queryClient.invalidateQueries({ queryKey: ["dokumente"] }); setShowUpload(false); }}
          s={s} border={border} accent={accent} />
      )}
      {editDoc && (
        <EditDialog doc={editDoc} allTags={allTags} customers={customers}
          onCancel={() => setEditDoc(null)}
          onSave={() => { queryClient.refetchQueries({ queryKey: ["dokumente-all"] }); setEditDoc(null); }}
          s={s} border={border} accent={accent} />
      )}
    </div>
  );
}
