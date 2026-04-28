import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
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

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
