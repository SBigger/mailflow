// Preload fuer die kleine Anruf-Karte (Toast).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("toastAPI", {
  open: () => ipcRenderer.invoke("telefonie-tray:toast-open"),
  dismiss: () => ipcRenderer.invoke("telefonie-tray:toast-dismiss"),
  answer: () => ipcRenderer.invoke("telefonie-tray:toast-answer"),
  hangup: () => ipcRenderer.invoke("telefonie-tray:toast-hangup"),
  transfer: (target) => ipcRenderer.invoke("telefonie-tray:toast-transfer", target),
  getTargets: () => ipcRenderer.invoke("telefonie-tray:toast-targets"),
  setHeight: (h) => ipcRenderer.invoke("telefonie-tray:toast-height", h),
  openDoc: (docId) => ipcRenderer.invoke("telefonie-tray:toast-open-doc", docId),
  onUpdate: (cb) => ipcRenderer.on("call-update", (_e, data) => cb(data)),
});
