// ===========================================================================
// smartis Telefon -- Oberflaechen-Logik.
//
// Kennt NUR die Motor-Schnittstelle (engine/engine-api.md), nie einen SIP-
// Stack. Heute laeuft der Mock-Motor; wird er spaeter durch den echten
// ersetzt, aendert sich in dieser Datei nichts.
// ===========================================================================
const $ = (id) => document.getElementById(id);

// Echter Motor, wenn die App in Electron laeuft (Realtime + signierte Befehle
// im Hauptprozess); sonst der Mock -- so bleibt die Oberflaeche auch ohne
// Telefonanlage entwickelbar. Beide erfuellen engine/engine-api.md.
const echterMotor = !!window.phoneAPI?.engine;
const engine = echterMotor ? window.phoneAPI.engine : window.createMockEngine();

// ── Ansichten umschalten ─────────────────────────────────────────────────
document.querySelectorAll(".rail-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".rail-btn").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + btn.dataset.view));
  });
});
const showOverlay = (which) => {
  $("overlay-incoming").classList.toggle("active", which === "incoming");
  $("overlay-active").classList.toggle("active", which === "active");
};

// ── Tastenfeld ───────────────────────────────────────────────────────────
const KEYS = [["1", ""], ["2", "ABC"], ["3", "DEF"], ["4", "GHI"], ["5", "JKL"], ["6", "MNO"],
              ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"], ["*", ""], ["0", "+"], ["#", ""]];
function buildKeypad(el, onKey) {
  KEYS.forEach(([d, letters]) => {
    const b = document.createElement("button");
    b.className = "key";
    const big = document.createElement("b"); big.textContent = d;
    const small = document.createElement("i"); small.textContent = letters;
    b.append(big, small);
    b.addEventListener("click", () => onKey(d));
    el.appendChild(b);
  });
}
buildKeypad($("keypad"), (d) => { $("dialInput").value += d; });
buildKeypad($("keypad2"), (d) => engine.sendDtmf(d));

// Ausgehend waehlen -- in dieser Reihenfolge:
//   1. eigener SIP-Motor, wenn er registriert ist (seit 10.08.2026)
//   2. tel:-Link an Windows, also der alte Weg ueber MicroSIP
//   3. Mock-Motor (Entwicklung im Browser)
//
// Punkt 2 ist bewusst nur noch Rueckfall: ist MicroSIP nicht mehr als
// tel:-Programm eingetragen, fragt Windows den Benutzer, welche App den Link
// oeffnen soll -- ein Dialog, der mit Telefonieren nichts zu tun hat.
function waehle(nr) {
  const sauber = String(nr || "").trim();
  if (!sauber) return;

  const sip = window.sipMotor;
  if (sip && sip.getState()?.registration?.state === "registered") {
    sip.dial(sauber);
    return;
  }
  if (echterMotor) {
    window.phoneAPI.dial(sauber).then((r) => {
      if (r?.ok) return;
      hinweis(
        "Wählen geht noch nicht: die eigene Sprachverbindung ist nicht verbunden, "
        + "und Windows kennt kein Telefonprogramm für Rufnummern. "
        + "Einstellungen → Eigene Sprachverbindung.",
      );
    }).catch(() => {});
    return;
  }
  engine.dial(sauber);
}

// Kurze Rueckmeldung im Fenster statt eines stummen Fehlschlags oder eines
// Windows-Dialogs, den niemand erwartet.
function hinweis(text) {
  let box = document.getElementById("hinweis");
  if (!box) {
    box = document.createElement("div");
    box.id = "hinweis";
    box.className = "hinweis";
    document.body.appendChild(box);
  }
  box.textContent = text;
  box.classList.add("sichtbar");
  clearTimeout(hinweis._uhr);
  hinweis._uhr = setTimeout(() => box.classList.remove("sichtbar"), 7000);
}

$("btnCall").addEventListener("click", () => waehle($("dialInput").value));
$("dialInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("btnCall").click();
});

