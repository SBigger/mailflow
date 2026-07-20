import React, { useContext, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PhoneIncoming, PhoneOutgoing, PhoneMissed, Phone, Radio, Users,
  Voicemail as VoicemailIcon, Info, Check,
} from "lucide-react";
import { format, isToday } from "date-fns";
import { de } from "date-fns/locale";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { ThemeContext } from "@/Layout";
import { isMissed, initials } from "@/lib/chartisTheme";
import { tele, PRESENCE, formatPhone } from "../theme";
import { useTelephony } from "../context/TelephonyContext";

// ── gemeinsame Helfer ─────────────────────────────────────────────────────
function useT() { const { theme } = useContext(ThemeContext); return tele(theme); }
function fmtDur(sec) { if (!sec && sec !== 0) return "—"; const m = Math.floor(sec / 60), s = sec % 60; return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`; }

function Page({ t, title, subtitle, children }) {
  return (
    <div style={{ padding: "22px 26px", maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 21, fontWeight: 750, margin: 0, color: t.textPrimary, letterSpacing: "-.015em" }}>{title}</h1>
      {subtitle && <p style={{ fontSize: 12.5, color: t.textMuted, margin: "3px 0 18px" }}>{subtitle}</p>}
      {!subtitle && <div style={{ height: 18 }} />}
      {children}
    </div>
  );
}
function Panel({ t, children, style }) {
  return <div style={{ background: t.raised, border: `1px solid ${t.borderSubtle}`, borderRadius: 16, overflow: "hidden", ...style }}>{children}</div>;
}
function Note({ t, children }) {
  return (
    <div style={{ marginTop: 14, display: "flex", alignItems: "flex-start", gap: 8, fontSize: 11.5, color: t.textMuted, background: t.raised, border: `1px solid ${t.borderSubtle}`, borderRadius: 12, padding: "11px 13px", lineHeight: 1.5 }}>
      <Info size={14} style={{ color: t.accent, flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </div>
  );
}

// ── Anrufverlauf ──────────────────────────────────────────────────────────
export function Verlauf() {
  const t = useT();
  const { dial } = useTelephony();
  const [q, setQ] = useState("");

  const { data: calls = [] } = useQuery({
    queryKey: ["tele-calls"],
    queryFn: async () => {
      const { data } = await supabase.from("call_records")
        .select("id, direction, caller_number, callee_number, caller_name, callee_name, artis_user_name, customer_id, start_time, duration_seconds, missed")
        .order("start_time", { ascending: false }).limit(500);
      return data || [];
    },
    staleTime: 60_000,
  });
  const { data: customers = [] } = useQuery({
    queryKey: ["tele-customers"],
    queryFn: async () => { const { data } = await supabase.from("customers").select("id, company_name, vorname, name").limit(5000); return data || []; },
    staleTime: 5 * 60_000,
  });
  const custMap = useMemo(() => { const m = new Map(); for (const c of customers) m.set(c.id, c); return m; }, [customers]);
  const label = (c) => { const x = c.customer_id ? custMap.get(c.customer_id) : null; return x ? (x.company_name || `${x.vorname || ""} ${x.name || ""}`.trim()) : null; };

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return calls.filter((c) => {
      if (!s) return true;
      return [c.caller_number, c.callee_number, c.caller_name, c.callee_name, c.artis_user_name, label(c)].filter(Boolean).join(" ").toLowerCase().includes(s);
    }).slice(0, 200);
  }, [calls, q, custMap]);

  return (
    <Page t={t} title="Anrufverlauf" subtitle={`${calls.length} Anrufe · aus dem Teams-Sync (read-only)`}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen (Name, Nummer, Mitarbeiter …)"
        style={{ width: "100%", maxWidth: 380, padding: "8px 12px", borderRadius: 9, border: `1px solid ${t.borderStrong}`, background: t.raised, color: t.textPrimary, font: "inherit", fontSize: 13, marginBottom: 14, outline: "none" }} />
      <Panel t={t}>
        {list.length === 0 && <div style={{ padding: 24, textAlign: "center", fontSize: 12.5, color: t.textMuted }}>Keine Treffer.</div>}
        {list.map((c) => {
          const miss = isMissed(c), isIn = c.direction === "incoming";
          const Icon = miss ? PhoneMissed : isIn ? PhoneIncoming : PhoneOutgoing;
          const col = miss ? t.missed : isIn ? t.in : t.out;
          const ext = isIn ? c.caller_number : c.callee_number;
          const name = label(c) || (isIn ? c.caller_name : c.callee_name) || ext || "Unbekannt";
          return (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: `1px solid ${t.borderSubtle}` }}>
              <span style={{ width: 30, height: 30, borderRadius: 9, background: col + "22", display: "grid", placeItems: "center", flexShrink: 0 }}><Icon size={15} style={{ color: col }} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 650, color: t.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}{miss && <span style={{ color: t.missed, fontSize: 10.5, fontWeight: 700, marginLeft: 8 }}>verpasst</span>}</div>
                <div style={{ fontSize: 11, color: t.textMuted }}>{c.artis_user_name || "—"} · {c.start_time && format(new Date(c.start_time), "dd.MM.yyyy HH:mm", { locale: de })}</div>
              </div>
              {!!c.duration_seconds && <span style={{ fontSize: 11.5, color: t.textMuted, fontFamily: "ui-monospace, monospace" }}>{fmtDur(c.duration_seconds)}</span>}
              {ext && <button onClick={() => dial(formatPhone(ext), { name })} title="Anrufen" style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${t.borderStrong}`, background: t.raised, cursor: "pointer", color: t.accent, display: "grid", placeItems: "center", flexShrink: 0 }}><Phone size={14} /></button>}
            </div>
          );
        })}
      </Panel>
    </Page>
  );
}

