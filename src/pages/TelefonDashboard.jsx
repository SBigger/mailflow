import React, { useContext, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Phone, PhoneIncoming, PhoneOutgoing, Clock, TrendingUp,
  UserCheck, UserX, Search, ExternalLink, Users, Video,
  LayoutGrid, ListChecks, Hourglass,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { format, isToday, isThisWeek, isThisMonth, startOfDay } from "date-fns";
import { de } from "date-fns/locale";
import { supabase } from "@/api/supabaseClient";
import { ThemeContext } from "@/Layout";

/**
 * Telefon-Dashboard
 *
 * Zwei Ansichten – umschaltbar:
 *  1) "Mitarbeiter"  (Default): Pro Mitarbeiter alle Anrufe, mit Kunden-Zuordnung
 *                   und "Teams"-Label statt leerer Nummer bei internen Teams-Calls.
 *  2) "Statistik"    (optional): Das klassische KPI-Dashboard mit Chart & Top-Listen.
 *
 * Zeitfilter: Heute · 7 Tage · 1 Monat · Alle
 */

const LS_VIEW  = "telefonDashboard.view.v1";   // "mitarbeiter" | "stats"
const LS_RANGE = "telefonDashboard.range.v1";  // "today" | "7d" | "1m" | "all"

export default function TelefonDashboard() {
  const { theme } = useContext(ThemeContext);
  const navigate = useNavigate();
  const isLight = theme === "light";
  const isArtis = theme === "artis";
  const isDark  = !isLight && !isArtis;

  // ── Theme ─────────────────────────────────────────────
  const pageBg      = isLight ? "#f4f4f8" : isArtis ? "#f2f5f2" : "#18181b";
  const cardBg      = isLight ? "#ffffff" : isArtis ? "rgba(255,255,255,0.9)" : "rgba(39,39,42,0.75)";
  const border      = isLight ? "#e4e4ea" : isArtis ? "#d0dcd0" : "rgba(63,63,70,0.6)";
  const headingCol  = isLight ? "#1a1a2e" : isArtis ? "#1a3a1a" : "#e4e4e7";
  const subCol      = isLight ? "#64748b" : isArtis ? "#4a6a4a" : "#a1a1aa";
  const mutedCol    = isLight ? "#9090b8" : isArtis ? "#6b826b" : "#71717a";
  const accent      = isArtis ? "#5b8a5b" : isLight ? "#5b21b6" : "#a78bfa";
  const accentIn    = "#2d6a4f";
  const accentOut   = "#5b21b6";
  const inputBg     = isLight ? "#ffffff" : isArtis ? "#ffffff" : "rgba(24,24,27,0.7)";
  const rowHover    = isLight ? "#f4f4fa" : isArtis ? "#eaf0ea" : "rgba(63,63,70,0.35)";
  const chartGrid   = isLight ? "#ededf5" : isArtis ? "#dee7de" : "#3f3f46";
  const tabActive   = isArtis ? "#dde9dd" : isLight ? "#e4e4f0" : "rgba(80,80,90,0.5)";

  // ── View & Range ──────────────────────────────────────
  const [view,   setView]   = useState(() => localStorage.getItem(LS_VIEW)  || "mitarbeiter");
  const [range,  setRange]  = useState(() => localStorage.getItem(LS_RANGE) || "7d");
  React.useEffect(() => { localStorage.setItem(LS_VIEW,  view);  }, [view]);
  React.useEffect(() => { localStorage.setItem(LS_RANGE, range); }, [range]);

  // ── Daten ─────────────────────────────────────────────
  const { data: calls = [], isLoading, error } = useQuery({
    queryKey: ["call-dashboard-calls"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("call_records")
        .select("id, direction, call_type, caller_number, callee_number, caller_name, callee_name, artis_user_name, customer_id, start_time, duration_seconds, notes")
        .order("start_time", { ascending: false })
        .limit(5000);
      if (error) throw new Error(error.message);
      return data || [];
    },
    staleTime: 60_000,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["call-dashboard-customers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, company_name, vorname, name").limit(5000);
      if (error) throw new Error(error.message);
      return data || [];
    },
    staleTime: 5 * 60_000,
  });
  const customerMap = useMemo(() => {
    const m = new Map();
    for (const c of customers) m.set(c.id, c);
    return m;
  }, [customers]);

  // Unverknüpfte Pending-Notes (Click-to-Call)
  const { data: pendings = [] } = useQuery({
    queryKey: ["call-dashboard-pending"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("call_notes_pending")
        .select("id, customer_id, phone_number, artis_user_name, note_title, note_text, clicked_at")
        .is("linked_call_id", null)
        .order("clicked_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return data || [];
    },
    staleTime: 60_000,
  });

  // ── Zeitfilter ───────────────────────────────────────
  const rangeFilter = (dt) => {
    if (range === "all") return true;
    if (!dt) return false;
    const d = new Date(dt);
    if (range === "today") return isToday(d);
    if (range === "7d")    return (Date.now() - d.getTime()) <= 7  * 86400_000;
    if (range === "1m")    return (Date.now() - d.getTime()) <= 31 * 86400_000;
    return true;
  };
  const callsInRange = useMemo(() => calls.filter(c => rangeFilter(c.start_time)), [calls, range]);
  const pendingsInRange = useMemo(() => pendings.filter(p => rangeFilter(p.clicked_at)), [pendings, range]);

  // ── Render ────────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ padding: 32, color: subCol, backgroundColor: pageBg, height: "100%", overflow: "auto" }}>
        Lade Telefonate …
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: 32, color: "#b04040", backgroundColor: pageBg, height: "100%", overflow: "auto" }}>
        Fehler: {String(error?.message || error)}
      </div>
    );
  }

  return (
    <div style={{ height: "100%", backgroundColor: pageBg, overflowY: "auto", overflowX: "hidden" }}>
      <div style={{ padding: 24, minHeight: "100%", boxSizing: "border-box" }}>

        {/* ── Header ─────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
            backgroundColor: accent + "22", color: accent,
          }}>
            <Phone size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: headingCol, margin: 0 }}>Telefon-Dashboard</h1>
            <p style={{ fontSize: 12.5, color: subCol, margin: "2px 0 0" }}>
              {view === "mitarbeiter" ? "Anrufe pro Mitarbeitenden" : "Microsoft-Teams-Anrufe · KPI-Übersicht"}
              {" · "}{calls.length} geladen
              {pendings.length > 0 && <> · {pendings.length} Vorab-Notizen offen</>}
            </p>
          </div>

          {/* View-Toggle */}
          <div style={{
            display: "inline-flex", borderRadius: 8, border: `1px solid ${border}`, background: cardBg, padding: 3,
          }}>
            <ViewTab active={view === "mitarbeiter"} onClick={() => setView("mitarbeiter")} icon={Users} label="Mitarbeiter" activeBg={tabActive} col={headingCol} mutedCol={mutedCol} />
            <ViewTab active={view === "stats"}       onClick={() => setView("stats")}       icon={LayoutGrid} label="Statistik"   activeBg={tabActive} col={headingCol} mutedCol={mutedCol} />
          </div>

          {/* Range-Toggle */}
          <div style={{
            display: "inline-flex", borderRadius: 8, border: `1px solid ${border}`, background: cardBg, padding: 3,
          }}>
            <RangeTab active={range === "today"} onClick={() => setRange("today")} label="Heute"   activeBg={tabActive} col={headingCol} mutedCol={mutedCol} />
            <RangeTab active={range === "7d"}    onClick={() => setRange("7d")}    label="7 Tage"  activeBg={tabActive} col={headingCol} mutedCol={mutedCol} />
            <RangeTab active={range === "1m"}    onClick={() => setRange("1m")}    label="1 Monat" activeBg={tabActive} col={headingCol} mutedCol={mutedCol} />
            <RangeTab active={range === "all"}   onClick={() => setRange("all")}   label="Alle"    activeBg={tabActive} col={headingCol} mutedCol={mutedCol} />
          </div>
        </div>

        {view === "mitarbeiter" ? (
          <MitarbeiterView
            calls={callsInRange}
            pendings={pendingsInRange}
            customerMap={customerMap}
            navigate={navigate}
            colors={{ cardBg, border, headingCol, subCol, mutedCol, accent, accentIn, accentOut, rowHover }}
          />
        ) : (
          <StatsView
            calls={callsInRange}
            allCalls={calls}
            customerMap={customerMap}
            navigate={navigate}
            colors={{ pageBg, cardBg, border, headingCol, subCol, mutedCol, accent, accentIn, accentOut, inputBg, rowHover, chartGrid }}
          />
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// MITARBEITER-ANSICHT  (Default)
// ══════════════════════════════════════════════════════════════════
function MitarbeiterView({ calls, pendings, customerMap, navigate, colors }) {
  const { cardBg, border, headingCol, subCol, mutedCol, accentIn, accentOut, rowHover } = colors;

  const [expanded, setExpanded] = useState({}); // { [name]: bool } – initial alle auf
  const [search, setSearch] = useState("");

  // Mitarbeiter-Gruppen (aus call_records + pending-notes)
  const byEmployee = useMemo(() => {
    const m = new Map();
    const ensure = (name) => {
      if (!m.has(name)) m.set(name, { name, calls: [], pendings: [], count: 0, inCount: 0, outCount: 0, durSum: 0 });
      return m.get(name);
    };
    for (const c of calls) {
      const name = c.artis_user_name || "— Unbekannt —";
      const e = ensure(name);
      e.calls.push(c);
      e.count++;
      e.durSum += c.duration_seconds || 0;
      if (c.direction === "incoming") e.inCount++;
      else if (c.direction === "outgoing") e.outCount++;
    }
    for (const p of pendings) {
      const name = p.artis_user_name || "— Unbekannt —";
      const e = ensure(name);
      e.pendings.push(p);
    }
    // Sortierung: Pending zuerst (unerledigt), dann nach Anzahl Anrufe
    return Array.from(m.values()).sort((a, b) => {
      if ((b.pendings.length > 0) !== (a.pendings.length > 0)) {
        return (b.pendings.length > 0) ? 1 : -1;
      }
      return b.count - a.count;
    });
  }, [calls, pendings]);

  // Default: alle offen
  React.useEffect(() => {
    setExpanded(prev => {
      const next = { ...prev };
      for (const g of byEmployee) if (next[g.name] === undefined) next[g.name] = true;
      return next;
    });
  }, [byEmployee]);

  const q = search.trim().toLowerCase();
  const matches = (g) => {
    if (!q) return true;
    if (g.name.toLowerCase().includes(q)) return true;
    const hay = [
      ...g.calls.map(c => [c.caller_number, c.callee_number, c.caller_name, c.callee_name, c.notes].filter(Boolean).join(" ")),
      ...g.pendings.map(p => [p.phone_number, p.note_title, p.note_text].filter(Boolean).join(" ")),
    ].join(" ").toLowerCase();
    return hay.includes(q);
  };
  const filtered = byEmployee.filter(matches);

  return (
    <div>
      {/* Suche */}
      <div style={{ marginBottom: 12, position: "relative", maxWidth: 420 }}>
        <Search size={13} style={{ position: "absolute", left: 8, top: 9, color: mutedCol }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Suche (Mitarbeiter, Nummer, Name, Notiz …)"
          style={{
            width: "100%", padding: "6px 8px 6px 26px", fontSize: 12.5,
            borderRadius: 7, border: `1px solid ${border}`, outline: "none",
            background: cardBg, color: headingCol,
          }}
        />
      </div>

      {filtered.length === 0 && (
        <div style={{ padding: 28, textAlign: "center", fontSize: 13, color: mutedCol, border: `1px dashed ${border}`, borderRadius: 10, background: cardBg }}>
          Keine Anrufe im gewählten Zeitraum.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {filtered.map(g => (
          <EmployeeSection
            key={g.name}
            group={g}
            expanded={!!expanded[g.name]}
            onToggle={() => setExpanded(s => ({ ...s, [g.name]: !s[g.name] }))}
            customerMap={customerMap}
            navigate={navigate}
            colors={colors}
          />
        ))}
      </div>
    </div>
  );
}

function EmployeeSection({ group, expanded, onToggle, customerMap, navigate, colors }) {
  const { cardBg, border, headingCol, subCol, mutedCol, accentIn, accentOut, rowHover } = colors;

  // Initialen für Avatar
  const initials = (group.name || "?")
    .replace(/—.*—/, "?")
    .split(/\s+/)
    .map(p => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // Merged Timeline: Anrufe + Pending-Notes nach Zeit sortiert
  const timeline = useMemo(() => {
    const items = [
      ...group.calls.map(c => ({ kind: "call",    ts: c.start_time, data: c })),
      ...group.pendings.map(p => ({ kind: "pending", ts: p.clicked_at, data: p })),
    ];
    return items.sort((a, b) => {
      const ta = a.ts ? new Date(a.ts).getTime() : 0;
      const tb = b.ts ? new Date(b.ts).getTime() : 0;
      return tb - ta;
    });
  }, [group]);

  return (
    <div style={{
      background: cardBg, border: `1px solid ${border}`, borderRadius: 12,
      overflow: "hidden",
    }}>
      {/* Header */}
      <div
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "12px 16px", cursor: "pointer",
          borderBottom: expanded ? `1px solid ${border}` : "none",
        }}
      >
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: "#5b21b6" + "22",
          color: "#5b21b6",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, fontWeight: 700, letterSpacing: ".02em", flexShrink: 0,
        }}>
          {initials || "?"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: headingCol }}>{group.name}</div>
          <div style={{ fontSize: 11.5, color: mutedCol, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span>{group.count} Anrufe</span>
            <span style={{ color: accentIn }}>↓ {group.inCount} ein</span>
            <span style={{ color: accentOut }}>↑ {group.outCount} aus</span>
            {group.pendings.length > 0 && (
              <span style={{ color: "#8a5a00", fontWeight: 600 }}>
                ● {group.pendings.length} Vorab-Notizen offen
              </span>
            )}
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: subCol, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
          {formatDuration(group.durSum)}
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div>
          {timeline.length === 0 && (
            <div style={{ padding: 18, fontSize: 12.5, color: mutedCol, textAlign: "center" }}>
              Keine Anrufe im Zeitraum.
            </div>
          )}
          {timeline.map((item, idx) =>
            item.kind === "call"
              ? <CallRow key={`c_${item.data.id}`} call={item.data} customerMap={customerMap} navigate={navigate} colors={colors} last={idx === timeline.length - 1} />
              : <PendingRow key={`p_${item.data.id}`} pending={item.data} customerMap={customerMap} navigate={navigate} colors={colors} last={idx === timeline.length - 1} />
          )}
        </div>
      )}
    </div>
  );
}

function CallRow({ call, customerMap, navigate, colors, last }) {
  const { border, headingCol, subCol, mutedCol, accentIn, accentOut, rowHover } = colors;
  const isIn  = call.direction === "incoming";
  const isOut = call.direction === "outgoing";
  const Icon  = isIn ? PhoneIncoming : isOut ? PhoneOutgoing : Phone;
  const iconCol = isIn ? accentIn : isOut ? accentOut : mutedCol;

  const ext     = isIn ? call.caller_number : call.callee_number;
  const extName = isIn ? call.caller_name   : call.callee_name;

  // Teams-Label: interner Teams-Call ohne PSTN-Nummer
  const isTeamsInternal = (!ext) && (call.call_type === "peerToPeer" || call.call_type === "group");

  const cust = call.customer_id ? customerMap.get(call.customer_id) : null;
  const custLabel = cust ? (cust.company_name || `${cust.vorname || ""} ${cust.name || ""}`.trim()) : null;

  return (
    <div
      onClick={() => cust && navigate(`/Kunden?customer=${cust.id}`)}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 16px",
        borderBottom: last ? "none" : `1px solid ${border}`,
        cursor: cust ? "pointer" : "default",
      }}
      onMouseEnter={e => { if (cust) e.currentTarget.style.backgroundColor = rowHover; }}
      onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
    >
      <div style={{
        flexShrink: 0, width: 28, height: 28, borderRadius: 8,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: iconCol + "22",
      }}>
        <Icon size={13} style={{ color: iconCol }} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: headingCol, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          {/* Primary label */}
          {isTeamsInternal ? (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              background: "#6264a7" + "22", color: "#464775",
              fontSize: 11, padding: "1px 7px", borderRadius: 10, fontWeight: 600,
            }}>
              <Video size={10} /> Teams
              {extName && <span style={{ fontWeight: 500, color: subCol }}> · {extName}</span>}
            </span>
          ) : (
            <span style={{ fontWeight: 500 }}>
              {custLabel || extName || ext || "—"}
            </span>
          )}
          {/* Nummer separat falls custLabel gewonnen hat */}
          {!isTeamsInternal && ext && custLabel && (
            <span style={{ fontSize: 11, color: mutedCol, fontVariantNumeric: "tabular-nums" }}>{ext}</span>
          )}
          {/* Badges */}
          {cust && (
            <span style={{ fontSize: 9.5, color: "#2a7a5a", border: "1px solid #2a7a5a55", padding: "0 5px", borderRadius: 3 }}>
              Kunde
            </span>
          )}
          {!cust && ext && !isTeamsInternal && (
            <span style={{ fontSize: 9.5, color: "#a05050", border: "1px solid #a0505055", padding: "0 5px", borderRadius: 3 }}>
              unzugeordnet
            </span>
          )}
        </div>

        <div style={{ fontSize: 10.5, color: mutedCol, marginTop: 2 }}>
          {isIn ? "Eingehend" : isOut ? "Ausgehend" : "Anruf"}
          {call.start_time && ` · ${format(new Date(call.start_time), "dd.MM.yyyy HH:mm", { locale: de })}`}
          {call.notes && <span style={{ marginLeft: 6, fontStyle: "italic" }}>• {call.notes.slice(0, 120)}{call.notes.length > 120 ? "…" : ""}</span>}
        </div>
      </div>

      {!!call.duration_seconds && (
        <div style={{ fontSize: 11, color: subCol, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
          {formatDuration(call.duration_seconds)}
        </div>
      )}
    </div>
  );
}

