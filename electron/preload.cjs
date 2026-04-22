// Smartis Electron Preload
// Exposed eine Tauri-kompatible `window.__TAURI__` API, damit der Frontend-Code
// (main.jsx, Auswertungen.jsx) ohne Änderungen weiterläuft. invoke() geht
// per contextBridge → ipcRenderer an den Electron-Main-Prozess.

const { contextBridge, ipcRenderer } = require('electron');

const tauriShim = {
  core: {
    invoke: (command, args) => ipcRenderer.invoke(`smartis:${command}`, args || {}),
  },
};

// Compat: zeigt dem Frontend "ich bin Tauri/Desktop-Client"
contextBridge.exposeInMainWorld('__TAURI__', tauriShim);
contextBridge.exposeInMainWorld('__TAURI_INTERNALS__', { plugins: {} });

// Optional: direkter Smartis-Namespace für neue Features (Notifications etc.)
contextBridge.exposeInMainWorld('smartis', {
  notify: (title, body) => ipcRenderer.invoke('smartis:smartis:notify', { title, body }),
  isDesktop: true,
  platform: 'electron',
});
