const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadLogins:     ()        => ipcRenderer.invoke('logins:load'),
  saveLogins:     (logins)  => ipcRenderer.invoke('logins:save', logins),
  startLogin:     (login)   => ipcRenderer.invoke('login:start', login),
  launchProgram:  (exePath) => ipcRenderer.invoke('program:launch', exePath),
  pickExe:        ()        => ipcRenderer.invoke('dialog:pick-exe'),
  getAutostart:   ()        => ipcRenderer.invoke('autostart:get'),
  setAutostart:   (on)      => ipcRenderer.invoke('autostart:set', on),
  createShortcut: ()        => ipcRenderer.invoke('create-shortcut'),
  // Vom Main-Prozess: Credentials anzeigen (bei Programm-Login vom Tray)
  onShowCredentials: (cb) => ipcRenderer.on('show-credentials', (_, login) => cb(login)),
});
