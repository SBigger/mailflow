import React, { useEffect, useRef, useState } from "react";
import { X, Send, MicOff, MonitorUp } from "lucide-react";
import { VM, initials, personStyle } from "../theme";

// ===========================================================================
// SidePanel – Teilnehmer und Chat, als Overlay ÜBER der Bühne (Designregel 14).
//
// Bewusst überlagernd statt verdrängend: Würde das Panel die Bühne schmaler
// machen, springt bei jedem Öffnen das ganze Kachelraster um – unruhig und
// desorientierend mitten im Gespräch.
//
// Der Chat läuft über LiveKits Datenkanal. Das kostet nichts extra, braucht
// keine Tabelle und ist Ende-zu-Ende innerhalb des Raums – dafür ist er
// bewusst flüchtig: Nachrichten sind nach dem Gespräch weg. Wer dauerhaft
// dokumentieren will, nutzt Chartis. (Ab Phase 3 wandert Wichtiges ohnehin
// ins Protokoll.)
//
// ⚠️ Die Nachrichtenliste kommt als Eigenschaft von aussen und wird NICHT
// hier gehalten: Dieses Panel wird beim Schliessen abgebaut – eine interne
// Liste wäre danach leer, und alles, was währenddessen ankam, verloren.
// ===========================================================================
export default function SidePanel({ t, tab, onClose, participants, messages = [], onSend }) {
  return (
    <div style={{
      width: VM.panelWidth, flexShrink: 0, background: t.stagePanel,
      borderRadius: VM.panelRadius, padding: 16, color: t.onStage,
      display: "flex", flexDirection: "column", gap: 12, minHeight: 0,
      animation: "vidSlideIn .2s ease-out",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>
          {tab === "chat" ? "Chat" : `Teilnehmer · ${participants.length}`}
        </h4>
        <button
          onClick={onClose}
          aria-label="Panel schliessen"
          style={{
            marginLeft: "auto", border: "none", background: "transparent",
            color: t.onStageMuted, cursor: "pointer", borderRadius: 8,
            width: 28, height: 28, display: "grid", placeItems: "center",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = t.stageHover)}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <X size={16} />
        </button>
      </div>

      {tab === "people"
        ? <PeopleList t={t} participants={participants} />
        : <Chat t={t} messages={messages} onSend={onSend} />}
    </div>
  );
}

function PeopleList({ t, participants }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9, overflowY: "auto" }}>
      {participants.map((p) => {
        const tone = personStyle({ id: p.identity, full_name: p.name });
        return (
          <div key={p.sid || p.identity} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5 }}>
            <span style={{
              width: 28, height: 28, borderRadius: "50%", display: "grid", placeItems: "center",
              fontSize: 11, fontWeight: 700, background: tone.bg, color: tone.text, flexShrink: 0,
            }}>{initials(p.name)}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {p.isLocal ? `${p.name} (Sie)` : p.name}
            </span>
            {p.isGuest && (
              <span style={{
                fontSize: 9.5, fontWeight: 700, background: t.guestBg, color: t.guestFg,
                padding: "1px 5px", borderRadius: 5, flexShrink: 0,
              }}>Gast</span>
            )}
            <span style={{ display: "flex", gap: 5, flexShrink: 0, opacity: .75 }}>
              {p.screenOn && <MonitorUp size={13} style={{ color: t.accentFill }} />}
              {!p.micOn && <MicOff size={13} style={{ color: t.hangup }} />}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Chat({ t, messages, onSend }) {
  const [text, setText] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const send = async () => {
    const value = text.trim();
    if (!value) return;
    const ok = await onSend?.(value);
    if (ok) setText("");
  };

  return (
    <>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.length === 0 && (
          <p style={{ fontSize: 12, color: t.onStageMuted, margin: 0 }}>
            Noch keine Nachrichten. Der Chat gilt nur für dieses Gespräch.
          </p>
        )}
        {messages.map((m) => {
          const tone = personStyle({ full_name: m.from });
          return (
            <div key={m.id} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
              <span style={{
                width: 26, height: 26, borderRadius: "50%", flexShrink: 0, display: "grid",
                placeItems: "center", fontSize: 10.5, fontWeight: 700,
                background: m.own ? t.accentFill : tone.bg, color: m.own ? "#fff" : tone.text,
              }}>{initials(m.from)}</span>
              <span style={{ fontSize: 12.5, color: "rgba(255,255,255,.84)", minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: t.onStage }}>
                  {m.from}
                </span>
                <span style={{ wordBreak: "break-word" }}>{m.text}</span>
              </span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div style={{ display: "flex", gap: 7 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Nachricht…"
          aria-label="Nachricht schreiben"
          style={{
            flex: 1, minWidth: 0, background: "rgba(255,255,255,.06)",
            border: `1px solid ${t.stageLine}`, borderRadius: 10, padding: "9px 11px",
            color: t.onStage, fontFamily: "inherit", fontSize: 12.5, outline: "none",
          }}
        />
        <button
          onClick={send}
          aria-label="Senden"
          style={{
            border: "none", background: t.accentFill, color: "#fff", borderRadius: 10,
            width: 38, cursor: "pointer", display: "grid", placeItems: "center",
          }}
        >
          <Send size={15} />
        </button>
      </div>
    </>
  );
}
