import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { registerSW } from 'virtual:pwa-register'

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
