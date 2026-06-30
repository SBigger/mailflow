// LoginPilot – Hauptprozess

const { app, BrowserWindow, ipcMain, safeStorage, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');

let mainWindow = null;
const loginWindows = new Map(); // id → BrowserWindow (Webseiten)

// ── Datenspeicherung ─────────────────────────────────────────────────────────

function dataPath() {
  return path.join(app.getPath('userData'), 'logins.json');
}

function readRaw() {
  try { return JSON.parse(fs.readFileSync(dataPath(), 'utf8')); }
  catch { return []; }
}

function writeRaw(data) {
  fs.writeFileSync(dataPath(), JSON.stringify(data, null, 2), 'utf8');
}

function decrypt(b64) {
  if (!b64 || !safeStorage.isEncryptionAvailable()) return '';
  try { return safeStorage.decryptString(Buffer.from(b64, 'base64')); }
  catch { return ''; }
}

function encrypt(plain) {
  if (!safeStorage.isEncryptionAvailable()) return null;
  return plain ? safeStorage.encryptString(plain).toString('base64') : null;
}

// ── IPC: Logins laden/speichern ───────────────────────────────────────────────

ipcMain.handle('logins:load', () => {
  return readRaw().map(({ passwordEncrypted, passwordPlain, extraEncrypted, extraPlain, ...rest }) => ({
    ...rest,
    password:   decrypt(passwordEncrypted)  || passwordPlain  || '',
    extraValue: decrypt(extraEncrypted)     || extraPlain     || '',
  }));
});

ipcMain.handle('logins:save', (_, logins) => {
  writeRaw(logins.map(({ password, extraValue, ...rest }) => {
    const encPw    = encrypt(password);
    const encExtra = encrypt(extraValue);
    return {
      ...rest,
      ...(encPw    ? { passwordEncrypted: encPw }    : { passwordPlain: password    }),
      ...(encExtra ? { extraEncrypted: encExtra }     : { extraPlain:   extraValue  }),
    };
  }));
  return true;
});

// ── IPC: Datei-Auswahl für Programme ─────────────────────────────────────────

ipcMain.handle('dialog:pick-exe', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Programm auswählen',
    filters: [
      { name: 'Programme', extensions: ['exe', 'bat', 'cmd', 'lnk'] },
      { name: 'Alle Dateien', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  return result.canceled ? null : result.filePaths[0];
});

// ── IPC: Programm starten ────────────────────────────────────────────────────

ipcMain.handle('program:launch', (_, exePath) => {
  try {
    spawn(exePath, [], { detached: true, stdio: 'ignore', shell: true }).unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC: Webseiten-Login ──────────────────────────────────────────────────────

ipcMain.handle('login:start', async (_, login) => {
  const existing = loginWindows.get(login.id);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return { ok: true, info: 'already-open' };
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: `${login.name} – Login`,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  loginWindows.set(login.id, win);
  win.on('closed', () => loginWindows.delete(login.id));

  let filled = false;

  win.webContents.on('did-finish-load', async () => {
    if (filled) return;

    // Nur auf der Ziel-Domain ausfüllen
    try {
      const targetHost  = new URL(login.url).hostname;
      const currentHost = new URL(win.webContents.getURL()).hostname;
      if (!currentHost.endsWith(targetHost.split('.').slice(-2).join('.'))) return;
    } catch { return; }

    filled = true;

    await new Promise(r => setTimeout(r, Number(login.delay ?? 1500)));

    const userSel   = login.userSelector   || 'input[type="email"],input[type="text"]:not([type="search"]):not([type="tel"]):not([type="number"])';
    const passSel   = login.passSelector   || 'input[type="password"]';
    const submitSel = login.submitSelector || '';

    const script = `(function() {
      function fillField(selector, value) {
        const all = Array.from(document.querySelectorAll(selector));
        const el = all.find(e => e.offsetParent !== null && !e.disabled) || all[0];
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(el, value);
        else el.value = value;
        ['input','change','keydown','keyup'].forEach(t =>
          el.dispatchEvent(new Event(t, { bubbles: true, cancelable: true }))
        );
        el.focus();
        return true;
      }
      const userOk = fillField(${JSON.stringify(userSel)}, ${JSON.stringify(login.username || '')});
      const passOk = fillField(${JSON.stringify(passSel)}, ${JSON.stringify(login.password || '')});
      if (${JSON.stringify(!!submitSel)}) {
        setTimeout(() => {
          const btn = document.querySelector(${JSON.stringify(submitSel)});
          if (btn) { btn.click(); return; }
          const pw = document.querySelector(${JSON.stringify(passSel)});
          if (pw) pw.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', keyCode: 13, bubbles: true, cancelable: true
          }));
        }, 600);
      }
      return { userOk, passOk };
    })()`;

    try {
      await win.webContents.executeJavaScript(script);
    } catch (err) {
      console.error(`[${login.name}] Fill-Fehler:`, err.message);
    }
  });

  try {
    await win.loadURL(login.url);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  return { ok: true };
});

// ── App-Lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width:  460,
    height: 700,
    minWidth:  380,
    minHeight: 500,
    title: 'LoginPilot',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
