// Steuer-Kennzahlen aus einem Smartis-Abschluss (abschluss_konten).
//
// Gemeinsame Quelle fuer das Tool /Steuern (Kurzmaske «Aus Abschluss uebernehmen»)
// und den MCP-Server (apps/mcp-server, Modul steuern). Reine Logik ohne
// Datenbankzugriff, damit sie in Browser und Node identisch laeuft.
//
// Vorzeichen der Fibu-Exporte (Abacus, Topal, ...): Aktiven und Aufwand positiv,
// Passiven und Ertrag negativ. Manche Exporte liefern alles positiv – die
// Konvention wird darum pro Abschluss erkannt.
//
// Eigenkapital-Konten werden ueber die Bezeichnung klassifiziert, weil die
// Kontonummern je Kontenplan abweichen (Abacus 2900 = gesetzliche Reserven,
// KMU-Kontenrahmen 2900 = gesetzliche Kapitalreserve). Nummer (KMU) und
// Smartis-Position sind nur Rueckfall.

/** @typedef {{kontonummer:string, kontoname:string, saldo_ist:number|string|null, saldo_vorjahr:number|string|null, position_id:string|null}} Konto */
/** @typedef {'aktienkapital'|'gesetzl_kapitalreserve'|'kapitaleinlagereserve'|'gesetzl_gewinnreserve'|'freiwillige_reserve'|'uebrige_reserve'|'versteuerte_stille_reserven'|'eigene_kapitalanteile'|'gewinnvortrag'|'jahresergebnis_konto'|'unbekannt'} EkKlasse */
/** @typedef {{dividende?:number, tantiemen?:number, zuweisung_gesetzl_gewinnreserve?:number, zuweisung_freiwillige_reserve?:number, uebrige?:{bezeichnung:string, betrag:number}[]}} Gewinnverwendung */

export const alsZahl = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};
export const round2 = (n) => Math.round(n * 100) / 100;
export const kontonummerAlsZahl = (k) => parseInt(String(k.kontonummer).replace(/\D/g, '').slice(0, 4), 10) || 0;

/** Eigenkapital-Klasse anhand des Kontonamens. @returns {EkKlasse|null} */
export function klasseNachName(name) {
  const n = (name || '').toLowerCase().replace(/[-_/]/g, ' ').replace(/\s+/g, ' ');
  if (/eigene (aktien|kapitalanteile|anteile|stammanteile)/.test(n)) return 'eigene_kapitalanteile';
  if (/stille reserve|als gewinn versteuert/.test(n)) return 'versteuerte_stille_reserven';
  if (/jahresgewinn|jahresverlust|jahresergebnis|jahreserfolg|reingewinn|gewinn laufend|ergebnis laufend|unternehmensergebnis/.test(n)) return 'jahresergebnis_konto';
  if (/gewinnvortrag|verlustvortrag|bilanzgewinn|bilanzverlust|\bvortrag\b/.test(n)) return 'gewinnvortrag';
  if (/kapitaleinlage|\bker\b|agio|aufgeld/.test(n)) return 'kapitaleinlagereserve';
  if (/kapitalreserve/.test(n)) return 'gesetzl_kapitalreserve';
  if (/aktienkapital|stammkapital|grundkapital|gesellschaftskapital|genossenschaftskapital|partizipationskapital|anteilscheinkapital/.test(n)) return 'aktienkapital';
  if (/frei(e|willig)\w* (gewinn)?reserve|statutarisch|spezialreserve|reservefonds|übrige reserve|uebrige reserve|andere reserve|dispositions/.test(n)) return 'freiwillige_reserve';
  if (/aufwertungsreserve|reserve für eigene|reserve fuer eigene/.test(n)) return 'uebrige_reserve';
  if (/gesetzl\w* (gewinn)?reserve|allgemeine reserve|allg\. reserve|gewinnreserve/.test(n)) return 'gesetzl_gewinnreserve';
  if (/\breserve/.test(n)) return 'uebrige_reserve';
  return null;
}

/** Rueckfall: Kontonummer nach Schweizer KMU-Kontenrahmen. @returns {EkKlasse|null} */
export function klasseNachNummer(nr) {
  if (nr >= 2800 && nr <= 2899) return 'aktienkapital';
  if (nr >= 2900 && nr <= 2929) return 'gesetzl_kapitalreserve';
  if (nr >= 2930 && nr <= 2949) return 'uebrige_reserve';
  if (nr >= 2950 && nr <= 2959) return 'gesetzl_gewinnreserve';
  if (nr >= 2960 && nr <= 2969) return 'freiwillige_reserve';
  if (nr >= 2970 && nr <= 2978) return 'gewinnvortrag';
  if (nr === 2979) return 'jahresergebnis_konto';
  if (nr >= 2980 && nr <= 2989) return 'eigene_kapitalanteile';
  if (nr >= 2990 && nr <= 2999) return 'gewinnvortrag';
  return null;
}