// ── Rufgruppen ────────────────────────────────────────────────────────────
export function Rufgruppen() {
  const t = useT();
  const rows = [
    ["Nummer", "+41 71 511 22 33"], ["Klingelt bei", "Petra · Roger · Sascha"],
    ["Strategie", "Alle gleichzeitig · 25 Sek"], ["Geschäftszeit", "Mo–Fr 08–12 / 13–17"],
    ["Fallback", "→ Voicemail „Sekretariat“"], ["Ausserhalb", "→ Weiterleitung Mobile"],
  ];
  return (
    <Page t={t} title="Rufgruppen" subtitle="Wer klingelt bei welcher Nummer">
      <Panel t={t}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 16px", borderBottom: `1px solid ${t.borderSubtle}` }}>
          <Radio size={16} style={{ color: t.accent }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: t.textPrimary }}>Sekretariat</span>
          <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 700, color: t.presence.online, background: t.presence.online + "22", padding: "2px 9px", borderRadius: 999 }}>aktiv</span>
        </div>
        <div style={{ padding: "8px 16px 14px" }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: `1px dashed ${t.borderSubtle}` }}>
              <span style={{ width: 108, flexShrink: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: t.textMuted }}>{k}</span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: t.textPrimary, fontFamily: k === "Nummer" ? "ui-monospace, monospace" : undefined }}>{v}</span>
            </div>
          ))}
        </div>
      </Panel>
      <Note t={t}>Beispiel-Konfiguration. Die echte Verwaltung (mehrere Gruppen, Mitglieder, Zeiten, Fallback) kommt mit der Tabelle <code>phone_ring_groups</code> und dem Call-Router auf der Test-VM.</Note>
    </Page>
  );
}

