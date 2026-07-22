import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";

// ===========================================================================
// TelephonyContext — Telefonie-Client
//
// Medien-/Telefonie-Teil ist bewusst noch ein STUB: kein echter Anruf, keine
// Audio-Tracks. Er hält den UI-Zustand (aktiver Anruf, eingehender Anruf,
// Wrap-up) und bietet die Methoden-Signaturen, die später der echte Client
// erfüllt (dial/answer/hangup/hold/mute/transfer). Entschieden (2026-07-20):
// Motor = peoplefone vPBX (Cloud, kein eigener Server); Endgeräte = MicroSIP/
// Groundwire/Bria; Anbindung an smartis via peoplefone-CONNECTOR-API.
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
// SEAM für die künftige Medien-Anbindung (Softphone-Client an der vPBX):
//   dial(number)       → Softphone/CTI anweisen zu wählen (Click-to-Call)
//   answer()/hangup()  → Softphone-Kommando bzw. Anruf-Event der vPBX
//   hold()/mute()      → Softphone-Kommando
//   transfer(target)   → Softphone/vPBX-Transfer (blind oder mit Rückfrage)
// ===========================================================================

const TelephonyCtx = createContext(null);
export const useTelephony = () => useContext(TelephonyCtx);

const PRESENCE_CHANNEL = "telefonie-presence";
const CALLS_CHANNEL = "telefonie-calls";

// Loest den echten Anruf ueber das am PC als tel:-Standard-App hinterlegte
// Softphone (MicroSIP) aus -- per unsichtbarem <a href="tel:...">-Klick statt
// window.location.href, damit die SPA-Navigation nicht irritiert wird. Wird
// immer aus einem echten Klick (Anrufen-Button) heraus aufgerufen, daher kein
// Problem mit Browser-Regeln zu Nutzerinteraktion bei Custom-Protokollen.
function triggerTelLink(number) {
  if (!number) return;
  try {
    const clean = String(number).replace(/[^\d+]/g, "");
    if (!clean) return;
    const a = document.createElement("a");
    a.href = "tel:" + clean;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch {
    // Kein Standard-Handler hinterlegt o.ae. -- UI-Status wurde trotzdem gesetzt.
  }
}

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

  // ── Realtime-Broadcast: Anruf-Ereignisse ─────────────────────────────────
  // self:true, damit der auslösende Client (Test-Anruf) sein eigenes Signal
  // auch empfängt — dieselbe Leitung, die peoplefone-CONNECTOR UND das lokale
  // MicroSIP-Hook-Skript (microsip-notify.ps1) auf dem PC nutzen.
  // payload.call.status unterscheidet drei Ereignisse:
  //   "ringing"  → Screen-Pop (Dossier) anzeigen
  //   "answered" → zu aktivem Anruf befördern (falls nicht schon lokal aktiv,
  //                z. B. weil selbst gewählt — dann nicht überschreiben)
  //   "ended"    → laufenden Anruf automatisch ins Wrap-up/Leistungs-Panel
  //                überführen, genau wie ein manuelles hangup()
  const callsChRef = useRef(null);
  useEffect(() => {
    if (!myId) return;
    const ch = supabase.channel(CALLS_CHANNEL, { config: { broadcast: { self: true } } });
    ch.on("broadcast", { event: "incoming_call" }, ({ payload }) => {
      if (!payload) return;
      if (payload.targetUserId && payload.targetUserId !== myId) return; // nicht für mich
      const incomingCall = payload.call;
      const evtStatus = incomingCall?.status || "ringing";

      if (evtStatus === "ringing") {
        setCall(null);
        setWrapup(null);
        setIncoming(incomingCall);
        return;
      }

      if (evtStatus === "answered") {
        setCall((prev) => prev || {
          ...incomingCall,
          status: "active",
          startedAt: Date.now(),
          muted: false,
          onHold: false,
          video: false,
        });
        setIncoming(null);
        setPanelOpen(true);
        return;
      }

      if (evtStatus === "ended") {
        setCall((prev) => {
          if (!prev) return null;
          const durationSec = Math.max(0, Math.floor((Date.now() - (prev.startedAt || Date.now())) / 1000));
          setWrapup({ ...prev, durationSec, endedAt: Date.now() });
          return null;
        });
        setIncoming(null);
      }
    }).subscribe();
    callsChRef.current = ch;
    return () => { callsChRef.current = null; supabase.removeChannel(ch); };
  }, [myId]);

  // ── ausgehend ──────────────────────────────────────────────────────────
  // Wählt ECHT über das lokale Softphone (MicroSIP als tel:-Standard-App) UND
  // zeigt sofort optimistisch unsere eigene Anruf-Ansicht — der reale
  // "answered"/"ended"-Status kommt gleich danach über den Broadcast-Kanal
  // nach (siehe oben) und übernimmt bzw. beendet diesen Zustand automatisch.
  const dial = useCallback((number, meta = {}) => {
    if (!number) return;
    setIncoming(null);
    setWrapup(null);
    triggerTelLink(number);
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
