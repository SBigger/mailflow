// Smartis Electron Main Process
// Lädt https://smartis.me in eine BrowserWindow. Power-BI-iframes
// funktionieren hier nativ (Chromium ohne Tauri-Script-Injection).

const { app, BrowserWindow, ipcMain, shell, Notification } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./commands.cjs');
const { startExcelServer } = require('./excel-server.cjs');

const SMARTIS_URL = 'https://smartis.me';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    center: true,
    title: 'Smartis by Artis Treuhand',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  // window.open() abfangen:
  //  - login.microsoftonline.com & Co.    → neue BrowserWindow (Cookies geteilt)
  //  - about:/blob:/data:/javascript:     → als BrowserWindow zulassen (MSAL-Popups!)
  //  - app.powerbi.com                    → als BrowserWindow (Drilldown / neue Tabs)
  //  - alles andere http(s)               → externer Browser (Edge)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const isMicrosoftAuth = /login\.(microsoftonline|live|microsoft|windows)\.(com|net)/.test(url);
    const isPowerBi = /(^|\.)powerbi\.(com|microsoft\.com)/.test(url);
    const isHttp = url.startsWith('http://') || url.startsWith('https://');

    if (isMicrosoftAuth) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          title: 'Anmeldung',
          center: true,
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false },
        },
      };
    }

    if (isPowerBi) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1400,
          height: 900,
          center: true,
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false },
        },
      };
    }

    if (!isHttp) {
      // about:blank, blob:, data:, javascript: → Popup als BrowserWindow zulassen
      return { action: 'allow' };
    }

    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.setUserAgent(UA);
  mainWindow.loadURL(SMARTIS_URL, { userAgent: UA });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // UA für alle neuen Sessions
  const { session } = require('electron');
  session.defaultSession.setUserAgent(UA);

  registerIpcHandlers(ipcMain, () => mainWindow);
  startExcelServer(() => mainWindow);

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Native Notification API für den Renderer erreichbar machen
ipcMain.handle('smartis:notify', (_e, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title: title || 'Smartis', body: body || '' }).show();
  }
});
