// ===========================================================================
// smartis Telefonie Tray -- schlanke Huelle fuer Anruf-Benachrichtigungen
//
// Grund: ein Browser-Tab kann sich nicht selbst in den Vordergrund holen,
// wenn eine andere App (z.B. Outlook) aktiv ist -- das ist eine bewusste
// Sicherheitssperre aller Browser. Diese kleine Electron-App zeigt bei einem
// eingehenden Anruf eine kleine Karte unten rechts (wie Teams/Slack), OHNE
// die Tastatur-Eingabe in der gerade aktiven App zu unterbrechen.
//
// WICHTIG (Fable-Recherche 2026-07-23): NICHT das volle Modul-Fenster
// aufpoppen + Fokus stehlen bei jedem Klingeln -- genau das hat 3CX selbst
// eine Zeit lang gemacht (Electron-Client v18) und wieder verworfen, weil
// Nutzer beim Tippen aus Versehen mit Enter Anrufe annahmen / die Tastatur
// gekapert wurde. Der bewaehrte Weg (Teams/Slack, auch 3CX's fruehere
// "Call Alert Popup"): eine KLEINE, NICHT fokussierbare Karte per
// showInactive() + setAlwaysOnTop(true,'screen-saver') -- sichtbar ueber
// allem, aber Tastatur-Eingaben bleiben bei der aktiven App. Das volle
// Modul-Fenster oeffnet sich nur auf einen ECHTEN Klick (Karte/Tray/
// Benachrichtigung) -- dort ist Fokus-Uebernahme normal und erwuenscht.
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

let mainWindow = null;
let setupWindow = null;
let toastWindow = null;
let toastHideTimer = null;
let tray = null;

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

