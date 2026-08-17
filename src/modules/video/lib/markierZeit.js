// ===========================================================================
// Lebensdauer einer Markierung.
//
// Sascha: "es kann auch sofort nach 5 sek oder so verschwinden". Damit ist
// der Stift ein Zeigestab und keine Tafel — niemand muss aufräumen, und ein
// vergessener Kringel liegt nicht die ganze Besprechung über der Bilanz.
//
// Eigene, reine Datei wie bildRechteck.js: Zeitverhalten lässt sich sonst nur
// beobachten, nicht prüfen. Hier geht es mit Zahlen.
//
// Erst voll sichtbar, dann ausblenden — hart verschwinden sieht aus wie ein
// Fehler, verblassen wie Absicht.
// ===========================================================================
export const SICHTBAR_MS = 4000;
export const BLENDE_MS = 1500;

// Deckkraft 1 → 0 nach dem Alter des Strichs.
export function sichtbarkeit(zeit, jetzt) {
  const alt = jetzt - zeit;
  if (alt <= SICHTBAR_MS) return 1;
  if (alt >= SICHTBAR_MS + BLENDE_MS) return 0;
  return 1 - (alt - SICHTBAR_MS) / BLENDE_MS;
}

// Ab wann ein Strich niemandem mehr etwas nützt und weggeräumt werden darf.
export function verfallen(zeit, jetzt) {
  return jetzt - zeit >= SICHTBAR_MS + BLENDE_MS;
}
