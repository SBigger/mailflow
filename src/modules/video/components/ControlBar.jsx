import React from "react";
import {
  Mic, MicOff, Video as Cam, VideoOff, MonitorUp, Hand,
  MessageSquare, Users, PhoneOff,
} from "lucide-react";
import { VM, supportsBlur } from "../theme";

// ===========================================================================
// ControlBar – EINE schwebende Pille unten mittig (Designregel 6).
//
// Bewusst maximal 6+1 Schaltflächen: Mikro, Kamera, Teilen, Hand, Chat,
// Teilnehmer – und getrennt davon das rote Auflegen. Mehr Knöpfe machen die
// Leiste zur Werkzeugkiste; alles Seltene gehört in die Panels.
//
// Der Blur-Hintergrund wird per Feature-Erkennung durch eine deckende Fläche
// ersetzt – ohne das wäre die Leiste in älteren Electron-Builds und auf
// manchen Kunden-Laptops fast durchsichtig und damit unlesbar.
// ===========================================================================
export default function ControlBar({
  t, micOn, camOn, screenOn, handRaised,
  onMic, onCam, onScreen, onHand, onChat, onPeople, onLeave,
  chatBadge = 0, peopleCount = 0, visible = true,
}) {
  const blur = supportsBlur();

  return (
    <div
      role="toolbar"
      aria-label="Gesprächssteuerung"
      style={{
        position: "absolute", left: "50%", bottom: VM.barBottom,
        transform: `translateX(-50%) translateY(${visible ? 0 : "calc(100% + 24px)"})`,
        opacity: visible ? 1 : 0,
        transition: "transform .22s ease-out, opacity .22s ease-out",
        height: VM.barHeight, display: "flex", alignItems: "center", gap: 6,
        padding: "0 10px", borderRadius: 999, zIndex: 20,
        background: blur ? t.barBg : t.barBgOpaque,
        ...(blur ? { backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" } : {}),
        border: `1px solid ${t.barLine}`,
        boxShadow: t.barShadow,
      }}
    >
      <Ctrl t={t} label="Mikro" active={micOn} danger={!micOn}
            icon={micOn ? Mic : MicOff} onClick={onMic}
            aria={micOn ? "Mikrofon ausschalten" : "Mikrofon einschalten"} />
      <Ctrl t={t} label="Kamera" active={camOn} danger={!camOn}
            icon={camOn ? Cam : VideoOff} onClick={onCam}
            aria={camOn ? "Kamera ausschalten" : "Kamera einschalten"} />
      <Ctrl t={t} label="Teilen" active={screenOn} icon={MonitorUp} onClick={onScreen}
            aria={screenOn ? "Bildschirmfreigabe beenden" : "Bildschirm teilen"} />
      <Ctrl t={t} label="Hand" active={handRaised} icon={Hand} onClick={onHand}
            aria={handRaised ? "Hand senken" : "Hand heben"} />

      <span style={{ width: 1, height: 26, background: t.stageLine, margin: "0 3px" }} />

      <Ctrl t={t} label="Chat" icon={MessageSquare} onClick={onChat} badge={chatBadge}
            aria="Chat öffnen" />
      <Ctrl t={t} label="Personen" icon={Users} onClick={onPeople} badge={peopleCount || 0}
            badgeNeutral aria="Teilnehmerliste öffnen" />

      <button
        onClick={onLeave}
        aria-label="Gespräch verlassen"
        style={{
          marginLeft: 6, minWidth: 74, height: 48, borderRadius: 999, border: "none",
          background: t.hangup, color: "#fff", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
          fontFamily: "inherit", fontSize: 12.5, fontWeight: 650,
          transition: "filter .15s ease-out",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.08)")}
        onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
      >
        <PhoneOff size={18} /> Verlassen
      </button>
    </div>
  );
}

function Ctrl({ t, label, icon: Icon, onClick, active, danger, badge = 0, badgeNeutral, aria }) {
  const bg = danger ? t.hangup : active ? t.accentFill : "transparent";
  const fg = danger || active ? "#fff" : "rgba(255,255,255,.88)";
  return (
    <button
      onClick={onClick}
      aria-label={aria || label}
      aria-pressed={active ? true : undefined}
      style={{
        position: "relative", minWidth: 52, height: 44, border: "none",
        background: bg, color: fg, borderRadius: 12, cursor: "pointer",
        fontFamily: "inherit",
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: 2, transition: "background .15s ease-out",
      }}
      onMouseEnter={(e) => { if (!active && !danger) e.currentTarget.style.background = t.stageHover; }}
      onMouseLeave={(e) => { if (!active && !danger) e.currentTarget.style.background = "transparent"; }}
    >
      <Icon size={20} />
      <small style={{ fontSize: 10, opacity: .72, letterSpacing: ".01em" }}>{label}</small>
      {badge > 0 && (
        <span style={{
          position: "absolute", top: -3, right: 6, minWidth: 16, height: 16,
          borderRadius: 999, background: badgeNeutral ? t.stageHover : t.accentFill,
          color: "#fff", fontSize: 10, fontWeight: 700,
          display: "grid", placeItems: "center", padding: "0 4px",
        }}>{badge}</span>
      )}
    </button>
  );
}
