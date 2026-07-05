// ── Apps öffnen: eigenes Fenster wenn möglich ──────────────────────
// Reihenfolge: Tauri-WebviewWindow (echtes separates Fenster in der
// Desktop-App) → window.open (neuer Browser-Tab) → gleiches Fenster
// (Popup-Blocker). Mit Alt-Klick öffnen Aufrufer im gleichen Fenster.
import { itemHref, recordAppOpen } from './appCatalog';

export function openApp(item, { sameWindow = false, navigate } = {}) {
  recordAppOpen(item);
  const href = itemHref(item);

  const openHere = () => {
    if (navigate) navigate(href);
    else window.location.href = href;
  };

  if (sameWindow) {
    openHere();
    return;
  }

  // 1) Desktop-App (Tauri): echtes separates Fenster
  try {
    const WW = window.__TAURI__?.webviewWindow?.WebviewWindow;
    if (WW) {
      const label = ('app-' + href + '-' + Date.now()).replace(/[^a-zA-Z0-9-]/g, '-');
      const win = new WW(label, {
        url: href,
        title: 'Smartis — ' + item.label,
        width: 1280,
        height: 860,
      });
      // Fehlt der Fenster-Berechtigung im Tauri-Build → Browser-Fallback
      if (typeof win.once === 'function') {
        win.once('tauri://error', () => {
          const w = window.open(href, '_blank', 'noopener');
          if (!w) openHere();
        });
      }
      return;
    }
  } catch {
    // weiter zum Browser-Fallback
  }

  // 2) Browser: neuer Tab (Session bleibt erhalten)
  const w = window.open(href, '_blank', 'noopener');
  if (!w) openHere();
}
