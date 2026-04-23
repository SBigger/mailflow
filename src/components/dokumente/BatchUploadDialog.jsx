/**
 * BatchUploadDialog – Massenablage-Dialog mit KI-Zuordnung.
 *
 * Feature-Branch: feat/massenablage
 * Status:         SKELETON (Schritt 2) – UI steht, kein Upload, keine KI
 *
 * WICHTIG: Dieser Dialog ist komplett UNABHÄNGIG vom bestehenden
 * DokUploadDialog und dem inline UploadDialog in Dokumente.jsx.
 * Er verändert KEINE der Check-in/-out-Logik.
 */
import React, { useState, useMemo, useCallback, useContext, useRef, useEffect } from "react";
import { X, Upload, FileText, Image as ImgIcon, FileSpreadsheet, File, Trash2, Sparkles, Eye } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { entities, supabase } from "@/api/supabaseClient";
import { toast } from "sonner";
import { ThemeContext } from "@/Layout";
import { CATEGORIES } from "@/lib/categories";
import { analyzeFile } from "@/lib/batchAiSuggest";
import TagSelectWidget from "@/components/dokumente/TagSelectWidget";

// ─── Helpers ──────────────────────────────────────────────────────────

// Gelber Stil für KI-vorgeschlagene Felder
const aiSuggestedStyle = {
  background: "#fef3c7",
  borderColor: "#fbbf24",
};

function AiBadge() {
  return (
    <div style={{ marginTop: 3, fontSize: 10, color: "#92400e", display: "flex", alignItems: "center", gap: 3 }}>
      <Sparkles size={10} /> KI-Vorschlag — einfach überschreibbar
    </div>
  );
}

function stageLabel(stage) {
  switch (stage) {
    case "extract":      return "Text wird extrahiert…";
    case "extracted":    return "Text extrahiert";
    case "ocr":          return "OCR läuft (dauert 5-15s)…";
    case "ocr-done":     return "OCR fertig";
    case "ocr-error":    return "OCR-Fehler — nutze Dateiname";
    case "vision":       return "KI-Vision liest PDF/Bild…";
    case "claude":       return "KI analysiert…";
    case "claude-done":  return "KI fertig";
    case "claude-error": return "KI-Fehler";
    default:             return "KI analysiert…";
  }
}

function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

function detectYear(filename) {
  const m = (filename || "").match(/\b(20\d{2})\b/);
  return m ? parseInt(m[1]) : null;
}

function iconForFile(file) {
  const name = (file?.name || "").toLowerCase();
  const type = file?.type || "";
  if (type.startsWith("image/")) return <ImgIcon size={18} />;
  if (/\.(xlsx|xls|xlsm|xlsb|xlt|xltx|xltm|ods|csv)$/.test(name)) return <FileSpreadsheet size={18} />;
  if (/\.(pdf|docx|docm|odt|ott|pptx|ppt|txt|md)$/.test(name)) return <FileText size={18} />;
  return <File size={18} />;
}

// Eindeutige ID pro gedropptem File
let __fileCounter = 0;
function newItem(file, preCustomerId) {
  const id = `f${Date.now()}_${++__fileCounter}`;
  const nameWithoutExt = file.name.replace(/\.[^.]+$/, "");
  return {
    id,
    file,
    status: "pending",          // 'pending' | 'analyzing' | 'ready' | 'parked' | 'uploading' | 'done' | 'error'
    confidence: null,            // 0–1
    fields: {
      name: nameWithoutExt,
      customer_id: preCustomerId || "",
      tag_ids: [],
      category: "",
      year: detectYear(file.name) || new Date().getFullYear(),
      notes: "",
    },
    aiReason: null,              // Textliche Erklärung, wie die KI den Kunden gefunden hat
    aiHints: {},                 // Pro Feld ob KI-vorgeschlagen oder Nutzer-eingegeben
    error: null,
    contentText: "",             // Extrahierter Text (für späteren Claude-Fallback + content_text beim Upload)
    stage: null,                 // Aktueller Analyse-Schritt (extract|ocr|claude|done)
    stageInfo: "",               // Detail-Text zum Stage
    claudeError: null,           // Wenn Claude-Fallback gescheitert ist
  };
}