function openSetupWindow(currentUrl) {
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
  const query = currentUrl ? `?current=${encodeURIComponent(currentUrl)}` : "";
  setupWindow.loadFile(path.join(__dirname, "setup.html"), { search: query });
  setupWindow.on("closed", () => { setupWindow = null; });
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 740,
    show: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    icon: ICON_PATH,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadURL(url);

  // Schliessen (X) beendet die App NICHT, nur ins Tray verstecken --
  // typisches Tray-App-Verhalten, echtes Beenden nur ueber das Tray-Menu.
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray(currentUrl) {
  if (tray) { tray.destroy(); tray = null; }
  tray = new Tray(nativeImage.createFromPath(ICON_PATH));
  tray.setToolTip("smartis Telefonie");
  const menu = Menu.buildFromTemplate([
    { label: "Öffnen", click: showMainAndFocus },
    { type: "separator" },
    { label: "Umgebung wechseln…", click: () => openSetupWindow(currentUrl) },
    { type: "separator" },
    { label: "Beenden", click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on("double-click", showMainAndFocus);
}

// Volles Modul-Fenster zeigen + Fokus holen -- NUR bei einem echten Klick
// (Tray/Karte/Benachrichtigung) aufrufen, nie automatisch beim Klingeln.
// Hier IST Fokus-Uebernahme erwuenscht, darum steal:true.
function showMainAndFocus() {
  hideToast();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  app.focus({ steal: true });
  mainWindow.focus();
  mainWindow.moveTop();
}

function hideToast() {
  if (toastHideTimer) { clearTimeout(toastHideTimer); toastHideTimer = null; }
  if (toastWindow && !toastWindow.isDestroyed()) toastWindow.hide();
}

// Kleine, NICHT fokussierbare Karte unten rechts -- siehe Datei-Kommentar
// oben fuer die Begruendung (3CX-Lehre). showInactive() statt show(),
// 'screen-saver'-Ebene statt Fokus-Stehl-Trick.
function showToast(call) {
  const name = call.customer?.company_name || call.peerName || call.peerNumber || "Unbekannt";
  const number = call.peerNumber || "";

  if (!toastWindow || toastWindow.isDestroyed()) {
    const work = screen.getPrimaryDisplay().workArea;
    const w = 340, h = 150;
    toastWindow = new BrowserWindow({
      width: w,
      height: h,
      x: work.x + work.width - w - 16,
      y: work.y + work.height - h - 16,
      frame: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      focusable: false,
      show: false,
      alwaysOnTop: true,
      icon: ICON_PATH,
      webPreferences: {
        preload: path.join(__dirname, "preload-toast.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
  }

  // WICHTIG: Listener VOR loadFile() registrieren, sonst Race-Condition --
  // bei einer so kleinen Seite kann "did-finish-load" schon feuern, bevor
  // ein danach registrierter Listener ueberhaupt dran waere. Ausserdem
  // "did-finish-load" statt "ready-to-show" verwenden: "ready-to-show"
  // feuert nur EINMAL im Leben des Fensters (erste Anzeige), bei einem
  // wiederverwendeten Fenster (2. Anruf) kaeme also nie wieder ein Event --
  // "did-finish-load" feuert dagegen bei JEDEM loadFile()-Aufruf neu.
  toastWindow.webContents.once("did-finish-load", () => {
    if (!toastWindow || toastWindow.isDestroyed()) return;
    toastWindow.showInactive(); // KEIN show()/focus() -- Tastatur bleibt bei der aktiven App
    toastWindow.setAlwaysOnTop(true, "screen-saver");
    toastWindow.moveTop();
  });
  toastWindow.loadFile(path.join(__dirname, "toast.html"), {
    search: `name=${encodeURIComponent(name)}&number=${encodeURIComponent(number)}`,
  });

  if (toastHideTimer) clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(hideToast, TOAST_AUTO_HIDE_MS);
}

function connectRealtime() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const ch = supabase.channel("telefonie-calls", { config: { broadcast: { self: true } } });
  ch.on("broadcast", { event: "incoming_call" }, ({ payload }) => {
    if (!payload) return;
    if (payload.targetUserId && payload.targetUserId !== MY_PROFILE_ID) return;
    const call = payload.call || {};
    if (call.status === "ringing") {
      // Nur EINE Meldung beim Klingeln -- die kleine Karte, keine zusaetzliche
      // native Benachrichtigung daneben (war doppelt/verwirrend).
      console.log("Eingehender Anruf:", call.peerNumber);
      showToast(call);
    } else if (call.status === "answered") {
      // Angenommen -> Karte weg, volles Fenster mit Kundendaten (Dossier)
      // zeigen. Hier ist Fokus-Uebernahme erwuenscht: der Anruf laeuft
      // gerade, Sascha will jetzt aktiv die Kundendaten sehen.
      hideToast();
      showMainAndFocus();
    } else if (call.status === "ended") {
      hideToast(); // z.B. verpasster Anruf, nie angenommen
    }
  }).subscribe((status) => {
    console.log("smartis Telefonie Tray: Realtime", status);
  });
}

app.setName("SmartisTelefonieTray");

app.whenReady().then(() => {
  app.setLoginItemSettings({ openAtLogin: true });

  ipcMain.handle("telefonie-tray:save-url", (_e, url) => {
    saveUrl(url);
    if (setupWindow) { setupWindow.close(); setupWindow = null; }
    if (mainWindow) {
      mainWindow.loadURL(url);
      showMainAndFocus();
    } else {
      createWindow(url);
    }
    createTray(url);
  });

  ipcMain.handle("telefonie-tray:toast-open", showMainAndFocus);
  ipcMain.handle("telefonie-tray:toast-dismiss", hideToast);

  const savedUrl = getSavedUrl() || DEFAULT_URL;
  createWindow(savedUrl);
  createTray(savedUrl);
  connectRealtime();
});

// Tray-App: soll weiterlaufen, auch wenn alle Fenster (versteckt statt
// geschlossen, siehe oben) "zu" sind -- kein app.quit() hier.
app.on("window-all-closed", () => {});