// ── Anruf-Knoepfe ────────────────────────────────────────────────────────
$("btnAnswer").addEventListener("click", () => engine.answer());
$("btnDecline").addEventListener("click", () => engine.hangup());
$("btnHangup").addEventListener("click", () => engine.hangup());
$("ctrlMute").addEventListener("click", () => engine.setMuted(!current?.muted));
$("ctrlHold").addEventListener("click", () => engine.setHold(!current?.onHold));
const togglePanel = (panelId, ctrlId) => {
  const open = !$(panelId).classList.contains("active");
  ["panelKeypad", "panelTransfer"].forEach((p) => $(p).classList.remove("active"));
  ["ctrlKeypad", "ctrlTransfer"].forEach((c) => $(c).classList.remove("on"));
  if (open) { $(panelId).classList.add("active"); $(ctrlId).classList.add("on"); }
};
$("ctrlKeypad").addEventListener("click", () => togglePanel("panelKeypad", "ctrlKeypad"));
$("ctrlTransfer").addEventListener("click", () => togglePanel("panelTransfer", "ctrlTransfer"));
$("ctrlDossier").addEventListener("click", () => {
  const d = $("acDossier");
  d.classList.toggle("active");
  $("ctrlDossier").classList.toggle("on", d.classList.contains("active"));
});
$("ctrlNote").addEventListener("click", () => { /* Notiz-Panel folgt mit der smartis-Anbindung */ });
$("btnTransferNum").addEventListener("click", () => {
  const nr = $("transferNum").value.trim();
  if (nr) engine.transfer(nr);
});

// ── Dossier zeichnen (gleiche Form wie die heutige Anruf-Karte) ──────────
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0") + ".";
}
function renderDossier(box, dossier) {
  box.textContent = "";
  const has = dossier && ((dossier.pendenzen || []).length || (dossier.docs || []).length);
  box.classList.toggle("active", !!has);
  if (!has) return;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const sections = [
    { label: "Pendenzen", rows: (dossier.pendenzen || []).map((p) => ({
        txt: p.title || "Aufgabe", meta: fmtDate(p.due_date),
        overdue: p.due_date ? new Date(p.due_date) <= today : false })), empty: "Keine offenen Pendenzen" },
    { label: "Letzte Dokumente", rows: (dossier.docs || []).map((d) => ({
        txt: d.name || d.filename || "Dokument", meta: fmtDate(d.updated_at), docId: d.id })), empty: "Keine Dokumente" },
  ];
  sections.forEach((sec) => {
    const wrap = document.createElement("div");
    const label = document.createElement("div");
    label.className = "dsec-label"; label.textContent = sec.label;
    wrap.appendChild(label);
    if (!sec.rows.length) {
      const e = document.createElement("div"); e.className = "dempty"; e.textContent = sec.empty; wrap.appendChild(e);
    }
    sec.rows.forEach((r) => {
      const row = document.createElement("div");
      row.className = "drow" + (r.docId ? " clickable" : "");
      const t = document.createElement("span"); t.className = "txt"; t.textContent = r.txt;
      const m = document.createElement("span"); m.className = "meta" + (r.overdue ? " overdue" : ""); m.textContent = r.meta;
      row.append(t, m);
      if (r.docId && window.phoneAPI?.openDoc) row.addEventListener("click", () => window.phoneAPI.openDoc(r.docId));
      wrap.appendChild(row);
    });
    box.appendChild(wrap);
  });
}

// ── Motor-Ereignisse ─────────────────────────────────────────────────────
let current = null;
let timerHandle = null;

