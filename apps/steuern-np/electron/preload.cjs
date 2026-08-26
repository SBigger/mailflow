/**
 * Brücke zwischen Oberfläche und Hauptprozess.
 *
 * Bewusst schmal: nur die Aufrufe, die die App wirklich braucht. Die
 * Oberfläche bekommt keinen direkten Zugriff auf das Dateisystem.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("steuerAPI", {
  // Datenbestand
  dbPfad:      ()      => ipcRenderer.invoke("db:pfad"),
  dbLesen:     ()      => ipcRenderer.invoke("db:lesen"),
  dbSchreiben: (daten) => ipcRenderer.invoke("db:schreiben", daten),

  // Belege
  belegAblegen: (auftrag) => ipcRenderer.invoke("beleg:ablegen", auftrag),
  belegOeffnen: (pfad)    => ipcRenderer.invoke("beleg:oeffnen", pfad),

  // Export und Ordner
  dateiSpeichern: (name, inhalt) => ipcRenderer.invoke("datei:speichern", name, inhalt),
  ordnerZeigen:   ()             => ipcRenderer.invoke("ordner:zeigen"),

  istLokal: true,
});
