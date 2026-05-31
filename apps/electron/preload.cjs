// Smartis Electron Preload – Haupt-Fenster
const { contextBridge, ipcRenderer } = require('electron');

// Tauri-kompatibler Shim damit bestehendes Frontend-Code weiterläuft
contextBridge.exposeInMainWorld('__TAURI__', {
  core: {
    invoke: (command, args) => ipcRenderer.invoke(`smartis:${command}`, args || {}),
  },
});
contextBridge.exposeInMainWorld('__TAURI_INTERNALS__', { plugins: {} });

// Smartis-Namespace für Desktop-Features
contextBridge.exposeInMainWorld('smartis', {
  isDesktop: true,
  platform: 'electron',

  // Native Windows-Benachrichtigung
  notify: (title, body) => ipcRenderer.invoke('smartis:notify', { title, body }),

  // Hotkey Shift+Ctrl+S → neuer Task
  onNewTask: (callback) => {
    ipcRenderer.on('smartis:new-task', callback);
    return () => ipcRenderer.removeListener('smartis:new-task', callback);
  },
});
