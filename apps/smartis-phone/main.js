// ===========================================================================
// smartis Telefon -- Electron-Hauptprozess (Geruest).
//
// Bewusst schlank: Fenster, Berechtigungen, ein paar Brücken zur Oberfläche.
// Der SIP-Motor kommt spaeter dazu -- entweder im Renderer (JavaScript-Stack
// ueber WebSocket) oder hier im Hauptprozess (nativer Stack), je nach
// Recherche-Entscheid. Die Oberflaeche bleibt in beiden Faellen gleich.
//
// Uebernommene Lehren aus apps/telefonie-tray (dort teuer erkauft):
//   - Absturzsicherung fuer uncaughtException UND unhandledRejection
//   - powerSaveBlocker, damit Windows die App im Hintergrund nicht drosselt
//   - Einzelinstanz-Sperre (sonst zwei Telefone gleichzeitig)
//   - Autostart mit explizitem Pfad+Argument (sonst startet nur Electron)
// ===========================================================================
const { app, BrowserWindow, ipcMain, shell, powerSaveBlocker, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
// Electrons gebuendeltes Node hat kein globales WebSocket -- @supabase/
// realtime-js braucht eins, sonst wirft createClient() (Lehre aus telefonie-tray).
if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = require("ws");
}
const { createRealtimeEngine } = require("./engine/realtime-engine");

const WIN_W = 420, WIN_H = 720;
let mainWindow = null;
let engine = null;

const DEFAULT_SUPABASE_URL = "https://uawgpxcihixqxqxxbjak.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhd2dweGNpaGl4cXhxeHhiamFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MzE5MzYsImV4cCI6MjA4ODAwNzkzNn0.fPbekBh1dO8byD2wxkjzFSKW4jSV0MHIGgci9nch98A";

// ── Konfiguration ────────────────────────────────────────────────────────
// Eigene Datei zuerst; sonst die der Anruf-Karte mitbenutzen (bis der Client
// sie ganz abloest, waere doppelte Pflege nur eine Fehlerquelle).
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")); // BOM! (Windows)
  } catch {
    return null;
  }
}
function loadConfig() {
  const eigene = path.join(app.getPath("userData"), "config.json");
  const derKarte = path.join(app.getPath("appData"), "SmartisTelefonieTray", "config.json");
  const cfg = readJson(eigene) || readJson(derKarte) || {};
  return {
    quelle: readJson(eigene) ? eigene : (readJson(derKarte) ? derKarte : "(keine)"),
    profileId: cfg.profileId || null,
    controlSecret: cfg.controlSecret || null,
    supabaseUrl: cfg.supabaseUrl || DEFAULT_SUPABASE_URL,
    supabaseAnonKey: cfg.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY,
    url: cfg.url || "https://smartis.me",
    targets: Array.isArray(cfg.targets) ? cfg.targets : [],
    extension: cfg.extension || null,
    fullName: cfg.fullName || null,
  };
}
let CFG = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    minWidth: 380,
    minHeight: 560,
    title: "smartis Telefon",
    backgroundColor: "#f6f9f6",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "..", "telefonie-tray", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("closed", () => { mainWindow = null; });
}

// Mikrofon ohne Rueckfrage freigeben -- ein Telefon ohne Mikrofon waere
// sinnlos, und der Electron-Standarddialog erscheint sonst bei jedem Anruf.
function allowMicrophone(session) {
  session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media");
  });
}

app.setName("smartisPhone");

process.on("uncaughtException", (err) => console.error("uncaughtException (App laeuft weiter):", err));
process.on("unhandledRejection", (err) => console.error("unhandledRejection (App laeuft weiter):", err));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    powerSaveBlocker.start("prevent-app-suspension");
    allowMicrophone(require("electron").session.defaultSession);

    CFG = loadConfig();
    console.log("Konfiguration aus:", CFG.quelle,
      JSON.stringify({ profil: CFG.profileId ? CFG.profileId.slice(0, 8) + "…" : null,
                       geheimnis: CFG.controlSecret ? "vorhanden" : "FEHLT",
                       ziele: CFG.targets.length }));
    if (!CFG.profileId) {
      console.warn("⚠️ Keine profileId -- der Client empfaengt keine Anrufe (siehe README).");
    }

    createMainWindow();

    // ── Motor starten und an die Oberflaeche bruecken ────────────────────
    // Realtime + Signieren brauchen Node, laufen also hier; der Renderer
    // bekommt dieselben Ereignisse ueber IPC und kennt weiterhin nur die
    // Motor-Schnittstelle.
    engine = createRealtimeEngine({
      supabaseUrl: CFG.supabaseUrl,
      supabaseAnonKey: CFG.supabaseAnonKey,
      profileId: CFG.profileId,
      controlSecret: CFG.controlSecret,
      log: (...a) => console.log("[Motor]", ...a),
    });
    const anDieOberflaeche = (event) => (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("phone:" + event, payload);
    };
    engine.on("registration", anDieOberflaeche("registration"));
    engine.on("call", anDieOberflaeche("call"));
    engine.on("callEnded", anDieOberflaeche("callEnded"));

    // Erst verbinden, wenn die Oberflaeche steht -- sonst geht das erste
    // Ereignis ins Leere (der Renderer haette noch keine Zuhoerer).
    mainWindow.webContents.once("did-finish-load", () => {
      if (CFG.profileId) engine.connect();
    });

    ipcMain.handle("phone:engine", (_e, methode, arg) => {
      if (!engine || typeof engine[methode] !== "function") return false;
      return engine[methode](arg);
    });
    ipcMain.handle("phone:state", () => (engine ? engine.getState() : null));

    // Ausgehend waehlen: MicroSIP ist als tel:-Standardprogramm eingetragen
    // und uebernimmt den Ruf -- bis der eigene SIP-Stack das selbst kann.
    ipcMain.handle("phone:dial", (_e, nummer) => {
      const sauber = String(nummer || "").replace(/[^\d+*#]/g, "");
      if (!sauber) return false;
      shell.openExternal("tel:" + sauber);
      return true;
    });

    // Dokument in der smartis-Dateiablage oeffnen (gleicher Deep-Link wie
    // die heutige Anruf-Karte: /Dokumente?doc=<id>).
    ipcMain.handle("phone:open-doc", (_e, docId) => {
      if (!docId) return;
      let origin = "https://smartis.me";
      try { origin = new URL(CFG.url).origin; } catch { /* Vorgabe behalten */ }
      shell.openExternal(origin + "/Dokumente?doc=" + encodeURIComponent(String(docId)));
    });

    ipcMain.handle("phone:get-profile", () => ({
      fullName: CFG.fullName,
      extension: CFG.extension,
      targets: CFG.targets,
      hatGeheimnis: !!CFG.controlSecret,
    }));
  });
}

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
