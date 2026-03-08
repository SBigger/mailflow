import React, { useState, useContext, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { entities } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";
import {
  BookOpen, Plus, Trash2, Edit2, Search,
  Upload, FileText, Check, X, Loader2, ChevronDown
} from "lucide-react";
import { toast } from "sonner";

const CATEGORIES = ["Allgemein", "Steuern", "Abacus", "Jahresabschluss", "AHV/IV", "MWST", "Lohn", "Diverses"];

export default function KnowledgeBase() {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const qc = useQueryClient();

  const [searchQuery, setSearchQuery]   = useState("");
  const [filterCat, setFilterCat]       = useState("Alle");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editEntry, setEditEntry]       = useState(null);

  // Theme Colors
  const pageBg    = isArtis ? "#f2f5f2" : isLight ? "#f4f4f8" : "#18181b";
  const cardBg    = isArtis ? "#ffffff" : isLight ? "#ffffff" : "#27272a";
  const headerBg  = isArtis ? "#f2f5f2" : isLight ? "#f0f0f6" : "#27272a";
  const textMain  = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted = isArtis ? "#6b826b" : isLight ? "#9090b8" : "#71717a";
  const border    = isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "rgba(63,63,70,0.5)";
  const accent    = isArtis ? "#7a9b7f" : isLight ? "#6366f1" : "#6366f1";
  const inputBg   = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(39,39,42,0.8)";

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["knowledgeBase"],
    queryFn: () => entities.KnowledgeBase.list("-created_at"),
  });

  const deleteEntry = useMutation({
    mutationFn: (id) => entities.KnowledgeBase.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["knowledgeBase"] }); toast.success("Eintrag gelöscht"); },
  });

  // Filter
  const filtered = entries.filter(e => {
    const matchCat = filterCat === "Alle" || e.category === filterCat;
    const q = searchQuery.toLowerCase();
    const matchSearch = !q || e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q);
    return matchCat && matchSearch && e.is_active !== false;
  });

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: pageBg }}>

      {/* Top Bar */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 border-b flex-wrap"
        style={{ backgroundColor: headerBg, borderColor: border }}>
        <div className="flex items-center gap-2 mr-2">
          <BookOpen className="h-5 w-5" style={{ color: accent }} />
          <span className="font-semibold text-sm" style={{ color: textMain }}>Wissensdatenbank</span>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: accent + "22", color: accent }}>
            {filtered.length} Einträge
          </span>
        </div>

        {/* Suche */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: textMuted }} />
          <input type="text" placeholder="Suchen…" value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-8 pr-3 py-1.5 rounded-lg border text-xs outline-none"
            style={{ backgroundColor: inputBg, borderColor: border, color: textMain, width: "200px" }} />
        </div>

        {/* Kategorie-Filter */}
        <div className="flex items-center gap-1 flex-wrap">
          {["Alle", ...CATEGORIES].map(cat => (
            <button key={cat} onClick={() => setFilterCat(cat)}
              className="px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
              style={{
                backgroundColor: filterCat === cat ? accent : "transparent",
                color: filterCat === cat ? "#fff" : textMuted,
                borderColor: filterCat === cat ? accent : border,
              }}>
              {cat}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <button onClick={() => { setEditEntry(null); setShowAddDialog(true); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{ backgroundColor: accent, color: "#fff" }}>
          <Plus className="h-3.5 w-3.5" /> Neuer Eintrag
        </button>
      </div>

      {/* Einträge */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: textMuted }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <BookOpen className="h-10 w-10" style={{ color: textMuted, opacity: 0.3 }} />
            <p className="text-sm" style={{ color: textMuted }}>Noch keine Einträge – füge Wissen für die KI hinzu.</p>
            <button onClick={() => { setEditEntry(null); setShowAddDialog(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium mt-1"
              style={{ backgroundColor: accent, color: "#fff" }}>
              <Plus className="h-3.5 w-3.5" /> Ersten Eintrag erstellen
            </button>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))" }}>
            {filtered.map(entry => (
              <KBCard key={entry.id} entry={entry} theme={theme}
                onEdit={() => { setEditEntry(entry); setShowAddDialog(true); }}
                onDelete={() => { if (confirm("Eintrag löschen?")) deleteEntry.mutate(entry.id); }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Dialog */}
      {showAddDialog && (
        <KBDialog
          entry={editEntry}
          theme={theme}
          onClose={() => { setShowAddDialog(false); setEditEntry(null); }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["knowledgeBase"] });
            setShowAddDialog(false);
            setEditEntry(null);
          }}
        />
      )}
    </div>
  );
}

// ── Karte ────────────────────────────────────────────
function KBCard({ entry, theme, onEdit, onDelete }) {
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const [expanded, setExpanded] = useState(false);

  const cardBg    = isArtis ? "#ffffff" : isLight ? "#ffffff" : "#27272a";
  const textMain  = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted = isArtis ? "#6b826b" : isLight ? "#9090b8" : "#71717a";
  const border    = isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "rgba(63,63,70,0.5)";
  const accent    = isArtis ? "#7a9b7f" : isLight ? "#6366f1" : "#6366f1";

  const preview = entry.content.slice(0, 180) + (entry.content.length > 180 ? "…" : "");

  return (
    <div className="rounded-xl border p-4 flex flex-col gap-2" style={{ backgroundColor: cardBg, borderColor: border }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: accent + "18", color: accent }}>
              {entry.category}
            </span>
            {entry.source_file && (
              <span className="text-xs flex items-center gap-1" style={{ color: textMuted }}>
                <FileText className="h-3 w-3" /> {entry.source_file}
              </span>
            )}
          </div>
          <h3 className="font-semibold text-sm mt-1.5 leading-tight" style={{ color: textMain }}>
            {entry.title}
          </h3>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onEdit} className="p-1.5 rounded-lg transition-colors hover:opacity-70"
            style={{ color: textMuted }}>
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-lg transition-colors hover:opacity-70"
            style={{ color: "#ef4444" }}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <p className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: textMuted }}>
        {expanded ? entry.content : preview}
      </p>

      {entry.content.length > 180 && (
        <button onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1 text-xs self-start"
          style={{ color: accent }}>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
          {expanded ? "Weniger" : "Mehr anzeigen"}
        </button>
      )}
    </div>
  );
}

