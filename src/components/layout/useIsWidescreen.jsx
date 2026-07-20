import { useEffect, useState } from "react";

// Breakpoints aus der Recherche (Material 3 Extra-Large als Referenz):
// - Widescreen-Modus aktivierbar ab 1600px Fensterbreite
// - Panel-Anzahl skaliert: 2 (1600-1919), 3 (1920-2559), 4 (>=2560)
// Nur Fensterbreite messen, kein Aspect-Ratio-Sniffing — Ultrawide-User
// arbeiten oft mit halbierten Fenstern.
export const WIDESCREEN_MIN = 1600;
const MQ_WIDESCREEN = `(min-width: ${WIDESCREEN_MIN}px)`;
const MQ_3COL = "(min-width: 1920px)";
const MQ_4COL = "(min-width: 2560px)";

function matches(query) {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

/** Aktiver Match auf min-width 1600px. Kein Re-Render pro Pixel-Drag. */
export function useIsWidescreen() {
  const [isWide, setIsWide] = useState(() => matches(MQ_WIDESCREEN));
  useEffect(() => {
    const mql = window.matchMedia(MQ_WIDESCREEN);
    const onChange = (e) => setIsWide(e.matches);
    mql.addEventListener("change", onChange);
    setIsWide(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isWide;
}

/**
 * Viewport-Klasse für die Widescreen-Persistierung:
 * '2col' (1600-1919), '3col' (1920-2559), '4col' (>=2560), null (<1600).
 * Layouts werden pro Klasse getrennt gespeichert, damit das Ultrawide-Layout
 * im Büro das Laptop-Layout im Zug nicht überschreibt.
 */
export function useViewportClass() {
  const [vc, setVc] = useState(() => resolveClass());
  useEffect(() => {
    const mqls = [MQ_WIDESCREEN, MQ_3COL, MQ_4COL].map((q) => window.matchMedia(q));
    const onChange = () => setVc(resolveClass());
    mqls.forEach((m) => m.addEventListener("change", onChange));
    onChange();
    return () => mqls.forEach((m) => m.removeEventListener("change", onChange));
  }, []);
  return vc;
}

function resolveClass() {
  if (!matches(MQ_WIDESCREEN)) return null;
  if (matches(MQ_4COL)) return "4col";
  if (matches(MQ_3COL)) return "3col";
  return "2col";
}

export const PANELS_FOR_CLASS = { "2col": 2, "3col": 3, "4col": 4 };
