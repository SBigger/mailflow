// ZH Form. 500 – Steuererklärung 2025 für Kapitalgesellschaften, Kanton Zürich
// Quell-PDF: 4× A4, echtes AcroForm (198 befüllbare Felder), kein XFA.
// Feldnamen via pdf-lib/pypdf aus dem PDF extrahiert, Ziffern-Zuordnung über
// die Widget-Positionen gegen den Formulartext vermessen.
//
// Spalten auf Seite 2 (A. Reingewinn) und Seite 3 (C. Eigenkapital):
//   Suffix `_bs`  = Bundessteuer (linke Spalte,  x≈363)
//   ohne Suffix   = Staatssteuer (rechte Spalte, x≈454)
//   → ACHTUNG: umgekehrt zu TG, wo `.calc.0` der Kanton ist.
//
// Eine Eingabe füllt beide Spalten (`acroFieldBund`). Weicht die Bundessteuer
// ab, kann pro Feld ein `<id>_bund` erfasst werden – das schlägt die Spiegelung.
//
// Die Summen (Ziffern 3, 4.3, 5, 7, 8, 11.3, 11.12, 11.13, 16, 18, 19, 21, 22)
// rechnet das Original-PDF per eingebettetem JavaScript. pdf-lib führt kein
// PDF-JS aus, darum stehen sie hier als `computed`-Regeln.

import { ZH_GEMEINDEN } from './zh_gemeinden.js';

const GEMEINDE_NAMEN = Object.keys(ZH_GEMEINDEN);

// Die Ziffern 2.1.1 – 2.2.4, die in Ziffer 3 aufsummiert werden.
// 2.2.2 a) Grundstücke ist bewusst NICHT dabei – dort hat das Formular je eine
// eigene Zeile für Bund (ss.11_bs) und Staat (ss.12), s. unten.
const AUFRECHNUNGEN = [
  'aufr_abschreibungen', 'aufr_rueckstellungen', 'aufr_abschr_aufgewertet',
  'aufr_einlagen_reserven', 'aufr_verdeckte_gewinn', 'aufr_abschr_beteiligungen',
  'aufr_uebersetzte_zuwendungen', 'aufr_zinsen_verd_ek', 'aufr_bussen',
  'aufr_steueraufwand_vorperiode', 'aufr_wegfall_rueckstellungen',
  'aufr_hoeherbew_beteiligungen', 'aufr_unterpreisliche_leistungen',
  'aufr_liquidationsgewinne',
];

// Ziffern 4.1.1 – 4.2.2 (4.2.3 ist nur Staatssteuer, s. unten).
const ABZUEGE = [
  'abzug_stille_reserven', 'abzug_vorsorge', 'abzug_gemeinnuetzig',
  'abzug_andere', 'abzug_aufl_stille_reserven', 'abzug_kapitaleinlagen',
];

// Ziffern 12 – 15 für Total Ziffer 16 (13.4 „Eigene Kapitalanteile" wird abgezogen).
const EK_POSITIONEN = [
  'ek_kapital', 'ek_gesetzl_kapitalres', 'ek_gesetzl_gewinnres',
  'ek_freiw_gewinnres', 'ek_betrag_135', 'ek_gewinnvortrag',
  'ek_betrag_141', 'ek_betrag_142', 'ek_betrag_143', 'ek_verdecktes_ek',
];

export const FAVORITEN_IDS = new Set([
  'firma_name', 'hauptsitz', 'hauptsitz_plz', 'hauptsitz_ort', 'gemeinde',
  'register_nr', 'gj_von', 'gj_bis', 'vertreter_artis',
  'reingewinn_buch', 'vorjahresverluste', 'anteil_ausserkantonal',
  'beteiligungsabzug_pct',
  'gv_vortrag_vorjahr', 'gv_reingewinn_er', 'gv_dividende',
  'gv_gesetzl_gewinnres', 'gv_freiw_gewinnres',
  'ek_stichtag', 'ek_kapital', 'ek_gesetzl_kapitalres', 'ek_gesetzl_gewinnres',
  'ek_freiw_gewinnres', 'ek_gewinnvortrag', 'ek_verlustvortrag',
]);

