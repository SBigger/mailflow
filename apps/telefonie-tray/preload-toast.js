// Preload fuer die kleine Anruf-Karte (Toast).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("toastAPI", {
  open: () => ipcRenderer.invoke("telefonie-tray:toast-open"),
  dismiss: () => ipcRenderer.invoke("telefonie-tray:toast-dismiss"),
});
