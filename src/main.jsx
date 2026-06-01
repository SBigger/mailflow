// process-Polyfill für pdfkit/swissqrbill (nutzt process.nextTick u.a.)
// Muss VOR allen anderen Imports laufen, damit pdfkit-Chunks process.nextTick finden.

import {initSupabase} from "./api/supabaseClient.js";

if (typeof window !== 'undefined') {
  if (!window.process) window.process = {};
  if (!window.process.env) window.process.env = {};
  if (!window.process.nextTick) {
    window.process.nextTick = (cb, ...args) => queueMicrotask(() => cb(...args));
  }
  if (!window.process.cwd) window.process.cwd = () => '/';
  if (!window.process.platform) window.process.platform = 'browser';
  if (!window.process.browser) window.process.browser = true;
  if (!window.process.version) window.process.version = '';
  if (!window.process.versions) window.process.versions = { node: '0.0.0' };
  if (!globalThis.process) globalThis.process = window.process;
}

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import { invoke } from '@tauri-apps/api/core';
import '@/index.css'
import { registerSW } from 'virtual:pwa-register'

if (typeof window !== 'undefined' && window.__TAURI__) {
  const origOpen = window.open.bind(window)
  const oauthHosts = /login\.microsoftonline\.com|login\.live\.com|login\.microsoft\.com|login\.windows\.net/
  window.open = function (url, name, features) {
    try {
      if (typeof url === 'string' && oauthHosts.test(url)) {
        window.__TAURI__.core
            .invoke('open_oauth_window', { url })
            .catch((e) => console.error('[Smartis] OAuth-Popup fehlgeschlagen:', e))
        // Dummy-Window für Libraries die window.open().closed prüfen (z.B. MSAL)
        return { closed: false, close() {}, focus() {}, postMessage() {} }
      }
    } catch (e) {
      console.warn('[Smartis] OAuth-Intercept Fehler:', e)
    }
    return origOpen(url, name, features)
  }
  console.info('[Smartis] OAuth-Popup-Interceptor aktiv')
}

// Service Worker: automatisches Update beim App-Start
// Wenn eine neue Version deployed wurde, wird sie sofort aktiviert
registerSW({
  immediate: true,
  onRegisteredSW(swUrl, registration) {
    // Alle 60 Sekunden auf Updates prüfen
    if (registration) {
      setInterval(async () => {
        if (!registration.installing && navigator) {
          try {
            await registration.update()
          } catch { /* ignorieren falls offline */ }
        }
      }, 60 * 1000)
    }
  },
  onNeedRefresh() {
    // Neue Version verfügbar → sofort neu laden (kein Nutzer-Prompt nötig)
    window.location.reload()
  },
  onOfflineReady() {
    // App ist offline-fähig
    console.info('[SW] App bereit für Offline-Nutzung')
  },
})

async function initApp() {
  let config = {
    API_URL: '',
    KEY1: '',
    CUSTOMER: '',
    APP_TYPE: ''
  };
  let url = null;

  try {
    try{
      const customer = await invoke('get_customer_config');
      config.APP_TYPE= "Tauri App";
      config.CUSTOMER = customer;
      config.API_URL = `https://api-${customer}.sm-artis.ch`
      url = `https://${customer}.sm-artis.ch/`
    } catch (e) {
      config.APP_TYPE= "Web App";
      url = window.location.href
      config.CUSTOMER = url.replace('https://', '').split('/')[0].split('.')[0];
      const domain = url.replace('https://', '').split('/')[0];
      config.API_URL = `https://api-${domain}`;
      url = `https://${domain}/`;
    }

    const response = await fetch(`/config.json`);
    const json = await response.json();
    config.KEY1 = json.KEY1;

  } catch (error) {
    console.log("init error: ", error);
  } finally {
    if(!import.meta.env.DEV) {
      window.env = config;
    }
  }

  initSupabase();

  // 2. Jetzt starten wir React und geben die Config als Prop an die App weiter
  ReactDOM.createRoot(document.getElementById('root')).render(
      <React.StrictMode>
        <App/>
      </React.StrictMode>
  );
}

initApp();