export const ZH_500 = {
  kanton: 'ZH',
  name: 'Kanton Zürich – Form. 500 (2025)',
  pdfUrl: '/zh/500_STE_2025.pdf',
  typ: 'acroform',

  // Felder, die vor dem Flatten entfernt werden. pdf-lib zeichnet beim Flatten
  // auch als „hidden" markierte Widgets – ohne das Entfernen landeten die
  // Navigations-Buttons, die grauen Konstanten-Kästchen oben rechts und vor
  // allem der Strichcode mit seinem VOREINGESTELLTEN Wert (Adliswil, ohne
  // Register-Nr.) im Ausdruck.
  dropFields: [
    'nav.print', 'nav.reset', 'nav.next', 'nav.prev',
    'nav.erklaerung', 'nav.erklaerung_txt', 'calc.actions',
    '02_Konstante', '03_Konstante', '04_GovID', 'String', 'String_BC',
    'QRCode',
    'Hintergrund_Seite2', 'Hintergrund_Seite3', 'Hintergrund_Seite4',
    'a.gewinn.ss.27_Man', 'a.gewinn.ss.27_bs_Man',
    'a.gewinn.ss.29_Man', 'a.gewinn.ss.29_bs_Man',
    // Doppelte Alt-Felder, die im grauen Personalien-Kasten liegen
    'allg.regnr', 'allg.gemeinde',
  ],

  // Strichcode unten auf Seite 1 (Code 39) wird selber vektoriell gezeichnet,
  // weil das Original per PDF-JavaScript entsteht. Nutzlast identisch zum
  // Original: Register-Nr. + Steuerjahr + Konstante + BFS-Gemeindenummer.
  barcode: {
    seite: 1,
    x: 186.7, y: 32, w: 326.5, h: 25,
    narrow: 0.675,          // ergibt exakt die Modulbreite des Originals
    payload: (felder) => {
      const reg = String(felder.register_nr || '').trim().toUpperCase();
      const bfs = ZH_GEMEINDEN[felder.gemeinde];
      if (!/^J\d{10}$/.test(reg) || !bfs) return null;
      return reg + '2025' + '00010010' + bfs;
    },
  },

  // Kein hideBottomButtons: die Buttons sind schon über dropFields weg. Ein
  // weisses Rechteck am Seitenfuss käme dem gedruckten Formular-Strichcode und
  // seiner Klartextzeile (ab y≈30) gefährlich nahe.

  sections: [
    {
      id: 'stammdaten',
      titel: 'Stammdaten (Seite 1)',
      felder: [
        { id: 'firma_name',     label: 'Genaue Firmenbezeichnung',        typ: 'text',  pflicht: true,  acroField: 'allg.firma.bezeichnung' },
        { id: 'hauptsitz',      label: 'Hauptsitz (Strasse / Nr.)',       typ: 'text',  pflicht: false, acroField: 'allg.firma.hauptsitz' },
        { id: 'hauptsitz_plz',  label: 'PLZ',                             typ: 'text',  pflicht: false },
        { id: 'hauptsitz_ort',  label: 'Ort',                             typ: 'text',  pflicht: false },
        { id: 'gemeinde',       label: 'Gemeinde (Steuerhoheit ZH)',      typ: 'select', pflicht: false, acroChoice: 'Dropdown2', optionen: GEMEINDE_NAMEN },
        { id: 'register_nr',    label: 'Register-Nr. (J + 10 Ziffern, Zugangscodeschreiben)', typ: 'text', pflicht: false, acroField: '01_Register-Nr' },
        { id: 'zweck',          label: 'Zweck des Unternehmens',          typ: 'textarea', pflicht: false, acroField: 'allg.firma.zweck' },
        { id: 'gruendungsdatum',label: 'Datum der Gründung',              typ: 'datum', pflicht: false, acroField: 'allg.firma.gdat' },
        { id: 'hr_eintrag',     label: 'Datum der Eintragung im Handelsregister', typ: 'datum', pflicht: false, acroField: 'allg.firma.eintrag_hreg' },
        { id: 'gj_von',         label: 'Geschäftsjahr Beginn',            typ: 'datum', pflicht: false, acroField: 'allg.firma.gjahr.bdat' },
        { id: 'gj_bis',         label: 'Geschäftsjahr Ende',              typ: 'datum', pflicht: false, acroField: 'allg.firma.gjahr.edat' },
        { id: 'nebensteuerdomizile', label: 'Nebensteuerdomizile (Betriebsstätten / Liegenschaften)', typ: 'textarea', pflicht: false, acroField: 'allg.firma.niederlassungen' },
        { id: 'organ_vr',       label: 'Verwaltungsratspräsident/in',     typ: 'text',  pflicht: false, acroField: 'allg.firma.organe.vr' },
        { id: 'organ_gl',       label: 'Geschäftsleitung',                typ: 'text',  pflicht: false, acroField: 'allg.firma.organe.gl' },
        { id: 'organ_rw',       label: 'Verantwortlich für das Rechnungswesen', typ: 'text', pflicht: false, acroField: 'allg.firma.organe.rw' },
        { id: 'revisionsstelle',label: 'Revisionsstelle',                 typ: 'text',  pflicht: false, acroField: 'allg.firma.revisionsstelle' },
        { id: 'rueckfragen',    label: 'Rückfragen an (Kontaktperson)',   typ: 'text',  pflicht: false, acroField: 'allg.firma.rueckfragen' },
        { id: 'vertreter_artis',label: 'Vertretung durch Artis Treuhand GmbH', typ: 'checkbox', pflicht: false },
        { id: 'vertreter_che',  label: 'Treuhänder-ID (nur Ziffern, ohne CHE-)', typ: 'text', pflicht: false, acroField: 'allg.vertreter.che' },
      ],
    },

    {
      id: 'reingewinn',
      titel: 'A. Reingewinn (Seite 2)',
      felder: [
        { id: 'reingewinn_buch',              label: '1 Reingewinn/Verlust(-) gemäss Erfolgsrechnung', typ: 'betrag', acroField: 'a.gewinn.ss.0',  acroFieldBund: 'a.gewinn.ss.0_bs' },

        { id: 'aufr_abschreibungen',          label: '2.1.1 Nicht begründete Abschreibungen / Anschaffungskosten', typ: 'betrag', acroField: 'a.gewinn.ss.1',  acroFieldBund: 'a.gewinn.ss.1_bs' },
        { id: 'aufr_rueckstellungen',         label: '2.1.2 Nicht begründete Rückstellungen',         typ: 'betrag', acroField: 'a.gewinn.ss.2',  acroFieldBund: 'a.gewinn.ss.2_bs' },
        { id: 'aufr_rueckstellungen_txt',     label: '2.1.2 Bezeichnung',                             typ: 'text',   acroField: 'a.gewinn.bemerkung.1' },
        { id: 'aufr_abschr_aufgewertet',      label: '2.1.3 Nicht zulässige Abschreibungen auf aufgewerteten Aktiven', typ: 'betrag', acroField: 'a.gewinn.ss.3', acroFieldBund: 'a.gewinn.ss.3_bs' },
        { id: 'aufr_einlagen_reserven',       label: '2.1.4 Einlagen in die Reserven',                typ: 'betrag', acroField: 'a.gewinn.ss.4',  acroFieldBund: 'a.gewinn.ss.4_bs' },
        { id: 'aufr_verdeckte_gewinn',        label: '2.1.5 Verdeckte Gewinnausschüttungen / Zuwendungen an Dritte', typ: 'betrag', acroField: 'a.gewinn.ss.5', acroFieldBund: 'a.gewinn.ss.5_bs' },
        { id: 'aufr_verdeckte_gewinn_txt',    label: '2.1.5 Bezeichnung',                             typ: 'text',   acroField: 'a.gewinn.bemerkung.2' },
        { id: 'aufr_abschr_beteiligungen',    label: '2.1.6 Abschreibungen/WB auf Gestehungskosten von Beteiligungen ≥10%', typ: 'betrag', acroField: 'a.gewinn.ss.6', acroFieldBund: 'a.gewinn.ss.6_bs' },
        { id: 'aufr_uebersetzte_zuwendungen', label: '2.1.7 Übersetzte Zuwendungen',                  typ: 'betrag', acroField: 'a.gewinn.ss.7',  acroFieldBund: 'a.gewinn.ss.7_bs' },
        { id: 'aufr_zinsen_verd_ek',          label: '2.1.8 Zinsen auf verdecktem Eigenkapital',      typ: 'betrag', acroField: 'a.gewinn.ss.8',  acroFieldBund: 'a.gewinn.ss.8_bs' },
        { id: 'aufr_bussen',                  label: '2.1.9 Bestechungsgelder, Bussen, Sanktionen',   typ: 'betrag', acroField: 'a.gewinn.ss.9',  acroFieldBund: 'a.gewinn.ss.9_bs' },
        { id: 'aufr_steueraufwand_vorperiode',label: '2.1.10 Steueraufwand, bereits in Vorperiode abgezogen', typ: 'betrag', acroField: 'a.gewinn.ss.9b', acroFieldBund: 'a.gewinn.ss.9b_bs' },

        { id: 'aufr_wegfall_rueckstellungen', label: '2.2.1 Wegfall der Begründetheit von Rückstellungen', typ: 'betrag', acroField: 'a.gewinn.ss.10', acroFieldBund: 'a.gewinn.ss.10_bs' },
        { id: 'aufr_hoeherbew_grundst_bund',  label: '2.2.2 a) Höherbewertung Grundstücke – nur Bundessteuer', typ: 'betrag', acroField: 'a.gewinn.ss.11_bs' },
        { id: 'aufr_hoeherbew_grundst_staat', label: '2.2.2 a) Höherbewertung Grundstücke – nur Staatssteuer (Differenz Anlage-/Gewinnsteuerwert)', typ: 'betrag', acroField: 'a.gewinn.ss.12' },
        { id: 'aufr_hoeherbew_beteiligungen', label: '2.2.2 b) Höherbewertung Beteiligungen',         typ: 'betrag', acroField: 'a.gewinn.ss.13', acroFieldBund: 'a.gewinn.ss.13_bs' },
        { id: 'aufr_unterpreisliche_leistungen', label: '2.2.3 Unterpreisliche Leistungen (Gewinnvorwegnahmen)', typ: 'betrag', acroField: 'a.gewinn.ss.14', acroFieldBund: 'a.gewinn.ss.14_bs' },
        { id: 'aufr_unterpreisliche_txt',     label: '2.2.3 Bezeichnung',                             typ: 'text',   acroField: 'a.gewinn.bemerkung.3' },
        { id: 'aufr_liquidationsgewinne',     label: '2.2.4 Liquidationsgewinne',                     typ: 'betrag', acroField: 'a.gewinn.ss.15', acroFieldBund: 'a.gewinn.ss.15_bs' },

        { id: 'abzug_stille_reserven',        label: '4.1.1 Auflösung versteuerter stiller Reserven', typ: 'betrag', acroField: 'a.gewinn.ss.17', acroFieldBund: 'a.gewinn.ss.17_bs' },
        { id: 'abzug_vorsorge',               label: '4.1.2 Zuwendungen an Vorsorgeeinrichtungen',    typ: 'betrag', acroField: 'a.gewinn.ss.18', acroFieldBund: 'a.gewinn.ss.18_bs' },
        { id: 'abzug_gemeinnuetzig',          label: '4.1.3 Gemeinnützige Zuwendungen (max. 20% des Reingewinns)', typ: 'betrag', acroField: 'a.gewinn.ss.19', acroFieldBund: 'a.gewinn.ss.19_bs' },
        { id: 'abzug_andere',                 label: '4.1.4 Andere',                                  typ: 'betrag', acroField: 'a.gewinn.ss.20', acroFieldBund: 'a.gewinn.ss.20_bs' },
        { id: 'abzug_andere_txt',             label: '4.1.4 Bezeichnung',                             typ: 'text',   acroField: 'a.gewinn.bemerkung.4' },
        { id: 'abzug_aufl_stille_reserven',   label: '4.2.1 Auflösung versteuerter stiller Reserven (Kapitalgewinne / Rückstellungen)', typ: 'betrag', acroField: 'a.gewinn.ss.21', acroFieldBund: 'a.gewinn.ss.21_bs' },
        { id: 'abzug_kapitaleinlagen',        label: '4.2.2 Kapitaleinlagen',                         typ: 'betrag', acroField: 'a.gewinn.ss.22', acroFieldBund: 'a.gewinn.ss.22_bs' },
        { id: 'abzug_gewinne_liegenschaften', label: '4.2.3 Gewinne aus Verkauf/Aufwertung von Liegenschaften – nur Staatssteuer', typ: 'betrag', acroField: 'a.gewinn.ss.23' },

        { id: 'vorjahresverluste',            label: '6 Vorjahresverluste (gemäss separater Aufstellung)', typ: 'betrag', acroField: 'a.gewinn.ss.26', acroFieldBund: 'a.gewinn.ss.26_bs' },
        { id: 'anteil_ausserkantonal',        label: '9 Ausländischer bzw. ausserkantonaler Anteil',  typ: 'betrag', acroField: 'a.gewinn.ss.32', acroFieldBund: 'a.gewinn.ss.32_bs' },
        { id: 'beteiligungsabzug_pct',        label: '10 Beteiligungsabzug in %',                     typ: 'zahl',   acroField: 'a.gewinn.ss.31', acroFieldBund: 'a.gewinn.ss.31_bs' },
      ],
    },

    {
      id: 'reingewinn_bund',
      titel: 'A. Reingewinn – abweichende Bundessteuer-Werte (optional)',
      hinweis: 'Leer lassen, wenn Bund und Staat identisch sind – dann wird der Staatssteuer-Wert gespiegelt.',
      felder: [
        { id: 'reingewinn_buch_bund',      label: '1 Reingewinn (Bund)',                       typ: 'betrag' },
        { id: 'vorjahresverluste_bund',    label: '6 Vorjahresverluste (Bund)',                typ: 'betrag' },
        { id: 'anteil_ausserkantonal_bund',label: '9 Ausländischer Anteil (Bund)',             typ: 'betrag' },
        { id: 'beteiligungsabzug_pct_bund',label: '10 Beteiligungsabzug in % (Bund)',          typ: 'zahl'   },
        { id: 'steuerbar_manuell',         label: '8 Steuerbarer Reingewinn Staat – nur bei Steuerausscheidung abweichend erfassen', typ: 'betrag' },
        { id: 'steuerbar_manuell_bund',    label: '8 Steuerbarer Reingewinn Bund – nur bei Steuerausscheidung abweichend erfassen',  typ: 'betrag' },
      ],
    },

    {
      id: 'gewinnverwendung',
      titel: 'B. Gewinnverwendung (Seite 3)',
      felder: [
        { id: 'gv_vortrag_vorjahr',   label: '11.1 Gewinnvortrag aus dem Vorjahr',              typ: 'betrag', acroField: 'b.gewinn.0' },
        { id: 'gv_reingewinn_er',     label: '11.2 Reingewinn/Verlust gemäss Erfolgsrechnung',  typ: 'betrag', acroField: 'b.gewinn.1' },
        { id: 'gv_dividende_pct',     label: '11.4 Dividende in % des einbezahlten Kapitals',   typ: 'zahl',   acroField: 'b.dividende' },
        { id: 'gv_dividende',         label: '11.4 Dividende / Gewinnanteile (brutto)',         typ: 'betrag', acroField: 'b.gewinn.3' },
        { id: 'gv_tantiemen',         label: '11.5 Tantiemen',                                  typ: 'betrag', acroField: 'b.gewinn.4' },
        { id: 'gv_gesetzl_gewinnres', label: '11.6 Zuweisung an die gesetzliche Gewinnreserve', typ: 'betrag', acroField: 'b.gewinn.5' },
        { id: 'gv_freiw_gewinnres',   label: '11.7 Zuweisung an die freiwillige Gewinnreserve', typ: 'betrag', acroField: 'b.gewinn.6' },
        { id: 'gv_vorsorge',          label: '11.8 Zuwendungen an Vorsorgeeinrichtungen',       typ: 'betrag', acroField: 'b.gewinn.7' },
        { id: 'gv_gemeinnuetzig',     label: '11.9 Gemeinnützige Zuwendungen',                  typ: 'betrag', acroField: 'b.gewinn.8' },
        { id: 'gv_bez_10',            label: '11.10 Bezeichnung',                               typ: 'text',   acroField: 'b.gewinn.bezeichnung.10' },
        { id: 'gv_betrag_10',         label: '11.10 Betrag',                                    typ: 'betrag', acroField: 'b.gewinn.9' },
        { id: 'gv_bez_11',            label: '11.11 Bezeichnung',                               typ: 'text',   acroField: 'b.gewinn.bezeichnung.11' },
        { id: 'gv_betrag_11',         label: '11.11 Betrag',                                    typ: 'betrag', acroField: 'b.gewinn.10' },
      ],
    },

    {
      id: 'eigenkapital',
      titel: 'C. Eigenkapital (Seite 3)',
      felder: [
        { id: 'ek_stichtag',          label: 'Stichtag der Schlussbilanz (nach Gewinnverwendung)', typ: 'datum', acroField: 'c.ek.ss.stichtag', acroFieldBund: 'c.ek.ss.stichtag_bs' },
        { id: 'ek_kapital',           label: '12 Einbezahltes Grund-/Gesellschaftskapital',    typ: 'betrag', acroField: 'c.ek.ss.betrag.0',  acroFieldBund: 'c.ek.ss.betrag.0_bs' },
        { id: 'ek_gesetzl_kapitalres',label: '13.1 Gesetzliche Kapitalreserve',                typ: 'betrag', acroField: 'c.ek.ss.betrag.1',  acroFieldBund: 'c.ek.ss.betrag.1_bs' },
        { id: 'ek_gesetzl_gewinnres', label: '13.2 Gesetzliche Gewinnreserve',                 typ: 'betrag', acroField: 'c.ek.ss.betrag.2',  acroFieldBund: 'c.ek.ss.betrag.2_bs' },
        { id: 'ek_freiw_gewinnres',   label: '13.3 Freiwillige Gewinnreserve',                 typ: 'betrag', acroField: 'c.ek.ss.betrag.3',  acroFieldBund: 'c.ek.ss.betrag.3_bs' },
        { id: 'ek_eigene_kapitalanteile', label: '13.4 Eigene Kapitalanteile (wird abgezogen)', typ: 'betrag', acroField: 'c.ek.ss.betrag.4', acroFieldBund: 'c.ek.ss.betrag.4_bs' },
        { id: 'ek_bez_135',           label: '13.5 Bezeichnung',                               typ: 'text',   acroField: 'c.ek.bezeichnung.5' },
        { id: 'ek_betrag_135',        label: '13.5 Betrag',                                    typ: 'betrag', acroField: 'c.ek.ss.betrag.5',  acroFieldBund: 'c.ek.ss.betrag.5_bs' },
        { id: 'ek_gewinnvortrag',     label: '13.6 Gewinnvortrag',                             typ: 'betrag', acroField: 'c.ek.ss.betrag.6',  acroFieldBund: 'c.ek.ss.betrag.6_bs' },
        { id: 'ek_bez_141',           label: '14.1 Bezeichnung (als Gewinn versteuerte stille Reserven)', typ: 'text', acroField: 'c.ek.bezeichnung.8' },
        { id: 'ek_betrag_141',        label: '14.1 Betrag',                                    typ: 'betrag', acroField: 'c.ek.ss.betrag.8',  acroFieldBund: 'c.ek.ss.betrag.8_bs' },
        { id: 'ek_bez_142',           label: '14.2 Bezeichnung',                               typ: 'text',   acroField: 'c.ek.bezeichnung.9' },
        { id: 'ek_betrag_142',        label: '14.2 Betrag',                                    typ: 'betrag', acroField: 'c.ek.ss.betrag.9',  acroFieldBund: 'c.ek.ss.betrag.9_bs' },
        { id: 'ek_bez_143',           label: '14.3 Bezeichnung',                               typ: 'text',   acroField: 'c.ek.bezeichnung.10' },
        { id: 'ek_betrag_143',        label: '14.3 Betrag',                                    typ: 'betrag', acroField: 'c.ek.ss.betrag.10', acroFieldBund: 'c.ek.ss.betrag.10_bs' },
        { id: 'ek_verdecktes_ek',     label: '15 Verdecktes Eigenkapital',                     typ: 'betrag', acroField: 'c.ek.ss.betrag.14_1', acroFieldBund: 'c.ek.ss.betrag.14_1_bs' },
        { id: 'ek_verlustvortrag',    label: '17 Verlustvortrag (wird abgezogen)',             typ: 'betrag', acroField: 'c.ek.ss.betrag.16', acroFieldBund: 'c.ek.ss.betrag.16_bs' },
        { id: 'ek_ermaessigung',      label: '20 Ermässigung gemäss Formular E',               typ: 'betrag', acroField: 'c.ek.ss.betrag.20' },
        { id: 'ek_steuerbar_manuell', label: '22 Steuerbares Eigenkapital ZH – nur bei Steuerausscheidung abweichend erfassen', typ: 'betrag' },
      ],
    },

    {
      id: 'weitere',
      titel: 'D. Weitere Angaben (Seite 4)',
      felder: [
        { id: 'ab_jahr_1',   label: '23.1 Jahr der Aufwertung',      typ: 'text',   acroField: 'd.ab.aktiven.jahr.0' },
        { id: 'ab_bez_1',    label: '23.1 Bezeichnung des Aktivums', typ: 'text',   acroField: 'd.ab.aktiven.bezeichnung.0' },
        { id: 'ab_auf_1',    label: '23.1 Aufwertungsbetrag',        typ: 'betrag', acroField: 'd.ab.aktiven.betrag.auf.0' },
        { id: 'ab_ab_1',     label: '23.1 Abschreibungsbetrag',      typ: 'betrag', acroField: 'd.ab.aktiven.betrag.ab.0' },
        { id: 'ab_jahr_2',   label: '23.2 Jahr der Aufwertung',      typ: 'text',   acroField: 'd.ab.aktiven.jahr.1' },
        { id: 'ab_bez_2',    label: '23.2 Bezeichnung des Aktivums', typ: 'text',   acroField: 'd.ab.aktiven.bezeichnung.1' },
        { id: 'ab_auf_2',    label: '23.2 Aufwertungsbetrag',        typ: 'betrag', acroField: 'd.ab.aktiven.betrag.auf.1' },
        { id: 'ab_ab_2',     label: '23.2 Abschreibungsbetrag',      typ: 'betrag', acroField: 'd.ab.aktiven.betrag.ab.1' },
        { id: 'ab_jahr_3',   label: '23.3 Jahr der Aufwertung',      typ: 'text',   acroField: 'd.ab.aktiven.jahr.2' },
        { id: 'ab_bez_3',    label: '23.3 Bezeichnung des Aktivums', typ: 'text',   acroField: 'd.ab.aktiven.bezeichnung.2' },
        { id: 'ab_auf_3',    label: '23.3 Aufwertungsbetrag',        typ: 'betrag', acroField: 'd.ab.aktiven.betrag.auf.2' },
        { id: 'ab_ab_3',     label: '23.3 Abschreibungsbetrag',      typ: 'betrag', acroField: 'd.ab.aktiven.betrag.ab.2' },
        { id: 'gestehungskosten_72a', label: '24 Gestehungskosten massgeblicher Beteiligungen verändert?', typ: 'select',
          acroRadio: 'd.frage_1.check', optionen: ['nein', 'ja, gemäss beiliegender Aufstellung'],
          acroRadioWerte: { 'nein': '1', 'ja, gemäss beiliegender Aufstellung': '2' } },
        { id: 'bemerkungen', label: 'Bemerkungen',                   typ: 'textarea', acroField: 'allg.bemerkungen', schriftgroesse: 9 },
        { id: 'beilage_1',   label: 'Weitere Beilage 1',             typ: 'text',   acroField: 'allg.beilagen.0', schriftgroesse: 9 },
        { id: 'beilage_2',   label: 'Weitere Beilage 2',             typ: 'text',   acroField: 'allg.beilagen.1', schriftgroesse: 9 },
        { id: 'beilage_3',   label: 'Weitere Beilage 3',             typ: 'text',   acroField: 'allg.beilagen.2', schriftgroesse: 9 },
        { id: 'ort_datum',   label: 'Ort und Datum',                 typ: 'text',   acroField: 'allg.us.datum', schriftgroesse: 9 },
      ],
    },
  ],

  // ── Summen, die im Original das eingebettete PDF-JavaScript rechnet ────────
  // `col: 'bs'` greift automatisch auf `<id>_bund` zu, falls dort etwas steht.
  // Verweise auf frühere `id`s dieser Liste sind erlaubt (Reihenfolge zählt).
  computed: [
    // Ziffer 3 = Ziffer 1 + alle Aufrechnungen
    { id: 'z3', col: 'ss', acroField: 'a.gewinn.ss.16',    plus: ['reingewinn_buch', ...AUFRECHNUNGEN, 'aufr_hoeherbew_grundst_staat'] },
    { id: 'z3', col: 'bs', acroField: 'a.gewinn.ss.16_bs', plus: ['reingewinn_buch', ...AUFRECHNUNGEN, 'aufr_hoeherbew_grundst_bund'] },
    // Ziffer 4.3 = Total der Abzüge
    { id: 'z43', col: 'ss', acroField: 'a.gewinn.ss.24',    plus: [...ABZUEGE, 'abzug_gewinne_liegenschaften'] },
    { id: 'z43', col: 'bs', acroField: 'a.gewinn.ss.24_bs', plus: [...ABZUEGE] },
    // Ziffer 5 = Ziffer 3 − Ziffer 4.3
    { id: 'z5', col: 'ss', acroField: 'a.gewinn.ss.25',    plus: ['z3'], minus: ['z43'] },
    { id: 'z5', col: 'bs', acroField: 'a.gewinn.ss.25_bs', plus: ['z3'], minus: ['z43'] },
    // Ziffer 7 = Ziffer 5 − Ziffer 6
    { id: 'z7', col: 'ss', acroField: 'a.gewinn.ss.27',    plus: ['z5'], minus: ['vorjahresverluste'] },
    { id: 'z7', col: 'bs', acroField: 'a.gewinn.ss.27_bs', plus: ['z5'], minus: ['vorjahresverluste'] },
    // Ziffer 8 = Ziffer 7 − Ziffer 9 (bei Steuerausscheidung manuell übersteuerbar)
    { id: 'z8', col: 'ss', acroField: 'a.gewinn.ss.29',    plus: ['z7'], minus: ['anteil_ausserkantonal'], manual: 'steuerbar_manuell' },
    { id: 'z8', col: 'bs', acroField: 'a.gewinn.ss.29_bs', plus: ['z7'], minus: ['anteil_ausserkantonal'], manual: 'steuerbar_manuell_bund' },

    // Ziffer 11.3 = 11.1 + 11.2
    { id: 'z113', col: 'ss', acroField: 'b.gewinn.2', plus: ['gv_vortrag_vorjahr', 'gv_reingewinn_er'] },
    // Ziffer 11.12 = Total Gewinnverwendung (11.4 bis 11.11)
    { id: 'z1112', col: 'ss', acroField: 'b.gewinn.12', plus: [
      'gv_dividende', 'gv_tantiemen', 'gv_gesetzl_gewinnres', 'gv_freiw_gewinnres',
      'gv_vorsorge', 'gv_gemeinnuetzig', 'gv_betrag_10', 'gv_betrag_11',
    ] },
    // Ziffer 11.13 = 11.3 − 11.12
    { id: 'z1113', col: 'ss', acroField: 'b.gewinn.13', plus: ['z113'], minus: ['z1112'] },

    // Ziffer 16 = Total der Ziffern 12 bis 15 (13.4 wird abgezogen)
    { id: 'z16', col: 'ss', acroField: 'c.ek.ss.betrag.15',    plus: EK_POSITIONEN, minus: ['ek_eigene_kapitalanteile'] },
    { id: 'z16', col: 'bs', acroField: 'c.ek.ss.betrag.15_bs', plus: EK_POSITIONEN, minus: ['ek_eigene_kapitalanteile'] },
    // Ziffer 18 = Ziffer 16 − Ziffer 17
    { id: 'z18', col: 'ss', acroField: 'c.ek.ss.betrag.17',    plus: ['z16'], minus: ['ek_verlustvortrag'] },
    { id: 'z18', col: 'bs', acroField: 'c.ek.ss.betrag.17_bs', plus: ['z16'], minus: ['ek_verlustvortrag'] },
    // Ziffer 19 = Ziffer 18, mindestens aber das einbezahlte Kapital (Ziffer 12)
    { id: 'z19', col: 'ss', acroField: 'c.ek.ss.betrag.18', plus: ['z18'], mindestens: 'ek_kapital' },
    // Ziffer 21 = Ziffer 19 − Ziffer 20
    { id: 'z21', col: 'ss', acroField: 'c.ek.ss.betrag.21', plus: ['z19'], minus: ['ek_ermaessigung'] },
    // Ziffer 22 = Ziffer 21 (bei Steuerausscheidung manuell übersteuerbar)
    { id: 'z22', col: 'ss', acroField: 'c.ek.ss.betrag.19', plus: ['z21'], manual: 'ek_steuerbar_manuell' },
  ],

  preFillHooks: [
    { acroField: 'allg.firma.hauptsitz_1', fromFields: ['hauptsitz_plz', 'hauptsitz_ort'], sep: ' ' },
    { acroField: 'allg.personalien', schriftgroesse: 11, lines: [
      { fromField: 'firma_name' },
      { fromField: 'hauptsitz' },
      { fromFields: ['hauptsitz_plz', 'hauptsitz_ort'], sep: ' ' },
    ]},
    { whenField: 'vertreter_artis', acroField: 'allg.vertreter.adresse',   text: 'Artis Treuhand GmbH' },
    { whenField: 'vertreter_artis', acroField: 'allg.vertreter.adresse_1', text: 'Bahnhofstrasse 19' },
    { whenField: 'vertreter_artis', acroField: 'allg.vertreter.adresse_2', text: '9320 Arbon' },
    { whenField: 'vertreter_artis', acroField: 'allg.vertreter.telefon',   text: '071 555 22 11' },
  ],
};
