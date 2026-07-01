// LoginPilot – Hauptprozess

const { app, BrowserWindow, ipcMain, safeStorage, dialog, Tray, Menu } = require('electron');
const { spawn, execSync } = require('child_process');
const os   = require('os');
const path = require('path');
const fs   = require('fs');

let mainWindow   = null;
let tray         = null;
let isQuitting   = false;
let cachedLogins = [];

const loginWindows = new Map();

// ── Datenspeicherung ──────────────────────────────────────────────────────────

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
function decryptAll(raw) {
  return raw.map(({ passwordEncrypted, passwordPlain, extraEncrypted, extraPlain, ...rest }) => ({
    ...rest,
    password:   decrypt(passwordEncrypted) || passwordPlain  || '',
    extraValue: decrypt(extraEncrypted)    || extraPlain     || '',
  }));
}

// ── IPC: Logins ───────────────────────────────────────────────────────────────

ipcMain.handle('logins:load', () => {
  cachedLogins = decryptAll(readRaw());
  return cachedLogins;
});

ipcMain.handle('logins:save', (_, logins) => {
  cachedLogins = logins;
  writeRaw(logins.map(({ password, extraValue, ...rest }) => {
    const ep = encrypt(password);
    const ee = encrypt(extraValue);
    return {
      ...rest,
      ...(ep ? { passwordEncrypted: ep }  : { passwordPlain:  password   }),
      ...(ee ? { extraEncrypted:    ee }  : { extraPlain:     extraValue }),
    };
  }));
  rebuildTray();
  return true;
});

// ── IPC: Datei-Dialog ─────────────────────────────────────────────────────────

