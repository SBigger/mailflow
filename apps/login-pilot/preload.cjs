const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadLogins:    ()         => ipcRenderer.invoke('logins:load'),
  saveLogins:    (logins)   => ipcRenderer.invoke('logins:save', logins),
  startLogin:    (login)    => ipcRenderer.invoke('login:start', login),
  launchProgram: (exePath)  => ipcRenderer.invoke('program:launch', exePath),
  pickExe:       ()         => ipcRenderer.invoke('dialog:pick-exe'),
});
