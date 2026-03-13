import React, { useState, useContext } from "react";
import { Plus, Trash2, Pencil, Check, X, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeContext } from "@/Layout";
import { entities } from "@/api/supabaseClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const CATEGORIES = [
  { key: "rechnungswesen", label: "01 - Rechnungswesen", icon: "\u{1F4CA}" },
  { key: "steuern",        label: "02 - Steuern",        icon: "\u{1F4B0}" },
  { key: "mwst",           label: "03 - Mehrwertsteuer", icon: "\u{1F9FE}" },
  { key: "revision",       label: "04 - Revision",       icon: "\u{1F50D}" },
  { key: "rechtsberatung", label: "05 - Rechtsberatung", icon: "\u2696\uFE0F" },
  { key: "personal",       label: "06 - Personal",       icon: "\u{1F465}" },
  { key: "korrespondenz",  label: "09 - Korrespondenz",  icon: "\u2709\uFE0F" },
];

export default function DokAblageSettings() {
  const { theme } = useContext(ThemeContext);
  const isArtis   = theme === "artis";
  const isLight   = theme === "light";

  const cardBg      = isArtis ? "#fff" : isLight ? "#fff" : "#27272a";
  const cardBorder  = isArtis ? "#ccd8cc" : isLight ? "#d4d4e8" : "#3f3f46";
  const headingColor = isArtis ? "#2d3a2d" : isLight ? "#1a1a2e" : "#e4e4e7";
  const textMuted   = isArtis ? "#6b826b" : isLight ? "#7a7a9a" : "#71717a";
  const inputBg     = isArtis ? "#fff" : isLight ? "#fff" : "rgba(24,24,27,0.8)";
  const inputBorder = isArtis ? "#bfcfbf" : isLight ? "#c8c8dc" : "#3f3f46";
  const rowBg       = isArtis ? "#f5f8f5" : isLight ? "#f5f5fc" : "#1f1f23";
  const rowBorder   = isArtis ? "#e5ece5" : isLight ? "#e8e8f0" : "#2d2d35";
  const accent      = isArtis ? "#4a7a4f" : "#7c3aed";

  const inp = {
    background: inputBg, border: "1px solid " + inputBorder,
    color: headingColor, borderRadius: 6, padding: "5px 10px",
    fontSize: 13, outline: "none",
  };

  const queryClient = useQueryClient();
  const [expanded,      setExpanded]      = useState({});
  const [addingParent,  setAddingParent]  = useState(false);
  const [addingSubOf,   setAddingSubOf]   = useState(null);
  const [editingId,     setEditingId]     = useState(null);
  const [newParentName, setNewParentName] = useState("");
  const [newParentColor,setNewParentColor]= useState("#6366f1");
  const [newSubName,    setNewSubName]    = useState("");
  const [editName,      setEditName]      = useState("");
  const [editColor,     setEditColor]     = useState("");

  const { data: allTags = [], isLoading } = useQuery({
    queryKey: ["dok_tags"],
    queryFn:  () => entities.DokTag.list("sort_order"),
  });

  const createMut = useMutation({
    mutationFn: (d) => entities.DokTag.create(d),
    onSuccess:  () => { queryClient.invalidateQueries({ queryKey: ["dok_tags"] }); toast.success("Tag erstellt"); },
    onError:    (e) => toast.error("Fehler: " + e.message),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...d }) => entities.DokTag.update(id, d),
    onSuccess:  () => { queryClient.invalidateQueries({ queryKey: ["dok_tags"] }); setEditingId(null); toast.success("Gespeichert"); },
    onError:    (e) => toast.error("Fehler: " + e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id) => entities.DokTag.delete(id),
    onSuccess:  () => { queryClient.invalidateQueries({ queryKey: ["dok_tags"] }); toast.success("Geloescht"); },
    onError:    (e) => toast.error("Fehler: " + e.message),
  });

  const parents = allTags.filter(t => !t.parent_id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const kidsOf  = (pid) => allTags.filter(t => t.parent_id === pid).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  const handleAddParent = () => {
    if (!newParentName.trim()) return;
    createMut.mutate({ name: newParentName.trim(), color: newParentColor, sort_order: parents.length });
    setNewParentName(""); setNewParentColor("#6366f1"); setAddingParent(false);
  };
  const handleAddSub = (pid) => {
    if (!newSubName.trim()) return;
    createMut.mutate({ name: newSubName.trim(), parent_id: pid, sort_order: kidsOf(pid).length });
    setNewSubName(""); setAddingSubOf(null);
  };
  const startEdit = (tag) => { setEditingId(tag.id); setEditName(tag.name); setEditColor(tag.color || "#6366f1"); };
  const doDelete  = (tag) => {
    const k = kidsOf(tag.id);
    if (!window.confirm(k.length > 0
      ? `"${tag.name}" und ${k.length} Subtag(s) wirklich loeschen?`
      : `"${tag.name}" wirklich loeschen?`)) return;
    deleteMut.mutate(tag.id);
  };

  const btnStyle = { background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", padding: 4 };

  return (
    <div className="space-y-6">

      {/* ── Tag-Manager ─────────────────────────────────────────────────── */}
      <div className="rounded-xl p-6 border" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <h3 className="text-lg font-semibold" style={{ color: headingColor }}>Dokument-Tags</h3>
            <p className="text-sm mt-1" style={{ color: textMuted }}>
              Hierarchisch strukturierbar: Haupt-Tag &rarr; Subtags (z.B. &ldquo;Abschlussunterlagen&rdquo; &rarr; &ldquo;Debitoren&rdquo;).
            </p>
          </div>
          <Button onClick={() => { setAddingParent(true); setNewParentName(""); }}
            style={{ background: accent, color: "#fff", fontSize: 12, height: 34, display: "flex", alignItems: "center", gap: 5 }}>
            <Plus size={14} /> Neuer Tag
          </Button>
        </div>

        {isLoading && <p style={{ color: textMuted, fontSize: 13 }}>Laedt...</p>}

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {parents.map(par => {
            const kids   = kidsOf(par.id);
            const isExp  = expanded[par.id];
            const isEdit = editingId === par.id;
            const parCol = par.color || accent;
            return (
              <div key={par.id} style={{ border: "1px solid " + rowBorder, borderRadius: 8, overflow: "hidden" }}>

                {/* Parent-Zeile */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: rowBg }}>
                  <button {...btnStyle} onClick={() => setExpanded(p => ({ ...p, [par.id]: !p[par.id] }))}>
                    {kids.length > 0
                      ? (isExp ? <ChevronDown size={14} style={{ color: textMuted }} />
                               : <ChevronRight size={14} style={{ color: textMuted }} />)
                      : <span style={{ width: 14 }} />}
                  </button>

                  {isEdit ? (
                    <>
                      <input type="color" value={editColor} onChange={e => setEditColor(e.target.value)}
                        style={{ width: 28, height: 28, border: "none", borderRadius: 4, cursor: "pointer", padding: 2, flexShrink: 0 }} />
                      <input value={editName} onChange={e => setEditName(e.target.value)}
                        autoFocus style={{ ...inp, flex: 1 }}
                        onKeyDown={e => { if (e.key === "Enter") updateMut.mutate({ id: par.id, name: editName.trim(), color: editColor }); if (e.key === "Escape") setEditingId(null); }} />
                      <button {...btnStyle} onClick={() => updateMut.mutate({ id: par.id, name: editName.trim(), color: editColor })} style={{ ...btnStyle, color: accent }}><Check size={14} /></button>
                      <button {...btnStyle} onClick={() => setEditingId(null)} style={{ ...btnStyle, color: textMuted }}><X size={14} /></button>
                    </>
                  ) : (
                    <>
                      <span style={{ width: 12, height: 12, borderRadius: "50%", background: parCol, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: headingColor }}>{par.name}</span>
                      {kids.length > 0 && <span style={{ fontSize: 11, color: textMuted, background: cardBorder + "88", borderRadius: 8, padding: "1px 6px" }}>{kids.length}</span>}
                      <button {...btnStyle} title="Subtag hinzufuegen"
                        onClick={() => { setAddingSubOf(par.id); setNewSubName(""); setExpanded(p => ({ ...p, [par.id]: true })); }}
                        style={{ ...btnStyle, color: textMuted, fontSize: 11, gap: 2 }}>
                        <Plus size={12} /><span>Sub</span>
                      </button>
                      <button {...btnStyle} onClick={() => startEdit(par)} style={{ ...btnStyle, color: textMuted }}><Pencil size={13} /></button>
                      <button {...btnStyle} onClick={() => doDelete(par)} style={{ ...btnStyle, color: "#ef4444" }}><Trash2 size={13} /></button>
                    </>
                  )}
                </div>

                {/* Subtags + Inline-Add */}
                {(isExp || addingSubOf === par.id) && (
                  <div style={{ borderTop: "1px solid " + rowBorder }}>
                    {kids.map(kid => {
                      const isEditKid = editingId === kid.id;
                      return (
                        <div key={kid.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px 6px 40px", borderBottom: "1px solid " + rowBorder + "55" }}>
                          {isEditKid ? (
                            <>
                              <input value={editName} onChange={e => setEditName(e.target.value)}
                                autoFocus style={{ ...inp, flex: 1 }}
                                onKeyDown={e => { if (e.key === "Enter") updateMut.mutate({ id: kid.id, name: editName.trim() }); if (e.key === "Escape") setEditingId(null); }} />
                              <button {...btnStyle} onClick={() => updateMut.mutate({ id: kid.id, name: editName.trim() })} style={{ ...btnStyle, color: accent }}><Check size={13} /></button>
                              <button {...btnStyle} onClick={() => setEditingId(null)} style={{ ...btnStyle, color: textMuted }}><X size={13} /></button>
                            </>
                          ) : (
                            <>
                              <span style={{ fontSize: 10, color: textMuted, flexShrink: 0 }}>&#x2514;</span>
                              <span style={{ flex: 1, fontSize: 12, color: headingColor }}>{kid.name}</span>
                              <button {...btnStyle} onClick={() => startEdit(kid)} style={{ ...btnStyle, color: textMuted }}><Pencil size={12} /></button>
                              <button {...btnStyle} onClick={() => doDelete(kid)} style={{ ...btnStyle, color: "#ef4444" }}><Trash2 size={12} /></button>
                            </>
                          )}
                        </div>
                      );
                    })}

                    {/* Subtag hinzufuegen */}
                    {addingSubOf === par.id && (
                      <div style={{ display: "flex", gap: 6, padding: "6px 12px 6px 40px", alignItems: "center" }}>
                        <input value={newSubName} onChange={e => setNewSubName(e.target.value)}
                          autoFocus placeholder="Subtag-Name..." style={{ ...inp, flex: 1 }}
                          onKeyDown={e => { if (e.key === "Enter") handleAddSub(par.id); if (e.key === "Escape") setAddingSubOf(null); }} />
                        <button onClick={() => handleAddSub(par.id)}
                          style={{ background: accent, border: "none", cursor: "pointer", color: "#fff", padding: "4px 12px", borderRadius: 5, fontSize: 12, fontWeight: 600 }}>+</button>
                        <button onClick={() => setAddingSubOf(null)} {...btnStyle} style={{ ...btnStyle, color: textMuted }}><X size={13} /></button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Neuen Parent-Tag hinzufuegen */}
          {addingParent && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", border: "1px dashed " + accent, borderRadius: 8 }}>
              <input type="color" value={newParentColor} onChange={e => setNewParentColor(e.target.value)}
                style={{ width: 28, height: 28, border: "none", borderRadius: 4, cursor: "pointer", padding: 2, flexShrink: 0 }} />
              <input value={newParentName} onChange={e => setNewParentName(e.target.value)}
                autoFocus placeholder="Tag-Name (z.B. Abschlussunterlagen)..."
                style={{ ...inp, flex: 1 }}
                onKeyDown={e => { if (e.key === "Enter") handleAddParent(); if (e.key === "Escape") setAddingParent(false); }} />
              <button onClick={handleAddParent} disabled={!newParentName.trim()}
                style={{ background: accent, border: "none", cursor: "pointer", color: "#fff", padding: "5px 14px", borderRadius: 5, fontSize: 12, fontWeight: 600, opacity: newParentName.trim() ? 1 : 0.5 }}>
                Erstellen
              </button>
              <button onClick={() => setAddingParent(false)} {...btnStyle} style={{ ...btnStyle, color: textMuted }}><X size={14} /></button>
            </div>
          )}

          {!addingParent && parents.length === 0 && !isLoading && (
            <p style={{ color: textMuted, fontSize: 13, textAlign: "center", padding: "20px 0" }}>
              Noch keine Tags. Klicke auf &ldquo;Neuer Tag&rdquo; um den ersten anzulegen.
            </p>
          )}
        </div>
      </div>

      {/* ── Kategorien (read-only) ──────────────────────────────────────── */}
      <div className="rounded-xl p-6 border" style={{ backgroundColor: cardBg, borderColor: cardBorder }}>
        <h3 className="text-lg font-semibold mb-1" style={{ color: headingColor }}>Kategorien</h3>
        <p className="text-sm mb-4" style={{ color: textMuted }}>Fest definiert, nicht aenderbar.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {CATEGORIES.map(c => (
            <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: rowBg, borderRadius: 7, border: "1px solid " + rowBorder }}>
              <span style={{ fontSize: 15 }}>{c.icon}</span>
              <span style={{ fontSize: 13, color: headingColor }}>{c.label}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
