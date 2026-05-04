import React, { useState, useEffect, useMemo, useContext, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { ThemeContext } from "@/Layout";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { toast } from "sonner";
import {
  CalendarRange, Plus, X, Trash2, Search,
  ChevronDown, ChevronRight, Building2, RefreshCw
} from "lucide-react";

const MONTHS      = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
const MONTHS_LONG = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

// ── Drag portal (fixes ghost-position bug in scroll containers) ───────────────
const _dragPortalEl = typeof document !== "undefined"
  ? (() => { const d = document.createElement("div"); document.body.appendChild(d); return d; })()
  : null;
function applyDragPortal(snap, child) {
  if ((snap.isDragging || snap.isDropAnimating) && _dragPortalEl) return createPortal(child, _dragPortalEl);
  return child;
}

// ── Activity chip colors ──────────────────────────────────────────────────────
const CHIP_COLORS = [
  { color: "#2563eb", bg: "#dbeafe" },
  { color: "#7c3aed", bg: "#ede9fe" },
  { color: "#b45309", bg: "#fef3c7" },
  { color: "#059669", bg: "#d1fae5" },
  { color: "#dc2626", bg: "#fee2e2" },
  { color: "#0891b2", bg: "#cffafe" },
  { color: "#9333ea", bg: "#f3e8ff" },
  { color: "#16a34a", bg: "#dcfce7" },
];
function getTitleColor(title) {
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CHIP_COLORS[h % CHIP_COLORS.length];
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function toLocalDateStr(d) {
  if (!d) return "";
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2,"0")}.${String(dt.getMonth()+1).padStart(2,"0")}.${dt.getFullYear()}`;
}
function toInputDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
}

// ── Kunden-Selector ───────────────────────────────────────────────────────────
function KundenSelector({ customers, selectedId, onSelect, colors }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);
  const { cardBg, border, text, subtle, accent, pageBg } = colors;
  const filtered = useMemo(() => {
    if (!search) return customers;
    const q = search.toLowerCase();
    return customers.filter(c => (c.company_name || "").toLowerCase().includes(q));
  }, [customers, search]);
  const selected = customers.find(c => c.id === selectedId);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} style={{ position: "relative", minWidth: 220 }}>
      <button onClick={() => setOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", border: `1px solid ${border}`, borderRadius: 7, background: cardBg, color: text, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap", minWidth: 220 }}>
        <Building2 size={13} style={{ color: accent, flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis" }}>
          {selected ? selected.company_name : <span style={{ color: subtle }}>Kunde wählen…</span>}
        </span>
        <ChevronDown size={12} style={{ color: subtle, flexShrink: 0 }} />
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 100, background: cardBg, border: `1px solid ${border}`, borderRadius: 9, boxShadow: "0 8px 24px rgba(0,0,0,0.13)", minWidth: 260, maxHeight: 320, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "7px 8px", borderBottom: `1px solid ${border}` }}>
            <div style={{ position: "relative" }}>
              <Search size={11} style={{ position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", color: subtle }} />
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Suchen…" style={{ width: "100%", paddingLeft: 24, paddingRight: 8, paddingTop: 4, paddingBottom: 4, border: `1px solid ${border}`, borderRadius: 5, fontSize: 12, background: pageBg, color: text, outline: "none" }} />
            </div>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.map(c => (
              <button key={c.id} onClick={() => { onSelect(c.id); setOpen(false); setSearch(""); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 12px", border: "none", cursor: "pointer", background: c.id === selectedId ? (colors.isArtis ? "#e6ede6" : "#ede9fe") : "transparent", color: c.id === selectedId ? (colors.isArtis ? "#2d4a2d" : "#4c1d95") : text, fontSize: 12, fontWeight: c.id === selectedId ? 600 : 400 }}>
                {c.company_name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Plan-Tabs ─────────────────────────────────────────────────────────────────
function PlanTabs({ plans, selectedPlanId, onSelect, onAdd, onRename, onDelete, colors }) {
  const { border, text, subtle, accent, pageBg } = colors;
  const [renamingId, setRenamingId] = useState(null);
  const [renameVal, setRenameVal] = useState("");
  const startRename = (plan) => { setRenamingId(plan.id); setRenameVal(plan.name); };
  const commitRename = async () => { if (renameVal.trim()) await onRename(renamingId, renameVal.trim()); setRenamingId(null); };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      {plans.map(plan => (
        <div key={plan.id} style={{ display: "flex", alignItems: "center", gap: 3, background: plan.id === selectedPlanId ? (colors.isArtis ? "#e6ede6" : "#ede9fe") : pageBg, border: `1px solid ${plan.id === selectedPlanId ? accent : border}`, borderRadius: 7, overflow: "hidden" }}>
          {renamingId === plan.id
            ? <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)} onBlur={commitRename} onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingId(null); }} style={{ border: "none", outline: "none", background: "transparent", fontSize: 12, padding: "4px 8px", color: text, minWidth: 120 }} />
            : <button onClick={() => onSelect(plan.id)} onDoubleClick={() => startRename(plan)} title="Klick = wählen, Doppelklick = umbenennen" style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 12, padding: "4px 8px", color: plan.id === selectedPlanId ? accent : text, fontWeight: plan.id === selectedPlanId ? 700 : 400 }}>{plan.name}</button>
          }
          {plan.id === selectedPlanId && <button onClick={() => onDelete(plan.id)} style={{ border: "none", background: "transparent", cursor: "pointer", padding: "0 5px 0 0", color: subtle }}><X size={10} /></button>}
        </div>
      ))}
      <button onClick={onAdd} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", border: `1px dashed ${border}`, borderRadius: 7, background: "transparent", color: subtle, fontSize: 12, cursor: "pointer" }}>
        <Plus size={11} /> Plan
      </button>
    </div>
  );
}

// ── Jahreswechsel-Dialog ──────────────────────────────────────────────────────
function YearChangeDialog({ fromYear, toYear, onConfirm, onCancel, colors }) {
  const { cardBg, border, text, subtle, accent } = colors;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: cardBg, border: `1px solid ${border}`, borderRadius: 12, padding: "28px 32px", maxWidth: 420, width: "90%", boxShadow: "0 16px 40px rgba(0,0,0,0.18)" }}>
        <h3 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 700, color: text }}>Jahr {toYear} hinzufügen</h3>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: subtle, lineHeight: 1.5 }}>
          Sollen alle Einträge von <strong style={{ color: text }}>{fromYear}</strong> ins Jahr <strong style={{ color: text }}>{toYear}</strong> übertragen werden?
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "7px 18px", border: `1px solid ${border}`, borderRadius: 7, background: "transparent", color: text, fontSize: 13, cursor: "pointer" }}>Nein</button>
          <button onClick={onConfirm} style={{ padding: "7px 18px", border: "none", borderRadius: 7, background: accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Ja, übertragen</button>
        </div>
      </div>
    </div>
  );
}

// ── SimpleInputModal ──────────────────────────────────────────────────────────
function SimpleInputModal({ title, placeholder, defaultValue = "", onConfirm, onClose, colors }) {
  const { cardBg, border, text, subtle, accent, pageBg } = colors;
  const [value, setValue] = useState(defaultValue);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const confirm = () => { if (value.trim()) { onConfirm(value.trim()); onClose(); } };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: cardBg, border: `1px solid ${border}`, borderRadius: 12, padding: "24px 28px", width: 380, maxWidth: "94vw", boxShadow: "0 16px 40px rgba(0,0,0,0.18)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: text }}>{title}</span>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: subtle }}><X size={15} /></button>
        </div>
        <input ref={ref} value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") confirm(); if (e.key === "Escape") onClose(); }} placeholder={placeholder} style={{ width: "100%", padding: "8px 10px", border: `1px solid ${border}`, borderRadius: 7, fontSize: 13, background: pageBg, color: text, outline: "none", boxSizing: "border-box", marginBottom: 16 }} />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "7px 16px", border: `1px solid ${border}`, borderRadius: 7, background: "transparent", color: text, fontSize: 13, cursor: "pointer" }}>Abbrechen</button>
          <button onClick={confirm} disabled={!value.trim()} style={{ padding: "7px 18px", border: "none", borderRadius: 7, background: accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: value.trim() ? 1 : 0.5 }}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ── ConfirmModal ──────────────────────────────────────────────────────────────
function ConfirmModal({ message, onConfirm, onClose, colors }) {
  const { cardBg, border, text } = colors;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 220, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: cardBg, border: `1px solid ${border}`, borderRadius: 12, padding: "24px 28px", width: 380, maxWidth: "94vw", boxShadow: "0 16px 40px rgba(0,0,0,0.18)" }}>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: text, lineHeight: 1.5 }}>{message}</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "7px 16px", border: `1px solid ${border}`, borderRadius: 7, background: "transparent", color: text, fontSize: 13, cursor: "pointer" }}>Abbrechen</button>
          <button onClick={() => { onConfirm(); onClose(); }} style={{ padding: "7px 18px", border: "none", borderRadius: 7, background: "#dc2626", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Löschen</button>
        </div>
      </div>
    </div>
  );
}

// ── EntryModal (Jahresplanung-Stil) ───────────────────────────────────────────
function EntryModal({ mode, entry, month, year, existingTitles, onSave, onDelete, onClose, colors }) {
  const { cardBg, border, text, subtle, accent, pageBg } = colors;
  const lbl = { fontSize: 10.5, fontWeight: 700, color: subtle, textTransform: "uppercase", letterSpacing: ".07em", display: "block", marginBottom: 4 };
  const inp = { width: "100%", padding: "7px 10px", fontSize: 12.5, borderRadius: 7, border: `1px solid ${border}`, backgroundColor: pageBg, color: text, outline: "none", boxSizing: "border-box" };

  const [title, setTitle] = useState(entry?.title || "");
  const [detail, setDetail] = useState(entry?.detail_text || "");
  const [datum, setDatum]   = useState(entry ? toInputDate(entry.datum) : "");
  const [done, setDone]     = useState(entry?.done || false);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  const handleSave = async () => {
    if (!title.trim()) { toast.error("Titel ist erforderlich"); return; }
    setSaving(true);
    await onSave({ title: title.trim(), detail_text: detail.trim() || null, datum: datum || null, done });
    setSaving(false);
  };

  const isEdit = mode === "edit";

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: 14, padding: 24, width: 440, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.25)" }}>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: text }}>
            {isEdit ? "Eintrag bearbeiten" : `Eintrag – ${MONTHS_LONG[month - 1]} ${year}`}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: subtle, padding: 2 }}><X size={16} /></button>
        </div>

        {/* Titel */}
        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>TITEL *</label>
          <input ref={titleRef} value={title} onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) handleSave(); }}
            placeholder="z.B. Jahresabschluss" list="mp-titles-list" style={inp} />
          <datalist id="mp-titles-list">
            {existingTitles.map(t => <option key={t} value={t} />)}
          </datalist>
        </div>

        {/* Detail */}
        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>DETAILS (optional)</label>
          <textarea value={detail} onChange={e => setDetail(e.target.value)} placeholder="Optionale Beschreibung…" rows={3}
            style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} />
        </div>

        {/* Datum */}
        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>DATUM (optional)</label>
          <input type="date" value={datum} onChange={e => setDatum(e.target.value)} style={{ ...inp, width: "auto" }} />
        </div>

        {/* Done */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={done} onChange={e => setDone(e.target.checked)}
              style={{ width: 14, height: 14, accentColor: "#22c55e" }} />
            <span style={{ fontSize: 12.5, color: text, fontWeight: 500 }}>Erledigt</span>
          </label>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", paddingTop: 16, borderTop: `1px solid ${border}` }}>
          <div>
            {isEdit && (
              <button onClick={() => onDelete(entry.id)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "7px 14px", border: "1px solid #fca5a5", borderRadius: 7, background: "transparent", color: "#dc2626", fontSize: 12, cursor: "pointer" }}>
                <Trash2 size={12} /> Löschen
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ padding: "7px 16px", border: `1px solid ${border}`, borderRadius: 7, background: "transparent", color: text, fontSize: 13, cursor: "pointer" }}>Abbrechen</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: "7px 18px", border: "none", borderRadius: 7, background: accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: saving ? 0.7 : 1 }}>
              {saving ? "…" : "Speichern"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Übersichtsseite ───────────────────────────────────────────────────────────
function Uebersicht({ customersWithPlans, plansByCustomer, onSelectCustomer, onDeleteCustomer, colors }) {
  const { cardBg, border, text, subtle, accent } = colors;
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!search) return customersWithPlans;
    const q = search.toLowerCase();
    return customersWithPlans.filter(c => (c.company_name || "").toLowerCase().includes(q));
  }, [customersWithPlans, search]);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "24px 28px" }}>
      <div style={{ maxWidth: 720 }}>
        <div style={{ marginBottom: 18, position: "relative", maxWidth: 280 }}>
          <Search size={12} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: subtle }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Kunde suchen…"
            style={{ width: "100%", paddingLeft: 28, paddingRight: 8, paddingTop: 6, paddingBottom: 6, border: `1px solid ${border}`, borderRadius: 7, fontSize: 12, background: cardBg, color: text, outline: "none", boxSizing: "border-box" }} />
        </div>
        {filtered.length === 0 && <div style={{ color: subtle, fontSize: 13, padding: "40px 0", textAlign: "center" }}>Noch keine Einsatzplanungen vorhanden.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
          {filtered.map(c => {
            const plans = plansByCustomer[c.id] || [];
            return (
              <div key={c.id} style={{ position: "relative", background: cardBg, border: `1px solid ${border}`, borderRadius: 10, padding: "14px 16px", cursor: "pointer", transition: "border-color 0.15s, box-shadow 0.15s" }}
                onClick={() => onSelectCustomer(c.id)}
                onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)"; e.currentTarget.querySelector(".del-btn").style.opacity = "1"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.boxShadow = "none"; e.currentTarget.querySelector(".del-btn").style.opacity = "0"; }}>
                <button className="del-btn" onClick={e => { e.stopPropagation(); onDeleteCustomer(c); }} style={{ position: "absolute", top: 8, right: 8, border: "none", background: "transparent", cursor: "pointer", color: "#dc2626", padding: 4, borderRadius: 5, opacity: 0, transition: "opacity 0.15s", display: "flex", alignItems: "center" }}>
                  <Trash2 size={13} />
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                  <Building2 size={13} style={{ color: accent }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: text }}>{c.company_name}</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {plans.map(p => <span key={p.id} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 5, background: colors.isArtis ? "#e6ede6" : "#ede9fe", color: accent, fontWeight: 500 }}>{p.name}</span>)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Planungsraster (Jahresplanung-Stil) ───────────────────────────────────────
function PlanGrid({ plan, entries, years, onCellClick, onEntryClick, onToggleDone, onDragEnd, colors }) {
  const { cardBg, border, text, subtle, accent, headerBg, isArtis, isLight } = colors;
  const currentYear  = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const [collapsedYears, setCollapsedYears] = useState(new Set());
  const initRef = useRef(false);
  useEffect(() => {
    if (!initRef.current && years.length > 1) {
      initRef.current = true;
      setCollapsedYears(new Set(years.slice(1)));
    }
  }, [years]);

  const toggleYear = (year) => setCollapsedYears(prev => {
    const n = new Set(prev);
    if (n.has(year)) n.delete(year); else n.add(year);
    return n;
  });

  const byYear = useMemo(() => {
    const m = {};
    for (const e of entries) {
      if (!m[e.year]) m[e.year] = {};
      if (!m[e.year][e.title]) m[e.year][e.title] = {};
      if (!m[e.year][e.title][e.month]) m[e.year][e.title][e.month] = [];
      m[e.year][e.title][e.month].push(e);
    }
    return m;
  }, [entries]);

  const titlesByYear = useMemo(() => {
    const m = {};
    for (const e of entries) {
      if (!m[e.year]) m[e.year] = [];
      if (!m[e.year].includes(e.title)) m[e.year].push(e.title);
    }
    return m;
  }, [entries]);

  const allTitles = useMemo(() => {
    const seen = [];
    for (const e of entries) { if (!seen.includes(e.title)) seen.push(e.title); }
    return seen;
  }, [entries]);

  const rowSubBg = isArtis ? "#f4f8f4" : isLight ? "#f7f7fb" : "#26262c";

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── Sidebar ── */}
        <div style={{ width: 180, flexShrink: 0, borderRight: `1px solid ${border}`, display: "flex", flexDirection: "column", backgroundColor: cardBg }}>
          <div style={{ padding: "6px 8px 4px", borderBottom: `1px solid ${border}` }}>
            <div style={{ fontSize: 9.5, color: subtle, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", padding: "2px 2px 4px" }}>
              Aktivitäten · ziehen
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 5px" }}>
            <Droppable droppableId="mp-sidebar" isDropDisabled={true}>
              {(prov) => (
                <div ref={prov.innerRef} {...prov.droppableProps}>
                  {allTitles.map((title, idx) => {
                    const col = getTitleColor(title);
                    return (
                      <Draggable key={`s-${title}`} draggableId={`mp-sidebar|${encodeURIComponent(title)}`} index={idx}>
                        {(drag, snap) => applyDragPortal(snap,
                          <div ref={drag.innerRef} {...drag.draggableProps} {...drag.dragHandleProps}
                            style={{ ...drag.draggableProps.style, padding: "3px 7px 3px 9px", marginBottom: 2, borderRadius: 5, fontSize: 11, color: col.color, backgroundColor: snap.isDragging ? col.bg : `${col.bg}99`, borderLeft: `3px solid ${col.color}`, border: `1px solid ${snap.isDragging ? col.color + "50" : "transparent"}`, borderLeft: `3px solid ${col.color}`, cursor: "grab", userSelect: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", boxShadow: snap.isDragging ? "0 4px 12px rgba(0,0,0,0.15)" : "none" }}>
                            {title}
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                  {prov.placeholder}
                  {allTitles.length === 0 && (
                    <div style={{ fontSize: 10.5, color: subtle, padding: "12px 6px", textAlign: "center", lineHeight: 1.6 }}>
                      Noch keine Aktivitäten.<br />Klicke auf einen Monat.
                    </div>
                  )}
                </div>
              )}
            </Droppable>
          </div>
        </div>

        {/* ── Planning grid ── */}
        <div style={{ flex: 1, overflowX: "auto", overflowY: "auto" }}>
          <div style={{ minWidth: 12 * 100 }}>

            {/* Sticky month header */}
            <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 20, borderBottom: `2px solid ${border}`, backgroundColor: isArtis ? "#e8f0e8" : isLight ? "#eeeef6" : "#222228", flexShrink: 0 }}>
              {MONTHS.map((m, mi) => {
                const isCur = mi + 1 === currentMonth;
                return (
                  <div key={mi} style={{ flex: "1 0 0", minWidth: 100, padding: "6px 4px 5px", textAlign: "center", borderRight: mi < 11 ? `1px solid ${border}` : "none", backgroundColor: isCur ? `${accent}14` : "transparent", position: "relative" }}>
                    {isCur && <div style={{ position: "absolute", top: 3, left: "50%", transform: "translateX(-50%)", width: 5, height: 5, borderRadius: "50%", backgroundColor: accent }} />}
                    <span style={{ fontSize: 11, fontWeight: 800, color: isCur ? accent : subtle, letterSpacing: ".07em", display: "block", marginTop: isCur ? 6 : 0 }}>{m}</span>
                  </div>
                );
              })}
            </div>

            {/* Year sections */}
            <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
              {years.map(year => {
                const isCollapsed  = collapsedYears.has(year);
                const isCurYear    = year === currentYear;
                const titles       = titlesByYear[year] || [];
                const entryMap     = byYear[year] || {};
                const entryCount   = entries.filter(e => e.year === year).length;
                const doneCount    = entries.filter(e => e.year === year && e.done).length;

                return (
                  <div key={year} style={{ borderRadius: 10, overflow: "hidden", backgroundColor: cardBg, border: `1px solid ${isCurYear ? accent : border}`, boxShadow: isCurYear ? `0 0 0 2px ${accent}20` : "0 1px 3px rgba(0,0,0,0.04)" }}>

                    {/* Year header */}
                    <div onClick={() => toggleYear(year)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", backgroundColor: isCurYear ? (isArtis ? "#cfe8cf" : isLight ? "#ede9fe" : "#2d2d40") : headerBg, cursor: "pointer", userSelect: "none" }}>
                      {isCollapsed
                        ? <ChevronRight size={13} style={{ color: subtle, flexShrink: 0 }} />
                        : <ChevronDown  size={13} style={{ color: subtle, flexShrink: 0 }} />}
                      <span style={{ fontSize: 13, fontWeight: 800, color: text }}>{year}</span>
                      {isCurYear && <span style={{ fontSize: 9.5, fontWeight: 700, color: accent, backgroundColor: `${accent}18`, padding: "1px 7px", borderRadius: 8 }}>Aktuell</span>}
                      <span style={{ fontSize: 10.5, color: subtle, marginLeft: "auto" }}>
                        {entryCount > 0 ? `${doneCount} / ${entryCount} erledigt` : "Leer"}
                      </span>
                    </div>

                    {!isCollapsed && (
                      <div style={{ borderTop: `1px solid ${border}` }}>

                        {titles.length === 0 && (
                          <div style={{ padding: "24px 16px", textAlign: "center", color: subtle, fontSize: 13 }}>
                            Aktivität aus der Seitenleiste ziehen oder auf einen Monat klicken.
                          </div>
                        )}

                        {/* Activity rows */}
                        {titles.map(title => {
                          const col         = getTitleColor(title);
                          const titleTotal  = entries.filter(e => e.year === year && e.title === title).length;
                          const titleDone   = entries.filter(e => e.year === year && e.title === title && e.done).length;

                          return (
                            <div key={title} style={{ borderBottom: `1px solid ${border}` }}>
                              {/* Activity sub-header */}
                              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px", backgroundColor: rowSubBg, borderBottom: `1px solid ${border}` }}>
                                <div style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: col.color, flexShrink: 0 }} />
                                <span style={{ fontSize: 11.5, fontWeight: 700, color: text, flex: 1 }}>{title}</span>
                                <span style={{ fontSize: 10, color: subtle }}>{titleDone}/{titleTotal}</span>
                              </div>

                              {/* 12 month cells */}
                              <div style={{ display: "flex" }}>
                                {MONTHS.map((_, mi) => {
                                  const month       = mi + 1;
                                  const isCur       = month === currentMonth && isCurYear;
                                  const cellEntries = entryMap[title]?.[month] || [];
                                  const droppableId = `mp-cell|${year}|${encodeURIComponent(title)}|${month}`;

                                  return (
                                    <Droppable key={month} droppableId={droppableId}>
                                      {(prov, snap) => (
                                        <div ref={prov.innerRef} {...prov.droppableProps}
                                          onClick={() => onCellClick(title, month, year)}
                                          style={{ flex: "1 0 0", minWidth: 100, minHeight: 80, borderRight: mi < 11 ? `1px solid ${border}` : "none", padding: "4px 3px 20px", backgroundColor: snap.isDraggingOver ? (isArtis ? "#c8e8c8" : "#ddd6fe") : isCur ? `${accent}07` : "transparent", transition: "background-color 0.12s", display: "flex", flexDirection: "column", gap: 3, position: "relative" }}>

                                          {cellEntries.map((entry, eidx) => {
                                            const isDone = entry.done === true;
                                            return (
                                              <Draggable key={entry.id} draggableId={`mp-entry|${entry.id}`} index={eidx}>
                                                {(eDrag, eSnap) => applyDragPortal(eSnap,
                                                  <div ref={eDrag.innerRef} {...eDrag.draggableProps} {...eDrag.dragHandleProps}
                                                    onClick={ev => { ev.stopPropagation(); onEntryClick(entry); }}
                                                    style={{ ...eDrag.draggableProps.style, backgroundColor: isDone ? `${col.bg}88` : col.bg, border: `1px solid ${isDone ? "#22c55e55" : col.color + "28"}`, borderLeft: `3px solid ${isDone ? "#22c55e" : col.color}`, borderRadius: 5, cursor: "pointer", lineHeight: 1.35, opacity: isDone ? 0.8 : 1, boxShadow: eSnap.isDragging ? "0 4px 14px rgba(0,0,0,0.2)" : "none" }}>
                                                    <div style={{ position: "relative", padding: "4px 6px" }}>
                                                      {/* Done toggle */}
                                                      <button onClick={ev => { ev.stopPropagation(); onToggleDone(entry.id, entry.done); }}
                                                        style={{ position: "absolute", top: 0, right: 0, width: 13, height: 13, borderRadius: "50%", border: `1.5px solid ${isDone ? "#22c55e" : "#d1d5db"}`, background: isDone ? "#22c55e" : "transparent", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                        {isDone && <span style={{ fontSize: 7, color: "#fff", fontWeight: 900, lineHeight: 1 }}>✓</span>}
                                                      </button>
                                                      <div style={{ fontSize: 9.5, fontWeight: 700, color: isDone ? "#22c55e" : col.color, paddingRight: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: isDone ? "line-through" : "none" }}>{entry.title}</div>
                                                      {entry.datum && <div style={{ fontSize: 9.5, color: isDone ? "#888" : "#555", marginTop: 1 }}>{toLocalDateStr(entry.datum)}</div>}
                                                      {entry.detail_text && <div title={entry.detail_text} style={{ position: "absolute", bottom: 3, right: 3, width: 5, height: 5, borderRadius: "50%", backgroundColor: "#f59e0b", boxShadow: "0 0 0 1.5px #fff8" }} />}
                                                    </div>
                                                  </div>
                                                )}
                                              </Draggable>
                                            );
                                          })}
                                          {prov.placeholder}

                                          {/* + button */}
                                          <button onClick={ev => { ev.stopPropagation(); onCellClick(title, month, year); }} title="Eintrag hinzufügen"
                                            style={{ position: "absolute", top: 3, right: 3, width: 18, height: 18, borderRadius: "50%", border: `1px dashed ${border}`, background: "none", color: subtle, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0, opacity: 0.4, transition: "all 0.12s" }}
                                            onMouseEnter={e => { Object.assign(e.currentTarget.style, { opacity: "1", backgroundColor: `${accent}18`, borderColor: accent, borderStyle: "solid", color: accent }); }}
                                            onMouseLeave={e => { Object.assign(e.currentTarget.style, { opacity: "0.4", backgroundColor: "transparent", borderColor: border, borderStyle: "dashed", color: subtle }); }}>
                                            +
                                          </button>
                                        </div>
                                      )}
                                    </Droppable>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}

                        {/* New entry row */}
                        <div>
                          <div style={{ padding: "4px 12px 0", fontSize: 10.5, color: subtle, fontStyle: "italic" }}>+ neuer Eintrag</div>
                          <div style={{ display: "flex" }}>
                            {MONTHS.map((_, mi) => {
                              const month = mi + 1;
                              return (
                                <Droppable key={month} droppableId={`mp-new|${year}|${month}`}>
                                  {(prov, snap) => (
                                    <div ref={prov.innerRef} {...prov.droppableProps}
                                      onClick={() => onCellClick(null, month, year)}
                                      style={{ flex: "1 0 0", minWidth: 100, minHeight: 40, borderRight: mi < 11 ? `1px solid ${border}` : "none", cursor: "pointer", backgroundColor: snap.isDraggingOver ? (isArtis ? "#c8e8c8" : "#ddd6fe") : "transparent", transition: "background 0.12s" }}
                                      onMouseEnter={e => { if (!snap.isDraggingOver) e.currentTarget.style.backgroundColor = isArtis ? "#f0f5f0" : "#f3f0fc"; }}
                                      onMouseLeave={e => { if (!snap.isDraggingOver) e.currentTarget.style.backgroundColor = "transparent"; }}
                                    />
                                  )}
                                </Droppable>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </DragDropContext>
  );
}

// ── Hauptseite ────────────────────────────────────────────────────────────────
export default function Monatsplanung() {
  const { theme } = useContext(ThemeContext);
  useAuth();
  const isArtis = theme === "artis";
  const isLight = theme === "light";

  const pageBg   = isArtis ? "#f2f5f2" : isLight ? "#f4f4f8" : "#1a1a1f";
  const cardBg   = isArtis ? "#fff"    : isLight ? "#fff"    : "#2a2a30";
  const border   = isArtis ? "#dde8dd" : isLight ? "#e4e4ea" : "#3f3f46";
  const text     = isArtis ? "#1a2a1a" : isLight ? "#1a1a2e" : "#e4e4e7";
  const subtle   = isArtis ? "#6b826b" : isLight ? "#8080a0" : "#9090b8";
  const accent   = isArtis ? "#4d6a50" : "#5b21b6";
  const headerBg = isArtis ? "#e6ede6" : isLight ? "#eef0fb" : "#27272c";
  const colors   = { pageBg, cardBg, border, text, subtle, accent, headerBg, isArtis, isLight };

  const [plans, setPlans]               = useState([]);
  const [entries, setEntries]           = useState([]);
  const [customers, setCustomers]       = useState([]);
  const [allCustomers, setAllCustomers] = useState([]);
  const [extraYears, setExtraYears]     = useState(() => new Set([new Date().getFullYear()]));
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [selectedPlanId, setSelectedPlanId]         = useState(null);
  const [modal, setModal]               = useState(null);
  const [yearDialog, setYearDialog]     = useState(null);
  const [promptModal, setPromptModal]   = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [loading, setLoading]           = useState(true);

  const years = useMemo(() => {
    const s = new Set([...entries.map(e => e.year), ...extraYears]);
    return [...s].sort((a, b) => b - a);
  }, [entries, extraYears]);

  // ── Laden ──────────────────────────────────────────────────────────────────
  const loadPlans = useCallback(async () => {
    const { data, error } = await supabase.from("mp_plans").select("*").order("created_at");
    if (error) { toast.error(`Pläne: ${error.message}`); return []; }
    setPlans(data || []);
    return data || [];
  }, []);

  const loadCustomers = useCallback(async (plansData) => {
    const { data } = await supabase.from("customers").select("id,company_name,aktiv").or("aktiv.is.null,aktiv.eq.true").order("company_name").limit(3000);
    const all = data || [];
    setAllCustomers(all);
    const usedIds = new Set((plansData || []).map(p => p.customer_id));
    setCustomers(all.filter(c => usedIds.has(c.id)));
  }, []);

  const loadEntries = useCallback(async (planId) => {
    if (!planId) { setEntries([]); return; }
    const { data, error } = await supabase.from("mp_entries").select("*").eq("plan_id", planId).order("year", { ascending: false });
    if (error) { toast.error(`Einträge: ${error.message}`); return; }
    setEntries(data || []);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const plansData = await loadPlans();
    await loadCustomers(plansData);
    setLoading(false);
  }, [loadPlans, loadCustomers]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { if (selectedPlanId) loadEntries(selectedPlanId); }, [selectedPlanId, loadEntries]);

  // ── Kunden/Plan ────────────────────────────────────────────────────────────
  const handleSelectCustomer = (custId) => {
    setSelectedCustomerId(custId);
    const custPlans = plans.filter(p => p.customer_id === custId);
    setSelectedPlanId(custPlans.length > 0 ? custPlans[0].id : null);
  };

  // ── Jahreswechsel ──────────────────────────────────────────────────────────
  const handleAddYear = () => {
    const maxYear = years.length > 0 ? years[0] : new Date().getFullYear();
    setYearDialog({ from: maxYear, to: maxYear + 1 });
  };

  const confirmYearChange = async () => {
    const { from, to } = yearDialog;
    setYearDialog(null);
    setExtraYears(prev => new Set([...prev, to]));
    if (selectedPlanId) {
      const fromEntries = entries.filter(e => e.year === from);
      if (fromEntries.length > 0) {
        const { data: { user } } = await supabase.auth.getUser();
        const rows = fromEntries.map(({ id, created_at, ...rest }) => ({ ...rest, year: to, created_by: user?.id }));
        const { error } = await supabase.from("mp_entries").insert(rows);
        if (error) { toast.error(`Übertragen fehlgeschlagen: ${error.message}`); return; }
        await loadEntries(selectedPlanId);
        toast.success(`${rows.length} Einträge nach ${to} übertragen`);
      } else {
        toast.info(`Jahr ${to} hinzugefügt`);
      }
    }
  };

  const cancelYearChange = () => {
    setExtraYears(prev => new Set([...prev, yearDialog.to]));
    setYearDialog(null);
  };

  // ── Plan CRUD ──────────────────────────────────────────────────────────────
  const plansByCustomer = useMemo(() => {
    const m = {};
    for (const p of plans) { if (!m[p.customer_id]) m[p.customer_id] = []; m[p.customer_id].push(p); }
    return m;
  }, [plans]);

  const handleAddPlan = () => {
    setPromptModal({
      title: "Neuer Plan", placeholder: "z.B. Verwaltungsratstätigkeit", defaultValue: "",
      onConfirm: async (name) => {
        const { data: { user } } = await supabase.auth.getUser();
        const { data, error } = await supabase.from("mp_plans").insert({ customer_id: selectedCustomerId, name, created_by: user?.id }).select().single();
        if (error) { toast.error(error.message); return; }
        const updated = [...plans, data];
        setPlans(updated);
        setSelectedPlanId(data.id);
        const usedIds = new Set(updated.map(p => p.customer_id));
        setCustomers(allCustomers.filter(c => usedIds.has(c.id)));
        toast.success("Plan erstellt ✓");
      },
    });
  };

  const handleDeleteCustomer = (customer) => {
    const cnt = (plansByCustomer[customer.id] || []).length;
    setConfirmModal({
      message: `Alle ${cnt} Plan(s) von „${customer.company_name}" wirklich löschen?`,
      onConfirm: async () => {
        const ids = (plansByCustomer[customer.id] || []).map(p => p.id);
        const { error } = await supabase.from("mp_plans").delete().in("id", ids);
        if (error) { toast.error(error.message); return; }
        const updated = plans.filter(p => p.customer_id !== customer.id);
        setPlans(updated);
        setCustomers(allCustomers.filter(c => new Set(updated.map(p => p.customer_id)).has(c.id)));
        toast.success(`Pläne von ${customer.company_name} gelöscht`);
      },
    });
  };

  const handleRenamePlan = async (planId, newName) => {
    const { error } = await supabase.from("mp_plans").update({ name: newName }).eq("id", planId);
    if (error) { toast.error(error.message); return; }
    setPlans(prev => prev.map(p => p.id === planId ? { ...p, name: newName } : p));
  };

  const handleDeletePlan = (planId) => {
    const plan = plans.find(p => p.id === planId);
    setConfirmModal({
      message: `Plan "${plan?.name}" wirklich löschen? Alle Einträge werden entfernt.`,
      onConfirm: async () => {
        const { error } = await supabase.from("mp_plans").delete().eq("id", planId);
        if (error) { toast.error(error.message); return; }
        const updated = plans.filter(p => p.id !== planId);
        setPlans(updated);
        setCustomers(allCustomers.filter(c => new Set(updated.map(p => p.customer_id)).has(c.id)));
        const remaining = updated.filter(p => p.customer_id === selectedCustomerId);
        setSelectedPlanId(remaining.length > 0 ? remaining[0].id : null);
        toast.success("Plan gelöscht");
      },
    });
  };

  // ── Eintrag CRUD ──────────────────────────────────────────────────────────
  const handleCellClick = (prefillTitle, month, year) => setModal({ mode: "create", month, prefillTitle, year });
  const handleEntryClick = (entry) => setModal({ mode: "edit", entry, month: entry.month, year: entry.year });

  const handleSaveEntry = async (form) => {
    const { title, detail_text, datum, done } = form;
    const { data: { user } } = await supabase.auth.getUser();
    if (modal.mode === "create") {
      const { data, error } = await supabase.from("mp_entries").insert({ plan_id: selectedPlanId, title, year: modal.year, month: modal.month, detail_text, datum: datum || null, done, created_by: user?.id }).select().single();
      if (error) { toast.error(error.message); return; }
      setEntries(prev => [...prev, data]);
      toast.success("Eintrag erstellt ✓");
    } else {
      const { data, error } = await supabase.from("mp_entries").update({ title, detail_text, datum: datum || null, done }).eq("id", modal.entry.id).select().single();
      if (error) { toast.error(error.message); return; }
      setEntries(prev => prev.map(e => e.id === modal.entry.id ? data : e));
      toast.success("Gespeichert ✓");
    }
    setModal(null);
  };

  const handleDeleteEntry = (entryId) => {
    setConfirmModal({
      message: "Eintrag wirklich löschen?",
      onConfirm: async () => {
        const { error } = await supabase.from("mp_entries").delete().eq("id", entryId);
        if (error) { toast.error(error.message); return; }
        setEntries(prev => prev.filter(e => e.id !== entryId));
        setModal(null);
        toast.success("Gelöscht");
      },
    });
  };

  // ── Done-Toggle (optimistisch) ─────────────────────────────────────────────
  const handleToggleDone = useCallback(async (entryId, currentDone) => {
    const newDone = !currentDone;
    setEntries(prev => prev.map(e => e.id === entryId ? { ...e, done: newDone } : e));
    const { error } = await supabase.from("mp_entries").update({ done: newDone }).eq("id", entryId);
    if (error) {
      setEntries(prev => prev.map(e => e.id === entryId ? { ...e, done: currentDone } : e));
      toast.error("Fehler beim Speichern");
    }
  }, []);

  // ── Drag & Drop ────────────────────────────────────────────────────────────
  const handleDragEnd = useCallback(async (result) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId) return;

    const parseCell = (id) => {
      if (id.startsWith("mp-cell|")) {
        const p = id.split("|");
        return { year: parseInt(p[1]), month: parseInt(p[3]) };
      }
      if (id.startsWith("mp-new|")) {
        const p = id.split("|");
        return { year: parseInt(p[1]), month: parseInt(p[2]) };
      }
      return null;
    };

    if (draggableId.startsWith("mp-sidebar|")) {
      const sTitle = decodeURIComponent(draggableId.slice("mp-sidebar|".length));
      const dest = parseCell(destination.droppableId);
      if (!dest) return;
      setModal({ mode: "create", month: dest.month, year: dest.year, prefillTitle: sTitle });
    } else if (draggableId.startsWith("mp-entry|")) {
      const entryId = draggableId.slice("mp-entry|".length);
      const dest = parseCell(destination.droppableId);
      if (!dest) return;
      setEntries(prev => prev.map(e => e.id === entryId ? { ...e, year: dest.year, month: dest.month } : e));
      const { error } = await supabase.from("mp_entries").update({ year: dest.year, month: dest.month }).eq("id", entryId);
      if (error) { toast.error("Fehler beim Verschieben"); loadEntries(selectedPlanId); }
      else toast.success("Verschoben ✓");
    }
  }, [selectedPlanId, loadEntries]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const custPlans = useMemo(() => plans.filter(p => p.customer_id === selectedCustomerId), [plans, selectedCustomerId]);
  const selectedPlan = plans.find(p => p.id === selectedPlanId);
  const existingTitles = useMemo(() => [...new Set(entries.map(e => e.title))], [entries]);
  const nextYear = years.length > 0 ? years[0] + 1 : new Date().getFullYear() + 1;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", backgroundColor: pageBg, overflow: "hidden" }}>

      {/* Top bar */}
      <div style={{ padding: "9px 18px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 10, backgroundColor: cardBg, flexShrink: 0, flexWrap: "wrap" }}>
        <CalendarRange size={16} style={{ color: accent }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: text }}>Einsatzplanung</span>
        <div style={{ width: 1, height: 18, background: border, margin: "0 4px" }} />

        <KundenSelector customers={allCustomers} selectedId={selectedCustomerId} onSelect={handleSelectCustomer} colors={colors} />

        {selectedCustomerId && (
          <>
            <div style={{ width: 1, height: 18, background: border, margin: "0 4px" }} />
            <PlanTabs plans={custPlans} selectedPlanId={selectedPlanId} onSelect={setSelectedPlanId} onAdd={handleAddPlan} onRename={handleRenamePlan} onDelete={handleDeletePlan} colors={colors} />
          </>
        )}

        {selectedPlanId && (
          <>
            <div style={{ width: 1, height: 18, background: border, margin: "0 4px" }} />
            <button onClick={handleAddYear} title={`Jahr ${nextYear} hinzufügen`}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", border: `1px dashed ${border}`, borderRadius: 7, background: "transparent", color: subtle, fontSize: 12, cursor: "pointer" }}>
              <Plus size={11} /> {nextYear}
            </button>
          </>
        )}

        <button onClick={loadAll} title="Aktualisieren" style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: subtle, padding: 4, borderRadius: 5 }}>
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: subtle, fontSize: 13 }}>Lade…</div>
      ) : !selectedPlanId ? (
        <Uebersicht customersWithPlans={customers} plansByCustomer={plansByCustomer} onSelectCustomer={handleSelectCustomer} onDeleteCustomer={handleDeleteCustomer} colors={colors} />
      ) : (
        <PlanGrid plan={selectedPlan} entries={entries} years={years} onCellClick={handleCellClick} onEntryClick={handleEntryClick} onToggleDone={handleToggleDone} onDragEnd={handleDragEnd} colors={colors} />
      )}

      {/* Modals */}
      {modal && (
        <EntryModal mode={modal.mode} entry={modal.entry} month={modal.month} year={modal.year} existingTitles={existingTitles} onSave={handleSaveEntry} onDelete={handleDeleteEntry} onClose={() => setModal(null)} colors={colors} />
      )}
      {yearDialog && <YearChangeDialog fromYear={yearDialog.from} toYear={yearDialog.to} onConfirm={confirmYearChange} onCancel={cancelYearChange} colors={colors} />}
      {promptModal && <SimpleInputModal title={promptModal.title} placeholder={promptModal.placeholder} defaultValue={promptModal.defaultValue} onConfirm={promptModal.onConfirm} onClose={() => setPromptModal(null)} colors={colors} />}
      {confirmModal && <ConfirmModal message={confirmModal.message} onConfirm={confirmModal.onConfirm} onClose={() => setConfirmModal(null)} colors={colors} />}
    </div>
  );
}
