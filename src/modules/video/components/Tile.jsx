import React, { useEffect, useRef } from "react";
import { MicOff, Signal, SignalLow, SignalMedium } from "lucide-react";
import { VM, initials, personStyle } from "../theme";

// ===========================================================================
// TrackView – hängt einen LiveKit-Track an ein <video>/<audio>-Element.
//
// LiveKit liefert Tracks als Objekte mit attach()/detach(). Der Effect muss
// beim Trackwechsel sauber abhängen, sonst bleiben Streams im Hintergrund
// aktiv (Kamera-Lämpchen bleibt an, Ton läuft doppelt).
// ===========================================================================
function TrackView({ track, muted = false, mirror = false, fit = "cover" }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => { try { track.detach(el); } catch { /* beim Abbau egal */ } };
  }, [track]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      style={{
        width: "100%", height: "100%", objectFit: fit, display: "block",
        transform: mirror ? "scaleX(-1)" : "none",
        background: "#12161c",
      }}
    />
  );
}

// Verbindungsqualität: nur bei Problemen zeigen (Designregel 15 – dezent an
// der Kachel des Verursachers, nicht als Alarm für alle).
function QualityIcon({ quality, t }) {
  if (quality === "excellent" || quality === "good" || quality === "unknown") return null;
  const Icon = quality === "poor" ? SignalLow : SignalMedium;
  return (
    <span title="Schwache Verbindung" style={{ display: "flex", alignItems: "center", color: t.missed }}>
      <Icon size={14} />
    </span>
  );
}

// ===========================================================================
// Tile – eine Person auf der Bühne.
// Zeigt Video, sonst Initialen. Sprech-Ring + Pegelpunkte sind doppelt
// kodiert (Designregel 7), damit auch ohne Farbunterscheidung erkennbar ist,
// wer spricht.
// ===========================================================================
export default function Tile({ p, t, radius = VM.tileRadius, compact = false }) {
  const tone = personStyle({ id: p.identity, full_name: p.name });
  const showVideo = p.camOn && p.videoTrack;

  return (
    <div
      style={{
        // ⚠️ height 100% ist Pflicht: Der Kachelinhalt (Video bzw. Initialen)
        // ist absolut positioniert, die Kachel hätte sonst keine eigene Höhe
        // und fiele im Raster auf null zusammen – sichtbar als "Teilnehmer
        // ohne Kamera ist unsichtbar".
        position: "relative", height: "100%", width: "100%",
        borderRadius: radius, overflow: "hidden",
        background: t.stageEmpty, minHeight: 0, minWidth: 0,
        transition: "box-shadow .15s ease-out",
        boxShadow: p.isSpeaking
          ? `0 0 0 2px ${t.accentFill}, 0 0 18px 5px ${t.accentFill}59`
          : "none",
      }}
    >
      {showVideo ? (
        <TrackView track={p.videoTrack} muted mirror={p.isLocal} />
      ) : (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          <span
            style={{
              width: compact ? 44 : VM.initialsSize, height: compact ? 44 : VM.initialsSize,
              borderRadius: "50%", display: "grid", placeItems: "center",
              fontSize: compact ? 15 : 24, fontWeight: 700,
              background: tone.bg, color: tone.text,
            }}
          >
            {initials(p.name)}
          </span>
        </div>
      )}

      {/* Ton der Gegenstelle – eigenes Mikrofon nie ausgeben (Rückkopplung) */}
      {!p.isLocal && p.audioTrack && <TrackViewAudio track={p.audioTrack} />}

      {/* Namensschild (Designregel 8) */}
      <div
        style={{
          position: "absolute", left: 10, bottom: 10, zIndex: 3,
          display: "flex", alignItems: "center", gap: 6,
          fontSize: compact ? 11 : 12.5, fontWeight: 600, color: t.onStage,
          background: t.chipBg, padding: compact ? "3px 7px" : "4px 8px",
          borderRadius: 7, maxWidth: "calc(100% - 20px)",
        }}
      >
        {!p.micOn && <MicOff size={14} style={{ color: t.hangup, flexShrink: 0 }} />}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {p.isLocal ? "Sie" : p.name}
        </span>
        {p.isGuest && (
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: ".04em", flexShrink: 0,
            background: t.guestBg, color: t.guestFg, padding: "1px 6px", borderRadius: 5,
          }}>Gast</span>
        )}
        {p.isSpeaking && <SpeakingDots t={t} />}
        <QualityIcon quality={p.connectionQuality} t={t} />
      </div>
    </div>
  );
}

function TrackViewAudio({ track }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => { try { track.detach(el); } catch { /* egal */ } };
  }, [track]);
  return <audio ref={ref} autoPlay style={{ display: "none" }} />;
}

// Drei Pegelpunkte – die zweite Kodierung neben dem Ring.
function SpeakingDots({ t }) {
  return (
    <span style={{ display: "flex", gap: 2.5, alignItems: "flex-end", height: 11, flexShrink: 0 }}>
      {[0, 140, 280].map((delay, i) => (
        <i
          key={i}
          style={{
            width: 2.5, height: [5, 9, 6][i], background: t.accentFill,
            borderRadius: 2, display: "block",
            animation: `vidPulse 900ms ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}

export { TrackView };