const POSITION_ZU_KLASSE = {
  EK_KAPITAL: 'aktienkapital', EK_KAP_RESERVE: 'gesetzl_kapitalreserve', EK_GES_RESERVE: 'gesetzl_gewinnreserve',
  EK_FREIE_RESERVE: 'freiwillige_reserve', EK_RESERVEN: 'uebrige_reserve', EK_VORTRAG: 'gewinnvortrag', EK_JAHRESERGEBNIS: 'jahresergebnis_konto',
};

export const EK_KLASSEN_LABEL = {
  aktienkapital: 'Aktien-/Stammkapital', gesetzl_kapitalreserve: 'Gesetzliche Kapitalreserve', kapitaleinlagereserve: 'Reserven aus Kapitaleinlagen',
  gesetzl_gewinnreserve: 'Gesetzliche Gewinnreserve', freiwillige_reserve: 'Freiwillige Gewinnreserve', uebrige_reserve: 'Übrige Reserven',
  versteuerte_stille_reserven: 'Versteuerte stille Reserven', eigene_kapitalanteile: 'Eigene Kapitalanteile', gewinnvortrag: 'Gewinn-/Verlustvortrag',
  jahresergebnis_konto: 'Jahresergebnis', unbekannt: 'Unbekannt',
};

function istEigenkapital(k) {
  const nr = kontonummerAlsZahl(k);
  return (nr >= 2800 && nr <= 2999) || (k.position_id || '').startsWith('EK_');
}

/**
 * @param {Konto[]} konten
 * @param {number} jahr
 * @param {Gewinnverwendung} [gv]
 */
