// ===========================================================================
// Telefonie-Modul – Theme-Tokens
// Baut auf den zentralen Chartis-Tokens auf (artis / hell / dunkel) und ergänzt
// die telefonie-typische Semantik (ein/aus/verpasst, annehmen/auflegen, Presence).
// Inline-JS-Muster wie im Rest des Repos (keine CSS-Variablen).
// ===========================================================================
import { useState, useEffect } from "react";
import { chartisTheme, SEM } from "@/lib/chartisTheme";

// Aktuelles smartis-Theme selbst lesen (localStorage 'app_theme' bzw. data-theme
// am <html>) + live auf Wechsel reagieren. Für UI ausserhalb des Layouts (globales
// Softphone), wo der ThemeContext.Provider nicht im Baum ist.
export function useAppTheme() {
  const read = () => {
    try {
      return localStorage.getItem("app_theme") ||
        document.documentElement.getAttribute("data-theme") || "artis";
    } catch { return "artis"; }
  };
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const update = () => setTheme(read());
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    window.addEventListener("storage", update);
    return () => { obs.disconnect(); window.removeEventListener("storage", update); };
  }, []);
  return theme;
}

export function tele(theme) {
  const t = chartisTheme(theme);
  const dark = theme !== "artis" && theme !== "light";
  return {
    ...t,
    // Anruf-Semantik – über die Themes konstant (wie im TelefonDashboard)
    in:      dark ? "#57b98b" : "#2d6a4f",   // eingehend
    out:     dark ? "#a78bfa" : "#6d4bb0",   // ausgehend
    missed:  SEM.missed,
    answer:  dark ? "#2fb56d" : "#1f9d57",   // annehmen (grün, universell)
    hangup:  dark ? "#e0574f" : "#d64545",   // auflegen (rot)
    presence: SEM.presence,                   // { online, away, busy, offline }
  };
}

// Presence-Modell (manuell vom User wählbar). „im Gespräch" wird automatisch
// aus dem aktiven Anruf abgeleitet und überschreibt die Anzeige.
export const PRESENCE = {
  available: { label: "Verfügbar",   dot: "online",  manual: true },
  busy:      { label: "Beschäftigt", dot: "busy",    manual: true },
  dnd:       { label: "Nicht stören", dot: "busy",   manual: true },
  away:      { label: "Abwesend",    dot: "away",    manual: true },
  incall:    { label: "Im Gespräch", dot: "busy",    manual: false }, // auto
  offline:   { label: "Offline",     dot: "offline", manual: false },
};

// Schweizer Nummer normalisieren (Anzeige/Wahl). Konsolidiert die im Frontend
// mehrfach duplizierte Logik – hier die kanonische Variante fürs Telefonie-Modul.
export function normalizePhone(raw) {
  if (!raw) return "";
  let s = String(raw).replace(/[\s.\-()/]/g, "");
  if (s.startsWith("+")) return s;
  if (s.startsWith("0041")) return "+41" + s.slice(4);
  if (s.startsWith("00")) return "+" + s.slice(2);
  if (s.startsWith("0")) return "+41" + s.slice(1);
  return s;
}

export function formatPhone(raw) {
  const n = normalizePhone(raw);
  if (!n.startsWith("+41")) return raw || "";
  const rest = n.slice(3);
  if (rest.length === 9)
    return `+41 ${rest.slice(0, 2)} ${rest.slice(2, 5)} ${rest.slice(5, 7)} ${rest.slice(7, 9)}`;
  return n;
}
