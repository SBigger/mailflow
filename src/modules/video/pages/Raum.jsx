import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { RoomEvent } from "livekit-client";
import { AlertTriangle, Loader2 } from "lucide-react";
import { functions } from "@/api/supabaseClient";
import { useAppTheme } from "@/modules/telefonie/theme";
import { videoTheme, VM, VIDEO_FONT } from "../theme";
import { useRoom } from "../lib/useRoom";
import GreenRoom from "../components/GreenRoom";
import Stage from "../components/Stage";
import ControlBar from "../components/ControlBar";
import SidePanel from "../components/SidePanel";

// ===========================================================================
// Raum – ein laufendes Gespräch.
//
// Ablauf: Green Room (Geräte prüfen) → Token holen → verbinden → Bühne.
// Der Green Room ist auch für Mitarbeitende Pflicht: Der häufigste Ärger in
// Videogesprächen ist "ich höre dich nicht" in der ersten Minute – genau das
// fängt die Vorschau ab.
// ===========================================================================
export default function Raum() {
  const { roomName } = useParams();
  const navigate = useNavigate();
  const theme = useAppTheme();
  const t = videoTheme(theme);

  const [phase, setPhase] = useState("green"); // green | connecting | live | failed
  const [failure, setFailure] = useState(null);
  const [panel, setPanel] = useState(null); // null | "people" | "chat"
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState(null);
  const [barVisible, setBarVisible] = useState(true);
  // ⚠️ Der Gesprächschat lebt HIER, nicht im Panel: Sonst entstünde die Liste
  // erst beim Öffnen und alles, was währenddessen ankam, wäre verloren.
  const [chat, setChat] = useState([]);

  const {
    state, error, participants, micOn, camOn, screenOn,
    connect, leave, toggleMic, toggleCam, toggleScreen, switchDevice, room,
  } = useRoom();

  // ── Beitreten ──────────────────────────────────────────────────────────
  const handleJoin = useCallback(async (prefs) => {
    setPhase("connecting");
    setFailure(null);
    try {
      const { data } = await functions.invoke("meeting-api", { action: "token", room: roomName });
      if (!data?.token || !data?.url) throw new Error("Kein Zugangstoken erhalten.");
      await connect({
        url: data.url,
        token: data.token,
        video: prefs.camOn,
        audio: prefs.micOn,
        videoDeviceId: prefs.camId,
        audioDeviceId: prefs.micId,
      });
      // Gewählten Lautsprecher übernehmen – ohne das bliebe die Auswahl im
      // Beitritts-Bildschirm wirkungslos (nicht jeder Browser kann es).
      if (prefs.speakerId) await switchDevice("audiooutput", prefs.speakerId);
      setPhase("live");
    } catch (e) {
      // Supabase meldet Nicht-2xx generisch – für den Nutzer übersetzen.
      const raw = e?.message || "";
      setFailure(
        raw.includes("non-2xx")
          ? "Der Videodienst ist noch nicht eingerichtet (Zugangsdaten fehlen auf dem Server)."
          : raw || "Verbindung fehlgeschlagen.",
      );
      setPhase("failed");
    }
  }, [roomName, connect, switchDevice]);

  const handleLeave = useCallback(async () => {
    await leave();
    navigate("/besprechungen");
  }, [leave, navigate]);

  // ── Hand heben: kurze Meldung an alle, kein Dauerzustand (Phase 1) ─────
  const raiseHand = useCallback(async () => {
    const r = room?.current;
    if (!r) return;
    const body = new TextEncoder().encode(JSON.stringify({ kind: "hand" }));
    try { await r.localParticipant.publishData(body, { reliable: true }); } catch { /* egal */ }
    setToast("Sie haben die Hand gehoben");
  }, [room]);

  useEffect(() => {
    const r = room?.current;
    if (!r || phase !== "live") return;
    const onData = (payload, participant) => {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));
        if (data?.kind === "hand") {
          setToast(`${participant?.name || "Jemand"} hat die Hand gehoben`);
        } else if (data?.kind === "chat") {
          setChat((m) => [...m, {
            id: `${Date.now()}-${Math.random()}`,
            from: participant?.name || participant?.identity || "Unbekannt",
            text: String(data.text || "").slice(0, 2000),
          }]);
          // Nur zählen, wenn der Chat gerade nicht offen ist.
          setPanel((cur) => { if (cur !== "chat") setUnread((n) => n + 1); return cur; });
        }
      } catch { /* fremde Pakete ignorieren */ }
    };
    r.on(RoomEvent.DataReceived, onData);
    return () => { r.off(RoomEvent.DataReceived, onData); };
  }, [room, phase]);

  const sendChat = useCallback(async (text) => {
    const r = room?.current;
    const value = String(text || "").trim();
    if (!r || !value) return false;
    const body = new TextEncoder().encode(JSON.stringify({ kind: "chat", text: value }));
    try {
      await r.localParticipant.publishData(body, { reliable: true });
      setChat((m) => [...m, { id: `${Date.now()}`, from: "Sie", text: value, own: true }]);
      return true;
    } catch {
      return false; // Nachricht bleibt im Eingabefeld stehen
    }
  }, [room]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  // ── Steuerleiste ausblenden, aber erst nach der ersten Bewegung und nie
  // in den ersten 15 Sekunden (Designregel 6 – technikferne Gäste sollen die
  // Knöpfe finden, bevor sie verschwinden).
  useEffect(() => {
    if (phase !== "live") return;
    let idle;
    let armed = false;
    const arm = setTimeout(() => { armed = true; }, VM.showControlsOnJoinMs);
    const wake = () => {
      setBarVisible(true);
      clearTimeout(idle);
      if (armed && !panel) idle = setTimeout(() => setBarVisible(false), VM.hideControlsAfterMs);
    };
    window.addEventListener("mousemove", wake);
    window.addEventListener("keydown", wake);
    window.addEventListener("touchstart", wake);
    return () => {
      clearTimeout(arm); clearTimeout(idle);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("keydown", wake);
      window.removeEventListener("touchstart", wake);
    };
  }, [phase, panel]);

  // Tastatur: M = Mikro, V = Kamera (Designregel 16)
  useEffect(() => {
    if (phase !== "live") return;
    const onKey = (e) => {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || "");
      if (inField || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "m" || e.key === "M") { e.preventDefault(); toggleMic(); }
      if (e.key === "v" || e.key === "V") { e.preventDefault(); toggleCam(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, toggleMic, toggleCam]);

  const shell = {
    height: "100vh", display: "flex", flexDirection: "column",
    background: t.stage, fontFamily: VIDEO_FONT, overflow: "hidden",
  };

  // ── Vor dem Beitritt: App-Theme, heller Grund ─────────────────────────
  if (phase === "green" || phase === "connecting" || phase === "failed") {
    return (
      <div style={{ ...shell, background: t.sunken, color: t.textPrimary }}>
        <Keyframes />
        {failure && (
          <div style={{
            display: "flex", alignItems: "center", gap: 9, margin: "18px auto 0",
            maxWidth: 560, background: t.missed + "14", border: `1px solid ${t.missed}44`,
            color: t.missed, borderRadius: 11, padding: "11px 14px", fontSize: 12.5,
          }}>
            <AlertTriangle size={16} style={{ flexShrink: 0 }} /> {failure}
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <GreenRoom
            t={t}
            title={roomName ? roomName.replace(/[-_]/g, " ") : "Besprechung"}
            subtitle="Prüfen Sie Kamera und Mikrofon, bevor Sie beitreten."
            joinLabel="Jetzt beitreten"
            busy={phase === "connecting"}
            onJoin={handleJoin}
          />
        </div>
      </div>
    );
  }

  // ── Im Gespräch: dunkle Bühne ─────────────────────────────────────────
  return (
    <div style={shell}>
      <Keyframes />
      <div style={{ flex: 1, minHeight: 0, display: "flex", position: "relative" }}>
        <Stage t={t} participants={participants}>
          {state === "reconnecting" && (
            <div style={{
              position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)",
              zIndex: 15, display: "flex", alignItems: "center", gap: 8,
              background: "rgba(15,18,24,.8)", border: `1px solid ${t.stageLine}`,
              borderRadius: 999, padding: "7px 14px", fontSize: 12, color: t.onStage,
            }}>
              <Loader2 size={14} style={{ animation: "vidSpin 1s linear infinite" }} />
              Verbindung wird wiederhergestellt…
            </div>
          )}

          {toast && (
            <div style={{
              position: "absolute", bottom: VM.barHeight + VM.barBottom + 22, left: "50%",
              transform: "translateX(-50%)", zIndex: 15,
              background: "rgba(15,18,24,.85)", border: `1px solid ${t.stageLine}`,
              borderRadius: 999, padding: "8px 15px", fontSize: 12.5, color: t.onStage,
              animation: "vidSlideUp .2s ease-out",
            }}>{toast}</div>
          )}

          <ControlBar
            t={t} visible={barVisible}
            micOn={micOn} camOn={camOn} screenOn={screenOn}
            onMic={toggleMic} onCam={toggleCam} onScreen={toggleScreen} onHand={raiseHand}
            onChat={() => { setPanel((p) => (p === "chat" ? null : "chat")); setUnread(0); }}
            onPeople={() => setPanel((p) => (p === "people" ? null : "people"))}
            onLeave={handleLeave}
            chatBadge={unread} peopleCount={participants.length}
          />
        </Stage>

        {panel && (
          <div style={{ padding: `${VM.stagePad}px ${VM.stagePad}px ${VM.stagePad}px 0`, display: "flex", minHeight: 0 }}>
            <SidePanel
              t={t} tab={panel} participants={participants}
              messages={chat} onSend={sendChat}
              onClose={() => setPanel(null)}
            />
          </div>
        )}
      </div>

      {error && (
        <div style={{
          position: "absolute", bottom: 12, left: 12, zIndex: 30,
          background: t.missed, color: "#fff", borderRadius: 10,
          padding: "8px 12px", fontSize: 12,
        }}>{error}</div>
      )}
    </div>
  );
}

// Animationen zentral – Inline-Styles können keine Keyframes.
function Keyframes() {
  return (
    <style>{`
      @keyframes vidSpin { from { transform: rotate(0) } to { transform: rotate(360deg) } }
      @keyframes vidPulse { 0%,100% { transform: scaleY(.45) } 50% { transform: scaleY(1) } }
      @keyframes vidSlideIn { from { opacity: 0; transform: translateX(12px) } to { opacity: 1; transform: none } }
      @keyframes vidSlideUp { from { opacity: 0; transform: translate(-50%, 8px) } to { opacity: 1; transform: translate(-50%, 0) } }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation-duration: .001ms !important; transition-duration: .001ms !important; }
      }
    `}</style>
  );
}
