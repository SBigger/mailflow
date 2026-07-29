// ===========================================================================
// Wo steht der Paperboy?
//
// ⚠️ NICHT als absolute Pixel merken. Genau das war der Fehler: Gespeichert
// wurde left/top, und diese Pixel gehörten zu dem Fenster, in dem gerade
// gezogen wurde. Nach einem grösseren Fenster, einem zweiten Bildschirm oder
// geänderter Zoomstufe stand das Männchen dann mitten auf der Seite in der
// Luft (Sascha, mit Bild belegt) – im umgekehrten Fall ausserhalb.
//
// Gemerkt wird deshalb die ECKE und der Abstand dazu. Damit bleibt er beim
// Vergrössern in seiner Ecke, statt dort liegen zu bleiben, wo die Ecke
// früher einmal war. Die nächste Ecke gewinnt: Wer ihn nach links oben
// zieht, findet ihn auch in einem breiteren Fenster links oben.
//
// Eigene, reine Datei ohne React – wie bildRechteck.js im Videomodul. Ein
// Positionsfehler zeigt sich sonst erst, wenn jemand das Fenster ändert.
// ===========================================================================
export const FAB = 52;   // Durchmesser des Knopfs
export const RAND = 6;   // Mindestabstand zum Fensterrand

// Standard: unten rechts, ÜBER dem Telefon-Knopf (der sitzt in derselben Ecke).
export const STANDARD = { rechts: true, unten: true, dx: 26, dy: 96 };

// Absolute Position -> Ecke samt Abstand. Die NÄCHSTE Ecke gewinnt.
export function zuPlatz(x, y, w, h) {
  const rechts = x + FAB / 2 > w / 2;
  const unten = y + FAB / 2 > h / 2;
  return {
    rechts, unten,
    dx: Math.round(rechts ? w - x - FAB : x),
    dy: Math.round(unten ? h - y - FAB : y),
  };
}

// Ecke samt Abstand -> Position im AKTUELLEN Fenster, immer noch sichtbar.
export function zuPunkt(platz, w, h) {
  const x = platz.rechts ? w - platz.dx - FAB : platz.dx;
  const y = platz.unten ? h - platz.dy - FAB : platz.dy;
  return {
    x: Math.min(Math.max(RAND, x), Math.max(RAND, w - FAB - RAND)),
    y: Math.min(Math.max(RAND, y), Math.max(RAND, h - FAB - RAND)),
  };
}
