import React, { useContext, useState, useEffect } from "react";
import { ThemeContext } from "@/Layout";
import { entities } from "@/api/supabaseClient";
import { Sparkles, Plus, Copy, Pencil, Trash2, Check, X, Search } from "lucide-react";
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
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ titel: "", kategorie: "", inhalt: "" });
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(null);

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

  const categories = [...new Set(vorlagen.map((v) => v.kategorie).filter(Boolean))];

  const filtered = vorlagen.filter((v) => {
    const q = search.toLowerCase();
    return (
      v.titel.toLowerCase().includes(q) ||
      (v.kategorie || "").toLowerCase().includes(q) ||
      v.inhalt.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col h-full p-6 overflow-auto" style={{ backgroundColor: pageBg }}>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: headerIconBg }}>
            <Sparkles className="w-6 h-6" style={{ color: accent }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: headingColor }}>Promptvorlagen</h1>
            <p className="text-sm" style={{ color: subColor }}>Claude-Prompts für alle Mitarbeitenden</p>
          </div>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: accent }}
        >
          <Plus className="w-4 h-4" />
          Neue Vorlage
        </button>
      </div>

      {/* Suchfeld */}
      <div className="relative mb-6 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: subColor }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Suchen nach Titel, Kategorie oder Inhalt..."
          className="w-full pl-9 pr-4 py-2 rounded-xl text-sm outline-none"
          style={{ backgroundColor: cardBg, border: `1px solid ${inputBorder}`, color: headingColor }}
        />
      </div>

      {/* Vorlagen-Liste */}
      {loading ? (
        <p className="text-sm" style={{ color: subColor }}>Wird geladen…</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20" style={{ color: subColor }}>
          <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-25" />
          <p className="text-base font-medium">Noch keine Vorlagen vorhanden</p>
          <p className="text-sm mt-1">Klicke auf «Neue Vorlage» um loszulegen</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4 max-w-3xl">
          {filtered.map((v) => (
            <div
              key={v.id}
              className="rounded-2xl p-5"
              style={{ backgroundColor: cardBg, border: `1px solid ${cardBorder}` }}
            >
              <div className="flex items-start justify-between gap-4">
                {/* Inhalt */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <h3 className="font-semibold text-sm" style={{ color: headingColor }}>{v.titel}</h3>
                    {v.kategorie && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: badgeBg, color: badgeColor }}
                      >
                        {v.kategorie}
                      </span>
                    )}
                  </div>
                  <p
                    className="text-sm leading-relaxed whitespace-pre-wrap"
                    style={{ color: subColor }}
                  >
                    {v.inhalt}
                  </p>
                </div>

                {/* Aktionen */}
                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                  <button
                    onClick={() => copyToClipboard(v)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                    style={{
                      backgroundColor: copied === v.id ? (isDark ? "#14532d" : "#f0fdf4") : accent + "18",
                      color: copied === v.id ? "#16a34a" : accent,
                    }}
                    title="In Zwischenablage kopieren"
                  >
                    {copied === v.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied === v.id ? "Kopiert" : "Kopieren"}
                  </button>
                  <button
                    onClick={() => openEdit(v)}
                    className="p-1.5 rounded-lg transition-opacity hover:opacity-60"
                    style={{ color: subColor }}
                    title="Bearbeiten"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deleteVorlage(v.id)}
                    className="p-1.5 rounded-lg transition-opacity hover:opacity-60"
                    style={{ color: "#ef4444" }}
                    title="Löschen"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Neu / Bearbeiten */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
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
                  onChange={(e) => setForm((f) => ({ ...f, titel: e.target.value }))}
                  placeholder="z.B. E-Mail zusammenfassen"
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ backgroundColor: inputBg, border: `1px solid ${inputBorder}`, color: headingColor }}
                />
              </div>

              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: subColor }}>Kategorie</label>
                <input
                  value={form.kategorie}
                  onChange={(e) => setForm((f) => ({ ...f, kategorie: e.target.value }))}
                  placeholder="z.B. Mails, Steuern, Allgemein"
                  list="kategorien-list"
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ backgroundColor: inputBg, border: `1px solid ${inputBorder}`, color: headingColor }}
                />
                <datalist id="kategorien-list">
                  {categories.map((k) => <option key={k} value={k} />)}
                </datalist>
              </div>

              <div>
                <label className="text-xs font-semibold mb-1 block" style={{ color: subColor }}>
                  Prompt-Text <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <textarea
                  value={form.inhalt}
                  onChange={(e) => setForm((f) => ({ ...f, inhalt: e.target.value }))}
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
