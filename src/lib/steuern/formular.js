// Kennzahlen → Felder der Steuerformulare (src/forms/zh_500.js, sg_jp1a.js, tg_50i.js).
// Gemeinsame Quelle fuer Tool /Steuern und MCP-Server. Summen, die das Formular
// selbst rechnet (ZH computed), werden nicht gesetzt. Steuerliche Korrekturen
// (Aufrechnungen, Abzuege, Beteiligungsabzug, Ausscheidung) bleiben manuell.

const leerWennNull = (n) => (Math.abs(n) < 0.005 ? '' : Math.round(n * 100) / 100);
const pos = (n) => (n > 0.005 ? Math.round(n * 100) / 100 : '');

function stammfelder(st) {
  return {
    firma_name: st.firma_name,
    hauptsitz: st.strasse ?? '',
    hauptsitz_plz: st.plz ?? '',
    hauptsitz_ort: st.ort ?? '',
    gj_von: st.gj_von,
    gj_bis: st.gj_bis,
    vertreter_artis: st.vertreter_artis ?? true,
  };
}

export function felderZH(k, st, vv) {
  const n = k.ek_nach_verwendung;
  const f = {
    ...stammfelder(st),
    gemeinde: st.gemeinde_zh ?? '',
    register_nr: st.register_nr ?? '',
    reingewinn_buch: leerWennNull(k.jahresergebnis),
    vorjahresverluste: vv ? pos(vv.betrag) : '',
    gv_vortrag_vorjahr: leerWennNull(k.gewinnvortrag),
    gv_reingewinn_er: leerWennNull(k.jahresergebnis),
    gv_dividende: pos(k.gewinnverwendung.dividende),
    gv_dividende_pct: k.aktienkapital > 0 && k.gewinnverwendung.dividende > 0 ? Math.round((k.gewinnverwendung.dividende / k.aktienkapital) * 10000) / 100 : '',
    gv_tantiemen: pos(k.gewinnverwendung.tantiemen),
    gv_gesetzl_gewinnres: pos(k.gewinnverwendung.zuweisung_gesetzl_gewinnreserve),
    gv_freiw_gewinnres: pos(k.gewinnverwendung.zuweisung_freiwillige_reserve),
    ek_stichtag: st.gj_bis,
    ek_kapital: pos(n.aktienkapital),
    ek_gesetzl_kapitalres: pos(n.gesetzl_kapitalreserve),
    ek_gesetzl_gewinnres: pos(n.gesetzl_gewinnreserve),
    ek_freiw_gewinnres: pos(n.freiwillige_reserve),
    ek_eigene_kapitalanteile: pos(Math.abs(n.eigene_kapitalanteile)),
    ek_gewinnvortrag: n.gewinnvortrag > 0 ? pos(n.gewinnvortrag) : '',
    ek_verlustvortrag: n.gewinnvortrag < 0 ? pos(-n.gewinnvortrag) : '',
  };
  if (n.uebrige_reserve > 0.005) { f.ek_bez_135 = 'Übrige Reserven'; f.ek_betrag_135 = pos(n.uebrige_reserve); }
  if (n.versteuerte_stille_reserven > 0.005) { f.ek_bez_141 = 'Als Gewinn versteuerte stille Reserven'; f.ek_betrag_141 = pos(n.versteuerte_stille_reserven); }
  const ueb = k.gewinnverwendung.uebrige;
  if (ueb[0]) { f.gv_bez_10 = ueb[0].bezeichnung; f.gv_betrag_10 = pos(ueb[0].betrag); }
  if (ueb[1]) { f.gv_bez_11 = ueb[1].bezeichnung; f.gv_betrag_11 = pos(ueb[1].betrag); }
  return f;
}