function initials(name) {
  const p = String(name || "?").trim().split(/\s+/);
  return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase() || "?";
}
function tickTimer() {
  if (!current?.startedAt) { $("activeTimer").textContent = "00:00"; return; }
  const s = Math.max(0, Math.round((Date.now() - current.startedAt) / 1000));
  $("activeTimer").textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

let meineNebenstelle = null;

engine.on("registration", (reg) => {
  const dot = $("regDot"), me = $("mePresence");
  const map = { registered: [var_online(), "Bereit"], connecting: [var_away(), "verbinde…"], failed: [var_off(), "nicht verbunden"] };
  const [color, text] = map[reg.state] || map.failed;
  const nst = reg.extension || meineNebenstelle;
  dot.style.background = color; me.style.background = color;
  $("regText").textContent = text + (nst ? " · Nebenstelle " + nst : "") + (reg.message ? " (" + reg.message + ")" : "");
  $("accountInfo").textContent = reg.state === "registered"
    ? "Mit smartis verbunden" + (nst ? " · Nebenstelle " + nst : "") +
      (echterMotor ? " — Sprache läuft über MicroSIP im Hintergrund." : "")
    : (echterMotor ? "Nicht verbunden — Anrufe kommen gerade nicht an." : "Simulierter Betrieb (Mock-Motor).");
});
function var_online() { return getComputedStyle(document.documentElement).getPropertyValue("--online").trim(); }
function var_away() { return getComputedStyle(document.documentElement).getPropertyValue("--away").trim(); }
function var_off() { return getComputedStyle(document.documentElement).getPropertyValue("--offline").trim(); }

engine.on("call", (call) => {
  current = call;
  const label = call.customer?.company_name || call.peerName || call.peerNumber || "Unbekannt";

  if (call.status === "ringing") {
    $("inAvatar").textContent = initials(label);
    $("inName").textContent = label;
    $("inNumber").textContent = call.peerNumber || "";
    renderDossier($("inDossier"), call.dossier);
    showOverlay("incoming");
    return;
  }

  // aktiv oder ausgehend klingelnd
  $("acAvatar").textContent = initials(label);
  $("acName").textContent = label;
  $("acNumber").textContent = call.peerNumber || "";
  $("activeState").textContent = call.status === "calling" ? "Wird angerufen…" : (call.onHold ? "Gehalten" : "Im Gespräch");
  $("ctrlMute").classList.toggle("on", !!call.muted);
  $("ctrlHold").classList.toggle("on", !!call.onHold);
  renderDossier($("acDossier"), call.dossier);
  showOverlay("active");
  clearInterval(timerHandle);
  timerHandle = setInterval(tickTimer, 500);
  tickTimer();
});

engine.on("callEnded", (info) => {
  current = null;
  clearInterval(timerHandle);
  showOverlay(null);
  ["panelKeypad", "panelTransfer"].forEach((p) => $(p).classList.remove("active"));
  ["ctrlKeypad", "ctrlTransfer", "ctrlDossier"].forEach((c) => $(c).classList.remove("on"));
  $("dialInput").value = "";
  addCallToList(info);
});

// ── Anrufliste (heute lokal; spaeter aus smartis call_records) ───────────
const callLog = [];
function addCallToList(info) {
  callLog.unshift({ ...info, at: Date.now(), name: $("acName").textContent, number: $("acNumber").textContent });
  renderCallList();
}
function renderCallList() {
  const box = $("callList");
  box.textContent = "";
  if (!callLog.length) {
    const e = document.createElement("div"); e.className = "muted"; e.textContent = "Noch keine Anrufe.";
    box.appendChild(e); return;
  }
  callLog.slice(0, 40).forEach((c) => {
    const row = document.createElement("div"); row.className = "row-item";
    const av = document.createElement("span"); av.className = "avatar"; av.textContent = initials(c.name);
    const txt = document.createElement("div"); txt.className = "txt";
    const t1 = document.createElement("div"); t1.className = "t1"; t1.textContent = c.name || c.number || "Unbekannt";
    const t2 = document.createElement("div"); t2.className = "t2";
    t2.textContent = (c.reason || "beendet") + " · " + Math.floor((c.durationSec || 0) / 60) + ":" + String((c.durationSec || 0) % 60).padStart(2, "0");
    txt.append(t1, t2);
    const meta = document.createElement("span"); meta.className = "meta";
    meta.textContent = new Date(c.at).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
    row.append(av, txt, meta);
    row.addEventListener("click", () => { if (c.number) { $("dialInput").value = c.number; document.querySelector('.rail-btn[data-view="dial"]').click(); } });
    box.appendChild(row);
  });
}
renderCallList();

// ── Kollegen / Verbinden-Ziele ───────────────────────────────────────────
// Kommen aus der Konfiguration (dieselbe Datei wie bei der Anruf-Karte).
// ⚠️ Nur echte, in der Telefonanlage vorhandene Nebenstellen eintragen: ein
// Transfer ins Leere kommt ueber die Rufgruppe zurueck und wirkt wie ein
// doppelter Anruf (live erlebt am 2026-07-26).
let contacts = [];
function renderContacts(filter = "") {
  const box = $("contactList"); box.textContent = "";
  if (!contacts.length) {
    const e = document.createElement("div"); e.className = "muted";
    e.textContent = "Keine Nebenstellen hinterlegt — in der Konfiguration unter \"targets\" eintragen (echte Nebenstellen aus der Telefonanlage).";
    box.appendChild(e); return;
  }
  contacts.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase())).forEach((c) => {
    const row = document.createElement("div"); row.className = "row-item";
    const av = document.createElement("span"); av.className = "avatar"; av.textContent = initials(c.name);
    const txt = document.createElement("div"); txt.className = "txt";
    const t1 = document.createElement("div"); t1.className = "t1"; t1.textContent = c.name;
    const t2 = document.createElement("div"); t2.className = "t2"; t2.textContent = "Nebenstelle " + c.extension;
    txt.append(t1, t2);
    row.append(av, txt);
    row.addEventListener("click", () => {
      waehle(c.extension);
    });
    box.appendChild(row);
  });
}
$("contactSearch").addEventListener("input", (e) => renderContacts(e.target.value));
renderContacts();

