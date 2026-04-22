/**
 * DokUploadDialog – Wiederverwendbarer Upload-Dialog für die Dateiablage.
 * Wird aus MailDetailPanel (Anhang hochladen) und Dokumente verwendet.
 */
import React, { useState, useEffect, useRef, useMemo, useContext } from "react";
import { X } from "lucide-react";
import { supabase, entities } from "@/api/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ThemeContext } from "@/Layout";
import TagSelectWidget from "@/components/dokumente/TagSelectWidget";
import { CATEGORIES } from "@/lib/categories";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.js?url";
// Guard: in einigen Vite-Konfigurationen ist GlobalWorkerOptions nach dem
// AMD-Namespace-Import undefined. Ohne Guard crasht der Module-Load → weisse Seite.
if (pdfjsLib?.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

const BUCKET   = "dokumente";
const CUR_YEAR = new Date().getFullYear();

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
function filterTagsByCategory(allTags, category) {
  if (!category) return allTags;
  const matchingParents = allTags.filter(t => !t.parent_id && t.category === category);
  if (matchingParents.length === 0) return allTags;
  const parentIds = new Set(matchingParents.map(t => t.id));
  return allTags.filter(t => parentIds.has(t.id) || parentIds.has(t.parent_id));
}
async function extractDocumentText(file) {
  if (!file) return "";
  const name = file.name?.toLowerCase() || "";
  const type = file.type || "";
  try {
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
    if (name.endsWith(".docx")) {
      const { default: JSZip } = await import("jszip");
      const buf  = await file.arrayBuffer();
      const zip  = await JSZip.loadAsync(buf);
      const xml  = await zip.file("word/document.xml")?.async("text") || "";
      return xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 100000);
    }
    if (type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
      return (await file.text()).slice(0, 100000);
    }
    return "";
  } catch (e) {
    console.warn("Textextraktion fehlgeschlagen", e);
    return "";
  }
}

/**
 * @param {File}   preFile         – Datei direkt öffnen (z.B. Mail-Anhang)
 * @param {string} preCustomerId   – Kunden-ID vorauswählen
 * @param {func}   onClose         – Dialog schliessen
 */
