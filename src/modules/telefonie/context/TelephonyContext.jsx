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
// tel:-Standard-App-Weg, die anderen per Realtime-Broadcast-Event
// "control_command" auf CALLS_CHANNEL -- ein kleiner lokaler Node-Prozess
// (microsip-control-listener.js) ist selbst ein Realtime-Client auf
// demselben Kanal und loest MicroSIPs dokumentierte Kommandozeilen-Schalter
// aus. NICHT per direktem Browser-Fetch auf 127.0.0.1 (erster Versuch) --
// Chrome verlangt dafuer eine Nutzer-Erlaubnis (Private Network Access,
// aehnlich Kamera/Mikro), die sich nicht automatisieren laesst und den Fetch
// sonst endlos haengen laesst. toggleMute/toggleHold/toggleVideo bleiben
// reine UI-Anzeige — MicroSIP hat dafuer keinen bekannten Fernsteuer-
// Schalter. "Verbinden" (Transfer) ebenfalls noch nicht verdrahtet (MicroSIP
// koennte es per /transfer:XXX, fehlt nur die UI dafuer).
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
  // ⚠️ Bereits beendete call.id merken (2026-07-26, gleiche Lehre wie in der
  // Tray-App): die verwaisten peoplefone-Subscriptions stellen jedes Ereignis
  // zigfach und teils verspaetet zu -- ein "answered"-Duplikat NACH dem
  // Auflegen liess das Gespraechs-Panel sonst wieder auferstehen (Sascha:
  // "die Kachel aktualisiert sich mehrfach, auch beim Aufhaengen").
  const endedIdsRef = useRef([]);
  const rememberEndedId = useCallback((id) => {
    if (!id || endedIdsRef.current.includes(id)) return;
    endedIdsRef.current.push(id);
    if (endedIdsRef.current.length > 20) endedIdsRef.current.shift();
  }, []);
  useEffect(() => {
    if (!myId) return;
    // Der Browser ist angemeldet -- Realtime muss das Token kennen, sonst
    // bleibt das private Thema verschlossen (Migration 20260730100000).
    supabase.auth.getSession().then(({ data }) => {
      try { supabase.realtime.setAuth(data?.session?.access_token ?? null); } catch { /* egal */ }
    });
    // Ein Ereignis, zwei Wege: waehrend der Umstellung liefert der Webhook
    // sowohl ins persoenliche private Thema als auch auf den alten
    // Gemeinschaftskanal. Dieselbe Behandlung fuer beide -- eine Dublette
    // desselben Anrufs faengt die Zustandslogik unten ab (gleiche call.id =
    // gleiches Bein, also kein zweiter Screen-Pop).
    const behandleAnruf = ({ payload }) => {
      if (!payload) return;
      if (payload.targetUserId && payload.targetUserId !== myId) return; // nicht für mich
      const incomingCall = payload.call;
      const evtStatus = incomingCall?.status || "ringing";
      if (incomingCall?.id && endedIdsRef.current.includes(incomingCall.id)) return; // laengst erledigt

      if (evtStatus === "ringing") {
        // Ausgehende Anrufe meldet der peoplefone-Webhook ebenfalls (dir
        // "out") -- selbst gewaehlt, also kein Screen-Pop "Eingehender Anruf".
        if (incomingCall?.dir === "out") return;
        // ⚠️ Kein blindes setCall(null) mehr: peoplefone schickt "ringing"-
        // Wiederholungen teils noch verspaetet NACH "answered" -- das warf
        // ein bereits aktives Gespraech aus der Oberflaeche (Review-Befund
        // 2026-07-26). Ein aktiver Anruf gewinnt immer gegen neues Klingeln.
        setCall((prev) => {
          if (prev) return prev;
          setWrapup(null);
          setIncoming(incomingCall);
          return null;
        });
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
        rememberEndedId(incomingCall?.id);
        setCall((prev) => {
          if (!prev) return null;
          // ⚠️ Rufgruppen-Beine (2026-07-26): EIN realer Anruf laeuft bei
          // peoplefone als MEHRERE callIds (Gruppen-Bein + Leitungs-Bein).
          // Das "ended" eines ANDEREN Beins (andere id, Richtung nicht
          // "out") darf das aktive Gespraech nicht beenden -- das Bein
          // stirbt genau dann, wenn man selbst abnimmt.
          if (incomingCall?.dir !== "out" && prev.id && incomingCall?.id && prev.id !== incomingCall.id) return prev;
          const durationSec = Math.max(0, Math.floor((Date.now() - (prev.startedAt || Date.now())) / 1000));
          setWrapup({ ...prev, durationSec, endedAt: Date.now() });
          return null;
        });
        // Klingel-Pop nur schliessen, wenn wirklich DIESES Bein endet.
        setIncoming((prevInc) => (prevInc && prevInc.id && incomingCall?.id && prevInc.id !== incomingCall.id ? prevInc : null));
      }
    };

    const ch = supabase.channel(CALLS_CHANNEL, { config: { broadcast: { self: true } } });
    ch.on("broadcast", { event: "incoming_call" }, behandleAnruf).subscribe();
    callsChRef.current = ch;

    // Persoenliches, privates Thema -- dorthin wandert alles, sobald auch der
    // Fernsteuer-Helfer angemeldet ist. Faellt es aus, bleibt der alte Kanal
    // als Netz darunter; still wird es also nie.
    const privat = supabase.channel(`telefonie-user:${myId}`, {
      config: { broadcast: { self: true }, private: true },
    });
    privat.on("broadcast", { event: "incoming_call" }, behandleAnruf).subscribe((s) => {
      if (s === "CHANNEL_ERROR") {
        console.warn("Privates Telefonie-Thema nicht erreichbar — es gilt weiter der alte Kanal.");
      }
    });

    return () => {
      callsChRef.current = null;
      supabase.removeChannel(ch);
      supabase.removeChannel(privat);
    };
  }, [myId]);

  // ── Echte Fernsteuerung von MicroSIP (2026-07-22) ────────────────────────
  // Sendet auf demselben Kanal wie eingehende Anrufe, nur anderes Event --
  // microsip-control-listener.js (lokaler Node-Prozess, selbst ein Realtime-
  // Client) hoert mit und loest MicroSIPs Kommandozeilen-Schalter aus.
  //
  // ⚠️ Seit 2026-07-26 NICHT mehr Fire-and-forget (Review-Befund: Auflegen
  // verpuffte kommentarlos, wenn der Browser-Kanal gerade getrennt war --
  // MicroSIP telefonierte weiter, waehrend die UI laengst "beendet" zeigte).
  // Jetzt: Sendeergebnis pruefen, bei Fehlschlag einmal ueber Supabase's
  // REST-Broadcast-Endpoint nachsenden (funktioniert auch bei totem
  // WebSocket-Kanal) und true/false an den Aufrufer zurueckgeben.
  const [controlError, setControlError] = useState(null);
  const controlErrorTimer = useRef(null);
  const flagControlError = useCallback((msg) => {
    setControlError(msg);
    if (controlErrorTimer.current) clearTimeout(controlErrorTimer.current);
    controlErrorTimer.current = setTimeout(() => setControlError(null), 6000);
  }, []);

  // ── Persoenliches Geheimnis zum Signieren (Security-Paket 2026-07-26) ───
  // Der Kanal ist oeffentlich; ohne Signatur koennte jeder mit Kanalnamen und
  // Profil-ID fremde Telefone steuern ("answer" = mithoeren). RLS gibt jedem
  // nur das EIGENE Profil frei, das Geheimnis autorisiert also genau das
  // eigene Telefon.
  const controlSecretRef = useRef(null);
  useEffect(() => {
    if (!myId) return;
    let abgebrochen = false;
    supabase.from("profiles").select("telefonie_control_secret").eq("id", myId).maybeSingle()
      .then(({ data }) => { if (!abgebrochen) controlSecretRef.current = data?.telefonie_control_secret || null; })
      .catch(() => { /* ohne Geheimnis bleibt die Fernsteuerung wirkungslos */ });
    return () => { abgebrochen = true; };
  }, [myId]);

  const signiere = useCallback(async (payload) => {
    const secret = controlSecretRef.current;
    if (!secret) return null;
    const kanonisch = [payload.targetUserId, payload.action, payload.target ?? "", payload.digit ?? "", payload.ts, payload.nonce].join("|");
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, enc.encode(kanonisch));
    return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }, []);

  const sendControlCommand = useCallback(async (action, extra) => {
    if (!myId) return false;
    const payload = {
      targetUserId: myId,
      action,
      ...extra,
      ts: Date.now(),
      nonce: crypto.getRandomValues(new Uint8Array(12)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), ""),
    };
    payload.sig = await signiere(payload);
    if (!payload.sig) {
      console.error("Kein Fernsteuer-Geheimnis im Profil -- Befehl wird nicht gesendet.");
      return false;
    }
    try {
      if (callsChRef.current) {
        const status = await callsChRef.current.send({ type: "broadcast", event: "control_command", payload });
        if (status === "ok") return true;
      }
    } catch { /* faellt auf REST zurueck */ }
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/realtime/v1/api/broadcast`, {
        method: "POST",
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: [{ topic: "telefonie-calls", event: "control_command", payload, private: false }] }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, [myId, signiere]);

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
  // ⚠️ UI-Zustand erst NACH bestaetigter Zustellung abbauen (2026-07-26):
  // vorher raeumten answer/decline/hangup die Oberflaeche bedingungslos ab
  // und maskierten damit jeden Zustellfehler -- der rote Knopf war weg,
  // obwohl MicroSIP weitertelefonierte. Schlaegt die Zustellung fehl,
  // bleibt der Zustand stehen (Knopf erneut klickbar) + kurzer Fehlerhinweis.
  const answer = useCallback(async () => {
    const ok = await sendControlCommand("answer");
    if (!ok) { flagControlError("Annehmen nicht zugestellt — nochmals versuchen"); return; }
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
  }, [sendControlCommand, flagControlError]);

  const decline = useCallback(async () => {
    const ok = await sendControlCommand("decline");
    if (!ok) { flagControlError("Ablehnen nicht zugestellt — nochmals versuchen"); return; }
    setIncoming((prev) => { rememberEndedId(prev?.id); return null; });
  }, [sendControlCommand, flagControlError, rememberEndedId]);
  const hangup = useCallback(async () => {
    const ok = await sendControlCommand("hangup");
    if (!ok) { flagControlError("Auflegen nicht zugestellt — nochmals versuchen"); return; }
    setCall((prev) => {
      if (prev) {
        // Auch lokal aufgelegte Anrufe als erledigt merken -- verspaetete
        // "answered"-Duplikate duerfen das Panel nicht wiederbeleben.
        rememberEndedId(prev.id);
        const durationSec = Math.max(0, Math.floor((Date.now() - (prev.startedAt || Date.now())) / 1000));
        setWrapup({ ...prev, durationSec, endedAt: Date.now() });
      }
      return null;
    });
  }, [sendControlCommand, flagControlError, rememberEndedId]);
  const clearWrapup = useCallback(() => setWrapup(null), []);
  const toggleMute  = useCallback(() => setCall((c) => (c ? { ...c, muted: !c.muted } : c)), []);
  const toggleHold  = useCallback(() => setCall((c) => (c ? { ...c, onHold: !c.onHold } : c)), []);
  const toggleVideo = useCallback(() => setCall((c) => (c ? { ...c, video: !c.video } : c)), []);
  // Echtes DTMF ueber denselben Weg -- MicroSIP kennt keinen Mute/Hold-
  // Schalter, darum bleiben toggleMute/toggleHold oben bewusst reine
  // UI-Anzeige (kein bekannter Fernsteuer-Weg dafuer).
  const sendDtmf = useCallback((digit) => sendControlCommand("dtmf", { digit }), [sendControlCommand]);

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
    controlError,
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
