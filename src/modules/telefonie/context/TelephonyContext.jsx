import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";

// ===========================================================================
// TelephonyContext — Telefonie-Client
//
// Medien-/SIP-Teil ist bewusst noch ein STUB: kein LiveKit, kein SIP, keine
// Audio-Tracks. Er hält den UI-Zustand (aktiver Anruf, eingehender Anruf,
// Wrap-up) und bietet die Methoden-Signaturen, die später der echte Client
// erfüllt (dial/answer/hangup/hold/mute/transfer).
//
// ECHT (kein Stub) sind dagegen zwei Bausteine, die rein auf Supabase Realtime
// laufen und darum schon heute plattformweit funktionieren:
//   – Presence: wer ist gerade online, mit welchem Status (frei/besetzt/DND/
//     abwesend/im Gespräch) — Realtime-Presence-Channel, gleiches Muster wie
//     `chartis-presence` in Chartis.jsx.
//   – Eingehender Anruf: statt nur lokalen State zu setzen, wird ein
//     Realtime-Broadcast-Event gesendet/empfangen. Das ist exakt der Kanal,
//     an den später ein Server-Trigger (z. B. die peoplefone-CONNECTOR-Edge-
//     Function) andocken kann, um einen ECHTEN eingehenden Anruf plattformweit
//     zu signalisieren — ohne dass sich am Frontend-Code etwas ändern muss.
//
// SEAM für die künftige Medien-Anbindung:
//   connect()          → LiveKit-Room-Verbindung aufbauen (Token via Edge Fn)
//   dial(number)       → CreateSIPParticipant über PBX/LiveKit SIP
//   answer()/hangup()  → Room join / leave
//   hold()/mute()      → Track-Steuerung
//   transfer(target)   → REFER (blind) bzw. Raum-Orchestrierung (attended)
// ===========================================================================

const TelephonyCtx = createContext(null);
export const useTelephony = () => useContext(TelephonyCtx);

const PRESENCE_CHANNEL = "telefonie-presence";
const CALLS_CHANNEL = "telefonie-calls";

