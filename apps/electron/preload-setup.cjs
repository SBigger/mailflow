// Preload für das Setup-Fenster
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveUrl: (url) => ipcRenderer.invoke('smartis:save-url', url),
});
