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
// 1) NICHT das volle Modul-Fenster aufpoppen + Fokus stehlen bei jedem
//    Klingeln -- genau das hat 3CX selbst eine Zeit lang gemacht (Electron-
//    Client v18) und wieder verworfen (Nutzer nahmen aus Versehen per Enter
//    Anrufe an, Tastatur gekapert). Bewaehrter Weg: kleine, NICHT
//    fokussierbare Karte per showInactive() + setAlwaysOnTop('screen-saver').
// 2) EIN Fenster fuer Karte UND volle Ansicht, NICHT zwei separate Fenster --
//    kein etabliertes Programm (Teams, WhatsApp, Slack) laesst eine Karte
//    verschwinden und ein unabhaengiges Fenster woanders aufpoppen, das wirkt
//    unruhig. Stattdessen WAECHST dasselbe Fenster von der Ecke her (sofortige
//    setBounds()-Aenderung -- Windows kennt keine animierte Fenstergroesse,
//    das ist normal/ueblich so, die Kontinuitaet kommt vom SELBEN Fenster,
//    nicht von einer Animation). "frame" kann in Electron nicht zur Laufzeit
//    umgeschaltet werden -- darum bleibt das Fenster in BEIDEN Zustaenden
//    frameless, die volle Ansicht hat ihre eigene Titelleiste/Schliessen-
//    Button in der smartis-Weboberflaeche selbst.
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
// ⚠️ Umgebung (Fenster-URL) ist ueber Tray → "Umgebung wechseln…" waehlbar
// (smartis.me Test / Produktiv / eigene URL). ABER: SUPABASE_URL/ANON_KEY
// unten sind fest auf smartis.me's Backend verdrahtet -- fuer "Produktiv"
// (eigenes Backend api-artis.sm-artis.ch) muesste das separat umgeschaltet
// werden, was noch nicht gebaut ist (Produktiv-Zugangsdaten bewusst nicht
// hier hinterlegt, siehe CLAUDE.md "Produktiv... Default: nicht anfassen").
// ===========================================================================
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = require("electron");
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
const TOAST_W = 364, TOAST_H = 120;
const FULL_W = 420, FULL_H = 740;
const MARGIN = 16;

let callWindow = null;
let setupWindow = null;
let toastHideTimer = null;
let tray = null;
let currentUrl = DEFAULT_URL;
let isExpanded = false; // false = kleine Karte, true = volle Ansicht
let realtimeChannel = null;
let lastCallPayload = null; // letztes bekanntes Broadcast-Payload -- siehe expandToFullAndFocus()

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

// Ein einziges Fenster fuer Karte UND volle Ansicht -- siehe Datei-Kommentar
// oben. Frameless in beiden Zustaenden (Electron kann "frame" nicht zur
// Laufzeit umschalten), startet klein+versteckt+nicht fokussierbar.
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

  // Schliessen (X, nur in der vollen Ansicht sichtbar) beendet die App
  // NICHT, nur verstecken -- typisches Tray-App-Verhalten.
  callWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      hideCallWindow();
    }
  });
}

function hideCallWindow() {
  if (toastHideTimer) { clearTimeout(toastHideTimer); toastHideTimer = null; }
  if (callWindow && !callWindow.isDestroyed()) callWindow.hide();
}

// Kleine, NICHT fokussierbare Karte unten rechts -- siehe Datei-Kommentar
// oben fuer die Begruendung (3CX-Lehre). showInactive() statt show(),
// 'screen-saver'-Ebene statt Fokus-Stehl-Trick.
function showToast(call) {
  const name = call.customer?.company_name || call.peerName || call.peerNumber || "Unbekannt";
  const number = call.peerNumber || "";

  if (isExpanded) {
    // Aus der vollen Ansicht zurueck zur kleinen Karte (z.B. neuer Anruf,
    // waehrend die volle Ansicht noch vom letzten Gespraech offen war).
    const work = screen.getPrimaryDisplay().workArea;
    callWindow.setFocusable(false);
    callWindow.setBounds({
      x: work.x + work.width - TOAST_W - MARGIN,
      y: work.y + work.height - TOAST_H - MARGIN,
      width: TOAST_W, height: TOAST_H,
    });
    isExpanded = false;
  }

  // Listener VOR loadFile() registrieren (Race-Condition bei kleinen
  // Seiten), UND "did-finish-load" statt "ready-to-show" ("ready-to-show"
  // feuert nur EINMAL im Fenster-Leben, bei Wiederverwendung nie wieder).
  callWindow.webContents.once("did-finish-load", () => {
    if (!callWindow || callWindow.isDestroyed() || isExpanded) return;
    callWindow.showInactive(); // KEIN show()/focus() -- Tastatur bleibt bei der aktiven App
    callWindow.setAlwaysOnTop(true, "screen-saver");
    callWindow.moveTop();
  });
  callWindow.loadFile(path.join(__dirname, "toast.html"), {
    search: `name=${encodeURIComponent(name)}&number=${encodeURIComponent(number)}`,
  });

  if (toastHideTimer) clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(hideCallWindow, TOAST_AUTO_HIDE_MS);
}