// ─── Hauptkomponente ──────────────────────────────────────────────────
export default function BatchUploadDialog({ preCustomerId, onClose }) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";

  // Theme-Farben (gleiches Schema wie DokUploadDialog)
  const cardBg      = isArtis ? "#fff"      : isLight ? "#fff"      : "#27272a";
  const textMain    = isArtis ? "#2d3a2d"   : isLight ? "#1a1a2e"   : "#e4e4e7";
  const textMuted   = isArtis ? "#6b826b"   : isLight ? "#7a7a9a"   : "#71717a";
  const inputBg     = isArtis ? "#fff"      : isLight ? "#fff"      : "rgba(24,24,27,0.8)";
  const inputBorder = isArtis ? "#bfcfbf"   : isLight ? "#c8c8dc"   : "#3f3f46";
  const border      = isArtis ? "#ccd8cc"   : isLight ? "#d4d4e8"   : "#3f3f46";
  const accent      = isArtis ? "#4a7a4f"   : isLight ? "#7c3aed"   : "#6366f1";
  const rowBg       = isArtis ? "#f5f8f5"   : isLight ? "#f5f5fc"   : "#1f1f23";
  const rowHover    = isArtis ? "#e8efe8"   : isLight ? "#ebebf5"   : "#2a2a2e";

  const inp = {
    background: inputBg, border: `1px solid ${inputBorder}`, color: textMain,
    borderRadius: 6, padding: "7px 10px", fontSize: 13, width: "100%",
    outline: "none", boxSizing: "border-box", fontFamily: "inherit",
  };

  // Fenster-Größe (skalierbar)
  const [dim, setDim] = useState(() => ({
    w: Math.min(1200, window.innerWidth - 40),
    h: Math.min(780, window.innerHeight - 40),
  }));
  const resizeStart = useRef(null);

  const onResizeDown = (e) => {
    e.preventDefault();
    resizeStart.current = { x: e.clientX, y: e.clientY, w: dim.w, h: dim.h };
    document.addEventListener("mousemove", onResizeMove);
    document.addEventListener("mouseup", onResizeUp);
  };
  const onResizeMove = (e) => {
    if (!resizeStart.current) return;
    const dx = e.clientX - resizeStart.current.x;
    const dy = e.clientY - resizeStart.current.y;
    setDim({
      w: Math.max(800,  Math.min(window.innerWidth  - 20, resizeStart.current.w + dx)),
      h: Math.max(500,  Math.min(window.innerHeight - 20, resizeStart.current.h + dy)),
    });
  };
  const onResizeUp = () => {
    resizeStart.current = null;
    document.removeEventListener("mousemove", onResizeMove);
    document.removeEventListener("mouseup", onResizeUp);
  };
  useEffect(() => () => {
    document.removeEventListener("mousemove", onResizeMove);
    document.removeEventListener("mouseup", onResizeUp);
  }, []);

  // Daten
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn:  () => entities.Customer.list("company_name"),
  });
  const { data: allTags = [] } = useQuery({
    queryKey: ["dok_tags"],
    queryFn:  () => entities.DokTag.list("color"),
  });

  // State
  const [items, setItems]         = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [isDragOver, setDragOver] = useState(false);
  const [showText, setShowText]   = useState(false);  // OCR-Text-Viewer
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef();
  const queryClient  = useQueryClient();

  const selected = useMemo(
    () => items.find(i => i.id === selectedId) || null,
    [items, selectedId]
  );

  const stats = useMemo(() => ({
    total:    items.length,
    ready:    items.filter(i => i.status === "ready").length,
    parked:   items.filter(i => i.status === "parked").length,
    analyzing: items.filter(i => i.status === "analyzing").length,
  }), [items]);

  // ─── File-Handling ───────────────────────────────────────────────────
  const addFiles = useCallback(async (fileList) => {
    const newItems = Array.from(fileList).map(f => newItem(f, preCustomerId));
    setItems(prev => [...prev, ...newItems]);
    setSelectedId(cur => cur || newItems[0]?.id || null);

    // Erste Datei einzeln durchlaufen lassen (warmt den Prompt-Cache),
    // danach 3 parallel (greifen auf den Cache zu → deutlich schneller).
    const analyzeOne = async (item) => {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: "analyzing", stage: "start", stageInfo: "" } : i));
      const onStage = (stage, info) => {
        setItems(prev => prev.map(i => i.id === item.id
          ? { ...i, stage, stageInfo: info || "", claudeError: stage === "claude-error" ? info : i.claudeError }
          : i));
      };
      try {
        const result = await analyzeFile(item.file, { customers, allTags, onStage });
        setItems(prev => prev.map(i => {
          if (i.id !== item.id) return i;
          const newFields = { ...i.fields };
          const newHints = { ...i.aiHints };
          if (!newFields.customer_id && result.suggestions.customer_id) {
            newFields.customer_id = result.suggestions.customer_id;
            newHints.customer_id = true;
          }
          if (!newFields.category && result.suggestions.category) {
            newFields.category = result.suggestions.category;
            newHints.category = true;
          }
          if (result.suggestions.year && !detectYear(i.file.name)) {
            newFields.year = result.suggestions.year;
            newHints.year = true;
          }
          if ((!newFields.tag_ids || newFields.tag_ids.length === 0)
              && result.suggestions.tag_ids?.length) {
            newFields.tag_ids = result.suggestions.tag_ids;
            newHints.tag_ids = true;
          }
          return {
            ...i,
            status: result.status,
            confidence: result.confidence,
            contentText: result.contentText,
            fields: newFields,
            aiHints: newHints,
            aiReason: result.reason,
          };
        }));
      } catch (e) {
        console.error("[BatchUpload] Analyse fehlgeschlagen für", item.file.name, e);
        setItems(prev => prev.map(i => i.id === item.id
          ? { ...i, status: "error", error: e.message || String(e) }
          : i));
      }
    };

    if (newItems.length === 0) return;
    // 1. Datei seriell → warmt den Prompt-Cache
    await analyzeOne(newItems[0]);
    // Rest parallelisiert mit Concurrency 3
    const rest = newItems.slice(1);
    const CONCURRENCY = 3;
    let idx = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, rest.length) }, async () => {
      while (idx < rest.length) {
        const myIdx = idx++;
        await analyzeOne(rest[myIdx]);
      }
    });
    await Promise.all(workers);
  }, [preCustomerId, customers, allTags]);

  const removeItem = useCallback((id) => {
    setItems(prev => {
      const next = prev.filter(i => i.id !== id);
      if (selectedId === id) setSelectedId(next[0]?.id || null);
      return next;
    });
  }, [selectedId]);

  const clearAll = useCallback(() => {
    if (!items.length) return;
    if (!window.confirm(`Alle ${items.length} Dateien aus der Warteschlange entfernen?`)) return;
    setItems([]);
    setSelectedId(null);
  }, [items.length]);

  const updateField = useCallback((id, patch) => {
    setItems(prev => prev.map(i =>
      i.id === id ? { ...i, fields: { ...i.fields, ...patch } } : i
    ));
  }, []);

  // Nutzer hat ein KI-Feld überschrieben → gelber Rahmen weg
  const markHintCleared = useCallback((id, fieldKey) => {
    setItems(prev => prev.map(i => {
      if (i.id !== id) return i;
      if (!i.aiHints?.[fieldKey]) return i;
      const { [fieldKey]: _, ...rest } = i.aiHints;
      return { ...i, aiHints: rest };
    }));
  }, []);

  // ─── Upload ─────────────────────────────────────────────────────────────
  const handleUploadAll = async () => {
    const toUpload = items.filter(i =>
      i.status === "ready" &&
      i.fields.customer_id && i.fields.category && i.fields.tag_ids?.length && i.fields.year
    );
    if (!toUpload.length) {
      toast.error("Keine vollständig ausgefüllten Dateien zum Hochladen.");
      return;
    }
    setUploading(true);
    let successCount = 0;
    let errorCount   = 0;
    for (const item of toUpload) {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: "uploading" } : i));
      try {
        const fileExt  = item.file.name.split(".").pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
        const path     = `${item.fields.customer_id}/${fileName}`;
        const cleanFile = new File([item.file], fileName, { type: item.file.type });
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("dokumente").upload(path, cleanFile);
        if (uploadError) throw uploadError;
        const displayName = item.file.name.replace(/\.[^.]+$/, "");
        await entities.Dokument.create({
          customer_id:  item.fields.customer_id,
          category:     item.fields.category,
          year:         parseInt(item.fields.year) || new Date().getFullYear(),
          name:         displayName,
          filename:     item.file.name,
          storage_path: uploadData.path,
          file_size:    item.file.size,
          file_type:    item.file.type,
          tag_ids:      item.fields.tag_ids,
          notes:        item.fields.notes || "",
          content_text: item.contentText || "",
        });
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: "done" } : i));
        successCount++;
      } catch (err) {
        console.error("[BatchUpload] Fehler bei", item.file.name, err);
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: "error", error: err.message } : i));
        errorCount++;
      }
    }
    setUploading(false);
    queryClient.invalidateQueries({ queryKey: ["dokumente"] });
    if (successCount > 0) toast.success(`${successCount} Dokument${successCount !== 1 ? "e" : ""} hochgeladen ✓`, { closeButton: true });
    if (errorCount   > 0) toast.error(`${errorCount} Fehler beim Hochladen`);
    if (errorCount === 0) onClose();
  };

  // Drag & Drop
  const onDragOver = useCallback((e) => { e.preventDefault(); setDragOver(true); }, []);
  const onDragLeave = useCallback((e) => { e.preventDefault(); setDragOver(false); }, []);
  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const onFileInputChange = (e) => {
    if (e.target.files?.length) addFiles(e.target.files);
    e.target.value = "";
  };

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.6)", display: "flex",
      alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: cardBg, borderRadius: 14,
        width: dim.w, maxWidth: "98vw",
        height: dim.h, maxHeight: "98vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 24px 48px rgba(0,0,0,0.35)", overflow: "hidden",
        border: `1px solid ${border}`, position: "relative",
      }}>

        {/* ── Kopf ─────────────────────────────────────────────────── */}
        <div style={{
          padding: "16px 22px", borderBottom: `1px solid ${border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: textMain, display: "flex", alignItems: "center", gap: 8 }}>
              📚 Massenablage
              <span style={{ fontSize: 10, fontWeight: 600, color: "#b45309", background: "#fef3c7", padding: "2px 8px", borderRadius: 10, letterSpacing: ".04em" }}>BETA · Skeleton</span>
            </h2>
            <div style={{ fontSize: 12, color: textMuted, marginTop: 3 }}>
              {stats.total === 0
                ? "Ziehe Dateien in die Zone links — KI-Zuordnung folgt in Schritt 3."
                : <>{stats.total} Datei{stats.total === 1 ? "" : "en"} · {stats.ready} bereit · {stats.parked} geparkt</>}
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: textMuted, padding: 6, borderRadius: 4, display: "flex" }}>
            <X size={20} />
          </button>
        </div>

        {/* ── Body ─────────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "380px 1fr", overflow: "hidden" }}>

          {/* LINKS: Drop + Liste */}
          <div style={{ borderRight: `1px solid ${border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>

            {/* Drop-Zone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
              style={{
                margin: 12, padding: 18, textAlign: "center", cursor: "pointer",
                border: `2px dashed ${isDragOver ? accent : inputBorder}`,
                background: isDragOver ? accent + "15" : rowBg,
                borderRadius: 10, color: isDragOver ? accent : textMuted,
                transition: "all .15s",
              }}>
              <Upload size={24} style={{ marginBottom: 6, opacity: 0.7 }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: textMain, marginBottom: 2 }}>
                Dateien hierher ziehen
              </div>
              <div style={{ fontSize: 11 }}>oder klicken — PDF, Bilder, XLSX, DOCX</div>
              <input ref={fileInputRef} type="file" multiple hidden onChange={onFileInputChange} />
            </div>

            {/* Listen-Header */}
            <div style={{
              padding: "4px 16px 6px", fontSize: 10, color: textMuted,
              display: "flex", justifyContent: "space-between", alignItems: "center",
              textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600,
            }}>
              <span>Warteschlange ({items.length})</span>
              {items.length > 0 && (
                <button onClick={clearAll}
                  style={{ background: "none", border: "none", cursor: "pointer", color: accent, fontSize: 11, fontWeight: 500, padding: 0 }}>
                  Alle entfernen
                </button>
              )}
            </div>

            {/* Dateien-Liste */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 12px" }}>
              {items.length === 0 ? (
                <div style={{ padding: "40px 16px", textAlign: "center", color: textMuted, fontSize: 12 }}>
                  Noch keine Dateien.<br/>Ziehe sie in die Zone oben.
                </div>
              ) : items.map(item => (
                <div key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px", borderRadius: 7, marginBottom: 4,
                    cursor: "pointer",
                    background: selectedId === item.id ? accent + "15" : "transparent",
                    border: `1px solid ${selectedId === item.id ? accent : "transparent"}`,
                  }}
                  onMouseEnter={(e) => { if (selectedId !== item.id) e.currentTarget.style.background = rowHover; }}
                  onMouseLeave={(e) => { if (selectedId !== item.id) e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ color: textMuted, flexShrink: 0 }}>{iconForFile(item.file)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: textMain,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {item.file.name}
                    </div>
                    <div style={{ fontSize: 10, color: textMuted, display: "flex", gap: 6, alignItems: "center", marginTop: 2, flexWrap: "wrap" }}>
                      <span>{formatBytes(item.file.size)}</span>
                      <StatusBadge status={item.status} confidence={item.confidence} />
                      {item.contentText != null && (item.status === "ready" || item.status === "parked") && (
                        <span
                          title={item.contentText.length > 0 ? "Text wurde erkannt — klicke auf die Datei und dann rechts auf 'Erkannten Text anzeigen'" : "Kein Text erkannt — OCR ist fehlgeschlagen"}
                          style={{
                            background: item.contentText.length > 0 ? "#dcfce7" : "#fee2e2",
                            color:      item.contentText.length > 0 ? "#166534" : "#991b1b",
                            padding: "1px 6px", borderRadius: 10, fontSize: 9, fontWeight: 600,
                          }}
                        >
                          {item.contentText.length > 0 ? `📝 ${item.contentText.length} Zeichen` : "📝 0 Zeichen"}
                        </span>
                      )}
                    </div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); removeItem(item.id); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: textMuted, padding: 4, display: "flex" }}
                    title="Entfernen">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* RECHTS: Detail-Panel */}
          {!selected ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: textMuted, fontSize: 13 }}>
              Wähle links eine Datei, um Details zu bearbeiten.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", overflow: "hidden" }}>

              {/* Preview (Placeholder für Schritt 3) */}
              <div style={{
                background: "#1a1a1a", display: "flex", alignItems: "center",
                justifyContent: "center", padding: 16, overflow: "auto",
              }}>
                <div style={{
                  color: "#888", fontSize: 13, textAlign: "center",
                  background: "#252525", padding: 40, borderRadius: 10, maxWidth: 400,
                }}>
                  <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.4 }}>📄</div>
                  <div style={{ color: "#ccc", fontWeight: 500, marginBottom: 6, wordBreak: "break-all" }}>
                    {selected.file.name}
                  </div>
                  <div style={{ fontSize: 11 }}>
                    {formatBytes(selected.file.size)} · {selected.file.type || "unbekannt"}
                  </div>
                  <div style={{ marginTop: 20, fontSize: 11, color: "#666", fontStyle: "italic" }}>
                    Vorschau folgt in Schritt 3<br/>(PDF-Rendering, Bild-Anzeige, XLSX-Tabelle)
                  </div>
                  <button
                    onClick={() => setShowText(true)}
                    disabled={!selected.contentText}
                    style={{
                      marginTop: 18, padding: "7px 14px", fontSize: 11,
                      background: selected.contentText ? "#4a7a4f" : "#3a3a3a",
                      color: selected.contentText ? "#fff" : "#777",
                      border: "none", borderRadius: 6,
                      cursor: selected.contentText ? "pointer" : "not-allowed",
                      display: "inline-flex", alignItems: "center", gap: 6,
                    }}
                    title={selected.contentText
                      ? "Zeigt den von OCR/Extraktion erkannten Text"
                      : "Noch kein Text extrahiert"}
                  >
                    <Eye size={12} />
                    Erkannten Text anzeigen
                    {selected.contentText && (
                      <span style={{ opacity: 0.8, fontSize: 10 }}>
                        ({selected.contentText.length} Zeichen)
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Felder */}
              <div style={{ padding: 16, overflowY: "auto", borderLeft: `1px solid ${border}`, background: cardBg }}>

                {/* KI-Banner wenn Status analyzing oder reason */}
                {selected.status === "analyzing" && (
                  <div style={{ marginBottom: 10, padding: "8px 10px", background: "#dbeafe", color: "#1e40af", borderRadius: 6, fontSize: 11 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                      <Sparkles size={12} /> {stageLabel(selected.stage)}
                    </div>
                    {selected.stageInfo && (
                      <div style={{ marginTop: 3, opacity: 0.85, fontSize: 10 }}>{selected.stageInfo}</div>
                    )}
                  </div>
                )}
                {selected.status === "ready" && selected.aiReason && (
                  <div style={{ marginBottom: 10, padding: "8px 10px", background: "#fef3c7", color: "#92400e", borderRadius: 6, fontSize: 11, border: "1px solid #fbbf24", display: "flex", alignItems: "center", gap: 6 }}>
                    <Sparkles size={12} /> <strong>{Math.round((selected.confidence||0)*100)}%</strong> · {selected.aiReason}
                  </div>
                )}
                {selected.status === "parked" && (
                  <div style={{ marginBottom: 10, padding: "8px 10px", background: "#fee2e2", color: "#991b1b", borderRadius: 6, fontSize: 11, border: "1px solid #fca5a5" }}>
                    🅿️ Kein Kunde erkannt — bitte manuell zuweisen
                    {selected.claudeError && <div style={{ marginTop: 3, fontSize: 10, opacity: 0.8 }}>Claude: {selected.claudeError}</div>}
                    {selected.contentText?.length === 0 && <div style={{ marginTop: 3, fontSize: 10, opacity: 0.8 }}>⚠ Kein Text extrahiert — OCR möglicherweise fehlgeschlagen</div>}
                  </div>
                )}
                {selected.claudeError && selected.status !== "parked" && (
                  <div style={{ marginBottom: 10, padding: "6px 10px", background: "#fee2e2", color: "#991b1b", borderRadius: 6, fontSize: 10 }}>
                    Claude-Fehler: {selected.claudeError}
                  </div>
                )}
                {selected.status === "error" && (
                  <div style={{ marginBottom: 10, padding: "8px 10px", background: "#fee2e2", color: "#991b1b", borderRadius: 6, fontSize: 11 }}>
                    ✗ Fehler: {selected.error}
                  </div>
                )}

                <FieldBlock label="Anzeigename *" inp={inp} muted={textMuted}>
                  <input value={selected.fields.name}
                    onChange={e => updateField(selected.id, { name: e.target.value })}
                    style={inp} />
                </FieldBlock>

                <FieldBlock label="Kunde *" inp={inp} muted={textMuted}>
                  <select value={selected.fields.customer_id}
                    onChange={e => { updateField(selected.id, { customer_id: e.target.value }); markHintCleared(selected.id, "customer_id"); }}
                    style={{ ...inp, cursor: "pointer", ...(selected.aiHints?.customer_id ? aiSuggestedStyle : {}) }}>
                    <option value="">— Kunde wählen —</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                  </select>
                  {selected.aiHints?.customer_id && <AiBadge />}
                </FieldBlock>

                <FieldBlock label="Kategorie *" inp={inp} muted={textMuted}>
                  <select value={selected.fields.category}
                    onChange={e => { updateField(selected.id, { category: e.target.value }); markHintCleared(selected.id, "category"); }}
                    style={{ ...inp, cursor: "pointer", ...(selected.aiHints?.category ? aiSuggestedStyle : {}) }}>
                    <option value="">— Kategorie —</option>
                    {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
                  </select>
                  {selected.aiHints?.category && <AiBadge />}
                </FieldBlock>

                <FieldBlock label="Tags *" inp={inp} muted={textMuted}>
                  <div style={selected.aiHints?.tag_ids ? { outline: "2px solid #fbbf24", borderRadius: 8 } : {}}>
                    <TagSelectWidget
                      value={selected.fields.tag_ids}
                      onChange={(ids) => { updateField(selected.id, { tag_ids: ids }); markHintCleared(selected.id, "tag_ids"); }}
                      onCategoryChange={(cat) => {
                        if (!selected.fields.category) updateField(selected.id, { category: cat });
                      }}
                      allTags={allTags}
                      s={{ cardBg, textMain, textMuted, inputBg, inputBorder, border }}
                      border={inputBorder}
                      accent={accent}
                    />
                  </div>
                  {selected.aiHints?.tag_ids && <AiBadge />}
                </FieldBlock>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <FieldBlock label="Jahr *" inp={inp} muted={textMuted}>
                    <input type="number" value={selected.fields.year}
                      onChange={e => { updateField(selected.id, { year: parseInt(e.target.value) || "" }); markHintCleared(selected.id, "year"); }}
                      style={{ ...inp, ...(selected.aiHints?.year ? aiSuggestedStyle : {}) }}
                      min="2000" max="2099" />
                  </FieldBlock>
                  <FieldBlock label="Datum (optional)" inp={inp} muted={textMuted}>
                    <input type="date" value={selected.fields.datum || ""}
                      onChange={e => updateField(selected.id, { datum: e.target.value })}
                      style={inp} />
                  </FieldBlock>
                </div>

                <FieldBlock label="Notiz (optional)" inp={inp} muted={textMuted}>
                  <textarea rows={3} value={selected.fields.notes}
                    onChange={e => updateField(selected.id, { notes: e.target.value })}
                    style={{ ...inp, resize: "vertical" }} />
                </FieldBlock>

                <button disabled
                  style={{
                    marginTop: 8, width: "100%", padding: "8px 10px",
                    background: "transparent", border: `1px dashed ${inputBorder}`,
                    color: textMuted, borderRadius: 6, fontSize: 11,
                    cursor: "not-allowed", display: "flex", alignItems: "center",
                    gap: 6, justifyContent: "center",
                  }}
                  title="Folgt in Schritt 3+4">
                  <Sparkles size={12} /> KI-Vorschlag (folgt)
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ───────────────────────────────────────────────── */}
        <div style={{
          borderTop: `1px solid ${border}`, padding: "12px 20px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          background: rowBg,
        }}>
          <div style={{ fontSize: 12, color: textMuted }}>
            {stats.total === 0 ? "Keine Dateien" : (
              <><strong style={{ color: textMain }}>{stats.total}</strong> Datei{stats.total === 1 ? "" : "en"}
              {stats.ready   > 0 && <> · <span style={{ color: "#10b981" }}>{stats.ready} bereit</span></>}
              {stats.parked  > 0 && <> · <span style={{ color: "#ef4444" }}>{stats.parked} geparkt</span></>}
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose}
              style={{
                padding: "8px 18px", borderRadius: 7, fontSize: 13, fontWeight: 500,
                background: "transparent", border: `1px solid ${border}`,
                color: textMuted, cursor: "pointer",
              }}>
              Abbrechen
            </button>
            <button
              onClick={handleUploadAll}
              disabled={uploading || stats.ready === 0}
              style={{
                padding: "8px 18px", borderRadius: 7, fontSize: 13, fontWeight: 600,
                background: accent, color: "#fff", border: "none",
                opacity: (uploading || stats.ready === 0) ? 0.5 : 1,
                cursor: (uploading || stats.ready === 0) ? "not-allowed" : "pointer",
                minWidth: 160,
              }}>
              {uploading ? "Lädt hoch…" : `✓ Hochladen (${stats.ready})`}
            </button>
          </div>
        </div>

        {/* ── OCR-Text-Viewer ─────────────────────────────────────── */}
        {showText && selected && (
          <div
            onClick={() => setShowText(false)}
            style={{
              position: "absolute", inset: 0, zIndex: 50,
              background: "rgba(0,0,0,0.75)",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: 20,
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: cardBg, border: `1px solid ${border}`,
                borderRadius: 10, width: "90%", height: "90%",
                maxWidth: 900, display: "flex", flexDirection: "column",
                boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
              }}
            >
              <div style={{
                padding: "12px 16px", borderBottom: `1px solid ${border}`,
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: textMain, display: "flex", alignItems: "center", gap: 6 }}>
                    <Eye size={14} /> Erkannter Text
                  </div>
                  <div style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>
                    {selected.file.name} · {selected.contentText?.length || 0} Zeichen
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(selected.contentText || "");
                    }}
                    style={{
                      padding: "5px 10px", fontSize: 11, borderRadius: 5,
                      background: "transparent", border: `1px solid ${border}`,
                      color: textMain, cursor: "pointer",
                    }}
                  >
                    📋 Kopieren
                  </button>
                  <button
                    onClick={() => setShowText(false)}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: textMuted, padding: 4, display: "flex",
                    }}
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
              <div style={{ flex: 1, overflow: "auto", padding: 14 }}>
                {selected.contentText ? (
                  <pre style={{
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                    fontFamily: "ui-monospace, Menlo, Consolas, monospace",
                    fontSize: 12, color: textMain, margin: 0,
                    lineHeight: 1.5,
                  }}>
                    {selected.contentText}
                  </pre>
                ) : (
                  <div style={{ color: textMuted, fontSize: 13, textAlign: "center", padding: 40, fontStyle: "italic" }}>
                    Kein Text extrahiert. Wenn es sich um ein gescanntes PDF oder ein Bild handelt, ist möglicherweise OCR fehlgeschlagen.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Resize-Griff unten-rechts ───────────────────────────── */}
        <div
          onMouseDown={onResizeDown}
          title="Ziehen zum Skalieren"
          style={{
            position: "absolute", right: 0, bottom: 0, width: 18, height: 18,
            cursor: "nwse-resize", background: "transparent",
            borderRight: `3px solid ${textMuted}`,
            borderBottom: `3px solid ${textMuted}`,
            borderBottomRightRadius: 14, opacity: 0.5,
          }}
        />
      </div>
    </div>
  );
}

// ─── Sub-Komponenten ──────────────────────────────────────────────────

function StatusBadge({ status, confidence }) {
  const styles = {
    pending:   { bg: "#e5e7eb", fg: "#374151", text: "wartet" },
    analyzing: { bg: "#dbeafe", fg: "#1e40af", text: "⏳ analysiert" },
    ready:     { bg: "#d1fae5", fg: "#065f46", text: "✓ bereit" },
    parked:    { bg: "#fee2e2", fg: "#991b1b", text: "⚠ geparkt" },
    uploading: { bg: "#fef3c7", fg: "#92400e", text: "⬆ lädt…" },
    done:      { bg: "#d1fae5", fg: "#065f46", text: "✓ fertig" },
    error:     { bg: "#fee2e2", fg: "#991b1b", text: "✗ Fehler" },
  };
  const s = styles[status] || styles.pending;
  return (
    <span style={{
      background: s.bg, color: s.fg, padding: "1px 6px",
      borderRadius: 10, fontSize: 9, fontWeight: 600, letterSpacing: ".02em",
    }}>
      {s.text}{confidence != null && status === "ready" && ` · ${Math.round(confidence*100)}%`}
    </span>
  );
}

function FieldBlock({ label, children, muted }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 11, color: muted, display: "block", marginBottom: 3, fontWeight: 500 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

