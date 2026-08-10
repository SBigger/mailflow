// ===========================================================================
// Bedienung der eigenen Sprachverbindung (Erprobungsphase).
//
// Bewusst NEBEN dem bisherigen Motor statt an seiner Stelle: solange der
// SIP-Weg nicht im Alltag bewiesen ist, darf er niemandem das Telefon
// abstellen. Erst wenn er traegt, wandert er in die Hauptoberflaeche und
// MicroSIP faellt weg.
// ===========================================================================
(function () {
  if (!window.phoneAPI?.sip || !window.createSipEngine) return;

  const $ = (id) => document.getElementById(id);
  const status = (t) => { const e = $("sipStatus"); if (e) e.textContent = t; };
  let motor = null;

  async function ladeFelder() {
    const cfg = await window.phoneAPI.sip.laden();
    $("sipUser").value = cfg.sipUser || "";
    $("sipPassword").value = cfg.sipPassword || "";
    $("sipWss").value = cfg.wsServer || window.SIP_STANDARD.wss;
    $("sipDomain").value = cfg.domain || window.SIP_STANDARD.domain;
    if (cfg.sipUser) status("Zugangsdaten hinterlegt — noch nicht verbunden.");
  }

  const felder = () => ({
    sipUser: $("sipUser").value.trim(),
    sipPassword: $("sipPassword").value,
    wsServer: $("sipWss").value.trim(),
    domain: $("sipDomain").value.trim(),
  });

  $("btnSipSpeichern").addEventListener("click", async () => {
    const r = await window.phoneAPI.sip.speichern(felder());
    status(r?.ok ? "Gespeichert." : "Nicht gespeichert: " + (r?.fehler || "unbekannter Fehler"));
  });

  $("btnSipVerbinden").addEventListener("click", () => {
    const cfg = felder();
    if (!cfg.sipUser || !cfg.sipPassword) { status("Benutzername und Passwort fehlen."); return; }
    if (motor) { try { motor.disconnect(); } catch { /* egal */ } }

    motor = window.createSipEngine({
      ...cfg,
      log: (...a) => console.log("[SIP]", ...a),
    });

    motor.on("registration", (r) => {
      if (r.state === "registered") status("Verbunden und registriert — die Anlage kennt uns.");
      else if (r.state === "connecting") status("Verbinde…");
      else status("Nicht verbunden" + (r.message ? ": " + r.message : "."));
    });
    motor.on("call", (c) => {
      if (!c) return;
      const wer = c.peerName || c.peerNumber || "Unbekannt";
      if (c.status === "ringing") status("Es klingelt: " + wer + " — Annehmen über die Anrufkarte.");
      else if (c.status === "calling") status("Rufe " + wer + " …");
      else if (c.status === "active") status("Im Gespräch mit " + wer + ".");
      else if (c.status === "ended") status("Gespräch beendet.");
    });
    motor.on("callEnded", (e) => status("Beendet nach " + (e?.durationSec ?? 0) + " s."));

    // Fuer den Test von Hand erreichbar machen -- die Hauptoberflaeche haengt
    // bewusst noch am alten Motor.
    window.sipMotor = motor;
    motor.connect();
  });

  $("btnSipTrennen").addEventListener("click", () => {
    if (motor) { try { motor.disconnect(); } catch { /* egal */ } motor = null; window.sipMotor = null; }
    status("Getrennt.");
  });

  ladeFelder().catch(() => { /* erster Start ohne Datei -- normal */ });
})();
