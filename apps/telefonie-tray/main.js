// ===========================================================================
// smartis Telefonie Tray -- schlanke Huelle fuer Anruf-Benachrichtigungen
//
// Grund: ein Browser-Tab kann sich nicht selbst in den Vordergrund holen,
// wenn eine andere App (z.B. Outlook) aktiv ist -- das ist eine bewusste
// Sicherheitssperre aller Browser. Diese kleine Electron-App zeigt bei einem
// eingehenden Anruf eine kleine Karte unten rechts (wie Teams/Slack), OHNE
// die Tastatur-Eingabe in der gerade aktiven App zu unterbrechen.
//
// WICHTIG (2x Fable-Recherche 2026-07-23):
// NICHT das volle Modul-Fenster aufpoppen + Fokus stehlen bei jedem
// Klingeln -- genau das hat 3CX selbst eine Zeit lang gemacht (Electron-
// Client v18) und wieder verworfen (Nutzer nahmen aus Versehen per Enter
// Anrufe an, Tastatur gekapert). Bewaehrter Weg: kleine, NICHT
// fokussierbare Karte per showInactive() + setAlwaysOnTop('screen-saver').
//
// BEWUSST EINFACH GEHALTEN (Sascha-Entscheid 2026-07-24): EIN fixes,
// kleines Kartenfenster -- kein Aufklappen zur vollen smartis-Weboberflaeche
// mehr. Ringing/Angenommen/Beendet aendern nur noch Text+Status auf
// DERSELBEN Karte (per IPC-Push, ohne die Seite neu zu laden -- neu laden
// war die Ursache des fruehen Absturz-Bugs bei ueberlappenden Events). Wer
// das volle Dossier sehen will, klickt "Öffnen" -- das oeffnet smartis im
// normalen Standardbrowser, nicht mehr eingebettet in diesem Fenster.
//
// Architektur bewusst einfach gehalten: KEINE Aenderung am bestehenden
// smartis-Frontend-Code noetig. Dieser Hauptprozess ist selbst ein ganz
// normaler Supabase-Realtime-Client (gleiches Muster wie
// microsip-control-listener.js) und hoert auf denselben "telefonie-calls"
// Broadcast-Kanal, den die Web-App sowieso schon nutzt.
//
// MicroSIP bleibt der Motor fuers eigentliche Gespraech -- diese App ist
// nur die "Aufmerksamkeits"-Schicht drumherum.
//
// ⚠️ Umgebung (Ziel-URL fuer "Öffnen") ist ueber Tray → "Umgebung wechseln…"
// waehlbar (smartis.me Test / Produktiv / eigene URL). ABER: SUPABASE_URL/
// ANON_KEY unten sind fest auf smartis.me's Backend verdrahtet -- fuer
// "Produktiv" (eigenes Backend api-artis.sm-artis.ch) muesste das separat
// umgeschaltet werden, was noch nicht gebaut ist (Produktiv-Zugangsdaten
// bewusst nicht hier hinterlegt, siehe CLAUDE.md "Produktiv... Default:
// nicht anfassen").
// ===========================================================================
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, shell, powerSaveBlocker } = require("electron");
const path = require("path");
const fs = require("fs");
// Electrons gebuendeltes Node hat kein natives globales WebSocket -- @supabase/
// realtime-js braucht eins im globalen Scope, sonst wirft createClient().
if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = require("ws");
}
const { createClient } = require("@supabase/supabase-js");

