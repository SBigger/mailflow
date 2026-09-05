/**
 * Steuer-Kennzahlen aus einem Smartis-Abschluss (Tabellen abschluss / abschluss_konten).
 *
 * Reine Ableitungslogik ohne Datenbankzugriff, damit sie testbar bleibt.
 *
 * Vorzeichen-Konvention der Fibu-Exporte (Abacus, Topal, ...): Aktiven und
 * Aufwand positiv, Passiven und Ertrag negativ (Haben = Minus). Manche Exporte
 * liefern alles positiv – darum wird die Konvention pro Abschluss erkannt und
 * nicht vorausgesetzt.
 *
 * Die Zuordnung der Eigenkapital-Konten laeuft ueber die Kontobezeichnung, weil
 * die Kontonummern je Kontenplan stark abweichen (Abacus 2900 = gesetzliche
 * Reserven, KMU-Kontenrahmen 2900 = gesetzliche Kapitalreserve). Die
 * Kontonummer nach KMU-Kontenrahmen und die Smartis-Position (position_id)
 * dienen nur als Rueckfallebene.
 */

export interface Konto {
  kontonummer: string;
  kontoname: string;
  saldo_ist: number | string | null;
  saldo_vorjahr: number | string | null;
  position_id: string | null;
}

export type EkKlasse =
  | "aktienkapital"
  | "gesetzl_kapitalreserve"
  | "kapitaleinlagereserve"
  | "gesetzl_gewinnreserve"
  | "freiwillige_reserve"
  | "uebrige_reserve"
  | "versteuerte_stille_reserven"
  | "eigene_kapitalanteile"
  | "gewinnvortrag"
  | "jahresergebnis_konto"
  | "unbekannt";

export interface EkKonto {
  kontonummer: string;
  kontoname: string;
  klasse: EkKlasse;
  ist: number;
  vorjahr: number | null;
  quelle: "name" | "nummer" | "position";
}

export interface Gewinnverwendung {
  dividende?: number;
  tantiemen?: number;
  zuweisung_gesetzl_gewinnreserve?: number;
  zuweisung_freiwillige_reserve?: number;
  uebrige?: { bezeichnung: string; betrag: number }[];
}

export interface Kennzahlen {
  jahr: number;
  vorzeichen: { passiven_negativ: boolean; ertrag_negativ: boolean };
  bilanzsumme: number;
  bilanzsumme_vorjahr: number | null;
  /** Reingewinn (+) / Verlust (-) laut Erfolgsrechnung */
  jahresergebnis: number;
  jahresergebnis_vorjahr: number | null;
  jahresergebnis_herkunft: "bilanzdifferenz" | "erfolgsrechnung" | "konto";
  jahresergebnis_er: number;
  /** Gewinn-/Verlustvortrag VOR Gewinnverwendung (Bilanzstand) */
  gewinnvortrag: number;
  gewinnvortrag_vorjahr: number | null;
  bilanzgewinn: number;
  aktienkapital: number;
  gesetzl_kapitalreserve: number;
  kapitaleinlagereserve: number;
  gesetzl_gewinnreserve: number;
  freiwillige_reserve: number;
  uebrige_reserve: number;
  versteuerte_stille_reserven: number;
  eigene_kapitalanteile: number;
  eigenkapital_total: number;
  ek_konten: EkKonto[];
  gewinnverwendung: Required<Omit<Gewinnverwendung, "uebrige">> & {
    uebrige: { bezeichnung: string; betrag: number }[];
    total: number;
    vortrag_neu: number;
  };
  /** Eigenkapital NACH Gewinnverwendung (fuer Kapitalsteuer) */
  ek_nach_verwendung: {
    aktienkapital: number;
    gesetzl_kapitalreserve: number;
    gesetzl_gewinnreserve: number;
    freiwillige_reserve: number;
    uebrige_reserve: number;
    versteuerte_stille_reserven: number;
    eigene_kapitalanteile: number;
    gewinnvortrag: number;
    total: number;
  };
  gesetzliche_reserve: {
    /** 5 % des Jahresgewinns (OR 672 Abs. 1) */
    fuenf_prozent: number;
    /** Ziel 50 % des Kapitals (OR 672 Abs. 2) */
    ziel: number;
    bestand: number;
    empfohlene_zuweisung: number;
    hinweis: string;
  };
  warnungen: string[];
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number): number => Math.round(n * 100) / 100;

