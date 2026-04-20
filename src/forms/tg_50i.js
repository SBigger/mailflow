// TG Form 50/I – AcroForm
// Feldnamen via pdf-lib aus PDF extrahiert (193 Felder)
// Spalte 0 = Kanton/Gemeinde, Spalte 1 = Direkte Bundessteuer

export const FAVORITEN_IDS = new Set([
  'firma_name', 'gj_von', 'gj_bis', 'vertreter_artis',
  'reingewinn_buch',
  'steuerbarer_gewinn_kt',
  'eigenkapital_total', 'steuerbares_kapital', 'kapital_tg',
  'bilanz_vortrag_vorjahr', 'bilanz_reingewinn_er', 'bilanz_zu_verteilend',
  'bilanz_dividende', 'bilanz_tantiemen',
  'bilanz_gesetzl_gewinnres', 'bilanz_freiw_gewinnres',
  'bilanz_kapitaleinlagen', 'bilanz_vortrag_neu', 'bilanz_total',
]);

export const TG_50I = {
  kanton: 'TG',
  name: 'Kanton Thurgau – Form 50/I',
  pdfUrl: '/pdf-tg/public/upload/assets/171676/JPW24_50_I_Steuererklaerung_primaer_fx_v01.pdf',
  typ: 'acroform',
  mirrorKantonToBund: true,   // leeres .calc.1 (Bund) übernimmt automatisch .calc.0 (Kanton)
  hideBottomButtons: 35,      // weisses Rechteck über Drucken/Schliessen/Zurück/Weiter
  sections: [
    {
      id: 'stammdaten',
      titel: 'Unternehmensangaben',
      felder: [
        { id: 'firma_name',      label: 'Firmenbezeichnung',                typ: 'text',   pflicht: true,  acroField: 'allg.firma' },
        { id: 'hauptsitz',       label: 'Hauptsitz (Strasse / Nr.)',         typ: 'text',   pflicht: false, acroField: 'allg.hauptsitz' },
        { id: 'hauptsitz_plz',   label: 'PLZ',                               typ: 'text',   pflicht: false },
        { id: 'hauptsitz_ort',   label: 'Ort',                               typ: 'text',   pflicht: false },
        { id: 'niederlassungen', label: 'Betriebsstätten / Niederlassungen', typ: 'text',   pflicht: false, acroField: 'allg.niederlassungen' },
        { id: 'hr_nummer',       label: 'Handelsregisternummer',             typ: 'text',   pflicht: false, acroField: 'allg.handelsregister' },
        { id: 'gruendungsdatum', label: 'Gründungsdatum',                    typ: 'datum',  pflicht: false, acroField: 'allg.gruendung' },
        { id: 'gj_von',          label: 'Geschäftsjahr von',                 typ: 'datum',  pflicht: false, acroField: 'allg.dauer.beginn' },
        { id: 'gj_bis',          label: 'Geschäftsjahr bis',                 typ: 'datum',  pflicht: false, acroField: 'allg.dauer.ende' },
        { id: 'vertreter',       label: 'Vertreter / Bevollmächtigter',      typ: 'text',   pflicht: false, acroField: 'allg.vertreter.adresse' },
        { id: 'vertreter_artis', label: 'Vertretung durch Artis Treuhand GmbH', typ: 'checkbox', pflicht: false },
        { id: 'bemerkungen',     label: 'Bemerkungen',                       typ: 'textarea',pflicht: false, acroField: 'allg.bemerkungen' },
      ],
    },
    {
      id: 'gewinnsteuer',
      titel: 'Gewinnsteuer',
      felder: [
        { id: 'reingewinn_buch',        label: 'Reingewinn lt. Buchhaltung (Kanton)',        typ: 'betrag', pflicht: false, acroField: 'gew.01.calc.0' },
        { id: 'reingewinn_buch_dbs',    label: 'Reingewinn lt. Buchhaltung (Bund)',           typ: 'betrag', pflicht: false, acroField: 'gew.01.calc.1' },
        { id: 'aufr_nichtabzugsfaehig', label: 'Aufrechnungen: nicht abzugsfähige Aufw.',    typ: 'betrag', pflicht: false, acroField: 'gew.02-1-1.calc.0' },
        { id: 'aufr_geldwerte_leist',   label: 'Aufrechnungen: geldwerte Leistungen',        typ: 'betrag', pflicht: false, acroField: 'gew.02-1-2.calc.0' },
        { id: 'aufr_sonstige',          label: 'Aufrechnungen: sonstige',                    typ: 'betrag', pflicht: false, acroField: 'gew.02-1-3.calc.0' },
        { id: 'abzug_beteiligungen',    label: 'Abzüge: Beteiligungsabzug',                 typ: 'betrag', pflicht: false, acroField: 'gew.04-1.calc.0' },
        { id: 'abzug_sonstige',         label: 'Abzüge: sonstige',                           typ: 'betrag', pflicht: false, acroField: 'gew.04-2.calc.0' },
        { id: 'verlustvortrag_abzug',   label: 'Verlustverrechnung (Vorjahre)',               typ: 'betrag', pflicht: false, acroField: 'gew.07.calc.0' },
        { id: 'steuerbarer_gewinn_kt',  label: 'Steuerbarer Reingewinn',                    typ: 'betrag', pflicht: false, acroField: 'gew.08-1.calc.0' },
      ],
    },
    {
      id: 'kapitalsteuer',
      titel: 'Kapitalsteuer',
      felder: [
        { id: 'einbezahltes_kapital', label: 'Einbezahltes Aktien-/Stammkapital', typ: 'betrag', pflicht: false, acroField: 'kap.13.calc.0' },
        { id: 'kap_reserven',         label: 'Gesetzliche Reserven',               typ: 'betrag', pflicht: false, acroField: 'kap.14-1.calc.0' },
        { id: 'gesetzl_gewinnres',    label: 'Statutarische Reserven',             typ: 'betrag', pflicht: false, acroField: 'kap.14-2.calc.0' },
        { id: 'freie_reserven',       label: 'Freie Reserven',                     typ: 'betrag', pflicht: false, acroField: 'kap.14-3.calc.0' },
        { id: 'gewinnvortrag',        label: 'Gewinnvortrag / Jahresergebnis',     typ: 'betrag', pflicht: false, acroField: 'kap.14-4.calc.0' },
        { id: 'eigenkapital_total',   label: 'Eigenkapital total (Ziffer 16)',     typ: 'betrag', pflicht: false, acroField: 'kap.16.calc.0' },
        { id: 'steuerbares_kapital',  label: 'Steuerbares Kapital (Ziffer 18)',    typ: 'betrag', pflicht: false, acroField: 'kap.18.calc.0' },
        { id: 'kapital_tg',           label: 'Im Kanton TG steuerbares Kapital (Ziffer 20)', typ: 'betrag', pflicht: false, acroField: 'kap.20.calc.0' },
      ],
    },
    {
      id: 'bilanzgewinn',
      titel: 'Verwendung des Bilanzgewinnes (Ziffer 12)',
      felder: [
        { id: 'bilanz_vortrag_vorjahr',    label: '12.1 Vortrag aus dem Vorjahr',                                    typ: 'betrag', pflicht: false, acroField: 'ver.calc.field.0' },
        { id: 'bilanz_reingewinn_er',      label: '12.2 Reingewinn/-verlust gemäss Erfolgsrechnung',                  typ: 'betrag', pflicht: false, acroField: 'ver.calc.field.1' },
        { id: 'bilanz_zu_verteilend',      label: '12.3 Zu verteilender Bilanzgewinn/-verlust',                        typ: 'betrag', pflicht: false, acroField: 'ver.calc.field.2' },
        { id: 'bilanz_dividende',          label: '12.5 Dividende, Gewinnanteile (brutto)',                            typ: 'betrag', pflicht: false, acroField: 'ver.calc.field.3' },
        { id: 'bilanz_tantiemen',          label: '12.6 Tantiemen',                                                    typ: 'betrag', pflicht: false, acroField: 'ver.calc.field.4' },
        { id: 'bilanz_gesetzl_gewinnres',  label: '12.7 Zuweisung an gesetzliche Gewinnreserve',                       typ: 'betrag', pflicht: false, acroField: 'ver.calc.field.5' },
        { id: 'bilanz_freiw_gewinnres',    label: '12.8 Zuweisung an freiwillige Gewinnreserve',                       typ: 'betrag', pflicht: false, acroField: 'ver.calc.field.6' },
        { id: 'bilanz_frei_9',             label: '12.9 (optional)',                                                   typ: 'betrag', pflicht: false, acroField: 'ver.calc.field.7' },
        { id: 'bilanz_kapitaleinlagen',    label: '12.10 Zuweisung an Reserven aus Kapitaleinlagen',                   typ: 'betrag', pflicht: false, acroField: 'ver.calc.field.8' },
        { id: 'bilanz_vortrag_neu',        label: '12.11 Vortrag auf neue Rechnung',                                   typ: 'betrag', pflicht: false, acroField: 'ver.calc.field.9' },
        { id: 'bilanz_bez_12',             label: '12.12 Bezeichnung',                                                 typ: 'text',   pflicht: false, acroField: 'ver.calc.bezeichnung.0' },
        { id: 'bilanz_frei_12',            label: '12.12 Betrag',                                                      typ: 'betrag', pflicht: false, acroField: 'ver.calc.field.10' },
        { id: 'bilanz_bez_13',             label: '12.13 Bezeichnung',                                                 typ: 'text',   pflicht: false, acroField: 'ver.calc.bezeichnung.1' },
        { id: 'bilanz_frei_13',            label: '12.13 Betrag',                                                      typ: 'betrag', pflicht: false, acroField: 'ver.calc.field.11' },
        { id: 'bilanz_total',              label: '12.14 Total Bilanzgewinn/-verlust (wie Ziffer 12.3)',               typ: 'betrag', pflicht: false, acroField: 'ver.calc.field.12' },
      ],
    },
    {
      id: 'diverses',
      titel: 'Diverses',
      felder: [
        { id: 'beteiligungsabzug_ja',  label: 'Beteiligungsabzug beantragt',       typ: 'checkbox', pflicht: false, acroField: 'beteiligung.check' },
      ],
    },
  ],
  // Vertreter-Block wird in allg.vertreter.adresse reingeschrieben (einzeiliges AcroForm-Feld).
  // Personalien-Box (oben rechts auf Seite 1) wird mehrzeilig aus Firma + Hauptsitz zusammengesetzt.
  preFillHooks: [
    { whenField: 'vertreter_artis', acroField: 'allg.vertreter.adresse', text: 'Artis Treuhand GmbH, Bahnhofstrasse 19, 9320 Arbon · Tel 071 555 22 11 · info@artis-treuhand.ch' },
    { acroField: 'allg.personalien', lines: [
      { fromField: 'firma_name' },
      { fromField: 'hauptsitz' },
      { fromFields: ['hauptsitz_plz', 'hauptsitz_ort'], sep: ' ' },
    ]},
  ],
  // Obere "Hinweis zum Ausfüllen" / "Klicken Sie..." Buttons auf Seite 1 überdecken.
  hideRects: [
    { seite: 1, x: 125, y: 778, w: 295, h: 60 },  // nav.hinweis (Btn) + nav.hinweis_text (Tx)
    { seite: 1, x: 535, y: 808, w: 55, h: 24 },   // calc.actions (Tx, oben rechts neben "2024")
  ],
};