function PendingRow({ pending, customerMap, navigate, colors, last }) {
  const { border, headingCol, subCol, mutedCol, rowHover } = colors;
  const cust = pending.customer_id ? customerMap.get(pending.customer_id) : null;
  const custLabel = cust ? (cust.company_name || `${cust.vorname || ""} ${cust.name || ""}`.trim()) : null;

  return (
    <div
      onClick={() => cust && navigate(`/Kunden?customer=${cust.id}`)}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 16px",
        borderBottom: last ? "none" : `1px solid ${border}`,
        cursor: cust ? "pointer" : "default",
        background: "#fffbee",
      }}
      onMouseEnter={e => { if (cust) e.currentTarget.style.backgroundColor = "#fff6d8"; }}
      onMouseLeave={e => { e.currentTarget.style.backgroundColor = "#fffbee"; }}
    >
      <div style={{
        flexShrink: 0, width: 28, height: 28, borderRadius: 8,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "#fff4d0",
      }}>
        <Hourglass size={13} style={{ color: "#8a5a00" }} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: headingCol, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 500 }}>
            {custLabel || pending.phone_number}
          </span>
          {custLabel && (
            <span style={{ fontSize: 11, color: mutedCol, fontVariantNumeric: "tabular-nums" }}>{pending.phone_number}</span>
          )}
          <span style={{ fontSize: 9.5, color: "#8a5a00", background: "#fff4d0", padding: "1px 6px", borderRadius: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>
            Vorab-Notiz · nicht verknüpft
          </span>
        </div>
        <div style={{ fontSize: 10.5, color: mutedCol, marginTop: 2 }}>
          Klick: {pending.clicked_at && format(new Date(pending.clicked_at), "dd.MM.yyyy HH:mm", { locale: de })}
          {pending.note_title && <span style={{ marginLeft: 6, fontStyle: "italic" }}>• {pending.note_title}</span>}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// STATS-ANSICHT  (optional – altes Dashboard)
// ══════════════════════════════════════════════════════════════════
function StatsView({ calls, allCalls, customerMap, navigate, colors }) {
  const { cardBg, border, headingCol, subCol, mutedCol, accent, accentIn, accentOut, inputBg, rowHover, chartGrid } = colors;

  const kpi = useMemo(() => {
    const agg = { today: 0, week: 0, month: 0, totalDur: 0, incoming: 0, outgoing: 0, matched: 0, unmatched: 0 };
    for (const c of calls) {
      if (!c.start_time) continue;
      const d = new Date(c.start_time);
      if (isToday(d)) agg.today++;
      if (isThisWeek(d, { weekStartsOn: 1 })) agg.week++;
      if (isThisMonth(d)) agg.month++;
      agg.totalDur += c.duration_seconds || 0;
      if (c.direction === "incoming") agg.incoming++;
      else if (c.direction === "outgoing") agg.outgoing++;
      if (c.customer_id) agg.matched++;
      else agg.unmatched++;
    }
    return agg;
  }, [calls]);

  const chartData = useMemo(() => {
    const days = new Map();
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = startOfDay(new Date(now.getTime() - i * 86400_000));
      days.set(d.toISOString().slice(0, 10), { day: format(d, "dd.MM."), in: 0, out: 0 });
    }
    for (const c of allCalls) {
      if (!c.start_time) continue;
      const key = c.start_time.slice(0, 10);
      const slot = days.get(key);
      if (!slot) continue;
      if (c.direction === "incoming") slot.in++;
      else if (c.direction === "outgoing") slot.out++;
    }
    return Array.from(days.values());
  }, [allCalls]);

  const byEmployee = useMemo(() => {
    const m = new Map();
    for (const c of calls) {
      const name = c.artis_user_name || "Unbekannt";
      const cur = m.get(name) || { name, count: 0, dur: 0, in: 0, out: 0 };
      cur.count++;
      cur.dur += c.duration_seconds || 0;
      if (c.direction === "incoming") cur.in++;
      else if (c.direction === "outgoing") cur.out++;
      m.set(name, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.dur - a.dur).slice(0, 10);
  }, [calls]);

  const topCustomers = useMemo(() => {
    const m = new Map();
    for (const c of calls) {
      if (!c.customer_id) continue;
      const cur = m.get(c.customer_id) || { id: c.customer_id, count: 0, dur: 0 };
      cur.count++;
      cur.dur += c.duration_seconds || 0;
      m.set(c.customer_id, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.dur - a.dur).slice(0, 10);
  }, [calls]);

  const unmatchedNumbers = useMemo(() => {
    const m = new Map();
    for (const c of calls) {
      if (c.customer_id) continue;
      const num = c.direction === "incoming" ? c.caller_number : c.callee_number;
      const name = c.direction === "incoming" ? c.caller_name : c.callee_name;
      if (!num) continue;
      const cur = m.get(num) || { number: num, name: name || null, count: 0, dur: 0, last: null };
      cur.count++;
      cur.dur += c.duration_seconds || 0;
      if (c.start_time && (!cur.last || c.start_time > cur.last)) cur.last = c.start_time;
      if (!cur.name && name) cur.name = name;
      m.set(num, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count).slice(0, 15);
  }, [calls]);

  const [search, setSearch] = useState("");
  const [dirFilter, setDirFilter] = useState("all");
  const [empFilter, setEmpFilter] = useState("");

  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return calls.filter(c => {
      if (dirFilter === "in"        && c.direction !== "incoming") return false;
      if (dirFilter === "out"       && c.direction !== "outgoing") return false;
      if (dirFilter === "matched"   && !c.customer_id) return false;
      if (dirFilter === "unmatched" && c.customer_id) return false;
      if (empFilter && c.artis_user_name !== empFilter) return false;
      if (!q) return true;
      const cust = c.customer_id ? customerMap.get(c.customer_id) : null;
      const custName = cust ? `${cust.company_name || ""} ${cust.vorname || ""} ${cust.name || ""}` : "";
      const hay = [
        c.caller_number, c.callee_number, c.caller_name, c.callee_name,
        c.artis_user_name, c.notes, custName,
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    }).slice(0, 500);
  }, [calls, search, dirFilter, empFilter, customerMap]);

  const employeeOptions = useMemo(() => {
    const s = new Set();
    for (const c of calls) if (c.artis_user_name) s.add(c.artis_user_name);
    return Array.from(s).sort();
  }, [calls]);

  return (
    <div>
      {/* KPI */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
        <Kpi label="Heute"         value={kpi.today}    icon={Phone}      color={accent}  {...{ cardBg, border, headingCol, subCol }} />
        <Kpi label="Diese Woche"   value={kpi.week}     icon={TrendingUp} color="#3b6a8a" {...{ cardBg, border, headingCol, subCol }} />
        <Kpi label="Diesen Monat"  value={kpi.month}    icon={TrendingUp} color="#8a6a3b" {...{ cardBg, border, headingCol, subCol }} />
        <Kpi label="Gesamtzeit"    value={formatDuration(kpi.totalDur)} icon={Clock} color="#6a5b8a" {...{ cardBg, border, headingCol, subCol }} small />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <Kpi label="Eingehend"     value={kpi.incoming}  icon={PhoneIncoming} color={accentIn}  {...{ cardBg, border, headingCol, subCol }} />
        <Kpi label="Ausgehend"     value={kpi.outgoing}  icon={PhoneOutgoing} color={accentOut} {...{ cardBg, border, headingCol, subCol }} />
        <Kpi label="Zugeordnet"    value={kpi.matched}   icon={UserCheck}     color="#2a7a5a"   {...{ cardBg, border, headingCol, subCol }} />
        <Kpi label="Unzugeordnet"  value={kpi.unmatched} icon={UserX}         color="#a05050"   {...{ cardBg, border, headingCol, subCol }} />
      </div>

      {/* Chart + Mitarbeiter */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 16 }}>
        <Card title="Anrufe pro Tag (letzte 30 Tage – alle)" {...{ cardBg, border, headingCol, subCol }}>
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10.5, fill: mutedCol }} interval={3} />
                <YAxis tick={{ fontSize: 10.5, fill: mutedCol }} allowDecimals={false} />
                <RTooltip
                  contentStyle={{ backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: headingCol }}
                />
                <Bar dataKey="in"  stackId="a" name="Eingehend" fill={accentIn}  radius={[0, 0, 0, 0]} />
                <Bar dataKey="out" stackId="a" name="Ausgehend" fill={accentOut} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Top Mitarbeiter" {...{ cardBg, border, headingCol, subCol }}>
          {byEmployee.length === 0 && <div style={{ fontSize: 12, color: mutedCol }}>Noch keine Anrufe</div>}
          {byEmployee.map((e, i) => (
            <div key={e.name} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 0",
              borderBottom: i < byEmployee.length - 1 ? `1px solid ${border}` : "none",
            }}>
              <div style={{ fontSize: 11, color: mutedCol, width: 18 }}>#{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: headingCol, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.name}
                </div>
                <div style={{ fontSize: 10.5, color: mutedCol }}>
                  {e.count} Anrufe · {e.in} ein / {e.out} aus
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: subCol, fontVariantNumeric: "tabular-nums" }}>
                {formatDuration(e.dur)}
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* Top Kunden + Unzugeordnet */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <Card title="Top 10 Kunden nach Gesprächszeit" {...{ cardBg, border, headingCol, subCol }}>
          {topCustomers.length === 0 && <div style={{ fontSize: 12, color: mutedCol }}>Noch keine zugeordneten Anrufe</div>}
          {topCustomers.map((row, i) => {
            const cust = customerMap.get(row.id);
            const label = cust ? (cust.company_name || `${cust.vorname || ""} ${cust.name || ""}`.trim() || "—") : "—";
            return (
              <div key={row.id}
                onClick={() => navigate(`/Kunden?customer=${row.id}`)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 8px", margin: "0 -8px",
                  borderRadius: 6, cursor: "pointer",
                  borderBottom: i < topCustomers.length - 1 ? `1px solid ${border}` : "none",
                }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = rowHover}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = "transparent"}
              >
                <div style={{ fontSize: 11, color: mutedCol, width: 18 }}>#{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: headingCol, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 10.5, color: mutedCol }}>{row.count} Anrufe</div>
                </div>
                <div style={{ fontSize: 11.5, color: subCol, fontVariantNumeric: "tabular-nums" }}>
                  {formatDuration(row.dur)}
                </div>
                <ExternalLink size={11} style={{ color: mutedCol }} />
              </div>
            );
          })}
        </Card>

        <Card title="Häufigste unzugeordnete Nummern" {...{ cardBg, border, headingCol, subCol }}>
          {unmatchedNumbers.length === 0 && <div style={{ fontSize: 12, color: mutedCol }}>Alle Anrufe sind zugeordnet 🎉</div>}
          {unmatchedNumbers.map((row, i) => (
            <div key={row.number} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "7px 0",
              borderBottom: i < unmatchedNumbers.length - 1 ? `1px solid ${border}` : "none",
            }}>
              <div style={{ fontSize: 11, color: mutedCol, width: 18 }}>#{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: headingCol, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
                  {row.number}
                </div>
                <div style={{ fontSize: 10.5, color: mutedCol }}>
                  {row.name ? `${row.name} · ` : ""}{row.count}× · letzter: {row.last ? format(new Date(row.last), "dd.MM.", { locale: de }) : "—"}
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: subCol, fontVariantNumeric: "tabular-nums" }}>
                {formatDuration(row.dur)}
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* Liste */}
      <Card title="Alle Anrufe im Zeitraum" {...{ cardBg, border, headingCol, subCol }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: "1 1 240px", minWidth: 200 }}>
            <Search size={13} style={{ position: "absolute", left: 8, top: 8, color: mutedCol }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Suchen (Nummer, Name, Kunde, Notiz …)"
              style={{
                width: "100%", padding: "6px 8px 6px 26px",
                borderRadius: 6, border: `1px solid ${border}`,
                fontSize: 12, outline: "none",
                background: inputBg, color: headingCol,
              }}
            />
          </div>
          <select value={dirFilter} onChange={e => setDirFilter(e.target.value)}
            style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${border}`, fontSize: 12, background: inputBg, color: headingCol }}>
            <option value="all">Alle Richtungen</option>
            <option value="in">Nur eingehend</option>
            <option value="out">Nur ausgehend</option>
            <option value="matched">Nur zugeordnet</option>
            <option value="unmatched">Nur unzugeordnet</option>
          </select>
          <select value={empFilter} onChange={e => setEmpFilter(e.target.value)}
            style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${border}`, fontSize: 12, background: inputBg, color: headingCol, minWidth: 160 }}>
            <option value="">Alle Mitarbeitenden</option>
            {employeeOptions.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <div style={{ fontSize: 11.5, color: mutedCol, alignSelf: "center" }}>
            {filteredList.length} Treffer{filteredList.length >= 500 ? " (gekürzt)" : ""}
          </div>
        </div>

        <div style={{ maxHeight: 520, overflowY: "auto", margin: "0 -4px" }}>
          {filteredList.map(c => {
            const cust = c.customer_id ? customerMap.get(c.customer_id) : null;
            const custLabel = cust ? (cust.company_name || `${cust.vorname || ""} ${cust.name || ""}`.trim()) : null;
            const isIn = c.direction === "incoming";
            const isOut = c.direction === "outgoing";
            const Icon = isIn ? PhoneIncoming : isOut ? PhoneOutgoing : Phone;
            const iconCol = isIn ? accentIn : isOut ? accentOut : mutedCol;
            const ext = isIn ? c.caller_number : c.callee_number;
            const extName = isIn ? c.caller_name : c.callee_name;
            return (
              <div key={c.id}
                onClick={() => cust && navigate(`/Kunden?customer=${cust.id}`)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 6px",
                  borderBottom: `1px solid ${border}`,
                  cursor: cust ? "pointer" : "default",
                }}
                onMouseEnter={e => { if (cust) e.currentTarget.style.backgroundColor = rowHover; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                <div style={{
                  flexShrink: 0, width: 26, height: 26, borderRadius: 6,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: iconCol + "22",
                }}>
                  <Icon size={12} style={{ color: iconCol }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: headingCol, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 500 }}>
                      {custLabel || extName || ext || "—"}
                    </span>
                    {ext && <span style={{ color: mutedCol, fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{ext}</span>}
                    {!cust && ext && (
                      <span style={{ fontSize: 9.5, color: "#a05050", border: "1px solid #a0505055", padding: "0 4px", borderRadius: 3 }}>
                        unzugeordnet
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10.5, color: mutedCol, marginTop: 1 }}>
                    {c.artis_user_name || "—"} · {c.start_time && format(new Date(c.start_time), "dd.MM.yyyy HH:mm", { locale: de })}
                    {c.notes && <span style={{ marginLeft: 6, fontStyle: "italic" }}>• {c.notes.slice(0, 80)}{c.notes.length > 80 ? "…" : ""}</span>}
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: subCol, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                  {formatDuration(c.duration_seconds || 0)}
                </div>
              </div>
            );
          })}
          {filteredList.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", fontSize: 12.5, color: mutedCol }}>
              Keine Anrufe entsprechen dem Filter.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// UI-Helpers
// ══════════════════════════════════════════════════════════════════
function ViewTab({ active, onClick, icon: Icon, label, activeBg, col, mutedCol }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "5px 10px", fontSize: 12, fontWeight: 600,
        border: "none", background: active ? activeBg : "transparent",
        color: active ? col : mutedCol,
        borderRadius: 6, cursor: "pointer",
      }}
    >
      <Icon size={12} /> {label}
    </button>
  );
}

function RangeTab({ active, onClick, label, activeBg, col, mutedCol }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 10px", fontSize: 12, fontWeight: 600,
        border: "none", background: active ? activeBg : "transparent",
        color: active ? col : mutedCol,
        borderRadius: 6, cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function Kpi({ label, value, icon: Icon, color, small, cardBg, border, headingCol, subCol }) {
  return (
    <div style={{
      background: cardBg, border: `1px solid ${border}`, borderRadius: 10,
      padding: "12px 14px", display: "flex", alignItems: "center", gap: 10,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 8,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: color + "22", color,
      }}>
        <Icon size={17} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: subCol, fontWeight: 500, textTransform: "uppercase", letterSpacing: ".03em" }}>
          {label}
        </div>
        <div style={{ fontSize: small ? 18 : 22, fontWeight: 700, color: headingCol, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
          {value}
        </div>
      </div>
    </div>
  );
}

function Card({ title, children, cardBg, border, headingCol, subCol }) {
  return (
    <div style={{
      background: cardBg, border: `1px solid ${border}`, borderRadius: 10,
      padding: 14,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: headingCol, marginBottom: 10, textTransform: "uppercase", letterSpacing: ".04em" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function formatDuration(sec) {
  if (!sec && sec !== 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}min`;
  if (m > 0) return `${m}:${String(s).padStart(2, "0")} min`;
  return `${s}s`;
}