export function berechneKennzahlen(konten, jahr, gv = {}) {
  const warnungen = [];
  const NR = kontonummerAlsZahl;
  const bilanz = konten.filter((k) => NR(k) >= 1000 && NR(k) <= 2999);
  const aktiven = bilanz.filter((k) => NR(k) < 2000);
  const passiven = bilanz.filter((k) => NR(k) >= 2000);
  const er = konten.filter((k) => NR(k) >= 3000 && NR(k) <= 8999);

  const sum = (arr, feld) => arr.reduce((s, k) => s + alsZahl(k[feld]), 0);
  const aktivenIst = sum(aktiven, 'saldo_ist');
  const passivenIst = sum(passiven, 'saldo_ist');
  const passivenNegativ = passivenIst < 0 || (passivenIst === 0 && aktivenIst >= 0);
  const pSign = passivenNegativ ? -1 : 1;

  const ertragKonten = er.filter((k) => NR(k) < 4000 || (NR(k) >= 7000 && NR(k) < 7100) || (NR(k) >= 7500 && NR(k) < 8100) || (NR(k) >= 8500 && NR(k) < 8600));
  const ertragIst = sum(ertragKonten, 'saldo_ist');
  const ertragNegativ = ertragIst < 0 || (ertragIst === 0 && passivenNegativ);
  const eSign = ertragNegativ ? -1 : 1;

  const jahresergebnisEr = round2(sum(er, 'saldo_ist') * eSign);
  const erSummeVj = er.some((k) => k.saldo_vorjahr != null) ? round2(sum(er, 'saldo_vorjahr') * eSign) : null;

  const ekKonten = [];
  for (const k of bilanz.filter(istEigenkapital)) {
    let klasse = klasseNachName(k.kontoname);
    let quelle = 'name';
    if (!klasse) { klasse = klasseNachNummer(NR(k)); quelle = 'nummer'; }
    if (!klasse && k.position_id && POSITION_ZU_KLASSE[k.position_id]) { klasse = POSITION_ZU_KLASSE[k.position_id]; quelle = 'position'; }
    if (!klasse) { klasse = 'unbekannt'; warnungen.push(`Konto ${k.kontonummer} "${k.kontoname}" konnte keiner Eigenkapital-Klasse zugeordnet werden.`); }
    ekKonten.push({
      kontonummer: k.kontonummer, kontoname: k.kontoname, klasse, quelle,
      ist: round2(alsZahl(k.saldo_ist) * pSign),
      vorjahr: k.saldo_vorjahr == null ? null : round2(alsZahl(k.saldo_vorjahr) * pSign),
    });
  }
  const ek = (klasse, feld = 'ist') => round2(ekKonten.filter((e) => e.klasse === klasse).reduce((s, e) => s + (e[feld] ?? 0), 0));

  const bilanzDiff = round2(aktivenIst + passivenIst * (passivenNegativ ? 1 : -1));
  const ergebnisKonto = ek('jahresergebnis_konto');
  let jahresergebnis; let herkunft;
  if (Math.abs(bilanzDiff) > 0.05) {
    jahresergebnis = bilanzDiff; herkunft = 'bilanzdifferenz';
    if (ergebnisKonto !== 0) warnungen.push(`Bilanz weist eine Differenz von ${bilanzDiff} auf UND es gibt ein Jahresergebnis-Konto (${ergebnisKonto}). Ergebnis bitte prüfen.`);
    if (Math.abs(bilanzDiff - jahresergebnisEr) > 0.05) warnungen.push(`Bilanzdifferenz (${bilanzDiff}) und Erfolgsrechnung (${jahresergebnisEr}) stimmen nicht überein.`);
  } else if (ergebnisKonto !== 0) {
    jahresergebnis = ergebnisKonto; herkunft = 'konto';
    if (Math.abs(ergebnisKonto - jahresergebnisEr) > 0.05 && er.length > 0) warnungen.push(`Jahresergebnis-Konto (${ergebnisKonto}) und Erfolgsrechnung (${jahresergebnisEr}) stimmen nicht überein.`);
  } else {
    jahresergebnis = jahresergebnisEr; herkunft = 'erfolgsrechnung';
    if (er.length === 0) warnungen.push('Keine Erfolgsrechnungs-Konten vorhanden – Jahresergebnis ist 0.');
  }

  const bilanzsummeVj = aktiven.some((k) => k.saldo_vorjahr != null) ? round2(sum(aktiven, 'saldo_vorjahr')) : null;
  let jahresergebnisVj = null;
  if (bilanzsummeVj != null) {
    const diffVj = round2(bilanzsummeVj + sum(passiven, 'saldo_vorjahr') * (passivenNegativ ? 1 : -1));
    jahresergebnisVj = Math.abs(diffVj) > 0.05 ? diffVj : (ek('jahresergebnis_konto', 'vorjahr') || erSummeVj);
  }

  const gewinnvortrag = ek('gewinnvortrag');
  const bilanzgewinn = round2(gewinnvortrag + jahresergebnis);

  const uebrige = (gv.uebrige || []).map((u) => ({ bezeichnung: u.bezeichnung, betrag: round2(alsZahl(u.betrag)) }));
  const gvVoll = {
    dividende: round2(alsZahl(gv.dividende)), tantiemen: round2(alsZahl(gv.tantiemen)),
    zuweisung_gesetzl_gewinnreserve: round2(alsZahl(gv.zuweisung_gesetzl_gewinnreserve)),
    zuweisung_freiwillige_reserve: round2(alsZahl(gv.zuweisung_freiwillige_reserve)),
    uebrige, total: 0, vortrag_neu: 0,
  };
  gvVoll.total = round2(gvVoll.dividende + gvVoll.tantiemen + gvVoll.zuweisung_gesetzl_gewinnreserve + gvVoll.zuweisung_freiwillige_reserve + uebrige.reduce((s, u) => s + u.betrag, 0));
  gvVoll.vortrag_neu = round2(bilanzgewinn - gvVoll.total);
  if (gvVoll.total > bilanzgewinn + 0.005 && bilanzgewinn >= 0) warnungen.push(`Gewinnverwendung (${gvVoll.total}) übersteigt den Bilanzgewinn (${bilanzgewinn}).`);
  if (bilanzgewinn < 0 && gvVoll.dividende > 0) warnungen.push('Dividende trotz Bilanzverlust – handelsrechtlich nicht zulässig.');

  const aktienkapital = ek('aktienkapital');
  const gesKap = ek('gesetzl_kapitalreserve');
  const ker = ek('kapitaleinlagereserve');
  const gesGew = ek('gesetzl_gewinnreserve');
  const frei = ek('freiwillige_reserve');
  const uebr = ek('uebrige_reserve');
  const stille = ek('versteuerte_stille_reserven');
  const eigene = ek('eigene_kapitalanteile');
  const ekTotal = round2(aktienkapital + gesKap + ker + gesGew + frei + uebr + stille + eigene + gewinnvortrag + jahresergebnis);

  const fuenf = jahresergebnis > 0 ? round2(jahresergebnis * 0.05) : 0;
  const ziel = round2(aktienkapital * 0.5);
  const bestand = round2(gesGew + gesKap + ker);
  const luecke = Math.max(0, round2(ziel - bestand));
  const empfohlen = Math.min(fuenf, luecke);
  const hinweis = jahresergebnis <= 0
    ? 'Kein Gewinn – keine Zuweisung an die gesetzliche Gewinnreserve nötig.'
    : luecke === 0
      ? 'Gesetzliche Reserven haben 50 % des Kapitals erreicht – keine Pflichtzuweisung (OR 672 Abs. 2).'
      : `Pflichtzuweisung 5 % des Jahresgewinns = ${fuenf}, begrenzt durch Lücke zum 50-%-Ziel (${luecke}).`;

  const ekNach = {
    aktienkapital,
    gesetzl_kapitalreserve: round2(gesKap + ker),
    gesetzl_gewinnreserve: round2(gesGew + gvVoll.zuweisung_gesetzl_gewinnreserve),
    freiwillige_reserve: round2(frei + gvVoll.zuweisung_freiwillige_reserve),
    uebrige_reserve: uebr, versteuerte_stille_reserven: stille, eigene_kapitalanteile: eigene,
    gewinnvortrag: gvVoll.vortrag_neu, total: 0,
  };
  ekNach.total = round2(ekNach.aktienkapital + ekNach.gesetzl_kapitalreserve + ekNach.gesetzl_gewinnreserve + ekNach.freiwillige_reserve + ekNach.uebrige_reserve + ekNach.versteuerte_stille_reserven + ekNach.eigene_kapitalanteile + ekNach.gewinnvortrag);

  if (aktienkapital === 0) warnungen.push('Kein Aktien-/Stammkapital-Konto gefunden.');
  if (aktiven.length === 0) warnungen.push('Keine Aktiv-Konten gefunden – Bilanzsumme ist 0.');

  return {
    jahr,
    vorzeichen: { passiven_negativ: passivenNegativ, ertrag_negativ: ertragNegativ },
    bilanzsumme: round2(aktivenIst), bilanzsumme_vorjahr: bilanzsummeVj,
    jahresergebnis, jahresergebnis_vorjahr: jahresergebnisVj, jahresergebnis_herkunft: herkunft, jahresergebnis_er: jahresergebnisEr,
    gewinnvortrag,
    gewinnvortrag_vorjahr: ekKonten.some((e) => e.klasse === 'gewinnvortrag' && e.vorjahr != null) ? ek('gewinnvortrag', 'vorjahr') : null,
    bilanzgewinn, aktienkapital,
    gesetzl_kapitalreserve: gesKap, kapitaleinlagereserve: ker, gesetzl_gewinnreserve: gesGew,
    freiwillige_reserve: frei, uebrige_reserve: uebr, versteuerte_stille_reserven: stille, eigene_kapitalanteile: eigene,
    eigenkapital_total: ekTotal, ek_konten: ekKonten,
    gewinnverwendung: gvVoll, ek_nach_verwendung: ekNach,
    gesetzliche_reserve: { fuenf_prozent: fuenf, ziel, bestand, empfohlene_zuweisung: empfohlen, hinweis },
    warnungen,
  };
}

