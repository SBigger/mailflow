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

const WIN_W = 420, WIN_H = 720;
let mainWindow = null;

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
    createMainWindow();

    // Dokument in der smartis-Dateiablage oeffnen (gleicher Deep-Link wie
    // die heutige Anruf-Karte: /Dokumente?doc=<id>).
    ipcMain.handle("phone:open-doc", (_e, docId) => {
      if (!docId) return;
      shell.openExternal("https://smartis.me/Dokumente?doc=" + encodeURIComponent(String(docId)));
    });

    // Eigenes Profil (spaeter aus der Konfiguration je Mitarbeitendem).
    ipcMain.handle("phone:get-profile", () => ({ fullName: "Sascha Bigger", extension: "20" }));
  });
}

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
