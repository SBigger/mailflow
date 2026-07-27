// ===========================================================================
// Realtime-Motor -- der erste ECHTE Motor hinter der Oberflaeche.
//
// Laeuft im Electron-Hauptprozess (Renderer hat kein Node) und erfuellt
// dieselbe Schnittstelle wie der Mock (engine/engine-api.md):
//   - Anrufe kommen ueber den Supabase-Realtime-Kanal "telefonie-calls"
//     herein, gefuellt vom peoplefone-Webhook (inkl. Kunde + Dossier).
//   - Annehmen/Auflegen/Verbinden/DTMF gehen als SIGNIERTER control_command
//     zurueck; der lokale Fernsteuerungs-Helfer setzt sie in MicroSIP um.
//
// MicroSIP ist damit nur noch der unsichtbare Sprach-Motor. Wenn spaeter ein
// eigener SIP-Stack dazukommt, ersetzt er genau diesen einen Baustein -- die
// Oberflaeche merkt davon nichts.
//
// ⚠️ Die Glaettungs-Regeln stammen 1:1 aus telefonie-tray und sind jede fuer
// sich teuer erkauft (siehe Projektgedaechtnis 2026-07-26):
//   - ausgehende Anrufe (dir "out") erzeugen keinen Screen-Pop
//   - "ended" eroeffnet nie einen neuen Anruf
//   - beendete call.id werden gemerkt (peoplefone wiederholt "terminated"
//     noch minutenlang)
//   - Rueckwaertsschritte (spaetes "ringing" nach "answered") werden verworfen
//   - gleiche Nummer + andere call.id + laufender Anruf = zweites Bein
//     derselben Rufgruppe, kein neuer Anruf
// ===========================================================================
const crypto = require("crypto");

const STATUS_RANK = { ringing: 0, calling: 0, active: 1, ended: 2 };
const MAX_REMEMBERED_ENDED = 20;

