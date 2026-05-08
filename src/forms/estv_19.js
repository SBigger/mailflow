// ESTV Formular 19 – Angaben über Beteiligungen (Direkte Bundessteuer)
// AcroForm-PDF

export const FAVORITEN_IDS = new Set([
  'firma_name', 'uid', 'gj_von', 'gj_bis',
  'beteiligung_1_name', 'beteiligung_1_quote', 'beteiligung_1_bw', 'beteiligung_1_ertrag',
  'bruttoertrag_total', 'beteiligungsabzug_chf',
]);

export const ESTV_19 = {
  kanton: 'ESTV',
  name: 'ESTV – Formular 19 (Beteiligungen)',
  pdfUrl: '/pdf-estv/dam/estv/de/dokumente/dbst/formulare/dbst-form-19-2024-de.pdf',
  pdfUrl19a: 'https://www.estv.admin.ch/dam/estv/de/dokumente/dbst/formulare/dbst-form-19a-2024-de.pdf.download.pdf/dbst-form-19a-2024-de.pdf',
  typ: 'acroform',
  sections: [
    {
      id: 'angaben_steuerpflichtiger',
      titel: 'Angaben Steuerpflichtiger',
      felder: [
        { id: 'firma_name',      label: 'Firmenbezeichnung',            typ: 'text',  pflicht: true,  acroField: 'Firmenbezeichnung' },
        { id: 'uid',             label: 'UID-Nummer (CHE-xxx.xxx.xxx)', typ: 'text',  pflicht: false, acroField: 'UID' },
        { id: 'ort',             label: 'Sitz',                         typ: 'text',  pflicht: false, acroField: 'Sitz' },
        { id: 'kanton_sitz',     label: 'Kanton',                       typ: 'text',  pflicht: false, acroField: 'KantonSitz' },
        { id: 'gj_von',          label: 'Geschäftsjahr von',            typ: 'datum', pflicht: false, acroField: 'GeschaeftsjahrVon' },
        { id: 'gj_bis',          label: 'Geschäftsjahr bis',            typ: 'datum', pflicht: false, acroField: 'GeschaeftsjahrBis' },
      ],
    },
    {
      id: 'beteiligungen',
      titel: 'Beteiligungen (je Beteiligung eine Zeile)',
      felder: [
        { id: 'beteiligung_1_name',      label: 'Beteiligung 1: Firmenbezeichnung',     typ: 'text',   pflicht: false, acroField: 'Bet1Firma' },
        { id: 'beteiligung_1_sitz',      label: 'Beteiligung 1: Sitz',                  typ: 'text',   pflicht: false, acroField: 'Bet1Sitz' },
        { id: 'beteiligung_1_quote',     label: 'Beteiligung 1: Beteiligungsquote (%)', typ: 'zahl',   pflicht: false, acroField: 'Bet1Quote' },
        { id: 'beteiligung_1_bw',        label: 'Beteiligung 1: Buchwert (CHF)',         typ: 'betrag', pflicht: false, acroField: 'Bet1Buchwert' },
        { id: 'beteiligung_1_ertrag',    label: 'Beteiligung 1: Bruttoertrag (CHF)',     typ: 'betrag', pflicht: false, acroField: 'Bet1Ertrag' },
        { id: 'beteiligung_2_name',      label: 'Beteiligung 2: Firmenbezeichnung',     typ: 'text',   pflicht: false, acroField: 'Bet2Firma' },
        { id: 'beteiligung_2_sitz',      label: 'Beteiligung 2: Sitz',                  typ: 'text',   pflicht: false, acroField: 'Bet2Sitz' },
        { id: 'beteiligung_2_quote',     label: 'Beteiligung 2: Beteiligungsquote (%)', typ: 'zahl',   pflicht: false, acroField: 'Bet2Quote' },
        { id: 'beteiligung_2_bw',        label: 'Beteiligung 2: Buchwert (CHF)',         typ: 'betrag', pflicht: false, acroField: 'Bet2Buchwert' },
        { id: 'beteiligung_2_ertrag',    label: 'Beteiligung 2: Bruttoertrag (CHF)',     typ: 'betrag', pflicht: false, acroField: 'Bet2Ertrag' },
        { id: 'beteiligung_3_name',      label: 'Beteiligung 3: Firmenbezeichnung',     typ: 'text',   pflicht: false, acroField: 'Bet3Firma' },
        { id: 'beteiligung_3_sitz',      label: 'Beteiligung 3: Sitz',                  typ: 'text',   pflicht: false, acroField: 'Bet3Sitz' },
        { id: 'beteiligung_3_quote',     label: 'Beteiligung 3: Beteiligungsquote (%)', typ: 'zahl',   pflicht: false, acroField: 'Bet3Quote' },
        { id: 'beteiligung_3_bw',        label: 'Beteiligung 3: Buchwert (CHF)',         typ: 'betrag', pflicht: false, acroField: 'Bet3Buchwert' },
        { id: 'beteiligung_3_ertrag',    label: 'Beteiligung 3: Bruttoertrag (CHF)',     typ: 'betrag', pflicht: false, acroField: 'Bet3Ertrag' },
      ],
    },
    {
      id: 'bruttoertraege',
      titel: 'Bruttoerträge & Beteiligungsabzug',
      felder: [
        { id: 'bruttoertrag_total',       label: 'Bruttoertrag Beteiligungen total (CHF)',          typ: 'betrag', pflicht: false, acroField: 'BruttoertragTotal' },
        { id: 'nettoertrag_beteiligungen', label: 'Nettoertrag aus Beteiligungen (CHF)',             typ: 'betrag', pflicht: false, acroField: 'NettoertragBeteiligungen' },
        { id: 'reingewinn_vor_abzug',      label: 'Steuerbarer Reingewinn vor Beteiligungsabzug',   typ: 'betrag', pflicht: false, acroField: 'ReingewinnVorAbzug' },
        { id: 'beteiligungsabzug_chf',     label: 'Beteiligungsabzug (CHF)',                        typ: 'betrag', pflicht: false, acroField: 'Beteiligungsabzug' },
        { id: 'reingewinn_nach_abzug',     label: 'Steuerbarer Reingewinn nach Beteiligungsabzug',  typ: 'betrag', pflicht: false, acroField: 'ReingewinnNachAbzug' },
      ],
    },
  ],
};