// ── Add/Edit Dialog mit PDF-Upload ────────────────────
function KBDialog({ entry, theme, onClose, onSaved }) {
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const fileInputRef = useRef(null);

  const [title, setTitle]       = useState(entry?.title || "");
  const [content, setContent]   = useState(entry?.content || "");
  const [category, setCategory] = useState(entry?.category || "Allgemein");
  const [sourceFile, setSourceFile] = useState(entry?.source_file || "");
  const [saving, setSaving]     = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  const overlayBg = "rgba(0,0,0,0.5)";
  const cardBg    = isArtis ? "#ffffff" : isLight ? "#ffffff" : "#27272a";
  const textMain  = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted = isArtis ? "#6b826b" : isLight ? "#9090b8" : "#71717a";
  const border    = isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "rgba(63,63,70,0.5)";
  const accent    = isArtis ? "#7a9b7f" : isLight ? "#6366f1" : "#6366f1";
  const inputBg   = isArtis ? "#f8faf8" : isLight ? "#f8f8fc" : "rgba(39,39,42,0.8)";

  // PDF Text extrahieren via pdf.js (CDN)
  const handlePdfUpload = async (file) => {
    if (!file || file.type !== "application/pdf") {
      toast.error("Bitte eine PDF-Datei auswählen");
      return;
    }
    setPdfLoading(true);
    try {
      // pdf.js dynamisch laden
      const pdfjsLib = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js")
        .catch(() => null);

      // Fallback: direkt via CDN script tag
      if (!window.pdfjsLib) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      }

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      let fullText = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(" ");
        fullText += pageText + "\n\n";
      }

      // Titel aus Dateiname ableiten
      if (!title) {
        setTitle(file.name.replace(/\.pdf$/i, "").replace(/[-_]/g, " "));
      }
      setContent(fullText.trim());
      setSourceFile(file.name);
      toast.success(`PDF extrahiert: ${pdf.numPages} Seiten`);
    } catch (err) {
      console.error("PDF Fehler:", err);
      toast.error("PDF konnte nicht gelesen werden: " + err.message);
    } finally {
      setPdfLoading(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error("Titel und Inhalt sind erforderlich");
      return;
    }
    setSaving(true);
    try {
      const payload = { title: title.trim(), content: content.trim(), category, source_file: sourceFile || null };
      if (entry?.id) {
        await entities.KnowledgeBase.update(entry.id, payload);
        toast.success("Eintrag aktualisiert");
      } else {
        await entities.KnowledgeBase.create(payload);
        toast.success("Eintrag gespeichert");
      }
      onSaved();
    } catch (e) {
      toast.error("Fehler: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ backgroundColor: overlayBg }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-2xl border shadow-2xl flex flex-col"
        style={{ backgroundColor: cardBg, borderColor: border, width: "640px", maxHeight: "90vh" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0"
          style={{ borderColor: border }}>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" style={{ color: accent }} />
            <span className="font-semibold text-sm" style={{ color: textMain }}>
              {entry ? "Eintrag bearbeiten" : "Neuer Wissenseintrag"}
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:opacity-70"
            style={{ color: textMuted }}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">

          {/* PDF Upload Zone */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: textMuted }}>
              PDF hochladen (Text wird automatisch extrahiert)
            </label>
            <div
              className="border-2 border-dashed rounded-xl p-5 flex flex-col items-center gap-2 cursor-pointer transition-colors"
              style={{ borderColor: border }}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = accent; }}
              onDragLeave={e => { e.currentTarget.style.borderColor = border; }}
              onDrop={e => {
                e.preventDefault();
                e.currentTarget.style.borderColor = border;
                const file = e.dataTransfer.files[0];
                if (file) handlePdfUpload(file);
              }}
            >
              {pdfLoading ? (
                <><Loader2 className="h-6 w-6 animate-spin" style={{ color: accent }} />
                  <span className="text-xs" style={{ color: textMuted }}>PDF wird extrahiert…</span></>
              ) : (
                <><Upload className="h-6 w-6" style={{ color: textMuted }} />
                  <span className="text-xs font-medium" style={{ color: textMain }}>PDF hierher ziehen oder klicken</span>
                  <span className="text-xs" style={{ color: textMuted }}>Text wird automatisch aus allen Seiten extrahiert</span></>
              )}
              <input ref={fileInputRef} type="file" accept=".pdf" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handlePdfUpload(f); }} />
            </div>
          </div>

          {/* Trennlinie */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px" style={{ backgroundColor: border }} />
            <span className="text-xs" style={{ color: textMuted }}>oder manuell eingeben</span>
            <div className="flex-1 h-px" style={{ backgroundColor: border }} />
          </div>

          {/* Titel */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: textMuted }}>Titel *</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="z.B. Abacus – Lohnbuchhaltung Kurzanleitung"
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ backgroundColor: inputBg, borderColor: border, color: textMain }} />
          </div>

          {/* Kategorie */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: textMuted }}>Kategorie</label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map(cat => (
                <button key={cat} type="button" onClick={() => setCategory(cat)}
                  className="px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
                  style={{
                    backgroundColor: category === cat ? accent : "transparent",
                    color: category === cat ? "#fff" : textMuted,
                    borderColor: category === cat ? accent : border,
                  }}>
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Inhalt */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: textMuted }}>
              Inhalt * {content && <span style={{ color: accent }}>({content.length.toLocaleString()} Zeichen)</span>}
            </label>
            <textarea value={content} onChange={e => setContent(e.target.value)}
              placeholder="Wissensinhalt für die KI – Anleitungen, FAQs, interne Prozesse…"
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none resize-y"
              style={{
                backgroundColor: inputBg, borderColor: border, color: textMain,
                minHeight: "200px", maxHeight: "400px",
              }} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t flex-shrink-0"
          style={{ borderColor: border }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border transition-colors"
            style={{ borderColor: border, color: textMuted }}>
            Abbrechen
          </button>
          <button onClick={handleSave} disabled={saving || !title.trim() || !content.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              backgroundColor: (saving || !title.trim() || !content.trim()) ? textMuted : accent,
              color: "#fff",
            }}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {entry ? "Aktualisieren" : "Speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}
