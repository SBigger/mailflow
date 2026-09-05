// SG JP 1a – Steuererklärung für Kapitalgesellschaften und Genossenschaften,
// Kanton St. Gallen, Steuerperiode 2025.
// Quell-PDF: 2 A3-Landscape-Booklet-Seiten (1190.55 × 841.89 pt), kein AcroForm.
// Wird im Renderer per bookletLayout in 4 echte A4-Seiten gesplittet (wie JP 1b).
//
// Booklet-Mapping (vermessen 05.09.2026 mit pymupdf, Wortkoordinaten):
//   Form-Seite 1 = PDF-Seite 0, RECHTE Hälfte (Firma, Sitz, Geschäftsjahr, Rückfragen)
//   Form-Seite 2 = PDF-Seite 1, LINKE  Hälfte (Reingewinn, Codes 100–280)
//   Form-Seite 3 = PDF-Seite 1, RECHTE Hälfte (Gewinnverwendung 285–299, Kapital 500–580)
//   Form-Seite 4 = PDF-Seite 0, LINKE  Hälfte (Verlustverrechnung 150, Ziffern 610–613, Beilagen)
//
// Koordinaten A4-lokal (0..595 × 0..842), y = 841.89 − y1(Wortzeile) − 1.3.
// Spalten Seite 2: Code x≈399 · Kanton CHF x 440 · Bund CHF x 515 (alsoAt spiegelt)
// Spalte  Seite 3: Code x≈474 · CHF x 520 (eine Spalte)
// Spalte  Seite 4: Codes 610–613 x≈474 · Betrag x 520; Verluste wie JP 1b.

const K = (x, y) => ({ formSeite: 2, x, y, groesse: 9, alsoAt: [{ x: 515, y }] }); // Kanton + Bund
const KO = (x, y) => ({ formSeite: 2, x, y, groesse: 9 });                            // nur Kanton
const S3 = (y, x = 520) => ({ formSeite: 3, x, y, groesse: 9 });
const S4 = (y, x = 520) => ({ formSeite: 4, x, y, groesse: 9 });

export const FAVORITEN_IDS = new Set([
  'firma_name', 'hauptsitz', 'hauptsitz_plz', 'hauptsitz_ort', 'sitzgemeinde', 'register_nr',
  'gj_von', 'gj_bis', 'vertreter_artis',
  'reingewinn_buch', 'aufr_total', 'abzug_total', 'verlustvortrag_abzug',
  'steuerbarer_gewinn_kt', 'reingewinn_ch', 'reingewinn_sg', 'reingewinn_sg_ord',
  'gv_vortrag_vorjahr', 'gv_reingewinn_er', 'gv_bilanzgewinn', 'gv_dividende',
  'gv_gesetzl_gewinnres', 'gv_freiw_gewinnres', 'gv_total', 'gv_vortrag_neu',
  'ek_kapital', 'ek_gesetzl_kapitalres', 'ek_gesetzl_gewinnres', 'ek_freiw_gewinnres',
  'ek_gewinnvortrag', 'ek_total_handelsbilanz', 'ek_stille_total', 'ek_steuerbar_total',
  'kapital_ch', 'kapital_sg',
  'umsatz', 'materialaufwand', 'personalaufwand', 'bilanzsumme',
]);

const VERLUST_ZEILEN = [635.6, 620.6, 605.5, 590.5, 575.5, 560.5, 545.5];

