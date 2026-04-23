import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, Search, Plus, Minus } from "lucide-react";

/** Hex-Farbe → Farbton in Grad (0–360) für Rainbow-Sortierung */
function hexToHue(hex) {
  if (!hex || hex.length < 7) return 999;
  const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
  if (d === 0) return 0;
  let h = max === r ? (g-b)/d+(g<b?6:0) : max === g ? (b-r)/d+2 : (r-g)/d+4;
  return h * 60;
}

/**
 * Hierarchisches Tag-Select-Widget with Collapsible Parents.
 */
export default function TagSelectWidget({ value = [], onChange, onCategoryChange, allTags = [], s = {}, border = "#ccc", accent = "#6366f1" }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });

  // Track which parent IDs are expanded – "Abschlussunterlagen" standardmässig offen
  const [expandedParents, setExpandedParents] = useState(() => {
    const abschluss = allTags.find(t => !t.parent_id && t.name.toLowerCase().includes("abschluss"));
    return abschluss ? new Set([abschluss.id]) : new Set();
  });

  const triggerRef = useRef();
  const inputRef = useRef();
  const listRef = useRef();

  const calcPos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropH = 280;
    const top = spaceBelow >= dropH ? rect.bottom + 4 : rect.top - dropH - 4;
    setDropPos({ top, left: rect.left, width: rect.width });
  }, []);

  useEffect(() => {
    if (!open) { setSearch(""); setHighlight(0); return; }
    calcPos();
    setTimeout(() => inputRef.current?.focus(), 50);

    const onClose = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onClose);
    return () => document.removeEventListener("mousedown", onClose);
  }, [open, calcPos]);

  const q = search.trim().toLowerCase();
  const parents = allTags.filter(t => !t.parent_id).sort((a, b) => {
    // "Abschlussunterlagen" immer zuerst, dann nach Farbton
    const aIsAb = a.name.toLowerCase().includes("abschluss");
    const bIsAb = b.name.toLowerCase().includes("abschluss");
    if (aIsAb && !bIsAb) return -1;
    if (!aIsAb && bIsAb) return 1;
    return hexToHue(a.color) - hexToHue(b.color);
  });
  const kidsOf = (pid) => allTags.filter(t => t.parent_id === pid).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  // Auto-expand parents if searching
  useEffect(() => {
    if (q) {
      const autoExpand = new Set();
      parents.forEach(p => {
        if (kidsOf(p.id).some(k => k.name.toLowerCase().includes(q))) {
          autoExpand.add(p.id);
        }
      });
      setExpandedParents(prev => new Set([...prev, ...autoExpand]));
    }
  }, [q]);

  const toggleExpand = (e, id) => {
    e.stopPropagation();
    const next = new Set(expandedParents);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedParents(next);
  };

  const visibleParents = parents.filter(par => {
    if (!q) return true;
    if (par.name.toLowerCase().includes(q)) return true;
    return kidsOf(par.id).some(k => k.name.toLowerCase().includes(q));
  });

  // Flat list for keyboard navigation logic
  const flatItems = visibleParents.flatMap(par => {
    const kids = kidsOf(par.id).filter(k => !q || k.name.toLowerCase().includes(q) || par.name.toLowerCase().includes(q));
    const isExpanded = expandedParents.has(par.id) || q;
    return isExpanded ? [par, ...kids] : [par];
  });

  const toggle = (id, closeAfter = false) => {
    const isAdding = !value.includes(id);
    onChange(isAdding ? [...value, id] : value.filter(x => x !== id));
    if (isAdding && onCategoryChange) {
      const tag = allTags.find(t => t.id === id);
      const parent = tag?.parent_id ? allTags.find(t => t.id === tag.parent_id) : tag;
      if (parent?.category) onCategoryChange(parent.category);
    }
    if (closeAfter) setOpen(false);
  };

  // Highlighted item ins Sichtfeld scrollen
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-flatidx="${highlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const getTag = (id) => allTags.find(t => t.id === id);

  const dropdown = open && createPortal(
      <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: "fixed", top: dropPos.top, left: dropPos.left, width: dropPos.width,
            background: s.cardBg || "#fff", border: "1px solid " + (s.inputBorder || border),
            borderRadius: 8, zIndex: 999999, boxShadow: "0 8px 32px rgba(0,0,0,0.20)", overflow: "hidden",
          }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderBottom: "1px solid " + (s.inputBorder || border) }}>
          <Search size={12} style={{ color: s.textMuted || "#999" }} />
          <input
              ref={inputRef}
              value={search}
              onChange={e => { setSearch(e.target.value); setHighlight(0); }}
              placeholder="Tag suchen..."
              style={{ flex: 1, border: "none", outline: "none", fontSize: 13, background: "transparent", color: s.textMain || "#000" }}
              onKeyDown={e => {
                if (e.key === "ArrowDown") { e.preventDefault(); setHighlight(h => Math.min(h + 1, flatItems.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
                else if (e.key === "Enter") { e.preventDefault(); if (flatItems[highlight]) toggle(flatItems[highlight].id, true); }
                else if (e.key === "Escape") { setOpen(false); }
              }}
          />
        </div>

        <div ref={listRef} tabIndex={-1} style={{ maxHeight: 230, overflowY: "auto", outline: "none" }} onMouseEnter={() => listRef.current?.focus()} onWheel={e => e.stopPropagation()}>
          {visibleParents.length === 0 ? (
              <div style={{ padding: "12px 14px", fontSize: 12, color: s.textMuted }}>Keine Tags gefunden.</div>
          ) : (() => {
            let flatIdx = 0;
            return visibleParents.map(par => {
              const kids = kidsOf(par.id).filter(k => !q || k.name.toLowerCase().includes(q) || par.name.toLowerCase().includes(q));
              const hasKids = kids.length > 0;
              const isExpanded = expandedParents.has(par.id) || q;
              const parSel = value.includes(par.id);
              const parCol = par.color || accent;
              const parIdx = flatIdx++;

              return (
                  <div key={par.id}>
                    <div
                        data-flatidx={parIdx}
                        onClick={() => { toggle(par.id, true); setHighlight(parIdx); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer", fontSize: 13,
                          background: highlight === parIdx ? parCol + "33" : "transparent",
                          borderBottom: "1px solid " + (s.border || border) + "22",
                          color: parSel ? parCol : (s.textMain || "#000"),
                          fontWeight: 600
                        }}
                    >
                      {/* Expand/Collapse Toggle */}
                      {hasKids ? (
                          <div onClick={(e) => toggleExpand(e, par.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: 4, background: s.inputBg || '#eee' }}>
                            {isExpanded ? <Minus size={10} /> : <Plus size={10} />}
                          </div>
                      ) : <div style={{ width: 16 }} />}

                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: parCol }} />
                      <span style={{ flex: 1 }}>{par.name}</span>
                      {parSel && <Check size={11} />}
                    </div>

                    {/* Sub-Tags (Conditional Rendering) */}
                    {isExpanded && kids.map(kid => {
                      const kidSel = value.includes(kid.id);
                      const kidIdx = flatIdx++;
                      return (
                          <div
                              key={kid.id}
                              data-flatidx={kidIdx}
                              onClick={() => { toggle(kid.id, true); setHighlight(kidIdx); }}
                              style={{
                                display: "flex", alignItems: "center", gap: 8, padding: "6px 12px 6px 44px",
                                cursor: "pointer", fontSize: 12,
                                background: highlight === kidIdx ? parCol + "28" : "transparent",
                                color: kidSel ? parCol : (s.textMuted || "#666"),
                              }}
                          >
                            <span style={{ flex: 1 }}>{kid.name}</span>
                            {kidSel && <Check size={11} />}
                          </div>
                      );
                    })}
                  </div>
              );
            });
          })()}
        </div>
      </div>,
      document.body
  );

  return (
      <div ref={triggerRef} style={{ position: "relative" }}>
        <div
        onClick={() => setOpen(o => !o)}
        tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); } if (e.key === "Escape") setOpen(false); }}
        style={{
          background: s.inputBg || "#fff", border: "1px solid " + (open ? accent : (s.inputBorder || border)),
          borderRadius: 6, padding: "5px 10px", cursor: "pointer", display: "flex", alignItems: "center",
          gap: 6, minHeight: 34, fontSize: 13, width: "100%", boxSizing: "border-box"
        }}>
        <span style={{ flex: 1, color: value.length === 0 ? (s.textMuted || "#999") : (s.textMain || "#000") }}>
          {value.length === 0 ? "Tags auswählen…" : `${value.length} Tag(s) gewählt`}
        </span>
        <ChevronDown size={13} style={{
          color: s.textMuted || "#999", flexShrink: 0,
          transition: "transform 0.15s", transform: open ? "rotate(180deg)" : "none",
        }} />
      </div>

      {dropdown}

      {/* Gewählte Tags als Chips */}
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
                <button
                  onClick={e => { e.stopPropagation(); toggle(id); }}
                  style={{ background: "none", border: "none", cursor: "pointer",
                    color: "inherit", padding: 0, lineHeight: 1, fontSize: 14 }}
                >
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