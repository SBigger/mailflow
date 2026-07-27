// Bruecke zwischen Oberflaeche und Hauptprozess -- bewusst winzig gehalten
// (contextIsolation an, kein Node im Renderer).
//
// Der Motor laeuft im Hauptprozess (Realtime + Signieren brauchen Node); hier
// wird er so durchgereicht, dass die Oberflaeche weiterhin nur die
// Motor-Schnittstelle aus engine/engine-api.md sieht.
const { contextBridge, ipcRenderer } = require("electron");

const ereignisse = ["registration", "call", "callEnded"];

contextBridge.exposeInMainWorld("phoneAPI", {
  openDoc: (docId) => ipcRenderer.invoke("phone:open-doc", docId),
  getProfile: () => ipcRenderer.invoke("phone:get-profile"),
  dial: (nummer) => ipcRenderer.invoke("phone:dial", nummer),

  engine: {
    on(event, handler) {
      if (!ereignisse.includes(event)) return;
      ipcRenderer.on("phone:" + event, (_e, payload) => handler(payload));
    },
    getState: () => ipcRenderer.invoke("phone:state"),
    connect: () => ipcRenderer.invoke("phone:engine", "connect"),
    answer: () => ipcRenderer.invoke("phone:engine", "answer"),
    hangup: () => ipcRenderer.invoke("phone:engine", "hangup"),
    transfer: (ziel) => ipcRenderer.invoke("phone:engine", "transfer", ziel),
    sendDtmf: (ziffer) => ipcRenderer.invoke("phone:engine", "sendDtmf", ziffer),
    setMuted: (v) => ipcRenderer.invoke("phone:engine", "setMuted", v),
    setHold: (v) => ipcRenderer.invoke("phone:engine", "setHold", v),
  },
});