export default function DokUploadDialog({ preFile, preCustomerId, onClose }) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";
  const queryClient = useQueryClient();

  const cardBg     = isArtis ? "#fff"         : isLight ? "#fff"         : "#27272a";
  const textMain   = isArtis ? "#2d3a2d"      : isLight ? "#1a1a2e"      : "#e4e4e7";
  const textMuted  = isArtis ? "#6b826b"      : isLight ? "#7a7a9a"      : "#71717a";
  const inputBg    = isArtis ? "#fff"         : isLight ? "#fff"         : "rgba(24,24,27,0.8)";
  const inputBorder= isArtis ? "#bfcfbf"      : isLight ? "#c8c8dc"      : "#3f3f46";
  const border     = isArtis ? "#ccd8cc"      : isLight ? "#d4d4e8"      : "#3f3f46";
  const accent     = isArtis ? "#4a7a4f"      : isLight ? "#7c3aed"      : "#6366f1";
  const rowBg      = isArtis ? "#f5f8f5"      : isLight ? "#f5f5fc"      : "#1f1f23";

  const s   = { cardBg, textMain, textMuted, inputBg, inputBorder, border, accent };
  const inp = { background: inputBg, border: `1px solid ${inputBorder}`, color: textMain, borderRadius: 6, padding: "6px 10px", fontSize: 13, width: "100%", outline: "none", boxSizing: "border-box" };

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn:  () => entities.Customer.list("company_name"),
  });
  const { data: allTags = [] } = useQuery({
    queryKey: ["dok_tags"],
    queryFn:  () => entities.DokTag.list("color"),
  });

  const [file,      setFile]      = useState(preFile || null);
  const [custId,    setCustId]    = useState(preCustomerId || "");
  const [name,      setName]      = useState(() => preFile ? preFile.name.replace(/\.[^.]+$/, "") : "");
  const [category,  setCategory]  = useState("");
  const [year,      setYear]      = useState(() => { const y = detectYear(preFile?.name); return y ? String(y) : String(CUR_YEAR); });
  const [tagIds,    setTagIds]    = useState([]);
  const [notes,     setNotes]     = useState("");
  const [uploading, setUploading] = useState(false);
  const [errors,    setErrors]    = useState({});
  const yearRef = useRef();

  const filteredTags = useMemo(() => filterTagsByCategory(allTags, category), [allTags, category]);
  useEffect(() => {
    const validIds = new Set(filteredTags.map(t => t.id));
    setTagIds(prev => prev.filter(id => validIds.has(id)));
  }, [filteredTags]);

  const handleUpload = async () => {
    const errs = {};
    if (!file || !custId || !name.trim()) { toast.error("Bitte Datei, Kunde und Name ausfüllen"); return; }
    if (!year || isNaN(parseInt(year)))   { toast.error("Bitte ein gültiges Jahr eingeben"); return; }
    if (!category)                        errs.category = "Bitte eine Kategorie auswählen.";
    if (!tagIds.length)                   errs.tags     = "Bitte mindestens einen Tag auswählen.";
    if (Object.keys(errs).length)         { setErrors(errs); return; }
    setErrors({});
    setUploading(true);
    try {
      const contentText = await extractDocumentText(file);
      const fileExt  = file.name.split(".").pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
      const path     = `${custId}/${fileName}`;
      const cleanFile = new File([file], fileName, { type: file.type });
      const { data: uploadData, error: uploadError } = await supabase.storage.from(BUCKET).upload(path, cleanFile);
      if (uploadError) throw uploadError;
      await entities.Dokument.create({
        customer_id: custId, category, year: parseInt(year),
        name: name.trim(), filename: file.name,
        storage_path: uploadData.path, file_size: file.size, file_type: file.type,
        tag_ids: tagIds, notes, content_text: contentText,
      });
      toast.success("Dokument hochgeladen ✓", { closeButton: true });
      queryClient.invalidateQueries({ queryKey: ["dokumente"] });
      onClose();
    } catch (err) {
      console.error("Upload error:", err);
      toast.error("Fehler: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: cardBg, border: `1px solid ${border}`, borderRadius: 14, padding: 28, width: 620, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 48px rgba(0,0,0,0.25)" }}>

        {/* Titel */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ color: textMain, fontSize: 15, fontWeight: 700, margin: 0 }}>In Ablage hochladen</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: textMuted, display: "flex", alignItems: "center" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Datei-Anzeige */}
          <div style={{ border: `2px solid ${accent}55`, borderRadius: 8, padding: "10px 14px", background: accent + "0f", color: accent, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>📎</span>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file?.name}</span>
            {file?.size ? <span style={{ color: textMuted, flexShrink: 0 }}>{formatBytes(file.size)}</span> : null}
          </div>

          {/* Anzeigename */}
          <div>
            <label style={{ fontSize: 12, color: textMuted, display: "block", marginBottom: 4 }}>Anzeigename *</label>
            <input value={name} onChange={e => setName(e.target.value)} style={inp} placeholder="Dateiname (ohne Endung)" />
          </div>

          {/* Kunde */}
          <div>
            <label style={{ fontSize: 12, color: textMuted, display: "block", marginBottom: 4 }}>Kunde *</label>
            <select value={custId} onChange={e => setCustId(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
              <option value="">-- Kunde wählen --</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>

          {/* Tags */}
          <div>
            <label style={{ fontSize: 12, color: textMuted, display: "block", marginBottom: 4 }}>Tags *</label>
            <TagSelectWidget
              value={tagIds}
              onChange={(v) => { setTagIds(v); setErrors(p => ({ ...p, tags: undefined })); }}
              onCategoryChange={(cat) => { setCategory(cat); setTimeout(() => { yearRef.current?.select(); yearRef.current?.focus(); }, 80); }}
              allTags={filteredTags} s={s} border={errors.tags ? "#ef4444" : border} accent={accent}
            />
            {errors.tags && <div style={{ color: "#ef4444", fontSize: 11, marginTop: 3 }}>{errors.tags}</div>}
          </div>

          {/* Kategorie + Jahr */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: textMuted, display: "block", marginBottom: 4 }}>Kategorie *</label>
              <select value={category} onChange={e => { setCategory(e.target.value); setErrors(p => ({ ...p, category: undefined })); }}
                style={{ ...inp, cursor: "pointer", borderColor: errors.category ? "#ef4444" : inputBorder }}>
                <option value="">-- Kategorie wählen --</option>
                {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
              </select>
              {errors.category && <div style={{ color: "#ef4444", fontSize: 11, marginTop: 3 }}>{errors.category}</div>}
            </div>
            <div>
              <label style={{ fontSize: 12, color: textMuted, display: "block", marginBottom: 4 }}>Jahr *</label>
              <input ref={yearRef} type="number" value={year} min="2000" max="2099"
                onChange={e => setYear(e.target.value)}
                style={{ ...inp, borderColor: !year ? "#ef4444" : inputBorder }} placeholder="z.B. 2025" />
            </div>
          </div>

          {/* Notiz */}
          <div>
            <label style={{ fontSize: 12, color: textMuted, display: "block", marginBottom: 4 }}>Notiz (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              style={{ ...inp, resize: "vertical" }} placeholder="Interne Notiz..." />
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6, paddingTop: 12, borderTop: `1px solid ${border}` }}>
            <button onClick={onClose}
              style={{ background: "none", border: `1px solid ${border}`, color: textMuted, borderRadius: 7, padding: "8px 18px", fontSize: 13, cursor: "pointer" }}>
              Abbrechen
            </button>
            <button onClick={handleUpload} disabled={uploading}
              style={{ background: accent, color: "#fff", border: "none", borderRadius: 7, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: uploading ? "not-allowed" : "pointer", opacity: uploading ? 0.7 : 1, minWidth: 110 }}>
              {uploading ? "Lädt hoch…" : "Hochladen"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
