const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadLogins:  ()        => ipcRenderer.invoke('logins:load'),
  saveLogins:  (logins)  => ipcRenderer.invoke('logins:save', logins),
  startLogin:  (login)   => ipcRenderer.invoke('login:start', login),
  deleteLogin: (id)      => ipcRenderer.invoke('login:delete', id),
});