ipcMain.handle('dialog:pick-exe', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Programm auswählen',
    filters: [
      { name: 'Programme', extensions: ['exe', 'bat', 'cmd', 'lnk'] },
      { name: 'Alle Dateien', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  return r.canceled ? null : r.filePaths[0];
});

// ── IPC: Programm starten ─────────────────────────────────────────────────────

ipcMain.handle('program:launch', (_, exePath) => {
  try {
    spawn(exePath, [], { detached: true, stdio: 'ignore', shell: true }).unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── IPC: Webseiten-Login ──────────────────────────────────────────────────────

async function doWebLogin(login) {
  const existing = loginWindows.get(login.id);
  if (existing && !existing.isDestroyed()) { existing.focus(); return { ok: true }; }

  const win = new BrowserWindow({
    width: 1280, height: 900, minWidth: 800, minHeight: 600,
    title: `${login.name} – Login`,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  loginWindows.set(login.id, win);
  win.on('closed', () => loginWindows.delete(login.id));

  let filled = false;
  win.webContents.on('did-finish-load', async () => {
    if (filled) return;
    try {
      const th = new URL(login.url).hostname;
      const ch = new URL(win.webContents.getURL()).hostname;
      if (!ch.endsWith(th.split('.').slice(-2).join('.'))) return;
    } catch { return; }
    filled = true;

    await new Promise(r => setTimeout(r, Number(login.delay ?? 1500)));

    const uSel = login.userSelector   || 'input[type="email"],input[type="text"]:not([type="search"]):not([type="tel"]):not([type="number"])';
    const pSel = login.passSelector   || 'input[type="password"]';
    const sSel = login.submitSelector || '';

    const script = `(function(){
      function fill(sel,val){
        const all=Array.from(document.querySelectorAll(sel));
        const el=all.find(e=>e.offsetParent!==null&&!e.disabled)||all[0];
        if(!el)return false;
        const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set;
        if(s)s.call(el,val);else el.value=val;
        ['input','change','keydown','keyup'].forEach(t=>el.dispatchEvent(new Event(t,{bubbles:true,cancelable:true})));
        el.focus();return true;
      }
      fill(${JSON.stringify(uSel)},${JSON.stringify(login.username||'')});
      fill(${JSON.stringify(pSel)},${JSON.stringify(login.password||'')});
      if(${JSON.stringify(!!sSel)}){
        setTimeout(()=>{
          const b=document.querySelector(${JSON.stringify(sSel)});
          if(b)b.click();
          else{const pw=document.querySelector(${JSON.stringify(pSel)});
            if(pw)pw.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true,cancelable:true}));}
        },600);
      }
    })()`;
    try { await win.webContents.executeJavaScript(script); } catch {}
  });

  try { await win.loadURL(login.url); } catch (err) { return { ok: false, error: err.message }; }
  return { ok: true };
}

ipcMain.handle('login:start', (_, login) => doWebLogin(login));

// ── IPC: Autostart ────────────────────────────────────────────────────────────

ipcMain.handle('autostart:get', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('autostart:set', (_, enabled) => {
  app.setLoginItemSettings({ openAtLogin: enabled });
  rebuildTray();
  return true;
});

// ── IPC: Desktop-Verknüpfung ──────────────────────────────────────────────────

ipcMain.handle('create-shortcut', () => {
  const desktop  = path.join(os.homedir(), 'Desktop');
  const lnkPath  = path.join(desktop, 'LoginPilot.lnk');
  const vbs      = path.join(__dirname, 'LoginPilot.vbs');
  const bat      = path.join(__dirname, 'LoginPilot starten.bat');
  const iconPath = path.join(__dirname, 'icon.ico');
  const target   = fs.existsSync(vbs) ? vbs : bat;
  const workDir  = __dirname;

  const ps = [
    `$ws = New-Object -ComObject WScript.Shell`,
    `$s  = $ws.CreateShortcut([string]'${lnkPath}')`,
    `$s.TargetPath      = [string]'${target}'`,
    `$s.WorkingDirectory= [string]'${workDir}'`,
    `$s.IconLocation    = [string]'${iconPath}'`,
    `$s.Description     = 'LoginPilot'`,
    `$s.Save()`,
  ].join('; ');

  const tmp = path.join(os.tmpdir(), 'lp-sc.ps1');
  try {
    fs.writeFileSync(tmp, ps, 'utf8');
    execSync(`powershell -ExecutionPolicy Bypass -File "${tmp}"`, { windowsHide: true });
    try { fs.unlinkSync(tmp); } catch {}
    return { ok: true };
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    return { ok: false, error: err.message };
  }
});

// ── Tray ──────────────────────────────────────────────────────────────────────

function createTray() {
  // In gepackten Apps liegt das Icon im app.asar.unpacked-Ordner
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'icon.ico')
    : path.join(__dirname, 'icon.ico');
  tray = new Tray(iconPath);
  tray.setToolTip('LoginPilot – Klick zum Öffnen');
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) { mainWindow.hide(); }
    else { mainWindow.show(); mainWindow.focus(); }
  });
  rebuildTray();
}

function rebuildTray() {
  if (!tray) return;

  const loginItems = cachedLogins.length
    ? cachedLogins.map(l => ({
        label: `▶  ${l.name}`,
        click: () => trayLogin(l),
      }))
    : [{ label: '(Keine Logins erfasst)', enabled: false }];

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '🔑 LoginPilot', enabled: false },
    { type: 'separator' },
    ...loginItems,
    { type: 'separator' },
    { label: 'Verwalten…', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    {
      label: 'Mit Windows starten',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => { app.setLoginItemSettings({ openAtLogin: item.checked }); rebuildTray(); },
    },
    { type: 'separator' },
    { label: 'Beenden', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

async function trayLogin(login) {
  if (login.type === 'program') {
    try { spawn(login.exePath, [], { detached: true, stdio: 'ignore', shell: true }).unref(); } catch {}
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('show-credentials', login);
    }
  } else {
    await doWebLogin(login);
  }
}

// ── App-Lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  cachedLogins = decryptAll(readRaw());

  mainWindow = new BrowserWindow({
    width: 460, height: 700, minWidth: 380, minHeight: 500,
    title: 'LoginPilot',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Schliessen → in Tray minimieren
  mainWindow.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  createTray();
});

app.on('before-quit',       () => { isQuitting = true; });
app.on('window-all-closed', () => { /* Tray hält die App am Leben */ });
