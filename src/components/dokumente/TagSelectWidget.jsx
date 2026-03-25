import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, Search } from "lucide-react";

/**
 * Hierarchisches Tag-Select-Widget fuer die Dokumentenablage.
 * Dropdown wird via Portal gerendert → funktioniert korrekt in Modals.
 * Props:
 *   value    : UUID[]  – gewaehlte Tag-IDs
 *   onChange : fn(UUID[])
 *   allTags  : array   – alle dok_tags Eintraege {id, name, color, parent_id, sort_order}
 *   s        : theme-styles object
 *   border   : string (CSS color)
 *   accent   : string (CSS color)
 */
export default function TagSelectWidget({ value = [], onChange, onCategoryChange, allTags = [], s = {}, border = "#ccc", accent = "#6366f1" }) {
  const [open,      setOpen]      = useState(false);
  const [search,    setSearch]    = useState("");
  const [highlight, setHighlight] = useState(0);
  const [dropPos,   setDropPos]   = useState({ top: 0, left: 0, width: 0 });

  const triggerRef = useRef();
  const inputRef   = useRef();
  const listRef    = useRef();

  // Dropdown-Position berechnen (immer oberhalb wenn zu wenig Platz unten)
  const calcPos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect    = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropH   = 280; // max Höhe Dropdown
    const top     = spaceBelow >= dropH ? rect.bottom + 4 : rect.top - dropH - 4;
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
    const onScroll = () => { calcPos(); };
    document.addEventListener("mousedown", onClose);
    window.addEventListener("scroll",     onScroll, true);
    window.addEventListener("resize",     calcPos);
    return () => {
      document.removeEventListener("mousedown", onClose);
      window.removeEventListener("scroll",      onScroll, true);
      window.removeEventListener("resize",      calcPos);
    };
  }, [open, calcPos]);

  const q            = search.trim().toLowerCase();
  const parents      = allTags.filter(t => !t.parent_id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const kidsOf       = (pid) => allTags.filter(t => t.parent_id === pid).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  const visibleParents = parents.filter(par => {
    if (!q) return true;
    if (par.name.toLowerCase().includes(q)) return true;
    return kidsOf(par.id).some(k => k.name.toLowerCase().includes(q));
  });

  const flatItems = visibleParents.flatMap(par => {
    const kids = kidsOf(par.id).filter(k => !q || k.name.toLowerCase().includes(q) || par.name.toLowerCase().includes(q));
    return [par, ...kids];
  });

  const toggle = (id) => {
    const isAdding = !value.includes(id);
    onChange(isAdding ? [...value, id] : value.filter(x => x !== id));
    if (isAdding && onCategoryChange) {
      const tag    = allTags.find(t => t.id === id);
      const parent = tag?.parent_id ? allTags.find(t => t.id === tag.parent_id) : tag;
      if (parent?.category) onCategoryChange(parent.category);
    }
  };
  const getTag = (id) => allTags.find(t => t.id === id);

  const triggerStyle = {
    background: s.inputBg || "#fff",
    border: "1px solid " + (open ? (accent || "#6366f1") : (s.inputBorder || border)),
    color: s.textMain || "#000",
    borderRadius: 6, padding: "5px 10px",
    cursor: "pointer", display: "flex", alignItems: "center",
    gap: 6, minHeight: 34, userSelect: "none", fontSize: 13, width: "100%",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  };

  // ── Dropdown via Portal ────────────────────────────────────────────────────
  const dropdown = open && createPortal(
    <div
      onMouseDown={e => e.stopPropagation()} // verhindert onClose
      style={{
        position: "fixed",
        top:   dropPos.top,
        left:  dropPos.left,
        width: dropPos.width,
        background: s.cardBg || "#fff",
        border: "1px solid " + (s.inputBorder || border),
        borderRadius: 8,
        zIndex: 999999,
        boxShadow: "0 8px 32px rgba(0,0,0,0.20)",
        overflow: "hidden",
      }}
    >
      {/* Suchfeld */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "8px 10px",
        borderBottom: "1px solid " + (s.inputBorder || border),
      }}>
        <Search size={12} style={{ color: s.textMuted || "#999", flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={search}
          onChange={e => { setSearch(e.target.value); setHighlight(0); }}
          onKeyDown={e => {
            if (e.key === "Escape") { setOpen(false); return; }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              const next = Math.min(highlight + 1, flatItems.length - 1);
              setHighlight(next);
              listRef.current?.querySelector(`[data-flatidx="${next}"]`)?.scrollIntoView({ block: "nearest" });
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              const next = Math.max(highlight - 1, 0);
              setHighlight(next);
              listRef.current?.querySelector(`[data-flatidx="${next}"]`)?.scrollIntoView({ block: "nearest" });
              return;
            }
            if (e.key === "Enter" && flatItems[highlight]) {
              e.preventDefault();
              toggle(flatItems[highlight].id);
              return;
            }
          }}
          placeholder="Tag suchen…"
          style={{
            flex: 1, border: "none", outline: "none", fontSize: 13,
            background: "transparent", color: s.textMain || "#000",
          }}
        />
        {search && (
          <button onClick={() => setSearch("")}
            style={{ background: "none", border: "none", cursor: "pointer",
              color: s.textMuted, fontSize: 16, padding: 0, lineHeight: 1 }}>
            &times;
          </button>
        )}
      </div>

      {/* Tag-Liste */}
      <div ref={listRef} style={{ maxHeight: 230, overflowY: "auto" }}>
        {visibleParents.length === 0 ? (
          <div style={{ padding: "12px 14px", fontSize: 12, color: s.textMuted }}>
            {allTags.length === 0
              ? "Keine Tags vorhanden – bitte in Einstellungen → Dateiablage anlegen."
              : "Keine Tags gefunden."}
          </div>
        ) : (() => {
          let flatIdx = 0;
          return visibleParents.map(par => {
            const kids   = kidsOf(par.id).filter(k => !q || k.name.toLowerCase().includes(q) || par.name.toLowerCase().includes(q));
            const parSel = value.includes(par.id);
            const parCol = par.color || accent;
            const parIdx = flatIdx++;
            return (
              <div key={par.id}>
                {/* Parent-Tag */}
                <div
                  data-flatidx={parIdx}
                  onClick={() => { toggle(par.id); setHighlight(parIdx); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600,
                    background: highlight === parIdx ? parCol + "33" : parSel ? parCol + "22" : "transparent",
                    borderBottom: "1px solid " + (s.border || border) + "44",
                    color: parSel ? parCol : (s.textMain || "#000"),
                    outline: highlight === parIdx ? "2px solid " + parCol + "66" : "none",
                    outlineOffset: -2,
                  }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: parCol, flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{par.name}</span>
                  {kids.length > 0 && <span style={{ fontSize: 10, color: s.textMuted, opacity: 0.5 }}>{kids.length}</span>}
                  {parSel && <Check size={11} style={{ color: parCol, flexShrink: 0 }} />}
                </div>
                {/* Sub-Tags */}
                {kids.map(kid => {
                  const kidSel = value.includes(kid.id);
                  const kidIdx = flatIdx++;
                  return (
                    <div
                      key={kid.id}
                      data-flatidx={kidIdx}
                      onClick={() => { toggle(kid.id); setHighlight(kidIdx); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "6px 12px 6px 30px", cursor: "pointer", fontSize: 12,
                        background: highlight === kidIdx ? parCol + "28" : kidSel ? parCol + "14" : "transparent",
                        color: kidSel ? parCol : (s.textMuted || "#666"),
                        outline: highlight === kidIdx ? "2px solid " + parCol + "55" : "none",
                        outlineOffset: -2,
                      }}
                    >
                      <span style={{ fontSize: 10, opacity: 0.4, flexShrink: 0 }}>–</span>
                      <span style={{ flex: 1 }}>{kid.name}</span>
                      {kidSel && <Check size={11} style={{ color: parCol, flexShrink: 0 }} />}
                    </div>
                  );
                })}
              </div>
            );
          });
        })()}
      </div>

      {/* Footer: Anzahl gewählt + Schliessen */}
      {value.length > 0 && (
        <div style={{
          borderTop: "1px solid " + (s.inputBorder || border),
          padding: "6px 12px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontSize: 11, color: s.textMuted,
        }}>
          <span>{value.length} Tag{value.length > 1 ? "s"  : ""} gewählt</span>
          <button
            onClick={() => setOpen(false)}
            style={{ background: "none", border: "none", cursor: "pointer",
              fontSize: 12, color: accent, fontWeight: 600, padding: 0 }}
          >
            Fertig
          </button>
        </div>
      )}
    </div>,
    document.body
  );

  return (
    <div ref={triggerRef} style={{ position: "relative" }}>
      {/* Trigger-Button */}
      <div onClick={() => setOpen(o => !o)} style={triggerStyle}>
        <span style={{ flex: 1, color: value.length === 0 ? (s.textMuted || "#999") : (s.textMain || "#000") }}>
          {value.length === 0 ? "Tags auswählen…" : `${value.length} Tag${value.length > 1 ? "s" : ""} ausgewählt`}
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
