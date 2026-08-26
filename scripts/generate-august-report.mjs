#!/usr/bin/env node
/**
 * August-Umsatz-Report Generator
 * Nutzt die bestehende DebitorenUebersicht-Komponenten-Logik als Template
 */

import fs from 'fs';
import path from 'path';

// Report-Template
const reportTemplate = `
═══════════════════════════════════════════════════════════════
📊 UMSATZBERICHT AUGUST 2026
═══════════════════════════════════════════════════════════════

HINWEIS: Dies ist ein Template-Report für die Fibu-Struktur.
Für echte Daten: Bitte einen Mandanten auswählen und den Report
über die Fibu-UI (Debitoren > Auswertungen) generieren.

─────────────────────────────────────────────────────────────

📋 DATENSTRUKTUR (aus fibu_debitoren_belege):

Tabelle: fibu_debitoren_belege
├── belegdatum (DATE)           ← Filter: 2026-08-01 bis 2026-08-31
├── betrag_netto (NUMERIC)
├── betrag_mwst (NUMERIC)
├── betrag_brutto (NUMERIC)     ← Summe für Report
├── status (entwurf, offen, teilbezahlt, bezahlt, storniert)
├── belegtyp (rechnung, gutschrift)
└── kunde (foreign key)

─────────────────────────────────────────────────────────────

📈 BEISPIEL-AUSWERTUNG:

Entwürfe:
  • DR-2026-0042 | 05.08.2026 | Musterkunde AG | CHF 2,450.00
  • DR-2026-0043 | 07.08.2026 | Beispiel GmbH  | CHF 1,200.00
  ──────────────────────────────────────────────────────────
    Summe Entwürfe: CHF 3,650.00

Offene Rechnungen:
  • DR-2026-0041 | 02.08.2026 | Test-Kunde Ltd | CHF 5,500.00
  ──────────────────────────────────────────────────────────
    Summe Offen: CHF 5,500.00

Teilbezahlt:
  • DR-2026-0038 | 10.08.2026 | Partner KG    | CHF 3,300.00
  ──────────────────────────────────────────────────────────
    Summe Teilbezahlt: CHF 3,300.00

Bezahlt:
  • DR-2026-0035 | 01.08.2026 | Kundenname    | CHF 7,200.00
  • DR-2026-0036 | 08.08.2026 | Anderer Name  | CHF 4,100.00
  ──────────────────────────────────────────────────────────
    Summe Bezahlt: CHF 11,300.00

─────────────────────────────────────────────────────────────

🎯 AUGUST 2026 ZUSAMMENFASSUNG:

Entwürfe:       CHF   3,650.00
Offen:          CHF   5,500.00
Teilbezahlt:    CHF   3,300.00
Bezahlt:        CHF  11,300.00
Storniert:      CHF       0.00
                ──────────────
GESAMT:         CHF  23,750.00

Davon:
  • Netto:      CHF  21,963.00
  • MwSt (8.1%): CHF   1,787.00

─────────────────────────────────────────────────────────────

⚙️ SQL QUERY zur Abfrage:

SELECT
  b.beleg_nr,
  b.belegdatum,
  k.name AS kunde,
  b.betrag_netto,
  b.betrag_mwst,
  b.betrag_brutto,
  b.status,
  b.belegtyp
FROM fibu_debitoren_belege b
LEFT JOIN fibu_kunden k ON b.kunde_id = k.id
WHERE b.mandant_id = 'YOUR_MANDANT_ID'
  AND b.belegdatum BETWEEN '2026-08-01' AND '2026-08-31'
  AND b.belegtyp = 'rechnung'  -- Gutschriften ausschließen
ORDER BY b.belegdatum ASC;

─────────────────────────────────────────────────────────────

💾 ABFRAGE-METHODE in der App:

// In src/modules/fibu/api/index.js
const debitorenApi = {
  list: async (mandantId) => {
    const { data, error } = await supabase
      .from('fibu_debitoren_belege')
      .select('*, kunde:fibu_kunden(id,name,nr,ort)')
      .eq('mandant_id', mandantId)
      .order('belegdatum', { ascending: false });

    if (error) throw error;
    return data ?? [];
  }
};

// Dann filtern auf August:
const augustBelege = belege.filter(b => {
  const d = new Date(b.belegdatum);
  return d.getMonth() === 7 && d.getFullYear() === 2026; // 0-basiert
});

─────────────────────────────────────────────────────────────

🔧 ZUM ECHTEN REPORT:

1. Fibu-Modul öffnen: https://smartis.me/fibu
2. Mandanten auswählen
3. Debitoren-Übersicht aufrufen
4. Zeitraum-Filter auf August 2026 setzen
5. Bericht exportieren (PDF/Excel via MonatsrapportPanel)

═══════════════════════════════════════════════════════════════
`;

// Schreibe Report in Datei
const reportPath = path.join(process.cwd(), 'AUGUST_2026_UMSATZ_REPORT.txt');
fs.writeFileSync(reportPath, reportTemplate);

console.log(reportTemplate);
console.log(`\n✅ Report gespeichert in: ${reportPath}\n`);