const MY_PROFILE_ID = "ebac33f8-7fc7-40ca-97ca-2112788265e7"; // Sascha -- pro Mitarbeitendem anpassen
const SUPABASE_URL = "https://uawgpxcihixqxqxxbjak.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhd2dweGNpaGl4cXhxeHhiamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MzE5MzYsImV4cCI6MjA4ODAwNzkzNn0.fPbekBh1dO8byD2wxkjzFSKW4jSV0MHIGgci9nch98A";
const DEFAULT_URL = "https://smartis.me/telefonie";
const ICON_PATH = path.join(__dirname, "icon.ico");
const TOAST_AUTO_HIDE_MS = 25000;
const TOAST_ENDED_HIDE_MS = 3000;
const TOAST_W = 364, TOAST_H = 120;
// Erweiterte Hoehe, wenn das Dossier (Pendenzen/Dokumente, je max 3) mit auf
// der Karte steht -- Sascha-Entscheid 2026-07-26: Kundendaten direkt auf der
// Karte, ohne dass smartis im Browser offen sein muss.
const TOAST_DOSSIER_H = 360;
const MARGIN = 16;

let callWindow = null;
let setupWindow = null;
let toastHideTimer = null;
let tray = null;
let currentUrl = DEFAULT_URL;
let realtimeChannel = null;
let toastLive = false; // true = aktuelles loadFile() ist fertig (did-finish-load war schon) -- siehe showCall()
let currentCallId = null; // call.id der aktuell geladenen/gezeigten Karte -- siehe showCall()
let toastEnded = false; // true = fuer currentCallId schon "ended" verarbeitet -- siehe showCall()
let lastLoadAt = 0; // Zeitstempel des letzten loadFile() -- siehe showCall()
let pendingLoadListener = null; // aktuell haengender once("did-finish-load")-Listener, falls noch keiner gefeuert hat
let pendingStatusUpdate = null; // Status, der eintraf WAEHREND das Fenster noch laedt -- siehe showCall()
let lastUpdateKey = null; // zuletzt per IPC gesendeter Karteninhalt -- Duplikate nicht erneut senden
let currentDossier = null; // Dossier (Pendenzen/Dokumente) des aktuellen Anrufs, vom Webhook mitgeliefert
// ⚠️ call.id, die bereits VOLLSTAENDIG als "ended" verarbeitet wurden -- UEBERLEBT
// hideCallWindow() (anders als currentCallId/toastEnded), siehe showCall() fuer den
// Bug, den das behebt: peoplefone schickt "terminated" oft mehrfach mit
// Verzoegerung (analog zu den Ringing-Wiederholungen), teils noch 10+s NACHDEM
// die Karte laengst wieder ausgeblendet ist. Ohne dieses Gedaechtnis sah so ein
// spaetes Duplikat wie ein "neuer Anruf" aus (currentCallId war ja schon wieder
// null) und die Karte ploppte mehrfach mit "beendet" erneut auf.
const endedCallIds = [];
const MAX_REMEMBERED_ENDED = 20;
function rememberEnded(id) {
  endedCallIds.push(id);
  if (endedCallIds.length > MAX_REMEMBERED_ENDED) endedCallIds.shift();
}
// Anruf-Lebenszyklus ist eine Einbahnstrasse: ringing -> answered -> ended.
// peoplefone liefert Events aber nicht streng geordnet (verspaetete
// "ringing"-Wiederholungen kommen auch noch NACH "answered", siehe
// showCall()) -- Rueckwaertsuebergaenge werden deshalb ignoriert, sonst
// springt die Karte von "Im Gespraech" zurueck auf "Eingehender Anruf"
// samt wieder eingeblendetem Annehmen-Knopf (Review-Befund 2026-07-26).
const STATUS_RANK = { ringing: 0, answered: 1, ended: 2 };
let currentStatusRank = -1; // Rang des zuletzt akzeptierten Status fuer currentCallId
const RELOAD_COOLDOWN_MS = 4000;

// ── Config (userData/config.json) -- gleiches Muster wie apps/electron/main.cjs
function getConfigPath() {
  return path.join(app.getPath("userData"), "config.json");
}
function readConfig() {
  try { return JSON.parse(fs.readFileSync(getConfigPath(), "utf8")); } catch { return {}; }
}
function writeConfig(cfg) {
  fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), "utf8");
}
function getSavedUrl() { return readConfig().url || null; }
function saveUrl(url) { const cfg = readConfig(); cfg.url = url; writeConfig(cfg); }

