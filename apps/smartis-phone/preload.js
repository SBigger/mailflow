// Bruecke zwischen Oberflaeche und Hauptprozess -- bewusst winzig gehalten
// (contextIsolation an, kein Node im Renderer).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("phoneAPI", {
  openDoc: (docId) => ipcRenderer.invoke("phone:open-doc", docId),
  getProfile: () => ipcRenderer.invoke("phone:get-profile"),
});
