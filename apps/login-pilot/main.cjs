// LoginPilot – Hauptprozess (schlank & schneller Start)

const { app, BrowserWindow, ipcMain, safeStorage, dialog, Tray, Menu, screen } = require('electron');
const { spawn, execSync } = require('child_process');
const os   = require('os');
const path = require('path');
const fs   = require('fs');

// ── Ressourcen sparen ───────────────────────────────────────────────────────
// Kein GPU-Prozess -> deutlich weniger RAM, schnellerer Start.
app.disableHardwareAcceleration();

// Nur eine Instanz – verhindert doppelte (schwere) Prozesse.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow   = null;
let tray         = null;
let isQuitting   = false;
let cachedLogins = [];

const DOCK_H   = 64;
const MANAGE_H = 660;
const WIN_W    = 560;

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

// ── IPC: Fenster-Höhe (Dock <-> Verwaltung) ────────────────────────────────────

ipcMain.handle('window:height', (_, h) => {
  if (!mainWindow) return;
  const b = mainWindow.getBounds();
  mainWindow.setBounds({ x: b.x, y: b.y, width: b.width, height: Math.round(h) }, false);
});
ipcMain.handle('window:hide',   () => { mainWindow?.hide(); });
ipcMain.handle('window:pin',    (_, on) => { mainWindow?.setAlwaysOnTop(!!on); return !!on; });
ipcMain.handle('window:pinned', () => mainWindow?.isAlwaysOnTop() ?? false);

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
    backgroundColor: '#ffffff',
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
    const kw   = (login.submitKeyword || '').trim();
    const auto = login.autoSubmit !== false;   // Standard: automatisch anmelden

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
      var P=${JSON.stringify(pSel)}, S=${JSON.stringify(sSel)}, KW=${JSON.stringify(kw)};
      fill(${JSON.stringify(uSel)},${JSON.stringify(login.username||'')});
      fill(P,${JSON.stringify(login.password||'')});
      if(${JSON.stringify(auto)}){
        setTimeout(function(){
          var pw=document.querySelector(P);
          var form=pw&&pw.form;
          var scope=form||document;
          function label(e){return ((e.innerText||e.value||'')+' '+(e.getAttribute&&(e.getAttribute('aria-label')||e.getAttribute('title'))||'')).trim();}
          var cands=Array.prototype.slice.call(scope.querySelectorAll('button,input[type=submit],input[type=image],input[type=button],a[role=button]'))
            .filter(function(e){return e.offsetParent!==null&&!e.disabled;});
          // 1. Ausdrücklicher Selektor
          if(S){var b=document.querySelector(S);if(b){b.click();return;}}
          // 2. Stichwort (vom Benutzer)
          if(KW){
            var lk=KW.toLowerCase();
            var hit=cands.find(function(e){return label(e).toLowerCase().indexOf(lk)!==-1;});
            if(hit){hit.click();return;}
          }
          // 3. Automatisch passenden Anmelde-Button finden
          var re=/(log ?in|anmeld|sign ?in|einloggen|weiter|continue|next|senden|submit)/i;
          var btn=cands.find(function(e){
            var t=(e.type||'').toLowerCase();
            if(t==='submit'||t==='image')return true;
            return re.test(label(e));
          });
          if(btn){btn.click();return;}
          // 4. Enter im Passwortfeld
          if(pw){['keydown','keypress','keyup'].forEach(function(ty){
            pw.dispatchEvent(new KeyboardEvent(ty,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));});}
          // 5. Formular direkt absenden
          if(form){if(form.requestSubmit)form.requestSubmit();else form.submit();}
        },700);
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
  const target   = app.isPackaged ? process.execPath : path.join(__dirname, 'LoginPilot starten.bat');
  const workDir  = app.isPackaged ? path.dirname(process.execPath) : __dirname;
  const iconPath = app.isPackaged ? process.execPath : path.join(__dirname, 'icon.ico');

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

function iconFile() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'icon.ico')
    : path.join(__dirname, 'icon.ico');
}

function createTray() {
  try {
    tray = new Tray(iconFile());
  } catch { return; }
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
    { label: 'Verwalten…', click: () => { mainWindow?.show(); mainWindow?.focus(); mainWindow?.webContents.send('open-manage'); } },
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

app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

app.whenReady().then(() => {
  cachedLogins = decryptAll(readRaw());

  const wa = screen.getPrimaryDisplay().workArea;

  mainWindow = new BrowserWindow({
    width: WIN_W, height: DOCK_H,
    x: Math.round(wa.x + (wa.width - WIN_W) / 2),
    y: wa.y + 6,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: '#0f172a',
    title: 'LoginPilot',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Schliessen → in Tray minimieren
  mainWindow.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  createTray();
});

app.on('before-quit',       () => { isQuitting = true; });
app.on('window-all-closed', () => { /* Tray hält die App am Leben */ });
