// ===========================================================================
// bildRechteck – wo liegt ein Video mit object-fit:contain in seiner Fläche?
//
// Bewusst eine eigene, reine Funktion ohne React und ohne DOM: Hier steckt
// der einzige Rechenschritt der Markierfunktion, der still falsch sein kann.
// Liegt das Rechteck daneben, landen alle Markierungen daneben — und zwar bei
// jedem Gegenüber unterschiedlich weit, weil dessen Fenster anders gross ist.
// Als freistehende Funktion lässt sich das mit Zahlen nachrechnen, statt es
// im Gespräch zu zweit erraten zu müssen.
//
// Beispiel: ein 4:3-Bildschirm in einer 16:9-Fläche bekommt links und rechts
// schwarze Balken. Die Markierebene darf NUR über dem Bild liegen, nicht über
// den Balken — sonst verschiebt sich jede Koordinate um die Balkenbreite.
// ===========================================================================
export function bildRechteck(flaecheBreite, flaecheHoehe, bildBreite, bildHoehe) {
  if (!(flaecheBreite > 0) || !(flaecheHoehe > 0)) return null;
  // Masse des Videos noch unbekannt (erste Bilder unterwegs): ganze Fläche
  // annehmen. Sobald "loadedmetadata" kommt, wird neu gerechnet.
  if (!(bildBreite > 0) || !(bildHoehe > 0)) {
    return { left: 0, top: 0, width: flaecheBreite, height: flaecheHoehe };
  }
  const skala = Math.min(flaecheBreite / bildBreite, flaecheHoehe / bildHoehe);
  const w = bildBreite * skala;
  const h = bildHoehe * skala;
  return { left: (flaecheBreite - w) / 2, top: (flaecheHoehe - h) / 2, width: w, height: h };
}