function renderTransferList() {
  const box = $("transferList"); box.textContent = "";
  if (!contacts.length) {
    const e = document.createElement("div"); e.className = "dempty";
    e.textContent = "Keine Nebenstellen hinterlegt — Nummer unten eingeben.";
    box.appendChild(e);
  }
  contacts.forEach((c) => {
    const row = document.createElement("div"); row.className = "row-item";
    const av = document.createElement("span"); av.className = "avatar"; av.textContent = initials(c.name);
    const txt = document.createElement("div"); txt.className = "txt";
    const t1 = document.createElement("div"); t1.className = "t1"; t1.textContent = c.name;
    txt.appendChild(t1);
    const meta = document.createElement("span"); meta.className = "meta"; meta.textContent = c.extension;
    row.append(av, txt, meta);
    row.addEventListener("click", () => engine.transfer(c.extension));
    box.appendChild(row);
  });
}
renderTransferList();

// ── Audio-Geraete (Auswahl wird mit dem echten Motor wirksam) ────────────
async function loadAudioDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const fill = (sel, kind) => {
      sel.textContent = "";
      devices.filter((d) => d.kind === kind).forEach((d) => {
        const o = document.createElement("option");
        o.value = d.deviceId;
        o.textContent = d.label || (kind === "audioinput" ? "Mikrofon" : "Lautsprecher");
        sel.appendChild(o);
      });
      if (!sel.children.length) {
        const o = document.createElement("option");
        o.textContent = "Standardgerät";
        sel.appendChild(o);
      }
    };
    fill($("devMic"), "audioinput");
    fill($("devSpeaker"), "audiooutput");
    fill($("devRing"), "audiooutput");
  } catch { /* ohne Mikrofon-Freigabe bleiben die Namen leer -- unkritisch */ }
}
loadAudioDevices();

