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

registerSW({
  immediate: true,
  onRegisteredSW(swUrl, registration) {
    if (registration) {
      setInterval(async () => {
        if (!registration.installing && navigator.onLine) {
          try {
            await registration.update();
          } catch (error) {
            console.debug('[SW] Update check failed (likely offline):', error);
          }
        }
      }, 5 * 60 * 1000);
    }
  },
  onNeedRefresh() {
    // Neue Version da. Aber NICHT blind neu laden: ein Deploy waehrend
    // jemand einen Belegstapel sortiert oder ein Formular fuellt, warf
    // bisher kommentarlos die ganze ungespeicherte Arbeit weg (zweimal
    // live erlebt am 16.08.). Module melden laufende Arbeit ueber
    // window.smartisArbeitAktiv an; solange dort etwas steht, wird das
    // Update zurueckgehalten und alle 30 s erneut geprueft.
    const aktivieren = () => {
      console.info('[SW] New content available, activating...');
      if (navigator.serviceWorker) {
        navigator.serviceWorker.getRegistration().then((reg) => {
          if (reg && reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      }
      window.location.reload();
    };
    const versuch = () => {
      const aktiv = window.smartisArbeitAktiv;
      if (aktiv && aktiv.size > 0) {
        console.info('[SW] Update wartet – Arbeit im Gang:', [...aktiv].join(', '));
        setTimeout(versuch, 30000);
      } else {
        aktivieren();
      }
    };
    versuch();
  },
  onOfflineReady() {
    console.info('[SW] App bereit für Offline-Nutzung');
  },
});

async function initApp() {
  let config = {
    HOSTNAME: '',
    API_URL: '',
    KEY1: '',
    CUSTOMER: '',
    APP_TYPE: ''
  };

  console.log("window.__TAURI__: ", window.__TAURI__);
  try {
    try{
      const customer = await invoke('get_customer_config');
      config.APP_TYPE= "Tauri App";
      config.CUSTOMER = customer;
      config.API_URL = `https://api-${customer}.sm-artis.ch`;
      config.HOSTNAME = `https://${customer}.sm-artis.ch`;
    } catch (e) {
      config.APP_TYPE= "Web App";
      const url = window.location.href
      config.CUSTOMER = url.replace('https://', '').split('/')[0].split('.')[0];
      const domain = url.replace('https://', '').split('/')[0];
      config.HOSTNAME = window.location.hostname;
      config.API_URL = `https://api-${domain}`;
    }

    const response = await fetch(`/config.json`);
    const json = await response.json();
    config.KEY1 = json.KEY1;

  } catch (error) {
    console.log("init error: ", error);
  } finally {
    if(import.meta.env.DEV) {
      config.API_URL = import.meta.env.VITE_SUPABASE_URL;
      config.KEY1 = import.meta.env.VITE_SUPABASE_ANON_KEY;
      config.CUSTOMER = "DEVELOPMENT"
    } else if(window.location.href.includes('https://smartis.me')) {
      config.API_URL = import.meta.env.VITE_SUPABASE_URL;
      config.KEY1 = import.meta.env.VITE_SUPABASE_ANON_KEY;
      config.CUSTOMER = "artis";
      config.HOSTNAME = window.location.hostname;
    }

    window.env = config;
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
