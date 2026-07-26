import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, AlertTriangle, Clock } from "lucide-react";
import { functions } from "@/api/supabaseClient";
import { videoTheme, VM, VIDEO_FONT } from "../theme";
import { useRoom } from "../lib/useRoom";
import GreenRoom from "../components/GreenRoom";
import Stage from "../components/Stage";
import ControlBar from "../components/ControlBar";

// ===========================================================================
// MeetGuest – die Seite, die ein KUNDE sieht.
//
// Läuft AUSSERHALB der Anmeldung (Route /meet/:room in App.jsx, neben
// /share/:token). Der Gast hat kein Konto, keine Installation, keinen
// Client — nur den Link aus der Termineinladung.
//
// Ablauf: Raum prüfen → Geräte einrichten → anklopfen → warten → eingelassen.
// Das Zutrittstoken bekommt der Gast NICHT über den Echtzeit-Kanal (das
// könnte jeder mitlesen, der den Raumnamen kennt), sondern er holt es bei
// der Edge Function ab — und die gibt es erst heraus, wenn der Berater
// tatsächlich zugelassen hat.
//
// Feste Farbwelt "artis": Der Gast hat keine smartis-Einstellungen, und ein
// dunkles Beitrittsfenster beim Mandanten wäre eine seltsame Visitenkarte.
// ===========================================================================
const POLL_MS = 2500;

