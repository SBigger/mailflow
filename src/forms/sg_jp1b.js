// SG JP 1B – Steuererklärung Vereine/Stiftungen, Kanton St. Gallen
// Quell-PDF: 2 A3-Landscape-Booklet-Seiten (1190.55 × 841.89 pt).
// Wird im Renderer per bookletLayout in 4 echte A4-Seiten gesplittet.
//
// Booklet-Mapping (vermessen via pdfjs-dist):
//   Form-Seite 1 = PDF-Seite 0, RECHTE Hälfte (Stammdaten)
//   Form-Seite 2 = PDF-Seite 1, LINKE  Hälfte (Reingewinn)
//   Form-Seite 3 = PDF-Seite 1, RECHTE Hälfte (Kapital & Reserven)
//   Form-Seite 4 = PDF-Seite 0, LINKE  Hälfte (Verlustverrechnung & Beilagen)
//
// Overlay-Koordinaten sind A4-LOKAL (0..595 × 0..842) auf der jeweiligen
// Form-Seite. Für rechte Hälften wurde halfW (≈595) bereits abgezogen.
// Spalten Seite 2 (Reingewinn): Kanton CHF ≈ x 445 · Bund CHF ≈ x 520
//                               → ein Eingabefeld, alsoAt spiegelt in Bund-Spalte
// Spalte  Seite 3 (Kapital):    CHF ≈ x 525 (eine Spalte)

export const FAVORITEN_IDS = new Set([
  // Stammdaten
  'firma_name', 'hauptsitz', 'sitzgemeinde', 'gj_von', 'gj_bis', 'vertreter_artis',
  // Reingewinn
  'reingewinn_buch', 'aufr_total', 'abzug_total', 'verlustvortrag_abzug',
  'steuerbarer_gewinn_kt', 'reingewinn_ch', 'reingewinn_sg',
  'reingewinn_sg_ord', 'reingewinn_sg_sonder',
  // Kapital
  'einbezahltes_kapital', 'gesetzl_gewinnres', 'freie_reserven',
  'kap_reserven', 'eigenkapital_total', 'steuerbares_kapital',
  'kapital_ch', 'kapital_sg',
  // Verlustverrechnung (Seite 4)
  'verlust_jahr_1', 'verlust_betrag_1',
  'verlust_jahr_2', 'verlust_betrag_2',
  'verlust_jahr_3', 'verlust_betrag_3',
  'verlust_jahr_4', 'verlust_betrag_4',
  'verlust_jahr_5', 'verlust_betrag_5',
  'verlust_jahr_6', 'verlust_betrag_6',
  'verlust_jahr_7', 'verlust_betrag_7',
  'verlustvortrag_beginn', 'verlust_laufendes_j', 'verlustvortrag_ende',
]);