// ── Team & Presence ───────────────────────────────────────────────────────
export function TeamPresence() {
  const t = useT();
  const { profile } = useAuth();
  const { effectivePresence } = useTelephony();
  const me = profile?.full_name || "";
  const { data: staff = [] } = useQuery({
    queryKey: ["tele-staff"],
    queryFn: async () => { const { data, error } = await supabase.rpc("chartis_list_staff"); if (error) return []; return data || []; },
    staleTime: 5 * 60_000,
  });
  return (
    <Page t={t} title="Team & Presence" subtitle="Wer ist erreichbar">
      <Panel t={t}>
        {staff.length === 0 && <div style={{ padding: 24, textAlign: "center", fontSize: 12.5, color: t.textMuted }}>Mitarbeiterliste wird geladen …</div>}
        {staff.map((s) => {
          const isMe = s.full_name === me;
          const dot = isMe ? t.presence[(PRESENCE[effectivePresence] || PRESENCE.available).dot] : t.presence.offline;
          return (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: `1px solid ${t.borderSubtle}` }}>
              <span style={{ position: "relative", width: 38, height: 38, borderRadius: 12, background: t.accentSoft, color: t.accent, display: "grid", placeItems: "center", fontSize: 14, fontWeight: 800, flexShrink: 0 }}>
                {initials(s.full_name)}
                <span style={{ position: "absolute", right: -2, bottom: -2, width: 13, height: 13, borderRadius: "50%", background: dot, border: `2.5px solid ${t.raised}` }} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 650, color: t.textPrimary }}>{s.full_name || s.email}{isMe && <span style={{ color: t.textMuted, fontWeight: 500 }}> · Du</span>}</div>
                <div style={{ fontSize: 11.5, color: t.textMuted }}>{isMe ? (PRESENCE[effectivePresence] || PRESENCE.available).label : "kein Live-Status"}</div>
              </div>
            </div>
          );
        })}
      </Panel>
      <Note t={t}>Live-Status für Kolleg:innen (frei / im Gespräch / DND) kommt über den Presence-Kanal, sobald die Telefonie läuft. „Durchstellen" per Klick folgt in v2.</Note>
    </Page>
  );
}

// ── Voicemail ─────────────────────────────────────────────────────────────
export function Voicemail() {
  const t = useT();
  return (
    <Page t={t} title="Voicemail" subtitle="Verpasste Anrufe mit Nachricht">
      <Panel t={t} style={{ padding: "48px 24px", textAlign: "center" }}>
        <VoicemailIcon size={30} style={{ color: t.textMuted, marginBottom: 10 }} />
        <div style={{ fontSize: 14, fontWeight: 650, color: t.textPrimary }}>Keine Voicemails</div>
        <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4, maxWidth: 360, marginLeft: "auto", marginRight: "auto", lineHeight: 1.5 }}>
          Sobald die eigene Telefonie läuft, landen hier Sprachnachrichten (inkl. Transkript) als geteilte Inbox.
        </div>
      </Panel>
    </Page>
  );
}

// ── Einstellungen ─────────────────────────────────────────────────────────
export function Einstellungen() {
  const t = useT();
  const { profile } = useAuth();
  const { presence, setPresence } = useTelephony();
  const choices = ["available", "busy", "dnd", "away"];
  return (
    <Page t={t} title="Einstellungen" subtitle="Mein Telefon">
      <Panel t={t} style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: t.textMuted, marginBottom: 10 }}>Mein Status</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {choices.map((p) => {
            const info = PRESENCE[p], active = p === presence;
            return (
              <button key={p} onClick={() => setPresence(p)}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 13px", borderRadius: 10, cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: 650,
                  border: `1px solid ${active ? t.accent : t.borderSubtle}`, background: active ? t.accentSoft : t.raised, color: active ? t.accent : t.textSecondary }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: t.presence[info.dot] }} />
                {info.label}
                {active && <Check size={14} />}
              </button>
            );
          })}
        </div>
      </Panel>
      <Panel t={t} style={{ padding: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: t.textMuted, marginBottom: 10 }}>Meine Direktnummer</div>
        <div style={{ fontSize: 15, fontWeight: 650, color: t.textPrimary, fontFamily: "ui-monospace, monospace" }}>
          {profile?.phone ? formatPhone(profile.phone) : <span style={{ color: t.textMuted, fontFamily: "inherit", fontWeight: 500 }}>— (in den smartis-Einstellungen hinterlegen)</span>}
        </div>
      </Panel>
      <Note t={t}>Gerätewahl (Mikrofon/Lautsprecher), Klingelton und die Verbindung zur Telefonanlage erscheinen hier, sobald die Test-VM (LiveKit + Kamailio) angebunden ist.</Note>
    </Page>
  );
}
