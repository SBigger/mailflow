// ===========================================================================
// Mock-Motor -- simuliert die Telefonanlage, damit die Oberflaeche ohne SIP
// entwickelt und getestet werden kann. Erfuellt exakt die Schnittstelle aus
// engine/engine-api.md; der spaetere echte Motor tritt an dieselbe Stelle.
//
// Bewusst mit denselben Eigenheiten wie die echte Anlage (Lehre aus der
// Tray-App): Ereignisse kommen mehrfach und teils verspaetet -- der Motor
// glaettet das, die Oberflaeche bekommt nur saubere Zustaende zu sehen.
// ===========================================================================
(function () {
  const STATUS_RANK = { ringing: 0, calling: 0, active: 1, ended: 2 };

  function createMockEngine() {
    const handlers = {};
    let call = null;          // aktueller Anruf oder null
    let registration = { state: "connecting" };
    const endedIds = [];      // schon beendete Anruf-IDs (gegen Nachzuegler)
    let timer = null;

    const emit = (event, payload) => (handlers[event] || []).forEach((h) => h(payload));

    // Zustandsuebergang mit Glaettung -- Rueckwaertsschritte und Nachzuegler
    // beendeter Anrufe werden verworfen (siehe engine-api.md).
    function apply(next) {
      if (!next) return;
      if (endedIds.includes(next.id) && next.status !== "ended") return;
      if (call && call.id === next.id && STATUS_RANK[next.status] < STATUS_RANK[call.status]) return;
      call = { ...call, ...next };
      if (next.status === "ended") {
        if (!endedIds.includes(next.id)) endedIds.push(next.id);
        if (endedIds.length > 20) endedIds.shift();
        const durationSec = call.startedAt ? Math.round((Date.now() - call.startedAt) / 1000) : 0;
        emit("call", { ...call });
        emit("callEnded", { id: call.id, durationSec, reason: next.reason || "beendet" });
        call = null;
        return;
      }
      emit("call", { ...call });
    }

    // Beispiel-Kunde fuers Dossier (im echten Betrieb liefert das der
    // smartis-Webhook mit -- gleiche Form wie in der heutigen Anruf-Karte).
    const DEMO_DOSSIER = {
      pendenzen: [
        { id: "p1", title: "MWST-Abrechnung Q2 einreichen", due_date: "2026-07-20" },
        { id: "p2", title: "Jahresabschluss besprechen", due_date: "2026-08-15" },
      ],
      docs: [
        { id: "d1", name: "Bilanz 2025.pdf", updated_at: "2026-07-24" },
        { id: "d2", name: "Steuererklaerung 2025.pdf", updated_at: "2026-07-18" },
      ],
    };

    return {
      on(event, handler) {
        (handlers[event] = handlers[event] || []).push(handler);
      },
      getState() {
        return { registration: { ...registration }, call: call ? { ...call } : null };
      },
      connect() {
        registration = { state: "connecting" };
        emit("registration", { ...registration });
        setTimeout(() => {
          registration = { state: "registered", extension: "20" };
          emit("registration", { ...registration });
        }, 900);
      },
      disconnect() {
        registration = { state: "failed", message: "abgemeldet" };
        emit("registration", { ...registration });
      },
      dial(number) {
        if (call) return;
        const id = "mock-out-" + Date.now();
        apply({ id, dir: "out", status: "calling", peerNumber: number, peerName: null, muted: false, onHold: false });
        // Gegenstelle nimmt nach kurzer Zeit ab
        timer = setTimeout(() => apply({ id, status: "active", startedAt: Date.now() }), 2200);
      },
      answer() {
        if (!call || call.status !== "ringing") return;
        apply({ id: call.id, status: "active", startedAt: Date.now() });
      },
      hangup() {
        if (!call) return;
        clearTimeout(timer);
        apply({ id: call.id, status: "ended", reason: call.status === "ringing" ? "abgelehnt" : "beendet" });
      },
      setMuted(v) { if (call) apply({ id: call.id, muted: !!v }); },
      setHold(v) { if (call) apply({ id: call.id, onHold: !!v }); },
      sendDtmf() { /* im Mock ohne Wirkung */ },
      transfer(number) {
        if (!call) return;
        apply({ id: call.id, status: "ended", reason: "verbunden an " + number });
      },

      // ── nur im Mock: Testauslöser für die Oberfläche ────────────────────
      simulateIncoming(opts = {}) {
        if (call) return;
        const id = "mock-in-" + Date.now();
        apply({
          id,
          dir: "in",
          status: "ringing",
          peerNumber: opts.number || "079 287 60 33",
          peerName: opts.name || "Sascha Bigger",
          customer: opts.customer || { company_name: "Artis Treuhand GmbH" },
          dossier: opts.dossier || DEMO_DOSSIER,
          muted: false,
          onHold: false,
        });
        // Nachzuegler wie in echt: dieselbe Meldung nochmals -- darf nichts bewirken
        setTimeout(() => apply({ id, status: "ringing" }), 1200);
      },
    };
  }

  window.createMockEngine = createMockEngine;
})();
