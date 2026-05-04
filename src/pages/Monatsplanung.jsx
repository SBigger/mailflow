import React, { useState, useEffect, useMemo, useContext, useCallback, useRef } from "react";
import { ThemeContext } from "@/Layout";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { toast } from "sonner";
import {
  CalendarRange, ChevronLeft, ChevronRight, Plus, X, Check, Circle,
  CheckCircle2, Pencil, Trash2, Search, ChevronDown, Building2, RefreshCw
} from "lucide-react";

const MONTHS     = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
const MONTHS_LONG = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

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
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", minWidth: 220 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 6, padding: "5px 10px",
          border: `1px solid ${border}`, borderRadius: 7, background: cardBg,
          color: text, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap",
          minWidth: 220,
        }}
      >
        <Building2 size={13} style={{ color: accent, flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis" }}>
          {selected ? selected.company_name : <span style={{ color: subtle }}>Kunde wählen…</span>}
        </span>
        <ChevronDown size={12} style={{ color: subtle, flexShrink: 0 }} />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 100,
          background: cardBg, border: `1px solid ${border}`, borderRadius: 9,
          boxShadow: "0 8px 24px rgba(0,0,0,0.13)", minWidth: 260, maxHeight: 320,
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          <div style={{ padding: "7px 8px", borderBottom: `1px solid ${border}` }}>
            <div style={{ position: "relative" }}>
              <Search size={11} style={{ position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", color: subtle }} />
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Suchen…"
                style={{
                  width: "100%", paddingLeft: 24, paddingRight: 8, paddingTop: 4, paddingBottom: 4,
                  border: `1px solid ${border}`, borderRadius: 5, fontSize: 12,
                  background: pageBg, color: text, outline: "none",
                }}
              />
            </div>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.length === 0 && (
              <div style={{ padding: "12px 12px", color: subtle, fontSize: 12, textAlign: "center" }}>
                Keine Kunden mit Monatsplanung
              </div>
            )}
            {filtered.map(c => (
              <button
                key={c.id}
                onClick={() => { onSelect(c.id); setOpen(false); setSearch(""); }}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "7px 12px", border: "none", cursor: "pointer",
                  background: c.id === selectedId ? (colors.isArtis ? "#e6ede6" : "#ede9fe") : "transparent",
                  color: c.id === selectedId ? (colors.isArtis ? "#2d4a2d" : "#4c1d95") : text,
                  fontSize: 12, fontWeight: c.id === selectedId ? 600 : 400,
                }}
              >
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
  const { cardBg, border, text, subtle, accent, pageBg } = colors;
  const [renamingId, setRenamingId] = useState(null);
  const [renameVal, setRenameVal] = useState("");

  const startRename = (plan) => {
    setRenamingId(plan.id);
    setRenameVal(plan.name);
  };

  const commitRename = async () => {
    if (renameVal.trim()) await onRename(renamingId, renameVal.trim());
    setRenamingId(null);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      {plans.map(plan => (
        <div
          key={plan.id}
          style={{
            display: "flex", alignItems: "center", gap: 3,
            background: plan.id === selectedPlanId ? (colors.isArtis ? "#e6ede6" : "#ede9fe") : pageBg,
            border: `1px solid ${plan.id === selectedPlanId ? accent : border}`,
            borderRadius: 7, overflow: "hidden",
          }}
        >
          {renamingId === plan.id ? (
            <input
              autoFocus
              value={renameVal}
              onChange={e => setRenameVal(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingId(null); }}
              style={{
                border: "none", outline: "none", background: "transparent",
                fontSize: 12, padding: "4px 8px", color: text, minWidth: 120,
              }}
            />
          ) : (
            <button
              onClick={() => onSelect(plan.id)}
              onDoubleClick={() => startRename(plan)}
              title="Klick = auswählen, Doppelklick = umbenennen"
              style={{
                border: "none", background: "transparent", cursor: "pointer",
                fontSize: 12, padding: "4px 8px", color: plan.id === selectedPlanId ? accent : text,
                fontWeight: plan.id === selectedPlanId ? 700 : 400,
              }}
            >
              {plan.name}
            </button>
          )}
          {plan.id === selectedPlanId && (
            <button
              onClick={() => { if (window.confirm(`Plan "${plan.name}" wirklich löschen? Alle Einträge werden entfernt.`)) onDelete(plan.id); }}
              style={{ border: "none", background: "transparent", cursor: "pointer", padding: "0 5px 0 0", color: subtle }}
            >
              <X size={10} />
            </button>
          )}
        </div>
      ))}
      <button
        onClick={onAdd}
        title="Neuen Plan erstellen"
        style={{
          display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
          border: `1px dashed ${border}`, borderRadius: 7, background: "transparent",
          color: subtle, fontSize: 12, cursor: "pointer",
        }}
      >
        <Plus size={11} /> Plan
      </button>
    </div>
  );
}

// ── Jahreswechsel-Dialog ──────────────────────────────────────────────────────

function YearChangeDialog({ fromYear, toYear, onConfirm, onCancel, colors }) {
  const { cardBg, border, text, subtle, accent } = colors;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: cardBg, border: `1px solid ${border}`, borderRadius: 12,
        padding: "28px 32px", maxWidth: 420, width: "90%",
        boxShadow: "0 16px 40px rgba(0,0,0,0.18)",
      }}>
        <h3 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 700, color: text }}>
          Jahreswechsel zu {toYear}
        </h3>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: subtle, lineHeight: 1.5 }}>
          Sollen alle Einträge von <strong style={{ color: text }}>{fromYear}</strong> ins Jahr{" "}
          <strong style={{ color: text }}>{toYear}</strong> übertragen werden?
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "7px 18px", border: `1px solid ${border}`, borderRadius: 7,
              background: "transparent", color: text, fontSize: 13, cursor: "pointer",
            }}
          >
            Nein
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "7px 18px", border: "none", borderRadius: 7,
              background: accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            Ja, übertragen
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Erfassungsmaske (Modal) ───────────────────────────────────────────────────

