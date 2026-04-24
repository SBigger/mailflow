import React, { useContext, useState, useEffect, useRef } from "react";
import { ThemeContext } from "@/Layout";
import { entities } from "@/api/supabaseClient";
import { Sparkles, Plus, Copy, Pencil, Trash2, Check, X, Search, GripVertical } from "lucide-react";
import { toast } from "sonner";

export default function Promptvorlagen() {
  const { theme } = useContext(ThemeContext);
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const isDark = !isLight && !isArtis;

  const pageBg      = isLight ? "#f4f4f8"               : isArtis ? "#f2f5f2"               : "#2a2a2f";
  const cardBg      = isLight ? "rgba(255,255,255,0.9)"  : isArtis ? "rgba(255,255,255,0.85)" : "rgba(39,39,42,0.8)";
  const cardBorder  = isLight ? "#e2e2ec"                : isArtis ? "#ccd8cc"               : "#3f3f46";
  const headingColor= isLight ? "#1e293b"                : isArtis ? "#1a3a1a"               : "#e4e4e7";
  const subColor    = isLight ? "#64748b"                : isArtis ? "#4a6a4a"               : "#a1a1aa";
  const accent      = isArtis ? "#7a9b7f"                : isLight  ? "#4f6aab"              : "#7c3aed";
  const headerIconBg= isLight ? "#f0f0fa"                : isArtis  ? "#e8f2e8"              : "#3f3f46";
  const inputBg     = isLight ? "#ffffff"                : isArtis  ? "#f8faf8"              : "#1a1a1f";
  const inputBorder = cardBorder;
  const modalBg     = isLight ? "#ffffff"                : isArtis  ? "#f8faf8"              : "#27272a";
  const badgeBg     = isLight ? "#f3eeff"                : isArtis  ? "#e8f2e8"              : "#3f3f46";
  const badgeColor  = isLight ? "#6a3ba0"                : isArtis  ? "#7a9b7f"              : "#a78bfa";

  const [vorlagen, setVorlagen] = useState([]);
  const [order, setOrder] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ titel: "", kategorie: "", inhalt: "" });
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(null);
  const dragId = useRef(null);
  const [dragOver, setDragOver] = useState(null);

  const load = async () => {
    try {
      const data = await entities.PromptVorlage.list("-created_at");
      setVorlagen(data);
    } catch {
      toast.error("Fehler beim Laden der Vorlagen");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const unsub = entities.PromptVorlage.subscribe(() => load());
    return unsub;
  }, []);

  // Keep custom order; append new IDs, remove deleted ones
  useEffect(() => {
    setOrder(prev => {
      const ids = vorlagen.map(v => v.id);
      const kept = prev.filter(id => ids.includes(id));
      const added = ids.filter(id => !kept.includes(id));
      return [...kept, ...added];
    });
  }, [vorlagen]);

  const openNew = () => {
    setEditing(null);
    setForm({ titel: "", kategorie: "", inhalt: "" });
    setShowModal(true);
  };

  const openEdit = (v) => {
    setEditing(v);
    setForm({ titel: v.titel, kategorie: v.kategorie || "", inhalt: v.inhalt });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.titel.trim() || !form.inhalt.trim()) {
      toast.error("Titel und Inhalt sind Pflichtfelder");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await entities.PromptVorlage.update(editing.id, { titel: form.titel, kategorie: form.kategorie, inhalt: form.inhalt });
        toast.success("Vorlage aktualisiert");
      } else {
        await entities.PromptVorlage.create({ titel: form.titel, kategorie: form.kategorie, inhalt: form.inhalt });
        toast.success("Vorlage erstellt");
      }
      setShowModal(false);
      load();
    } catch {
      toast.error("Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  };

  const deleteVorlage = async (id) => {
    if (!window.confirm("Vorlage wirklich löschen?")) return;
    try {
      await entities.PromptVorlage.delete(id);
      toast.success("Vorlage gelöscht");
      load();
    } catch {
      toast.error("Fehler beim Löschen");
    }
  };

  const copyToClipboard = async (v) => {
    try {
      await navigator.clipboard.writeText(v.inhalt);
      setCopied(v.id);
      toast.success("In Zwischenablage kopiert");
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error("Kopieren fehlgeschlagen");
    }
  };

  // Drag & Drop handlers
  const onDragStart = (e, id) => {
    dragId.current = id;
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e, id) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragId.current !== id) setDragOver(id);
  };
  const onDrop = (e, targetId) => {
    e.preventDefault();
    const from = dragId.current;
    if (!from || from === targetId) { setDragOver(null); return; }
    setOrder(prev => {
      const arr = [...prev];
      const fi = arr.indexOf(from);
      const ti = arr.indexOf(targetId);
      arr.splice(fi, 1);
      arr.splice(ti, 0, from);
      return arr;
    });
    setDragOver(null);
    dragId.current = null;
  };
  const onDragEnd = () => { setDragOver(null); dragId.current = null; };

  const categories = [...new Set(vorlagen.map(v => v.kategorie).filter(Boolean))];

  const q = search.toLowerCase();
  const sorted = order
    .map(id => vorlagen.find(v => v.id === id))
    .filter(Boolean)
    .filter(v =>
      v.titel.toLowerCase().includes(q) ||
      (v.kategorie || "").toLowerCase().includes(q) ||
      v.inhalt.toLowerCase().includes(q)
    );

  return (
    <div className="flex flex-col h-full p-6 overflow-auto" style={{ backgroundColor: pageBg }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: headerIconBg }}>
            <Sparkles className="w-5 h-5" style={{ color: accent }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: headingColor }}>Promptvorlagen</h1>
            <p className="text-xs" style={{ color: subColor }}>Claude-Prompts für alle Mitarbeitenden</p>
          </div>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl font-semibold text-white text-sm transition-opacity hover:opacity-90"
          style={{ backgroundColor: accent }}
        >
          <Plus className="w-4 h-4" />
          Neue Vorlage
        </button>
      </div>

      {/* Suchfeld */}
      <div className="relative mb-5 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: subColor }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Suchen…"
          className="w-full pl-8 pr-4 py-1.5 rounded-xl text-sm outline-none"
          style={{ backgroundColor: cardBg, border: `1px solid ${inputBorder}`, color: headingColor }}
        />
      </div>

      {/* Grid */}
      {loading ? (
        <p className="text-sm" style={{ color: subColor }}>Wird geladen…</p>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16" style={{ color: subColor }}>
          <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-25" />
          <p className="text-sm font-medium">Noch keine Vorlagen vorhanden</p>
          <p className="text-xs mt-1">Klicke auf «Neue Vorlage» um loszulegen</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {sorted.map(v => (
            <div
              key={v.id}
              draggable
              onDragStart={e => onDragStart(e, v.id)}
              onDragOver={e => onDragOver(e, v.id)}
              onDrop={e => onDrop(e, v.id)}
              onDragEnd={onDragEnd}
              className="rounded-xl p-3 flex flex-col gap-2 transition-all"
              style={{
                backgroundColor: cardBg,
                border: `1px solid ${dragOver === v.id ? accent : cardBorder}`,
                opacity: dragId.current === v.id ? 0.5 : 1,
                cursor: "grab",
              }}
            >
              {/* Titel-Zeile */}
              <div className="flex items-start gap-1.5">
                <GripVertical className="w-3.5 h-3.5 mt-0.5 shrink-0 opacity-30" style={{ color: subColor }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-xs leading-tight" style={{ color: headingColor }}>{v.titel}</span>
                    {v.kategorie && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0" style={{ backgroundColor: badgeBg, color: badgeColor, fontSize: "10px" }}>
                        {v.kategorie}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Inhalt (3 Zeilen) */}
              <p
                className="text-xs leading-relaxed"
                style={{
                  color: subColor,
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {v.inhalt}
              </p>

              {/* Aktionen */}
              <div className="flex items-center gap-1 mt-auto pt-1" style={{ borderTop: `1px solid ${cardBorder}` }}>
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); copyToClipboard(v); }}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold transition-all flex-1 justify-center"
                  style={{
                    backgroundColor: copied === v.id ? (isDark ? "#14532d" : "#f0fdf4") : accent + "15",
                    color: copied === v.id ? "#16a34a" : accent,
                    cursor: "pointer",
                  }}
                >
                  {copied === v.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied === v.id ? "Kopiert" : "Kopieren"}
                </button>
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); openEdit(v); }}
                  className="p-1 rounded-lg transition-opacity hover:opacity-60"
                  style={{ color: subColor, cursor: "pointer" }}
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); deleteVorlage(v.id); }}
                  className="p-1 rounded-lg transition-opacity hover:opacity-60"
                  style={{ color: "#ef4444", cursor: "pointer" }}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div
            className="w-full max-w-lg rounded-2xl p-6 mx-4"
            style={{ backgroundColor: modalBg, border: `1px solid ${cardBorder}` }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold" style={{ color: headingColor }}>
                {editing ? "Vorlage bearbeiten" : "Neue Vorlage"}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 rounded-lg hover:opacity-60" style={{ color: subColor }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: subColor }}>
                  Titel <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  value={form.titel}
                  onChange={e => setForm(f => ({ ...f, titel: e.target.value }))}
                  placeholder="z.B. E-Mail zusammenfassen"
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ backgroundColor: inputBg, border: `1px solid ${inputBorder}`, color: headingColor }}
                />
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: subColor }}>Kategorie</label>
                <input
                  value={form.kategorie}
                  onChange={e => setForm(f => ({ ...f, kategorie: e.target.value }))}
                  placeholder="z.B. Mails, Steuern, Allgemein"
                  list="kategorien-list"
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ backgroundColor: inputBg, border: `1px solid ${inputBorder}`, color: headingColor }}
                />
                <datalist id="kategorien-list">
                  {categories.map(k => <option key={k} value={k} />)}
                </datalist>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: subColor }}>
                  Prompt-Text <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <textarea
                  value={form.inhalt}
                  onChange={e => setForm(f => ({ ...f, inhalt: e.target.value }))}
                  placeholder="Schreibe hier den vollständigen Prompt…"
                  rows={7}
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-y"
                  style={{ backgroundColor: inputBg, border: `1px solid ${inputBorder}`, color: headingColor }}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ backgroundColor: isDark ? "#3f3f46" : "#f1f5f9", color: subColor }}
              >
                Abbrechen
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
                style={{ backgroundColor: accent }}
              >
                {saving ? "Speichern…" : "Speichern"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
