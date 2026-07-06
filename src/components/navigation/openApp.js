// ── Apps öffnen: eigenes Fenster wenn möglich ──────────────────────
// Reihenfolge: Tauri-WebviewWindow (echtes separates Fenster in der
// Desktop-App) → window.open (neuer Browser-Tab). Das aufrufende
// Fenster (Hub) bleibt IMMER wo es ist — bei blockiertem Popup gibt es
// eine Meldung statt Navigation. Alt-Klick öffnet im gleichen Fenster.
import { toast } from 'sonner';
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
        win.once('tauri://error', () => openTab(href, item));
      }
      return;
    }
  } catch {
    // weiter zum Browser-Fallback
  }

  // 2) Browser: neuer Tab (Session bleibt erhalten)
  openTab(href, item);
}

// WICHTIG: kein 'noopener'-Feature bei window.open — damit gäbe es IMMER
// null zurück und ein Erfolg wäre nicht von einem Popup-Blocker
// unterscheidbar. Und: Das Hub-Fenster wird NIE mitnavigiert.
function openTab(href, item) {
  const w = window.open(href, '_blank');
  if (!w) {
    toast.error(`«${item.label}» konnte nicht geöffnet werden — bitte Popups für Smartis erlauben.`);
  }
}