function openSetupWindow() {
  if (setupWindow) { setupWindow.focus(); return; }
  setupWindow = new BrowserWindow({
    width: 480, height: 460, resizable: false, center: true,
    title: "smartis Telefonie – Einrichtung",
    icon: ICON_PATH,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload-setup.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const query = `?current=${encodeURIComponent(currentUrl)}`;
  setupWindow.loadFile(path.join(__dirname, "setup.html"), { search: query });
  setupWindow.on("closed", () => { setupWindow = null; });
}

// Fixes, rahmenloses Kartenfenster -- startet klein+versteckt+nicht
// fokussierbar, Groesse aendert sich nie (siehe Datei-Kommentar oben).
function createCallWindow() {
  const work = screen.getPrimaryDisplay().workArea;
  callWindow = new BrowserWindow({
    width: TOAST_W,
    height: TOAST_H,
    x: work.x + work.width - TOAST_W - MARGIN,
    y: work.y + work.height - TOAST_H - MARGIN,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    alwaysOnTop: true,
    backgroundColor: "#fcfcfc", // Fluent/Win11-Neutralton, vermeidet Aufblitzen beim Resize
    roundedCorners: true, // DWM rundet das rahmenlose Fenster nativ (Win11 ~8px)
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "preload-toast.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Schliessen beendet die App NICHT, nur verstecken -- typisches
  // Tray-App-Verhalten (das Fenster ist ohnehin rahmenlos, hat also gar
  // keinen sichtbaren Schliessen-Knopf -- reine Absicherung).
  callWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      hideCallWindow();
    }
  });
}

function scheduleAutoHide(ms) {
  if (toastHideTimer) clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(hideCallWindow, ms);
}

// Karte unten rechts verankern -- Hoehe variiert je nachdem, ob ein Dossier
// (Pendenzen/Dokumente) mit anzuzeigen ist.
function positionCallWindow(h) {
  const work = screen.getPrimaryDisplay().workArea;
  callWindow.setBounds({
    x: work.x + work.width - TOAST_W - MARGIN,
    y: work.y + work.height - h - MARGIN,
    width: TOAST_W,
    height: h,
  });
}

function dossierHasContent(d) {
  return !!(d && ((d.pendenzen && d.pendenzen.length) || (d.docs && d.docs.length)));
}

function hideCallWindow() {
  if (toastHideTimer) { clearTimeout(toastHideTimer); toastHideTimer = null; }
  toastLive = false;
  currentCallId = null;
  currentStatusRank = -1;
  toastEnded = false;
  pendingStatusUpdate = null;
  lastUpdateKey = null;
  currentDossier = null;
  if (pendingLoadListener) {
    callWindow?.webContents.removeListener("did-finish-load", pendingLoadListener);
    pendingLoadListener = null;
  }
  if (callWindow && !callWindow.isDestroyed()) callWindow.hide();
}

// Kleine, NICHT fokussierbare, fixe Karte unten rechts -- siehe Datei-
// Kommentar oben fuer die Begruendung (3CX-Lehre + Sascha-Entscheid
// 2026-07-24 gegen die volle Ansicht). showInactive() statt show(),
// 'screen-saver'-Ebene statt Fokus-Stehl-Trick. Deckt ringing/answered/
// ended gleichermassen ab -- nur Text+Status auf der Karte aendern sich.
function showCall(call) {
  // Ausgehende Anrufe meldet der peoplefone-Webhook ebenfalls (dir "out") --
  // selbst gewaehlt, die Karte wuerde faelschlich "Eingehender Anruf" samt
  // Annehmen-Knopf zeigen (Review-Befund 2026-07-26). Keine Karte dafuer.
  if (call.dir === "out") return;

  // ⚠️ BUG gefunden + behoben (2026-07-26): peoplefone schickt "terminated"
  // (ended) oft noch mehrfach verspaetet nach (live beobachtet: ~10s nach
  // Auflegen, danach nochmals ca. 4x) -- teils erst NACHDEM die Karte laengst
  // wieder ausgeblendet ist (hideCallWindow() hat currentCallId dann schon
  // auf null zurueckgesetzt). So ein Duplikat sah dadurch wie ein "neuer
  // Anruf" aus und die Karte ploppte fuer denselben, laengst erledigten
  // Anruf immer wieder mit "beendet" auf. Fix: einmal vollstaendig beendete
  // call.id dauerhaft (ueber das Ausblenden hinaus) merken und alles
  // Weitere dafuer ignorieren.
  if (endedCallIds.includes(call.id)) return;

  const name = call.customer?.company_name || call.peerName || call.peerNumber || "Unbekannt";
  const number = call.peerNumber || "";
  const status = call.status;
  // ⚠️ Bewusst NUR auf currentCallId geprueft, NICHT (mehr) auf toastLive --
  // siehe Bug vom 2026-07-26 unten fuer den Grund.
  const isSameCall = currentCallId !== null && call.id === currentCallId;

  if (isSameCall) {
    // ⚠️ peoplefone schickt bei einem laenger klingelnden Anruf sehr viele
    // Wiederholungs-"ringing"-Events (teils 15x+ fuer denselben Anruf,
    // manchmal auch noch verspaetet NACH dem "ended"). Ohne diese Sperre
    // wuerde so ein spaetes Event den 25s-Timer immer wieder aufziehen und
    // die Karte schliesst nie mehr (genau der Bug vom 2026-07-24-Testlauf).
    // Sobald "ended" einmal verarbeitet ist: weitere Events fuer denselben
    // Anruf ignorieren, die Karte laeuft aus.
    if (toastEnded) return;
    // Rueckwaertsuebergang (z.B. verspaetetes "ringing" nach "answered")
    // ignorieren -- siehe STATUS_RANK oben. Gleicher Rang (ringing-
    // Wiederholung) laeuft weiter durch und verlaengert den Auto-Hide.
    const rank = STATUS_RANK[status] ?? 0;
    if (rank < currentStatusRank) return;
    currentStatusRank = rank;
    if (status === "ended") { toastEnded = true; rememberEnded(call.id); }
    if (call.dossier) currentDossier = call.dossier;

    if (toastLive) {
      // Fenster hat das erste Laden dieses Anrufs bereits abgeschlossen --
      // nur per IPC aktualisieren, NICHT neu laden. Neu laden war die
      // Ursache des fruehen Absturz-Bugs bei ueberlappenden ringing-Events.
      // ⚠️ Identische Updates NICHT erneut senden (2026-07-26): die
      // verwaisten peoplefone-Subscriptions stellen jedes Ereignis zigfach
      // zu -- jedes Duplikat liess die Karte sichtbar "mehrfach
      // aktualisieren" (Sascha-Beobachtung). Inhaltsgleich = ignorieren.
      const key = name + " " + number + " " + status + " " + dossierHasContent(currentDossier);
      if (key !== lastUpdateKey) {
        lastUpdateKey = key;
        if (dossierHasContent(currentDossier) && callWindow.getBounds().height < TOAST_DOSSIER_H) {
          positionCallWindow(TOAST_DOSSIER_H); // Dossier kam nachtraeglich -- Karte vergroessern
        }
        callWindow.webContents.send("call-update", { name, number, status, dossier: currentDossier });
      }
    } else {
      // ⚠️ BUG gefunden + behoben (2026-07-26): das erste loadFile() fuer
      // diesen Anruf laeuft noch (did-finish-load ist noch nicht gefeuert).
      // Fruehe hing der sameCall-Check zusaetzlich an toastLive -- kam eine
      // Wiederholung schneller als toast.html laden konnte (live beobachtet:
      // 6 Ringing-Events, Fenster kam nie sichtbar zum Zug), wertete der Code
      // sie faelschlich als "toastLive noch false -> also KEIN sameCall" und
      // rief loadFile() erneut auf -- das bricht die laufende Ladung ab, ohne
      // dass "did-finish-load" je feuert. Bei mehreren schnellen Wiederholungen
      // kaskadiert das (mehrere haengende once-Listener, MaxListenersExceeded-
      // Warning) und die Karte wird oft erst sichtbar, wenn der Anruf schon
      // vorbei ist. Fix: waehrend des Ladens NICHT neu laden, nur den
      // neuesten Status merken -- der did-finish-load-Handler unten wendet
      // ihn nach, sobald das Laden tatsaechlich fertig ist.
      pendingStatusUpdate = { name, number, status };
    }
    scheduleAutoHide(status === "ended" ? TOAST_ENDED_HIDE_MS : TOAST_AUTO_HIDE_MS);
    return;
  }

  // Echt neuer Anruf (andere call.id, oder Karte war nicht sichtbar).
  //
  // ⚠️ BUG gefunden + behoben (2026-07-26): die Bremse griff bisher IMMER,
  // wenn das Fenster kuerzlich geladen wurde -- auch wenn call.id sich
  // unterscheidet, also wirklich ein ANDERER Anruf klingelt (z.B. Anruf 1
  // beendet, Sekunden spaeter klingelt Anruf 2). Die Karte blieb dann auf
  // "Anruf beendet" von Anruf 1 haengen (25s-Timer wurde nochmal aufgezogen)
  // statt Anruf 2 zu zeigen -- live beobachtet: "beendet" erschien doppelt.
  // Die Bremse darf nur greifen, wenn wir NICHT sicher wissen, dass es ein
  // anderer Anruf ist (kein currentCallId bekannt, z.B. beim allerersten
  // Laden). Sobald wir eine andere, bekannte call.id sehen, IMMER neu laden.
  const now = Date.now();
  const knownDifferentCall = currentCallId !== null && call.id !== currentCallId;
  if (!knownDifferentCall && callWindow.isVisible() && (now - lastLoadAt) < RELOAD_COOLDOWN_MS) {
    scheduleAutoHide(TOAST_AUTO_HIDE_MS);
    return;
  }
  lastLoadAt = now;
  currentCallId = call.id;
  currentStatusRank = STATUS_RANK[status] ?? 0;
  toastEnded = status === "ended";
  if (toastEnded) rememberEnded(call.id); // sehr kurzer Anruf, kommt gleich schon als "ended" an
  toastLive = false;
  pendingStatusUpdate = null;
  currentDossier = call.dossier || null;
  lastUpdateKey = name + " " + number + " " + status + " " + dossierHasContent(currentDossier);

  // Haengenden Listener einer ABGEBROCHENEN vorherigen Ladung entfernen
  // (siehe Kommentar oben) -- sonst haeufen sich die once()-Listener bei
  // mehreren schnellen "echt neuer Anruf"-Wechseln an (MaxListenersExceeded).
  if (pendingLoadListener) {
    callWindow.webContents.removeListener("did-finish-load", pendingLoadListener);
  }
  // Listener VOR loadFile() registrieren (Race-Condition bei kleinen
  // Seiten), UND "did-finish-load" statt "ready-to-show" ("ready-to-show"
  // feuert nur EINMAL im Fenster-Leben, bei Wiederverwendung nie wieder).
  const initialUpdate = { name, number, status };
  pendingLoadListener = () => {
    pendingLoadListener = null;
    if (!callWindow || callWindow.isDestroyed()) return;
    toastLive = true;
    // Groesse VOR dem Anzeigen setzen -- mit Dossier ist die Karte hoeher.
    positionCallWindow(dossierHasContent(currentDossier) ? TOAST_DOSSIER_H : TOAST_H);
    callWindow.showInactive(); // KEIN show()/focus() -- Tastatur bleibt bei der aktiven App
    callWindow.setAlwaysOnTop(true, "screen-saver");
    callWindow.moveTop();
    // Vollstaendigen Stand nachreichen: evtl. waehrend des Ladens
    // eingetroffener neuerer Status (pendingStatusUpdate) + das Dossier
    // (zu gross fuer die URL-Parameter, geht nur per IPC).
    const upd = pendingStatusUpdate || initialUpdate;
    pendingStatusUpdate = null;
    callWindow.webContents.send("call-update", { ...upd, dossier: currentDossier });
  };
  callWindow.webContents.once("did-finish-load", pendingLoadListener);
  callWindow.loadFile(path.join(__dirname, "toast.html"), {
    search: `name=${encodeURIComponent(name)}&number=${encodeURIComponent(number)}&status=${encodeURIComponent(status)}`,
  });

  scheduleAutoHide(status === "ended" ? TOAST_ENDED_HIDE_MS : TOAST_AUTO_HIDE_MS);
}

// "Öffnen" (Tray-Menu, Karten-Button, Doppelklick) -- zeigt das volle
// smartis-Dossier NICHT mehr in diesem Fenster, sondern im normalen
// Standardbrowser (Sascha-Entscheid 2026-07-24: die Karte muss nicht
// "alles sehen", nur zuverlaessig auf sich aufmerksam machen).
function openInBrowser() {
  shell.openExternal(currentUrl);
}

function createTray() {
  if (tray) { tray.destroy(); tray = null; }
  tray = new Tray(nativeImage.createFromPath(ICON_PATH));
  tray.setToolTip("smartis Telefonie");
  const menu = Menu.buildFromTemplate([
    { label: "Öffnen", click: openInBrowser },
    { type: "separator" },
    { label: "Umgebung wechseln…", click: openSetupWindow },
    { type: "separator" },
    { label: "Beenden", click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on("double-click", openInBrowser);
}

function connectRealtime() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const ch = supabase.channel("telefonie-calls", { config: { broadcast: { self: true } } });
  ch.on("broadcast", { event: "incoming_call" }, ({ payload }) => {
    if (!payload) return;
    if (payload.targetUserId && payload.targetUserId !== MY_PROFILE_ID) return;
    const call = payload.call || {};
    if (!call.status) return;
    if (call.status === "ringing") console.log("Eingehender Anruf:", call.peerNumber);
    showCall(call);
  }).subscribe((status) => {
    console.log("smartis Telefonie Tray: Realtime", status);
  });
  realtimeChannel = ch;
}

app.setName("SmartisTelefonieTray");

// Doppelstart-Schutz: seit dem Autostart-Fix (Run-Key, 2026-07-26) startet
// die App beim Login automatisch -- ein zusaetzlicher manueller Start (npm
// start) wuerde sonst eine ZWEITE Instanz mit eigener Realtime-Verbindung
// erzeugen und jede Karte doppelt zeigen. Zweite Instanz beendet sich sofort.
if (!app.requestSingleInstanceLock()) {
  console.log("smartis Telefonie Tray laeuft bereits -- diese Instanz beendet sich.");
  app.quit();
}

// Absturz-Sicherung: ein Fehler in einem Broadcast-Handler o.ae. soll die
// ganze App nie mehr lautlos beenden (siehe Vorfall 2026-07-23: Absturz nach
// mehreren schnellen "ringing"-Events, kein Fehler im Log ersichtlich).
process.on("uncaughtException", (err) => {
  console.error("uncaughtException (App laeuft weiter):", err);
});
// uncaughtException faengt KEINE verworfenen Promises -- separates Node-
// Event noetig, sonst beendet ein einzelnes ungefangenes Promise-Reject
// (z.B. ein abgebrochenes loadFile() bei ueberlappenden Events) den ganzen
// Prozess lautlos (Vorfall 2026-07-24: Exit-Code 4, kein Fehler im Log).
process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection (App laeuft weiter):", err);
});
app.on("render-process-gone", (_e, _wc, details) => {
  console.error("render-process-gone:", JSON.stringify(details));
});

app.whenReady().then(() => {
  // ⚠️ BUG gefunden + behoben (2026-07-26): ohne explizites path/args traegt
  // Electron bei einer UNVERPACKTEN App (npm start) nur electron.exe OHNE den
  // App-Pfad in den Registry-Run-Key ein -- beim naechsten Login startete
  // dann bloss das leere Electron-Standardfenster statt dieser App (genau so
  // nach Saschas Reboot am 2026-07-26 beobachtet: kein Tray, keine Karte,
  // bis manuell nachgestartet wurde). Der App-Ordner MUSS als Argument mit
  // (in Anfuehrungszeichen -- der OneDrive-Pfad enthaelt Leerzeichen).
  // Pfad UND Argument selbst quoten -- Electron schreibt beides woertlich in
  // den Run-Key, und beide Pfade enthalten Leerzeichen (OneDrive-Ordner).
  app.setLoginItemSettings({
    openAtLogin: true,
    path: `"${process.execPath}"`,
    args: [`"${__dirname}"`],
  });

  // ⚠️ Windows drosselt Netzwerk/Timer von Hintergrund-Apps ohne Fokus
  // (die Karte ist ja absichtlich meistens unsichtbar) -- das war die
  // Ursache der wiederholten Realtime-CHANNEL_ERROR-Aussetzer (2026-07-24,
  // per Vergleichstest bestaetigt: identischer Kanal blieb aus einem reinen
  // Node-Prozess ohne Fenster die ganze Zeit stabil verbunden). Blocker
  // haelt den Prozess aktiv, ohne den Bildschirm wachzuhalten.
  powerSaveBlocker.start("prevent-app-suspension");

  ipcMain.handle("telefonie-tray:save-url", (_e, url) => {
    currentUrl = url;
    saveUrl(url);
    if (setupWindow) { setupWindow.close(); setupWindow = null; }
    openInBrowser();
  });

  ipcMain.handle("telefonie-tray:toast-open", openInBrowser);
  ipcMain.handle("telefonie-tray:toast-dismiss", hideCallWindow);
  // "Annehmen" auf der Karte -- derselbe Broadcast-Weg wie smartis' eigene
  // Anruf-Steuerung (siehe microsip-control-listener.js), damit MicroSIP den
  // Anruf wirklich annimmt, ohne dass Sascha extra ins MicroSIP-Fenster
  // klicken muss.
  ipcMain.handle("telefonie-tray:toast-answer", () => {
    if (!realtimeChannel) return;
    realtimeChannel.send({
      type: "broadcast",
      event: "control_command",
      payload: { targetUserId: MY_PROFILE_ID, action: "answer" },
    });
  });
  // Roter Auflegen-Knopf auf der Karte (Sascha 2026-07-26: das X wurde als
  // Auflegen missverstanden -- X schliesst weiterhin nur die Karte, Auflegen
  // ist jetzt ein eigener, unmissverstaendlich roter Knopf im Gespraech).
  ipcMain.handle("telefonie-tray:toast-hangup", () => {
    if (!realtimeChannel) return;
    realtimeChannel.send({
      type: "broadcast",
      event: "control_command",
      payload: { targetUserId: MY_PROFILE_ID, action: "hangup" },
    });
  });

  currentUrl = getSavedUrl() || DEFAULT_URL;
  createCallWindow();
  createTray();
  connectRealtime();
});

// Tray-App: soll weiterlaufen, auch wenn das Fenster (versteckt statt
// geschlossen, siehe oben) "zu" ist -- kein app.quit() hier.
app.on("window-all-closed", () => {});