// ── Testauslöser (nur im simulierten Betrieb sinnvoll) ───────────────────
if (echterMotor) {
  // Mit echtem Motor kommen Anrufe von der Telefonanlage -- der Testknopf
  // wuerde nur einen Anruf vortaeuschen, den es nicht gibt.
  document.querySelectorAll("#view-settings .card").forEach((c) => {
    if (c.querySelector("#btnSimIn")) c.remove();
  });
} else {
  $("btnSimIn").addEventListener("click", () => engine.simulateIncoming());
  $("btnSimUnknown").addEventListener("click", () => engine.simulateIncoming({
    name: null, number: "+41 44 123 45 67", customer: null, dossier: null,
  }));
}

// ── Start ────────────────────────────────────────────────────────────────
if (!echterMotor) engine.connect(); // echter Motor verbindet aus dem Hauptprozess

if (window.phoneAPI?.getProfile) {
  window.phoneAPI.getProfile().then((p) => {
    if (p?.fullName) $("meAvatar").textContent = initials(p.fullName);
    if (p?.extension) meineNebenstelle = p.extension;
    if (Array.isArray(p?.targets) && p.targets.length) {
      contacts = p.targets;
      renderContacts();
      renderTransferList();
    }
    if (p && p.hatGeheimnis === false) {
      $("accountInfo").textContent =
        "Kein Fernsteuer-Geheimnis hinterlegt — Annehmen, Verbinden und Auflegen bleiben wirkungslos.";
    }
  }).catch(() => {});
}

// ── Anmeldung ────────────────────────────────────────────────────────────
// Ohne Anmeldung kein privater Kanal: der Anruf-Kanal war bisher oeffentlich,
// jeder mit dem anon-Schluessel konnte mithoeren (Befund OFF-01). Erst mit
// einem Benutzer-Token greifen die Policies auf das eigene Thema.
//
// Im Browser (Mock-Motor) gibt es keine Anmeldung -- dort bleibt die Maske aus,
// damit die Oberflaeche weiter ohne Telefonanlage entwickelbar ist.
if (window.phoneAPI?.auth) {
  const maske = $("anmeldung");
  const fehler = $("anmeldeFehler");

  const zeigeMaske = (an) => { maske.hidden = !an; };

  const uebernehmen = (s) => {
    zeigeMaske(!s?.angemeldet);
    if (s?.angemeldet) {
      if (s.name) $("meAvatar").textContent =
        s.name.split(/\s+/).map((t) => t[0]).slice(0, 2).join("").toUpperCase();
      // Ohne Zuordnung zur Telefonanlage kommen keine Anrufe an -- das darf
      // die App nicht verschweigen, sonst sucht man den Fehler beim Telefon.
      if (!s.zugeordnet) {
        $("accountInfo").textContent =
          "Angemeldet, aber noch keinem peoplefone-Anschluss zugeordnet — es kommen keine Anrufe an. "
          + "Ein Administrator macht das in den smartis-Einstellungen unter Telefonie.";
      }
    }
  };

  const anmelden = async () => {
    fehler.hidden = true;
    const btn = $("btnAnmelden");
    btn.disabled = true; btn.textContent = "Anmelden…";
    try {
      const r = await window.phoneAPI.auth.anmelden($("anmeldeEmail").value, $("anmeldePasswort").value);
      if (!r?.ok) {
        fehler.textContent = r?.fehler || "Anmeldung fehlgeschlagen.";
        fehler.hidden = false;
      } else {
        $("anmeldePasswort").value = "";
        uebernehmen(await window.phoneAPI.auth.status());
      }
    } finally {
      btn.disabled = false; btn.textContent = "Anmelden";
    }
  };

  $("btnAnmelden").addEventListener("click", anmelden);
  $("anmeldePasswort").addEventListener("keydown", (e) => { if (e.key === "Enter") anmelden(); });

  window.phoneAPI.auth.beiAenderung(uebernehmen);
  window.phoneAPI.auth.status().then(uebernehmen).catch(() => zeigeMaske(true));
}
