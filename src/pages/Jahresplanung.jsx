import React, { useState, useEffect, useMemo, useContext, useRef, useCallback } from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { ThemeContext } from "@/Layout";
import { supabase } from "@/api/supabaseClient";
import {
  ChevronDown, ChevronRight, X, Clock, Search, Calendar, Trash2, RefreshCw, Info, UserCheck,
  LayoutGrid, BarChart2, CheckCircle2, Circle, Copy
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { toast } from "sonner";

// ── Constants ────────────────────────────────────────────────────────────────

const MONTHS     = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
const MONTHS_LONG = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
const DAY_NAMES  = ["So","Mo","Di","Mi","Do","Fr","Sa"];
const HOURS_PER_DAY = 8.3;

const ACTIVITIES = [
  { id: "mwst",            label: "MwSt Abr.",      color: "#2563eb", bg: "#dbeafe" },
  { id: "jahresabschluss", label: "Jahresabschluss", color: "#7c3aed", bg: "#ede9fe" },
  { id: "steuererklarung", label: "Steuererklärung", color: "#b45309", bg: "#fef3c7" },
  { id: "lohn",            label: "Lohn",            color: "#059669", bg: "#d1fae5" },
  { id: "reporting",       label: "Reporting",       color: "#dc2626", bg: "#fee2e2" },
];
const ACT = Object.fromEntries(ACTIVITIES.map(a => [a.id, a]));

// ── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function getWorkingDays(year, month) {
  const days = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    const dow = d.getDay();
    if (dow >= 1 && dow <= 5) days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Jahresplanung() {
  const { theme } = useContext(ThemeContext);
  const { profile } = useAuth();
  const isArtis = theme === "artis";
  const isLight = theme === "light";

  const pageBg    = isArtis ? "#f2f5f2" : isLight ? "#f4f4f8" : "#1a1a1f";
  const cardBg    = isArtis ? "#fff"    : isLight ? "#fff"    : "#2a2a30";
  const border    = isArtis ? "#dde8dd" : isLight ? "#e4e4ea" : "#3f3f46";
  const text      = isArtis ? "#1a2a1a" : isLight ? "#1a1a2e" : "#e4e4e7";
  const subtle    = isArtis ? "#6b826b" : isLight ? "#8080a0" : "#9090b8";
  const accent    = isArtis ? "#4d6a50" : "#5b21b6";
  const headerBg  = isArtis ? "#e6ede6" : isLight ? "#eef0fb" : "#27272c";
  const colors = { pageBg, cardBg, border, text, subtle, accent, headerBg, isArtis, isLight };

  const [year, setYear]             = useState(new Date().getFullYear());
  const [staff, setStaff]           = useState([]);
  const [customers, setCustomers]   = useState([]);
  const [entries, setEntries]       = useState([]);
  const [feiertage, setFeiertage]   = useState([]); // { id, date, hours, notes }
  const [collapsed, setCollapsed]   = useState({});
  const [search, setSearch]         = useState("");
  const [myClientsOnly, setMyClientsOnly] = useState(true); // default: nur eigene Kunden
  const [activeTab, setActiveTab]   = useState("planung"); // "planung" | "kapazitaet"
  const [modal, setModal]           = useState(null);
  const [sollModal, setSollModal]   = useState(null); // month number
  const searchRef = useRef(null);
  const collapsedInitialized = useRef(false);

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    // Run queries independently so a failed jp_feiertage doesn't block customers/staff
    const [sRes, cRes, eRes, fRes] = await Promise.all([
      supabase.from("profiles").select("id,full_name,email").order("full_name"),
      supabase.from("customers").select("id,company_name,aktiv,mandatsleiter_id,sachbearbeiter_id")
        .or("aktiv.is.null,aktiv.eq.true").order("company_name").limit(3000),
      supabase.from("jahresplanung").select("*").eq("year", year),
      supabase.from("jp_feiertage").select("*").gte("date", `${year}-01-01`).lte("date", `${year}-12-31`),
    ]);

    if (sRes.error) toast.error(`Mitarbeiter: ${sRes.error.message}`);
    if (cRes.error) toast.error(`Kunden: ${cRes.error.message}`);
    if (eRes.error) toast.error(`Jahresplanung: ${eRes.error.message}`);
    // jp_feiertage error is non-fatal (table might not exist yet)
    if (fRes.error) console.warn("jp_feiertage:", fRes.error.message);

    const staffData = sRes.data || [];
    const custData  = cRes.data || [];
    let   entryData = eRes.data || [];
    const feierData = fRes.data || [];

    // Auto carry-forward from previous year if this year is empty
    if (entryData.length === 0 && year > 2026) {
      const { data: prev } = await supabase.from("jahresplanung").select("*").eq("year", year - 1);
      if (prev && prev.length > 0) {
        const { data: { user } } = await supabase.auth.getUser();
        const rows = prev.map(({ id, created_at, ...rest }) => ({ ...rest, year }));
        const { data: copied } = await supabase.from("jahresplanung").insert(rows).select();
        if (copied) {
          entryData = copied;
          toast.success(`Planung von ${year - 1} wurde für ${year} übernommen`);
        }
      }
    }

    setStaff(staffData);
    setCustomers(custData);
    setEntries(entryData);
    setFeiertage(feierData);
  }, [year]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Auto-migrate: add done column etc. silently on first mount
  useEffect(() => {
    supabase.functions.invoke("setup-jahresplanung").catch(() => {});
  }, []);

  // Ctrl+F
  useEffect(() => {
    const h = (e) => { if (e.ctrlKey && e.key === "f") { e.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Default: current user expanded, others collapsed (first load only)
  useEffect(() => {
    if (staff.length > 0 && profile?.id && !collapsedInitialized.current) {
      collapsedInitialized.current = true;
      const init = {};
      staff.forEach(s => { if (s.id !== profile.id) init[s.id] = true; });
      setCollapsed(init);
    }
  }, [staff, profile?.id]);

  // ── Derived data ─────────────────────────────────────────────────────────

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
    let list = customers;
    // Meine Kunden Filter: nur wo current user Mandatsleiter ODER Sachbearbeiter ist
    if (myClientsOnly && profile?.id) {
      list = list.filter(c =>
        c.mandatsleiter_id === profile.id || c.sachbearbeiter_id === profile.id
      );
    }
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter(c => (c.company_name || "").toLowerCase().includes(q));
  }, [customers, search, myClientsOnly, profile?.id]);

  // Sorted staff – current user first
  const orderedStaff = useMemo(() => {
    if (!profile?.id) return staff;
    return [...staff].sort((a, b) => {
      if (a.id === profile.id) return -1;
      if (b.id === profile.id) return 1;
      return (a.full_name || a.email || "").localeCompare(b.full_name || b.email || "");
    });
  }, [staff, profile?.id]);

  // Sollstunden per month (working days × 8.3h − feiertage)
  const feierSet = useMemo(() => new Set(feiertage.map(f => f.date)), [feiertage]);

  const sollMap = useMemo(() => {
    const m = {};
    for (let mo = 1; mo <= 12; mo++) {
      const days = getWorkingDays(year, mo);
      const actual = days.filter(d => !feierSet.has(toDateStr(d)));
      m[mo] = Math.round(actual.length * HOURS_PER_DAY * 10) / 10;
    }
    return m;
  }, [year, feierSet]);

  // ── DnD ──────────────────────────────────────────────────────────────────

  const onDragEnd = useCallback(async (result) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId) return;

    const parts = destination.droppableId.split("|");
    if (parts[0] !== "cell") return;
    const destStaffId = parts[1];
    const destMonth   = parseInt(parts[2]);

    if (source.droppableId === "customers") {
      const customerId = draggableId.replace("cust|", "");
      setModal({ mode: "create", customerId, staffId: destStaffId, month: destMonth });
    } else {
      const entryId = draggableId.replace("entry|", "");
      setEntries(prev => prev.map(e =>
        e.id === entryId ? { ...e, assigned_to: destStaffId, month: destMonth } : e
      ));
      const { error } = await supabase.from("jahresplanung")
        .update({ assigned_to: destStaffId, month: destMonth }).eq("id", entryId);
      if (error) { toast.error("Fehler beim Verschieben"); loadAll(); }
      else toast.success("Verschoben");
    }
  }, [loadAll]);

  // ── CRUD ─────────────────────────────────────────────────────────────────

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
      customer_id: customerId, assigned_to: staffId, year, month: m,
      activity_type: activityType,
      hours: hours ? parseFloat(hours) : null,
      notes: notes || null,
      recurring_group_id: groupId, created_by: user?.id,
    }));

    const { data, error } = await supabase.from("jahresplanung").insert(rows).select();
    if (error) { toast.error(error.message); return; }
    setEntries(prev => [...prev, ...data]);
    setModal(null);
    toast.success(recurring ? `${data.length} Einträge erstellt` : "Eingeplant ✓");
  };

  const updateEntry = async (id, patch) => {
    const { data, error } = await supabase.from("jahresplanung").update(patch).eq("id", id).select().single();
    if (error) { toast.error(error.message); return; }
    setEntries(prev => prev.map(e => e.id === id ? data : e));
    setModal(null);
    toast.success("Gespeichert ✓");
  };

  const deleteEntry = async (id) => {
    const { error } = await supabase.from("jahresplanung").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setEntries(prev => prev.filter(e => e.id !== id));
    setModal(null);
  };

  // ── Done-Toggle (optimistic) ──────────────────────────────────────────────

  const toggleDone = useCallback(async (entryId, currentDone, e) => {
    e?.stopPropagation();
    const newDone = !currentDone;
    setEntries(prev => prev.map(en => en.id === entryId ? { ...en, done: newDone } : en));
    const { error } = await supabase.from("jahresplanung").update({ done: newDone }).eq("id", entryId);
    if (error) {
      setEntries(prev => prev.map(en => en.id === entryId ? { ...en, done: currentDone } : en));
      toast.error("Fehler beim Speichern");
    }
  }, []);

  // ── Duplicate entry ───────────────────────────────────────────────────────

  const handleDuplicate = useCallback((entry) => {
    setModal(null);
    setTimeout(() => setModal({
      mode: "create",
      customerId: entry.customer_id,
      staffId:    entry.assigned_to,
      month:      entry.month,
      prefill:    entry,
    }), 60);
  }, []);

  // ── Feiertage toggle ─────────────────────────────────────────────────────

  const toggleFeiertag = async (dateStr, isCurrentlyFeiertag) => {
    if (isCurrentlyFeiertag) {
      const existing = feiertage.find(f => f.date === dateStr);
      if (!existing) return;
      await supabase.from("jp_feiertage").delete().eq("id", existing.id);
      setFeiertage(prev => prev.filter(f => f.date !== dateStr));
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.from("jp_feiertage")
        .insert({ date: dateStr, hours: 0, created_by: user?.id }).select().single();
      if (error) { toast.error(error.message); return; }
      setFeiertage(prev => [...prev, data]);
    }
  };

  // ── Derived: year totals ─────────────────────────────────────────────────
  const currentMonth = new Date().getMonth() + 1; // 1–12, stable per render
  const yearSoll     = useMemo(() => Math.round(Object.values(sollMap).reduce((a, b) => a + b, 0) * 10) / 10, [sollMap]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", backgroundColor: pageBg, overflow: "hidden" }}>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div style={{ padding: "9px 18px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 10, backgroundColor: cardBg, flexShrink: 0 }}>
        <Calendar size={16} style={{ color: accent }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: text }}>Jahresplanung</span>

        {/* Year nav */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 6, backgroundColor: pageBg, borderRadius: 7, border: `1px solid ${border}`, padding: "1px 2px" }}>
          <button onClick={() => setYear(y => y - 1)} style={{ padding: "2px 9px", border: "none", background: "none", color: subtle, cursor: "pointer", fontSize: 15, borderRadius: 5 }}>‹</button>
          <span style={{ fontSize: 13, fontWeight: 800, color: text, minWidth: 40, textAlign: "center" }}>{year}</span>
          <button onClick={() => setYear(y => y + 1)} style={{ padding: "2px 9px", border: "none", background: "none", color: subtle, cursor: "pointer", fontSize: 15, borderRadius: 5 }}>›</button>
        </div>

        {/* Soll total */}
        {yearSoll > 0 && (
          <span style={{ fontSize: 10.5, color: subtle, marginLeft: 2 }}>
            Soll {year}: <strong style={{ color: text }}>{yearSoll}h</strong>
          </span>
        )}

        {/* Tab switcher */}
        <div style={{ display: "flex", gap: 2, marginLeft: 16, backgroundColor: pageBg, borderRadius: 7, border: `1px solid ${border}`, padding: 2 }}>
          {[
            { id: "planung",     label: "Planung",    Icon: LayoutGrid },
            { id: "kapazitaet",  label: "Kapazität",  Icon: BarChart2  },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "4px 10px", fontSize: 11.5, borderRadius: 5, cursor: "pointer",
                border: "none",
                backgroundColor: activeTab === id ? cardBg : "transparent",
                color: activeTab === id ? text : subtle,
                fontWeight: activeTab === id ? 700 : 400,
                boxShadow: activeTab === id ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                transition: "all 0.12s",
              }}
            >
              <Icon size={12} />{label}
            </button>
          ))}
        </div>

        <button onClick={loadAll} title="Aktualisieren" style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: subtle, padding: 4, borderRadius: 5, display: "flex", alignItems: "center" }}>
          <RefreshCw size={13} />
        </button>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── Kapazitäts-Tab ────────────────────────────────────────────────── */}
        {activeTab === "kapazitaet" && (
          <KapazitaetView
            orderedStaff={orderedStaff} profile={profile}
            sollMap={sollMap} hoursMap={hoursMap} yearSoll={yearSoll}
            currentMonth={currentMonth} year={year}
            entryMap={entryMap} custMap={custMap}
            colors={colors}
            onEditEntry={(entry) => { setActiveTab("planung"); setTimeout(() => setModal({ mode: "edit", entry }), 60); }}
            onAddEntry={(staffId, month) => { setActiveTab("planung"); setTimeout(() => setModal({ mode: "create", customerId: null, staffId, month }), 60); }}
          />
        )}

        {activeTab === "planung" && (
        <DragDropContext onDragEnd={onDragEnd}>

          {/* ── Sidebar ─────────────────────────────────────────────────────── */}
          <div style={{ width: 200, flexShrink: 0, borderRight: `1px solid ${border}`, display: "flex", flexDirection: "column", backgroundColor: cardBg }}>
            <div style={{ padding: "8px 8px 4px", borderBottom: `1px solid ${border}` }}>
              <div style={{ position: "relative" }}>
                <Search size={11} style={{ position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", color: subtle, pointerEvents: "none" }} />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Suchen… (Ctrl+F)"
                  style={{ width: "100%", paddingLeft: 22, paddingRight: 6, paddingTop: 5, paddingBottom: 5, fontSize: 11, borderRadius: 6, border: `1px solid ${border}`, background: pageBg, color: text, outline: "none", boxSizing: "border-box" }}
                />
              </div>
              {/* Filter: Meine Kunden / Alle */}
              <div style={{ display: "flex", gap: 4, marginTop: 5 }}>
                <button
                  onClick={() => setMyClientsOnly(true)}
                  title="Nur Kunden wo ich Mandatsleiter oder Sachbearbeiter bin"
                  style={{
                    flex: 1, padding: "4px 0", fontSize: 10.5, borderRadius: 5, cursor: "pointer",
                    fontWeight: myClientsOnly ? 700 : 400,
                    backgroundColor: myClientsOnly ? `${accent}18` : "transparent",
                    color: myClientsOnly ? accent : subtle,
                    border: `1px solid ${myClientsOnly ? accent : border}`,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 3,
                    transition: "all 0.12s",
                  }}
                >
                  <UserCheck size={9} />Meine
                </button>
                <button
                  onClick={() => setMyClientsOnly(false)}
                  title="Alle aktiven Kunden anzeigen"
                  style={{
                    flex: 1, padding: "4px 0", fontSize: 10.5, borderRadius: 5, cursor: "pointer",
                    fontWeight: !myClientsOnly ? 700 : 400,
                    backgroundColor: !myClientsOnly ? `${accent}18` : "transparent",
                    color: !myClientsOnly ? accent : subtle,
                    border: `1px solid ${!myClientsOnly ? accent : border}`,
                    transition: "all 0.12s",
                  }}
                >
                  Alle
                </button>
              </div>
              <div style={{ fontSize: 9.5, color: subtle, marginTop: 4, textAlign: "center", paddingBottom: 2 }}>
                {filteredCustomers.length} Kunden · ↔ ziehen · + klicken
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "4px 5px" }}>
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
                              padding: "4px 7px", marginBottom: 1, borderRadius: 5,
                              fontSize: 11, color: text,
                              backgroundColor: snap.isDragging ? (isArtis ? "#d8ead8" : "#ede9fe") : "transparent",
                              border: `1px solid ${snap.isDragging ? accent : "transparent"}`,
                              cursor: "grab", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", userSelect: "none",
                              boxShadow: snap.isDragging ? "0 4px 12px rgba(0,0,0,0.15)" : "none",
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

          {/* ── Planning grid ───────────────────────────────────────────────── */}
          <div style={{ flex: 1, overflowX: "auto", overflowY: "auto" }}>
            <div style={{ minWidth: 1260 }}>

              {/* ── GLOBAL STICKY MONTH HEADER (once, not per employee) ─────── */}
              <div style={{
                display: "flex",
                position: "sticky", top: 0, zIndex: 20,
                borderBottom: `2px solid ${border}`,
                backgroundColor: isArtis ? "#e8f0e8" : isLight ? "#eeeef6" : "#222228",
                flexShrink: 0,
              }}>
                {MONTHS.map((m, mi) => {
                  const month  = mi + 1;
                  const soll   = sollMap[month];
                  const isCur  = month === currentMonth && year === new Date().getFullYear();
                  return (
                    <div key={mi} style={{
                      flex: "1 0 0", minWidth: 100, padding: "6px 6px 5px",
                      textAlign: "center",
                      borderRight: mi < 11 ? `1px solid ${border}` : "none",
                      backgroundColor: isCur ? `${accent}14` : "transparent",
                      position: "relative",
                    }}>
                      {/* Current month indicator dot */}
                      {isCur && (
                        <div style={{ position: "absolute", top: 3, left: "50%", transform: "translateX(-50%)", width: 5, height: 5, borderRadius: "50%", backgroundColor: accent }} />
                      )}
                      <div style={{ fontSize: 11, fontWeight: 800, color: isCur ? accent : subtle, letterSpacing: ".07em", marginTop: isCur ? 6 : 0 }}>{m}</div>
                      {/* Soll badge – clickable, shown once globally */}
                      <div
                        onClick={() => setSollModal(month)}
                        title={`Sollzeit ${MONTHS_LONG[mi]} konfigurieren`}
                        style={{
                          fontSize: 9.5, color: isCur ? accent : subtle,
                          cursor: "pointer", marginTop: 3, padding: "2px 5px", borderRadius: 4,
                          display: "inline-flex", alignItems: "center", gap: 2,
                          backgroundColor: isCur ? `${accent}18` : `${border}`,
                          fontWeight: 600, transition: "background 0.1s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = `${accent}20`; e.currentTarget.style.color = accent; }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = isCur ? `${accent}18` : border; e.currentTarget.style.color = isCur ? accent : subtle; }}
                      >
                        <Clock size={8} />{soll}h
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* ── Employee sections ────────────────────────────────────────── */}
              <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
                {orderedStaff.map(s => {
                  const isMe      = s.id === profile?.id;
                  const isOpen    = collapsed[s.id] === undefined ? true : !collapsed[s.id];
                  const totalH    = Array.from({ length: 12 }, (_, i) => hoursMap[`${s.id}|${i+1}`] || 0).reduce((a,b) => a+b, 0);
                  const capPct    = yearSoll > 0 ? totalH / yearSoll : 0;
                  const capColor  = capPct >= 1 ? "#dc2626" : capPct >= 0.75 ? "#d97706" : accent;
                  const initials  = (s.full_name || s.email || "?").slice(0, 2).toUpperCase();

                  return (
                    <div key={s.id} style={{
                      borderRadius: 10, overflow: "hidden", backgroundColor: cardBg,
                      border: `1px solid ${isMe ? accent : border}`,
                      boxShadow: isMe ? `0 0 0 2px ${accent}20` : "0 1px 3px rgba(0,0,0,0.04)",
                    }}>

                      {/* ── Staff row header ─────────────────────────────────── */}
                      <div
                        onClick={() => setCollapsed(c => ({ ...c, [s.id]: !c[s.id] }))}
                        style={{
                          display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                          backgroundColor: isMe
                            ? (isArtis ? "#cfe8cf" : isLight ? "#ede9fe" : "#2d2d40")
                            : headerBg,
                          cursor: "pointer", userSelect: "none",
                        }}
                      >
                        {isOpen
                          ? <ChevronDown  size={13} style={{ color: subtle, flexShrink: 0 }} />
                          : <ChevronRight size={13} style={{ color: subtle, flexShrink: 0 }} />}

                        {/* Avatar */}
                        <div style={{
                          width: 30, height: 30, borderRadius: "50%",
                          backgroundColor: isMe ? accent : (isArtis ? "#8aaa8a" : isLight ? "#9090c0" : "#5a5a7a"),
                          color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, fontWeight: 700, flexShrink: 0,
                        }}>
                          {initials}
                        </div>

                        {/* Name */}
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: text, flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
                          {s.full_name || s.email}
                          {isMe && (
                            <span style={{ fontSize: 9.5, fontWeight: 700, color: accent, backgroundColor: `${accent}18`, padding: "1px 7px", borderRadius: 8 }}>Du</span>
                          )}
                        </span>

                        {/* Capacity: hours + mini bar */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                          {totalH > 0 && (
                            <>
                              <span style={{ fontSize: 10.5, color: capColor, fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}>
                                <Clock size={10} style={{ color: capColor }} />
                                {totalH}h
                              </span>
                              <div style={{ width: 52, height: 5, backgroundColor: border, borderRadius: 3, overflow: "hidden" }}>
                                <div style={{ width: `${Math.min(capPct * 100, 100)}%`, height: "100%", backgroundColor: capColor, borderRadius: 3, transition: "width 0.3s" }} />
                              </div>
                              <span style={{ fontSize: 9.5, color: capColor, fontWeight: 600, minWidth: 28 }}>
                                {Math.round(capPct * 100)}%
                              </span>
                            </>
                          )}
                          {totalH === 0 && (
                            <span style={{ fontSize: 10.5, color: subtle }}>— leer</span>
                          )}
                        </div>
                      </div>

                      {/* ── Month cells (NO header row repeated here) ───────── */}
                      {isOpen && (
                        <div style={{ display: "flex", borderTop: `1px solid ${border}` }}>
                          {Array.from({ length: 12 }, (_, mi) => {
                            const month     = mi + 1;
                            const isCur     = month === currentMonth && year === new Date().getFullYear();
                            const key       = `${s.id}|${month}`;
                            const cellEnts  = entryMap[key] || [];
                            const cellHours = hoursMap[key] || 0;
                            const soll      = sollMap[month];
                            const pct       = soll > 0 && cellHours > 0 ? Math.min(cellHours / soll, 1) : 0;
                            const fillColor = pct >= 1 ? "#dc2626" : pct >= 0.75 ? "#d97706" : accent;

                            return (
                              <Droppable key={month} droppableId={`cell|${s.id}|${month}`}>
                                {(prov, snap) => (
                                  <div
                                    ref={prov.innerRef}
                                    {...prov.droppableProps}
                                    style={{
                                      flex: "1 0 0", minWidth: 100, minHeight: 120,
                                      borderRight: mi < 11 ? `1px solid ${border}` : "none",
                                      padding: "5px 4px 20px",
                                      backgroundColor: snap.isDraggingOver
                                        ? (isArtis ? "#c8e8c8" : "#ddd6fe")
                                        : isCur
                                          ? `${accent}07`
                                          : "transparent",
                                      transition: "background-color 0.12s",
                                      display: "flex", flexDirection: "column", gap: 3,
                                      position: "relative",
                                    }}
                                  >
                                    {/* Fill bar – bottom, 5px */}
                                    {pct > 0 && (
                                      <div style={{
                                        position: "absolute", bottom: 0, left: 0,
                                        width: `${pct * 100}%`, height: 5,
                                        backgroundColor: fillColor, opacity: 0.45,
                                        borderRadius: "0 2px 0 0",
                                      }} />
                                    )}

                                    {/* Entry chips */}
                                    {cellEnts.map((entry, eidx) => {
                                      const act    = ACT[entry.activity_type] || { label: entry.activity_type, color: "#6b7280", bg: "#f3f4f6" };
                                      const cust   = custMap[entry.customer_id];
                                      const isDone = entry.done === true;
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
                                                backgroundColor: isDone ? `${act.bg}88` : act.bg,
                                                border: `1px solid ${isDone ? "#22c55e55" : act.color + "28"}`,
                                                borderLeft: `3px solid ${isDone ? "#22c55e" : act.color}`,
                                                borderRadius: 5, padding: "4px 6px 4px 6px",
                                                cursor: "pointer", lineHeight: 1.35,
                                                position: "relative",
                                                opacity: isDone ? 0.8 : 1,
                                                boxShadow: eSnap.isDragging ? "0 4px 14px rgba(0,0,0,0.2)" : "none",
                                              }}
                                            >
                                              {/* Done-Toggle */}
                                              <button
                                                onClick={e => toggleDone(entry.id, entry.done, e)}
                                                title={isDone ? "Als offen markieren" : "Als erledigt markieren"}
                                                style={{
                                                  position: "absolute", top: 4, right: 4,
                                                  width: 13, height: 13, borderRadius: "50%",
                                                  border: `1.5px solid ${isDone ? "#22c55e" : "#d1d5db"}`,
                                                  background: isDone ? "#22c55e" : "transparent",
                                                  cursor: "pointer", padding: 0,
                                                  display: "flex", alignItems: "center", justifyContent: "center",
                                                }}
                                              >
                                                {isDone && <span style={{ fontSize: 7, color: "#fff", fontWeight: 900, lineHeight: 1 }}>✓</span>}
                                              </button>
                                              <div style={{ fontSize: 9.5, fontWeight: 700, color: isDone ? "#22c55e" : act.color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: isDone ? "line-through" : "none", paddingRight: 14 }}>{act.label}</div>
                                              <div style={{ fontSize: 10.5, color: isDone ? "#888" : "#2a2a2a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}>{cust?.company_name || "–"}</div>
                                              {entry.hours != null && <div style={{ fontSize: 9, color: "#777", marginTop: 1 }}>{entry.hours}h</div>}
                                            </div>
                                          )}
                                        </Draggable>
                                      );
                                    })}
                                    {prov.placeholder}

                                    {/* Σ hours */}
                                    {cellHours > 0 && (
                                      <div style={{
                                        position: "absolute", bottom: 6, left: 0, right: 0,
                                        fontSize: 9, color: subtle, textAlign: "center",
                                        fontWeight: 600, letterSpacing: ".04em",
                                      }}>
                                        Σ {cellHours}h
                                      </div>
                                    )}

                                    {/* + Add button */}
                                    <button
                                      onClick={e => { e.stopPropagation(); setModal({ mode: "create", customerId: null, staffId: s.id, month }); }}
                                      title={`Aktivität für ${MONTHS_LONG[mi]} hinzufügen`}
                                      style={{
                                        position: "absolute", top: 4, right: 4,
                                        width: 18, height: 18, borderRadius: "50%",
                                        border: `1px dashed ${border}`, background: "none",
                                        color: subtle, cursor: "pointer", fontSize: 14,
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        lineHeight: 1, padding: 0, opacity: 0.5,
                                        transition: "all 0.12s",
                                      }}
                                      onMouseEnter={e => { Object.assign(e.currentTarget.style, { opacity: "1", backgroundColor: `${accent}18`, borderColor: accent, borderStyle: "solid", color: accent }); }}
                                      onMouseLeave={e => { Object.assign(e.currentTarget.style, { opacity: "0.5", backgroundColor: "transparent", borderColor: border, borderStyle: "dashed", color: subtle }); }}
                                    >
                                      +
                                    </button>
                                  </div>
                                )}
                              </Droppable>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </DragDropContext>
        )} {/* end activeTab === "planung" */}
      </div>

      {/* Activity Modal */}
      {modal && (
        <ActivityModal
          modal={modal} onClose={() => setModal(null)}
          staff={staff} custMap={custMap}
          onSave={saveEntry} onUpdate={updateEntry} onDelete={deleteEntry}
          onDuplicate={handleDuplicate}
          colors={colors}
        />
      )}

      {/* Sollzeit Modal */}
      {sollModal && (
        <SollzeitModal
          month={sollModal} year={year}
          feiertage={feiertage} feierSet={feierSet}
          onToggle={toggleFeiertag}
          onClose={() => setSollModal(null)}
          colors={colors}
        />
      )}
    </div>
  );
}

// ── Sollzeit Modal ────────────────────────────────────────────────────────────

function SollzeitModal({ month, year, feiertage, feierSet, onToggle, onClose, colors }) {
  const { cardBg, border, text, subtle, accent, pageBg } = colors;
  const workingDays = getWorkingDays(year, month);
  const actualDays  = workingDays.filter(d => !feierSet.has(toDateStr(d)));
  const totalSoll   = Math.round(actualDays.length * HOURS_PER_DAY * 10) / 10;

  return (
    <div
      style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1001 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: 14, padding: 24, width: 340, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: text }}>{MONTHS_LONG[month-1]} {year}</div>
            <div style={{ fontSize: 10.5, color: subtle, marginTop: 1 }}>Klick auf Tag = Feiertag ein/aus</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: subtle, padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {workingDays.map(d => {
            const dateStr      = toDateStr(d);
            const isFeiertag   = feierSet.has(dateStr);
            const dayName      = DAY_NAMES[d.getDay()];
            const displayDate  = `${dayName} ${String(d.getDate()).padStart(2,"0")}.${String(month).padStart(2,"0")}.`;
            const feierInfo    = feiertage.find(f => f.date === dateStr);

            return (
              <div
                key={dateStr}
                onClick={() => onToggle(dateStr, isFeiertag)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "7px 11px", borderRadius: 7, cursor: "pointer",
                  backgroundColor: isFeiertag ? "#fee2e2" : pageBg,
                  border: `1px solid ${isFeiertag ? "#fca5a5" : border}`,
                  transition: "all 0.1s",
                }}
              >
                <div>
                  <span style={{ fontSize: 12.5, color: isFeiertag ? "#dc2626" : text }}>{displayDate}</span>
                  {feierInfo?.notes && (
                    <span style={{ fontSize: 10.5, color: "#dc2626", marginLeft: 8 }}>{feierInfo.notes}</span>
                  )}
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: isFeiertag ? "#dc2626" : "#059669", minWidth: 36, textAlign: "right" }}>
                  {isFeiertag ? "0h" : `${HOURS_PER_DAY}h`}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 8, backgroundColor: `${accent}10`, border: `1px solid ${accent}30`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: subtle }}>
            {actualDays.length} Arbeitstage · {workingDays.length - actualDays.length} Feiertage
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: accent }}>Soll: {totalSoll}h</span>
        </div>
      </div>
    </div>
  );
}

// ── Activity Modal ────────────────────────────────────────────────────────────

function ActivityModal({ modal, onClose, staff, custMap, onSave, onUpdate, onDelete, onDuplicate, colors }) {
  const { cardBg, border, text, subtle, accent, pageBg } = colors;
  const isEdit  = modal.mode === "edit";
  const entry   = isEdit ? modal.entry : null;
  const prefill = !isEdit ? modal.prefill : null; // for duplication

  const [activityType,    setActivityType]    = useState(entry?.activity_type || prefill?.activity_type || "jahresabschluss");
  const [hours,           setHours]           = useState(entry?.hours != null ? String(entry.hours) : prefill?.hours != null ? String(prefill.hours) : "");
  const [notes,           setNotes]           = useState(entry?.notes || prefill?.notes || "");
  const [staffId,         setStaffId]         = useState(entry?.assigned_to || modal.staffId || "");
  const [month,           setMonth]           = useState(entry?.month || modal.month || 1);
  const [recurring,       setRecurring]       = useState(false);
  const [recurringType,   setRecurringType]   = useState("monthly");
  const [recurringMonths, setRecurringMonths] = useState([1,2,3,4,5,6,7,8,9,10,11,12]);
  const [custSearch,      setCustSearch]      = useState("");
  const [custPickOpen,    setCustPickOpen]    = useState(false);
  const [selectedCustId,  setSelectedCustId]  = useState(isEdit ? (entry?.customer_id || "") : (modal.customerId || prefill?.customer_id || ""));

  const effectiveCustId = selectedCustId;
  const customer        = custMap[effectiveCustId];
  const isPreset        = !!ACT[activityType];

  // Filtered customer list for picker
  const custOptions = Object.values(custMap)
    .filter(c => !custSearch || (c.company_name || "").toLowerCase().includes(custSearch.toLowerCase()))
    .sort((a, b) => (a.company_name || "").localeCompare(b.company_name || ""))
    .slice(0, 15);

  const toggleMonth = (m) =>
    setRecurringMonths(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m].sort((a,b) => a-b));

  const handleSave = () => {
    if (!activityType.trim()) { toast.error("Bitte Tätigkeit auswählen"); return; }
    if (!staffId) { toast.error("Bitte Mitarbeiter wählen"); return; }
    if (!effectiveCustId) { toast.error("Bitte Kunde wählen"); return; }
    if (isEdit) {
      onUpdate(entry.id, { customer_id: effectiveCustId, activity_type: activityType, hours: hours !== "" ? parseFloat(hours) : null, notes: notes || null, assigned_to: staffId, month });
    } else {
      onSave({ customerId: effectiveCustId, staffId, month, activityType, hours, notes, recurring, recurringType, recurringMonths });
    }
  };

  const inp = { style: { width: "100%", padding: "6px 9px", fontSize: 12.5, borderRadius: 6, border: `1px solid ${border}`, backgroundColor: pageBg, color: text, outline: "none", boxSizing: "border-box" } };

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: 14, padding: 24, width: 410, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.25)" }}>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: text }}>{isEdit ? "Aktivität bearbeiten" : "Aktivität einplanen"}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: subtle, padding: 2 }}><X size={16} /></button>
        </div>

        {/* Customer – always editable */}
        <div style={{ marginBottom: 12, position: "relative" }}>
          <label style={lbl(subtle)}>KUNDE</label>
          <div style={{ position: "relative", marginTop: 4 }}>
            <input
              value={custPickOpen ? custSearch : (customer?.company_name || "")}
              onFocus={() => { setCustPickOpen(true); setCustSearch(customer?.company_name || ""); }}
              onBlur={() => setTimeout(() => setCustPickOpen(false), 150)}
              onChange={e => setCustSearch(e.target.value)}
              placeholder="Kunde suchen…"
              style={{ ...inp.style, borderColor: !effectiveCustId ? "#fca5a5" : border }}
            />
            {custPickOpen && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200, backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: 7, maxHeight: 200, overflowY: "auto", boxShadow: "0 6px 20px rgba(0,0,0,0.15)", marginTop: 2 }}>
                {custOptions.length === 0 ? (
                  <div style={{ padding: "8px 10px", fontSize: 12, color: subtle }}>Kein Treffer</div>
                ) : custOptions.map(c => (
                  <div
                    key={c.id}
                    onMouseDown={() => { setSelectedCustId(c.id); setCustSearch(""); setCustPickOpen(false); }}
                    style={{ padding: "7px 10px", fontSize: 12.5, cursor: "pointer", color: text, borderBottom: `1px solid ${border}`, backgroundColor: c.id === effectiveCustId ? `${accent}10` : "transparent" }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = `${accent}10`; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = c.id === effectiveCustId ? `${accent}10` : "transparent"; }}
                  >
                    {c.company_name}
                  </div>
                ))}
              </div>
            )}
          </div>
          {!effectiveCustId && <div style={{ fontSize: 10.5, color: "#dc2626", marginTop: 3 }}>Bitte Kunde auswählen</div>}
        </div>

        {/* Mitarbeiter + Monat */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={lbl(subtle)}>MITARBEITER</label>
            <select value={staffId} onChange={e => setStaffId(e.target.value)} style={{ ...inp.style, marginTop: 4 }}>
              {staff.map(s => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
            </select>
          </div>
          {!recurring && (
            <div style={{ width: 88 }}>
              <label style={lbl(subtle)}>MONAT</label>
              <select value={month} onChange={e => setMonth(parseInt(e.target.value))} style={{ ...inp.style, marginTop: 4 }}>
                {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Activity type – Presets + Freitext */}
        <div style={{ marginBottom: 12 }}>
          <label style={lbl(subtle)}>TÄTIGKEIT</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6, marginBottom: 7 }}>
            {ACTIVITIES.map(a => (
              <button key={a.id} onClick={() => setActivityType(a.id)} style={{
                padding: "5px 11px", fontSize: 11.5, borderRadius: 20, cursor: "pointer",
                backgroundColor: activityType === a.id ? a.bg : "transparent",
                color: activityType === a.id ? a.color : subtle,
                border: activityType === a.id ? `1.5px solid ${a.color}` : `1px solid ${border}`,
                fontWeight: activityType === a.id ? 700 : 400, transition: "all 0.12s",
              }}>{a.label}</button>
            ))}
          </div>
          <input
            value={isPreset ? "" : activityType}
            onChange={e => { if (e.target.value.trim()) setActivityType(e.target.value); else if (!isPreset) setActivityType(""); }}
            placeholder="Oder eigene Bezeichnung…"
            style={{ ...inp.style, fontSize: 12, borderColor: !isPreset && activityType ? accent : border, color: !isPreset && activityType ? accent : subtle }}
          />
        </div>

        {/* Hours */}
        <div style={{ marginBottom: 12 }}>
          <label style={lbl(subtle)}>STUNDEN (optional)</label>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            <Clock size={13} style={{ color: subtle, flexShrink: 0 }} />
            <input type="number" step="0.5" min="0" value={hours} onChange={e => setHours(e.target.value)} placeholder="z.B. 8" {...inp} style={{ ...inp.style, flex: 1 }} />
            <span style={{ fontSize: 12, color: subtle }}>h</span>
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 12 }}>
          <label style={lbl(subtle)}>NOTIZ (optional)</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="z.B. Jahresabschluss 2025" {...inp} style={{ ...inp.style, marginTop: 4 }} />
        </div>

        {/* Recurring */}
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
                  {[["monthly","Monatlich"],["quarterly","Quartalsweise"],["custom","Monate wählen"]].map(([v,l]) => (
                    <label key={v} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 12, color: recurringType === v ? accent : subtle, fontWeight: recurringType === v ? 600 : 400 }}>
                      <input type="radio" name="rectype" value={v} checked={recurringType === v} onChange={() => setRecurringType(v)} style={{ accentColor: accent }} />
                      {l}
                    </label>
                  ))}
                </div>
                {recurringType === "custom" && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {MONTHS.map((m, i) => (
                      <button key={i} onClick={() => toggleMonth(i+1)} style={{
                        padding: "3px 9px", fontSize: 11, borderRadius: 5, cursor: "pointer",
                        backgroundColor: recurringMonths.includes(i+1) ? accent : "transparent",
                        color: recurringMonths.includes(i+1) ? "#fff" : subtle,
                        border: `1px solid ${recurringMonths.includes(i+1) ? accent : border}`,
                        fontWeight: recurringMonths.includes(i+1) ? 600 : 400,
                      }}>{m}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
          {isEdit && (
            <button onClick={() => onDelete(entry.id)} style={{ padding: "7px 12px", fontSize: 12, borderRadius: 7, border: "1px solid #fca5a5", backgroundColor: "transparent", color: "#dc2626", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
              <Trash2 size={12} /> Löschen
            </button>
          )}
          {isEdit && (
            <button onClick={() => onDuplicate(entry)} title="Diesen Eintrag als Vorlage für einen neuen Eintrag verwenden" style={{ padding: "7px 12px", fontSize: 12, borderRadius: 7, border: `1px solid ${border}`, backgroundColor: "transparent", color: subtle, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
              <Copy size={12} /> Duplizieren
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ padding: "7px 14px", fontSize: 12, borderRadius: 7, border: `1px solid ${border}`, backgroundColor: "transparent", color: subtle, cursor: "pointer" }}>Abbrechen</button>
          <button onClick={handleSave} disabled={!activityType.trim()} style={{ padding: "7px 16px", fontSize: 12, borderRadius: 7, border: "none", backgroundColor: accent, color: "#fff", cursor: "pointer", fontWeight: 600 }}>
            {isEdit ? "Speichern" : recurring ? `${recurringType === "monthly" ? 12 : recurringType === "quarterly" ? 4 : recurringMonths.length} Einträge erstellen` : "Einplanen"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Kapazitäts-View ───────────────────────────────────────────────────────────

function KapazitaetView({ orderedStaff, profile, sollMap, hoursMap, yearSoll, currentMonth, year, entryMap, custMap, colors, onEditEntry, onAddEntry }) {
  const { pageBg, cardBg, border, text, subtle, accent, isArtis, isLight } = colors;
  const [drillDown, setDrillDown] = useState(null); // { staffId, name, month }

  // Team-Summe pro Monat
  const teamHoursPerMonth = useMemo(() =>
    Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => {
        const month = i + 1;
        const total = orderedStaff.reduce((s, st) => s + (hoursMap[`${st.id}|${month}`] || 0), 0);
        return [month, total];
      })
    ),
  [orderedStaff, hoursMap]);

  function capColor(pct) {
    if (pct <= 0) return subtle;
    if (pct >= 1)  return "#dc2626";
    if (pct >= 0.75) return "#d97706";
    return "#059669";
  }
  function capBg(pct) {
    if (pct <= 0) return "transparent";
    if (pct >= 1)  return "#fee2e2";
    if (pct >= 0.75) return "#fef3c7";
    return "#d1fae5";
  }

  const COL_W = 90; // px per month column
  const ROW_H = 52; // px per employee row

  return (
    <div style={{ flex: 1, overflowX: "auto", overflowY: "auto" }}>
      <div style={{ minWidth: COL_W * 12 + 180 }}>

        {/* ── Sticky header: months ────────────────────────────────────── */}
        <div style={{
          display: "flex", position: "sticky", top: 0, zIndex: 20,
          borderBottom: `2px solid ${border}`,
          backgroundColor: isArtis ? "#e8f0e8" : isLight ? "#eeeef6" : "#222228",
        }}>
          {/* left spacer for name column */}
          <div style={{ width: 180, flexShrink: 0, padding: "8px 14px", display: "flex", alignItems: "flex-end" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: subtle, letterSpacing: ".07em" }}>MITARBEITER</span>
          </div>
          {MONTHS.map((m, mi) => {
            const month = mi + 1;
            const isCur = month === currentMonth && year === new Date().getFullYear();
            const teamH = teamHoursPerMonth[month] || 0;
            const teamSoll = sollMap[month] * orderedStaff.length;
            const teamPct = teamSoll > 0 ? teamH / teamSoll : 0;
            return (
              <div key={mi} style={{
                width: COL_W, flexShrink: 0, padding: "6px 6px 5px",
                textAlign: "center",
                borderLeft: `1px solid ${border}`,
                backgroundColor: isCur ? `${accent}14` : "transparent",
                position: "relative",
              }}>
                {isCur && <div style={{ position: "absolute", top: 3, left: "50%", transform: "translateX(-50%)", width: 5, height: 5, borderRadius: "50%", backgroundColor: accent }} />}
                <div style={{ fontSize: 11, fontWeight: 800, color: isCur ? accent : subtle, marginTop: isCur ? 6 : 0 }}>{m}</div>
                <div style={{ fontSize: 9.5, color: subtle, marginTop: 1 }}>{sollMap[month]}h Soll</div>
                {/* team mini bar */}
                {teamH > 0 && (
                  <div style={{ marginTop: 3, height: 3, borderRadius: 2, backgroundColor: border, overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(teamPct * 100, 100)}%`, height: "100%", backgroundColor: capColor(teamPct), borderRadius: 2 }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Employee rows ────────────────────────────────────────────── */}
        <div style={{ padding: "8px 0" }}>
          {orderedStaff.map(s => {
            const isMe     = s.id === profile?.id;
            const initials = (s.full_name || s.email || "?").slice(0, 2).toUpperCase();
            const yearH    = Array.from({ length: 12 }, (_, i) => hoursMap[`${s.id}|${i+1}`] || 0).reduce((a,b) => a+b, 0);
            const yearPct  = yearSoll > 0 ? yearH / yearSoll : 0;

            return (
              <div key={s.id} style={{
                display: "flex", alignItems: "stretch",
                borderBottom: `1px solid ${border}`,
                backgroundColor: isMe ? (isArtis ? "#f5faf5" : isLight ? "#faf9ff" : "#2a2a38") : "transparent",
                minHeight: ROW_H,
              }}>
                {/* Name column */}
                <div style={{
                  width: 180, flexShrink: 0, padding: "8px 14px",
                  display: "flex", alignItems: "center", gap: 8,
                  borderRight: `1px solid ${border}`,
                  position: "sticky", left: 0, zIndex: 5,
                  backgroundColor: isMe
                    ? (isArtis ? "#f0f8f0" : isLight ? "#f5f3ff" : "#28283a")
                    : (isArtis ? "#f9fbf9" : isLight ? "#fafafa" : "#27272c"),
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                    backgroundColor: isMe ? accent : (isArtis ? "#8aaa8a" : isLight ? "#9090c0" : "#5a5a7a"),
                    color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 700,
                  }}>{initials}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: isMe ? 700 : 500, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.full_name || s.email}
                    </div>
                    <div style={{ fontSize: 9.5, color: capColor(yearPct), fontWeight: 600, marginTop: 1 }}>
                      {yearH}h · {Math.round(yearPct * 100)}%
                    </div>
                  </div>
                </div>

                {/* Month cells */}
                {Array.from({ length: 12 }, (_, mi) => {
                  const month  = mi + 1;
                  const isCur  = month === currentMonth && year === new Date().getFullYear();
                  const ist    = hoursMap[`${s.id}|${month}`] || 0;
                  const soll   = sollMap[month];
                  const pct    = soll > 0 ? ist / soll : 0;
                  const cc     = capColor(pct);
                  const cb     = capBg(pct);

                  return (
                    <div
                      key={month}
                      onClick={() => setDrillDown({ staffId: s.id, name: s.full_name || s.email, month })}
                      title={`${s.full_name || s.email} · ${MONTHS_LONG[mi]}: ${ist}h / ${soll}h Soll — Klick für Details`}
                      style={{
                        width: COL_W, flexShrink: 0, padding: "6px 8px",
                        borderLeft: `1px solid ${border}`,
                        backgroundColor: isCur ? `${accent}07` : "transparent",
                        cursor: "pointer",
                        display: "flex", flexDirection: "column", justifyContent: "center", gap: 4,
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = `${accent}10`; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = isCur ? `${accent}07` : "transparent"; }}
                    >
                      {ist > 0 ? (
                        <>
                          {/* Bar */}
                          <div style={{ height: 6, borderRadius: 3, backgroundColor: border, overflow: "hidden" }}>
                            <div style={{
                              width: `${Math.min(pct * 100, 100)}%`, height: "100%",
                              backgroundColor: cc, borderRadius: 3,
                              transition: "width 0.3s",
                            }} />
                          </div>
                          {/* Numbers */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: cc }}>{ist}h</span>
                            <span style={{
                              fontSize: 9.5, fontWeight: 700, color: "#fff",
                              backgroundColor: cc, borderRadius: 4, padding: "1px 5px",
                            }}>{Math.round(pct * 100)}%</span>
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: 9.5, color: border, textAlign: "center" }}>—</div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* ── Team total row ──────────────────────────────────────────── */}
          <div style={{
            display: "flex", alignItems: "stretch",
            backgroundColor: isArtis ? "#e6ede6" : isLight ? "#eeeef6" : "#222228",
            borderTop: `2px solid ${border}`, minHeight: ROW_H,
          }}>
            <div style={{
              width: 180, flexShrink: 0, padding: "8px 14px",
              display: "flex", alignItems: "center",
              borderRight: `1px solid ${border}`,
              position: "sticky", left: 0, zIndex: 5,
              backgroundColor: isArtis ? "#e6ede6" : isLight ? "#eeeef6" : "#222228",
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: text }}>Team gesamt</span>
            </div>
            {Array.from({ length: 12 }, (_, mi) => {
              const month   = mi + 1;
              const isCur   = month === currentMonth && year === new Date().getFullYear();
              const teamH   = teamHoursPerMonth[month] || 0;
              const teamSoll = sollMap[month] * orderedStaff.length;
              const pct     = teamSoll > 0 ? teamH / teamSoll : 0;
              const cc      = capColor(pct);
              return (
                <div key={month} style={{
                  width: COL_W, flexShrink: 0, padding: "6px 8px",
                  borderLeft: `1px solid ${border}`,
                  backgroundColor: isCur ? `${accent}10` : "transparent",
                  display: "flex", flexDirection: "column", justifyContent: "center", gap: 4,
                }}>
                  {teamH > 0 ? (
                    <>
                      <div style={{ height: 6, borderRadius: 3, backgroundColor: border, overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(pct * 100, 100)}%`, height: "100%", backgroundColor: cc, borderRadius: 3 }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: cc }}>{teamH}h</span>
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: "#fff", backgroundColor: cc, borderRadius: 4, padding: "1px 5px" }}>
                          {Math.round(pct * 100)}%
                        </span>
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 9.5, color: border, textAlign: "center" }}>—</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Drill-Down Popup ──────────────────────────────────────────────── */}
      {drillDown && (() => {
        const { staffId, name, month } = drillDown;
        const cellEnts = (entryMap[`${staffId}|${month}`] || []);
        const doneCount = cellEnts.filter(e => e.done).length;
        return (
          <div
            style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
            onClick={e => { if (e.target === e.currentTarget) setDrillDown(null); }}
          >
            <div style={{
              backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: 14,
              width: 360, maxHeight: "75vh", display: "flex", flexDirection: "column",
              boxShadow: "0 24px 60px rgba(0,0,0,0.22)",
            }}>
              {/* Header */}
              <div style={{ padding: "16px 18px 12px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: text }}>{name}</div>
                  <div style={{ fontSize: 11, color: subtle, marginTop: 2 }}>
                    {MONTHS_LONG[month - 1]} {year}
                    {cellEnts.length > 0 && (
                      <span style={{ marginLeft: 8, color: doneCount === cellEnts.length ? "#22c55e" : accent }}>
                        · {doneCount}/{cellEnts.length} erledigt
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => setDrillDown(null)} style={{ background: "none", border: "none", cursor: "pointer", color: subtle, padding: 2 }}><X size={16} /></button>
              </div>

              {/* Entry list */}
              <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                {cellEnts.length === 0 ? (
                  <div style={{ textAlign: "center", color: subtle, fontSize: 12, padding: "24px 0" }}>Keine Einträge für diesen Monat</div>
                ) : cellEnts.map(entry => {
                  const act    = ACT[entry.activity_type] || { label: entry.activity_type, color: "#6b7280", bg: "#f3f4f6" };
                  const cust   = custMap[entry.customer_id];
                  const isDone = entry.done === true;
                  return (
                    <div
                      key={entry.id}
                      onClick={() => { setDrillDown(null); onEditEntry(entry); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "9px 11px", borderRadius: 8, cursor: "pointer",
                        backgroundColor: isDone ? `${act.bg}55` : act.bg,
                        border: `1px solid ${isDone ? "#22c55e40" : act.color + "30"}`,
                        borderLeft: `3px solid ${isDone ? "#22c55e" : act.color}`,
                        opacity: isDone ? 0.8 : 1,
                        transition: "all 0.1s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.filter = "brightness(0.96)"; }}
                      onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}
                    >
                      {/* Done indicator */}
                      <div style={{
                        width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                        border: `1.5px solid ${isDone ? "#22c55e" : "#d1d5db"}`,
                        backgroundColor: isDone ? "#22c55e" : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {isDone && <span style={{ fontSize: 8, color: "#fff", fontWeight: 900 }}>✓</span>}
                      </div>
                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: isDone ? "#22c55e" : act.color, textDecoration: isDone ? "line-through" : "none" }}>{act.label}</div>
                        <div style={{ fontSize: 12, color: text, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cust?.company_name || "–"}</div>
                        {entry.notes && <div style={{ fontSize: 10.5, color: subtle, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.notes}</div>}
                      </div>
                      {/* Hours */}
                      {entry.hours != null && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: isDone ? "#22c55e" : act.color, flexShrink: 0 }}>{entry.hours}h</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div style={{ padding: "10px 14px", borderTop: `1px solid ${border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10.5, color: subtle }}>
                  {cellEnts.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0)}h geplant
                </span>
                <button
                  onClick={() => { setDrillDown(null); onAddEntry(staffId, month); }}
                  style={{ padding: "6px 14px", fontSize: 12, borderRadius: 7, border: "none", backgroundColor: accent, color: "#fff", cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}
                >
                  + Aktivität hinzufügen
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────

function lbl(subtle) {
  return { fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", color: subtle, display: "block" };
}

function btnStyle(border, subtle) {
  return { padding: "2px 10px", borderRadius: 6, border: `1px solid ${border}`, background: "transparent", color: subtle, cursor: "pointer", fontSize: 14, lineHeight: 1 };
}