function EntryModal({ mode, entry, planId, month, year, existingTitles, onSave, onDelete, onClose, colors }) {
  const { cardBg, border, text, subtle, accent, pageBg } = colors;
  const [title, setTitle]       = useState(entry?.title || "");
  const [detail, setDetail]     = useState(entry?.detail_text || "");
  const [datum, setDatum]       = useState(entry ? toInputDate(entry.datum) : "");
  const [done, setDone]         = useState(entry?.done || false);
  const [saving, setSaving]     = useState(false);
  const titleRef = useRef(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const handleSave = async () => {
    if (!title.trim()) { toast.error("Titel ist erforderlich"); return; }
    setSaving(true);
    await onSave({ title: title.trim(), detail_text: detail.trim() || null, datum: datum || null, done });
    setSaving(false);
  };

  const monthLabel = MONTHS_LONG[month - 1];

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 150, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: cardBg, border: `1px solid ${border}`, borderRadius: 12,
        padding: "24px 28px", width: 480, maxWidth: "94vw",
        boxShadow: "0 16px 40px rgba(0,0,0,0.18)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: text }}>
            {mode === "create" ? `Eintrag – ${monthLabel} ${year}` : `Eintrag bearbeiten`}
          </span>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: subtle }}>
            <X size={16} />
          </button>
        </div>

        {/* Titel */}
        <label style={{ display: "block", marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: subtle, display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Titel *
          </span>
          <input
            ref={titleRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) handleSave(); }}
            placeholder="z.B. Jahresabschluss"
            list="mp-titles-list"
            style={{
              width: "100%", padding: "8px 10px", border: `1px solid ${border}`,
              borderRadius: 7, fontSize: 13, background: pageBg, color: text, outline: "none",
              boxSizing: "border-box",
            }}
          />
          {/* Autocomplete aus bestehenden Titeln */}
          <datalist id="mp-titles-list">
            {existingTitles.map(t => <option key={t} value={t} />)}
          </datalist>
        </label>

        {/* Detailtext */}
        <label style={{ display: "block", marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: subtle, display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Details
          </span>
          <textarea
            value={detail}
            onChange={e => setDetail(e.target.value)}
            placeholder="Optionale Beschreibung…"
            rows={3}
            style={{
              width: "100%", padding: "8px 10px", border: `1px solid ${border}`,
              borderRadius: 7, fontSize: 13, background: pageBg, color: text, outline: "none",
              resize: "vertical", boxSizing: "border-box", fontFamily: "inherit",
            }}
          />
        </label>

        {/* Datum */}
        <label style={{ display: "block", marginBottom: 18 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: subtle, display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Datum (optional)
          </span>
          <input
            type="date"
            value={datum}
            onChange={e => setDatum(e.target.value)}
            style={{
              padding: "8px 10px", border: `1px solid ${border}`,
              borderRadius: 7, fontSize: 13, background: pageBg, color: text, outline: "none",
            }}
          />
        </label>

        {/* Done-Toggle */}
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, cursor: "pointer" }}>
          <button
            type="button"
            onClick={() => setDone(d => !d)}
            style={{ border: "none", background: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center" }}
          >
            {done
              ? <CheckCircle2 size={18} style={{ color: "#059669" }} />
              : <Circle size={18} style={{ color: subtle }} />}
          </button>
          <span style={{ fontSize: 13, color: text }}>Erledigt</span>
        </label>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
          <div>
            {mode === "edit" && (
              <button
                onClick={() => { if (window.confirm("Eintrag wirklich löschen?")) onDelete(entry.id); }}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "7px 14px", border: `1px solid #fca5a5`, borderRadius: 7,
                  background: "transparent", color: "#dc2626", fontSize: 12, cursor: "pointer",
                }}
              >
                <Trash2 size={12} /> Löschen
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                padding: "7px 16px", border: `1px solid ${border}`, borderRadius: 7,
                background: "transparent", color: text, fontSize: 13, cursor: "pointer",
              }}
            >
              Abbrechen
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: "7px 18px", border: "none", borderRadius: 7,
                background: accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "…" : "Speichern"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Übersichtsseite (Kunden ohne Plan ausgewählt) ─────────────────────────────

function Uebersicht({ customersWithPlans, plansByCustomer, onSelectCustomer, colors }) {
  const { cardBg, border, text, subtle, accent, pageBg } = colors;
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
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Kunde suchen…"
            style={{
              width: "100%", paddingLeft: 28, paddingRight: 8, paddingTop: 6, paddingBottom: 6,
              border: `1px solid ${border}`, borderRadius: 7, fontSize: 12,
              background: cardBg, color: text, outline: "none", boxSizing: "border-box",
            }}
          />
        </div>

        {filtered.length === 0 && (
          <div style={{ color: subtle, fontSize: 13, padding: "40px 0", textAlign: "center" }}>
            Noch keine Monatsplanungen vorhanden.
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
          {filtered.map(c => {
            const plans = plansByCustomer[c.id] || [];
            return (
              <button
                key={c.id}
                onClick={() => onSelectCustomer(c.id)}
                style={{
                  textAlign: "left", background: cardBg, border: `1px solid ${border}`,
                  borderRadius: 10, padding: "14px 16px", cursor: "pointer",
                  transition: "border-color 0.15s, box-shadow 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.boxShadow = "none"; }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                  <Building2 size={13} style={{ color: accent }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: text }}>{c.company_name}</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {plans.map(p => (
                    <span
                      key={p.id}
                      style={{
                        fontSize: 11, padding: "2px 8px", borderRadius: 5,
                        background: colors.isArtis ? "#e6ede6" : "#ede9fe",
                        color: accent, fontWeight: 500,
                      }}
                    >
                      {p.name}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Planungsraster ─────────────────────────────────────────────────────────────

function PlanGrid({ plan, entries, year, onCellClick, onEntryClick, colors }) {
  const { cardBg, border, text, subtle, accent, pageBg, isArtis } = colors;

  // Einzigartige Titel (Zeilen), sortiert nach erstem Vorkommen
  const titles = useMemo(() => {
    const seen = [];
    for (const e of entries) {
      if (!seen.includes(e.title)) seen.push(e.title);
    }
    return seen;
  }, [entries]);

  // entries gruppiert: title → month → []
  const entryMap = useMemo(() => {
    const m = {};
    for (const e of entries) {
      if (!m[e.title]) m[e.title] = {};
      if (!m[e.title][e.month]) m[e.title][e.month] = [];
      m[e.title][e.month].push(e);
    }
    return m;
  }, [entries]);

  const cellStyle = {
    borderRight: `1px solid ${border}`, borderBottom: `1px solid ${border}`,
    minHeight: 48, verticalAlign: "top", padding: 3,
  };

  const headerCell = {
    background: colors.isArtis ? "#e6ede6" : colors.isLight ? "#eef0fb" : "#27272c",
    padding: "5px 8px", fontSize: 11, fontWeight: 700, color: subtle,
    borderRight: `1px solid ${border}`, borderBottom: `1px solid ${border}`,
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
      <div style={{
        background: cardBg, border: `1px solid ${border}`, borderRadius: 10,
        overflow: "hidden", display: "inline-block", minWidth: "100%",
      }}>
        <table style={{ borderCollapse: "collapse", minWidth: "100%", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 180 }} />
            {MONTHS.map(m => <col key={m} style={{ width: 90 }} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...headerCell, textAlign: "left", fontSize: 12, color: accent, fontWeight: 800 }}>
                {plan.name}
              </th>
              {MONTHS.map((m, i) => (
                <th key={m} style={{ ...headerCell, textAlign: "center" }}>{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {titles.length === 0 && (
              <tr>
                <td
                  colSpan={13}
                  style={{
                    padding: "32px 16px", textAlign: "center", color: subtle,
                    fontSize: 13, borderBottom: `1px solid ${border}`,
                  }}
                >
                  Noch keine Einträge. Klicke auf einen Monat um zu beginnen.
                </td>
              </tr>
            )}
            {titles.map(title => (
              <tr key={title}>
                <td style={{
                  ...cellStyle, padding: "8px 10px", fontSize: 12, fontWeight: 600,
                  color: text, background: colors.isArtis ? "#f8faf8" : colors.isLight ? "#f9f9fb" : "#25252a",
                }}>
                  {title}
                </td>
                {MONTHS.map((_, mi) => {
                  const month = mi + 1;
                  const cellEntries = entryMap[title]?.[month] || [];
                  return (
                    <td
                      key={month}
                      onClick={() => onCellClick(title, month)}
                      style={{
                        ...cellStyle, cursor: "pointer", transition: "background 0.1s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = isArtis ? "#f0f5f0" : "#f3f0fc"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {cellEntries.map(entry => (
                          <div
                            key={entry.id}
                            onClick={e => { e.stopPropagation(); onEntryClick(entry); }}
                            style={{
                              fontSize: 10, padding: "2px 5px", borderRadius: 4,
                              background: entry.done
                                ? (isArtis ? "#d1fae5" : "#d1fae5")
                                : (isArtis ? "#e6ede6" : "#ede9fe"),
                              color: entry.done ? "#059669" : accent,
                              fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                              overflow: "hidden", textOverflow: "ellipsis",
                              borderLeft: `2px solid ${entry.done ? "#059669" : accent}`,
                              textDecoration: entry.done ? "line-through" : "none",
                              opacity: entry.done ? 0.75 : 1,
                            }}
                            title={entry.detail_text || entry.title}
                          >
                            {entry.datum ? toLocalDateStr(entry.datum) : entry.title}
                          </div>
                        ))}
                        {/* Klick-Hint wenn leer */}
                        {cellEntries.length === 0 && (
                          <div style={{
                            fontSize: 9, color: subtle, opacity: 0, transition: "opacity 0.15s",
                            textAlign: "center", paddingTop: 4,
                          }}
                            className="cell-hint"
                          >
                            +
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}

            {/* Neue Zeile – direkt klicken auf leere Monatszelle */}
            <tr>
              <td style={{
                ...cellStyle, padding: "6px 10px", fontSize: 11, color: subtle,
                fontStyle: "italic", background: "transparent",
              }}>
                + neuer Eintrag
              </td>
              {MONTHS.map((_, mi) => {
                const month = mi + 1;
                return (
                  <td
                    key={month}
                    onClick={() => onCellClick(null, month)}
                    style={{ ...cellStyle, cursor: "pointer" }}
                    onMouseEnter={e => { e.currentTarget.style.background = isArtis ? "#f0f5f0" : "#f3f0fc"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                  />
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <style>{`
        td:hover .cell-hint { opacity: 1 !important; }
      `}</style>
    </div>
  );
}

// ── Hauptseite ────────────────────────────────────────────────────────────────

export default function Monatsplanung() {
  const { theme } = useContext(ThemeContext);
  const { profile } = useAuth();
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

  const [year, setYear]               = useState(new Date().getFullYear());
  const [plans, setPlans]             = useState([]);    // alle mp_plans
  const [entries, setEntries]         = useState([]);    // mp_entries für aktuellen Plan+Jahr
  const [customers, setCustomers]     = useState([]);    // alle Kunden mit ≥1 Plan
  const [allCustomers, setAllCustomers] = useState([]);  // alle Kunden (für "Neu"-Fall)
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [selectedPlanId, setSelectedPlanId]         = useState(null);
  const [modal, setModal]             = useState(null);  // { mode:"create"|"edit", entry?, month, title? }
  const [yearDialog, setYearDialog]   = useState(null);  // { from, to }
  const [loading, setLoading]         = useState(true);

  // ── Laden ────────────────────────────────────────────────────────────

  const loadPlans = useCallback(async () => {
    const { data, error } = await supabase.from("mp_plans").select("*").order("created_at");
    if (error) { toast.error(`Pläne: ${error.message}`); return; }
    setPlans(data || []);
    return data || [];
  }, []);

  const loadCustomers = useCallback(async (plansData) => {
    // Lade alle aktiven Kunden
    const { data: cData } = await supabase
      .from("customers")
      .select("id,company_name,aktiv")
      .or("aktiv.is.null,aktiv.eq.true")
      .order("company_name")
      .limit(3000);
    const all = cData || [];
    setAllCustomers(all);

    // Nur Kunden mit Plänen für Übersicht
    const usedIds = new Set((plansData || []).map(p => p.customer_id));
    setCustomers(all.filter(c => usedIds.has(c.id)));
  }, []);

  const loadEntries = useCallback(async (planId, yr) => {
    if (!planId) { setEntries([]); return; }
    const { data, error } = await supabase
      .from("mp_entries")
      .select("*")
      .eq("plan_id", planId)
      .eq("year", yr)
      .order("created_at");
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

  useEffect(() => {
    if (selectedPlanId) loadEntries(selectedPlanId, year);
  }, [selectedPlanId, year, loadEntries]);

  // ── Kunden/Plan wechseln ─────────────────────────────────────────────

  const handleSelectCustomer = (custId) => {
    setSelectedCustomerId(custId);
    const custPlans = plans.filter(p => p.customer_id === custId);
    if (custPlans.length > 0) {
      setSelectedPlanId(custPlans[0].id);
    } else {
      setSelectedPlanId(null);
    }
  };

  // ── Jahreswechsel ────────────────────────────────────────────────────

  const handleYearForward = () => {
    setYearDialog({ from: year, to: year + 1 });
  };

  const handleYearBack = () => {
    setYear(y => y - 1);
  };

  const confirmYearChange = async () => {
    const { from, to } = yearDialog;
    setYearDialog(null);

    // Alle Einträge des aktuellen Plans+Jahres kopieren
    if (selectedPlanId && entries.length > 0) {
      const { data: { user } } = await supabase.auth.getUser();
      const rows = entries.map(({ id, created_at, ...rest }) => ({
        ...rest, year: to, created_by: user?.id,
      }));
      const { error } = await supabase.from("mp_entries").insert(rows);
      if (error) { toast.error(`Übertragen fehlgeschlagen: ${error.message}`); return; }
      toast.success(`${rows.length} Einträge nach ${to} übertragen`);
    }
    setYear(to);
  };

  const cancelYearChange = () => {
    setYearDialog(null);
  };

  // ── Plan CRUD ────────────────────────────────────────────────────────

  const handleAddPlan = async () => {
    const name = window.prompt("Name des neuen Plans:");
    if (!name?.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("mp_plans")
      .insert({ customer_id: selectedCustomerId, name: name.trim(), created_by: user?.id })
      .select().single();
    if (error) { toast.error(error.message); return; }
    const updated = [...plans, data];
    setPlans(updated);
    setSelectedPlanId(data.id);
    // Kunden-Liste aktualisieren
    const usedIds = new Set(updated.map(p => p.customer_id));
    setCustomers(allCustomers.filter(c => usedIds.has(c.id)));
    toast.success("Plan erstellt ✓");
  };

  const handleRenamePlan = async (planId, newName) => {
    const { error } = await supabase.from("mp_plans").update({ name: newName }).eq("id", planId);
    if (error) { toast.error(error.message); return; }
    setPlans(prev => prev.map(p => p.id === planId ? { ...p, name: newName } : p));
  };

  const handleDeletePlan = async (planId) => {
    const { error } = await supabase.from("mp_plans").delete().eq("id", planId);
    if (error) { toast.error(error.message); return; }
    const updated = plans.filter(p => p.id !== planId);
    setPlans(updated);
    const usedIds = new Set(updated.map(p => p.customer_id));
    setCustomers(allCustomers.filter(c => usedIds.has(c.id)));
    // Nächsten Plan auswählen
    const remaining = updated.filter(p => p.customer_id === selectedCustomerId);
    setSelectedPlanId(remaining.length > 0 ? remaining[0].id : null);
    toast.success("Plan gelöscht");
  };

  // ── Eintrag CRUD ─────────────────────────────────────────────────────

  const handleCellClick = (prefillTitle, month) => {
    setModal({ mode: "create", month, prefillTitle });
  };

  const handleEntryClick = (entry) => {
    setModal({ mode: "edit", entry, month: entry.month });
  };

  const handleSaveEntry = async (form) => {
    const { title, detail_text, datum, done } = form;
    const { data: { user } } = await supabase.auth.getUser();

    if (modal.mode === "create") {
      const { data, error } = await supabase.from("mp_entries").insert({
        plan_id: selectedPlanId,
        title,
        year,
        month: modal.month,
        detail_text,
        datum: datum || null,
        done,
        created_by: user?.id,
      }).select().single();
      if (error) { toast.error(error.message); return; }
      setEntries(prev => [...prev, data]);
      toast.success("Eintrag erstellt ✓");
    } else {
      const { data, error } = await supabase.from("mp_entries")
        .update({ title, detail_text, datum: datum || null, done })
        .eq("id", modal.entry.id)
        .select().single();
      if (error) { toast.error(error.message); return; }
      setEntries(prev => prev.map(e => e.id === modal.entry.id ? data : e));
      toast.success("Gespeichert ✓");
    }
    setModal(null);
  };

  const handleDeleteEntry = async (entryId) => {
    const { error } = await supabase.from("mp_entries").delete().eq("id", entryId);
    if (error) { toast.error(error.message); return; }
    setEntries(prev => prev.filter(e => e.id !== entryId));
    setModal(null);
    toast.success("Gelöscht");
  };

  // ── Neuen Kunden + Plan anlegen ──────────────────────────────────────

  const handleNewCustomerPlan = async () => {
    // Öffne Kunden-Auswahl aus allen Kunden
    const name = window.prompt(
      "Kunden-Name eingeben (oder wähle zuerst einen Kunden aus der Liste und klicke dann '+ Plan'):"
    );
    if (!name?.trim()) return;
    // Suche in allen Kunden
    const match = allCustomers.find(c =>
      (c.company_name || "").toLowerCase().includes(name.toLowerCase())
    );
    if (!match) { toast.error("Kunde nicht gefunden. Bitte Kunden zuerst in der Kundenverwaltung anlegen."); return; }

    const planName = window.prompt(`Plan-Name für "${match.company_name}":`);
    if (!planName?.trim()) return;

    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("mp_plans")
      .insert({ customer_id: match.id, name: planName.trim(), created_by: user?.id })
      .select().single();
    if (error) { toast.error(error.message); return; }

    const updated = [...plans, data];
    setPlans(updated);
    const usedIds = new Set(updated.map(p => p.customer_id));
    setCustomers(allCustomers.filter(c => usedIds.has(c.id)));
    setSelectedCustomerId(match.id);
    setSelectedPlanId(data.id);
    toast.success(`Plan "${planName}" für ${match.company_name} erstellt ✓`);
  };

  // ── Derived ──────────────────────────────────────────────────────────

  const plansByCustomer = useMemo(() => {
    const m = {};
    for (const p of plans) {
      if (!m[p.customer_id]) m[p.customer_id] = [];
      m[p.customer_id].push(p);
    }
    return m;
  }, [plans]);

  const custPlans = useMemo(() =>
    plans.filter(p => p.customer_id === selectedCustomerId),
  [plans, selectedCustomerId]);

  const selectedPlan = plans.find(p => p.id === selectedPlanId);

  const existingTitles = useMemo(() => {
    const titles = new Set(entries.map(e => e.title));
    return [...titles];
  }, [entries]);

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", backgroundColor: pageBg, overflow: "hidden" }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div style={{
        padding: "9px 18px", borderBottom: `1px solid ${border}`,
        display: "flex", alignItems: "center", gap: 10,
        backgroundColor: cardBg, flexShrink: 0, flexWrap: "wrap",
      }}>
        <CalendarRange size={16} style={{ color: accent }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: text }}>Monatsplanung</span>

        <div style={{ width: 1, height: 18, background: border, margin: "0 4px" }} />

        {/* Kunden-Selector */}
        <KundenSelector
          customers={allCustomers}
          selectedId={selectedCustomerId}
          onSelect={handleSelectCustomer}
          colors={colors}
        />

        {/* Neuer Kunde/Plan Button */}
        <button
          onClick={handleNewCustomerPlan}
          title="Neuen Kunden mit Plan anlegen"
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "5px 10px", border: `1px dashed ${border}`, borderRadius: 7,
            background: "transparent", color: subtle, fontSize: 12, cursor: "pointer",
          }}
        >
          <Plus size={11} /> Neuer Kunde
        </button>

        {/* Plan-Tabs – nur wenn Kunde ausgewählt */}
        {selectedCustomerId && (
          <>
            <div style={{ width: 1, height: 18, background: border, margin: "0 4px" }} />
            <PlanTabs
              plans={custPlans}
              selectedPlanId={selectedPlanId}
              onSelect={setSelectedPlanId}
              onAdd={handleAddPlan}
              onRename={handleRenamePlan}
              onDelete={handleDeletePlan}
              colors={colors}
            />
          </>
        )}

        {/* Jahr – nur wenn Plan ausgewählt */}
        {selectedPlanId && (
          <>
            <div style={{ width: 1, height: 18, background: border, margin: "0 4px" }} />
            <div style={{
              display: "flex", alignItems: "center", gap: 2,
              backgroundColor: pageBg, borderRadius: 7,
              border: `1px solid ${border}`, padding: "1px 2px",
            }}>
              <button
                onClick={handleYearBack}
                style={{ padding: "2px 8px", border: "none", background: "none", color: subtle, cursor: "pointer", fontSize: 15, borderRadius: 5 }}
              >
                ‹
              </button>
              <span style={{ fontSize: 13, fontWeight: 800, color: text, minWidth: 40, textAlign: "center" }}>
                {year}
              </span>
              <button
                onClick={handleYearForward}
                style={{ padding: "2px 8px", border: "none", background: "none", color: subtle, cursor: "pointer", fontSize: 15, borderRadius: 5 }}
              >
                ›
              </button>
            </div>
          </>
        )}

        <button
          onClick={loadAll}
          title="Aktualisieren"
          style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: subtle, padding: 4, borderRadius: 5 }}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: subtle, fontSize: 13 }}>
          Lade…
        </div>
      ) : !selectedPlanId ? (
        <Uebersicht
          customersWithPlans={customers}
          plansByCustomer={plansByCustomer}
          onSelectCustomer={handleSelectCustomer}
          colors={colors}
        />
      ) : (
        <PlanGrid
          plan={selectedPlan}
          entries={entries}
          year={year}
          onCellClick={handleCellClick}
          onEntryClick={handleEntryClick}
          colors={colors}
        />
      )}

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {modal && (
        <EntryModal
          mode={modal.mode}
          entry={modal.entry}
          planId={selectedPlanId}
          month={modal.month}
          year={year}
          existingTitles={existingTitles}
          onSave={handleSaveEntry}
          onDelete={handleDeleteEntry}
          onClose={() => setModal(null)}
          colors={colors}
        />
      )}

      {yearDialog && (
        <YearChangeDialog
          fromYear={yearDialog.from}
          toYear={yearDialog.to}
          onConfirm={confirmYearChange}
          onCancel={cancelYearChange}
          colors={colors}
        />
      )}
    </div>
  );
}
