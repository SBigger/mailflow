import React, { useState, useContext } from "react";
import { ThemeContext } from "@/Layout";
import { Plus, Eye, EyeOff, Pencil, Trash2, Check, X, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 8 }, (_, i) => currentYear + 2 - i); // aktuell+2 bis aktuell-5

export default function CustomerSteuerZugaengeTab({ customer, onUpdate }) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === "artis";
  const isLight = theme === "light";

  const textMain   = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted  = isArtis ? "#6b826b" : isLight ? "#7a7a9a" : "#71717a";
  const cardBg     = isArtis ? "#ffffff" : isLight ? "#ffffff" : "rgba(39,39,42,0.6)";
  const cardBorder = isArtis ? "#d4e0d4" : isLight ? "#d4d4e8" : "#3f3f46";
  const inputClass = isArtis
    ? "bg-white border-[#bfcfbf] text-[#2d3a2d]"
    : isLight
    ? "bg-white border-[#c8c8dc] text-[#1a1a2e]"
    : "bg-zinc-800 border-zinc-600 text-zinc-200";
  const accentBg   = isArtis ? "#7a9b7f" : "#7c3aed";

  const zugaenge = (customer.steuer_zugaenge || [])
    .slice()
    .sort((a, b) => b.jahr - a.jahr);

  // Reveal state per row (by index)
  const [revealed, setReveal] = useState({});
  const toggleReveal = (idx) => setReveal(prev => ({ ...prev, [idx]: !prev[idx] }));

  // Editing state
  const [editIdx,    setEditIdx]    = useState(null); // index in zugaenge array, or null
  const [editForm,   setEditForm]   = useState({ jahr: String(currentYear), nummer: "", passwort: "" });
  const [showNewForm, setShowNewForm] = useState(false);
  const [newForm,    setNewForm]    = useState({ jahr: String(currentYear), nummer: "", passwort: "" });

  const save = (updated) => {
    onUpdate({ steuer_zugaenge: updated });
  };

  const handleDelete = (idx) => {
    if (!window.confirm("Eintrag wirklich löschen?")) return;
    const updated = zugaenge.filter((_, i) => i !== idx);
    save(updated);
  };

  const handleStartEdit = (idx) => {
    const z = zugaenge[idx];
    setEditForm({ jahr: String(z.jahr), nummer: z.nummer || "", passwort: z.passwort || "" });
    setEditIdx(idx);
    setShowNewForm(false);
  };

  const handleSaveEdit = () => {
    const updated = zugaenge.map((z, i) =>
      i === editIdx
        ? { jahr: parseInt(editForm.jahr, 10), nummer: editForm.nummer, passwort: editForm.passwort }
        : z
    );
    save(updated);
    setEditIdx(null);
  };

  const handleAdd = () => {
    if (!newForm.nummer) return;
    const entry = { jahr: parseInt(newForm.jahr, 10), nummer: newForm.nummer, passwort: newForm.passwort };
    const updated = [...zugaenge, entry].sort((a, b) => b.jahr - a.jahr);
    save(updated);
    setNewForm({ jahr: String(currentYear), nummer: "", passwort: "" });
    setShowNewForm(false);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <p className="text-sm font-medium" style={{ color: textMain }}>Steuer-Zugänge</p>
          <p className="text-xs" style={{ color: textMuted }}>
            Zugangsnummer und Passwort der Steuererklärung — pro Jahr
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => { setShowNewForm(true); setEditIdx(null); }}
          className="h-7 gap-1.5 text-xs"
          style={{ backgroundColor: accentBg, color: "#fff" }}
        >
          <Plus className="h-3.5 w-3.5" /> Neues Jahr
        </Button>
      </div>

      {/* New entry form */}
      {showNewForm && (
        <div
          className="p-3 rounded-lg border space-y-3"
          style={{ backgroundColor: cardBg, borderColor: accentBg }}
        >
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: textMuted }}>Jahr</label>
              <Select value={newForm.jahr} onValueChange={v => setNewForm(f => ({ ...f, jahr: v }))}>
                <SelectTrigger className={`h-8 text-xs ${inputClass}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: textMuted }}>Zugangsnummer</label>
              <Input
                value={newForm.nummer}
                onChange={e => setNewForm(f => ({ ...f, nummer: e.target.value }))}
                placeholder="Nr."
                className={`h-8 text-xs ${inputClass}`}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: textMuted }}>Passwort</label>
              <Input
                value={newForm.passwort}
                onChange={e => setNewForm(f => ({ ...f, passwort: e.target.value }))}
                placeholder="Passwort"
                className={`h-8 text-xs ${inputClass}`}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowNewForm(false)} className="h-7 text-xs" style={{ color: textMuted }}>
              <X className="h-3.5 w-3.5 mr-1" /> Abbrechen
            </Button>
            <Button size="sm" onClick={handleAdd} disabled={!newForm.nummer} className="h-7 text-xs" style={{ backgroundColor: accentBg, color: "#fff" }}>
              <Check className="h-3.5 w-3.5 mr-1" /> Speichern
            </Button>
          </div>
        </div>
      )}

      {/* List */}
      {zugaenge.length === 0 && !showNewForm ? (
        <div className="flex flex-col items-center justify-center py-10 gap-3" style={{ color: textMuted }}>
          <KeyRound className="h-10 w-10 opacity-30" />
          <p className="text-sm">Noch keine Steuer-Zugänge erfasst.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {zugaenge.map((z, idx) => (
            <div
              key={idx}
              className="rounded-lg border overflow-hidden"
              style={{ backgroundColor: cardBg, borderColor: cardBorder }}
            >
              {editIdx === idx ? (
                /* Edit form */
                <div className="p-3 space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium" style={{ color: textMuted }}>Jahr</label>
                      <Select value={editForm.jahr} onValueChange={v => setEditForm(f => ({ ...f, jahr: v }))}>
                        <SelectTrigger className={`h-8 text-xs ${inputClass}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium" style={{ color: textMuted }}>Zugangsnummer</label>
                      <Input
                        value={editForm.nummer}
                        onChange={e => setEditForm(f => ({ ...f, nummer: e.target.value }))}
                        className={`h-8 text-xs ${inputClass}`}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium" style={{ color: textMuted }}>Passwort</label>
                      <Input
                        value={editForm.passwort}
                        onChange={e => setEditForm(f => ({ ...f, passwort: e.target.value }))}
                        className={`h-8 text-xs ${inputClass}`}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditIdx(null)} className="h-7 text-xs" style={{ color: textMuted }}>
                      <X className="h-3.5 w-3.5 mr-1" /> Abbrechen
                    </Button>
                    <Button size="sm" onClick={handleSaveEdit} className="h-7 text-xs" style={{ backgroundColor: accentBg, color: "#fff" }}>
                      <Check className="h-3.5 w-3.5 mr-1" /> Speichern
                    </Button>
                  </div>
                </div>
              ) : (
                /* Display row */
                <div className="flex items-center gap-3 px-4 py-3 group">
                  {/* Jahr badge */}
                  <span
                    className="flex-shrink-0 text-sm font-bold w-12"
                    style={{ color: isArtis ? "#4a5e4a" : isLight ? "#4c1d95" : "#818cf8" }}
                  >
                    {z.jahr}
                  </span>

                  {/* Nummer */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs" style={{ color: textMuted }}>Nr.</span>
                      <span className="text-sm font-mono" style={{ color: textMain }}>{z.nummer || "—"}</span>
                    </div>
                  </div>

                  {/* Passwort */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-xs" style={{ color: textMuted }}>PW</span>
                    <span className="text-sm font-mono" style={{ color: textMain }}>
                      {z.passwort
                        ? revealed[idx]
                          ? z.passwort
                          : "•".repeat(Math.min(z.passwort.length, 8))
                        : "—"}
                    </span>
                    {z.passwort && (
                      <button
                        onClick={() => toggleReveal(idx)}
                        className="p-1 rounded hover:bg-zinc-500/10"
                        style={{ color: textMuted }}
                        title={revealed[idx] ? "Verbergen" : "Anzeigen"}
                      >
                        {revealed[idx]
                          ? <EyeOff className="h-3.5 w-3.5" />
                          : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button onClick={() => handleStartEdit(idx)} className="p-1 rounded hover:bg-zinc-500/10" style={{ color: textMuted }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleDelete(idx)} className="p-1 rounded hover:bg-red-500/10 text-red-400">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