/**
 * Verlustvortrag aus frueheren, in Smartis gespeicherten Erklaerungen desselben Kantons.
 * @param {{steuerjahr:number, felder:Record<string,unknown>}[]} fruehere  Eintraege VOR dem Steuerjahr, neueste zuerst
 */
export function verlustvortragAusErklaerungen(fruehere) {
  if (!fruehere || !fruehere.length) return null;
  const n = (v) => (v == null || v === '' ? null : Number(v));
  const vj = fruehere[0];
  const f = vj.felder || {};
  const rest = n(f.verlustvortrag_ende);
  const reingewinn = n(f.reingewinn_buch);
  const vorjahresverluste = n(f.vorjahresverluste) ?? n(f.verlustvortrag_abzug) ?? 0;
  let betrag = null; let quelle = '';
  if (rest != null) { betrag = rest; quelle = `Erklärung ${vj.steuerjahr}: verrechenbarer Restverlust`; }
  else if (reingewinn != null) {
    const z7 = reingewinn - vorjahresverluste;
    if (z7 < 0) { betrag = -z7; quelle = `Erklärung ${vj.steuerjahr}: Reingewinn ${reingewinn} abzüglich Vorjahresverluste ${vorjahresverluste}`; }
    else if (vorjahresverluste > reingewinn) { betrag = vorjahresverluste - Math.max(reingewinn, 0); quelle = `Erklärung ${vj.steuerjahr}: nicht verrechneter Rest`; }
  }
  if (betrag == null || betrag <= 0) return null;
  const jahre = fruehere.filter((r) => (n(r.felder?.reingewinn_buch) ?? 0) < 0).map((r) => ({ jahr: r.steuerjahr, betrag: -(n(r.felder?.reingewinn_buch) ?? 0) }));
  return { betrag: round2(betrag), jahre: jahre.length ? jahre : undefined, quelle };
}
