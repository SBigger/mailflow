// Preload fuer die kleine Anruf-Karte (Toast).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("toastAPI", {
  open: () => ipcRenderer.invoke("telefonie-tray:toast-open"),
  dismiss: () => ipcRenderer.invoke("telefonie-tray:toast-dismiss"),
  answer: () => ipcRenderer.invoke("telefonie-tray:toast-answer"),
  onUpdate: (cb) => ipcRenderer.on("call-update", (_e, data) => cb(data)),
});
