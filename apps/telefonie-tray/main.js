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
const MARGIN = 16;

let callWindow = null;
let setupWindow = null;
let toastHideTimer = null;
let tray = null;
let currentUrl = DEFAULT_URL;
let realtimeChannel = null;
let toastLive = false; // true = Karte zeigt bereits einen Anruf -- Updates gehen per IPC statt Neuladen
let currentCallId = null; // call.id der aktuell gezeigten Karte -- siehe showCall()
let toastEnded = false; // true = fuer currentCallId schon "ended" verarbeitet -- siehe showCall()
let lastLoadAt = 0; // Zeitstempel des letzten loadFile() -- siehe showCall()
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

function hideCallWindow() {
  if (toastHideTimer) { clearTimeout(toastHideTimer); toastHideTimer = null; }
  toastLive = false;
  currentCallId = null;
  toastEnded = false;
  if (callWindow && !callWindow.isDestroyed()) callWindow.hide();
}

// Kleine, NICHT fokussierbare, fixe Karte unten rechts -- siehe Datei-
// Kommentar oben fuer die Begruendung (3CX-Lehre + Sascha-Entscheid
// 2026-07-24 gegen die volle Ansicht). showInactive() statt show(),
// 'screen-saver'-Ebene statt Fokus-Stehl-Trick. Deckt ringing/answered/
// ended gleichermassen ab -- nur Text+Status auf der Karte aendern sich.
function showCall(call) {
  const name = call.customer?.company_name || call.peerName || call.peerNumber || "Unbekannt";
  const number = call.peerNumber || "";
  const status = call.status;
  const sameCall = toastLive && call.id === currentCallId;

  if (sameCall) {
    // ⚠️ peoplefone schickt bei einem laenger klingelnden Anruf sehr viele
    // Wiederholungs-"ringing"-Events (teils 15x+ fuer denselben Anruf,
    // manchmal auch noch verspaetet NACH dem "ended"). Ohne diese Sperre
    // wuerde so ein spaetes Event den 25s-Timer immer wieder aufziehen und
    // die Karte schliesst nie mehr (genau der Bug vom 2026-07-24-Testlauf).
    // Sobald "ended" einmal verarbeitet ist: weitere Events fuer denselben
    // Anruf ignorieren, die Karte laeuft aus.
    if (toastEnded) return;
    if (status === "ended") toastEnded = true;
    // Karte zeigt bereits einen Anruf (z.B. ringing -> answered) -- nur per
    // IPC aktualisieren, NICHT neu laden. Neu laden war die Ursache des
    // fruehen Absturz-Bugs bei ueberlappenden ringing-Events (lokaler
    // MicroSIP-Hook + peoplefone-Webhook melden denselben Anruf oft fast
    // gleichzeitig, teils mit leicht anderem Nummernformat).
    callWindow.webContents.send("call-update", { name, number, status });
    scheduleAutoHide(status === "ended" ? TOAST_ENDED_HIDE_MS : TOAST_AUTO_HIDE_MS);
    return;
  }

  // Echt neuer Anruf (andere call.id, oder Karte war nicht sichtbar) --
  // zeitlich bremsen statt auf exakte Nummer-Gleichheit zu pruefen: ein
  // zweites, fast gleichzeitiges "ringing" von der jeweils anderen Quelle
  // soll die Karte nicht doppelt neu laden.
  const now = Date.now();
  if (callWindow.isVisible() && (now - lastLoadAt) < RELOAD_COOLDOWN_MS) {
    scheduleAutoHide(TOAST_AUTO_HIDE_MS);
    return;
  }
  lastLoadAt = now;
  currentCallId = call.id;
  toastEnded = status === "ended";

  // Listener VOR loadFile() registrieren (Race-Condition bei kleinen
  // Seiten), UND "did-finish-load" statt "ready-to-show" ("ready-to-show"
  // feuert nur EINMAL im Fenster-Leben, bei Wiederverwendung nie wieder).
  callWindow.webContents.once("did-finish-load", () => {
    if (!callWindow || callWindow.isDestroyed()) return;
    toastLive = true;
    callWindow.showInactive(); // KEIN show()/focus() -- Tastatur bleibt bei der aktiven App
    callWindow.setAlwaysOnTop(true, "screen-saver");
    callWindow.moveTop();
  });
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
  app.setLoginItemSettings({ openAtLogin: true });

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

  currentUrl = getSavedUrl() || DEFAULT_URL;
  createCallWindow();
  createTray();
  connectRealtime();
});

// Tray-App: soll weiterlaufen, auch wenn das Fenster (versteckt statt
// geschlossen, siehe oben) "zu" ist -- kein app.quit() hier.
app.on("window-all-closed", () => {});