export const SG_JP1B = {
  kanton: 'SG',
  name: 'Kanton St. Gallen – JP 1b (2025)',
  pdfUrl: '/sg/JP_1b_2025.pdf',
  typ: 'static',
  bookletLayout: [
    { srcPage: 0, half: 'right' }, // Form-Seite 1
    { srcPage: 1, half: 'left'  }, // Form-Seite 2
    { srcPage: 1, half: 'right' }, // Form-Seite 3
    { srcPage: 0, half: 'left'  }, // Form-Seite 4
  ],
  sections: [
    {
      id: 'stammdaten',
      titel: 'Stammdaten (Seite 1)',
      felder: [
        // y-Werte aus PDF-Linien extrahiert. Inputs starten rechts des Labels (x≈198).
        { id: 'firma_name',      label: 'Firmenbezeichnung (Name)',          typ: 'text',  pflicht: true,  overlay: { formSeite: 1, x: 198, y: 516.5, groesse: 10 } },
        { id: 'hauptsitz',       label: 'Adresse / Strasse',                 typ: 'text',  pflicht: false, overlay: { formSeite: 1, x: 198, y: 480.4, groesse: 10 } },
        { id: 'hauptsitz_plz',   label: 'PLZ',                               typ: 'text',  pflicht: false, overlay: { formSeite: 1, x: 198, y: 464.4, groesse: 10 } },
        { id: 'hauptsitz_ort',   label: 'Ort',                               typ: 'text',  pflicht: false, overlay: { formSeite: 1, x: 240, y: 464.4, groesse: 10 } },
        { id: 'sitzgemeinde',    label: 'Sitzgemeinde',                      typ: 'text',  pflicht: false },
        { id: 'register_nr',     label: 'Register-Nr.',                      typ: 'text',  pflicht: false, overlay: { formSeite: 1, x: 415, y: 574, groesse: 9  } },
        { id: 'abschluss_vom',   label: 'Abschluss vom',                     typ: 'datum', pflicht: false, overlay: { formSeite: 1, x: 415, y: 587, groesse: 9  } },
        { id: 'gj_von',          label: 'Geschäftsjahr Beginn',              typ: 'datum', pflicht: false, overlay: { formSeite: 1, x: 248, y: 405.4, groesse: 9  } },
        { id: 'gj_bis',          label: 'Geschäftsjahr Ende',                typ: 'datum', pflicht: false, overlay: { formSeite: 1, x: 386, y: 405.4, groesse: 9  } },
        { id: 'iban',            label: 'IBAN',                              typ: 'text',  pflicht: false, overlay: { formSeite: 1, x:  65, y: 220, groesse: 9  } },
        { id: 'bank',            label: 'Bank / Institut, Ort',              typ: 'text',  pflicht: false, overlay: { formSeite: 1, x: 120, y: 204, groesse: 9  } },
        { id: 'kontoinhaber',    label: 'Kontoinhaber, Adresse, PLZ, Ort',   typ: 'text',  pflicht: false, overlay: { formSeite: 1, x: 175, y: 188, groesse: 9  } },
        // Vertretung Artis: wenn aktiv, werden Ansprechperson + Telefon + eMail unten automatisch ausgefüllt.
        { id: 'vertreter_artis', label: 'Vertretung durch Artis Treuhand GmbH', typ: 'checkbox', pflicht: false },
      ],
    },
    {
      id: 'gewinnsteuer',
      titel: 'Reingewinn (Seite 2)',
      felder: [
        // y-Werte aus PDF-Unterstrichen extrahiert (scripts/extract_sg_lines.mjs).
        // alsoAt spiegelt automatisch in Bund-Spalte (x=520).
        { id: 'reingewinn_buch',       label: 'Reingewinn lt. Erfolgsrechnung (Code 100)', typ: 'betrag', pflicht: false, overlay: { formSeite: 2, x: 440, y: 650.6, groesse: 9, alsoAt: [{ x: 515, y: 650.6 }] } },
        { id: 'aufr_total',            label: 'Aufrechnungen total (Code 110)',            typ: 'betrag', pflicht: false, overlay: { formSeite: 2, x: 440, y: 553.5, groesse: 9, alsoAt: [{ x: 515, y: 553.5 }] } },
        { id: 'abzug_total',           label: 'Abzüge total (Code 130)',                   typ: 'betrag', pflicht: false, overlay: { formSeite: 2, x: 440, y: 403.4, groesse: 9, alsoAt: [{ x: 515, y: 403.4 }] } },
        { id: 'verlustvortrag_abzug',  label: 'Verlustverrechnung Vorjahre (Code 150)',    typ: 'betrag', pflicht: false, overlay: { formSeite: 2, x: 440, y: 295.3, groesse: 9, alsoAt: [{ x: 515, y: 295.3 }] } },
        { id: 'steuerbarer_gewinn_kt', label: 'Steuerbarer Reingewinn (Code 250)',         typ: 'betrag', pflicht: false, overlay: { formSeite: 2, x: 440, y: 281.3, groesse: 9, alsoAt: [{ x: 515, y: 281.3 }] } },
        { id: 'reingewinn_ch',         label: 'In der Schweiz steuerbarer Reingewinn / -verlust (Code 260)', typ: 'betrag', pflicht: false, overlay: { formSeite: 2, x: 440, y: 238.6, groesse: 9, alsoAt: [{ x: 515, y: 238.6 }] } },
        { id: 'reingewinn_sg',         label: 'Im Kanton St. Gallen steuerbarer Reingewinn / -verlust (Code 270)', typ: 'betrag', pflicht: false, overlay: { formSeite: 2, x: 440, y: 195.6, groesse: 9 } },
        { id: 'reingewinn_sg_ord',     label: 'davon ordentliche Besteuerung (Code 266)',                          typ: 'betrag', pflicht: false, overlay: { formSeite: 2, x: 440, y: 164.2, groesse: 9 } },
        { id: 'reingewinn_sg_sonder',  label: 'davon Besteuerung zum Sondersatz Art. 323 Abs. 1 StG (Code 268)',   typ: 'betrag', pflicht: false, overlay: { formSeite: 2, x: 440, y: 149.6, groesse: 9 } },
      ],
    },
    {
      id: 'kapitalsteuer',
      titel: 'Kapital und Reserven (Seite 3)',
      felder: [
        // y-Werte aus PDF-Unterstrichen extrahiert. CHF-Spalte x≈525, Sub-Spalte x≈425.
        { id: 'einbezahltes_kapital', label: 'Eigenkapital lt. Jahresrechnung (Code 530)',        typ: 'betrag', pflicht: false, overlay: { formSeite: 3, x: 520, y: 603.5, groesse: 9 } },
        { id: 'gesetzl_gewinnres',    label: 'Statutarische Reserven (Code 512)',                  typ: 'betrag', pflicht: false, overlay: { formSeite: 3, x: 420, y: 566.5, groesse: 9 } },
        { id: 'freie_reserven',       label: 'Übrige Reserven (Code 518)',                         typ: 'betrag', pflicht: false, overlay: { formSeite: 3, x: 420, y: 521.5, groesse: 9 } },
        { id: 'kap_reserven',         label: 'Als Gewinn versteuerte stille Reserven (Code 540)',  typ: 'betrag', pflicht: false, overlay: { formSeite: 3, x: 520, y: 461.4, groesse: 9 } },
        { id: 'eigenkapital_total',   label: 'Eigenkapital total (Code 555)',                      typ: 'betrag', pflicht: false, overlay: { formSeite: 3, x: 520, y: 296.7, groesse: 9 } },
        { id: 'steuerbares_kapital',  label: 'Gesamtes steuerbares Eigenkapital (Code 560)',       typ: 'betrag', pflicht: false, overlay: { formSeite: 3, x: 520, y: 281.7, groesse: 9 } },
        { id: 'kapital_ch',           label: 'In der Schweiz steuerbares Eigenkapital (Code 570)', typ: 'betrag', pflicht: false, overlay: { formSeite: 3, x: 520, y: 238.6, groesse: 9 } },
        { id: 'kapital_sg',           label: 'Im Kanton St. Gallen steuerbares Eigenkapital (Code 580)', typ: 'betrag', pflicht: false, overlay: { formSeite: 3, x: 520, y: 195.6, groesse: 9 } },
      ],
    },
    {
      id: 'verluste_diverses',
      titel: 'Verlustvorträge (Seite 4)',
      felder: [
        // 7 Geschäftsjahr-Zeilen mit Betrag (Kanton + Bund-Spiegel)
        // y-Werte aus PDF-Linien extrahiert (sg_lines.json, formSeite 4).
        { id: 'verlust_jahr_1',   label: 'Geschäftsjahr 1', typ: 'text',   pflicht: false, overlay: { formSeite: 4, x: 310, y: 635.6, groesse: 9 } },
        { id: 'verlust_betrag_1', label: 'Verlust 1',        typ: 'betrag', pflicht: false, overlay: { formSeite: 4, x: 440, y: 635.6, groesse: 9, alsoAt: [{ x: 515, y: 635.6 }] } },
        { id: 'verlust_jahr_2',   label: 'Geschäftsjahr 2', typ: 'text',   pflicht: false, overlay: { formSeite: 4, x: 310, y: 620.6, groesse: 9 } },
        { id: 'verlust_betrag_2', label: 'Verlust 2',        typ: 'betrag', pflicht: false, overlay: { formSeite: 4, x: 440, y: 620.6, groesse: 9, alsoAt: [{ x: 515, y: 620.6 }] } },
        { id: 'verlust_jahr_3',   label: 'Geschäftsjahr 3', typ: 'text',   pflicht: false, overlay: { formSeite: 4, x: 310, y: 605.5, groesse: 9 } },
        { id: 'verlust_betrag_3', label: 'Verlust 3',        typ: 'betrag', pflicht: false, overlay: { formSeite: 4, x: 440, y: 605.5, groesse: 9, alsoAt: [{ x: 515, y: 605.5 }] } },
        { id: 'verlust_jahr_4',   label: 'Geschäftsjahr 4', typ: 'text',   pflicht: false, overlay: { formSeite: 4, x: 310, y: 590.5, groesse: 9 } },
        { id: 'verlust_betrag_4', label: 'Verlust 4',        typ: 'betrag', pflicht: false, overlay: { formSeite: 4, x: 440, y: 590.5, groesse: 9, alsoAt: [{ x: 515, y: 590.5 }] } },
        { id: 'verlust_jahr_5',   label: 'Geschäftsjahr 5', typ: 'text',   pflicht: false, overlay: { formSeite: 4, x: 310, y: 575.5, groesse: 9 } },
        { id: 'verlust_betrag_5', label: 'Verlust 5',        typ: 'betrag', pflicht: false, overlay: { formSeite: 4, x: 440, y: 575.5, groesse: 9, alsoAt: [{ x: 515, y: 575.5 }] } },
        { id: 'verlust_jahr_6',   label: 'Geschäftsjahr 6', typ: 'text',   pflicht: false, overlay: { formSeite: 4, x: 310, y: 560.5, groesse: 9 } },
        { id: 'verlust_betrag_6', label: 'Verlust 6',        typ: 'betrag', pflicht: false, overlay: { formSeite: 4, x: 440, y: 560.5, groesse: 9, alsoAt: [{ x: 515, y: 560.5 }] } },
        { id: 'verlust_jahr_7',   label: 'Geschäftsjahr 7', typ: 'text',   pflicht: false, overlay: { formSeite: 4, x: 310, y: 545.5, groesse: 9 } },
        { id: 'verlust_betrag_7', label: 'Verlust 7',        typ: 'betrag', pflicht: false, overlay: { formSeite: 4, x: 440, y: 545.5, groesse: 9, alsoAt: [{ x: 515, y: 545.5 }] } },
        // Totals
        { id: 'verlustvortrag_beginn', label: 'Zwischentotal (Summe Vorjahresverluste)', typ: 'betrag', pflicht: false, overlay: { formSeite: 4, x: 440, y: 530.5, groesse: 9, alsoAt: [{ x: 515, y: 530.5 }] } },
        { id: 'verlust_laufendes_j',   label: 'Abzüglich bereits verrechnete Verluste',  typ: 'betrag', pflicht: false, overlay: { formSeite: 4, x: 440, y: 515.5, groesse: 9, alsoAt: [{ x: 515, y: 515.5 }] } },
        { id: 'verlustvortrag_ende',   label: 'Verrechenbarer Verlust (Code 150)',       typ: 'betrag', pflicht: false, overlay: { formSeite: 4, x: 440, y: 500.9, groesse: 9, alsoAt: [{ x: 515, y: 500.9 }] } },
      ],
    },
  ],
  // Statische Overlays: Adresse Seite 1, Vertreter-Block, Sub-Total Seite 3, Beilagen-Hakerl
  staticOverlays: [
    // Adresse linksbündig auf Höhe "Abschluss vom" (x≈350), untereinander
    { formSeite: 1, fromField:  'firma_name',                              x: 350, y: 665, groesse: 10 },
    { formSeite: 1, fromField:  'hauptsitz',                               x: 350, y: 651, groesse: 10 },
    { formSeite: 1, fromFields: ['hauptsitz_plz', 'hauptsitz_ort'], sep: ' ', x: 350, y: 637, groesse: 10 },
    // Vertretung: nur wenn Hacken vertreter_artis gesetzt ist
    { formSeite: 1, whenField: 'vertreter_artis', text: 'Artis Treuhand GmbH',          x: 30,  y: 375, groesse: 9 },
    { formSeite: 1, whenField: 'vertreter_artis', text: 'Bahnhofstrasse 19',            x: 30,  y: 363, groesse: 9 },
    { formSeite: 1, whenField: 'vertreter_artis', text: '9320 Arbon',                    x: 30,  y: 351, groesse: 9 },
    { formSeite: 1, whenField: 'vertreter_artis', text: '071 555 22 11',                 x: 500, y: 387, groesse: 9 },
    // Untere Zeile: Telefon: ___  eMail: ___
    { formSeite: 1, whenField: 'vertreter_artis', text: '071 555 22 11',                 x: 70,  y: 274, groesse: 9 },
    { formSeite: 1, whenField: 'vertreter_artis', text: 'info@artis-treuhand.ch',        x: 350, y: 274, groesse: 9 },
    // Sub-Total 13.2 (Statutarische + Übrige) in Sub-Spalte (x≈420, y≈491)
    { formSeite: 3, sumOf: ['gesetzl_gewinnres', 'freie_reserven'], x: 420, y: 491.4, groesse: 9 },
    // Beilagen: Jahresrechnung immer angekreuzt
    { formSeite: 4, text: 'X', x: 33, y: 321, groesse: 9 },
  ],
};
