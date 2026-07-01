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
  // Fenster-Steuerung (Dock <-> Verwaltung)
  setHeight:      (h)       => ipcRenderer.invoke('window:height', h),
  hideWindow:     ()        => ipcRenderer.invoke('window:hide'),
  setPin:         (on)      => ipcRenderer.invoke('window:pin', on),
  getPin:         ()        => ipcRenderer.invoke('window:pinned'),
  // Vom Main-Prozess
  onShowCredentials: (cb) => ipcRenderer.on('show-credentials', (_, login) => cb(login)),
  onOpenManage:      (cb) => ipcRenderer.on('open-manage', () => cb()),
});
