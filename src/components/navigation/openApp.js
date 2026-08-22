// ── Apps öffnen: eigenes Fenster wenn möglich ──────────────────────
// Reihenfolge: Tauri-WebviewWindow (echtes separates Fenster in der
// Desktop-App) → window.open (neuer Browser-Tab). Das aufrufende
// Fenster (Hub) bleibt IMMER wo es ist — bei blockiertem Popup gibt es
// eine Meldung statt Navigation. Alt-Klick öffnet im gleichen Fenster.
import { toast } from 'sonner';
import { itemHref, recordAppOpen } from './appCatalog';

export function openApp(item, { sameWindow, navigate, record = true, event } = {}) {
  if (record) recordAppOpen(item);
  const href = itemHref(item);

  // Öffnen-Modus: explizit (sameWindow) hat Vorrang; sonst aus der Einstellung
  // (hub_open_mode, Standard 'same' = schnell im gleichen Fenster). Strg/Cmd/
  // Shift/Mittelklick erzwingt IMMER ein neues Fenster.
  if (sameWindow === undefined) {
    let mode = 'same';
    try { mode = localStorage.getItem('hub_open_mode') || 'same'; } catch { /* Standard */ }
    const forceNew = !!(event && (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1));
    sameWindow = mode === 'same' && !forceNew;
  }

  const openHere = () => {
    if (navigate) navigate(href);
    else window.location.href = href;
  };

  if (sameWindow) {
    openHere();
    return;
  }

  // Desktop-App und Browser gehen denselben Weg: window.open. In der
  // Desktop-App faengt der Interceptor in main.jsx das ab und laesst Rust ein
  // echtes Tauri-Fenster bauen - mit denselben WebView2-Argumenten wie das
  // Hauptfenster, weil die nur noch in lib.rs stehen.
  //
  // Frueher stand hier ein eigener WebviewWindow-Aufruf mit von Hand kopierten
  // additionalBrowserArgs. Sobald die von lib.rs abwichen, verweigerte WebView2
  // das zweite Environment im selben Profil (0x8007139F ERROR_INVALID_STATE),
  // das Fenster blitzte nur auf und schloss sofort. Genau das ist am 17.08.2026
  // passiert, als lib.rs erweitert wurde und diese Kopie stehen blieb. Eine
  // Quelle statt zwei.
  openTab(href, item);
}

// WICHTIG: kein 'noopener'-Feature bei window.open — damit gäbe es IMMER
// null zurück und ein Erfolg wäre nicht von einem Popup-Blocker
// unterscheidbar. Und: Das Hub-Fenster wird NIE mitnavigiert.
function openTab(href, item) {
  // Im Browser bewusst ohne Groessenangabe, damit ein normaler Tab aufgeht.
  // In der Desktop-App wird daraus ein Fenster, das braucht eine Startgroesse.
  const groesse = window.__TAURI__ ? 'width=1280,height=860' : undefined;
  const w = window.open(href, '_blank', groesse);
  if (!w) {
    toast.error(`«${item.label}» konnte nicht geöffnet werden — bitte Popups für Smartis erlauben.`);
  }
}
