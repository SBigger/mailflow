import React, { useState, useMemo, useEffect, useRef, useContext } from "react";
import { Upload, Search, X, Download, Trash2, ChevronDown, ChevronRight, Pencil, Lock, LockOpen, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeContext } from "@/Layout";
import { supabase, entities } from "@/api/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import TagSelectWidget from "@/components/dokumente/TagSelectWidget";
import { useAuth } from "@/lib/AuthContext";

const BUCKET   = "dokumente";

// SharePoint Helper
const SPFILES  = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/sharepoint-files';
async function spCall(jwt, body) {
  const res = await fetch(SPFILES, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || e.message || `Fehler ${res.status}`); }
  return res.json();
}
async function spUpload(jwt, file, customer_id, category, year) {
  const form = new FormData();
  form.append('action', 'upload');
  form.append('file', file);
  form.append('customer_id', customer_id);
  form.append('category', category);
  form.append('year', String(year));
  form.append('filename', file.name);
  const res = await fetch(SPFILES, { method: 'POST', headers: { Authorization: 'Bearer ' + jwt }, body: form });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || e.message || 'Upload fehlgeschlagen'); }
  return res.json();
}

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

// ─── Upload-Dialog ────────────────────────────────────────────────────────
function UploadDialog({ customerId, allTags, onCancel, onUploaded, s, border, accent }) {
  const [file,      setFile]      = useState(null);
  const [name,      setName]      = useState("");
  const [category,  setCategory]  = useState("steuern");
  const [year,      setYear]      = useState(String(CUR_YEAR));
  const [tagIds,    setTagIds]    = useState([]);
  const [notes,     setNotes]     = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef();

  const inp = { background: s.inputBg, border: "1px solid " + (s.inputBorder || border), color: s.textMain, borderRadius: 6, padding: "5px 8px", fontSize: 13, width: "100%", outline: "none" };

  const pickFile = (f) => {
    setFile(f);
    setName(f.name.replace(/\.[^.]+$/, ""));
    const y = detectYear(f.name);
    if (y) setYear(String(y));
  };

  const handleUpload = async () => {
    if (!file || !name.trim())              { toast.error("Bitte Datei und Name ausfullen"); return; }
    if (!year || isNaN(parseInt(year)))     { toast.error("Bitte ein gueltiges Jahr eingeben"); return; }
    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;
      if (!jwt) throw new Error('Nicht angemeldet');
      const sp = await spUpload(jwt, file, customerId, category, year);
      await entities.Dokument.create({ customer_id: customerId, category, year: parseInt(year), name: name.trim(), filename: file.name, sharepoint_item_id: sp.item_id, sharepoint_web_url: sp.web_url, storage_path: '', file_size: file.size, file_type: file.type, tag_ids: tagIds, notes });
      toast.success("Dokument hochgeladen");
      onUploaded();
    } catch (err) {
      console.error("Upload error:", err);
      toast.error("Fehler: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: s.cardBg, border: "1px solid " + border, borderRadius: 12, padding: 24, width: 500, maxHeight: "90vh", overflowY: "auto" }}>
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
              <input type="number" value={year} min="2000" max="2099" onChange={e => setYear(e.target.value)}
                style={{ ...inp, borderColor: !year ? "#ef4444" : (s.inputBorder || border) }} placeholder="z.B. 2025" />
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
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inp, resize: "none" }} placeholder="Kurze Bemerkung..." />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          <Button variant="outline" onClick={onCancel} style={{ color: s.textMuted, borderColor: border }}>Abbrechen</Button>
          <Button onClick={handleUpload} disabled={uploading || !file || !year} style={{ background: accent, color: "#fff" }}>
            {uploading ? "Laedt hoch..." : "Hochladen"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit-Dialog ──────────────────────────────────────────────────────────
function EditDialog({ doc, allTags, customers = [], onCancel, onSaved, s, border, accent }) {
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
      await entities.Dokument.update(doc.id, { customer_id: customerId, name: name.trim(), category, year: parseInt(year), tag_ids: tagIds, notes });
      toast.success("Gespeichert");
      onSaved();
    } catch (e) {
      toast.error("Fehler: " + e.message);
    } finally { setSaving(false); }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: s.cardBg, border: "1px solid " + border, borderRadius: 12, padding: 24, width: 460, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ color: s.textMain, fontSize: 14, fontWeight: 700 }}>Dokument bearbeiten</h3>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted }}><X size={18} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Datei</label>
            <div style={{ fontSize: 12, color: s.textMuted, padding: "5px 8px", background: s.sidebarBg || s.inputBg, borderRadius: 6, border: "1px solid " + border }}>{doc.filename}</div>
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
              <input type="number" value={year} min="2000" max="2099" onChange={e => setYear(e.target.value)}
                style={{ ...inp, borderColor: !year ? "#ef4444" : (s.inputBorder || border) }} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Tags</label>
            <TagSelectWidget value={tagIds} onChange={setTagIds} onCategoryChange={setCategory} allTags={allTags} s={s} border={border} accent={accent} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Notiz</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inp, resize: "none" }} />
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

