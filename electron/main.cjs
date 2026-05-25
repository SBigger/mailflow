// Smartis Electron Main Process

const { app, BrowserWindow, ipcMain, shell, Notification, globalShortcut, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { registerIpcHandlers } = require('./commands.cjs');
const { startExcelServer } = require('./excel-server.cjs');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';

let mainWindow = null;
let setupWindow = null;
let tray = null;

// ── Config (userData/config.json) ────────────────────────────────────────────
function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function readConfig() {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
}

function getSmartisUrl() {
  return readConfig().url || null;
}

function saveSmartisUrl(url) {
  const cfg = readConfig();
  cfg.url = url;
  writeConfig(cfg);
}

// ── Setup-Fenster (Erster Start / URL ändern) ─────────────────────────────────
function openSetupWindow(currentUrl) {
  if (setupWindow) { setupWindow.focus(); return; }

  setupWindow = new BrowserWindow({
    width: 500,
    height: 420,
    resizable: false,
    center: true,
    title: 'Smartis – Einrichtung',
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-setup.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const query = currentUrl ? `?current=${encodeURIComponent(currentUrl)}` : '';
  setupWindow.loadFile(path.join(__dirname, 'setup.html'), { search: query });

  setupWindow.on('closed', () => { setupWindow = null; });
}

// ── Haupt-Fenster ─────────────────────────────────────────────────────────────
function createMainWindow(smartisUrl) {
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const isMicrosoftAuth = /login\.(microsoftonline|live|microsoft|windows)\.(com|net)/.test(url);
    const isPowerBi = /(^|\.)powerbi\.(com|microsoft\.com)/.test(url);
    const isHttp = url.startsWith('http://') || url.startsWith('https://');

    if (isMicrosoftAuth) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520, height: 720, title: 'Anmeldung', center: true,
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false },
        },
      };
    }
    if (isPowerBi) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1400, height: 900, center: true, autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false },
        },
      };
    }
    if (!isHttp) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.setUserAgent(UA);
  mainWindow.loadURL(smartisUrl, { userAgent: UA });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Tray-Icon ─────────────────────────────────────────────────────────────────
function createTray(smartisUrl) {
  const iconPath = path.join(__dirname, 'icon.ico');
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('Smartis');

  const menu = Menu.buildFromTemplate([
    {
      label: `Smartis öffnen (${smartisUrl})`,
      click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } },
    },
    { type: 'separator' },
    {
      label: 'URL ändern…',
      click: () => openSetupWindow(smartisUrl),
    },
    { type: 'separator' },
    {
      label: 'Beenden',
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

// ── App-Start ─────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const { session } = require('electron');
  session.defaultSession.setUserAgent(UA);

  registerIpcHandlers(ipcMain, () => mainWindow);
  startExcelServer(() => mainWindow);

  // IPC: Setup-Fenster meldet gespeicherte URL zurück
  ipcMain.handle('smartis:save-url', (_e, url) => {
    saveSmartisUrl(url);
    if (setupWindow) { setupWindow.close(); setupWindow = null; }

    if (mainWindow) {
      // URL live neu laden
      mainWindow.loadURL(url, { userAgent: UA });
      mainWindow.show();
      mainWindow.focus();
      // Tray neu aufbauen
      if (tray) { tray.destroy(); tray = null; }
      createTray(url);
    } else {
      createMainWindow(url);
      createTray(url);
    }
  });

  const savedUrl = getSmartisUrl();

  if (!savedUrl) {
    // Erster Start → Setup anzeigen
    openSetupWindow(null);
  } else {
    createMainWindow(savedUrl);
    createTray(savedUrl);
  }

  // Globaler Hotkey: Shift+Ctrl+S → neuer Task
  globalShortcut.register('Shift+Control+S', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('smartis:new-task');
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && getSmartisUrl()) {
      createMainWindow(getSmartisUrl());
    }
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') app.quit();
});

// Native Notification API
ipcMain.handle('smartis:notify', (_e, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title: title || 'Smartis', body: body || '' }).show();
  }
});
