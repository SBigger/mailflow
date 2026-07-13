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

  // 1) Desktop-App (Tauri): echtes separates Fenster
  try {
    const WW = window.__TAURI__?.webviewWindow?.WebviewWindow;
    if (WW) {
      // WICHTIG: relative Route gegen den aktuellen (Remote-)Origin absolut
      // machen. Sonst hängt Tauri die Route an den lokalen Bundle-Origin
      // tauri://localhost/ an — ein FREMDER Origin ohne Supabase-Session.
      // Das neue Fenster wäre dann ausgeloggt, die Dokumentliste bliebe leer
      // und der ?open=<id>-Handler in Dokumente.jsx fände das Dokument nie.
      // Absolut → gleicher Origin wie das Hauptfenster → Session/Cookies
      // werden geteilt und das Dokument öffnet.
      let winUrl = href;
      try { winUrl = new URL(href, window.location.origin).toString(); } catch { /* href bleibt */ }
      const label = ('app-' + href + '-' + Date.now()).replace(/[^a-zA-Z0-9-]/g, '-');
      const win = new WW(label, {
        url: winUrl,
        title: 'Smartis — ' + item.label,
        width: 1280,
        height: 860,
        // MUSS byte-identisch zu additional_browser_args des main-Fensters in
        // apps/src-tauri/src/lib.rs sein. WebView2 verweigert sonst ein zweites
        // Environment mit abweichenden Args im selben Profil (0x8007139F
        // ERROR_INVALID_STATE) → das Fenster blitzt auf und schließt sofort.
        additionalBrowserArgs: '--disable-features=TrackingProtection3pcd,TrackingProtectionSettingsPageLaunch,PrivacySandboxSettings4,PartitionedCookies,ThirdPartyStoragePartitioning,BlockThirdPartyCookies,SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure,msEdgeTrackingProtection,PrivacySandboxAdsAPIs,FedCm --enable-features=SharedArrayBuffer',
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
