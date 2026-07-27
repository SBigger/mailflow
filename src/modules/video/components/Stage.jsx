import React, { useEffect, useRef, useState } from "react";
import Tile, { TrackView, TrackViewAudio } from "./Tile";
import InviteBox from "./InviteBox";
import ZeichenFlaeche, { MarkierLeiste } from "./ZeichenFlaeche";
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

export default function Stage({ t, participants, screenShare, roomName, markieren, children }) {
  const [ref, width] = useWidth();
  // Fläche und Videoelement der Bildschirmfreigabe – die Markierebene rechnet
  // daraus aus, wo das geteilte Bild innerhalb seiner Fläche tatsächlich liegt.
  const docRef = useRef(null);
  const videoRef = useRef(null);
  // Einladung eingeblendet? Nur für diesen Besuch — wer sie wegklickt, will
  // sie jetzt weghaben, nicht für immer. Beim nächsten Raum ist sie wieder da.
  const [einladenOffen, setEinladenOffen] = useState(true);
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
          <div ref={docRef} style={{
            flex: 1, minWidth: 0, borderRadius: VM.tileRadius, background: t.stageDoc,
            display: "grid", placeItems: "center", position: "relative", overflow: "hidden",
          }}>
            <TrackView track={sharer.screenTrack} muted fit="contain" elRef={videoRef} />

            {/* Systemton der Freigabe – ohne das läuft ein geteiltes Video
                stumm, und niemand merkt warum. Eigene Freigabe ausgenommen:
                Die hört man schon aus den eigenen Lautsprechern. */}
            {sharer.screenAudioTrack && <TrackViewAudio track={sharer.screenAudioTrack} />}

            {/* Markieren: alle dürfen zeichnen, jede Person in ihrer Farbe.
                Alles löschen darf nur, wer teilt – es ist sein Bildschirm. */}
            {markieren && (
              <>
                <ZeichenFlaeche
                  t={t} containerRef={docRef} videoRef={videoRef}
                  striche={markieren.striche}
                  stiftAn={markieren.stiftAn}
                  meineFarbe={markieren.meineFarbe}
                  onStart={markieren.beginne}
                  onPunkt={markieren.fuehre}
                  onEnde={markieren.beende}
                />
                <MarkierLeiste
                  t={t}
                  stiftAn={markieren.stiftAn}
                  meineFarbe={markieren.meineFarbe}
                  onStift={() => markieren.setStiftAn((s) => !s)}
                  onMeineWeg={markieren.loescheMeine}
                  onAlleWeg={markieren.loescheAlle}
                  darfAlle={!!sharer.isLocal}
                />
              </>
            )}

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
              {/* Allein im Raum = der Moment, in dem man jemanden einladen
                  will. Genau hier gehört der Gästelink hin — nicht auf eine
                  andere Seite (siehe InviteBox für die Vorgeschichte).
                  ⚠️ Aber: mittig sass er dem eigenen Gesicht im Weg (Sascha,
                  mit Bild belegt). Deshalb linksbündig, schmaler — und vor
                  allem WEGKLICKBAR. Weggeklickt bleibt eine kleine Marke
                  stehen, sonst wäre der Link wieder unauffindbar, und genau
                  daran scheiterte der erste Kundentest. */}
              {roomName && (einladenOffen ? (
                <div style={{
                  position: "absolute", left: 16,
                  bottom: VM.barHeight + VM.barBottom + 18,
                  width: "min(380px, calc(100% - 32px))",
                  background: "rgba(10,13,18,.82)", backdropFilter: "blur(14px)",
                  border: `1px solid ${t.stageLine}`, borderRadius: 14,
                  padding: "13px 15px", display: "flex", flexDirection: "column", gap: 10,
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ flex: 1, fontSize: 12.5, color: t.onStage }}>
                      Sie sind allein — sobald jemand beitritt, erscheint er hier.
                    </div>
                    <button
                      onClick={() => setEinladenOffen(false)}
                      title="Ausblenden" aria-label="Einladung ausblenden"
                      style={{
                        flexShrink: 0, border: "none", background: "transparent",
                        color: t.onStageMuted, cursor: "pointer", padding: 0,
                        width: 20, height: 20, display: "grid", placeItems: "center",
                        fontSize: 17, lineHeight: 1,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = t.onStage)}
                      onMouseLeave={(e) => (e.currentTarget.style.color = t.onStageMuted)}
                    >×</button>
                  </div>
                  <InviteBox t={t} roomName={roomName} dunkel />
                </div>
              ) : (
                <button
                  onClick={() => setEinladenOffen(true)}
                  title="Gästelink einblenden"
                  style={{
                    position: "absolute", left: 16,
                    bottom: VM.barHeight + VM.barBottom + 18,
                    border: `1px solid ${t.stageLine}`, borderRadius: 999,
                    background: "rgba(10,13,18,.72)", backdropFilter: "blur(14px)",
                    color: t.onStage, cursor: "pointer", padding: "8px 14px",
                    fontFamily: "inherit", fontSize: 12.5, fontWeight: 650,
                  }}
                >
                  Gäste einladen
                </button>
              ))}
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
