// ===========================================================================
// Besprechungen (Video) – Theme-Tokens
//
// Baut auf tele(theme) auf (das wiederum auf den zentralen chartis-Tokens) und
// ergänzt die Bühnen-Semantik. Inline-JS-Muster wie im Rest des Repos.
//
// ⚠️ ZWEI WELTEN, BEWUSST GETRENNT (Designentscheid 2026-07-27):
//   • Verwaltung, Green Room und Warteraum laufen im NORMALEN App-Theme
//     (artis/light/dark) – sie gehören sichtbar zu smartis.
//   • Die Gesprächsbühne ist IMMER dunkel, unabhängig vom App-Theme. Das ist
//     kein Schönheitsentscheid: Auf dunklem Grund tritt das Videobild vor,
//     helle Flächen daneben lassen Gesichter flau und grau wirken. Alle
//     ernstzunehmenden Konferenzoberflächen (Meet, Teams, Zoom, Tuple) machen
//     das so. Deshalb sind stage/stagePanel/stageEmpty FESTE Werte.
// ===========================================================================
import { tele } from "@/modules/telefonie/theme";

export function videoTheme(theme) {
  const t = tele(theme);
  return {
    ...t,

    // ── Bühne (themenunabhängig fix) ──────────────────────────────────────
    stage: "#0E1116",        // Hintergrund der Gesprächsfläche
    stagePanel: "#15181D",   // Seitenpanel (Chat/Teilnehmer) über der Bühne
    stageEmpty: "#1A1E24",   // Kachel ohne Bild (Kamera aus / noch kein Track)
    stageDoc: "#0B0D11",     // Fläche hinter einem geteilten Bildschirm
    onStage: "#ffffff",
    onStageMuted: "rgba(255,255,255,.62)",
    stageLine: "rgba(255,255,255,.12)",
    stageHover: "rgba(255,255,255,.10)",

    // Schwebende Steuerleiste – Blur wird per Feature-Detection ersetzt,
    // siehe supportsBlur() unten (Electron/Tauri und schwache Kunden-Laptops).
    barBg: "rgba(15,18,24,.65)",
    barBgOpaque: "rgba(15,18,24,.92)",
    barLine: "rgba(255,255,255,.08)",
    barShadow: "0 8px 32px rgba(0,0,0,.4)",

    // Gast-Kennzeichnung auf dunklem Grund (SEM.extern-Familie)
    guestBg: "rgba(217,119,6,.25)",
    guestFg: "#f0b76a",

    // Namensschild in der Kachel
    chipBg: "rgba(0,0,0,.5)",
  };
}

// Maße als benannte Konstanten – damit Kachelraster, PiP und Steuerleiste
// überall dieselben Werte benutzen und nicht auseinanderlaufen.
export const VM = {
  tileRadius: 14,
  tileGap: 10,
  stagePad: 20,
  pipWidth: 180,
  pipRadius: 12,
  barHeight: 60,
  barBottom: 16,
  panelWidth: 340,
  panelRadius: 16,
  railWidth: 220,       // Personenspalte bei Bildschirmfreigabe
  shareMainPct: 78,     // Breitenanteil des geteilten Bildschirms
  initialsSize: 72,
  hideControlsAfterMs: 5000,
  showControlsOnJoinMs: 15000,
};

// backdrop-filter fehlt in manchen Umgebungen (ältere Electron-Builds, einige
// Linux-Browser). Ohne Prüfung wäre die Steuerleiste dort fast durchsichtig.
export function supportsBlur() {
  if (typeof CSS === "undefined" || !CSS.supports) return false;
  return CSS.supports("backdrop-filter", "blur(2px)") ||
         CSS.supports("-webkit-backdrop-filter", "blur(2px)");
}

// Deterministische Initialen-Farbe – dasselbe Verfahren wie im Chat, damit
// eine Person überall in smartis dieselbe Farbe trägt.
export { initials, personStyle } from "@/lib/chartisTheme";

export const VIDEO_FONT =
  '"Century Gothic Std", "Century Gothic", Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