export default function MeetGuest() {
  const { room } = useParams();
  const t = videoTheme("artis");

  const [phase, setPhase] = useState("laedt"); // laedt | bereit | klopft | wartet | verbindet | live | abgewiesen | fehler
  const [meldung, setMeldung] = useState(null);
  const [titel, setTitel] = useState("Besprechung");
  const [wartetSeit, setWartetSeit] = useState(0);
  const prefsRef = useRef(null);
  const guestIdRef = useRef(null);
  const pollRef = useRef(null);

  const { state, participants, micOn, camOn, screenOn,
    connect, leave, toggleMic, toggleCam, toggleScreen, switchDevice } = useRoom();

  // ── Raum prüfen ────────────────────────────────────────────────────────
  useEffect(() => {
    let weg = false;
    (async () => {
      try {
        const { data } = await functions.invoke("meeting-api", { action: "guest-info", room });
        if (weg) return;
        if (data?.error) { setMeldung(data.error); setPhase("fehler"); return; }
        setTitel(data?.title || "Besprechung");
        setPhase("bereit");
      } catch {
        if (weg) return;
        setMeldung("Diese Besprechung gibt es nicht (mehr). Bitte prüfen Sie den Link aus Ihrer Einladung.");
        setPhase("fehler");
      }
    })();
    return () => { weg = true; };
  }, [room]);

  // ── Wartezeit mitzählen (beruhigt: man sieht, dass etwas passiert) ─────
  useEffect(() => {
    if (phase !== "wartet") return;
    const id = setInterval(() => setWartetSeit((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const betrete = useCallback(async (token, url, prefs) => {
    setPhase("verbindet");
    try {
      await connect({
        url, token,
        video: prefs?.camOn ?? true,
        audio: prefs?.micOn ?? true,
        videoDeviceId: prefs?.camId,
        audioDeviceId: prefs?.micId,
      });
      if (prefs?.speakerId) await switchDevice("audiooutput", prefs.speakerId);
      setPhase("live");
    } catch (e) {
      setMeldung(e?.message || "Verbindung fehlgeschlagen.");
      setPhase("fehler");
    }
  }, [connect, switchDevice]);

  // ── Auf Einlass warten ─────────────────────────────────────────────────
  const beginneWarten = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await functions.invoke("meeting-api", {
          action: "guest-status", guestId: guestIdRef.current,
        });
        if (data?.state === "zugelassen" && data.token) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          await betrete(data.token, data.url, prefsRef.current);
        } else if (data?.state === "abgewiesen") {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setPhase("abgewiesen");
        }
      } catch { /* Netzhänger: beim nächsten Versuch nochmal */ }
    }, POLL_MS);
  }, [betrete]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const klopfeAn = useCallback(async (prefs) => {
    prefsRef.current = prefs;
    setPhase("klopft");
    try {
      const { data } = await functions.invoke("meeting-api", {
        action: "guest-knock", room, name: prefs.name,
      });
      if (!data?.guestId) throw new Error(data?.error || "Anmeldung fehlgeschlagen.");
      guestIdRef.current = data.guestId;
      setWartetSeit(0);
      setPhase("wartet");
      beginneWarten();
    } catch (e) {
      setMeldung(e?.message || "Anmeldung fehlgeschlagen.");
      setPhase("fehler");
    }
  }, [room, beginneWarten]);

  const huelle = {
    height: "100vh", display: "flex", flexDirection: "column",
    fontFamily: VIDEO_FONT, overflow: "hidden",
  };

  // ── Im Gespräch ────────────────────────────────────────────────────────
  if (phase === "live") {
    return (
      <div style={{ ...huelle, background: t.stage }}>
        <Keyframes />
        <div style={{ flex: 1, minHeight: 0, display: "flex", position: "relative" }}>
          <Stage t={t} participants={participants}>
            {state === "reconnecting" && (
              <div style={hinweisOben(t)}>
                <Loader2 size={14} style={{ animation: "vidSpin 1s linear infinite" }} />
                Verbindung wird wiederhergestellt…
              </div>
            )}
            <ControlBar
              t={t} visible
              micOn={micOn} camOn={camOn} screenOn={screenOn}
              onMic={toggleMic} onCam={toggleCam} onScreen={toggleScreen}
              onHand={() => {}}
              onChat={() => {}}
              onPeople={() => {}}
              onLeave={async () => { await leave(); setPhase("beendet"); }}
              peopleCount={participants.length}
            />
          </Stage>
        </div>
      </div>
    );
  }

  // ── Alles vor dem Gespräch: helle Artis-Welt ───────────────────────────
  return (
    <div style={{ ...huelle, background: t.sunken, color: t.textPrimary }}>
      <Keyframes />
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {phase === "laedt" && <Mitte t={t}><Loader2 size={26} style={{ animation: "vidSpin 1s linear infinite", color: t.accent }} /></Mitte>}

        {phase === "fehler" && (
          <Mitte t={t}>
            <div style={{ textAlign: "center", maxWidth: 420 }}>
              <AlertTriangle size={30} style={{ color: t.missed, marginBottom: 12 }} />
              <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>Das hat nicht geklappt</h1>
              <p style={{ fontSize: 13.5, color: t.textSecondary, margin: 0 }}>{meldung}</p>
            </div>
          </Mitte>
        )}

        {phase === "abgewiesen" && (
          <Mitte t={t}>
            <div style={{ textAlign: "center", maxWidth: 420 }}>
              <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>Beitritt nicht möglich</h1>
              <p style={{ fontSize: 13.5, color: t.textSecondary, margin: 0 }}>
                Sie wurden nicht in die Besprechung eingelassen. Bitte wenden Sie sich an Ihre
                Ansprechperson bei Artis Treuhand.
              </p>
            </div>
          </Mitte>
        )}

        {phase === "beendet" && (
          <Mitte t={t}>
            <div style={{ textAlign: "center", maxWidth: 420 }}>
              <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>Gespräch beendet</h1>
              <p style={{ fontSize: 13.5, color: t.textSecondary, margin: 0 }}>
                Sie haben die Besprechung verlassen. Sie können dieses Fenster schliessen.
              </p>
            </div>
          </Mitte>
        )}

        {(phase === "wartet" || phase === "klopft" || phase === "verbindet") && (
          <Mitte t={t}>
            <div style={{ textAlign: "center", maxWidth: 440 }}>
              <div style={{
                width: 54, height: 54, borderRadius: "50%", background: t.accentSoft,
                display: "grid", placeItems: "center", margin: "0 auto 16px",
              }}>
                <Clock size={24} style={{ color: t.accent }} />
              </div>
              <h1 style={{ fontSize: 19, fontWeight: 700, margin: "0 0 8px" }}>
                {phase === "verbindet" ? "Sie werden verbunden…" : "Sie sind im Warteraum"}
              </h1>
              <p style={{ fontSize: 13.5, color: t.textSecondary, margin: "0 0 6px" }}>
                {phase === "verbindet"
                  ? "Einen Moment noch."
                  : "Ihre Ansprechperson wurde benachrichtigt und lässt Sie gleich herein."}
              </p>
              {phase === "wartet" && wartetSeit > 4 && (
                <p style={{ ...mono, fontSize: 12, color: t.textMuted, margin: 0 }}>
                  Wartezeit {Math.floor(wartetSeit / 60)}:{String(wartetSeit % 60).padStart(2, "0")}
                </p>
              )}
            </div>
          </Mitte>
        )}

        {phase === "bereit" && (
          <GreenRoom
            t={t}
            brand
            title={titel}
            subtitle="Sie sind zu dieser Besprechung eingeladen."
            joinLabel="Beitritt anfragen"
            askName
            hint="Noch sieht und hört Sie niemand. Nach dem Anfragen werden Sie eingelassen."
            onJoin={klopfeAn}
          />
        )}
      </div>
    </div>
  );
}

const mono = { fontFamily: 'ui-monospace, "Segoe UI Mono", Consolas, monospace', fontVariantNumeric: "tabular-nums" };

function Mitte({ children }) {
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 30 }}>{children}</div>
  );
}

function hinweisOben(t) {
  return {
    position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)",
    zIndex: 15, display: "flex", alignItems: "center", gap: 8,
    background: "rgba(15,18,24,.8)", border: `1px solid ${t.stageLine}`,
    borderRadius: 999, padding: "7px 14px", fontSize: 12, color: t.onStage,
  };
}

function Keyframes() {
  return (
    <style>{`
      @keyframes vidSpin { from { transform: rotate(0) } to { transform: rotate(360deg) } }
      @keyframes vidPulse { 0%,100% { transform: scaleY(.45) } 50% { transform: scaleY(1) } }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation-duration: .001ms !important; transition-duration: .001ms !important; }
      }
    `}</style>
  );
}
