import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

// ===========================================================================
// TelephonyContext — Telefonie-Client (STUB)
//
// Dies ist bewusst ein STUB ohne echte Verbindung: kein LiveKit, kein SIP,
// keine Medien. Er hält nur den UI-Zustand (Presence, aktiver Anruf,
// eingehender Anruf) und bietet die Methoden-Signaturen, die später der echte
// Client erfüllt.
//
// SEAM für die Backend-Verdrahtung (Schritt 2, sobald die Test-VM steht):
//   connect()          → LiveKit-Room-Verbindung aufbauen (Token via Edge Fn)
//   dial(number)       → CreateSIPParticipant über Kamailio/LiveKit SIP
//   answer()/hangup()  → Room join / leave
//   hold()/mute()      → Track-Steuerung
//   transfer(target)   → REFER (blind) bzw. Raum-Orchestrierung (attended)
//   onIncoming(cb)     → LiveKit-Webhook → Supabase-Realtime → hier setIncoming()
//
// Bis dahin macht `simulateIncoming()` einen eingehenden Anruf für die UI-Demo.
// ===========================================================================

const TelephonyCtx = createContext(null);
export const useTelephony = () => useContext(TelephonyCtx);

export function TelephonyProvider({ children }) {
  const [presence, setPresenceState] = useState(
    () => localStorage.getItem("tele_presence") || "available"
  );
  const [call, setCall] = useState(null);         // aktiver / ausgehender Anruf
  const [incoming, setIncoming] = useState(null); // eingehender Anruf (Screen-Pop)
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("tele_presence", presence);
  }, [presence]);

  const setPresence = useCallback((p) => setPresenceState(p), []);

  // ── ausgehend ──────────────────────────────────────────────────────────
  const dial = useCallback((number, meta = {}) => {
    if (!number) return;
    setIncoming(null);
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
  const hangup  = useCallback(() => setCall(null), []);
  const toggleMute  = useCallback(() => setCall((c) => (c ? { ...c, muted: !c.muted } : c)), []);
  const toggleHold  = useCallback(() => setCall((c) => (c ? { ...c, onHold: !c.onHold } : c)), []);
  const toggleVideo = useCallback(() => setCall((c) => (c ? { ...c, video: !c.video } : c)), []);

  // ── DEV: eingehenden Anruf simulieren (bis das Backend live ist) ────────
  const simulateIncoming = useCallback((payload) => {
    setCall(null);
    setIncoming(
      payload || {
        id: "sim-" + Date.now(),
        dir: "in",
        status: "ringing",
        peerNumber: "+41 71 222 33 44",
        peerName: "Bäckerei Hausmann AG",
        customer: { id: null, company_name: "Bäckerei Hausmann AG" },
        viaNumber: "+41 71 511 22 33",
      }
    );
  }, []);

  // Angezeigter Presence-Status: „im Gespräch" überschreibt manuell gewählten.
  const effectivePresence = call ? "incall" : presence;

  const value = {
    presence,
    effectivePresence,
    setPresence,
    call,
    incoming,
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
    isStub: true,
  };

  return <TelephonyCtx.Provider value={value}>{children}</TelephonyCtx.Provider>;
}
