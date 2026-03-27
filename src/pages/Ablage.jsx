import React, { useState, useEffect, useRef, useContext, useCallback } from "react";
import {
  Upload, Search, Folder, FolderPlus, FileText, File, Image,
  Table2, X, ChevronRight, ChevronDown, LayoutList, LayoutGrid,
  Download, Trash2, Pencil, MoreHorizontal, Eye
} from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import { useAuth } from "@/lib/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// ─── Konstanten ─────────────────────────────────────────────────────────────
const BUCKET = "team-ablage";

const VORDEFINIERTE_TAGS = [
  "Steuern",
  "Betriebswirtschaft",
  "Lohnbuchhaltung",
  "Jahresabschluss",
  "Korrespondenz",
  "Vertraege",
  "Sonstiges",
];

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function getFileIcon(dateityp, dateiname) {
  const ext = (dateiname || "").split(".").pop().toLowerCase();
  if (dateityp === "application/pdf" || ext === "pdf")
    return { icon: FileText, color: "#dc2626", label: "PDF" };
  if (dateityp?.includes("spreadsheet") || ["xls", "xlsx", "csv"].includes(ext))
    return { icon: Table2, color: "#16a34a", label: "XLS" };
  if (dateityp?.includes("word") || ["doc", "docx"].includes(ext))
    return { icon: FileText, color: "#2563eb", label: "DOC" };
  if (dateityp?.startsWith("image/"))
    return { icon: Image, color: "#7c3aed", label: "IMG" };
  return { icon: File, color: "#71717a", label: ext?.toUpperCase() || "FILE" };
}

function isImage(dateityp) {
  return dateityp?.startsWith("image/");
}

function isPdf(dateityp, dateiname) {
  return dateityp === "application/pdf" || (dateiname || "").endsWith(".pdf");
}