export function felderSG(k, st, vv) {
  // SG JP 1a (Kapitalgesellschaften/Genossenschaften), Codes gemäss Formular 2025.
  const n = k.ek_nach_verwendung;
  const g = k.gewinnverwendung;
  const verlust = vv?.betrag ?? 0;
  const verrechenbar = Math.min(Math.max(k.jahresergebnis, 0), verlust);
  const steuerbar = k.jahresergebnis - verrechenbar;
  // Ziffer 18 = Summe 14–17 = Eigenkapital laut Handelsbilanz: in der Bilanz gebuchte
  // "versteuerte stille Reserven" gehören damit zu 15.4 Übrige; Ziffer 20 bleibt für
  // ausserbilanzielle stille Reserven frei.
  const uebrige = n.uebrige_reserve + n.versteuerte_stille_reserven;
  const ekHandelsbilanz = n.total;
  const f = {
    ...stammfelder(st),
    sitzgemeinde: st.ort ?? '',
    register_nr: st.register_nr ?? '',
    abschluss_vom: st.gj_bis,
    // Reingewinn (Seite 2) – ohne steuerliche Korrekturen; Aufrechnungen/Abzüge bleiben manuell
    reingewinn_buch: leerWennNull(k.jahresergebnis),
    zwischentotal: leerWennNull(k.jahresergebnis),
    reingewinn_vor_entl: leerWennNull(k.jahresergebnis),
    reingewinn_nach_entl: leerWennNull(k.jahresergebnis),
    verlustvortrag_abzug: pos(verrechenbar),
    steuerbarer_gewinn_kt: leerWennNull(steuerbar),
    reingewinn_ch: leerWennNull(steuerbar),
    reingewinn_sg: leerWennNull(steuerbar),
    reingewinn_sg_ord: leerWennNull(steuerbar),
    // Gewinnverwendung (Seite 3, Codes 285–299)
    gv_vortrag_vorjahr: leerWennNull(k.gewinnvortrag),
    gv_reingewinn_er: leerWennNull(k.jahresergebnis),
    gv_bilanzgewinn: leerWennNull(k.bilanzgewinn),
    gv_dividende: pos(g.dividende),
    gv_gesetzl_gewinnres: pos(g.zuweisung_gesetzl_gewinnreserve),
    gv_freiw_gewinnres: pos(g.zuweisung_freiwillige_reserve),
    gv_total: leerWennNull(g.total),
    gv_vortrag_neu: leerWennNull(g.vortrag_neu),
    // Kapital und Reserven (Seite 3, Codes 500–580), Stand nach Gewinnverwendung
    ek_kapital: pos(n.aktienkapital),
    ek_gesetzl_kapitalres: pos(n.gesetzl_kapitalreserve),
    ek_gesetzl_gewinnres: pos(n.gesetzl_gewinnreserve),
    ek_freiw_gewinnres: pos(n.freiwillige_reserve),
    ek_uebrige: pos(uebrige),
    ek_gewinnvortrag: leerWennNull(n.gewinnvortrag),
    ek_eigene_kapitalanteile: pos(Math.abs(n.eigene_kapitalanteile)),
    ek_total_handelsbilanz: leerWennNull(ekHandelsbilanz),
    ek_steuerbar_total: pos(Math.max(ekHandelsbilanz, n.aktienkapital)),
    kapital_ch: pos(Math.max(ekHandelsbilanz, n.aktienkapital)),
    kapital_sg: pos(Math.max(ekHandelsbilanz, n.aktienkapital)),
    // Ergänzende Angaben (Seite 4, Codes 610–613)
    umsatz: leerWennNull(k.umsatz ?? 0),
    materialaufwand: leerWennNull(k.materialaufwand ?? 0),
    personalaufwand: leerWennNull(k.personalaufwand ?? 0),
    bilanzsumme: leerWennNull(k.bilanzsumme),
  };
  if (uebrige > 0.005) {
    f.ek_uebrige_txt = n.versteuerte_stille_reserven > 0.005 && n.uebrige_reserve < 0.005
      ? 'Versteuerte stille Reserven'
      : n.versteuerte_stille_reserven > 0.005 ? 'Übrige Reserven inkl. versteuerte stille Reserven' : 'Übrige Reserven';
  }
  if (g.tantiemen > 0.005) { f.gv_uebrige_txt_1 = 'Tantiemen'; f.gv_uebrige_1 = pos(g.tantiemen); }
  const ueb = g.uebrige;
  if (ueb[0]) { const i = g.tantiemen > 0.005 ? 2 : 1; f[`gv_uebrige_txt_${i}`] = ueb[0].bezeichnung; f[`gv_uebrige_${i}`] = pos(ueb[0].betrag); }
  if (vv?.jahre?.length) {
    vv.jahre.slice(0, 7).forEach((j, i) => { f[`verlust_jahr_${i + 1}`] = String(j.jahr); f[`verlust_betrag_${i + 1}`] = pos(j.betrag); });
    f.verlustvortrag_beginn = pos(verlust);
    f.verlustvortrag_ende = pos(verlust);
  }
  return f;
}