function createRealtimeEngine({ supabaseUrl, supabaseAnonKey, profileId, controlSecret, log = () => {} }) {
  const { createClient } = require("@supabase/supabase-js");
  const handlers = {};
  const emit = (event, payload) => (handlers[event] || []).forEach((h) => h(payload));

  let registration = { state: "connecting" };
  let call = null;               // aktueller Anruf oder null
  let channel = null;
  const endedIds = [];

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  function rememberEnded(id) {
    if (!id || endedIds.includes(id)) return;
    endedIds.push(id);
    if (endedIds.length > MAX_REMEMBERED_ENDED) endedIds.shift();
  }

  // Eingehendes Ereignis auf den Anruf-Zustand abbilden (siehe Regeln oben).
  function verarbeite(eingang) {
    if (!eingang || !eingang.status) return;
    if (eingang.dir === "out") return;                 // selbst gewaehlt
    if (endedIds.includes(eingang.id)) return;         // laengst erledigt

    const gleichesBein = call && call.id === eingang.id;
    const anderesBeinGleicheNummer = call && call.id !== eingang.id
      && eingang.peerNumber && eingang.peerNumber === call.peerNumber;

    if (eingang.status === "ended") {
      // Das Ende eines ANDEREN Beins beendet das Gespraech nicht -- dieses
      // Bein stirbt genau dann, wenn man selbst abnimmt.
      if (anderesBeinGleicheNummer) { rememberEnded(eingang.id); return; }
      if (!call) { rememberEnded(eingang.id); return; }   // eroeffnet nie etwas
      if (!gleichesBein) return;
      rememberEnded(eingang.id);
      const durationSec = call.startedAt ? Math.round((Date.now() - call.startedAt) / 1000) : 0;
      const beendet = { ...call, status: "ended" };
      call = null;
      emit("call", beendet);
      emit("callEnded", { id: beendet.id, durationSec, reason: "beendet" });
      return;
    }

    if (gleichesBein || anderesBeinGleicheNummer) {
      const rang = STATUS_RANK[eingang.status] ?? 0;
      if (rang < (STATUS_RANK[call.status] ?? 0)) return;  // kein Rueckschritt
      call = {
        ...call,
        status: eingang.status,
        // Dossier nachreichen, falls es erst spaeter mitkommt
        customer: eingang.customer || call.customer,
        dossier: eingang.dossier || call.dossier,
        startedAt: eingang.status === "active" && !call.startedAt ? Date.now() : call.startedAt,
      };
      emit("call", { ...call });
      return;
    }

    // Wirklich neuer Anruf
    call = {
      id: eingang.id,
      dir: "in",
      status: eingang.status,
      peerNumber: eingang.peerNumber || "",
      peerName: eingang.peerName || null,
      customer: eingang.customer || null,
      dossier: eingang.dossier || null,
      startedAt: eingang.status === "active" ? Date.now() : null,
      muted: false,
      onHold: false,
    };
    emit("call", { ...call });
  }

  // Signierter Fernsteuer-Befehl (Security-Paket 2026-07-26): der Kanal ist
  // oeffentlich -- ohne Signatur koennte jeder fremde Telefone steuern.
  function sendeBefehl(action, extra = {}) {
    if (!channel) return false;
    if (!controlSecret) {
      log("⚠️ Kein controlSecret -- Befehl", action, "wird nicht gesendet");
      return false;
    }
    const p = {
      targetUserId: profileId,
      action,
      ...extra,
      ts: Date.now(),
      nonce: crypto.randomBytes(12).toString("hex"),
    };
    const kanonisch = [p.targetUserId, p.action, p.target ?? "", p.digit ?? "", p.ts, p.nonce].join("|");
    p.sig = crypto.createHmac("sha256", controlSecret).update(kanonisch).digest("hex");
    channel.send({ type: "broadcast", event: "control_command", payload: p });
    log("Befehl gesendet:", action, extra.target ? "-> " + extra.target : "");
    return true;
  }

  function connect() {
    registration = { state: "connecting" };
    emit("registration", { ...registration });

    if (channel) { try { supabase.removeChannel(channel); } catch { /* egal */ } }
    channel = supabase.channel("telefonie-calls", { config: { broadcast: { self: true } } });

    channel.on("broadcast", { event: "incoming_call" }, ({ payload }) => {
      if (!payload) return;
      // Karten, die gezielt an jemand anderen gehen, ignorieren.
      if (payload.targetUserId && payload.targetUserId !== profileId) return;
      verarbeite(payload.call);
    }).subscribe((status) => {
      log("Realtime:", status);
      if (status === "SUBSCRIBED") {
        registration = { state: "registered", extension: null };
        emit("registration", { ...registration });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        registration = { state: "failed", message: "Verbindung unterbrochen" };
        emit("registration", { ...registration });
        setTimeout(connect, 3000); // Watchdog -- ohne ihn bleibt es still
      }
    });
  }

  return {
    on(event, handler) { (handlers[event] = handlers[event] || []).push(handler); },
    getState() { return { registration: { ...registration }, call: call ? { ...call } : null }; },
    connect,
    disconnect() { if (channel) { try { supabase.removeChannel(channel); } catch { /* egal */ } channel = null; } },
    answer() { return sendeBefehl("answer"); },
    hangup() { return sendeBefehl("hangup"); },
    transfer(target) { return sendeBefehl("transfer", { target: String(target) }); },
    sendDtmf(digit) { return sendeBefehl("dtmf", { digit: String(digit) }); },
    // MicroSIP kennt keine Fernsteuerung fuer Stumm/Halten -- bleibt reine
    // Anzeige, bis der eigene SIP-Stack da ist (ehrlich statt vorgetaeuscht).
    setMuted(v) { if (call) { call = { ...call, muted: !!v }; emit("call", { ...call }); } },
    setHold(v) { if (call) { call = { ...call, onHold: !!v }; emit("call", { ...call }); } },
  };
}

module.exports = { createRealtimeEngine };
