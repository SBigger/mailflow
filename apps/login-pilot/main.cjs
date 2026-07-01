// LoginPilot – Hauptprozess (schlank & schneller Start)

const { app, BrowserWindow, ipcMain, safeStorage, dialog, Tray, Menu, screen, clipboard } = require('electron');
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
ipcMain.handle('app:version',   () => app.getVersion());
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

// ── Programm-Autotippen (Windows SendKeys) ────────────────────────────────────

// Sonderzeichen für SendKeys maskieren: + ^ % ~ ( ) [ ] { }
function skEscape(s) {
  return String(s || '').replace(/[+^%~(){}\[\]]/g, m => '{' + m + '}');
}

// Tippt Benutzer/Passwort ins zuletzt geöffnete (Vordergrund-)Fenster.
// Passwort läuft über eine Umgebungsvariable des PowerShell-Kindprozesses –
// steht also NICHT in der Kommandozeile und NICHT im Klartext auf der Platte.
function autoTypeProgram(login) {
  if (process.platform !== 'win32') return;

  let seq = '';
  if (login.typeUser && login.username) seq += skEscape(login.username) + '{TAB}';
  seq += skEscape(login.password || '');
  if (login.typeEnter !== false) seq += '{ENTER}';
  if (!seq.trim()) return;

  const delay = Math.max(0, Number(login.typeDelay ?? 1500));
  const title = (login.windowTitle || '').trim().replace(/'/g, "''");
  // Prozessname aus dem Pfad (ohne .exe) als Fallback fürs Aktivieren
  const proc  = path.basename(login.exePath || '', path.extname(login.exePath || '')).replace(/'/g, "''");

  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName Microsoft.VisualBasic',
    'Start-Sleep -Milliseconds ' + delay,
    // Zielfenster in den Vordergrund holen: zuerst per Titel, sonst per Prozessname
    title ? `try{[Microsoft.VisualBasic.Interaction]::AppActivate('${title}')}catch{try{[Microsoft.VisualBasic.Interaction]::AppActivate('${proc}')}catch{}}`
          : `try{[Microsoft.VisualBasic.Interaction]::AppActivate('${proc}')}catch{}`,
    'Start-Sleep -Milliseconds 400',
    '[System.Windows.Forms.SendKeys]::SendWait($env:LP_SEQ)',
  ].filter(Boolean).join('; ');

  const tmp = path.join(os.tmpdir(), 'lp-type.ps1');
  try {
    fs.writeFileSync(tmp, ps, 'utf8');
    spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', tmp], {
      env: { ...process.env, LP_SEQ: seq },
      detached: true, stdio: 'ignore', windowsHide: true,
    }).unref();
    setTimeout(() => { try { fs.unlinkSync(tmp); } catch {} }, delay + 6000);
  } catch {}
}

// ── IPC: Programm starten ─────────────────────────────────────────────────────

