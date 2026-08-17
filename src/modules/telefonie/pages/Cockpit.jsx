import React, { useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PhoneIncoming, PhoneOutgoing, PhoneMissed, Phone, Clock, Radio, Users, Settings2,
} from "lucide-react";
import { format, isToday } from "date-fns";
import { de } from "date-fns/locale";
import { supabase, entities } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { ThemeContext } from "@/Layout";
import { isMissed } from "@/lib/chartisTheme";
import PersonAvatar from "@/components/ui/PersonAvatar";
import { tele, PRESENCE, formatPhone } from "../theme";
import { useTelephony } from "../context/TelephonyContext";

function fmtDur(sec) {
  if (!sec && sec !== 0) return "—";
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

export default function Cockpit() {
  const { theme } = useContext(ThemeContext);
  const t = tele(theme);
  const { profile } = useAuth();
  const { effectivePresence, teamPresence, dial, simulateIncoming } = useTelephony();
  const me = profile?.full_name || "";

  const { data: calls = [] } = useQuery({
    queryKey: ["tele-calls"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("call_records")
        .select("id, direction, call_type, caller_number, callee_number, caller_name, callee_name, artis_user_name, customer_id, start_time, duration_seconds, missed")
        .order("start_time", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return data || [];
    },
    staleTime: 60_000,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["tele-customers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, company_name, vorname, name").limit(5000);
      if (error) throw new Error(error.message);
      return data || [];
    },
    staleTime: 5 * 60_000,
  });
  const custMap = useMemo(() => { const m = new Map(); for (const c of customers) m.set(c.id, c); return m; }, [customers]);

  const { data: staff = [] } = useQuery({
    queryKey: ["tele-staff"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("chartis_list_staff");
      if (error) return [];
      return data || [];
    },
    staleTime: 5 * 60_000,
  });

  // Voller Kundenstamm (mit Telefonnummern) — nur für den Test-Anruf-Knopf;
  // gleicher queryKey wie useDossier/Telefonliste → React Query dedupliziert.
  const { data: custFull = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () => entities.Customer.list("company_name"),
    staleTime: 5 * 60_000,
  });
  const testCall = () => {
    const c = (custFull || []).find((x) => x.phone && x.aktiv !== false) || (custFull || []).find((x) => x.phone);
    simulateIncoming(
      c
        ? { id: "sim-" + Date.now(), dir: "in", status: "ringing", peerNumber: c.phone, peerName: c.company_name || null, customer: null, viaNumber: "+41 71 511 22 33" }
        : undefined
    );
  };

  const kpi = useMemo(() => {
    const today = calls.filter((c) => c.start_time && isToday(new Date(c.start_time)));
    const missed = today.filter(isMissed).length;
    const withDur = today.filter((c) => c.duration_seconds > 0);
    const talk = withDur.reduce((a, c) => a + c.duration_seconds, 0);
    const avg = withDur.length ? Math.round(talk / withDur.length) : 0;
    const inc = today.filter((c) => c.direction === "incoming").length;
    const out = today.filter((c) => c.direction === "outgoing").length;
    return { count: today.length, missed, avg, talk, inc, out };
  }, [calls]);

  // Team sortiert: wer live verbunden ist (echte Presence) zuerst, Rest alphabetisch.
  const sortedStaff = useMemo(() => {
    return [...staff].sort((a, b) => {
      const pa = !!teamPresence[a.id], pb = !!teamPresence[b.id];
      if (pa !== pb) return pa ? -1 : 1;
      return (a.full_name || "").localeCompare(b.full_name || "");
    });
  }, [staff, teamPresence]);
  const onlineCount = useMemo(() => staff.filter((s) => !!teamPresence[s.id]).length, [staff, teamPresence]);

  const recent = calls.slice(0, 8);
  const custLabel = (c) => { const x = c.customer_id ? custMap.get(c.customer_id) : null; return x ? (x.company_name || `${x.vorname || ""} ${x.name || ""}`.trim()) : null; };

  return (
    <div style={{ padding: "22px 26px", maxWidth: 1080, margin: "0 auto" }}>
      {/* Kopf */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ fontSize: 21, fontWeight: 750, margin: 0, color: t.textPrimary, letterSpacing: "-.015em" }}>Cockpit</h1>
          <p style={{ fontSize: 12.5, color: t.textMuted, margin: "3px 0 0" }}>
            {format(new Date(), "EEEE, d. MMMM yyyy", { locale: de })} · Hauptnummer +41 71 511 22 33
          </p>
        </div>
        <button onClick={testCall} title="Eingehenden Test-Anruf simulieren — zeigt das Screen-Pop-Dossier"
          style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 650, color: t.accent, background: t.accentSoft, border: `1px solid ${t.accent}44`, padding: "6px 12px", borderRadius: 999, cursor: "pointer" }}>
          <PhoneIncoming size={14} /> Test-Anruf
        </button>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 650, color: t.textSecondary, background: t.raised, border: `1px solid ${t.borderSubtle}`, padding: "6px 12px", borderRadius: 999 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.presence[(PRESENCE[effectivePresence] || PRESENCE.available).dot] }} />
          {(PRESENCE[effectivePresence] || PRESENCE.available).label}
        </span>
      </div>

      {/* KPI */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 18 }}>
        <Kpi t={t} label="Heute" value={kpi.count} sub={`${kpi.inc} ein · ${kpi.out} aus`} icon={Phone} color={t.accent} />
        <Kpi t={t} label="Verpasst" value={kpi.missed} sub="heute" icon={PhoneMissed} color={t.missed} />
        <Kpi t={t} label="Ø Dauer" value={fmtDur(kpi.avg)} sub="min:sek" icon={Clock} color={t.out} mono />
        <Kpi t={t} label="Gesprächszeit" value={`${Math.round(kpi.talk / 60)} min`} sub="heute" icon={Clock} color={t.in} />
      </div>

      {/* Team + Rufgruppe */}
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 16, marginBottom: 16 }}>
        <Panel t={t} title="Team & Presence" icon={Users} right={`${onlineCount}/${staff.length || 0} online`}>
          {staff.length === 0 && <Empty t={t}>Mitarbeiterliste wird geladen …</Empty>}
          {sortedStaff.map((s) => {
            const isMe = s.full_name === me;
            const live = teamPresence[s.id];
            // Eigener Status kommt direkt aus effectivePresence (bleibt auch
            // beim allerersten Render korrekt, bevor der Presence-Sync durch
            // ist); Kolleg:innen zeigen ihren echten Live-Status aus teamPresence.
            const info = isMe ? (PRESENCE[effectivePresence] || PRESENCE.available)
              : live ? (PRESENCE[live.status] || PRESENCE.available) : null;
            const dot = info ? t.presence[info.dot] : t.presence.offline;
            return (
              <div key={s.id}
                style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 14px", borderBottom: `1px solid ${t.borderSubtle}`, transition: "background .12s" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = t.activeRow)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <PersonAvatar user={s} size={34} radius={11}>
                  <span style={{ position: "absolute", right: -2, bottom: -2, width: 12, height: 12, borderRadius: "50%", background: dot, border: `2px solid ${t.raised}` }} />
                </PersonAvatar>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 650, color: t.textPrimary }}>{s.full_name}{isMe && <span style={{ color: t.textMuted, fontWeight: 500 }}> · Du</span>}</div>
                  <div style={{ fontSize: 11, color: info ? t.textSecondary : t.textMuted, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot }} />
                    {info ? info.label : "nicht in smartis angemeldet"}
                  </div>
                </div>
              </div>
            );
          })}
        </Panel>

        <Panel t={t} title="Rufgruppe · Sekretariat" icon={Radio} right="aktiv">
          <div style={{ padding: "14px 16px", fontSize: 12.5, color: t.textSecondary, lineHeight: 1.9 }}>
            <Row t={t} k="Nummer"><span style={{ fontFamily: "ui-monospace, monospace" }}>+41 71 511 22 33</span></Row>
            <Row t={t} k="Klingelt bei">
              <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                {["Petra", "Roger", "Sascha"].map((n) => (
                  <span key={n} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, background: t.sunken, border: `1px solid ${t.borderSubtle}`, padding: "2px 8px", borderRadius: 999 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.presence.online }} />{n}
                  </span>
                ))}
              </span>
            </Row>
            <Row t={t} k="Strategie">Alle gleichzeitig · 25 Sek</Row>
            <Row t={t} k="Fallback">→ Voicemail</Row>
            <div style={{ marginTop: 12, fontSize: 11, color: t.textMuted, fontStyle: "italic" }}>
              Konfiguration folgt (Tabelle <code>phone_ring_groups</code>).
            </div>
          </div>
        </Panel>
      </div>

      {/* Anrufverlauf */}
      <Panel t={t} title="Anrufverlauf" icon={Clock} right="zuletzt">
        {recent.length === 0 && <Empty t={t}>Noch keine Anrufe.</Empty>}
        {recent.map((c) => {
          const miss = isMissed(c);
          const isIn = c.direction === "incoming";
          const Icon = miss ? PhoneMissed : isIn ? PhoneIncoming : PhoneOutgoing;
          const col = miss ? t.missed : isIn ? t.in : t.out;
          const ext = isIn ? c.caller_number : c.callee_number;
          const name = custLabel(c) || (isIn ? c.caller_name : c.callee_name) || ext || "Unbekannt";
          return (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: `1px solid ${t.borderSubtle}` }}>
              <span style={{ width: 30, height: 30, borderRadius: 9, background: col + "22", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <Icon size={15} style={{ color: col }} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 650, color: t.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                <div style={{ fontSize: 11, color: t.textMuted }}>
                  {c.artis_user_name || "—"} · {c.start_time && format(new Date(c.start_time), "dd.MM. HH:mm", { locale: de })}
                </div>
              </div>
              {!!c.duration_seconds && <span style={{ fontSize: 11.5, color: t.textMuted, fontFamily: "ui-monospace, monospace" }}>{fmtDur(c.duration_seconds)}</span>}
              {ext && (
                <button onClick={() => dial(formatPhone(ext), { name })} title="Rückruf" style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${t.borderStrong}`, background: t.raised, cursor: "pointer", color: t.accent, display: "grid", placeItems: "center", flexShrink: 0 }}>
                  <Phone size={14} />
                </button>
              )}
            </div>
          );
        })}
      </Panel>

      <div style={{ marginTop: 14, fontSize: 11, color: t.textMuted, display: "flex", alignItems: "center", gap: 7 }}>
        <Settings2 size={13} /> Anrufe stammen aktuell aus dem Teams-Sync (read-only). Eigene Telefonie folgt mit peoplefone vPBX + CONNECTOR-Anbindung.
      </div>
    </div>
  );
}

function Kpi({ t, label, value, sub, icon: Icon, color, mono }) {
  return (
    <div style={{ background: t.raised, border: `1px solid ${t.borderSubtle}`, borderRadius: 14, padding: "13px 15px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ width: 26, height: 26, borderRadius: 7, background: color + "22", color, display: "grid", placeItems: "center" }}><Icon size={14} /></span>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: t.textMuted }}>{label}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 750, color: t.textPrimary, lineHeight: 1, fontFamily: mono ? "ui-monospace, monospace" : undefined, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 11, color: t.textMuted, marginTop: 5 }}>{sub}</div>
    </div>
  );
}

function Panel({ t, title, icon: Icon, right, children }) {
  return (
    <div style={{ background: t.raised, border: `1px solid ${t.borderSubtle}`, borderRadius: 16, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 16px", borderBottom: `1px solid ${t.borderSubtle}` }}>
        {Icon && <Icon size={16} style={{ color: t.accent }} />}
        <span style={{ fontSize: 13, fontWeight: 700, color: t.textPrimary }}>{title}</span>
        {right && <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: t.textMuted }}>{right}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({ t, k, children }) {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <span style={{ width: 92, flexShrink: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: t.textMuted }}>{k}</span>
      <span style={{ color: t.textPrimary, fontWeight: 600 }}>{children}</span>
    </div>
  );
}

function Empty({ t, children }) {
  return <div style={{ padding: 22, textAlign: "center", fontSize: 12.5, color: t.textMuted }}>{children}</div>;
}
