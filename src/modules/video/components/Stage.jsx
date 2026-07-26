import React, { useEffect, useRef, useState } from "react";
import Tile, { TrackView } from "./Tile";
import { VM } from "../theme";

// ===========================================================================
// Stage – die Gesprächsfläche.
//
// Zwei Betriebsarten:
//   • Kachelraster (Designregel 4): Das Raster zeigt die GEGENÜBER. Man selbst
//     sitzt immer als kleine Vorschau unten rechts, nie als gleichberechtigte
//     Kachel – ständige Selbstansicht ermüdet nachweislich (Designregel 5).
//   • Dokumentmodus (Designregel 11): Sobald jemand teilt, bekommt der Inhalt
//     die Fläche und die Gesichter rücken in eine schmale Spalte. Das ist der
//     Normalfall im Treuhand – gemeinsam auf eine Bilanz schauen.
//
// Die Breite wird gemessen statt per CSS-Media-Query abgefragt: Die Bühne ist
// nicht immer so breit wie das Fenster (Seitenpanel!), Media Queries würden
// dann das falsche Layout wählen.
// ===========================================================================
function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(1200);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setW(cr.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ⚠️ gridAutoRows: "1fr" ist Pflicht, nicht Kosmetik: Ohne Zeilenvorgabe
// richten sich implizite Zeilen nach dem Inhalt – und der Kachelinhalt ist
// absolut positioniert, hat also keine Höhe. Die Kacheln fielen sonst
// zusammen. Mit 1fr teilen sich alle Zeilen die Bühnenhöhe gleichmässig.
function gridFor(count, width) {
  const narrow = width < 900;
  const rows = { gridAutoRows: "1fr" };
  if (count <= 1) return { ...rows, gridTemplateColumns: "1fr" };
  if (count === 2) return { ...rows, gridTemplateColumns: narrow ? "1fr" : "1fr 1fr" };
  if (count === 3) return { ...rows, gridTemplateColumns: narrow ? "1fr" : "1fr 1fr" };
  if (count === 4) return { ...rows, gridTemplateColumns: narrow ? "1fr" : "1fr 1fr" };
  return { ...rows, gridTemplateColumns: narrow ? "1fr 1fr" : "repeat(3, 1fr)" };
}

export default function Stage({ t, participants, screenShare, children }) {
  const [ref, width] = useWidth();
  const me = participants.find((p) => p.isLocal);
  const others = participants.filter((p) => !p.isLocal);

  // Wer teilt gerade? Der Track kann von irgendwem kommen, auch von einem Gast.
  const sharer = screenShare || participants.find((p) => p.screenOn && p.screenTrack);
  const narrow = width < 900;

  return (
    <div
      ref={ref}
      style={{
        position: "relative", flex: 1, minWidth: 0, minHeight: 0,
        padding: VM.stagePad, display: "flex", gap: VM.tileGap,
        background: t.stage,
      }}
    >
      {sharer ? (
        // ── Dokumentmodus ────────────────────────────────────────────────
        <>
          <div style={{
            flex: 1, minWidth: 0, borderRadius: VM.tileRadius, background: t.stageDoc,
            display: "grid", placeItems: "center", position: "relative", overflow: "hidden",
          }}>
            <TrackView track={sharer.screenTrack} muted fit="contain" />
            <span style={{
              position: "absolute", top: 14, left: 14, zIndex: 4,
              background: "rgba(0,0,0,.55)", padding: "5px 11px", borderRadius: 999,
              fontSize: 11.5, fontWeight: 600, color: t.onStage,
            }}>
              {sharer.isLocal ? "Sie teilen Ihren Bildschirm" : `${sharer.name} teilt`}
            </span>
          </div>

          {/* Personenspalte – bei schmaler Bühne unter den Inhalt gelegt */}
          {!narrow && (
            <div style={{
              width: VM.railWidth, flexShrink: 0, display: "flex", flexDirection: "column",
              gap: 8, overflowY: "auto",
            }}>
              {participants.map((p) => (
                <div key={p.sid || p.identity} style={{ aspectRatio: "16/9", flexShrink: 0 }}>
                  <Tile p={p} t={t} radius={12} compact />
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        // ── Kachelraster ─────────────────────────────────────────────────
        <div style={{
          flex: 1, minWidth: 0, display: "grid", gap: VM.tileGap,
          ...gridFor(others.length, width),
        }}>
          {others.length === 0 ? (
            // Allein im Raum: sich selbst gross zeigen statt einer leeren
            // Fläche – so kann man Bildausschnitt und Licht prüfen, während
            // man wartet. (Die Regel "eigenes Bild nie als Kachel" gilt für
            // Gespräche; ohne Gegenüber gibt es nichts anderes zu zeigen.)
            <div style={{ position: "relative", minHeight: 0 }}>
              {me && <Tile p={me} t={t} />}
              <div style={{
                position: "absolute", left: "50%", bottom: 14, transform: "translateX(-50%)",
                background: "rgba(0,0,0,.55)", borderRadius: 999, padding: "7px 15px",
                fontSize: 12.5, color: t.onStage, whiteSpace: "nowrap",
              }}>
                Sie sind allein — sobald jemand beitritt, erscheint er hier.
              </div>
            </div>
          ) : (
            others.map((p, i) => (
              <div
                key={p.sid || p.identity}
                style={
                  // Bei drei Gegenüber: die dritte Kachel mittig unter die
                  // beiden oberen, statt eine Lücke zu lassen.
                  others.length === 3 && i === 2 && !narrow
                    ? { gridColumn: "1 / -1", justifySelf: "center", width: "calc(50% - 5px)", minHeight: 0 }
                    : { minHeight: 0, minWidth: 0 }
                }
              >
                <Tile p={p} t={t} />
              </div>
            ))
          )}
        </div>
      )}

      {/* Selbstansicht als Vorschau unten rechts */}
      {me && !sharer?.isLocal && others.length > 0 && (
        <div style={{
          position: "absolute", right: VM.stagePad,
          bottom: VM.barHeight + VM.barBottom + 16,
          width: narrow ? 120 : VM.pipWidth, aspectRatio: "16/9",
          borderRadius: VM.pipRadius, overflow: "hidden", zIndex: 6,
          border: `1px solid ${t.stageLine}`, boxShadow: "0 10px 30px rgba(0,0,0,.45)",
        }}>
          <Tile p={me} t={t} radius={VM.pipRadius} compact />
        </div>
      )}

      {children}
    </div>
  );
}
