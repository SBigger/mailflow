// Bruecke zwischen Oberflaeche und Hauptprozess -- bewusst winzig gehalten
// (contextIsolation an, kein Node im Renderer).
//
// Der Motor laeuft im Hauptprozess (Realtime + Signieren brauchen Node); hier
// wird er so durchgereicht, dass die Oberflaeche weiterhin nur die
// Motor-Schnittstelle aus engine/engine-api.md sieht.
const { contextBridge, ipcRenderer } = require("electron");

const ereignisse = ["registration", "call", "callEnded", "auth"];

contextBridge.exposeInMainWorld("phoneAPI", {
  openDoc: (docId) => ipcRenderer.invoke("phone:open-doc", docId),
  getProfile: () => ipcRenderer.invoke("phone:get-profile"),
  dial: (nummer) => ipcRenderer.invoke("phone:dial", nummer),

  // Anmeldung: das Passwort wandert direkt in den Hauptprozess und von dort
  // zu Supabase -- es wird nirgends zwischengespeichert.
  auth: {
    status: () => ipcRenderer.invoke("auth:status"),
    anmelden: (email, passwort) => ipcRenderer.invoke("auth:login", email, passwort),
    abmelden: () => ipcRenderer.invoke("auth:logout"),
    beiAenderung: (handler) => ipcRenderer.on("phone:auth", (_e, p) => handler(p)),
  },

  // SIP-Zugang (eigener Sprach-Motor). Das Passwort muss der Renderer kennen --
  // WebRTC gibt es nur dort. Es bleibt aber innerhalb der App.
  sip: {
    laden: () => ipcRenderer.invoke("sip:get"),
    speichern: (cfg) => ipcRenderer.invoke("sip:set", cfg),
  },

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
