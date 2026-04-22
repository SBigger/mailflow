// Smartis Electron IPC Handlers
// Portiert die Rust-Commands aus src-tauri/src/lib.rs nach Node.js.
// Namenskonvention: "smartis:<command>" matched 1:1 die Tauri-Commands.

const { app, shell, BrowserWindow, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

let dbInstance = null;
function getDb() {
  if (dbInstance) return dbInstance;
  const Database = require('better-sqlite3');
  const dir = path.join(app.getPath('userData'));
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'smartis_offline.db');
  dbInstance = new Database(dbPath);
  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      synced INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return dbInstance;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';

function registerIpcHandlers(ipcMain, getMainWindow) {
  // ── Download-Verzeichnis ──────────────────────────────────────────────────
  ipcMain.handle('smartis:get_download_dir', () => app.getPath('downloads'));

  // ── Ordner mit Dateien herunterladen ──────────────────────────────────────
  ipcMain.handle('smartis:download_folder', async (_e, args) => {
    const { folderName, folder_name, files = [], destination } = args || {};
    const name = folderName || folder_name || 'download';
    const base = destination || app.getPath('downloads');
    const folderPath = path.join(base, name);
    await fsp.mkdir(folderPath, { recursive: true });

    let downloaded = 0;
    const errors = [];

    for (const f of files) {
      const filePath = path.join(folderPath, f.filename);
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      try {
        const res = await fetch(f.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        await fsp.writeFile(filePath, buf);
        downloaded++;
      } catch (e) {
        errors.push(`${f.filename}: ${e.message}`);
      }
    }

    return {
      success: errors.length === 0,
      path: folderPath,
      files_downloaded: downloaded,
      errors,
    };
  });

  // ── Ordner im Explorer öffnen ─────────────────────────────────────────────
  ipcMain.handle('smartis:open_folder', async (_e, args) => {
    const { path: p } = args || {};
    if (p) await shell.openPath(p);
  });

  // ── Cache (SQLite) ────────────────────────────────────────────────────────
  ipcMain.handle('smartis:cache_set', (_e, args) => {
    const { key, value } = args || {};
    getDb()
      .prepare(
        "INSERT OR REPLACE INTO cache (key, value, updated_at) VALUES (?, ?, datetime('now'))",
      )
      .run(key, value);
  });

  ipcMain.handle('smartis:cache_get', (_e, args) => {
    const { key } = args || {};
    const row = getDb()
      .prepare('SELECT key, value, updated_at FROM cache WHERE key = ?')
      .get(key);
    return row || null;
  });

  ipcMain.handle('smartis:cache_clear', () => {
    getDb().prepare('DELETE FROM cache').run();
  });

  // ── App-Version ───────────────────────────────────────────────────────────
  ipcMain.handle('smartis:get_version', () => app.getVersion());

  // ── Externe URL (Browser) ─────────────────────────────────────────────────
  ipcMain.handle('smartis:open_external_url', async (_e, args) => {
    const { url } = args || {};
    if (url) await shell.openExternal(url);
  });

  // ── OAuth-Popup (Microsoft-Login) ─────────────────────────────────────────
  // Wird in main.jsx via window.open-Interceptor aufgerufen. In Electron
  // reicht eine neue BrowserWindow — Cookies werden über session.defaultSession
  // automatisch geteilt.
  ipcMain.handle('smartis:open_oauth_window', (_e, args) => {
    const { url } = args || {};
    if (!url) return;
    const parent = getMainWindow && getMainWindow();
    const win = new BrowserWindow({
      width: 520,
      height: 720,
      title: 'Anmeldung',
      center: true,
      autoHideMenuBar: true,
      parent: parent || undefined,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.loadURL(url, { userAgent: UA });
  });

  // ── Embedded URL in eigenem Fenster (Power BI, externe Embeds) ────────────
  ipcMain.handle('smartis:open_embedded_window', (_e, args) => {
    const { url, title = 'Smartis', width = 1400, height = 900 } = args || {};
    if (!url) return;
    const win = new BrowserWindow({
      width,
      height,
      title,
      center: true,
      autoHideMenuBar: true,
      icon: path.join(__dirname, 'icon.ico'),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.loadURL(url, { userAgent: UA });
  });

  // ── Tracking Prevention (kein Op in Electron — Chromium hat das Problem nicht) ──
  ipcMain.handle('smartis:disable_tracking_prevention', () => 'noop (electron)');

  // ── Native Notification ───────────────────────────────────────────────────
  ipcMain.handle('smartis:smartis:notify', (_e, args) => {
    const { title, body } = args || {};
    if (Notification.isSupported()) {
      new Notification({ title: title || 'Smartis', body: body || '' }).show();
    }
  });
}

module.exports = { registerIpcHandlers };
