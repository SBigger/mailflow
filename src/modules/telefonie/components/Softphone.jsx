import React, { useContext, useEffect, useRef, useState } from "react";
import {
  Phone, PhoneOff, PhoneIncoming, PhoneOutgoing, Mic, MicOff, Pause,
  ArrowRightLeft, Grid3x3, Video, StickyNote, X, Delete, FileText,
} from "lucide-react";
import { ThemeContext } from "@/Layout";
import { tele, formatPhone } from "../theme";
import { useTelephony } from "../context/TelephonyContext";

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

export default function Softphone() {
  const { theme } = useContext(ThemeContext);
  const t = tele(theme);
  const { call, incoming, panelOpen, setPanelOpen, dial, answer, decline, hangup, toggleMute, toggleHold, toggleVideo } = useTelephony();

  const [num, setNum] = useState("");
  const mono = { fontFamily: 'ui-monospace, "Segoe UI Mono", Consolas, monospace', fontVariantNumeric: "tabular-nums" };
  const timer = useCallTimer(!!call, call?.startedAt);

  const shellStyle = {
    position: "fixed", right: 26, bottom: 26, width: 340, zIndex: 3000,
    background: t.raised, border: `1px solid ${t.borderStrong}`, borderRadius: 20,
    boxShadow: "0 24px 60px -18px rgba(15,40,25,.45), 0 2px 8px rgba(15,40,25,.14)",
    overflow: "hidden", color: t.textPrimary,
  };

  // ── Eingehend: Screen-Pop ──────────────────────────────────────────────
  if (incoming) {
    const name = incoming.customer?.company_name || incoming.peerName || incoming.peerNumber;
    return (
      <div style={{ ...shellStyle, width: 384 }} role="dialog" aria-label="Eingehender Anruf">
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
          </div>
          {/* Dossier-Vorschau (Daten folgen aus tasks/mail_items/Dateiablage sobald Nummer→Kunde verdrahtet) */}
          <div style={{ marginTop: 13, display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { k: "Pendenzen", v: "wird geladen …" },
              { k: "Letzte Mails", v: "wird geladen …" },
              { k: "Letzte Dokumente", v: "wird geladen …" },
            ].map((r) => (
              <div key={r.k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", background: t.sunken, border: `1px solid ${t.borderSubtle}`, borderRadius: 9 }}>
                <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", color: t.textMuted }}>{r.k}</span>
                <span style={{ fontSize: 11, color: t.textMuted }}>{r.v}</span>
              </div>
            ))}
          </div>
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
            <Ctrl t={t} icon={Grid3x3} label="Tastatur" onClick={() => {}} />
            <Ctrl t={t} on={call.video} icon={Video} label="Video" onClick={toggleVideo} />
            <Ctrl t={t} icon={StickyNote} label="Notiz" onClick={() => {}} />
          </div>

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
