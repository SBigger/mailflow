import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";

// ===========================================================================
// TelephonyContext — Telefonie-Client
//
// Motor = peoplefone vPBX (Cloud, kein eigener Server); Endgerät = MicroSIP.
// Anrufstatus kommt server-seitig ueber peoplefones Call-Management-API
// (telefonie-peoplefone-webhook, Nachfolger des fragilen lokalen ini-Hook-
// Wegs) und/oder das lokale MicroSIP-Hook-Skript, beide auf denselben
// Realtime-Broadcast-Kanal (siehe unten).
//
// dial()/answer()/decline()/hangup()/sendDtmf() sind ECHT: dial() ueber den
// tel:-Standard-App-Weg, die anderen ueber einen kleinen lokalen Node-
// Listener (microsip-control-listener.js, 127.0.0.1:8743), der MicroSIPs
// dokumentierte Kommandozeilen-Schalter ausloest. toggleMute/toggleHold/
// toggleVideo bleiben reine UI-Anzeige — MicroSIP hat dafuer keinen
// bekannten Fernsteuer-Schalter. "Verbinden" (Transfer) ebenfalls noch nicht
// verdrahtet (MicroSIP koennte es per /transfer:XXX, fehlt nur die UI dafuer).
//
// ECHT sind auch zwei Bausteine, die rein auf Supabase Realtime laufen:
//   – Presence: wer ist gerade online, mit welchem Status (frei/besetzt/DND/
//     abwesend/im Gespräch) — Realtime-Presence-Channel, gleiches Muster wie
//     `chartis-presence` in Chartis.jsx.
//   – Eingehender Anruf: Realtime-Broadcast-Event, das sowohl vom lokalen
//     MicroSIP-Hook als auch von peoplefones Webhook ausgeloest wird.
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

// ── Echte Fernsteuerung von MicroSIP (2026-07-22) ────────────────────────
// MicroSIP hat dokumentierte Kommandozeilen-Schalter (microsip.org/help):
// eine zweite Instanz mit z.B. "/answer" reicht den Befehl (wegen
// singleMode=1) an die laufende Instanz weiter. Ein kleiner lokaler
// Node-Listener (microsip-control-listener.js, laeuft via Autostart auf
// 127.0.0.1:8743) nimmt diese Anfragen entgegen und fuehrt sie aus.
// Bewusst fire-and-forget: laeuft der lokale Helfer nicht (anderes Geraet,
// nicht gestartet), darf das die smartis-UI nie blockieren oder stoeren --
// dann bleibt es beim bisherigen Verhalten (nur lokale Anzeige, echte
// Aktion muss man in MicroSIP selbst ausloesen).
const LOCAL_CONTROL_BASE = "http://127.0.0.1:8743";
const LOCAL_CONTROL_SECRET = "57f92176bfa95ddfc11a3c66a19de11e";

function callLocalControl(action, params) {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  fetch(LOCAL_CONTROL_BASE + "/" + action + qs, {
    method: "POST",
    headers: { "X-Local-Secret": LOCAL_CONTROL_SECRET },
  }).catch(() => {
    // Lokaler Helfer nicht erreichbar -- bewusst still, siehe oben.
  });
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
  // Loest ECHT aus (MicroSIP nimmt den klingelnden Anruf an) UND zeigt
  // optimistisch die aktive Ansicht -- der reale "answered"-Broadcast (siehe
  // oben) kommt gleich danach nach und ueberschreibt nichts, da bereits aktiv.
  const answer = useCallback(() => {
    callLocalControl("answer");
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

  const decline = useCallback(() => {
    callLocalControl("decline");
    setIncoming(null);
  }, []);
  const hangup = useCallback(() => {
    callLocalControl("hangup");
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
  // Echtes DTMF ueber denselben lokalen Weg -- MicroSIP kennt keinen
  // Mute/Hold-Schalter, darum bleiben toggleMute/toggleHold oben bewusst
  // reine UI-Anzeige (kein bekannter CLI-Weg dafuer).
  const sendDtmf = useCallback((digit) => callLocalControl("dtmf", { digit }), []);

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
    sendDtmf,
    simulateIncoming,
    signalIncoming,
  };

  return <TelephonyCtx.Provider value={value}>{children}</TelephonyCtx.Provider>;
}