export const SG_JP1A = {
  kanton: 'SG',
  name: 'Kanton St. Gallen – JP 1a Kapitalgesellschaften (2025)',
  pdfUrl: 'storage:sg/JP_1a_2025.pdf',
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
      titel: 'Firma, Sitz, Geschäftsjahr (Seite 1)',
      felder: [
        { id: 'firma_name',      label: 'Firma (genaue Bezeichnung)',      typ: 'text',  pflicht: true,  overlay: { formSeite: 1, x: 198, y: 516.5, groesse: 10 } },
        { id: 'hauptsitz',       label: 'Hauptsitz (Adresse)',              typ: 'text',  pflicht: false, overlay: { formSeite: 1, x: 198, y: 480.4, groesse: 10 } },
        { id: 'hauptsitz_plz',   label: 'PLZ',                              typ: 'text',  pflicht: false, overlay: { formSeite: 1, x: 198, y: 466.4, groesse: 10 } },
        { id: 'hauptsitz_ort',   label: 'Ort',                              typ: 'text',  pflicht: false, overlay: { formSeite: 1, x: 240, y: 466.4, groesse: 10 } },
        { id: 'sitzgemeinde',    label: 'Sitzgemeinde',                     typ: 'text',  pflicht: false },
        { id: 'register_nr',     label: 'Register-Nr.',                     typ: 'text',  pflicht: false, overlay: { formSeite: 1, x: 415, y: 571.6, groesse: 9 } },
        { id: 'abschluss_vom',   label: 'Abschluss vom',                    typ: 'datum', pflicht: false, overlay: { formSeite: 1, x: 415, y: 584.6, groesse: 9 } },
        { id: 'gj_von',          label: 'Geschäftsjahr Beginn',             typ: 'datum', pflicht: false, overlay: { formSeite: 1, x: 250, y: 399.6, groesse: 9 } },
        { id: 'gj_bis',          label: 'Geschäftsjahr Ende',               typ: 'datum', pflicht: false, overlay: { formSeite: 1, x: 388, y: 399.6, groesse: 9 } },
        { id: 'organ_gl',        label: 'Geschäftsleitung (Name, Adresse)', typ: 'text',  pflicht: false, overlay: { formSeite: 1, x: 112, y: 369.6, groesse: 9 } },
        { id: 'organ_gl_telefon',label: 'Telefon Geschäftsleitung',         typ: 'text',  pflicht: false, overlay: { formSeite: 1, x: 500, y: 383.6, groesse: 9 } },
        { id: 'vertreter_artis', label: 'Rückfragen an Artis Treuhand GmbH', typ: 'checkbox', pflicht: false },
        { id: 'iban',            label: 'IBAN (Rückerstattung)',            typ: 'text',  pflicht: false, overlay: { formSeite: 1, x: 65,  y: 235.6, groesse: 9 } },
        { id: 'bank',            label: 'Bank / Institut, Ort',             typ: 'text',  pflicht: false, overlay: { formSeite: 1, x: 120, y: 219.6, groesse: 9 } },
        { id: 'kontoinhaber',    label: 'Kontoinhaber, Adresse, PLZ, Ort',  typ: 'text',  pflicht: false, overlay: { formSeite: 1, x: 175, y: 203.6, groesse: 9 } },
      ],
    },
    {
      id: 'gewinnsteuer',
      titel: 'Reingewinn (Seite 2)',
      hinweis: 'Ein Betrag füllt Kanton und Bund. Zwischentotale (Codes 120, 140, 145) selber erfassen oder leer lassen.',
      felder: [
        { id: 'reingewinn_buch',   label: '1 Reingewinn / -verlust gemäss Erfolgsrechnung (Code 100)', typ: 'betrag', overlay: K(440, 650.6) },
        { id: 'aufr_txt_1', label: '2.1 Aufrechnung 1 – Bezeichnung', typ: 'text', overlay: KO(90, 584.6) }, { id: 'aufr_1', label: '2.1 Aufrechnung 1 – Betrag', typ: 'betrag', overlay: K(440, 584.6) },
        { id: 'aufr_txt_2', label: '2.1 Aufrechnung 2 – Bezeichnung', typ: 'text', overlay: KO(90, 567.6) }, { id: 'aufr_2', label: '2.1 Aufrechnung 2 – Betrag', typ: 'betrag', overlay: K(440, 567.6) },
        { id: 'aufr_txt_3', label: '2.1 Aufrechnung 3 – Bezeichnung', typ: 'text', overlay: KO(90, 550.6) }, { id: 'aufr_3', label: '2.1 Aufrechnung 3 – Betrag', typ: 'betrag', overlay: K(440, 550.6) },
        { id: 'aufr_txt_4', label: '2.1 Aufrechnung 4 – Bezeichnung', typ: 'text', overlay: KO(90, 533.6) }, { id: 'aufr_4', label: '2.1 Aufrechnung 4 – Betrag', typ: 'betrag', overlay: K(440, 533.6) },
        { id: 'aufr_txt_5', label: '2.1 Aufrechnung 5 – Bezeichnung', typ: 'text', overlay: KO(90, 516.6) }, { id: 'aufr_5', label: '2.1 Aufrechnung 5 – Betrag', typ: 'betrag', overlay: K(440, 516.6) },
        { id: 'aufr_txt_6', label: '2.1 Aufrechnung 6 – Bezeichnung', typ: 'text', overlay: KO(90, 499.6) }, { id: 'aufr_6', label: '2.1 Aufrechnung 6 – Betrag', typ: 'betrag', overlay: K(440, 499.6) },
        { id: 'aufr_total',        label: '2.2 Total der Aufrechnungen (Code 110)',                      typ: 'betrag', overlay: K(440, 452.6) },
        { id: 'zwischentotal',     label: '3 Zwischentotal (Code 120)',                                  typ: 'betrag', overlay: K(440, 437.6) },
        { id: 'abzug_txt_1', label: '4.1 Abzug 1 – Bezeichnung', typ: 'text', overlay: KO(90, 381.6) }, { id: 'abzug_1', label: '4.1 Abzug 1 – Betrag', typ: 'betrag', overlay: K(440, 381.6) },
        { id: 'abzug_txt_2', label: '4.1 Abzug 2 – Bezeichnung', typ: 'text', overlay: KO(90, 364.6) }, { id: 'abzug_2', label: '4.1 Abzug 2 – Betrag', typ: 'betrag', overlay: K(440, 364.6) },
        { id: 'abzug_txt_3', label: '4.1 Abzug 3 – Bezeichnung', typ: 'text', overlay: KO(90, 347.6) }, { id: 'abzug_3', label: '4.1 Abzug 3 – Betrag', typ: 'betrag', overlay: K(440, 347.6) },
        { id: 'abzug_txt_4', label: '4.1 Abzug 4 – Bezeichnung', typ: 'text', overlay: KO(90, 330.6) }, { id: 'abzug_4', label: '4.1 Abzug 4 – Betrag', typ: 'betrag', overlay: K(440, 330.6) },
        { id: 'abzug_total',       label: '4.2 Total der Abzüge (Code 130)',                             typ: 'betrag', overlay: K(440, 317.6) },
        { id: 'reingewinn_vor_entl', label: '5 Reingewinn / -verlust vor Entlastungen (Code 140)',     typ: 'betrag', overlay: K(440, 302.6) },
        { id: 'entlastungen_total',  label: '5.1 Total der Entlastungen (Code 141)',                     typ: 'betrag', overlay: K(440, 274.6) },
        { id: 'entlastung_korrektur',label: '5.2 Korrektur Entlastungsbegrenzung (Code 144)',            typ: 'betrag', overlay: K(440, 257.6) },
        { id: 'reingewinn_nach_entl',label: '5.3 Reingewinn / -verlust nach Entlastungen (Code 145)',    typ: 'betrag', overlay: K(440, 243.6) },
        { id: 'verlustvortrag_abzug',label: '6 Verlustverrechnung (Code 150)',                           typ: 'betrag', overlay: K(440, 204.6) },
        { id: 'steuerbarer_gewinn_kt',label: '7 Gesamter steuerbarer Reingewinn / -verlust (Code 250)',  typ: 'betrag', overlay: K(440, 190.6) },
        { id: 'anteil_ausland',      label: '8 Auf das Ausland entfallender Anteil (Code 255)',          typ: 'betrag', overlay: K(440, 163.6) },
        { id: 'reingewinn_ch',       label: '9 In der Schweiz steuerbarer Reingewinn (Code 260)',        typ: 'betrag', overlay: K(440, 149.6) },
        { id: 'anteil_andere_kantone',label: '10 Auf andere Kantone entfallender Anteil (Code 265)',     typ: 'betrag', overlay: KO(440, 119.6) },
        { id: 'reingewinn_sg',       label: '11 Im Kanton St. Gallen steuerbarer Reingewinn (Code 270)', typ: 'betrag', overlay: KO(440, 104.6) },
        { id: 'reingewinn_sg_ord',   label: '11.1 davon ordentliche Besteuerung (Code 266)',             typ: 'betrag', overlay: KO(440, 76.6) },
        { id: 'reingewinn_sg_sonder',label: '11.2 davon Besteuerung zum Sondersatz (Code 269)',          typ: 'betrag', overlay: KO(440, 61.6) },
        { id: 'beteiligungsabzug_pct',label: '12 Beteiligungsabzug in % (Code 280)',                     typ: 'zahl',   overlay: { formSeite: 2, x: 445, y: 31.6, groesse: 9, alsoAt: [{ x: 520, y: 31.6 }] } },
      ],
    },
    {
      id: 'gewinnverwendung',
      titel: 'Gewinnverwendung (Seite 3)',
      felder: [
        { id: 'gv_vortrag_vorjahr',   label: '13.1 Gewinnvortrag (+) / Verlustvortrag (-) aus dem Vorjahr (Code 285)', typ: 'betrag', overlay: S3(639.6) },
        { id: 'gv_reingewinn_er',     label: '13.2 Ergebnis gemäss Erfolgsrechnung (Hertrag Ziffer 1)',              typ: 'betrag', overlay: S3(624.6) },
        { id: 'gv_entnahme_reserven', label: '13.3 Entnahme aus den Reserven (Code 287)',                             typ: 'betrag', overlay: S3(609.6) },
        { id: 'gv_bilanzgewinn',      label: '13.4 Total zu verteilender Bilanzgewinn (Code 290)',                   typ: 'betrag', overlay: S3(594.6) },
        { id: 'gv_dividende',         label: '13.5 Dividende, Gewinnanteile (brutto) (Code 291)',                    typ: 'betrag', overlay: S3(579.6) },
        { id: 'gv_gesetzl_gewinnres', label: '13.6 Zuweisung an die gesetzliche Gewinnreserve (Code 293)',           typ: 'betrag', overlay: S3(564.6) },
        { id: 'gv_freiw_gewinnres',   label: '13.7 Zuweisung an die freiwillige Gewinnreserve (Code 294)',           typ: 'betrag', overlay: S3(549.6) },
        { id: 'gv_uebrige_txt_1',     label: '13.8 Übrige 1 – Bezeichnung',                                          typ: 'text',   overlay: S3(534.6, 130) },
        { id: 'gv_uebrige_1',         label: '13.8 Übrige 1 – Betrag',                                               typ: 'betrag', overlay: S3(534.6) },
        { id: 'gv_uebrige_txt_2',     label: '13.8 Übrige 2 – Bezeichnung',                                          typ: 'text',   overlay: S3(519.6, 130) },
        { id: 'gv_uebrige_2',         label: '13.8 Übrige 2 – Betrag (Code 296)',                                    typ: 'betrag', overlay: S3(519.6) },
        { id: 'gv_total',             label: '13.9 Total Gewinnverwendung (Code 297)',                               typ: 'betrag', overlay: S3(504.6) },
        { id: 'gv_vortrag_neu',       label: '13.10 Vortrag auf neue Rechnung (Code 299)',                           typ: 'betrag', overlay: S3(489.6) },
      ],
    },
    {
      id: 'kapitalsteuer',
      titel: 'Kapital und Reserven (Seite 3)',
      felder: [
        { id: 'ek_kapital',            label: '14 Einbezahltes Grund- oder Gesellschafterkapital (Code 500)', typ: 'betrag', overlay: S3(428.6) },
        { id: 'ek_gesetzl_kapitalres', label: '15.1 Gesetzliche Kapitalreserve (Code 510)',                 typ: 'betrag', overlay: S3(398.6) },
        { id: 'ek_gesetzl_gewinnres',  label: '15.2 Gesetzliche Gewinnreserve (Code 511)',                  typ: 'betrag', overlay: S3(383.6) },
        { id: 'ek_freiw_gewinnres',    label: '15.3 Freiwillige Gewinnreserve (Code 512)',                  typ: 'betrag', overlay: S3(368.6) },
        { id: 'ek_uebrige_txt',        label: '15.4 Übrige Reserven – Bezeichnung',                         typ: 'text',   overlay: S3(352.6, 130) },
        { id: 'ek_uebrige',            label: '15.4 Übrige Reserven – Betrag (Code 518)',                   typ: 'betrag', overlay: S3(338.6) },
        { id: 'ek_gewinnvortrag',      label: '16 Gewinnvortrag (+) / Verlustvortrag (-) (Code 520)',       typ: 'betrag', overlay: S3(323.6) },
        { id: 'ek_eigene_kapitalanteile', label: '17 ./. Eigene Kapitalanteile (Code 525)',                 typ: 'betrag', overlay: S3(308.6) },
        { id: 'ek_total_handelsbilanz',label: '18 Eigenkapital laut Handelsbilanz (Code 530)',              typ: 'betrag', overlay: S3(293.6) },
        { id: 'ek_stille_txt_1',       label: '20 Versteuerte stille Reserven 1 – Bezeichnung',             typ: 'text',   overlay: S3(247.6, 65) },
        { id: 'ek_stille_1',           label: '20 Versteuerte stille Reserven 1 – Betrag',                  typ: 'betrag', overlay: S3(247.6, 440) },
        { id: 'ek_stille_txt_2',       label: '20 Versteuerte stille Reserven 2 – Bezeichnung',             typ: 'text',   overlay: S3(232.6, 65) },
        { id: 'ek_stille_2',           label: '20 Versteuerte stille Reserven 2 – Betrag',                  typ: 'betrag', overlay: S3(232.6, 440) },
        { id: 'ek_stille_txt_3',       label: '20 Versteuerte stille Reserven 3 – Bezeichnung',             typ: 'text',   overlay: S3(217.6, 65) },
        { id: 'ek_stille_3',           label: '20 Versteuerte stille Reserven 3 – Betrag',                  typ: 'betrag', overlay: S3(217.6, 440) },
        { id: 'ek_stille_total',       label: '20 Als Gewinn versteuerte stille Reserven total (Code 540)', typ: 'betrag', overlay: S3(203.6) },
        { id: 'ek_verdecktes',         label: '21 Verdecktes Eigenkapital (Code 550)',                      typ: 'betrag', overlay: S3(188.6) },
        { id: 'ek_ermaessigung',       label: '22 ./. Ermässigung des Eigenkapitals (Code 559)',            typ: 'betrag', overlay: S3(173.6) },
        { id: 'ek_steuerbar_total',    label: '23 Gesamtes steuerbares Eigenkapital (Code 560)',            typ: 'betrag', overlay: S3(144.6) },
        { id: 'kapital_ausland',       label: '24 Auf das Ausland entfallender Anteil (Code 565)',          typ: 'betrag', overlay: S3(114.6) },
        { id: 'kapital_ch',            label: '25 In der Schweiz steuerbares Eigenkapital (Code 570)',      typ: 'betrag', overlay: S3(100.6) },
        { id: 'kapital_andere_kantone',label: '26 Auf andere Kantone entfallender Anteil (Code 575)',       typ: 'betrag', overlay: S3(70.6) },
        { id: 'kapital_sg',            label: '27 Im Kanton St. Gallen steuerbares Eigenkapital (Code 580)', typ: 'betrag', overlay: S3(55.6) },
      ],
    },
    {
      id: 'ergaenzende',
      titel: 'Ergänzende Angaben (Seite 4)',
      felder: [
        ...VERLUST_ZEILEN.flatMap((y, i) => ([
          { id: `verlust_jahr_${i + 1}`,   label: `28 Verlust ${i + 1} – Geschäftsjahr`, typ: 'text',   overlay: { formSeite: 4, x: 330, y, groesse: 9 } },
          { id: `verlust_betrag_${i + 1}`, label: `28 Verlust ${i + 1} – Betrag`,        typ: 'betrag', overlay: { formSeite: 4, x: 440, y, groesse: 9, alsoAt: [{ x: 515, y }] } },
        ])),
        { id: 'verlustvortrag_beginn', label: '28 Zwischentotal (Summe der Vorjahresverluste)', typ: 'betrag', overlay: { formSeite: 4, x: 440, y: 530.5, groesse: 9, alsoAt: [{ x: 515, y: 530.5 }] } },
        { id: 'verlust_laufendes_j',   label: '28 Abzüglich bereits verrechnete Verluste',      typ: 'betrag', overlay: { formSeite: 4, x: 440, y: 515.5, groesse: 9, alsoAt: [{ x: 515, y: 515.5 }] } },
        { id: 'verlustvortrag_ende',   label: '28 Verrechenbarer Verlust (Code 150)',           typ: 'betrag', overlay: { formSeite: 4, x: 440, y: 500.6, groesse: 9, alsoAt: [{ x: 515, y: 500.6 }] } },
        { id: 'umsatz',           label: '29 Geschäftsumsatz nach Abzug MWST (Code 610)',      typ: 'betrag', overlay: S4(461.6) },
        { id: 'materialaufwand',  label: '29 Waren- und Materialaufwand (Code 611)',           typ: 'betrag', overlay: S4(446.6) },
        { id: 'personalaufwand',  label: '29 Personalaufwand (Code 612)',                      typ: 'betrag', overlay: S4(431.6) },
        { id: 'bilanzsumme',      label: '29 Bilanzsumme (Code 613)',                          typ: 'betrag', overlay: S4(416.6) },
        { id: 'beteiligung_geaendert', label: '30 Beteiligungsverhältnisse seit letzter Steuererklärung verändert?', typ: 'select', optionen: ['nein', 'ja'] },
        { id: 'eigene_aktien_anzahl',  label: '30 Anzahl eigene Aktien per Abschlussdatum',    typ: 'text',   overlay: { formSeite: 4, x: 330, y: 363.6, groesse: 9 } },
        { id: 'ort_datum',        label: 'Ort und Datum (Unterschrift)',                      typ: 'text',   overlay: { formSeite: 4, x: 305, y: 232.6, groesse: 9 } },
        { id: 'beilage_jp2',      label: 'Beilage Formular JP 2 (Leistungen an Anteilsinhaber)', typ: 'checkbox' },
        { id: 'beilage_jp4',      label: 'Beilage Formular JP 4 (Beteiligungen)',              typ: 'checkbox' },
        { id: 'beilage_jp5',      label: 'Beilage Formular JP 5 (Abschreibungen)',             typ: 'checkbox' },
        { id: 'beilage_jp6',      label: 'Beilage Formular JP 6 (Steuerausscheidung)',         typ: 'checkbox' },
        { id: 'bemerkungen',      label: 'Interne Bemerkungen (nicht im Formular)',            typ: 'textarea' },
      ],
    },
  ],
  staticOverlays: [
    // Kopfzeile Sitzgemeinde / Registernummer / Steuerpflichtige auf den Seiten 2–4
    ...[2, 3, 4].flatMap(formSeite => ([
      { formSeite, fromField: 'sitzgemeinde', x: 110, y: 722.6, groesse: 9 },
      { formSeite, fromField: 'register_nr',  x: 110, y: 710.6, groesse: 9 },
      { formSeite, fromField: 'firma_name',   x: 110, y: 698.6, groesse: 9 },
    ])),
    // Seite 1: Rückfragen an Artis, wenn Hacken gesetzt
    { formSeite: 1, whenField: 'vertreter_artis', text: 'Artis Treuhand GmbH, Bahnhofstrasse 19, 9320 Arbon', x: 100, y: 300.6, groesse: 9 },
    { formSeite: 1, whenField: 'vertreter_artis', text: '071 555 22 11',                                    x: 70,  y: 284.6, groesse: 9 },
    { formSeite: 1, whenField: 'vertreter_artis', text: 'info@artis-gmbh.ch',                               x: 350, y: 284.6, groesse: 9 },
    // Seite 4: Beteiligungsverhältnisse Ja / Nein
    { formSeite: 4, whenFieldEquals: ['beteiligung_geaendert', 'ja'],   text: 'X', x: 448.5, y: 378.6, groesse: 9 },
    { formSeite: 4, whenFieldEquals: ['beteiligung_geaendert', 'nein'], text: 'X', x: 500.5, y: 378.6, groesse: 9 },
    // Seite 4: Beilagen – Jahresrechnung immer angekreuzt, weitere per Hacken
    { formSeite: 4, text: 'X', x: 33.5, y: 169.6, groesse: 9 },
    { formSeite: 4, whenField: 'beilage_jp2', text: 'X', x: 33.5, y: 155.6, groesse: 9 },
    { formSeite: 4, whenField: 'beilage_jp4', text: 'X', x: 33.5, y: 113.6, groesse: 9 },
    { formSeite: 4, whenField: 'beilage_jp5', text: 'X', x: 343.5, y: 155.6, groesse: 9 },
    { formSeite: 4, whenField: 'beilage_jp6', text: 'X', x: 343.5, y: 141.6, groesse: 9 },
  ],
};