// Dasselbe Fenster waechst von der Ecke her zur vollen Ansicht -- sofortige
// setBounds() (keine Animation, Windows kann das nicht zuverlaessig; die
// Kontinuitaet kommt daher, dass es dasselbe Fenster bleibt, nicht von einer
// Animation). Hier IST Fokus-Uebernahme erwuenscht (echte Aktion: Anruf
// angenommen, oder Nutzer hat explizit "Öffnen" geklickt).
function expandToFullAndFocus() {
  if (toastHideTimer) { clearTimeout(toastHideTimer); toastHideTimer = null; }
  if (!callWindow || callWindow.isDestroyed()) return;

  const work = screen.getPrimaryDisplay().workArea;
  callWindow.setFocusable(true);
  callWindow.setBounds({
    x: work.x + work.width - FULL_W - MARGIN,
    y: work.y + work.height - FULL_H - MARGIN,
    width: FULL_W, height: FULL_H,
  });
  isExpanded = true;

  if (callWindow.webContents.getURL() !== currentUrl) {
    // Frische Seite -> ihre eigene Realtime-Subscription startet erst JETZT
    // und hat das "answered"-Ereignis von eben verpasst (Supabase-Broadcasts
    // werden nicht nachgeliefert). Darum: nach dem Laden den letzten
    // bekannten Anruf-Stand einmal erneut senden, damit die Seite genau den
    // Zustand zeigt, den sie auch bei einem live mitverfolgten Ereignis
    // gezeigt haette (Dossier/aktives Gespraech statt Cockpit im Leerlauf).
    callWindow.webContents.once("did-finish-load", () => {
      if (lastCallPayload && realtimeChannel) {
        realtimeChannel.send({ type: "broadcast", event: "incoming_call", payload: lastCallPayload });
      }
    });
    callWindow.loadURL(currentUrl);
  }
  callWindow.setAlwaysOnTop(false);
  callWindow.show();
  app.focus({ steal: true });
  callWindow.focus();
}

function createTray() {
  if (tray) { tray.destroy(); tray = null; }
  tray = new Tray(nativeImage.createFromPath(ICON_PATH));
  tray.setToolTip("smartis Telefonie");
  const menu = Menu.buildFromTemplate([
    { label: "Öffnen", click: expandToFullAndFocus },
    { type: "separator" },
    { label: "Umgebung wechseln…", click: openSetupWindow },
    { type: "separator" },
    { label: "Beenden", click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on("double-click", expandToFullAndFocus);
}

function connectRealtime() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const ch = supabase.channel("telefonie-calls", { config: { broadcast: { self: true } } });
  ch.on("broadcast", { event: "incoming_call" }, ({ payload }) => {
    if (!payload) return;
    if (payload.targetUserId && payload.targetUserId !== MY_PROFILE_ID) return;
    const call = payload.call || {};
    if (call.status === "ringing" || call.status === "answered") lastCallPayload = payload;
    if (call.status === "ringing") {
      console.log("Eingehender Anruf:", call.peerNumber);
      showToast(call);
    } else if (call.status === "answered") {
      // Angenommen -> dasselbe Fenster waechst zur vollen Ansicht mit den
      // Kundendaten (Dossier). Fokus-Uebernahme hier erwuenscht.
      expandToFullAndFocus();
    } else if (call.status === "ended") {
      lastCallPayload = null;
      if (!isExpanded) hideCallWindow(); // verpasster Anruf, nie angenommen -- Karte weg
    }
  }).subscribe((status) => {
    console.log("smartis Telefonie Tray: Realtime", status);
  });
  realtimeChannel = ch;
}

app.setName("SmartisTelefonieTray");

app.whenReady().then(() => {
  app.setLoginItemSettings({ openAtLogin: true });

  ipcMain.handle("telefonie-tray:save-url", (_e, url) => {
    currentUrl = url;
    saveUrl(url);
    if (setupWindow) { setupWindow.close(); setupWindow = null; }
    expandToFullAndFocus();
  });

  ipcMain.handle("telefonie-tray:toast-open", expandToFullAndFocus);
  ipcMain.handle("telefonie-tray:toast-dismiss", hideCallWindow);

  currentUrl = getSavedUrl() || DEFAULT_URL;
  createCallWindow();
  createTray();
  connectRealtime();
});

// Tray-App: soll weiterlaufen, auch wenn das Fenster (versteckt statt
// geschlossen, siehe oben) "zu" ist -- kein app.quit() hier.
app.on("window-all-closed", () => {});
