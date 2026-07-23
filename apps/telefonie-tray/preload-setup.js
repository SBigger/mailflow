// Preload fuer das Einrichtungs-Fenster (Umgebung waehlen).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  saveUrl: (url) => ipcRenderer.invoke("telefonie-tray:save-url", url),
});
