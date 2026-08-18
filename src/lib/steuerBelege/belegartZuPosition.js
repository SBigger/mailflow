// Brücke zwischen den beiden Achsen der Belegerkennung.
//
//   Belegart  (belegarten.js)          – WAS ein Beleg ist:      «Lohnausweis»
//   Position  (steuer_np_katalog.js)   – WOHIN er gehört:        Seite 2, Haupterwerb
//
// Die beiden fallen nicht zusammen. Ein eSteuerauszug ist EINE Belegart, füllt
// aber ZWEI Positionen (Ertrag auf Seite 2, Bestand auf Seite 4). Umgekehrt
// liefern «Liegenschaft» oder «Rente» als Belegart noch keine Position – dort
// braucht es eine zweite Entscheidung.
//
// Genau diese Zweistufigkeit ist der Punkt: Die Belegart erkennt die Triage
// billig über Regeln. Die Position folgt daraus oft zwingend – und nur wo sie
// es nicht tut, muss überhaupt weiter nachgedacht (oder die KI gefragt) werden.

import { KATALOG_NACH_ID } from '../../forms/steuer_np_katalog.js';

// eindeutig  – die Belegart bestimmt die Position(en) vollständig
// mehrdeutig – es bleibt eine Entscheidung offen; `unterscheidet` sagt, woran
//              sie hängt, `kandidaten` nennt die möglichen Positionen
export const BELEGART_ZU_POSITION = {
  lohnausweis:        { positionen: ['lohn_haupt'],
                        hinweis: 'Zweiter Lohnausweis derselben Person im selben Jahr → lohn_neben.' },

  esteuerauszug:      { positionen: ['wertschriften'],
                        hinweis: 'Ein Beleg, mehrere Ziele: Steuerwert, Bruttoertrag und '
                               + 'Verrechnungsantrag laufen alle über das Wertschriftenverzeichnis.' },

  kontoauszug:        { positionen: ['wertschriften'],
                        hinweis: 'Je Konto eine Zeile im Wertschriftenverzeichnis. Nennt der '
                               + 'Auszug Sollsaldi oder Schuldzinsen, zusätzlich schulden.' },

  schuldzins:         { positionen: ['schulden'],
                        hinweis: 'Restschuld und Zins stehen im selben Ausweis und gehen als '
                               + 'zwei Beträge in die eine Zeile des Schuldenverzeichnisses.' },

  saeule3a:           { positionen: ['saeule_3a'] },
  pk_einkauf:         { positionen: ['einkauf_pk'] },
  krankheitskosten:   { positionen: ['krankheitskosten'] },
  behinderung:        { positionen: ['behinderungskosten'] },
  weiterbildung:      { positionen: ['weiterbildung'] },
  kinderbetreuung:    { positionen: ['kinderbetreuung'] },
  spende:             { positionen: ['spenden'] },
  veranlagung_vorjahr:{ positionen: ['vorjahr'] },

  krankenkasse:       { positionen: ['versicherungspraemien'],
                        hinweis: 'Kassenübersichten enthalten oft beides – enthält der Beleg eine '
                               + 'Leistungsabrechnung, zusätzlich krankheitskosten.' },

  beteiligung:        { positionen: ['beteiligung_qualifiziert'],
                        hinweis: 'Steht im Wertschriftenverzeichnis mit Code Q und zusätzlich auf dem '
                               + 'Blatt «Qualifizierte Beteiligungen» (Teilbesteuerung).' },

  // ── mehrdeutig: Belegart erkannt, Position noch offen ────────────────────
  rente:              { mehrdeutig: true,
                        kandidaten: ['rente_ahv', 'rente_pk', 'rente_saeule3'],
                        unterscheidet: 'Absender – Ausgleichskasse, Pensionskasse oder Vorsorgestiftung' },

  liegenschaft:       { mehrdeutig: true,
                        kandidaten: ['liegenschaft_ertrag', 'liegenschaften', 'liegenschaftsunterhalt'],
                        unterscheidet: 'Ertrag/Eigenmietwert, Steuerwert oder Unterhaltsrechnung' },

  berufsauslagen:     { mehrdeutig: true,
                        kandidaten: ['berufsauslagen_fahrkosten', 'berufsauslagen_verpflegung',
                                     'berufsauslagen_uebrige'],
                        unterscheidet: 'Fahrkosten, Verpflegung oder übrige Berufskosten' },

  alimente:           { mehrdeutig: true,
                        kandidaten: ['alimente_erhalten', 'alimente_bezahlt'],
                        unterscheidet: 'Zahlungsrichtung – erhalten oder bezahlt' },

  steuerformular:     { positionen: ['formular'],
                        hinweis: 'Schluesselbeleg – nennt Kanton, Gemeinde, beide Namen, AHVN13, '
                               + 'Jahr und Frist. Zuerst auswerten, dann den Rest des Stapels.' },

  nebenkosten:        { mehrdeutig: true,
                        kandidaten: ['liegenschaftsunterhalt', '_aussortiert'],
                        unterscheidet: 'Objekt — Betriebskosten einer VERMIETETEN '
                                     + 'Liegenschaft sind Unterhalt, die der '
                                     + 'selbstbewohnten sind Lebenshaltung' },

  liegenschaftsunterhalt: { positionen: ['liegenschaftsunterhalt'],
                        hinweis: 'Werterhaltend oder wertvermehrend entscheidet kein Beleg – '
                               + 'Umbauprojekte immer vorlegen.' },

  arbeitspapier:      { positionen: ['eigene_berechnung'],
                        hinweis: 'Handschriftliches gehoert zu arbeitsnotiz, Berechnungen mit '
                               + 'eigenem Briefkopf zu eigene_berechnung.' },

  zahlungsauftrag:    { mehrdeutig: true,
                        // liegenschaftsunterhalt MUSS Kandidat sein: die
                        // Vergütungsaufträge eines Umbaus sind Zahlungsaufträge
                        // UND Unterhaltsbelege — ohne diesen Kandidaten wählte
                        // die KI «privat» und 18 Bauzahlungen flogen raus.
                        kandidaten: ['liegenschaftsunterhalt', 'uebriges_vermoegen',
                                     'wertschriften', '_aussortiert'],
                        unterscheidet: 'Zweck der Zahlung – Bau-/Handwerkerzahlung ans Objekt '
                                     + '(Unterhalt), Kapitaleinlage, Umbuchung oder Privates' },

  // ── gehört nicht in die Erklärung ────────────────────────────────────────
  werbung:            { positionen: ['_aussortiert'] },
  mahnung:            { positionen: ['_aussortiert'],
                        hinweis: 'Mahnungen sind kein Beleg – die zugrunde liegende Rechnung schon.' },
  privatbeleg:        { positionen: ['_aussortiert'],
                        hinweis: 'Privater Konsum, auch wenn er wie eine Handwerkerrechnung aussieht.' },
};

/**
 * Positionen zu einer erkannten Belegart.
 * Liefert bei mehrdeutigen Belegarten die Kandidaten samt Unterscheidungsmerkmal,
 * statt eine davon zu raten.
 */
export function positionenFuer(belegartKey) {
  const e = BELEGART_ZU_POSITION[belegartKey];
  if (!e) return { positionen: [], offen: true, grund: `Unbekannte Belegart «${belegartKey}»` };

  if (e.mehrdeutig) {
    return {
      positionen: [],
      offen: true,
      kandidaten: e.kandidaten.map(id => KATALOG_NACH_ID[id]).filter(Boolean),
      grund: e.unterscheidet,
    };
  }
  return {
    positionen: e.positionen.map(id => KATALOG_NACH_ID[id]).filter(Boolean),
    offen: false,
    hinweis: e.hinweis,
  };
}

/** Welche Zusatzangaben (Ehegatte / Liegenschaft / Konto) der Beleg noch braucht. */
export function offeneDimensionen(positionen) {
  return [...new Set(positionen.flatMap(p => p?.dimensionen || []))];
}