// ─── Hauptkomponente ──────────────────────────────────────────────────────
export default function CustomerDokumenteTab({ customerId }) {
  const { theme } = useContext(ThemeContext);
  const { user }  = useAuth();
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const s = {
    cardBg:     isArtis ? "#ffffff" : isLight ? "#ffffff" : "#27272a",
    border:     isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "#3f3f46",
    textMain:   isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7",
    textMuted:  isArtis ? "#6b826b" : isLight ? "#7a7a9a" : "#71717a",
    inputBg:    isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(24,24,27,0.8)",
    inputBorder:isArtis ? "#bfcfbf" : isLight ? "#c8c8dc" : "#3f3f46",
    sidebarBg:  isArtis ? "#f5f8f5" : isLight ? "#f5f5fc" : "#1f1f23",
    selBg:      isArtis ? "rgba(122,155,127,0.18)" : isLight ? "rgba(99,102,241,0.13)" : "rgba(99,102,241,0.18)",
    rowHover:   isArtis ? "rgba(122,155,127,0.07)" : isLight ? "rgba(99,102,241,0.05)" : "rgba(255,255,255,0.03)",
  };
  const border = s.border;
  const accent = isArtis ? "#4a7a4f" : "#7c3aed";
  const queryClient = useQueryClient();

  const [selCat,      setSelCat]      = useState(null);
  const [selYear,     setSelYear]     = useState(null);
  const [expandedCat, setExpandedCat] = useState({});
  const [fileSearch,  setFileSearch]  = useState("");
  const [showUpload,  setShowUpload]  = useState(false);
  const [editDoc,        setEditDoc]        = useState(null);
  const [checkinDoc,     setCheckinDoc]     = useState(null);
  const [checkinHandle,  setCheckinHandle]  = useState(null);
  const [signedUrls,  setSignedUrls]  = useState({});
  const [isDragging,  setIsDragging]  = useState(false);
  const [dragFile,    setDragFile]    = useState(null);

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["dokumente", customerId],
    queryFn:  () => entities.Dokument.filter({ customer_id: customerId }, "-created_at"),
    enabled:  !!customerId,
  });
  const { data: allTags = [] } = useQuery({
    queryKey: ["dok_tags"],
    queryFn:  () => entities.DokTag.list("sort_order"),
  });
  const { data: allCustomers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn:  () => entities.Customer.list("company_name"),
  });

  // Tag-Resolver
  const getTag   = (id) => allTags.find(t => t.id === id);
  const tagLabel = (id) => { const t = getTag(id); if (!t) return null; const p = t.parent_id ? getTag(t.parent_id) : null; return p ? `${p.name} / ${t.name}` : t.name; };
  const tagColor = (id) => { const t = getTag(id); if (!t) return accent; return (t.parent_id ? getTag(t.parent_id)?.color : null) || t.color || accent; };

  // Baum: Kategorien mit Jahrgruppen
  const tree = useMemo(() => {
    return CATEGORIES.map(cat => {
      const cd    = docs.filter(d => d.category === cat.key);
      const years = [...new Set(cd.map(d => d.year).filter(Boolean))].sort((a, b) => b - a);
      const noYr  = cd.filter(d => !d.year).length;
      return { ...cat, count: cd.length, years, noYr };
    }).filter(c => c.count > 0);
  }, [docs]);

  // Rechts: gefiltert
  const filtered = useMemo(() => {
    let list = docs;
    if (selCat)                list = list.filter(d => d.category === selCat);
    if (selYear === "__none__") list = list.filter(d => !d.year);
    else if (selYear !== null)  list = list.filter(d => d.year === selYear);
    if (fileSearch.trim()) {
      const q = fileSearch.toLowerCase();
      list = list.filter(d => d.name.toLowerCase().includes(q));
    }
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [docs, selCat, selYear, fileSearch]);

  // Signed URLs
  useEffect(() => {
    const miss = filtered.filter(d => !signedUrls[d.id]);
    if (!miss.length) return;
    miss.forEach(async doc => {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 3600);
      if (data?.signedUrl) setSignedUrls(p => ({ ...p, [doc.id]: data.signedUrl }));
    });
  }, [filtered]);

  const handleDelete = async (doc) => {
    if (!window.confirm(`"${doc.name}" wirklich löschen?`)) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token || '';
      if (doc.sharepoint_item_id) {
        await spCall(jwt, { action: 'delete', item_id: doc.sharepoint_item_id }).catch(() => {});
      } else if (doc.storage_path) {
        await supabase.storage.from(BUCKET).remove([doc.storage_path]).catch(() => {});
      }
      await entities.Dokument.delete(doc.id);
      queryClient.invalidateQueries({ queryKey: ["dokumente", customerId] });
      queryClient.invalidateQueries({ queryKey: ["dokumente-all"] });
      setSignedUrls(p => { const n = { ...p }; delete n[doc.id]; return n; });
      toast.success("Dokument gelöscht");
    } catch (err) { toast.error("Fehler: " + err.message); }
  };

  const handleCheckout = async (doc) => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const { data: { session } }        = await supabase.auth.getSession();
      const jwt = session?.access_token || '';

      // Checkout-Sperre sofort in DB setzen (optimistisch)
      await entities.Dokument.update(doc.id, {
        checked_out_by:      authUser.id,
        checked_out_by_name: user?.full_name || authUser.email,
        checked_out_at:      new Date().toISOString(),
      });
      queryClient.invalidateQueries({ queryKey: ["dokumente-all"] });
      queryClient.invalidateQueries({ queryKey: ["dokumente"] });

      // Download-URL holen (SharePoint pre-auth oder Supabase Storage signed URL)
      let download_url = '';
      if (doc.sharepoint_item_id) {
        const dlData = await spCall(jwt, { action: 'get-download-url', item_id: doc.sharepoint_item_id });
        download_url = dlData.download_url || '';
      } else if (doc.storage_path) {
        const { data: urlData } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 4 * 3600);
        download_url = urlData?.signedUrl || '';
      }
      if (!download_url) { toast.error('Download-URL nicht verfögbar'); return; }

      if (doc.sharepoint_item_id || doc.storage_path) {
        // Kurzlebigen Token in DB (JWT + Download-URL sicher, nicht im URI)
        const { data: tokenRow, error: tokenErr } = await supabase
          .from('agent_tokens')
          .insert({ doc_id: doc.id, item_id: doc.sharepoint_item_id || '', filename: doc.filename, jwt, user_id: authUser.id, download_url })
          .select('id').single();
        if (tokenErr || !tokenRow) { toast.error('Fehler: ' + (tokenErr?.message || 'Token-Fehler')); return; }
        const uri = 'artis-open://checkout?token=' + tokenRow.id;
        const _a = document.createElement('a');
        _a.href = uri;
        document.body.appendChild(_a); _a.click(); document.body.removeChild(_a);
        toast.success('Artis Agent öffnet die Datei – wird beim Schließen automatisch eingecheckt.');
      } else {
        toast.error('Datei nicht gefunden (kein SharePoint-Item und kein Storage-Pfad).');
      }
    } catch (err) { toast.error('Fehler: ' + err.message); }
  };
  const openCheckin = (doc) => { handleCheckin(doc, null); };

  const handleCheckin = async (doc, file) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token || '';

      if (file && doc.sharepoint_item_id) {
        // SharePoint: neue Version hochladen + Sperre aufheben (checkin-save)
        const form = new FormData();
        form.append('action', 'checkin-save');
        form.append('doc_id',  doc.id);
        form.append('file',    file, file.name);
        const res = await fetch(SPFILES, {
          method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: form,
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Upload fehlgeschlagen'); }
        setSignedUrls(prev => { const n = { ...prev }; delete n[doc.id]; return n; });
        toast.success('Eingecheckt – neue Version gespeichert.');
      } else if (!file && doc.sharepoint_item_id) {
        // Nur Sperre aufheben
        await spCall(jwt, { action: 'checkin-discard', doc_id: doc.id });
        toast.success('Eingecheckt.');
      } else if (file) {
        // Legacy: Upload zu SharePoint als neues Item
        const sp = await spUpload(jwt, file, doc.customer_id, doc.category, doc.year);
        if (doc.sharepoint_item_id) {
          await spCall(jwt, { action: 'delete', item_id: doc.sharepoint_item_id }).catch(() => {});
        } else if (doc.storage_path) {
          await supabase.storage.from(BUCKET).remove([doc.storage_path]).catch(() => {});
        }
        await entities.Dokument.update(doc.id, {
          sharepoint_item_id: sp.item_id, sharepoint_web_url: sp.web_url,
          storage_path: '', filename: file.name, file_size: file.size, file_type: file.type,
          checked_out_by: null, checked_out_by_name: null, checked_out_at: null,
        });
        setSignedUrls(prev => { const n = { ...prev }; delete n[doc.id]; return n; });
        toast.success('Eingecheckt & neue Version hochgeladen.');
      } else {
        await entities.Dokument.update(doc.id, {
          checked_out_by: null, checked_out_by_name: null, checked_out_at: null,
        });
        toast.success('Eingecheckt.');
      }
    } catch (err) { toast.error('Fehler: ' + err.message); }
    queryClient.invalidateQueries({ queryKey: ["dokumente-all"] });
    queryClient.invalidateQueries({ queryKey: ["dokumente"] });
  };


  // Drag & Drop
  const handleDrop = (e) => {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) { setDragFile(f); setShowUpload(true); }
  };

  const treeItem = { display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", cursor: "pointer", borderRadius: 5, fontSize: 12, userSelect: "none" };

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden", background: s.cardBg, position: "relative" }}
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragging(false); }}
      onDrop={handleDrop}>

      {/* Drag-Overlay */}
      {isDragging && (
        <div style={{ position: "absolute", inset: 0, zIndex: 100, background: accent + "22", border: "2px dashed " + accent, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <span style={{ fontSize: 16, color: accent, fontWeight: 600 }}>Datei hier ablegen...</span>
        </div>
      )}

      {/* ═══ LINKS: Baum ════════════════════════════════════════════════ */}
      <div style={{ width: 230, flexShrink: 0, borderRight: "1px solid " + border, background: s.sidebarBg, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "8px 10px", borderBottom: "1px solid " + border, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: s.textMain }}>Ablage</span>
          <button onClick={() => setShowUpload(true)}
            style={{ background: accent, border: "none", cursor: "pointer", color: "#fff", borderRadius: 5, padding: "3px 8px", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
            <Upload size={11} /> Hochladen
          </button>
        </div>

        {/* "Alle" Root */}
        <div onClick={() => { setSelCat(null); setSelYear(null); }}
          style={{ ...treeItem, margin: "4px 6px", background: !selCat ? s.selBg : "transparent", color: !selCat ? accent : s.textMain, fontWeight: !selCat ? 600 : 400 }}>
          <span style={{ fontSize: 13 }}>{"\uD83D\uDCC1"}</span>
          <span style={{ flex: 1 }}>Alle Dokumente</span>
          <span style={{ fontSize: 10, color: s.textMuted, background: border, borderRadius: 8, padding: "1px 5px" }}>{docs.length}</span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
          {isLoading ? <div style={{ padding: 12, color: s.textMuted, fontSize: 12 }}>Laedt...</div>
            : tree.length === 0 ? <div style={{ padding: 12, color: s.textMuted, fontSize: 12 }}>Noch keine Dokumente</div>
            : tree.map(cat => {
              const isCatSel = selCat === cat.key && selYear === null;
              const isExp    = expandedCat[cat.key];
              return (
                <div key={cat.key} style={{ margin: "1px 6px" }}>
                  <div onClick={() => { setSelCat(cat.key); setSelYear(null); }}
                    style={{ ...treeItem, background: selCat === cat.key ? s.selBg + (isCatSel ? "" : "88") : "transparent", color: selCat === cat.key ? accent : s.textMain, fontWeight: selCat === cat.key ? 600 : 400 }}>
                    <span onClick={e => { e.stopPropagation(); setExpandedCat(p => ({ ...p, [cat.key]: !p[cat.key] })); }}
                      style={{ display: "flex", alignItems: "center", color: s.textMuted, flexShrink: 0, width: 14 }}>
                      {cat.years.length > 0 || cat.noYr > 0
                        ? (isExp ? <ChevronDown size={11} /> : <ChevronRight size={11} />)
                        : <span style={{ width: 11 }} />}
                    </span>
                    <span style={{ fontSize: 13 }}>{cat.icon}</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.label}</span>
                    <span style={{ fontSize: 10, color: s.textMuted, background: border, borderRadius: 8, padding: "1px 5px", flexShrink: 0 }}>{cat.count}</span>
                  </div>

                  {isExp && (
                    <div style={{ paddingLeft: 18 }}>
                      {cat.years.map(yr => {
                        const yrSel = selCat === cat.key && selYear === yr;
                        const cnt   = docs.filter(d => d.category === cat.key && d.year === yr).length;
                        return (
                          <div key={yr} onClick={() => { setSelCat(cat.key); setSelYear(yr); }}
                            style={{ ...treeItem, background: yrSel ? s.selBg : "transparent", color: yrSel ? accent : s.textMain, fontWeight: yrSel ? 600 : 400 }}>
                            <span style={{ width: 11, flexShrink: 0 }} />
                            <span style={{ fontSize: 12 }}>{"\uD83D\uDCC5"}</span>
                            <span style={{ flex: 1 }}>{yr}</span>
                            <span style={{ fontSize: 10, color: s.textMuted, background: border, borderRadius: 8, padding: "1px 5px" }}>{cnt}</span>
                          </div>
                        );
                      })}
                      {cat.noYr > 0 && (
                        <div onClick={() => { setSelCat(cat.key); setSelYear("__none__"); }}
                          style={{ ...treeItem, background: (selCat === cat.key && selYear === "__none__") ? s.selBg : "transparent", color: s.textMuted, fontStyle: "italic" }}>
                          <span style={{ width: 11, flexShrink: 0 }} />
                          <span style={{ fontSize: 12 }}>{"\uD83D\uDCC4"}</span>
                          <span style={{ flex: 1 }}>Kein Jahr</span>
                          <span style={{ fontSize: 10, color: s.textMuted, background: border, borderRadius: 8, padding: "1px 5px" }}>{cat.noYr}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {/* ═══ RECHTS: Dateiliste ═════════════════════════════════════════ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        {/* Topbar */}
        <div style={{ padding: "6px 12px", borderBottom: "1px solid " + border, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: accent, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {selCat ? (CATEGORIES.find(c => c.key === selCat)?.icon + " " + CATEGORIES.find(c => c.key === selCat)?.label) : "Alle"}
            {selYear ? (selYear === "__none__" ? " \u203a Kein Jahr" : " \u203a " + selYear) : ""}
          </span>
          <span style={{ fontSize: 11, color: s.textMuted, flexShrink: 0 }}>({filtered.length})</span>
          <div style={{ position: "relative" }}>
            <Search size={12} style={{ position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)", color: s.textMuted, pointerEvents: "none" }} />
            <input value={fileSearch} onChange={e => setFileSearch(e.target.value)} placeholder="Suchen..."
              style={{ background: s.inputBg, border: "1px solid " + border, color: s.textMain, borderRadius: 5, padding: "3px 6px 3px 22px", fontSize: 12, width: 160, outline: "none" }} />
          </div>
        </div>

        {/* Liste */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "80%", color: s.textMuted, gap: 8 }}>
              <span style={{ fontSize: 32 }}>{"\uD83D\uDCC2"}</span>
              <span style={{ fontSize: 12 }}>Keine Dokumente</span>
              <span style={{ fontSize: 11, opacity: 0.7 }}>Datei hochladen oder hier reinziehen</span>
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
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid " + border + "55", transition: "background 0.1s" }}
                  onMouseEnter={e => e.currentTarget.style.background = s.rowHover}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  {/* Typ */}
                  <span onClick={() => { const _u = doc.sharepoint_web_url || signedUrls[doc.id]; if (!doc.checked_out_by) { handleCheckout(doc); } else if (doc.checked_out_by === user?.id) { openCheckin(doc); } else if (_u) { window.open(_u, '_blank'); } else { toast.error('URL nicht verfügbar.'); } }} style={{ background: fi.color, color: "#fff", borderRadius: 3, padding: "2px 4px", fontSize: 9, fontWeight: 700, flexShrink: 0, minWidth: 30, textAlign: "center", cursor: "pointer" }}>{fi.label}</span>
                  {/* Name + Tags */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <div onClick={() => { const _u = doc.sharepoint_web_url || signedUrls[doc.id]; if (!doc.checked_out_by) { handleCheckout(doc); } else if (doc.checked_out_by === user?.id) { openCheckin(doc); } else if (_u) { window.open(_u, '_blank'); } else { toast.error('URL nicht verfügbar.'); } }} style={{ fontSize: 12, color: s.textMain, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500, flex: 1, cursor: "pointer" }}>{doc.name}</div>
                    {isCheckedOut && (
                      <span title={"Ausgecheckt von " + doc.checked_out_by_name}
                        style={{ fontSize: 9, color: isMyCheckout ? accent : "#f59e0b",
                          background: isMyCheckout ? accent + "18" : "#f59e0b18",
                          border: "1px solid " + (isMyCheckout ? accent + "44" : "#f59e0b44"),
                          borderRadius: 7, padding: "1px 5px", flexShrink: 0,
                          display: "flex", alignItems: "center", gap: 2 }}>
                        <Lock size={8} />
                        {isMyCheckout ? "Ich" : doc.checked_out_by_name}
                      </span>
                    )}
                  </div>
                    <div style={{ display: "flex", gap: 3, marginTop: 2, flexWrap: "wrap", alignItems: "center" }}>
                      {!selCat && cat && <span style={{ fontSize: 9, background: s.sidebarBg, color: s.textMuted, border: "1px solid " + border, borderRadius: 7, padding: "1px 5px" }}>{cat.icon} {cat.label}</span>}
                      {ids.slice(0, 3).map(id => {
                        const lbl = tagLabel(id); const col = tagColor(id);
                        if (!lbl) return null;
                        return <span key={id} style={{ background: col + "22", color: col, border: "1px solid " + col + "55", borderRadius: 7, padding: "1px 6px", fontSize: 9, display: "flex", alignItems: "center", gap: 2 }}>
                          <span style={{ width: 4, height: 4, borderRadius: "50%", background: col }} />{lbl}
                        </span>;
                      })}
                      {ids.length > 3 && <span style={{ fontSize: 9, color: s.textMuted }}>+{ids.length - 3}</span>}
                    </div>
                  </div>
                  {/* Jahr */}
                  {doc.year && <span style={{ fontSize: 10, color: s.textMuted, background: s.sidebarBg, border: "1px solid " + border, borderRadius: 5, padding: "1px 5px", flexShrink: 0 }}>{doc.year}</span>}
                  {/* Groesse */}
                  <span style={{ fontSize: 10, color: s.textMuted, flexShrink: 0, width: 46, textAlign: "right" }}>{formatBytes(doc.file_size)}</span>
                  {/* Checkout / Checkin */}
                  {!isCheckedOut && (
                    <button onClick={() => handleCheckout(doc)} title="Auschecken"
                      style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, display: "flex", alignItems: "center", padding: 3, borderRadius: 3, flexShrink: 0 }}>
                      <LockOpen size={13} />
                    </button>
                  )}
                  {isMyCheckout && (
                    <button onClick={() => openCheckin(doc)} title="Einchecken"
                      style={{ background: "none", border: "none", cursor: "pointer", color: accent, display: "flex", alignItems: "center", padding: 3, borderRadius: 3, flexShrink: 0 }}>
                      <Lock size={13} />
                    </button>
                  )}
                  {lockedByOther && isAdmin && (
                    <button onClick={() => handleCheckin(doc, null)} title="Sperre aufheben (Admin)"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", display: "flex", alignItems: "center", padding: 3, borderRadius: 3, flexShrink: 0 }}>
                      <ShieldAlert size={13} />
                    </button>
                  )}
                  {/* Edit */}
                  <button onClick={() => setEditDoc(doc)} title="Bearbeiten"
                    style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, display: "flex", alignItems: "center", padding: 3, borderRadius: 3, flexShrink: 0 }}>
                    <Pencil size={13} />
                  </button>
                  {/* Download */}
                  <button onClick={() => { const _u = doc.sharepoint_web_url || signedUrls[doc.id]; if (_u) window.open(_u, '_blank'); else toast.error('URL nicht verfügbar.'); }}
                    title="Herunterladen" style={{ background: "none", border: "none", cursor: "pointer", color: accent, display: "flex", alignItems: "center", padding: 3, borderRadius: 3, flexShrink: 0 }}>
                    <Download size={13} />
                  </button>
                  {/* Loeschen */}
                  <button onClick={() => !lockedByOther && handleDelete(doc)} title={lockedByOther ? "Gesperrt" : "Loeschen"}
                    style={{ background: "none", border: "none", cursor: lockedByOther ? "not-allowed" : "pointer", color: lockedByOther ? s.textMuted + "44" : "#ef4444", display: "flex", alignItems: "center", padding: 3, borderRadius: 3, flexShrink: 0 }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Dialoge */}
      {showUpload && (
        <UploadDialog customerId={customerId} allTags={allTags}
          onCancel={() => { setShowUpload(false); setDragFile(null); }}
          onUploaded={() => { queryClient.invalidateQueries({ queryKey: ["dokumente", customerId] }); queryClient.invalidateQueries({ queryKey: ["dokumente-all"] }); setShowUpload(false); setDragFile(null); }}
          s={s} border={border} accent={accent} />
      )}
      {editDoc && (
        <EditDialog doc={editDoc} allTags={allTags} customers={allCustomers}
          onCancel={() => setEditDoc(null)}
          onSaved={() => { queryClient.invalidateQueries({ queryKey: ["dokumente", customerId] }); queryClient.invalidateQueries({ queryKey: ["dokumente-all"] }); setEditDoc(null); }}
          s={s} border={border} accent={accent} />
      )}
      {/* CheckinDialog ersetzt */}
    </div>
  );
}
