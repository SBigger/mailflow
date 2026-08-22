// ── Navigations-Einstellungen: lokal speichern + Profil-Sync ───────
// Favoriten, Gruppen-Zustände und Sidebar-Modus liegen primär in
// localStorage (funktioniert immer, pro Gerät). Zusätzlich werden sie
// debounced ins Profil geschrieben (profiles.nav_prefs jsonb) und beim
// Start von dort übernommen — damit sind sie auf allen Geräten gleich.
// Fehlt die DB-Spalte noch, scheitert der Sync leise; lokal bleibt alles erhalten.
import { auth } from '@/api/supabaseClient';

const TS_KEY = 'nav_prefs_ts';
let saveTimer = null;

function readJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

// Beim App-Start: Server-Stand übernehmen, wenn er neuer ist als der lokale.
// Rückgabe true = lokale Werte wurden ersetzt (Aufrufer soll State neu laden).
export function hydrateNavPrefs(profile) {
  const remote = profile?.nav_prefs;
  if (!remote || typeof remote !== 'object') return false;
  const localTs = parseInt(localStorage.getItem(TS_KEY) || '0', 10);
  const remoteTs = remote.updated_at || 0;
  if (remoteTs <= localTs) return false;

  try {
    if (Array.isArray(remote.favorites)) localStorage.setItem('app_favorites', JSON.stringify(remote.favorites));
    if (remote.groups && typeof remote.groups === 'object') localStorage.setItem('nav_groups_open', JSON.stringify(remote.groups));
    if (remote.mode === 'rail' || remote.mode === 'wide') localStorage.setItem('nav_mode', remote.mode);
    if (['hub', 'sidebar', 'widescreen'].includes(remote.layout)) localStorage.setItem('nav_layout', remote.layout);
    if (remote.open_mode === 'same' || remote.open_mode === 'new') localStorage.setItem('hub_open_mode', remote.open_mode);
    if (['normal', 'abschluss', 'panel'].includes(remote.dok_view)) localStorage.setItem('dok_view', remote.dok_view);
    if (remote.widgets_on === true || remote.widgets_on === false) localStorage.setItem('hub_widgets', remote.widgets_on ? '1' : '0');
    if (Array.isArray(remote.widgets_order)) localStorage.setItem('hub_widgets_order', JSON.stringify(remote.widgets_order));
    if (remote.widgets_mandant && typeof remote.widgets_mandant === 'object') {
      if (typeof remote.widgets_mandant.deb === 'string') localStorage.setItem('hub_mandant_deb', remote.widgets_mandant.deb);
      if (typeof remote.widgets_mandant.kred === 'string') localStorage.setItem('hub_mandant_kred', remote.widgets_mandant.kred);
    }
    localStorage.setItem(TS_KEY, String(remoteTs));
  } catch {
    return false;
  }
  window.dispatchEvent(new CustomEvent('smartis:favorites-changed'));
  return true;
}

// Nach jeder Änderung aufrufen: markiert lokal den Zeitstempel und
// schreibt gebündelt (1.5 s) ins Profil.
export function scheduleNavPrefsSave() {
  const ts = Date.now();
  try {
    localStorage.setItem(TS_KEY, String(ts));
  } catch {
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await auth.updateMe({
        nav_prefs: {
          updated_at: ts,
          favorites: readJson('app_favorites', []),
          groups: readJson('nav_groups_open', {}),
          mode: localStorage.getItem('nav_mode') || 'wide',
          layout: localStorage.getItem('nav_layout') || 'sidebar',
          open_mode: localStorage.getItem('hub_open_mode') || 'same',
          dok_view: localStorage.getItem('dok_view') || 'normal',
          widgets_on: localStorage.getItem('hub_widgets') === '1',
          widgets_order: readJson('hub_widgets_order', null) ?? undefined,
          widgets_mandant: {
            deb: localStorage.getItem('hub_mandant_deb') || '',
            kred: localStorage.getItem('hub_mandant_kred') || '',
          },
        },
      });
    } catch {
      // Spalte existiert noch nicht oder offline → localStorage genügt
    }
  }, 1500);
}
