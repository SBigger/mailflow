// ===========================================================================
// smartis Telefonie Tray -- schlanke Huelle fuer Anruf-Benachrichtigungen
//
// Grund: ein Browser-Tab kann sich nicht selbst in den Vordergrund holen,
// wenn eine andere App (z.B. Outlook) aktiv ist -- das ist eine bewusste
// Sicherheitssperre aller Browser. Diese kleine Electron-App zeigt dieselbe
// smartis-Telefonie-Oberflaeche in einem eigenen, nativen Fenster, das sich
// bei einem eingehenden Anruf selbst nach vorne holen UND eine echte
// Windows-Benachrichtigung zeigen kann.
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
// (smartis.me Test / Produktiv / eigene URL, gleiches Muster wie
// apps/electron/main.cjs). ABER: SUPABASE_URL/ANON_KEY unten sind fest auf
// smartis.me's Backend verdrahtet -- fuer "Produktiv" (artis.sm-artis.ch,
// eigenes Backend api-artis.sm-artis.ch) muessten diese ebenfalls umschalten,
// was noch nicht gebaut ist (Produktiv-Zugangsdaten sind bewusst nicht
// hier hinterlegt, siehe CLAUDE.md "Produktiv... Default: nicht anfassen").
// Bis dahin zeigt "Produktiv" zwar das richtige Fenster, aber Klingel-
// Benachrichtigungen kommen weiterhin nur fuer smartis.me (Test).
// ===========================================================================
const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain } = require("electron");
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

let mainWindow = null;
let setupWindow = null;
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
    { label: "Öffnen", click: showAndFocus },
    { type: "separator" },
    { label: "Umgebung wechseln…", click: () => openSetupWindow(currentUrl) },
    { type: "separator" },
    { label: "Beenden", click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on("double-click", showAndFocus);
}

// Holt das Fenster zuverlaessig nach vorne -- ein einfaches .focus() wird
// von Windows oft blockiert (Foreground-Lock), wenn der Aufruf nicht vom
// gerade aktiven Fenster kommt. setAlwaysOnTop kurz an/aus + app.focus mit
// steal:true umgeht das zuverlaessig.
function showAndFocus() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.setAlwaysOnTop(true);
  app.focus({ steal: true });
  mainWindow.focus();
  mainWindow.moveTop();
  setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false); }, 800);
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON_PATH });
  n.on("click", showAndFocus);
  n.show();
}

function connectRealtime() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const ch = supabase.channel("telefonie-calls", { config: { broadcast: { self: true } } });
  ch.on("broadcast", { event: "incoming_call" }, ({ payload }) => {
    if (!payload) return;
    if (payload.targetUserId && payload.targetUserId !== MY_PROFILE_ID) return;
    const call = payload.call || {};
    if (call.status === "ringing") {
      const who = call.customer?.company_name || call.peerName || call.peerNumber || "Unbekannt";
      console.log("Eingehender Anruf:", who);
      showAndFocus();
      notify("Eingehender Anruf", who);
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
      showAndFocus();
    } else {
      createWindow(url);
    }
    createTray(url);
  });

  const savedUrl = getSavedUrl() || DEFAULT_URL;
  createWindow(savedUrl);
  createTray(savedUrl);
  connectRealtime();
});

// Tray-App: soll weiterlaufen, auch wenn alle Fenster (versteckt statt
// geschlossen, siehe oben) "zu" sind -- kein app.quit() hier.
app.on("window-all-closed", () => {});
