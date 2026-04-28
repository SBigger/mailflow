import React, { useState, useEffect, useMemo, useContext, useRef, useCallback } from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { ThemeContext } from "@/Layout";
import { supabase } from "@/api/supabaseClient";
import {
  ChevronDown, ChevronRight, X, Clock, Search, Calendar, Users, Trash2, RefreshCw
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { toast } from "sonner";

// ── Constants ────────────────────────────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];

const ACTIVITIES = [
  { id: "mwst",            label: "MwSt Abr.",      color: "#2563eb", bg: "#dbeafe" },
  { id: "jahresabschluss", label: "Jahresabschluss", color: "#7c3aed", bg: "#ede9fe" },
  { id: "steuererklarung", label: "Steuererklärung", color: "#b45309", bg: "#fef3c7" },
  { id: "lohn",            label: "Lohn",            color: "#059669", bg: "#d1fae5" },
  { id: "reporting",       label: "Reporting",       color: "#dc2626", bg: "#fee2e2" },
];
const ACT = Object.fromEntries(ACTIVITIES.map(a => [a.id, a]));

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Jahresplanung() {
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

  const colors = { pageBg, cardBg, border, text, subtle, accent, headerBg };

  const [year, setYear]           = useState(new Date().getFullYear());
  const [staff, setStaff]         = useState([]);
  const [customers, setCustomers] = useState([]);
  const [entries, setEntries]     = useState([]);
  const [collapsed, setCollapsed] = useState({});
  const [search, setSearch]       = useState("");
  const [modal, setModal]         = useState(null);
  const searchRef = useRef(null);

  // Load
  const loadAll = useCallback(async () => {
    const [{ data: s }, { data: c }, { data: e }] = await Promise.all([
      supabase.from("profiles").select("id,full_name,email").order("full_name"),
      supabase.from("customers").select("id,company_name").order("company_name").limit(3000),
      supabase.from("jahresplanung").select("*").eq("year", year),
    ]);
    setStaff(s || []);
    setCustomers(c || []);
    setEntries(e || []);
  }, [year]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Ctrl+F
  useEffect(() => {
    const h = (e) => { if (e.ctrlKey && e.key === "f") { e.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Derived data
  const entryMap = useMemo(() => {
    const m = {};
    for (const e of entries) {
      const k = `${e.assigned_to}|${e.month}`;
      if (!m[k]) m[k] = [];
      m[k].push(e);
    }
    return m;
  }, [entries]);

  const custMap = useMemo(() =>
    Object.fromEntries(customers.map(c => [c.id, c])), [customers]);

  const hoursMap = useMemo(() => {
    const m = {};
    for (const e of entries) {
      const k = `${e.assigned_to}|${e.month}`;
      m[k] = (m[k] || 0) + (parseFloat(e.hours) || 0);
    }
    return m;
  }, [entries]);

  const filteredCustomers = useMemo(() => {
    if (!search) return customers;
    const q = search.toLowerCase();
    return customers.filter(c => (c.company_name || "").toLowerCase().includes(q));
  }, [customers, search]);

  // DnD
  const onDragEnd = useCallback(async (result) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId) return;

    const parts = destination.droppableId.split("|");
    if (parts[0] !== "cell") return;
    const destStaffId = parts[1];
    const destMonth   = parseInt(parts[2]);

    if (source.droppableId === "customers") {
      // New entry
      const customerId = draggableId.replace("cust|", "");
      setModal({ mode: "create", customerId, staffId: destStaffId, month: destMonth });
    } else {
      // Move existing
      const entryId = draggableId.replace("entry|", "");
      setEntries(prev => prev.map(e =>
        e.id === entryId ? { ...e, assigned_to: destStaffId, month: destMonth } : e
      ));
      const { error } = await supabase
        .from("jahresplanung")
        .update({ assigned_to: destStaffId, month: destMonth })
        .eq("id", entryId);
      if (error) { toast.error("Fehler beim Verschieben"); loadAll(); }
      else toast.success("Verschoben");
    }
  }, [loadAll]);

  // Save new entry
  const saveEntry = async (form) => {
    const { customerId, staffId, month, activityType, hours, notes, recurring, recurringType, recurringMonths } = form;
    const monthsToCreate =
      !recurring         ? [month] :
      recurringType === "monthly"   ? [1,2,3,4,5,6,7,8,9,10,11,12] :
      recurringType === "quarterly" ? [1,4,7,10] :
      recurringMonths.length        ? recurringMonths : [month];

    const { data: { user } } = await supabase.auth.getUser();
    const groupId = recurring ? crypto.randomUUID() : null;

    const rows = monthsToCreate.map(m => ({
      customer_id: customerId,
      assigned_to: staffId,
      year,
      month: m,
      activity_type: activityType,
      hours: hours ? parseFloat(hours) : null,
      notes: notes || null,
      recurring_group_id: groupId,
      created_by: user?.id,
    }));

    const { data, error } = await supabase.from("jahresplanung").insert(rows).select();
    if (error) { toast.error(error.message); return; }
    setEntries(prev => [...prev, ...data]);
    setModal(null);
    toast.success(recurring ? `${data.length} Einträge erstellt` : "Eingeplant ✓");
  };

  // Update entry
  const updateEntry = async (id, patch) => {
    const { data, error } = await supabase.from("jahresplanung").update(patch).eq("id", id).select().single();
    if (error) { toast.error(error.message); return; }
    setEntries(prev => prev.map(e => e.id === id ? data : e));
    setModal(null);
    toast.success("Gespeichert ✓");
  };

  // Delete entry
  const deleteEntry = async (id) => {
    const { error } = await supabase.from("jahresplanung").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setEntries(prev => prev.filter(e => e.id !== id));
    setModal(null);
    toast.success("Gelöscht");
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", backgroundColor: pageBg, overflow: "hidden" }}>
      {/* ── Header ── */}
      <div style={{
        padding: "10px 20px", borderBottom: `1px solid ${border}`,
        display: "flex", alignItems: "center", gap: 12,
        backgroundColor: cardBg, flexShrink: 0,
      }}>
        <Calendar size={17} style={{ color: accent }} />
        <span style={{ fontSize: 15, fontWeight: 700, color: text }}>Jahresplanung</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
          <button onClick={() => setYear(y => y - 1)} style={btnStyle(border, subtle)}>‹</button>
          <span style={{ fontSize: 14, fontWeight: 700, color: text, minWidth: 44, textAlign: "center" }}>{year}</span>
          <button onClick={() => setYear(y => y + 1)} style={btnStyle(border, subtle)}>›</button>
        </div>
        <button onClick={loadAll} title="Aktualisieren" style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: subtle, padding: 4 }}>
          <RefreshCw size={14} />
        </button>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <DragDropContext onDragEnd={onDragEnd}>

          {/* LEFT: Customer Sidebar */}
          <div style={{
            width: 210, flexShrink: 0, borderRight: `1px solid ${border}`,
            display: "flex", flexDirection: "column", backgroundColor: cardBg,
          }}>
            <div style={{ padding: "8px 10px", borderBottom: `1px solid ${border}` }}>
              <div style={{ position: "relative" }}>
                <Search size={11} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: subtle }} />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Suchen… (Ctrl+F)"
                  style={{
                    width: "100%", paddingLeft: 24, paddingRight: 6, paddingTop: 5, paddingBottom: 5,
                    fontSize: 11.5, borderRadius: 6, border: `1px solid ${border}`,
                    background: pageBg, color: text, outline: "none", boxSizing: "border-box",
                  }}
                />
              </div>
              <div style={{ fontSize: 10, color: subtle, marginTop: 4, textAlign: "center" }}>
                Ziehen → Mitarbeiter & Monat
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "6px 6px" }}>
              <Droppable droppableId="customers" isDropDisabled={true}>
                {(provided) => (
                  <div ref={provided.innerRef} {...provided.droppableProps}>
                    {filteredCustomers.map((c, idx) => (
                      <Draggable key={c.id} draggableId={`cust|${c.id}`} index={idx}>
                        {(drag, snap) => (
                          <div
                            ref={drag.innerRef}
                            {...drag.draggableProps}
                            {...drag.dragHandleProps}
                            style={{
                              ...drag.draggableProps.style,
                              padding: "5px 8px", marginBottom: 1,
                              borderRadius: 5, fontSize: 11.5, color: text,
                              backgroundColor: snap.isDragging ? (isArtis ? "#e6ede6" : "#ede9fe") : "transparent",
                              border: `1px solid ${snap.isDragging ? accent : "transparent"}`,
                              cursor: "grab", whiteSpace: "nowrap",
                              overflow: "hidden", textOverflow: "ellipsis", userSelect: "none",
                            }}
                          >
                            {c.company_name}
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          </div>

          {/* RIGHT: Planning Grid */}
          <div style={{ flex: 1, overflowX: "auto", overflowY: "auto" }}>
            <div style={{ minWidth: 1100, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
              {staff.map(s => {
                const isOpen     = !collapsed[s.id];
                const totalHours = Array.from({ length: 12 }, (_, i) => hoursMap[`${s.id}|${i+1}`] || 0)
                                        .reduce((a, b) => a + b, 0);
                const initials   = (s.full_name || s.email || "?").slice(0, 2).toUpperCase();

                return (
                  <div key={s.id} style={{ borderRadius: 10, border: `1px solid ${border}`, overflow: "hidden", backgroundColor: cardBg }}>
                    {/* Staff header */}
                    <div
                      onClick={() => setCollapsed(c => ({ ...c, [s.id]: !c[s.id] }))}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "9px 14px",
                        backgroundColor: headerBg, cursor: "pointer", userSelect: "none",
                      }}
                    >
                      {isOpen
                        ? <ChevronDown size={13} style={{ color: subtle, flexShrink: 0 }} />
                        : <ChevronRight size={13} style={{ color: subtle, flexShrink: 0 }} />
                      }
                      <div style={{
                        width: 28, height: 28, borderRadius: "50%",
                        backgroundColor: accent, color: "#fff",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, fontWeight: 700, flexShrink: 0,
                      }}>
                        {initials}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: text, flex: 1 }}>
                        {s.full_name || s.email}
                      </span>
                      <span style={{ fontSize: 11, color: subtle, display: "flex", alignItems: "center", gap: 4 }}>
                        {totalHours > 0 && <><Clock size={10} />{totalHours}h {year}</>}
                      </span>
                    </div>

                    {/* Month grid */}
                    {isOpen && (
                      <>
                        {/* Month header row */}
                        <div style={{ display: "flex", borderBottom: `1px solid ${border}`, backgroundColor: pageBg }}>
                          {MONTHS.map((m, mi) => (
                            <div key={mi} style={{
                              flex: "1 0 0", minWidth: 80, padding: "4px 6px",
                              textAlign: "center", fontSize: 10.5, fontWeight: 700,
                              color: subtle, letterSpacing: ".06em",
                              borderRight: mi < 11 ? `1px solid ${border}` : "none",
                            }}>
                              {m}
                            </div>
                          ))}
                        </div>

                        {/* Droppable cells */}
                        <div style={{ display: "flex" }}>
                          {Array.from({ length: 12 }, (_, mi) => {
                            const month      = mi + 1;
                            const key        = `${s.id}|${month}`;
                            const cellEnts   = entryMap[key] || [];
                            const cellHours  = hoursMap[key] || 0;

                            return (
                              <Droppable key={month} droppableId={`cell|${s.id}|${month}`}>
                                {(prov, snap) => (
                                  <div
                                    ref={prov.innerRef}
                                    {...prov.droppableProps}
                                    style={{
                                      flex: "1 0 0", minWidth: 80, minHeight: 90,
                                      borderRight: mi < 11 ? `1px solid ${border}` : "none",
                                      padding: "4px 4px",
                                      backgroundColor: snap.isDraggingOver
                                        ? (isArtis ? "#d4ead4" : "#ede9fe")
                                        : "transparent",
                                      transition: "background-color 0.12s",
                                      display: "flex", flexDirection: "column", gap: 3,
                                    }}
                                  >
                                    {cellEnts.map((entry, eidx) => {
                                      const act  = ACT[entry.activity_type] || ACTIVITIES[0];
                                      const cust = custMap[entry.customer_id];
                                      return (
                                        <Draggable key={entry.id} draggableId={`entry|${entry.id}`} index={eidx}>
                                          {(eDrag, eSnap) => (
                                            <div
                                              ref={eDrag.innerRef}
                                              {...eDrag.draggableProps}
                                              {...eDrag.dragHandleProps}
                                              onClick={() => setModal({ mode: "edit", entry })}
                                              style={{
                                                ...eDrag.draggableProps.style,
                                                backgroundColor: act.bg,
                                                borderLeft: `3px solid ${act.color}`,
                                                borderTop: `1px solid ${act.color}22`,
                                                borderRight: `1px solid ${act.color}22`,
                                                borderBottom: `1px solid ${act.color}22`,
                                                borderRadius: 5,
                                                padding: "3px 5px",
                                                cursor: "grab",
                                                lineHeight: 1.35,
                                                boxShadow: eSnap.isDragging ? "0 3px 10px rgba(0,0,0,0.18)" : "none",
                                              }}
                                            >
                                              <div style={{ fontSize: 10, fontWeight: 700, color: act.color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                {act.label}
                                              </div>
                                              <div style={{ fontSize: 10, color: "#444", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                {cust?.company_name || "–"}
                                              </div>
                                              {entry.hours != null && (
                                                <div style={{ fontSize: 9.5, color: "#666" }}>{entry.hours}h</div>
                                              )}
                                            </div>
                                          )}
                                        </Draggable>
                                      );
                                    })}
                                    {prov.placeholder}

                                    {/* Hour total footer */}
                                    {cellHours > 0 && (
                                      <div style={{
                                        marginTop: "auto", fontSize: 9.5, color: subtle,
                                        textAlign: "center", paddingTop: 2,
                                        borderTop: `1px solid ${border}`,
                                      }}>
                                        Σ {cellHours}h
                                      </div>
                                    )}
                                  </div>
                                )}
                              </Droppable>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

        </DragDropContext>
      </div>

      {/* Modal */}
      {modal && (
        <ActivityModal
          modal={modal}
          onClose={() => setModal(null)}
          staff={staff}
          custMap={custMap}
          onSave={saveEntry}
          onUpdate={updateEntry}
          onDelete={deleteEntry}
          colors={colors}
        />
      )}
    </div>
  );
}

// ── Activity Modal ────────────────────────────────────────────────────────────

function ActivityModal({ modal, onClose, staff, custMap, onSave, onUpdate, onDelete, colors }) {
  const { cardBg, border, text, subtle, accent, pageBg } = colors;
  const isEdit = modal.mode === "edit";
  const entry  = isEdit ? modal.entry : null;

  const [activityType,    setActivityType]    = useState(entry?.activity_type || "jahresabschluss");
  const [hours,           setHours]           = useState(entry?.hours != null ? String(entry.hours) : "");
  const [notes,           setNotes]           = useState(entry?.notes || "");
  const [staffId,         setStaffId]         = useState(entry?.assigned_to || modal.staffId || "");
  const [month,           setMonth]           = useState(entry?.month || modal.month || 1);
  const [recurring,       setRecurring]       = useState(false);
  const [recurringType,   setRecurringType]   = useState("monthly");
  const [recurringMonths, setRecurringMonths] = useState([1,2,3,4,5,6,7,8,9,10,11,12]);

  const customerId = isEdit ? entry.customer_id : modal.customerId;
  const customer   = custMap[customerId];

  const toggleMonth = (m) =>
    setRecurringMonths(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m].sort((a, b) => a - b));

  const handleSave = () => {
    if (!activityType || !staffId) return;
    if (isEdit) {
      onUpdate(entry.id, {
        activity_type: activityType,
        hours: hours !== "" ? parseFloat(hours) : null,
        notes: notes || null,
        assigned_to: staffId,
        month,
      });
    } else {
      onSave({ customerId, staffId, month, activityType, hours, notes, recurring, recurringType, recurringMonths });
    }
  };

  const inp = {
    style: {
      width: "100%", padding: "6px 9px", fontSize: 12.5, borderRadius: 6,
      border: `1px solid ${border}`, backgroundColor: pageBg, color: text,
      outline: "none", boxSizing: "border-box",
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: 14, padding: 24, width: 400, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.25)" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: text }}>
            {isEdit ? "Aktivität bearbeiten" : "Aktivität einplanen"}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: subtle, padding: 2 }}>
            <X size={16} />
          </button>
        </div>

        {/* Customer (read-only) */}
        <Field label="KUNDE" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: text, padding: "6px 9px", backgroundColor: pageBg, borderRadius: 6, border: `1px solid ${border}` }}>
            {customer?.company_name || "–"}
          </div>
        </Field>

        {/* Mitarbeiter + Monat */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle(subtle)}>MITARBEITER</label>
            <select value={staffId} onChange={e => setStaffId(e.target.value)} style={{ ...inp.style, marginTop: 4 }}>
              {staff.map(s => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
            </select>
          </div>
          {!recurring && (
            <div style={{ width: 88 }}>
              <label style={labelStyle(subtle)}>MONAT</label>
              <select value={month} onChange={e => setMonth(parseInt(e.target.value))} style={{ ...inp.style, marginTop: 4 }}>
                {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Activity type */}
        <Field label="TÄTIGKEIT" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            {ACTIVITIES.map(a => (
              <button
                key={a.id}
                onClick={() => setActivityType(a.id)}
                style={{
                  padding: "5px 11px", fontSize: 11.5, borderRadius: 20, cursor: "pointer",
                  backgroundColor: activityType === a.id ? a.bg : "transparent",
                  color: activityType === a.id ? a.color : subtle,
                  border: activityType === a.id ? `1.5px solid ${a.color}` : `1px solid ${border}`,
                  fontWeight: activityType === a.id ? 700 : 400,
                  transition: "all 0.12s",
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        </Field>

        {/* Hours */}
        <Field label="STUNDEN (optional)" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            <Clock size={13} style={{ color: subtle, flexShrink: 0 }} />
            <input
              type="number" step="0.5" min="0" value={hours}
              onChange={e => setHours(e.target.value)}
              placeholder="z.B. 8"
              {...inp}
              style={{ ...inp.style, flex: 1 }}
            />
            <span style={{ fontSize: 12, color: subtle }}>h</span>
          </div>
        </Field>

        {/* Notes */}
        <Field label="NOTIZ (optional)" style={{ marginBottom: 12 }}>
          <input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="z.B. Jahresabschluss 2025"
            {...inp}
            style={{ ...inp.style, marginTop: 4 }}
          />
        </Field>

        {/* Recurring (create only) */}
        {!isEdit && (
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={recurring} onChange={e => setRecurring(e.target.checked)} style={{ width: 14, height: 14, accentColor: accent }} />
              <span style={{ fontSize: 12.5, color: text, fontWeight: 500 }}>Wiederkehrend</span>
              <RefreshCw size={12} style={{ color: subtle }} />
            </label>

            {recurring && (
              <div style={{ marginTop: 10, marginLeft: 22 }}>
                <div style={{ display: "flex", gap: 14, marginBottom: 10 }}>
                  {[["monthly","Monatlich"],["quarterly","Quartalsweise"],["custom","Monate wählen"]].map(([v, l]) => (
                    <label key={v} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 12, color: recurringType === v ? accent : subtle, fontWeight: recurringType === v ? 600 : 400 }}>
                      <input type="radio" name="rectype" value={v} checked={recurringType === v} onChange={() => setRecurringType(v)} style={{ accentColor: accent }} />
                      {l}
                    </label>
                  ))}
                </div>
                {recurringType === "custom" && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {MONTHS.map((m, i) => (
                      <button
                        key={i}
                        onClick={() => toggleMonth(i + 1)}
                        style={{
                          padding: "3px 9px", fontSize: 11, borderRadius: 5, cursor: "pointer",
                          backgroundColor: recurringMonths.includes(i + 1) ? accent : "transparent",
                          color: recurringMonths.includes(i + 1) ? "#fff" : subtle,
                          border: `1px solid ${recurringMonths.includes(i + 1) ? accent : border}`,
                          fontWeight: recurringMonths.includes(i + 1) ? 600 : 400,
                        }}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
          {isEdit && (
            <button
              onClick={() => onDelete(entry.id)}
              style={{ padding: "7px 12px", fontSize: 12, borderRadius: 7, border: "1px solid #fca5a5", backgroundColor: "transparent", color: "#dc2626", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
            >
              <Trash2 size={12} /> Löschen
            </button>
          )}
          <button
            onClick={onClose}
            style={{ padding: "7px 14px", fontSize: 12, borderRadius: 7, border: `1px solid ${border}`, backgroundColor: "transparent", color: subtle, cursor: "pointer" }}
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={!activityType}
            style={{ padding: "7px 16px", fontSize: 12, borderRadius: 7, border: "none", backgroundColor: accent, color: "#fff", cursor: "pointer", fontWeight: 600 }}
          >
            {isEdit ? "Speichern" : recurring ? `${
              recurringType === "monthly" ? 12 :
              recurringType === "quarterly" ? 4 :
              recurringMonths.length
            } Einträge erstellen` : "Einplanen"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Field({ label, children, style }) {
  return <div style={style}><label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", color: "#888", display: "block" }}>{label}</label>{children}</div>;
}

function labelStyle(subtle) {
  return { fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", color: subtle, display: "block", marginBottom: 4 };
}

function btnStyle(border, subtle) {
  return {
    padding: "2px 10px", borderRadius: 6, border: `1px solid ${border}`,
    background: "transparent", color: subtle, cursor: "pointer", fontSize: 14, lineHeight: 1,
  };
}
