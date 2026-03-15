import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

/**
 * Hierarchisches Tag-Select-Widget fuer die Dokumentenablage.
 * Props:
 *   value    : UUID[]  – gewaehlte Tag-IDs
 *   onChange : fn(UUID[])
 *   allTags  : array   – alle dok_tags Eintraege {id, name, color, parent_id, sort_order}
 *   s        : theme-styles object
 *   border   : string (CSS color)
 *   accent   : string (CSS color)
 */
export default function TagSelectWidget({ value = [], onChange, onCategoryChange, allTags = [], s = {}, border = "#ccc", accent = "#6366f1" }) {
  const [open, setOpen] = useState(false);
  const ref  = useRef();

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const parents    = allTags.filter(t => !t.parent_id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const kidsOf     = (pid) => allTags.filter(t => t.parent_id === pid).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const toggle     = (id)  => {
    const isAdding = !value.includes(id);
    onChange(isAdding ? [...value, id] : value.filter(x => x !== id));
    if (isAdding && onCategoryChange) {
      const tag    = allTags.find(t => t.id === id);
      const parent = tag?.parent_id ? allTags.find(t => t.id === tag.parent_id) : tag;
      if (parent?.category) onCategoryChange(parent.category);
    }
  };
  const getTag     = (id)  => allTags.find(t => t.id === id);

  const triggerStyle = {
    background: s.inputBg || "#fff",
    border: "1px solid " + (s.inputBorder || border),
    color: s.textMain || "#000",
    borderRadius: 6, padding: "5px 10px",
    cursor: "pointer", display: "flex", alignItems: "center",
    gap: 6, minHeight: 34, userSelect: "none", fontSize: 13, width: "100%",
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Trigger */}
      <div onClick={() => setOpen(!open)} style={triggerStyle}>
        <span style={{ flex: 1, color: value.length === 0 ? (s.textMuted || "#999") : (s.textMain || "#000") }}>
          {value.length === 0 ? "Tags auswaehlen\u2026" : `${value.length} Tag${value.length > 1 ? "s" : ""} ausgewaehlt`}
        </span>
        <ChevronDown size={13} style={{ color: s.textMuted || "#999", flexShrink: 0,
          transition: "transform 0.15s", transform: open ? "rotate(180deg)" : "none" }} />
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: s.cardBg || "#fff",
          border: "1px solid " + (s.inputBorder || border),
          borderRadius: 8, zIndex: 99999,
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          maxHeight: 260, overflowY: "auto",
        }}>
          {parents.length === 0 ? (
            <div style={{ padding: "12px 14px", fontSize: 12, color: s.textMuted }}>
              Keine Tags vorhanden. Bitte in Einstellungen &rarr; Dateiablage anlegen.
            </div>
          ) : parents.map(par => {
            const kids   = kidsOf(par.id);
            const parSel = value.includes(par.id);
            const parCol = par.color || accent;
            return (
              <div key={par.id}>
                {/* Parent */}
                <div onClick={() => toggle(par.id)} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600,
                  background: parSel ? parCol + "22" : "transparent",
                  borderBottom: "1px solid " + (s.border || border) + "55",
                  color: parSel ? parCol : (s.textMain || "#000"),
                }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: parCol, flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{par.name}</span>
                  {kids.length > 0 && <span style={{ fontSize: 10, color: s.textMuted, opacity: 0.6 }}>{kids.length}</span>}
                  {parSel && <Check size={11} style={{ color: parCol, flexShrink: 0 }} />}
                </div>
                {/* Subtags */}
                {kids.map(kid => {
                  const kidSel = value.includes(kid.id);
                  return (
                    <div key={kid.id} onClick={() => toggle(kid.id)} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "5px 12px 5px 30px", cursor: "pointer", fontSize: 12,
                      background: kidSel ? parCol + "14" : "transparent",
                      color: kidSel ? parCol : (s.textMuted || "#666"),
                    }}>
                      <span style={{ fontSize: 10, opacity: 0.5, flexShrink: 0 }}>&ndash;</span>
                      <span style={{ flex: 1 }}>{kid.name}</span>
                      {kidSel && <Check size={11} style={{ color: parCol, flexShrink: 0 }} />}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* Selected Chips */}
      {value.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
          {value.map(id => {
            const tag = getTag(id);
            if (!tag) return null;
            const par   = tag.parent_id ? getTag(tag.parent_id) : null;
            const label = par ? `${par.name} / ${tag.name}` : tag.name;
            const col   = par?.color || tag.color || accent;
            return (
              <span key={id} style={{
                background: col + "22", color: col,
                border: "1px solid " + col + "55",
                borderRadius: 10, padding: "2px 8px", fontSize: 11,
                display: "flex", alignItems: "center", gap: 4,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: col, flexShrink: 0 }} />
                {label}
                <button onClick={e => { e.stopPropagation(); toggle(id); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, lineHeight: 1, fontSize: 14 }}>
                  &times;
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
