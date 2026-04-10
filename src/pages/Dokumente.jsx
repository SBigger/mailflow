import React, { useState, useMemo, useEffect, useRef, useContext } from "react";
import {
  Search,
  Upload,
  Download,
  Trash2,
  ChevronDown,
  ChevronRight,
  X,
  Pencil,
  Lock,
  LockOpen,
  ShieldAlert,
  RefreshCw,
  Link2,
  Copy,
  CheckCheck,
  FolderOpen
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// ─── Dokument-Textextraktion für Volltext-Suche ──────────────────────────────
async function extractDocumentText(file) {
  if (!file) return "";
  const name = file.name?.toLowerCase() || "";
  const type = file.type || "";

  try {
    // PDF → pdfjs-dist
    if (type === "application/pdf" || name.endsWith(".pdf")) {
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      let text = "";
      for (let i = 1; i <= Math.min(pdf.numPages, 100); i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(it => it.str).join(" ") + "\n";
      }
      return text.trim().slice(0, 100000);
    }

    // Excel (.xlsx, .xls, .csv) → xlsx library
    if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
      const { read, utils } = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb  = read(new Uint8Array(buf), { type: "array" });
      let text  = "";
      for (const sheetName of wb.SheetNames) {
        const ws   = wb.Sheets[sheetName];
        const rows = utils.sheet_to_json(ws, { header: 1, defval: "" });
        text += rows.map(r => r.join(" ")).join("\n") + "\n";
      }
      return text.trim().slice(0, 100000);
    }

    // Word (.docx) → XML aus ZIP extrahieren
    if (name.endsWith(".docx")) {
      const { default: JSZip } = await import("jszip");
      const buf  = await file.arrayBuffer();
      const zip  = await JSZip.loadAsync(buf);
      const xml  = await zip.file("word/document.xml")?.async("text") || "";
      const text = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return text.slice(0, 100000);
    }

    // Plaintext (.txt, .md, .csv ohne Extension-Match)
    if (type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
      const text = await file.text();
      return text.slice(0, 100000);
    }

    return "";
  } catch (e) {
    console.warn("Textextraktion fehlgeschlagen für", name, e);
    return "";
  }
}
import { Button } from "@/components/ui/button";
import { ThemeContext } from "@/Layout";
import { supabase, entities } from "@/api/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import TagSelectWidget from "@/components/dokumente/TagSelectWidget";
import { useAuth } from "@/lib/AuthContext";

const BUCKET   = "dokumente";

// ─── SharePoint Helper ───────────────────────────────────────────────────────
const SPFILES = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sharepoint-files`;

async function spCall(jwt, body) {
  const res = await fetch(SPFILES, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `SharePoint Fehler ${res.status}`); }
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
  const res = await fetch(SPFILES, {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: form,
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Upload fehlgeschlagen'); }
  return res.json(); // { item_id, web_url, name, size }
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

// ─── Share-Link Dialog ─────────────────────────────────────────────────────
const SHARE_FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/share-link`;

