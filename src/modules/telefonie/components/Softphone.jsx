import React, { useEffect, useState } from "react";
import {
  Phone, PhoneOff, PhoneIncoming, PhoneOutgoing, Mic, MicOff, Pause,
  ArrowRightLeft, Grid3x3, Video, StickyNote, X, Delete, FileText, Mail,
} from "lucide-react";
import { tele, formatPhone, useAppTheme } from "../theme";
import { useTelephony } from "../context/TelephonyContext";
import { useIncomingDossier } from "../useDossier";
import CallWrapup from "./CallWrapup";

const KEYS = [
  ["1", ""], ["2", "ABC"], ["3", "DEF"],
  ["4", "GHI"], ["5", "JKL"], ["6", "MNO"],
  ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"],
  ["*", ""], ["0", "+"], ["#", ""],
];

function useCallTimer(active, startedAt) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!active) { setSec(0); return; }
    const tick = () => setSec(Math.max(0, Math.floor((Date.now() - (startedAt || Date.now())) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active, startedAt]);
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function relTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "heute";
  if (days === 1) return "gestern";
  if (days < 7) return `${days} Tg.`;
  if (days < 31) return `${Math.floor(days / 7)} Wo.`;
  return `${Math.floor(days / 30)} Mt.`;
}

function dueInfo(iso) {
  if (!iso) return { label: "offen", overdue: false };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { label: "offen", overdue: false };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  const diff = Math.round((dd.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return { label: "überfällig", overdue: true };
  if (diff === 0) return { label: "fällig heute", overdue: true };
  if (diff === 1) return { label: "morgen", overdue: false };
  return { label: `${String(dd.getDate()).padStart(2, "0")}.${String(dd.getMonth() + 1).padStart(2, "0")}.`, overdue: false };
}

export default function Softphone() {
  const theme = useAppTheme();
  const t = tele(theme);
  const { call, incoming, wrapup, clearWrapup, panelOpen, setPanelOpen, dial, answer, decline, hangup, toggleMute, toggleHold, toggleVideo, sendDtmf } = useTelephony();
  const dossier = useIncomingDossier(incoming?.peerNumber);

  const [num, setNum] = useState("");
  const [showDtmf, setShowDtmf] = useState(false);
  useEffect(() => { if (!call) setShowDtmf(false); }, [call]);
  const mono = { fontFamily: 'ui-monospace, "Segoe UI Mono", Consolas, monospace', fontVariantNumeric: "tabular-nums" };
  const timer = useCallTimer(!!call, call?.startedAt);

  const shellStyle = {
    position: "fixed", right: 26, bottom: 26, width: 340, zIndex: 3000,
    background: t.raised, border: `1px solid ${t.borderStrong}`, borderRadius: 20,
    boxShadow: "0 24px 60px -18px rgba(15,40,25,.45), 0 2px 8px rgba(15,40,25,.14)",
    overflow: "hidden", color: t.textPrimary,
  };

  // ── Eingehend: Screen-Pop mit echtem Dossier ───────────────────────────
  if (incoming) {
    const name = dossier.customer?.company_name || incoming.peerName || formatPhone(incoming.peerNumber);
    return (
      <div style={{ ...shellStyle, width: 384, bottom: "auto", top: 24, maxHeight: "calc(100vh - 48px)", overflowY: "auto" }} role="dialog" aria-label="Eingehender Anruf">
        <div style={{ padding: "14px 18px 12px", background: t.accentSoft, borderBottom: `1px solid ${t.borderSubtle}`, display: "flex", alignItems: "center", gap: 8 }}>
          <PhoneIncoming size={16} style={{ color: t.accent }} />
          <span style={{ fontSize: 12.5, fontWeight: 750, color: t.accent }}>Eingehender Anruf</span>
          {incoming.viaNumber && <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 600, color: t.textMuted }}>via {incoming.viaNumber}</span>}
        </div>

        <div style={{ padding: "16px 18px 4px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <span style={{ width: 50, height: 50, borderRadius: 15, background: t.accentSoft, color: t.accent, display: "grid", placeItems: "center", fontSize: 18, fontWeight: 800, flexShrink: 0 }}>
              {(name || "?").slice(0, 2).toUpperCase()}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16.5, fontWeight: 750, lineHeight: 1.15 }}>{name}</div>
              <div style={{ ...mono, fontSize: 12.5, color: t.textMuted, marginTop: 2 }}>{formatPhone(incoming.peerNumber)}</div>
            </div>
            {dossier.matched && (
              <span style={{ marginLeft: "auto", alignSelf: "flex-start", fontSize: 10, fontWeight: 800, color: t.in, background: t.in + "1e", padding: "2px 8px", borderRadius: 999 }}>Kunde</span>
            )}
          </div>
          {dossier.contactName && (
            <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 7 }}>Anrufer: <b style={{ color: t.textSecondary }}>{dossier.contactName}</b></div>
          )}

          {dossier.matched ? (
            <div style={{ marginTop: 13, display: "flex", flexDirection: "column", gap: 12 }}>
              <DSec t={t} label="Pendenzen" count={dossier.pendenzen.length}>
                {dossier.pendenzen.length
                  ? dossier.pendenzen.map((p) => { const di = dueInfo(p.due_date); return <DRow key={p.id} t={t} dot={di.overdue ? t.missed : t.presence.away} text={p.title || "Aufgabe"} meta={di.label} metaCol={di.overdue ? t.missed : undefined} />; })
                  : <DEmpty t={t}>Keine offenen Pendenzen</DEmpty>}
              </DSec>
              <DSec t={t} label="Letzte Mails" count={dossier.mails.length}>
                {dossier.mails.length
                  ? dossier.mails.map((m) => <DRow key={m.id} t={t} icon="mail" text={m.subject || "(kein Betreff)"} meta={relTime(m.received_date)} />)
                  : <DEmpty t={t}>Keine Mails</DEmpty>}
              </DSec>
              <DSec t={t} label="Letzte Dokumente" count={dossier.docs.length}>
                {dossier.docs.length
                  ? dossier.docs.map((d) => <DRow key={d.id} t={t} icon="doc" text={d.name || d.filename || "Dokument"} meta={relTime(d.updated_at)} />)
                  : <DEmpty t={t}>Keine Dokumente</DEmpty>}
              </DSec>
            </div>
          ) : (
            <div style={{ marginTop: 12, marginBottom: 4, fontSize: 12, color: t.textMuted, background: t.sunken, border: `1px solid ${t.borderSubtle}`, borderRadius: 10, padding: "11px 13px" }}>
              Unbekannter Anrufer — (noch) keinem Kunden zugeordnet.
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "14px 18px 16px" }}>
          <button onClick={answer} style={bigBtn(t.answer)}><Phone size={17} /> Annehmen</button>
          <button onClick={decline} style={bigBtn(t.hangup)}><PhoneOff size={17} /> Ablehnen</button>
        </div>
      </div>
    );
  }

  // ── Aktiver Anruf ──────────────────────────────────────────────────────
  if (call) {
    const label = call.customer?.company_name || call.peerName || formatPhone(call.peerNumber);
    return (
      <div style={shellStyle} role="dialog" aria-label="Aktiver Anruf">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: `1px solid ${t.borderSubtle}` }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{call.dir === "in" ? "Eingehender" : "Ausgehender"} Anruf</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: t.textMuted, background: t.sunken, padding: "3px 9px", borderRadius: 999 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: call.onHold ? t.presence.away : t.answer }} />
            {call.onHold ? "Gehalten" : "Im Gespräch"}
          </span>
        </div>
        <div style={{ padding: "16px", textAlign: "center" }}>
          <span style={{ width: 54, height: 54, borderRadius: 16, background: (call.dir === "in" ? t.in : t.out) + "22", color: call.dir === "in" ? t.in : t.out, display: "grid", placeItems: "center", fontSize: 18, fontWeight: 800, margin: "0 auto 8px" }}>
            {(label || "?").slice(0, 2).toUpperCase()}
          </span>
          <div style={{ fontSize: 16, fontWeight: 750 }}>{label}</div>
          <div style={{ ...mono, fontSize: 12, color: t.textMuted, marginTop: 2 }}>{formatPhone(call.peerNumber)}</div>
          <div style={{ ...mono, fontSize: 15, fontWeight: 650, color: t.answer, margin: "10px 0 2px" }}>{timer}</div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, margin: "14px 0" }}>
            <Ctrl t={t} on={call.muted} icon={call.muted ? MicOff : Mic} label="Stumm" onClick={toggleMute} />
            <Ctrl t={t} on={call.onHold} icon={Pause} label="Halten" onClick={toggleHold} />
            <Ctrl t={t} icon={ArrowRightLeft} label="Verbinden" onClick={() => {}} />
            <Ctrl t={t} on={showDtmf} icon={Grid3x3} label="Tastatur" onClick={() => setShowDtmf((v) => !v)} />
            <Ctrl t={t} on={call.video} icon={Video} label="Video" onClick={toggleVideo} />
            <Ctrl t={t} icon={StickyNote} label="Notiz" onClick={() => {}} />
          </div>

          {showDtmf && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, margin: "0 0 14px" }}>
              {KEYS.map(([d]) => (
                <button
                  key={d}
                  onClick={() => sendDtmf(d)}
                  style={{ border: `1px solid ${t.borderSubtle}`, background: t.sunken, borderRadius: 12, cursor: "pointer", padding: "8px 0", ...mono, fontSize: 17, fontWeight: 650, color: t.textPrimary }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = t.activeRow)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = t.sunken)}
                >
                  {d}
                </button>
              ))}
            </div>
          )}

          <button onClick={hangup} style={{ ...bigBtn(t.hangup), width: "100%" }}><PhoneOff size={16} /> Auflegen</button>

          {call.customer?.id && (
            <div style={{ marginTop: 11, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 650, color: t.accent }}>
              <FileText size={14} /> Dossier öffnen
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Nachbearbeitung (Wrap-up) nach beendetem Anruf ─────────────────────
  if (wrapup) {
    return <CallWrapup wrapup={wrapup} onClose={clearWrapup} />;
  }

  // ── Idle: FAB → Wähl-Panel ─────────────────────────────────────────────
  if (!panelOpen) {
    return (
      <button
        onClick={() => setPanelOpen(true)}
        title="Telefon"
        style={{
          position: "fixed", right: 26, bottom: 26, zIndex: 3000,
          width: 56, height: 56, borderRadius: "50%", border: "none", cursor: "pointer",
          background: t.accent, color: "#fff", display: "grid", placeItems: "center",
          boxShadow: "0 12px 30px -8px rgba(20,60,35,.5)",
        }}
      >
        <Phone size={22} />
      </button>
    );
  }

  return (
    <div style={shellStyle} role="dialog" aria-label="Telefon">
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "13px 16px", borderBottom: `1px solid ${t.borderSubtle}` }}>
        <Phone size={15} style={{ color: t.accent }} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>Telefon</span>
        <button onClick={() => setPanelOpen(false)} aria-label="Schliessen" style={{ marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer", color: t.textMuted, display: "grid", placeItems: "center" }}>
          <X size={16} />
        </button>
      </div>
      <div style={{ padding: 16 }}>
        <input
          value={num}
          onChange={(e) => setNum(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && num.trim()) dial(num.trim()); }}
          placeholder="+41 …"
          aria-label="Nummer"
          spellCheck={false}
          style={{ ...mono, width: "100%", textAlign: "center", fontSize: 22, color: t.textPrimary, border: "none", background: "transparent", outline: "none", padding: "6px 0 10px" }}
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
          {KEYS.map(([d, l]) => (
            <button
              key={d}
              onClick={() => setNum((n) => n + d)}
              style={{ border: `1px solid ${t.borderSubtle}`, background: t.sunken, borderRadius: 14, cursor: "pointer", padding: "9px 0 7px", display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}
              onMouseEnter={(e) => (e.currentTarget.style.background = t.activeRow)}
              onMouseLeave={(e) => (e.currentTarget.style.background = t.sunken)}
            >
              <span style={{ ...mono, fontSize: 20, fontWeight: 600, color: t.textPrimary }}>{d}</span>
              <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: ".14em", color: t.textMuted, minHeight: 9 }}>{l}</span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
          <button
            onClick={() => num.trim() && dial(num.trim())}
            disabled={!num.trim()}
            style={{ flex: 1, border: "none", borderRadius: 14, cursor: num.trim() ? "pointer" : "default", opacity: num.trim() ? 1 : 0.5, fontSize: 14, fontWeight: 750, padding: 13, color: "#fff", background: t.answer, display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}
          >
            <PhoneOutgoing size={17} /> Anrufen
          </button>
          <button onClick={() => setNum((n) => n.slice(0, -1))} aria-label="Löschen" style={{ border: `1px solid ${t.borderSubtle}`, background: t.sunken, borderRadius: 14, cursor: "pointer", width: 48, display: "grid", placeItems: "center", color: t.textSecondary }}>
            <Delete size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

function DSec({ t, label, count, children }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: t.textMuted }}>{label}</span>
        {count != null && count > 0 && (
          <span style={{ fontSize: 9.5, fontWeight: 800, color: t.textSecondary, background: t.sunken, padding: "0 6px", borderRadius: 999 }}>{count}</span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>{children}</div>
    </div>
  );
}

function DRow({ t, dot, icon, text, meta, metaCol }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", background: t.sunken, border: `1px solid ${t.borderSubtle}`, borderRadius: 9 }}>
      {dot && <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0 }} />}
      {icon === "mail" && <Mail size={13} style={{ color: t.textMuted, flexShrink: 0 }} />}
      {icon === "doc" && <FileText size={13} style={{ color: t.textMuted, flexShrink: 0 }} />}
      <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 600, color: t.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
      {meta && <span style={{ fontSize: 10.5, fontWeight: 650, color: metaCol || t.textMuted, flexShrink: 0, fontFamily: 'ui-monospace, "Segoe UI Mono", Consolas, monospace' }}>{meta}</span>}
    </div>
  );
}

function DEmpty({ t, children }) {
  return <div style={{ fontSize: 11, color: t.textMuted, padding: "3px 2px" }}>{children}</div>;
}

function Ctrl({ t, on, icon: Icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: `1px solid ${on ? t.accent : t.borderSubtle}`,
        background: on ? t.accentSoft : t.sunken,
        color: on ? t.accent : t.textSecondary,
        borderRadius: 13, cursor: "pointer", padding: "11px 0 8px",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
        font: "inherit", fontSize: 10.5, fontWeight: 650,
      }}
    >
      <Icon size={19} />
      {label}
    </button>
  );
}

function bigBtn(bg) {
  return {
    border: "none", borderRadius: 13, cursor: "pointer", padding: 13,
    fontSize: 14, fontWeight: 750, color: "#fff", background: bg,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
  };
}