const NR = (k: Konto): number => parseInt(String(k.kontonummer).replace(/\D/g, "").slice(0, 4), 10) || 0;

/** Eigenkapital-Klasse anhand des Kontonamens. */
export function klasseNachName(name: string): EkKlasse | null {
  const n = name.toLowerCase().replace(/[-_/]/g, " ").replace(/\s+/g, " ");
  if (/eigene (aktien|kapitalanteile|anteile|stammanteile)/.test(n)) return "eigene_kapitalanteile";
  if (/stille reserve|als gewinn versteuert/.test(n)) return "versteuerte_stille_reserven";
  if (/jahresgewinn|jahresverlust|jahresergebnis|jahreserfolg|reingewinn|gewinn laufend|ergebnis laufend|unternehmensergebnis/.test(n))
    return "jahresergebnis_konto";
  if (/gewinnvortrag|verlustvortrag|bilanzgewinn|bilanzverlust|\bvortrag\b/.test(n)) return "gewinnvortrag";
  if (/kapitaleinlage|\bker\b|agio|aufgeld/.test(n)) return "kapitaleinlagereserve";
  if (/kapitalreserve/.test(n)) return "gesetzl_kapitalreserve";
  if (/aktienkapital|stammkapital|grundkapital|gesellschaftskapital|genossenschaftskapital|partizipationskapital|anteilscheinkapital/.test(n))
    return "aktienkapital";
  if (/frei(e|willig)\w* (gewinn)?reserve|statutarisch|spezialreserve|reservefonds|übrige reserve|uebrige reserve|andere reserve|dispositions/.test(n))
    return "freiwillige_reserve";
  if (/aufwertungsreserve|reserve für eigene|reserve fuer eigene/.test(n)) return "uebrige_reserve";
  if (/gesetzl\w* (gewinn)?reserve|allgemeine reserve|allg\. reserve|gewinnreserve/.test(n)) return "gesetzl_gewinnreserve";
  if (/\breserve/.test(n)) return "uebrige_reserve";
  return null;
}

/** Rueckfall: Kontonummer nach Schweizer KMU-Kontenrahmen. */
export function klasseNachNummer(nr: number): EkKlasse | null {
  if (nr >= 2800 && nr <= 2899) return "aktienkapital";
  if (nr >= 2900 && nr <= 2929) return "gesetzl_kapitalreserve";
  if (nr >= 2930 && nr <= 2949) return "uebrige_reserve";
  if (nr >= 2950 && nr <= 2959) return "gesetzl_gewinnreserve";
  if (nr >= 2960 && nr <= 2969) return "freiwillige_reserve";
  if (nr >= 2970 && nr <= 2978) return "gewinnvortrag";
  if (nr === 2979) return "jahresergebnis_konto";
  if (nr >= 2980 && nr <= 2989) return "eigene_kapitalanteile";
  if (nr >= 2990 && nr <= 2999) return "gewinnvortrag";
  return null;
}

const POSITION_ZU_KLASSE: Record<string, EkKlasse> = {
  EK_KAPITAL: "aktienkapital",
  EK_KAP_RESERVE: "gesetzl_kapitalreserve",
  EK_GES_RESERVE: "gesetzl_gewinnreserve",
  EK_FREIE_RESERVE: "freiwillige_reserve",
  EK_RESERVEN: "uebrige_reserve",
  EK_VORTRAG: "gewinnvortrag",
  EK_JAHRESERGEBNIS: "jahresergebnis_konto",
};

function istEigenkapital(k: Konto): boolean {
  const nr = NR(k);
  if (nr >= 2800 && nr <= 2999) return true;
  if ((k.position_id ?? "").startsWith("EK_")) return true;
  return false;
}