export function felderTG(k, st, vv) {
  const n = k.ek_nach_verwendung;
  const g = k.gewinnverwendung;
  const verlust = vv?.betrag ?? 0;
  const verrechenbar = Math.min(Math.max(k.jahresergebnis, 0), verlust);
  const steuerbar = k.jahresergebnis - verrechenbar;
  const f = {
    ...stammfelder(st),
    hr_nummer: st.uid ?? '',
    reingewinn_buch: leerWennNull(k.jahresergebnis),
    reingewinn_buch_dbs: leerWennNull(k.jahresergebnis),
    verlustvortrag_abzug: pos(verrechenbar),
    steuerbarer_gewinn_kt: leerWennNull(steuerbar),
    einbezahltes_kapital: pos(n.aktienkapital),
    kap_reserven: pos(n.gesetzl_kapitalreserve + n.gesetzl_gewinnreserve),
    gesetzl_gewinnres: pos(n.uebrige_reserve + n.versteuerte_stille_reserven),
    freie_reserven: pos(n.freiwillige_reserve),
    gewinnvortrag: leerWennNull(n.gewinnvortrag),
    eigenkapital_total: leerWennNull(n.total),
    steuerbares_kapital: pos(Math.max(n.total, n.aktienkapital)),
    kapital_tg: pos(Math.max(n.total, n.aktienkapital)),
    bilanz_vortrag_vorjahr: leerWennNull(k.gewinnvortrag),
    bilanz_reingewinn_er: leerWennNull(k.jahresergebnis),
    bilanz_zu_verteilend: leerWennNull(k.bilanzgewinn),
    bilanz_dividende: pos(g.dividende),
    bilanz_tantiemen: pos(g.tantiemen),
    bilanz_gesetzl_gewinnres: pos(g.zuweisung_gesetzl_gewinnreserve),
    bilanz_freiw_gewinnres: pos(g.zuweisung_freiwillige_reserve),
    bilanz_vortrag_neu: leerWennNull(g.vortrag_neu),
    bilanz_total: leerWennNull(k.bilanzgewinn),
  };
  if (g.uebrige[0]) { f.bilanz_bez_12 = g.uebrige[0].bezeichnung; f.bilanz_frei_12 = pos(g.uebrige[0].betrag); }
  if (g.uebrige[1]) { f.bilanz_bez_13 = g.uebrige[1].bezeichnung; f.bilanz_frei_13 = pos(g.uebrige[1].betrag); }
  return f;
}

export const KANTONE_MIT_AUTOFILL = ['ZH', 'SG', 'TG'];

export function felderFuerKanton(kanton, k, st, vv) {
  switch (kanton) {
    case 'ZH': return felderZH(k, st, vv);
    case 'SG': return felderSG(k, st, vv);
    case 'TG': return felderTG(k, st, vv);
    default: return null;
  }
}

/** Vorschlag mit bestehenden Feldern zusammenfuehren; Handeingaben bleiben, ausser ueberschreiben=true. */
export function zusammenfuehren(bestehend, vorschlag, ueberschreiben) {
  const felder = { ...bestehend };
  const neu = []; const geaendert = []; const konflikte = [];
  for (const [id, wert] of Object.entries(vorschlag)) {
    if (wert === '' || wert == null) continue;
    const alt = bestehend[id];
    const altLeer = alt == null || alt === '' || alt === false;
    if (altLeer) { felder[id] = wert; neu.push(id); continue; }
    if (String(alt) === String(wert)) continue;
    if (ueberschreiben) { felder[id] = wert; geaendert.push(id); }
    else konflikte.push({ feld: id, bestehend: alt, vorschlag: wert });
  }
  return { felder, neu, geaendert, konflikte };
}