function ShareLinkDialog({ info, accent, s, border, onClose }) {
  const [expiry,   setExpiry]   = useState("30");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [link,     setLink]     = useState(null);
  const [copied,   setCopied]   = useState(false);

  async function createLink() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;
      if (!jwt) { toast.error("Nicht eingeloggt"); setLoading(false); return; }

      const body = { name: info.name };
      if (info.type === 'doc') body.doc_id      = info.doc_id;
      if (info.customer_id)    body.customer_id  = info.customer_id;
      if (info.category)       body.category     = info.category;
      if (info.year)           body.year         = info.year;
      if (expiry)              body.expires_days = expiry;
      if (password.trim())     body.password     = password.trim();

      const res = await fetch(`${SHARE_FN}?action=create`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.token) {
        setLink(`${window.location.origin}/share/${data.token}`);
      } else {
        toast.error(data.error || "Fehler beim Erstellen");
      }
    } catch (e) {
      toast.error("Fehler: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  function copyLink() {
    if (!link) return;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
  const card    = { background: s.cardBg, border: "1px solid " + border, borderRadius: 14, padding: 28, width: "100%", maxWidth: 460, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" };
  const inp     = { background: s.inputBg, border: "1px solid " + (s.inputBorder || border), borderRadius: 8, color: s.textMain, padding: "8px 12px", width: "100%", fontSize: 13, fontFamily: "inherit", outline: "none" };
  const lbl     = { display: "block", color: s.textMuted, fontSize: 11, marginBottom: 5, fontWeight: 700, letterSpacing: "0.05em" };
  const btn     = (primary) => ({ background: primary ? accent : "transparent", color: primary ? "#fff" : s.textMuted, border: primary ? "none" : "1px solid " + border, borderRadius: 8, padding: "9px 18px", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 });

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={card}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: accent + "18", border: "1px solid " + accent + "44", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Link2 size={16} style={{ color: accent }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: s.textMain, fontWeight: 700, fontSize: 15 }}>
              {info.type === 'folder' ? 'Ordner-Link erstellen' : 'Datei-Link erstellen'}
            </div>
            <div style={{ color: s.textMuted, fontSize: 12, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{info.name}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, fontSize: 16, padding: 4, lineHeight: 1 }}>✕</button>
        </div>

        {!link ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              {/* Ablaufdatum */}
              <div>
                <label style={lbl}>ABLAUFDATUM</label>
                <select value={expiry} onChange={e => setExpiry(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                  <option value="7">7 Tage</option>
                  <option value="30">30 Tage</option>
                  <option value="90">90 Tage</option>
                  <option value="365">1 Jahr</option>
                  <option value="">Unbegrenzt</option>
                </select>
              </div>
              {/* Passwort */}
              <div>
                <label style={lbl}>PASSWORT (optional)</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Kein Passwort"
                  style={inp}
                />
              </div>
            </div>

            {password.trim() && (
              <div style={{ background: accent + "12", border: "1px solid " + accent + "33", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 12, color: accent }}>
                🔒 Link wird mit Passwort geschützt
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={btn(false)} onClick={onClose}>Abbrechen</button>
              <button style={btn(true)} onClick={createLink} disabled={loading}>
                {loading ? "Erstelle..." : <><Link2 size={14} /> Link erstellen</>}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ background: s.sidebarBg, border: "1px solid " + border, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
              <div style={{ color: s.textMuted, fontSize: 10, marginBottom: 5, fontWeight: 700, letterSpacing: "0.05em" }}>LINK</div>
              <div style={{ color: accent, fontSize: 12, wordBreak: "break-all", lineHeight: 1.6 }}>{link}</div>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <button style={{ ...btn(true), flex: 1, justifyContent: "center" }} onClick={copyLink}>
                {copied ? <><CheckCheck size={14} /> Kopiert!</> : <><Copy size={14} /> Link kopieren</>}
              </button>
              <button style={btn(false)} onClick={() => { setLink(null); setCopied(false); setPassword(""); }}>Neu</button>
              <button style={btn(false)} onClick={onClose}>Schliessen</button>
            </div>

            <div style={{ color: s.textMuted, fontSize: 11, textAlign: "center" }}>
              {expiry ? `Gültig für ${expiry} Tage` : "Unbegrenzt gültig"}
              {password.trim() ? " · 🔒 Passwortgeschützt" : ""}
              {" · "}{info.type === 'folder' ? 'Ordner-Inhalt' : 'Datei'} für alle mit dem Link
            </div>
          </>
        )}
      </div>
    </div>
  );
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
  const [errors,     setErrors]     = useState({});
  const fileRef = useRef();

  // Draggable state
  const [dragPos,    setDragPos]    = useState({ x: 0, y: 0 });
  const dragRef      = useRef({ dragging: false, startX: 0, startY: 0, posX: 0, posY: 0 });
  const dialogRef    = useRef();

  const onHeaderMouseDown = (e) => {
    if (e.button !== 0) return;
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, posX: dragPos.x, posY: dragPos.y };
    const onMove = (ev) => {
      if (!dragRef.current.dragging) return;
      setDragPos({ x: dragRef.current.posX + ev.clientX - dragRef.current.startX, y: dragRef.current.posY + ev.clientY - dragRef.current.startY });
    };
    const onUp = () => {
      dragRef.current.dragging = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    e.preventDefault();
  };

  const inp = { background: s.inputBg, border: "1px solid " + (s.inputBorder || border), color: s.textMain, borderRadius: 6, padding: "5px 8px", fontSize: 13, width: "100%", outline: "none" };

  const pickFile = (f) => {
    setFile(f);
    setName(f.name.replace(/\.[^.]+$/, ""));
    const y = detectYear(f.name);
    if (y) setYear(String(y));
  };

  const handleUpload = async () => {
    const newErrors = {};
    if (!file || !custId || !name.trim()) { toast.error("Bitte Datei, Kunde und Name ausf\u00fcllen"); return; }
    if (!year || isNaN(parseInt(year)))   { toast.error("Bitte ein g\u00fcltiges Jahr eingeben"); return; }
    if (!category)                        { newErrors.category = "Bitte eine Kategorie ausw\u00e4hlen."; }
    if (!tagIds || tagIds.length === 0)   { newErrors.tags = "Bitte mindestens einen Tag ausw\u00e4hlen."; }
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }
    setErrors({});
    setUploading(true);
    try {
      // Text extrahieren (PDF, Excel, Word, etc.) für Volltext-Suche
      const contentText = await extractDocumentText(file);

      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
      const path = `${custId}/${fileName}`;
      const { data: uploadData, error: uploadError } = await supabase
          .storage.from(BUCKET)
          .upload(path, file);

      if (uploadError) {
        throw uploadError;
      }
      await entities.Dokument.create({
        customer_id: custId, category, year: parseInt(year),
        name: name.trim(), filename: file.name,
        storage_path: uploadData.path, file_size: file.size, file_type: file.type,
        tag_ids: tagIds, notes,
        content_text: contentText,
      });
      toast.success("Dokument hochgeladen", {closeButton: true});
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
      <div ref={dialogRef} style={{ background: s.cardBg, border: "1px solid " + border, borderRadius: 12, padding: 28, width: 660, minWidth: 500, minHeight: 400, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", resize: "both", transform: `translate(${dragPos.x}px, ${dragPos.y}px)` }}>
        <div onMouseDown={onHeaderMouseDown} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, cursor: "move", userSelect: "none" }}>
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
              <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Kategorie *</label>
              <select value={category} onChange={e => { setCategory(e.target.value); setErrors(prev => ({ ...prev, category: undefined })); }} style={{ ...inp, cursor: "pointer", borderColor: errors.category ? "#ef4444" : (s.inputBorder || border) }}>
                <option value="">-- Kategorie w\u00e4hlen --</option>
                {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
              </select>
              {errors.category && <div style={{ color: "#ef4444", fontSize: 11, marginTop: 3 }}>{errors.category}</div>}
            </div>
            <div>
              <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Jahr *</label>
              <input type="number" value={year} min="2000" max="2099" onChange={e => setYear(e.target.value)} style={{ ...inp, borderColor: !year ? "#ef4444" : (s.inputBorder || border) }} placeholder="z.B. 2025" />
            </div>
          </div>
          {/* Tags */}
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Tags *</label>
            <TagSelectWidget value={tagIds} onChange={(v) => { setTagIds(v); setErrors(prev => ({ ...prev, tags: undefined })); }} allTags={allTags} s={s} border={errors.tags ? "#ef4444" : border} accent={accent} />
            {errors.tags && <div style={{ color: "#ef4444", fontSize: 11, marginTop: 3 }}>{errors.tags}</div>}
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
      await entities.Dokument.update(doc.id, { customer_id: customerId, name: name.trim(), category, year: parseInt(year), tag_ids: tagIds, notes });
      toast.success("Gespeichert", {closeButton: true});
      onSave();
    } catch (e) {
      toast.error("Fehler: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: s.cardBg, border: "1px solid " + border, borderRadius: 12, padding: 28, width: 660, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }}>
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
  const [ftSearch,    setFtSearch]    = useState("");
  const [ftResults,   setFtResults]   = useState(null);
  const [ftSearching, setFtSearching] = useState(false);
  const [syncData, setSyncData ] = useState(false);
  const [highlightDocId, setHighlightDocId] = useState(null);
  const [shareDialog,   setShareDialog]   = useState(null); // { type: 'doc'|'folder', doc?, customer_id?, category?, year?, name? }

  // Volltext-Suche via Supabase RPC (PostgreSQL GIN-Index)
  useEffect(() => {
    const q = ftSearch.trim();
    if (q.length < 2) { setFtResults(null); return; }
    const timer = setTimeout(async () => {
      setFtSearching(true);
      try {
        const { data, error } = await supabase.rpc("search_dokumente", {
          p_query:       q,
          p_customer_id: selCustomerId || null,
          p_limit:       100,
        });
        if (error) throw error;
        setFtResults(data || []);
      } catch (e) { toast.error("Suche fehlgeschlagen: " + e.message); setFtResults([]); }
      finally { setFtSearching(false); }
    }, 350);
    return () => clearTimeout(timer);
  }, [ftSearch, selCustomerId]);

  const [showUpload,    setShowUpload]    = useState(false);
  const [editDoc,        setEditDoc]        = useState(null);
  const [checkinDoc,     setCheckinDoc]     = useState(null);  // wird nicht mehr benoetigt, bleibt fuer Compat
  const [signedUrls,    setSignedUrls]    = useState({});
  const [pageTab,       setPageTab]       = useState('alle');

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

  // ── Stilles Auto-Indexing (wie M-Files Background Service) ──────────────
  // Läuft automatisch im Hintergrund wenn allDoks geladen sind.
  // Kein Button, kein Spinner – transparent für den User.
  const autoIndexRef = useRef(false);
  useEffect(() => {
    if (autoIndexRef.current) return;            // bereits gestartet
    const toIndex = allDoks.filter(d => !d.content_text && d.storage_path);
    if (!toIndex.length) return;
    autoIndexRef.current = true;

    (async () => {
      let done = 0;
      for (const doc of toIndex) {
        try {
          const { data } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 120);
          if (!data?.signedUrl) continue;
          const resp = await fetch(data.signedUrl);
          if (!resp.ok) continue;
          const blob = await resp.blob();
          const file = new File([blob], doc.filename || doc.name || "doc", { type: doc.file_type || "" });
          const text = await extractDocumentText(file);
          if (text) {
            await entities.Dokument.update(doc.id, { content_text: text });
            done++;
          }
        } catch (e) {
          console.warn("[AutoIndex] Fehler bei", doc.id, e);
        }
      }
      if (done > 0) {
        queryClient.invalidateQueries(["dokumente-all"]);
        console.info(`[AutoIndex] ${done} Dokumente im Hintergrund indexiert`);
      }
    })();
  }, [allDoks]);

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

  // Signed URLs nur fuer Legacy-Dokumente (ohne SharePoint)
  useEffect(() => {
    const legacy = filtered.filter(d => !d.sharepoint_web_url && d.storage_path && !signedUrls[d.id]);
    if (!legacy.length) return;

    legacy.forEach(async doc => {
      const storagePath = doc.storage_path.replace('dokumente/', '');
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
      if (error) {
        console.warn("Signed URL nicht verfügbar:", doc.storage_path, error.message);
        return;
      }
      if (data?.signedUrl) setSignedUrls(prev => ({ ...prev, [doc.id]: data.signedUrl }));
    });
  }, [filtered]);

  const downloadDoc = async (doc) => {
    const { data } = await supabase
        .storage
        .from(BUCKET)
        .createSignedUrl(doc.storage_path, 360);

    const fileUrl = data.signedUrl;

    window.open(fileUrl, '_blank');
  }

  // ── URL-Parameter ?open=<doc_id> → Dokument direkt öffnen (von VoxDrop / Smartis) ──
  useEffect(() => {
    if (isLoading || !allDoks.length) return;
    const params = new URLSearchParams(window.location.search);
    const openId = params.get('open');
    if (!openId) return;
    const doc = allDoks.find(d => d.id === openId);
    if (!doc) return;
    // Kunden-Filter setzen und Dokument öffnen
    setSelCustomerId(doc.customer_id);
    setHighlightDocId(doc.id);
    downloadDoc(doc);
    // URL bereinigen
    window.history.replaceState({}, '', '/Dokumente');
  }, [allDoks, isLoading]);

  // ?open=<doc_id> URL parameter support
  useEffect(() => {
    if (isLoading || !allDoks.length) return;
    const params = new URLSearchParams(window.location.search);
    const openId = params.get("open");
    if (!openId) return;
    const doc = allDoks.find(d => d.id === openId);
    if (!doc) return;
    setSelCustomerId(doc.customer_id);
    setHighlightDocId(doc.id);
    downloadDoc(doc);
    window.history.replaceState({}, '', '/Dokumente');
  }, [allDoks, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (doc) => {
    if (!window.confirm(`"${doc.name}" wirklich l\u00f6schen?`)) return;
    try {
      await supabase.storage.from(BUCKET).remove(doc.storage_path);
      await entities.Dokument.delete(doc.id);
      queryClient.invalidateQueries(["dokumente-all"]);
      toast.success("Dokument gel\u00f6scht", {closeButton: true});
    } catch (err) { toast.error("Fehler: " + err.message); }
  };

  const handleCheckout = async (doc) => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const { data: { session } }        = await supabase.auth.getSession();
      const jwt = session?.access_token || '';

      // Datei-URL ermitteln BEVOR die Checkout-Sperre gesetzt wird
      let fileUrl = '';
      if (doc.sharepoint_web_url) {
        // SharePoint-Dokument: direkte Web-URL verwenden
        fileUrl = doc.sharepoint_web_url;
      } else if (doc.storage_path) {
        // Legacy Supabase Storage: signierte URL erstellen
        const storagePath = doc.storage_path.replace('dokumente/', '');
        const { data: urlData } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
        if (!urlData?.signedUrl) {
          toast.error('Fehler beim Erstellen der Download-URL');
          return;
        }
        fileUrl = urlData.signedUrl;
      } else {
        toast.error('Keine Datei-URL verfügbar.');
        return;
      }

      // Checkout-Sperre in DB setzen (erst nachdem URL erfolgreich ermittelt wurde)
      await entities.Dokument.update(doc.id, {
        checked_out_by:      authUser.id,
        checked_out_by_name: user?.full_name || authUser.email,
        checked_out_at:      new Date().toISOString(),
      });
      queryClient.invalidateQueries({ queryKey: ["dokumente-all"] });

      const uri = [
          'artis-open://checkout',
          '?doc_id=',   encodeURIComponent(doc.id),
          '&jwt=',      encodeURIComponent(jwt),
          '&item_id=',  encodeURIComponent(fileUrl),
          '&filename=', encodeURIComponent(doc.filename),
        ].join('');
      const _a = document.createElement('a');
      _a.href = uri;
      document.body.appendChild(_a); _a.click();
      document.body.removeChild(_a);
      toast.success('Artis Agent öffnet die Datei – wird beim Schließen automatisch eingecheckt.');
    } catch (err) {
      toast.error('Fehler: ' + err.message);
    }
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
  };



  const selectCustomer = (id) => { setSelCustomerId(id); setSelCat(null); setSelYear(null); setExpandedC(p => ({ ...p, [id]: true })); };
  const selectCat      = (cid, ck) => { setSelCustomerId(cid); setSelCat(ck); setSelYear(null); setExpandedCat(p => ({ ...p, [cid + "_" + ck]: true })); };

  const treeItem = { display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", cursor: "pointer", borderRadius: 5, fontSize: 12, userSelect: "none" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: s.cardBg }}>

      {/* Header */}
      <div style={{ padding: "12px 20px", borderBottom: "1px solid " + border, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: s.textMain }}>Dokumente</span>
        {/* Tabs */}
        <div style={{ display: "flex", gap: 2, background: s.sidebarBg, border: "1px solid " + border, borderRadius: 8, padding: 3 }}>
          {[['alle', 'Alle Dokumente'], ['ausgecheckt', 'Ausgecheckt']].map(([key, label]) => (
            <button key={key} onClick={() => setPageTab(key)}
              style={{ padding: "4px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: pageTab === key ? 600 : 400,
                background: pageTab === key ? accent : "transparent",
                color: pageTab === key ? "#fff" : s.textMuted, transition: "all 0.15s" }}>
              {label}{key === 'ausgecheckt' && myCheckedOutDocs.length > 0 ? ' (' + myCheckedOutDocs.length + ')' : ''}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {/* ── Volltext-Suche ── */}
        <div style={{ position: "relative" }}>
          <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: ftSearching ? accent : s.textMuted, pointerEvents: "none" }} />
          <input
            value={ftSearch}
            onChange={e => setFtSearch(e.target.value)}
            placeholder={selCustomerId ? "Volltext-Suche (dieser Kunde)…" : "Volltext-Suche über alle Dokumente…"}
            style={{ background: s.inputBg, border: "1px solid " + (ftSearch ? accent : border), color: s.textMain, borderRadius: 8, padding: "5px 32px 5px 30px", fontSize: 12, width: 280, outline: "none", transition: "border 0.2s" }}
          />
          {ftSearch && (
            <button onClick={() => { setFtSearch(""); setFtResults(null); }}
              style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: s.textMuted, padding: 0 }}>
              <X size={13} />
            </button>
          )}
        </div>
        <span style={{ fontSize: 12, color: s.textMuted }}>{allDoks.length} Dok.</span>
        <Button onClick={() => setShowUpload(true)} style={{ background: accent, color: "#fff", fontSize: 12, height: 32, display: "flex", alignItems: "center", gap: 5 }}>
          <Upload size={13} /> Hochladen
        </Button>
      </div>

      {/* ── Volltext-Suchergebnisse (überlagert normale Ansicht) ── */}
      {ftResults !== null && (
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
          <div style={{ fontSize: 12, color: s.textMuted, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
            {ftSearching
              ? <><Search size={12} style={{ color: accent }} /> Suche läuft…</>
              : <><Search size={12} style={{ color: accent }} />
                  <strong style={{ color: s.textMain }}>{ftResults.length}</strong> Treffer für „{ftSearch}"
                  {selCustomerId && <span> (nur dieser Kunde)</span>}
                </>
            }
          </div>
          {ftResults.length === 0 && !ftSearching && (
            <div style={{ textAlign: "center", color: s.textMuted, paddingTop: 60, fontSize: 14 }}>
              Kein Treffer — versuche andere Begriffe oder weniger spezifische Wörter.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {ftResults.map(doc => {
              const fi   = getFileInfo(doc.file_type, doc.filename);
              const cat  = CATEGORIES.find(c => c.key === doc.category);
              const cust = customers.find(c => c.id === doc.customer_id);
              return (
                <div key={doc.id}
                  onClick={() => { setFtSearch(""); setFtResults(null); setSelCustomerId(doc.customer_id); setSelCat(doc.category); setSelYear(doc.year || null); }}
                  style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 14px", background: s.cardBg,
                    border: "1px solid " + border, borderRadius: 8, cursor: "pointer", transition: "border 0.15s" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = accent}
                  onMouseLeave={e => e.currentTarget.style.borderColor = border}>
                  <span style={{ background: fi.color, color: "#fff", borderRadius: 4, padding: "2px 6px", fontSize: 10, fontWeight: 700, flexShrink: 0, minWidth: 36, textAlign: "center", marginTop: 2 }}>{fi.label}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: s.textMain, fontWeight: 600 }}>{doc.name}</div>
                    {doc.headline && (
                      <div style={{ fontSize: 11, color: s.textMuted, marginTop: 2, fontStyle: "italic" }}
                        dangerouslySetInnerHTML={{ __html: doc.headline.replace(/<b>/g, `<b style="color:${accent};font-style:normal">`).replace(/<\/b>/g, "</b>") }} />
                    )}
                    <div style={{ fontSize: 11, color: s.textMuted, marginTop: 3, display: "flex", gap: 8 }}>
                      {cust && <span style={{ color: accent, fontWeight: 500 }}>{cust.company_name}</span>}
                      {cat && <span>{cat.icon} {cat.label}</span>}
                      {doc.year && <span>{doc.year}</span>}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, alignSelf: "center", display: "flex", gap: 2 }}>
                    {[1,2,3,4,5].map(i => {
                      const filled = (doc.rank || 0) >= i * 0.06;
                      return <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: filled ? accent : border }} />;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pageTab === 'ausgecheckt' && !ftResults && (
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

      {pageTab === 'alle' && !ftResults && (
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
                            <span onClick={e => { e.stopPropagation(); setShareDialog({ type: 'folder', customer_id: cust.id, category: cat.key, name: cust.company_name + " – " + cat.label }); }}
                              title="Ordner-Link erstellen"
                              style={{ display: "flex", alignItems: "center", color: s.textMuted, padding: "0 2px", cursor: "pointer", flexShrink: 0, opacity: 0.6 }}>
                              <Link2 size={11} />
                            </span>
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
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 16px", borderBottom: "1px solid " + border + "55", transition: "background 0.1s", ...(doc.id === highlightDocId ? { boxShadow: "0 0 0 2px " + accent + "88 inset", background: accent + "12", borderRadius: 6 } : {}) }}
                    onMouseEnter={e => e.currentTarget.style.background = s.rowHover}
                    onMouseLeave={e => e.currentTarget.style.background = doc.id === highlightDocId ? accent + "12" : "transparent"}>
                    {/* Typ */}
                    <span onClick={() => { const _u = doc.sharepoint_web_url || signedUrls[doc.id]; if (!doc.checked_out_by) { handleCheckout(doc); } else if (doc.checked_out_by === user?.id) { openCheckin(doc); } else if (_u) { window.open(_u, '_blank'); } else { toast.error('URL nicht verfuegbar.'); } }} style={{ background: fi.color, color: "#fff", borderRadius: 4, padding: "2px 5px", fontSize: 10, fontWeight: 700, flexShrink: 0, minWidth: 36, textAlign: "center", cursor: "pointer" }}>{fi.label}</span>
                    {/* Name + Tags */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div onClick={() => { const _u = doc.sharepoint_web_url || signedUrls[doc.id]; if (!doc.checked_out_by) { handleCheckout(doc); } else if (doc.checked_out_by === user?.id) { openCheckin(doc); } else if (_u) { window.open(_u, '_blank'); } else { toast.error('URL nicht verfuegbar.'); } }} style={{ fontSize: 13, color: s.textMain, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500, flex: 1, cursor: "pointer" }}>{doc.name}</div>
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
                    <button onClick={() => { downloadDoc(doc) }}
                      title="Herunterladen" style={{ background: "none", border: "none", cursor: "pointer", color: accent, display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}>
                      <Download size={15} />
                    </button>
                    {/* Share */}
                    <button
                      onClick={() => setShareDialog({ type: 'doc', doc_id: doc.id, name: doc.name, customer_id: doc.customer_id })}
                      title="Link erstellen"
                      style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, display: "flex", alignItems: "center", padding: 4, borderRadius: 4, flexShrink: 0 }}>
                      <Link2 size={15} />
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
      )}

      {/* Dialoge */}
      {showUpload && (
        <UploadDialog customers={customers} preCustomer={selCustomer} allTags={allTags}
          onCancel={() => setShowUpload(false)}
          onUpload={() => { queryClient.invalidateQueries({ queryKey: ["dokumente-all"] }); setShowUpload(false); }}
          s={s} border={border} accent={accent} />
      )}
      {editDoc && (
        <EditDialog doc={editDoc} allTags={allTags} customers={customers}
          onCancel={() => setEditDoc(null)}
          onSave={() => { queryClient.invalidateQueries({ queryKey: ["dokumente-all"] });  setEditDoc(null); }}
          s={s} border={border} accent={accent} />
      )}
      {/* CheckinDialog ersetzt durch direktes handleCheckin */}

      {/* Share-Link Dialog */}
      {shareDialog && (
        <ShareLinkDialog
          info={shareDialog}
          accent={accent}
          s={s}
          border={border}
          onClose={() => setShareDialog(null)}
        />
      )}
    </div>
  );
}