export function berechneKennzahlen(
  konten: Konto[],
  jahr: number,
  gv: Gewinnverwendung = {},
): Kennzahlen {
  const warnungen: string[] = [];
  const bilanz = konten.filter((k) => NR(k) >= 1000 && NR(k) <= 2999);
  const aktiven = bilanz.filter((k) => NR(k) < 2000);
  const passiven = bilanz.filter((k) => NR(k) >= 2000);
  const er = konten.filter((k) => NR(k) >= 3000 && NR(k) <= 8999);
  // Konten 9xxx (Abschlusskonten) werden bewusst ignoriert.

  const sum = (arr: Konto[], feld: "saldo_ist" | "saldo_vorjahr") =>
    arr.reduce((s, k) => s + num(k[feld]), 0);

  const aktivenIst = sum(aktiven, "saldo_ist");
  const passivenIst = sum(passiven, "saldo_ist");
  const passivenNegativ = passivenIst < 0 || (passivenIst === 0 && aktivenIst >= 0);
  const pSign = passivenNegativ ? -1 : 1; // multipliziert Passiv-Saldi zu positiven Betraegen

  const ertragIst = sum(er.filter((k) => NR(k) < 4000 || (NR(k) >= 7000 && NR(k) < 7100) || (NR(k) >= 7500 && NR(k) < 8100) || (NR(k) >= 8500 && NR(k) < 8600)), "saldo_ist");
  const ertragNegativ = ertragIst < 0 || (ertragIst === 0 && passivenNegativ);
  const eSign = ertragNegativ ? -1 : 1; // multipliziert ER-Summe zu Gewinn(+)/Verlust(-)

  const erSummeIst = sum(er, "saldo_ist");
  const jahresergebnisEr = round2(erSummeIst * eSign);
  const erSummeVj = er.some((k) => k.saldo_vorjahr != null) ? round2(sum(er, "saldo_vorjahr") * eSign) : null;

  // Eigenkapital-Konten klassifizieren
  const ekKonten: EkKonto[] = [];
  for (const k of bilanz.filter(istEigenkapital)) {
    let klasse: EkKlasse | null = klasseNachName(k.kontoname ?? "");
    let quelle: EkKonto["quelle"] = "name";
    if (!klasse) { klasse = klasseNachNummer(NR(k)); quelle = "nummer"; }
    if (!klasse && k.position_id && POSITION_ZU_KLASSE[k.position_id]) { klasse = POSITION_ZU_KLASSE[k.position_id]; quelle = "position"; }
    if (!klasse) { klasse = "unbekannt"; warnungen.push(`Konto ${k.kontonummer} "${k.kontoname}" konnte keiner Eigenkapital-Klasse zugeordnet werden.`); }
    ekKonten.push({
      kontonummer: k.kontonummer,
      kontoname: k.kontoname,
      klasse,
      ist: round2(num(k.saldo_ist) * pSign),
      vorjahr: k.saldo_vorjahr == null ? null : round2(num(k.saldo_vorjahr) * pSign),
      quelle,
    });
  }
  const ek = (klasse: EkKlasse, feld: "ist" | "vorjahr" = "ist") =>
    round2(ekKonten.filter((e) => e.klasse === klasse).reduce((s, e) => s + (e[feld] ?? 0), 0));

  // Jahresergebnis: Bilanzdifferenz (Aktiven − Passiven) ist die verlaesslichste Quelle,
  // sofern das Ergebnis noch nicht auf ein Bilanzkonto gebucht wurde.
  const bilanzDiff = round2(aktivenIst + passivenIst * (passivenNegativ ? 1 : -1)); // = Aktiven − |Passiven|
  const ergebnisKonto = ek("jahresergebnis_konto");
  let jahresergebnis: number;
  let herkunft: Kennzahlen["jahresergebnis_herkunft"];
  if (Math.abs(bilanzDiff) > 0.05) {
    jahresergebnis = bilanzDiff;
    herkunft = "bilanzdifferenz";
    if (ergebnisKonto !== 0) warnungen.push(`Bilanz weist eine Differenz von ${bilanzDiff} auf UND es gibt ein Jahresergebnis-Konto (${ergebnisKonto}). Ergebnis bitte pruefen.`);
    if (Math.abs(bilanzDiff - jahresergebnisEr) > 0.05) warnungen.push(`Bilanzdifferenz (${bilanzDiff}) und Erfolgsrechnung (${jahresergebnisEr}) stimmen nicht ueberein.`);
  } else if (ergebnisKonto !== 0) {
    jahresergebnis = ergebnisKonto;
    herkunft = "konto";
    if (Math.abs(ergebnisKonto - jahresergebnisEr) > 0.05 && er.length > 0) warnungen.push(`Jahresergebnis-Konto (${ergebnisKonto}) und Erfolgsrechnung (${jahresergebnisEr}) stimmen nicht ueberein.`);
  } else {
    jahresergebnis = jahresergebnisEr;
    herkunft = "erfolgsrechnung";
    if (er.length === 0) warnungen.push("Keine Erfolgsrechnungs-Konten vorhanden – Jahresergebnis ist 0.");
  }

  const bilanzsummeVj = aktiven.some((k) => k.saldo_vorjahr != null) ? round2(sum(aktiven, "saldo_vorjahr")) : null;
  let jahresergebnisVj: number | null = null;
  if (bilanzsummeVj != null) {
    const passVj = sum(passiven, "saldo_vorjahr");
    const diffVj = round2(bilanzsummeVj + passVj * (passivenNegativ ? 1 : -1));
    jahresergebnisVj = Math.abs(diffVj) > 0.05 ? diffVj : (ek("jahresergebnis_konto", "vorjahr") || erSummeVj);
  }

  const gewinnvortrag = ek("gewinnvortrag");
  const bilanzgewinn = round2(gewinnvortrag + jahresergebnis);

  // Gewinnverwendung
  const uebrige = (gv.uebrige ?? []).map((u) => ({ bezeichnung: u.bezeichnung, betrag: round2(num(u.betrag)) }));
  const gvVoll = {
    dividende: round2(num(gv.dividende)),
    tantiemen: round2(num(gv.tantiemen)),
    zuweisung_gesetzl_gewinnreserve: round2(num(gv.zuweisung_gesetzl_gewinnreserve)),
    zuweisung_freiwillige_reserve: round2(num(gv.zuweisung_freiwillige_reserve)),
    uebrige,
    total: 0,
    vortrag_neu: 0,
  };
  gvVoll.total = round2(
    gvVoll.dividende + gvVoll.tantiemen + gvVoll.zuweisung_gesetzl_gewinnreserve +
    gvVoll.zuweisung_freiwillige_reserve + uebrige.reduce((s, u) => s + u.betrag, 0),
  );
  gvVoll.vortrag_neu = round2(bilanzgewinn - gvVoll.total);
  if (gvVoll.total > bilanzgewinn + 0.005 && bilanzgewinn >= 0) warnungen.push(`Gewinnverwendung (${gvVoll.total}) uebersteigt den Bilanzgewinn (${bilanzgewinn}).`);
  if (bilanzgewinn < 0 && gvVoll.dividende > 0) warnungen.push("Dividende trotz Bilanzverlust – handelsrechtlich nicht zulaessig.");

  const aktienkapital = ek("aktienkapital");
  const gesKap = ek("gesetzl_kapitalreserve");
  const ker = ek("kapitaleinlagereserve");
  const gesGew = ek("gesetzl_gewinnreserve");
  const frei = ek("freiwillige_reserve");
  const uebr = ek("uebrige_reserve");
  const stille = ek("versteuerte_stille_reserven");
  const eigene = ek("eigene_kapitalanteile");
  const ekTotal = round2(aktienkapital + gesKap + ker + gesGew + frei + uebr + stille + eigene + gewinnvortrag + jahresergebnis);

  // Gesetzliche Gewinnreserve (OR 672): 5 % des Jahresgewinns, bis gesetzl. Gewinn- und Kapitalreserve 50 % des Kapitals erreichen
  const fuenf = jahresergebnis > 0 ? round2(jahresergebnis * 0.05) : 0;
  const ziel = round2(aktienkapital * 0.5);
  const bestand = round2(gesGew + gesKap + ker);
  const luecke = Math.max(0, round2(ziel - bestand));
  const empfohlen = Math.min(fuenf, luecke);
  const hinweis = jahresergebnis <= 0
    ? "Kein Gewinn – keine Zuweisung an die gesetzliche Gewinnreserve noetig."
    : luecke === 0
      ? "Gesetzliche Reserven haben 50 % des Kapitals erreicht – keine Pflichtzuweisung (OR 672 Abs. 2)."
      : `Pflichtzuweisung 5 % des Jahresgewinns = ${fuenf}, begrenzt durch Luecke zum 50-%-Ziel (${luecke}).`;

  const ekNach = {
    aktienkapital,
    gesetzl_kapitalreserve: round2(gesKap + ker),
    gesetzl_gewinnreserve: round2(gesGew + gvVoll.zuweisung_gesetzl_gewinnreserve),
    freiwillige_reserve: round2(frei + gvVoll.zuweisung_freiwillige_reserve),
    uebrige_reserve: uebr,
    versteuerte_stille_reserven: stille,
    eigene_kapitalanteile: eigene,
    gewinnvortrag: gvVoll.vortrag_neu,
    total: 0,
  };
  ekNach.total = round2(
    ekNach.aktienkapital + ekNach.gesetzl_kapitalreserve + ekNach.gesetzl_gewinnreserve +
    ekNach.freiwillige_reserve + ekNach.uebrige_reserve + ekNach.versteuerte_stille_reserven +
    ekNach.eigene_kapitalanteile + ekNach.gewinnvortrag,
  );

  if (aktienkapital === 0) warnungen.push("Kein Aktien-/Stammkapital-Konto gefunden.");
  if (aktiven.length === 0) warnungen.push("Keine Aktiv-Konten gefunden – Bilanzsumme ist 0.");

  return {
    jahr,
    vorzeichen: { passiven_negativ: passivenNegativ, ertrag_negativ: ertragNegativ },
    bilanzsumme: round2(aktivenIst),
    bilanzsumme_vorjahr: bilanzsummeVj,
    jahresergebnis,
    jahresergebnis_vorjahr: jahresergebnisVj,
    jahresergebnis_herkunft: herkunft,
    jahresergebnis_er: jahresergebnisEr,
    gewinnvortrag,
    gewinnvortrag_vorjahr: ekKonten.some((e) => e.klasse === "gewinnvortrag" && e.vorjahr != null) ? ek("gewinnvortrag", "vorjahr") : null,
    bilanzgewinn,
    aktienkapital,
    gesetzl_kapitalreserve: gesKap,
    kapitaleinlagereserve: ker,
    gesetzl_gewinnreserve: gesGew,
    freiwillige_reserve: frei,
    uebrige_reserve: uebr,
    versteuerte_stille_reserven: stille,
    eigene_kapitalanteile: eigene,
    eigenkapital_total: ekTotal,
    ek_konten: ekKonten,
    gewinnverwendung: gvVoll,
    ek_nach_verwendung: ekNach,
    gesetzliche_reserve: { fuenf_prozent: fuenf, ziel, bestand, empfohlene_zuweisung: empfohlen, hinweis },
    warnungen,
  };
}

/** Bilanz-/ER-Summen je Smartis-Position (fuer E-Bilanz und Berichte), Betraege in Kontonatur positiv. */
export function summenNachPosition(konten: Konto[], vorzeichen: Kennzahlen["vorzeichen"]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of konten) {
    const nr = NR(k);
    const pos = k.position_id ?? (nr < 2000 ? "AKTIVEN_OHNE_POSITION" : nr < 3000 ? "PASSIVEN_OHNE_POSITION" : "ER_OHNE_POSITION");
    let v = num(k.saldo_ist);
    if (nr >= 2000 && nr < 3000 && vorzeichen.passiven_negativ) v = -v;
    if (nr >= 3000 && nr < 9000 && vorzeichen.ertrag_negativ) v = -v; // Ertrag positiv, Aufwand negativ
    out[pos] = round2((out[pos] ?? 0) + v);
  }
  return out;
}

export { NR as kontonummerAlsZahl, num as alsZahl, round2 };
