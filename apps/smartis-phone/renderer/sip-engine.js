// ===========================================================================
// SIP-Motor -- der erste Motor, der WIRKLICH telefoniert.
//
// Vorgeschichte: peoplefone hat am 10.08.2026 bestaetigt, dass ihr WebSocket-
// Zugang (derselbe wie fuer das Odoo-Widget) ohne Sonderfreigabe nutzbar ist:
//   wss://webrtcproxy.peoplefone.ch/ws
// Damit faellt MicroSIP als unsichtbarer Sprach-Motor weg -- und mit ihm der
// Grund, warum bei jeder Person etwas installiert werden musste.
//
// ⚠️ peoplefone nennt diesen Zugang AUSDRUECKLICH provisorisch ("not final and
// expected to change in the near future"). Deshalb steht die Adresse nirgends
// fest im Code, sondern kommt aus der Konfiguration -- ein Umzug ist dann ein
// Eintrag, kein Umbau.
//
// Laeuft im Renderer, nicht im Hauptprozess: WebRTC gibt es nur im
// Browserkontext (getUserMedia, RTCPeerConnection).
//
// Erfuellt dieselbe Schnittstelle wie die bisherigen Motoren
// (engine/engine-api.md), damit die Oberflaeche unveraendert bleibt:
//   on(event, handler) · getState() · connect() · answer() · hangup()
//   transfer(ziel) · sendDtmf(ziffer) · setMuted(v) · setHold(v)
// Zusaetzlich: dial(nummer) -- das konnte bisher nur MicroSIP.
// ===========================================================================
(function () {
  const STANDARD_WSS = "wss://webrtcproxy.peoplefone.ch/ws";
  const STANDARD_DOMAIN = "webrtcproxy.peoplefone.ch";

  function createSipEngine({ wsServer, domain, sipUser, sipPassword, log = () => {} }) {
    const handlers = {};
    const emit = (event, payload) => (handlers[event] || []).forEach((h) => h(payload));

    let ua = null;
    let registerer = null;
    let session = null;            // laufende oder klingelnde Sitzung
    let call = null;               // unser Zustandsbild davon
    let registration = { state: "connecting" };

    // Ein einziges Audio-Element fuer die Gegenstelle. Ohne das hoert man
    // nichts -- der Strom muss irgendwo abgespielt werden.
    let audio = document.getElementById("sipAudio");
    if (!audio) {
      audio = document.createElement("audio");
      audio.id = "sipAudio";
      audio.autoplay = true;
      document.body.appendChild(audio);
    }

    const setzeRegistrierung = (state, message) => {
      registration = { state, ...(message ? { message } : {}) };
      emit("registration", { ...registration });
    };

    function nummerAus(uri) {
      try { return uri?.user ? String(uri.user) : ""; } catch { return ""; }
    }

    // Den Ton der Gegenstelle ans Audio-Element haengen. Muss nach jedem
    // Verhandeln neu geschehen (Halten/Fortsetzen tauscht die Spuren).
    function verbindeTon(s) {
      try {
        const pc = s.sessionDescriptionHandler?.peerConnection;
        if (!pc) return;
        const strom = new MediaStream();
        pc.getReceivers().forEach((r) => { if (r.track) strom.addTrack(r.track); });
        audio.srcObject = strom;
        audio.play().catch(() => { /* Autoplay-Sperre -- kommt beim Abnehmen */ });
      } catch (e) {
        log("Ton konnte nicht verbunden werden:", e.message);
      }
    }

    function beende(grund) {
      const vorher = call;
      session = null;
      call = null;
      audio.srcObject = null;
      if (vorher) {
        emit("call", { ...vorher, status: "ended" });
        const dauer = vorher.startedAt ? Math.round((Date.now() - vorher.startedAt) / 1000) : 0;
        emit("callEnded", { id: vorher.id, durationSec: dauer, reason: grund || "beendet" });
      }
    }

    function beobachteSitzung(s) {
      s.stateChange.addListener((zustand) => {
        log("Sitzung:", zustand);
        if (zustand === "Established") {
          verbindeTon(s);
          if (call) {
            call = { ...call, status: "active", startedAt: call.startedAt || Date.now() };
            emit("call", { ...call });
          }
        } else if (zustand === "Terminated") {
          beende("beendet");
        }
      });
    }

    function connect() {
      if (!sipUser || !sipPassword) {
        setzeRegistrierung("failed", "Keine SIP-Zugangsdaten hinterlegt");
        return;
      }
      setzeRegistrierung("connecting");

      const ziel = domain || STANDARD_DOMAIN;
      const uri = SIP.UserAgent.makeURI(`sip:${sipUser}@${ziel}`);
      if (!uri) { setzeRegistrierung("failed", "SIP-Adresse ungueltig"); return; }

      ua = new SIP.UserAgent({
        uri,
        transportOptions: { server: wsServer || STANDARD_WSS },
        authorizationUsername: sipUser,
        authorizationPassword: sipPassword,
        // Nur Ton. Video kaeme spaeter und braucht eigene Ueberlegungen.
        sessionDescriptionHandlerFactoryOptions: {
          constraints: { audio: true, video: false },
        },
        delegate: {
          onInvite(invitation) {
            // Zweiter Anruf, waehrend einer laeuft: hoeflich ablehnen statt
            // den bestehenden zu stoeren (Makeln kommt spaeter).
            if (session) { try { invitation.reject(); } catch { /* egal */ } return; }
            session = invitation;
            beobachteSitzung(invitation);
            call = {
              id: invitation.request?.callId || String(Date.now()),
              dir: "in",
              status: "ringing",
              peerNumber: nummerAus(invitation.remoteIdentity?.uri),
              peerName: invitation.remoteIdentity?.displayName || null,
              customer: null,
              dossier: null,
              startedAt: null,
              muted: false,
              onHold: false,
            };
            log("Eingehender Anruf von", call.peerNumber);
            emit("call", { ...call });
          },
        },
      });

      ua.start().then(() => {
        registerer = new SIP.Registerer(ua);
        registerer.stateChange.addListener((z) => {
          log("Registrierung:", z);
          if (z === "Registered") setzeRegistrierung("registered");
          else if (z === "Unregistered") setzeRegistrierung("failed", "Nicht registriert");
        });
        return registerer.register();
      }).catch((e) => {
        log("Verbindung fehlgeschlagen:", e.message);
        setzeRegistrierung("failed", e.message);
      });
    }

    async function dial(nummer) {
      const sauber = String(nummer || "").replace(/[^\d+*#]/g, "");
      if (!sauber || !ua || session) return false;
      const ziel = SIP.UserAgent.makeURI(`sip:${sauber}@${domain || STANDARD_DOMAIN}`);
      if (!ziel) return false;
      const inviter = new SIP.Inviter(ua, ziel, {
        sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
      });
      session = inviter;
      beobachteSitzung(inviter);
      call = {
        id: String(Date.now()), dir: "out", status: "calling",
        peerNumber: sauber, peerName: null, customer: null, dossier: null,
        startedAt: null, muted: false, onHold: false,
      };
      emit("call", { ...call });
      try {
        await inviter.invite();
        return true;
      } catch (e) {
        log("Anruf fehlgeschlagen:", e.message);
        beende("nicht zustande gekommen");
        return false;
      }
    }

    function spuren() {
      const pc = session?.sessionDescriptionHandler?.peerConnection;
      return pc ? pc.getSenders().filter((s) => s.track && s.track.kind === "audio") : [];
    }

    return {
      on(event, handler) { (handlers[event] = handlers[event] || []).push(handler); },
      getState() { return { registration: { ...registration }, call: call ? { ...call } : null }; },
      connect,
      disconnect() {
        try { registerer?.unregister(); } catch { /* egal */ }
        try { ua?.stop(); } catch { /* egal */ }
        ua = null; registerer = null;
      },
      dial,

      async answer() {
        if (!session || typeof session.accept !== "function") return false;
        await session.accept({
          sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
        });
        return true;
      },

      async hangup() {
        if (!session) return false;
        try {
          // Je nach Zustand ist das Ablehnen, Abbrechen oder Auflegen --
          // SIP kennt dafuer drei verschiedene Nachrichten.
          if (session.state === "Initial" || session.state === "Establishing") {
            if (typeof session.reject === "function") await session.reject();
            else if (typeof session.cancel === "function") await session.cancel();
          } else {
            await session.bye();
          }
        } catch (e) {
          log("Auflegen:", e.message);
        }
        beende("beendet");
        return true;
      },

      // Echtes Weiterverbinden per REFER -- das konnte der Umweg ueber
      // MicroSIP nur blind, hier ist es der SIP-Standardweg.
      async transfer(ziel) {
        const sauber = String(ziel || "").replace(/[^\d+*#]/g, "");
        if (!session || !sauber) return false;
        const uri = SIP.UserAgent.makeURI(`sip:${sauber}@${domain || STANDARD_DOMAIN}`);
        if (!uri) return false;
        try { await session.refer(uri); return true; }
        catch (e) { log("Verbinden fehlgeschlagen:", e.message); return false; }
      },

      async sendDtmf(ziffer) {
        const z = String(ziffer || "");
        if (!session || !/^[0-9*#]$/.test(z)) return false;
        try {
          // RFC 2833 ueber den Medienkanal -- was Telefonanlagen erwarten.
          session.sessionDescriptionHandler?.sendDtmf(z);
          return true;
        } catch (e) { log("DTMF:", e.message); return false; }
      },

      setMuted(v) {
        spuren().forEach((s) => { s.track.enabled = !v; });
        if (call) { call = { ...call, muted: !!v }; emit("call", { ...call }); }
      },

      async setHold(v) {
        if (!session) return;
        try {
          await session.invite({
            sessionDescriptionHandlerOptions: { hold: !!v },
          });
          if (call) { call = { ...call, onHold: !!v }; emit("call", { ...call }); }
        } catch (e) { log("Halten:", e.message); }
      },
    };
  }

  window.createSipEngine = createSipEngine;
  window.SIP_STANDARD = { wss: STANDARD_WSS, domain: STANDARD_DOMAIN };
})();