export function TelephonyProvider({ children }) {
  const { profile } = useAuth();
  const myId = profile?.id || null;
  const myName = profile?.full_name || profile?.email || "Jemand";

  const [presence, setPresenceState] = useState(
    () => localStorage.getItem("tele_presence") || "available"
  );
  const [call, setCall] = useState(null);         // aktiver / ausgehender Anruf
  const [incoming, setIncoming] = useState(null); // eingehender Anruf (Screen-Pop)
  const [panelOpen, setPanelOpen] = useState(false);
  const [wrapup, setWrapup] = useState(null); // gerade beendeter Anruf → Nachbearbeitung
  const [teamPresence, setTeamPresence] = useState({}); // { [userId]: {status, fullName, at} }

  useEffect(() => {
    localStorage.setItem("tele_presence", presence);
  }, [presence]);

  const setPresence = useCallback((p) => setPresenceState(p), []);

  // Angezeigter Presence-Status: „im Gespräch" überschreibt manuell gewählten.
  const effectivePresence = call ? "incall" : presence;

  // ── Realtime-Presence: wer ist online, mit welchem Status ───────────────
  // Gleiches Muster wie chartis-presence (Chartis.jsx): ein Channel, Key =
  // user.id, track() bei jeder Statusänderung, sync-Event baut die Landkarte.
  const presenceChRef = useRef(null);
  useEffect(() => {
    if (!myId) return;
    const ch = supabase.channel(PRESENCE_CHANNEL, { config: { presence: { key: myId } } });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState();
      const map = {};
      for (const [uid, entries] of Object.entries(state)) {
        const last = entries[entries.length - 1];
        if (last) map[uid] = { status: last.status, fullName: last.fullName, at: last.at };
      }
      setTeamPresence(map);
    }).subscribe((status) => {
      if (status === "SUBSCRIBED") ch.track({ status: effectivePresence, fullName: myName, at: Date.now() });
    });
    presenceChRef.current = ch;
    return () => { presenceChRef.current = null; supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  // Statuswechsel (manuell oder automatisch durch Anruf) an den Channel nachreichen.
  useEffect(() => {
    if (presenceChRef.current) presenceChRef.current.track({ status: effectivePresence, fullName: myName, at: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePresence]);

  // ── Realtime-Broadcast: eingehender Anruf ────────────────────────────────
  // self:true, damit der auslösende Client (Test-Anruf) sein eigenes Signal
  // auch empfängt — dieselbe Leitung, die später ein Server-Event nutzt.
  const callsChRef = useRef(null);
  useEffect(() => {
    if (!myId) return;
    const ch = supabase.channel(CALLS_CHANNEL, { config: { broadcast: { self: true } } });
    ch.on("broadcast", { event: "incoming_call" }, ({ payload }) => {
      if (!payload) return;
      if (payload.targetUserId && payload.targetUserId !== myId) return; // nicht für mich
      setCall(null);
      setWrapup(null);
      setIncoming(payload.call);
    }).subscribe();
    callsChRef.current = ch;
    return () => { callsChRef.current = null; supabase.removeChannel(ch); };
  }, [myId]);

  // ── ausgehend ──────────────────────────────────────────────────────────
  const dial = useCallback((number, meta = {}) => {
    if (!number) return;
    setIncoming(null);
    setWrapup(null);
    // STUB: sofort „verbunden" — später CreateSIPParticipant + Room-Join
    setCall({
      id: "stub-" + Date.now(),
      dir: "out",
      status: "active",
      peerNumber: number,
      peerName: meta.name || null,
      customer: meta.customer || null,
      startedAt: Date.now(),
      muted: false,
      onHold: false,
      video: false,
    });
    setPanelOpen(true);
  }, []);

  // ── eingehend annehmen ─────────────────────────────────────────────────
  const answer = useCallback(() => {
    setWrapup(null);
    setIncoming((prev) => {
      if (!prev) return null;
      setCall({
        ...prev,
        status: "active",
        startedAt: Date.now(),
        muted: false,
        onHold: false,
        video: false,
      });
      return null;
    });
    setPanelOpen(true);
  }, []);

  const decline = useCallback(() => setIncoming(null), []);
  const hangup = useCallback(() => {
    setCall((prev) => {
      if (prev) {
        const durationSec = Math.max(0, Math.floor((Date.now() - (prev.startedAt || Date.now())) / 1000));
        setWrapup({ ...prev, durationSec, endedAt: Date.now() });
      }
      return null;
    });
  }, []);
  const clearWrapup = useCallback(() => setWrapup(null), []);
  const toggleMute  = useCallback(() => setCall((c) => (c ? { ...c, muted: !c.muted } : c)), []);
  const toggleHold  = useCallback(() => setCall((c) => (c ? { ...c, onHold: !c.onHold } : c)), []);
  const toggleVideo = useCallback(() => setCall((c) => (c ? { ...c, video: !c.video } : c)), []);

  // ── Eingehenden Anruf signalisieren ──────────────────────────────────────
  // Sendet ein Broadcast-Event statt nur lokalen State zu setzen — genau der
  // Weg, den später ein echter Anruf (Server-seitig ausgelöst) nehmen würde.
  // targetUserId=null → Signal geht an alle (z. B. Rufgruppe); gesetzt → nur
  // an die eine Person (heutiger Test-Anruf-Knopf zielt auf sich selbst).
  const signalIncoming = useCallback((callPayload, targetUserId = myId) => {
    if (!callsChRef.current) return;
    callsChRef.current.send({
      type: "broadcast",
      event: "incoming_call",
      payload: { targetUserId, call: callPayload },
    });
  }, [myId]);

  // Beibehaltener Name für bestehende Aufrufer (Cockpit-Testknopf): simuliert
  // jetzt einen ECHTEN Realtime-Roundtrip statt nur lokalen State zu setzen.
  const simulateIncoming = useCallback((payload) => {
    const call1 = payload || {
      id: "sim-" + Date.now(),
      dir: "in",
      status: "ringing",
      peerNumber: "+41 71 222 33 44",
      peerName: "Bäckerei Hausmann AG",
      customer: { id: null, company_name: "Bäckerei Hausmann AG" },
      viaNumber: "+41 71 511 22 33",
    };
    signalIncoming(call1, myId);
  }, [signalIncoming, myId]);

  const value = {
    presence,
    effectivePresence,
    setPresence,
    teamPresence,
    call,
    incoming,
    wrapup,
    clearWrapup,
    panelOpen,
    setPanelOpen,
    dial,
    answer,
    decline,
    hangup,
    toggleMute,
    toggleHold,
    toggleVideo,
    simulateIncoming,
    signalIncoming,
    isStub: true,
  };

  return <TelephonyCtx.Provider value={value}>{children}</TelephonyCtx.Provider>;
}