// ─── Upload-Dialog ────────────────────────────────────────────────────────────
function UploadDialog({ customers, existingOrdner, onCancel, onUpload, s, border, accent }) {
  const [file, setFile] = useState(null);
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState([]);
  const [ordner, setOrdner] = useState("/");
  const [customOrdner, setCustomOrdner] = useState("");
  const [beschreibung, setBeschreibung] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();
  const { user } = useAuth();

  const inp = {
    background: s.inputBg,
    border: "1px solid " + border,
    color: s.textMain,
    borderRadius: 6,
    padding: "5px 8px",
    fontSize: 13,
    width: "100%",
    outline: "none",
  };

  const filteredCustomers = customers.filter(c =>
    !customerSearch || c.company_name?.toLowerCase().includes(customerSearch.toLowerCase())
  );

  const toggleTag = (tag) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  };

  const handleUpload = async () => {
    if (!file) { toast.error("Bitte eine Datei auswaehlen"); return; }
    setUploading(true);
    try {
      const finalOrdner = ordner === "__custom__" ? (customOrdner.trim() || "/") : ordner;
      const safeOrdner = finalOrdner.startsWith("/") ? finalOrdner : "/" + finalOrdner;
      const ext = file.name.split(".").pop();
      const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const storagePath = `${safeOrdner}/${uniqueName}`.replace(/\/+/g, "/");

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, file);

      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase.from("ablage_dateien").insert({
        storage_path: uploadData.path,
        dateiname: file.name,
        dateityp: file.type,
        groesse: file.size,
        customer_id: customerId || null,
        tags: selectedTags,
        beschreibung: beschreibung.trim() || null,
        ordner: safeOrdner,
        created_by: user?.id || null,
      });

      if (dbError) throw dbError;

      toast.success("Datei hochgeladen");
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
      <div style={{ background: s.cardBg, border: "1px solid " + border, borderRadius: 12, padding: 28, width: 580, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h3 style={{ color: s.textMain, fontSize: 15, fontWeight: 700, margin: 0 }}>Datei hochladen</h3>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Drop Zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            style={{
              border: "2px dashed " + (dragOver ? accent : (file ? accent : border)),
              borderRadius: 8,
              padding: 20,
              textAlign: "center",
              cursor: "pointer",
              color: file ? accent : s.textMuted,
              fontSize: 13,
              background: dragOver ? (s.selBg) : "transparent",
              transition: "all 0.15s",
            }}
          >
            <Upload size={20} style={{ margin: "0 auto 8px", display: "block", opacity: 0.6 }} />
            {file
              ? `${file.name} (${formatBytes(file.size)})`
              : "Datei hierher ziehen oder klicken zum Auswaehlen"}
            <input ref={fileRef} type="file" style={{ display: "none" }} onChange={e => e.target.files[0] && setFile(e.target.files[0])} />
          </div>

          {/* Kunde */}
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Kunde (optional)</label>
            <input
              value={customerSearch}
              onChange={e => setCustomerSearch(e.target.value)}
              style={{ ...inp, marginBottom: 4 }}
              placeholder="Kunde suchen..."
            />
            <select value={customerId} onChange={e => setCustomerId(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
              <option value="">-- Kein Kunde --</option>
              {filteredCustomers.map(c => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
          </div>

          {/* Tags */}
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 6 }}>Tags</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {VORDEFINIERTE_TAGS.map(tag => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  style={{
                    border: "1px solid " + (selectedTags.includes(tag) ? accent : border),
                    background: selectedTags.includes(tag) ? accent : "transparent",
                    color: selectedTags.includes(tag) ? "#fff" : s.textMuted,
                    borderRadius: 20,
                    padding: "3px 10px",
                    fontSize: 12,
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Ordner */}
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Ordner</label>
            <select value={ordner} onChange={e => setOrdner(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
              <option value="/">/  (Root)</option>
              {existingOrdner.filter(o => o !== "/").map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
              <option value="__custom__">+ Neuer Ordner...</option>
            </select>
            {ordner === "__custom__" && (
              <input
                value={customOrdner}
                onChange={e => setCustomOrdner(e.target.value)}
                style={{ ...inp, marginTop: 6 }}
                placeholder="/Neuer Ordner (z.B. /Steuern)"
              />
            )}
          </div>

          {/* Beschreibung */}
          <div>
            <label style={{ fontSize: 12, color: s.textMuted, display: "block", marginBottom: 3 }}>Beschreibung (optional)</label>
            <textarea
              value={beschreibung}
              onChange={e => setBeschreibung(e.target.value)}
              rows={2}
              style={{ ...inp, resize: "none" }}
              placeholder="Kurze Beschreibung..."
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <Button variant="outline" onClick={onCancel} style={{ color: s.textMuted, borderColor: border }}>
            Abbrechen
          </Button>
          <Button
            onClick={handleUpload}
            disabled={uploading || !file}
            style={{ background: accent, color: "#fff", opacity: uploading || !file ? 0.6 : 1 }}
          >
            {uploading ? "Laedt hoch..." : "Hochladen"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Neuer-Ordner-Dialog ──────────────────────────────────────────────────────
function NeuerOrdnerDialog({ onCancel, onCreate, s, border, accent }) {
  const [name, setName] = useState("");

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Bitte Ordnername eingeben"); return; }
    const ordnerPfad = trimmed.startsWith("/") ? trimmed : "/" + trimmed;
    onCreate(ordnerPfad);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: s.cardBg, border: "1px solid " + border, borderRadius: 12, padding: 24, width: 360, maxWidth: "95vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ color: s.textMain, fontSize: 14, fontWeight: 700, margin: 0 }}>Neuer Ordner</h3>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted }}>
            <X size={16} />
          </button>
        </div>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleCreate()}
          style={{ background: s.inputBg, border: "1px solid " + border, color: s.textMain, borderRadius: 6, padding: "6px 10px", fontSize: 13, width: "100%", outline: "none", marginBottom: 14 }}
          placeholder="Ordnername (z.B. Steuern)"
          autoFocus
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="outline" onClick={onCancel} style={{ color: s.textMuted, borderColor: border }}>Abbrechen</Button>
          <Button onClick={handleCreate} style={{ background: accent, color: "#fff" }}>Erstellen</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Umbenennen-Dialog ────────────────────────────────────────────────────────
function UmbenennenDialog({ datei, onCancel, onSave, s, border, accent }) {
  const [name, setName] = useState(datei.dateiname || "");

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: s.cardBg, border: "1px solid " + border, borderRadius: 12, padding: 24, width: 380, maxWidth: "95vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ color: s.textMain, fontSize: 14, fontWeight: 700, margin: 0 }}>Umbenennen</h3>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted }}>
            <X size={16} />
          </button>
        </div>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && onSave(name)}
          style={{ background: s.inputBg, border: "1px solid " + border, color: s.textMain, borderRadius: 6, padding: "6px 10px", fontSize: 13, width: "100%", outline: "none", marginBottom: 14 }}
          autoFocus
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="outline" onClick={onCancel} style={{ color: s.textMuted, borderColor: border }}>Abbrechen</Button>
          <Button onClick={() => onSave(name)} style={{ background: accent, color: "#fff" }}>Speichern</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Hauptkomponente ──────────────────────────────────────────────────────────
export default function Ablage() {
  const { theme } = useContext(ThemeContext);
  const { user } = useAuth();

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

  // State
  const [dateien, setDateien] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrdner, setSelectedOrdner] = useState("/");
  const [expandedOrdner, setExpandedOrdner] = useState({ "/": true });
  const [selectedDatei, setSelectedDatei] = useState(null);
  const [viewMode, setViewMode] = useState("list"); // "list" | "grid"
  const [search, setSearch] = useState("");
  const [filterCustomer, setFilterCustomer] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showNeuerOrdnerDialog, setShowNeuerOrdnerDialog] = useState(false);
  const [umbenennenDatei, setUmbenennenDatei] = useState(null);
  const [contextMenu, setContextMenu] = useState(null); // { datei, x, y }
  const [signedUrls, setSignedUrls] = useState({});
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const contextMenuRef = useRef();

  // ─── Daten laden ───────────────────────────────────────────────────────────
  const loadDateien = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("ablage_dateien")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setDateien(data || []);
    } catch (err) {
      toast.error("Fehler beim Laden: " + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCustomers = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("customers")
        .select("id, company_name")
        .order("company_name");
      setCustomers(data || []);
    } catch {}
  }, []);

  useEffect(() => {
    loadDateien();
    loadCustomers();
  }, [loadDateien, loadCustomers]);

  // Context-Menu schliessen bei Klick ausserhalb
  useEffect(() => {
    const handler = (e) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ─── Ordner-Struktur ───────────────────────────────────────────────────────
  const alleOrdner = React.useMemo(() => {
    const set = new Set(["/"]);
    dateien.forEach(d => { if (d.ordner) set.add(d.ordner); });
    return Array.from(set).sort();
  }, [dateien]);

  // ─── Gefilterte Dateien ────────────────────────────────────────────────────
  const gefilterteDateien = React.useMemo(() => {
    return dateien.filter(d => {
      if (selectedOrdner !== "/" && d.ordner !== selectedOrdner) return false;
      if (selectedOrdner === "/" && d.ordner !== "/" && d.ordner) {
        // Im Root nur Dateien ohne speziellen Ordner anzeigen
        // (Ausnahme: alle anzeigen wenn kein spezifischer Ordner selektiert)
      }
      if (search && !d.dateiname?.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterCustomer && d.customer_id !== filterCustomer) return false;
      if (filterTag && !(d.tags || []).includes(filterTag)) return false;
      return true;
    });
  }, [dateien, selectedOrdner, search, filterCustomer, filterTag]);

  // ─── Signed URL holen ──────────────────────────────────────────────────────
  const getSignedUrl = useCallback(async (storagePath) => {
    if (signedUrls[storagePath]) return signedUrls[storagePath];
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 3600);
    if (error) throw error;
    setSignedUrls(prev => ({ ...prev, [storagePath]: data.signedUrl }));
    return data.signedUrl;
  }, [signedUrls]);

  // ─── Vorschau laden ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedDatei) { setPreviewUrl(null); return; }
    if (!isImage(selectedDatei.dateityp) && !isPdf(selectedDatei.dateityp, selectedDatei.dateiname)) {
      setPreviewUrl(null);
      return;
    }
    setLoadingPreview(true);
    getSignedUrl(selectedDatei.storage_path)
      .then(url => setPreviewUrl(url))
      .catch(() => setPreviewUrl(null))
      .finally(() => setLoadingPreview(false));
  }, [selectedDatei]);

  // ─── Download ─────────────────────────────────────────────────────────────
  const handleDownload = async (datei) => {
    try {
      const url = await getSignedUrl(datei.storage_path);
      window.open(url, "_blank");
    } catch (err) {
      toast.error("Download fehlgeschlagen: " + err.message);
    }
  };

  // ─── Loeschen ─────────────────────────────────────────────────────────────
  const handleDelete = async (datei) => {
    if (!window.confirm(`"${datei.dateiname}" wirklich loeschen?`)) return;
    try {
      await supabase.storage.from(BUCKET).remove([datei.storage_path]);
      await supabase.from("ablage_dateien").delete().eq("id", datei.id);
      toast.success("Datei geloescht");
      if (selectedDatei?.id === datei.id) setSelectedDatei(null);
      loadDateien();
    } catch (err) {
      toast.error("Fehler: " + err.message);
    }
  };

  // ─── Umbenennen ───────────────────────────────────────────────────────────
  const handleUmbenennen = async (newName) => {
    if (!umbenennenDatei || !newName.trim()) return;
    try {
      await supabase.from("ablage_dateien").update({ dateiname: newName.trim() }).eq("id", umbenennenDatei.id);
      toast.success("Umbenannt");
      if (selectedDatei?.id === umbenennenDatei.id) {
        setSelectedDatei(prev => ({ ...prev, dateiname: newName.trim() }));
      }
      setUmbenennenDatei(null);
      loadDateien();
    } catch (err) {
      toast.error("Fehler: " + err.message);
    }
  };

  // ─── Neuer Ordner (nur lokal, wird beim Upload genutzt) ────────────────────
  const handleNeuerOrdner = (ordnerPfad) => {
    setExpandedOrdner(prev => ({ ...prev, [ordnerPfad]: true }));
    setSelectedOrdner(ordnerPfad);
    setShowNeuerOrdnerDialog(false);
    toast.success(`Ordner "${ordnerPfad}" bereit (wird beim naechsten Upload angelegt)`);
  };

  const customerName = (id) => {
    if (!id) return null;
    return customers.find(c => c.id === id)?.company_name || null;
  };

  // ─── Ordner-Tree ──────────────────────────────────────────────────────────
  const renderOrdnerTree = () => {
    const items = alleOrdner;
    return items.map(ord => {
      const isSelected = selectedOrdner === ord;
      const isExpanded = expandedOrdner[ord];
      const children = items.filter(o => o !== ord && o.startsWith(ord + "/") && o.split("/").length === ord.split("/").length + 1);
      const hasChildren = children.length > 0;
      const depth = (ord.match(/\//g) || []).length - 1;
      const label = ord === "/" ? "Alle Dateien" : ord.split("/").filter(Boolean).pop();

      return (
        <div key={ord}>
          <div
            onClick={() => {
              setSelectedOrdner(ord);
              if (hasChildren) setExpandedOrdner(prev => ({ ...prev, [ord]: !isExpanded }));
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 8px 5px " + (8 + depth * 14) + "px",
              borderRadius: 6,
              cursor: "pointer",
              background: isSelected ? s.selBg : "transparent",
              color: isSelected ? accent : s.textMain,
              fontWeight: isSelected ? 600 : 400,
              fontSize: 13,
              userSelect: "none",
            }}
          >
            {hasChildren ? (
              isExpanded
                ? <ChevronDown size={14} style={{ flexShrink: 0 }} />
                : <ChevronRight size={14} style={{ flexShrink: 0 }} />
            ) : (
              <span style={{ width: 14, flexShrink: 0 }} />
            )}
            <Folder size={14} style={{ flexShrink: 0, color: isSelected ? accent : s.textMuted }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
          </div>
          {hasChildren && isExpanded && children.map(child => renderOrdnerTree().filter(el => el.key === child))}
        </div>
      );
    });
  };

  // ─── Datei-Item (Liste) ───────────────────────────────────────────────────
  const DateiListItem = ({ datei }) => {
    const { icon: FileIcon, color, label } = getFileIcon(datei.dateityp, datei.dateiname);
    const isSelected = selectedDatei?.id === datei.id;
    const cname = customerName(datei.customer_id);

    return (
      <div
        onClick={() => setSelectedDatei(isSelected ? null : datei)}
        onContextMenu={(e) => { e.preventDefault(); setContextMenu({ datei, x: e.clientX, y: e.clientY }); }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
          borderRadius: 7,
          cursor: "pointer",
          background: isSelected ? s.selBg : "transparent",
          borderBottom: "1px solid " + border + "40",
          transition: "background 0.1s",
        }}
        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = s.rowHover; }}
        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
      >
        {/* Icon */}
        <div style={{ width: 36, height: 36, borderRadius: 8, background: color + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <FileIcon size={18} style={{ color }} />
        </div>
        {/* Name + Meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: s.textMain, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {datei.dateiname}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
            {cname && (
              <span style={{ fontSize: 11, color: s.textMuted, background: s.sidebarBg, border: "1px solid " + border, borderRadius: 4, padding: "1px 6px" }}>
                {cname}
              </span>
            )}
            {(datei.tags || []).map(tag => (
              <span key={tag} style={{ fontSize: 11, color: accent, background: accent + "18", border: "1px solid " + accent + "40", borderRadius: 20, padding: "1px 7px" }}>
                {tag}
              </span>
            ))}
          </div>
        </div>
        {/* Groesse + Datum */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 12, color: s.textMuted }}>{formatBytes(datei.groesse)}</div>
          <div style={{ fontSize: 11, color: s.textMuted }}>{formatDate(datei.created_at)}</div>
        </div>
        {/* Aktionen */}
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button
            onClick={e => { e.stopPropagation(); handleDownload(datei); }}
            title="Herunterladen"
            style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, padding: 4, borderRadius: 4 }}
          >
            <Download size={14} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); setContextMenu({ datei, x: e.currentTarget.getBoundingClientRect().right, y: e.currentTarget.getBoundingClientRect().bottom }); }}
            title="Mehr"
            style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, padding: 4, borderRadius: 4 }}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>
    );
  };

  // ─── Datei-Kachel (Grid) ──────────────────────────────────────────────────
  const DateiGridItem = ({ datei }) => {
    const { icon: FileIcon, color } = getFileIcon(datei.dateityp, datei.dateiname);
    const isSelected = selectedDatei?.id === datei.id;

    return (
      <div
        onClick={() => setSelectedDatei(isSelected ? null : datei)}
        onContextMenu={(e) => { e.preventDefault(); setContextMenu({ datei, x: e.clientX, y: e.clientY }); }}
        style={{
          border: "1px solid " + (isSelected ? accent : border),
          borderRadius: 10,
          padding: 14,
          cursor: "pointer",
          background: isSelected ? s.selBg : s.cardBg,
          transition: "all 0.1s",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
        }}
      >
        <div style={{ width: 48, height: 48, borderRadius: 10, background: color + "18", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <FileIcon size={26} style={{ color }} />
        </div>
        <div style={{ fontSize: 12, fontWeight: 500, color: s.textMain, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>
          {datei.dateiname}
        </div>
        <div style={{ fontSize: 11, color: s.textMuted }}>{formatBytes(datei.groesse)}</div>
        {(datei.tags || []).slice(0, 2).map(tag => (
          <span key={tag} style={{ fontSize: 10, color: accent, background: accent + "18", borderRadius: 20, padding: "1px 6px" }}>{tag}</span>
        ))}
      </div>
    );
  };

  // ─── Context-Menu ─────────────────────────────────────────────────────────
  const ContextMenu = () => {
    if (!contextMenu) return null;
    const { datei, x, y } = contextMenu;
    return (
      <div
        ref={contextMenuRef}
        style={{
          position: "fixed",
          left: Math.min(x, window.innerWidth - 180),
          top: Math.min(y, window.innerHeight - 130),
          zIndex: 10000,
          background: s.cardBg,
          border: "1px solid " + border,
          borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
          minWidth: 160,
          overflow: "hidden",
        }}
      >
        {[
          { icon: Download, label: "Herunterladen", action: () => { handleDownload(datei); setContextMenu(null); } },
          { icon: Eye, label: "Details", action: () => { setSelectedDatei(datei); setContextMenu(null); } },
          { icon: Pencil, label: "Umbenennen", action: () => { setUmbenennenDatei(datei); setContextMenu(null); } },
          { icon: Trash2, label: "Loeschen", action: () => { setContextMenu(null); handleDelete(datei); }, danger: true },
        ].map(({ icon: Icon, label, action, danger }) => (
          <button
            key={label}
            onClick={action}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "8px 14px",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: danger ? "#ef4444" : s.textMain,
              fontSize: 13,
              textAlign: "left",
            }}
            onMouseEnter={e => e.currentTarget.style.background = s.rowHover}
            onMouseLeave={e => e.currentTarget.style.background = "none"}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
    );
  };

  // ─── Detail-Panel ─────────────────────────────────────────────────────────
  const DetailPanel = () => {
    if (!selectedDatei) return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: s.textMuted, fontSize: 13, padding: 20, textAlign: "center" }}>
        <div>
          <File size={32} style={{ opacity: 0.3, margin: "0 auto 8px", display: "block" }} />
          Datei auswaehlen<br />fuer Details
        </div>
      </div>
    );

    const { icon: FileIcon, color } = getFileIcon(selectedDatei.dateityp, selectedDatei.dateiname);
    const cname = customerName(selectedDatei.customer_id);
    const showPreview = isImage(selectedDatei.dateityp) || isPdf(selectedDatei.dateityp, selectedDatei.dateiname);

    return (
      <div style={{ padding: 16, overflowY: "auto", height: "100%" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: color + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <FileIcon size={22} style={{ color }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: s.textMain, wordBreak: "break-word" }}>{selectedDatei.dateiname}</div>
            <div style={{ fontSize: 11, color: s.textMuted, marginTop: 2 }}>{formatDate(selectedDatei.created_at)}</div>
          </div>
          <button onClick={() => setSelectedDatei(null)} style={{ background: "none", border: "none", cursor: "pointer", color: s.textMuted, padding: 2 }}>
            <X size={16} />
          </button>
        </div>

        {/* Vorschau */}
        {showPreview && (
          <div style={{ marginBottom: 14, borderRadius: 8, overflow: "hidden", border: "1px solid " + border, background: s.sidebarBg }}>
            {loadingPreview && (
              <div style={{ padding: 20, textAlign: "center", color: s.textMuted, fontSize: 12 }}>Vorschau laedt...</div>
            )}
            {!loadingPreview && previewUrl && isImage(selectedDatei.dateityp) && (
              <img src={previewUrl} alt={selectedDatei.dateiname} style={{ width: "100%", maxHeight: 200, objectFit: "contain", display: "block" }} />
            )}
            {!loadingPreview && previewUrl && isPdf(selectedDatei.dateityp, selectedDatei.dateiname) && (
              <iframe src={previewUrl} title={selectedDatei.dateiname} style={{ width: "100%", height: 220, border: "none", display: "block" }} />
            )}
            {!loadingPreview && !previewUrl && (
              <div style={{ padding: 16, textAlign: "center", color: s.textMuted, fontSize: 12 }}>Vorschau nicht verfuegbar</div>
            )}
          </div>
        )}

        {/* Meta-Infos */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            { label: "Groesse", value: formatBytes(selectedDatei.groesse) },
            { label: "Typ", value: selectedDatei.dateityp || "–" },
            { label: "Ordner", value: selectedDatei.ordner || "/" },
            { label: "Kunde", value: cname || "–" },
          ].map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: 11, color: s.textMuted, marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 12, color: s.textMain, background: s.sidebarBg, border: "1px solid " + border, borderRadius: 6, padding: "4px 8px", wordBreak: "break-all" }}>{value}</div>
            </div>
          ))}

          {/* Tags */}
          {(selectedDatei.tags || []).length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: s.textMuted, marginBottom: 4 }}>Tags</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {selectedDatei.tags.map(tag => (
                  <span key={tag} style={{ fontSize: 11, color: accent, background: accent + "18", border: "1px solid " + accent + "40", borderRadius: 20, padding: "2px 8px" }}>{tag}</span>
                ))}
              </div>
            </div>
          )}

          {/* Beschreibung */}
          {selectedDatei.beschreibung && (
            <div>
              <div style={{ fontSize: 11, color: s.textMuted, marginBottom: 2 }}>Beschreibung</div>
              <div style={{ fontSize: 12, color: s.textMain, background: s.sidebarBg, border: "1px solid " + border, borderRadius: 6, padding: "6px 8px" }}>{selectedDatei.beschreibung}</div>
            </div>
          )}
        </div>

        {/* Aktionen */}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <Button
            onClick={() => handleDownload(selectedDatei)}
            style={{ flex: 1, background: accent, color: "#fff", fontSize: 12 }}
          >
            <Download size={14} style={{ marginRight: 5 }} />
            Herunterladen
          </Button>
          <Button
            variant="outline"
            onClick={() => handleDelete(selectedDatei)}
            style={{ color: "#ef4444", borderColor: "#ef4444", fontSize: 12 }}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
    );
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: s.cardBg }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: "1px solid " + border, flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: s.textMain, marginRight: 8 }}>Team-Ablage</span>

        {/* Neuer Ordner */}
        <button
          onClick={() => setShowNeuerOrdnerDialog(true)}
          style={{ display: "flex", alignItems: "center", gap: 5, background: s.sidebarBg, border: "1px solid " + border, color: s.textMain, borderRadius: 7, padding: "5px 12px", fontSize: 12, cursor: "pointer" }}
        >
          <FolderPlus size={14} />
          Neuer Ordner
        </button>

        {/* Hochladen */}
        <button
          onClick={() => setShowUploadDialog(true)}
          style={{ display: "flex", alignItems: "center", gap: 5, background: accent, border: "none", color: "#fff", borderRadius: 7, padding: "5px 12px", fontSize: 12, cursor: "pointer" }}
        >
          <Upload size={14} />
          Hochladen
        </button>

        <div style={{ flex: 1 }} />

        {/* Suche */}
        <div style={{ position: "relative" }}>
          <Search size={13} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: s.textMuted }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Datei suchen..."
            style={{ background: s.inputBg, border: "1px solid " + border, color: s.textMain, borderRadius: 7, padding: "5px 10px 5px 26px", fontSize: 12, outline: "none", width: 200 }}
          />
        </div>

        {/* Filter Kunde */}
        <select
          value={filterCustomer}
          onChange={e => setFilterCustomer(e.target.value)}
          style={{ background: s.inputBg, border: "1px solid " + border, color: s.textMain, borderRadius: 7, padding: "5px 8px", fontSize: 12, outline: "none", cursor: "pointer" }}
        >
          <option value="">Alle Kunden</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>

        {/* Filter Tag */}
        <select
          value={filterTag}
          onChange={e => setFilterTag(e.target.value)}
          style={{ background: s.inputBg, border: "1px solid " + border, color: s.textMain, borderRadius: 7, padding: "5px 8px", fontSize: 12, outline: "none", cursor: "pointer" }}
        >
          <option value="">Alle Tags</option>
          {VORDEFINIERTE_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        {/* View Toggle */}
        <div style={{ display: "flex", background: s.sidebarBg, border: "1px solid " + border, borderRadius: 7, overflow: "hidden" }}>
          {[
            { mode: "list", Icon: LayoutList },
            { mode: "grid", Icon: LayoutGrid },
          ].map(({ mode, Icon }) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{ background: viewMode === mode ? accent : "transparent", color: viewMode === mode ? "#fff" : s.textMuted, border: "none", padding: "5px 9px", cursor: "pointer", display: "flex", alignItems: "center" }}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>
      </div>

      {/* Hauptbereich: 3 Spalten */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Linke Sidebar: Ordner */}
        <div style={{ width: 220, flexShrink: 0, borderRight: "1px solid " + border, background: s.sidebarBg, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "10px 8px 6px", fontSize: 11, fontWeight: 600, color: s.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Ordner
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 4px 8px" }}>
            {/* Root "Alle Dateien" */}
            <div
              onClick={() => setSelectedOrdner("/")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 8px",
                borderRadius: 6,
                cursor: "pointer",
                background: selectedOrdner === "/" ? s.selBg : "transparent",
                color: selectedOrdner === "/" ? accent : s.textMain,
                fontWeight: selectedOrdner === "/" ? 600 : 400,
                fontSize: 13,
                marginBottom: 2,
              }}
            >
              <Folder size={14} style={{ color: selectedOrdner === "/" ? accent : s.textMuted }} />
              Alle Dateien
              <span style={{ marginLeft: "auto", fontSize: 11, color: s.textMuted }}>{dateien.length}</span>
            </div>

            {/* Spezifische Ordner */}
            {alleOrdner.filter(o => o !== "/").map(ord => {
              const isSelected = selectedOrdner === ord;
              const count = dateien.filter(d => d.ordner === ord).length;
              const label = ord.split("/").filter(Boolean).pop() || ord;
              return (
                <div
                  key={ord}
                  onClick={() => setSelectedOrdner(ord)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 8px",
                    borderRadius: 6,
                    cursor: "pointer",
                    background: isSelected ? s.selBg : "transparent",
                    color: isSelected ? accent : s.textMain,
                    fontWeight: isSelected ? 600 : 400,
                    fontSize: 13,
                    marginBottom: 2,
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = s.rowHover; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                >
                  <Folder size={14} style={{ color: isSelected ? accent : s.textMuted }} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                  <span style={{ fontSize: 11, color: s.textMuted }}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Mittlerer Bereich: Dateiliste */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Breadcrumb */}
          <div style={{ padding: "8px 16px", borderBottom: "1px solid " + border + "50", fontSize: 12, color: s.textMuted, display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <Folder size={12} />
            <span>{selectedOrdner === "/" ? "Alle Dateien" : selectedOrdner}</span>
            <span style={{ marginLeft: "auto" }}>{gefilterteDateien.length} Datei{gefilterteDateien.length !== 1 ? "en" : ""}</span>
          </div>

          {/* Liste oder Grid */}
          <div style={{ flex: 1, overflowY: "auto", padding: viewMode === "grid" ? 16 : 8 }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: "center", color: s.textMuted, fontSize: 13 }}>Laedt...</div>
            ) : gefilterteDateien.length === 0 ? (
              <div style={{ padding: 60, textAlign: "center", color: s.textMuted, fontSize: 13 }}>
                <File size={36} style={{ opacity: 0.2, margin: "0 auto 10px", display: "block" }} />
                Keine Dateien vorhanden
              </div>
            ) : viewMode === "list" ? (
              <div>
                {gefilterteDateien.map(d => <DateiListItem key={d.id} datei={d} />)}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
                {gefilterteDateien.map(d => <DateiGridItem key={d.id} datei={d} />)}
              </div>
            )}
          </div>
        </div>

        {/* Rechtes Panel: Details */}
        <div style={{ width: 260, flexShrink: 0, borderLeft: "1px solid " + border, background: s.sidebarBg, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <DetailPanel />
        </div>
      </div>

      {/* Dialoge */}
      {showUploadDialog && (
        <UploadDialog
          customers={customers}
          existingOrdner={alleOrdner}
          onCancel={() => setShowUploadDialog(false)}
          onUpload={() => { setShowUploadDialog(false); loadDateien(); }}
          s={s}
          border={border}
          accent={accent}
        />
      )}

      {showNeuerOrdnerDialog && (
        <NeuerOrdnerDialog
          onCancel={() => setShowNeuerOrdnerDialog(false)}
          onCreate={handleNeuerOrdner}
          s={s}
          border={border}
          accent={accent}
        />
      )}

      {umbenennenDatei && (
        <UmbenennenDialog
          datei={umbenennenDatei}
          onCancel={() => setUmbenennenDatei(null)}
          onSave={handleUmbenennen}
          s={s}
          border={border}
          accent={accent}
        />
      )}

      <ContextMenu />
    </div>
  );
}