function launchProgram(login) {
  try {
    const exePath = typeof login === 'string' ? login : login.exePath;
    spawn(exePath, [], { detached: true, stdio: 'ignore', shell: true }).unref();
    if (typeof login === 'object' && login.autoType) {
      // Fallback: Passwort in die Zwischenablage – falls Tippen scheitert, reicht Strg+V
      try { if (login.password) clipboard.writeText(login.password); } catch {}
      // LoginPilot aus dem Vordergrund nehmen, damit die Tasten im Ziel-Programm landen
      mainWindow?.blur();
      mainWindow?.hide();
      autoTypeProgram(login);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

ipcMain.handle('program:launch', (_, login) => launchProgram(login));

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

  let lastRun    = '';
  let didKeyword = false;   // Stichwort/Kachel nur EINMAL klicken
  let done       = false;   // nach Passwort-Login: komplett fertig, nichts mehr tun
  let nextCount  = 0;       // "Weiter/Login" höchstens 2×
  let runs       = 0;       // Sicherheitsnetz gegen Endlosschlaufen

  const runAutofill = async (contents) => {
    if (done) return;
    let curUrl;
    try {
      curUrl = contents.getURL();
      const th = new URL(login.url).hostname;
      const ch = new URL(curUrl).hostname;
      if (!ch.endsWith(th.split('.').slice(-2).join('.'))) return;
    } catch { return; }
    // Auf jeder (neuen) Seite derselben Domain: Portal -> Kachel -> echte Login-Seite
    if (curUrl === lastRun) return;
    lastRun = curUrl;
    if (++runs > 5) return;   // niemals endlos

    await new Promise(r => setTimeout(r, Number(login.delay ?? 600)));

    const uSel = login.userSelector   || 'input[type="email"],input[type="text"]:not([type="search"]):not([type="tel"]):not([type="number"])';
    const pSel = login.passSelector   || 'input[type="password"]';
    const sSel = login.submitSelector || '';
    const kw   = (login.submitKeyword || '').trim();
    const auto = login.autoSubmit !== false;   // Standard: automatisch anmelden

    // ── Manuelle Assist-Leiste (im Shadow-DOM -> für die Auto-Erkennung unsichtbar) ──
    const bar = `(function(){
      if(document.getElementById('__lp_host'))return;
      var U=${JSON.stringify(uSel)}, P=${JSON.stringify(pSel)}, S=${JSON.stringify(sSel)};
      var USER=${JSON.stringify(login.username || '')}, PASS=${JSON.stringify(login.password || '')};
      function vis(e){return e&&e.offsetParent!==null&&!e.disabled;}
      function label(e){return ((e.innerText||e.value||'')+' '+((e.getAttribute&&(e.getAttribute('aria-label')||e.getAttribute('title')||e.getAttribute('alt')))||'')).trim();}
      function fill(sel,val){
        var all=Array.prototype.slice.call(document.querySelectorAll(sel));
        var el=all.find(function(e){return vis(e);})||all[0];
        if(!el)return false;
        var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
        if(s)s.call(el,val);else el.value=val;
        ['input','change','keydown','keyup'].forEach(function(t){el.dispatchEvent(new Event(t,{bubbles:true,cancelable:true}));});
        el.focus();return true;
      }
      function submit(){
        if(S){var b=document.querySelector(S);if(b){b.click();return;}}
        var pw=document.querySelector(P);var form=pw&&pw.form,scope=form||document;
        var re=/(log ?in|anmeld|sign ?in|einloggen|weiter|continue|next|senden|submit)/i;
        var cands=Array.prototype.slice.call(scope.querySelectorAll('button,input[type=submit],input[type=image],input[type=button],a[role=button]')).filter(vis);
        var btn=cands.find(function(e){var t=(e.type||'').toLowerCase();if(t==='submit'||t==='image')return true;return re.test(label(e));});
        if(btn){btn.click();return;}
        var f=pw||document.querySelector(U);
        if(f){['keydown','keypress','keyup'].forEach(function(ty){f.dispatchEvent(new KeyboardEvent(ty,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));});}
        if(form){if(form.requestSubmit)form.requestSubmit();else form.submit();}
      }
      var host=document.createElement('div');host.id='__lp_host';
      host.style.cssText='position:fixed;top:10px;right:10px;z-index:2147483647;';
      var root=host.attachShadow({mode:'open'});
      root.innerHTML='<style>'
        +'*{box-sizing:border-box;font-family:system-ui,Segoe UI,sans-serif}'
        +'.bar{display:flex;align-items:center;gap:6px;background:#0f172a;border:1px solid #334155;border-radius:12px;padding:6px 8px;box-shadow:0 6px 20px rgba(0,0,0,.35)}'
        +'.t{color:#93c5fd;font-size:11px;font-weight:700;margin:0 4px 0 2px;white-space:nowrap}'
        +'button{cursor:pointer;border:0;border-radius:8px;font-size:12px;font-weight:600;padding:6px 9px;color:#fff;background:#1e293b;border:1px solid #334155}'
        +'button:hover{background:#263448;border-color:#3b82f6}'
        +'button.go{background:#3b82f6;border-color:#3b82f6}button.go:hover{background:#2563eb}'
        +'button.x{background:transparent;border:0;color:#94a3b8;padding:6px 6px}'
        +'</style>'
        +'<div class="bar"><span class="t">🔑 '+ (${JSON.stringify(login.name || 'Login')}) +'</span>'
        +(USER?'<button id="u">👤 Benutzer</button>':'')
        +(PASS?'<button id="p">🔑 Passwort</button>':'')
        +'<button id="s" class="go">➡ Anmelden</button>'
        +'<button id="x" class="x" title="Leiste ausblenden">✕</button></div>';
      document.documentElement.appendChild(host);
      var q=function(id){return root.getElementById(id);};
      if(q('u'))q('u').addEventListener('click',function(){fill(U,USER);});
      if(q('p'))q('p').addEventListener('click',function(){fill(P,PASS);});
      q('s').addEventListener('click',function(){submit();});
      q('x').addEventListener('click',function(){host.remove();});
    })()`;
    try { await contents.executeJavaScript(bar); } catch {}

    const script = `(function(){
      function vis(e){return e&&e.offsetParent!==null&&!e.disabled;}
      function fill(sel,val){
        const all=Array.from(document.querySelectorAll(sel));
        const el=all.find(e=>e.offsetParent!==null&&!e.disabled)||all[0];
        if(!el)return false;
        const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set;
        if(s)s.call(el,val);else el.value=val;
        ['input','change','keydown','keyup'].forEach(t=>el.dispatchEvent(new Event(t,{bubbles:true,cancelable:true})));
        el.focus();return true;
      }
      function label(e){return ((e.innerText||e.value||'')+' '+((e.getAttribute&&(e.getAttribute('aria-label')||e.getAttribute('title')||e.getAttribute('alt')))||'')).trim();}
      function clickable(el){
        for(var n=el;n&&n!==document.body;n=n.parentElement){
          var t=n.tagName.toLowerCase();
          if(t==='a'||t==='button')return n;
          if(n.getAttribute&&(n.getAttribute('role')==='button'||n.hasAttribute('onclick')))return n;
          try{if(getComputedStyle(n).cursor==='pointer')return n;}catch(e){}
        }
        return el;
      }
      var U=${JSON.stringify(uSel)}, P=${JSON.stringify(pSel)}, S=${JSON.stringify(sSel)}, KW=${JSON.stringify(kw)};
      var HASUSER=${JSON.stringify(!!(login.username))};
      var KWDONE=${didKeyword}, DONE=${done}, NEXTOK=${nextCount < 2};
      var re=/(log ?in|anmeld|sign ?in|einloggen|weiter|continue|next|senden|submit)/i;
      function submitNear(field){
        var form=field&&field.form, scope=form||document;
        var cands=Array.prototype.slice.call(scope.querySelectorAll('button,input[type=submit],input[type=image],input[type=button],a[role=button]')).filter(vis);
        var btn=cands.find(function(e){var t=(e.type||'').toLowerCase();if(t==='submit'||t==='image')return true;return re.test(label(e));});
        if(btn){btn.click();return;}
        if(field){['keydown','keypress','keyup'].forEach(function(ty){field.dispatchEvent(new KeyboardEvent(ty,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));});}
        if(form){if(form.requestSubmit)form.requestSubmit();else form.submit();}
      }
      if(DONE)return 'none';                                     // nach Passwort-Login: gar nichts mehr
      fill(U,${JSON.stringify(login.username||'')});
      fill(P,${JSON.stringify(login.password||'')});
      if(!${JSON.stringify(auto)})return 'filled';
      return new Promise(function(resolve){
        setTimeout(function(){
          try{
            if(S){var b=document.querySelector(S);if(b){b.click();return resolve('submit');}}
            // Stichwort – ortsunabhängig nach Text (Kacheln, Links, Überschriften) – nur EINMAL
            if(KW && !KWDONE){
              var lk=KW.toLowerCase();
              var all=Array.prototype.slice.call(document.querySelectorAll('a,button,[role=button],[onclick],div,li,span,section,article,h1,h2,h3,h4,p,img'));
              var matches=all.filter(function(e){return vis(e)&&label(e).toLowerCase().indexOf(lk)!==-1;});
              matches.sort(function(a,b){return label(a).length-label(b).length;});
              if(matches.length){clickable(matches[0]).click();return resolve('keyword');}
            }
            // Echte Login-Seite (Passwortfeld) -> absenden, danach KOMPLETT Stopp
            var pw=document.querySelector(P);
            if(pw){submitNear(pw);return resolve('submit');}
            // Benutzer-zuerst (Feld vorhanden, aber noch kein Passwort) -> "Weiter/Login" – höchstens 2×
            var uField=Array.prototype.slice.call(document.querySelectorAll(U)).find(vis)||null;
            if(uField && HASUSER && NEXTOK){submitNear(uField);return resolve('next');}
            // Seite ganz ohne Felder (z.B. Startseite): prominenten Login-Einstieg EINMAL anklicken
            if(!KW && !KWDONE){
              var lre=/(^|\\s)(login|anmelden|einloggen|e-?finance|e-?banking|zum login|zur anmeldung|jetzt anmelden|anmeldung)(\\s|$)/i;
              var links=Array.prototype.slice.call(document.querySelectorAll('a,button,[role=button]')).filter(vis);
              var hit=links.find(function(e){var t=label(e).replace(/\\s+/g,' ').trim();return t.length<26 && lre.test(t);});
              if(hit){clickable(hit).click();return resolve('keyword');}
            }
            resolve('none');
          }catch(e){resolve('none');}
        },250);
      });
    })()`;
    let action = 'none';
    try { action = await contents.executeJavaScript(script); } catch {}
    if (action === 'keyword') didKeyword = true;
    else if (action === 'next') nextCount++;
    else if (action === 'submit') done = true;   // Passwort abgeschickt -> fertig, keine weiteren Klicks
  };

  // Ausfüllen auf dem Hauptfenster …
  win.webContents.on('did-finish-load', () => runAutofill(win.webContents));

  // … und auch in Popups/neuen Fenstern (viele Portale öffnen den Login neu)
  win.webContents.setWindowOpenHandler(() => ({ action: 'allow' }));
  win.webContents.on('did-create-window', (child) => {
    try {
      child.setMenuBarVisibility(false);
      loginWindows.set(login.id + ':' + runs, child);
      child.on('closed', () => loginWindows.delete(login.id + ':' + runs));
      child.webContents.on('did-finish-load', () => runAutofill(child.webContents));
    } catch {}
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
  tray.setToolTip('LoginPilot v' + app.getVersion() + ' – Klick zum Öffnen');
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
    { label: '🔑 LoginPilot  v' + app.getVersion(), enabled: false },
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
    launchProgram(login);
    // Wenn nicht automatisch getippt wird: Zugangsdaten zum Kopieren anzeigen
    if (!login.autoType && mainWindow) {
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
