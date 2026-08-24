#!/usr/bin/env node
/**
 * Umsatz-Report für August 2026
 * Liest alle Debitoren-Belege im August und summiert auf
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Umgebungsvariablen fehlen:');
  console.error('   - VITE_SUPABASE_URL');
  console.error('   - VITE_SUPABASE_ANON_KEY');
  console.error('\n💡 Kopiere diese aus .env.local oder der Vercel-Konfiguration');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function generateAugustReport() {
  console.log('📊 Umsatz-Bericht August 2026\n');
  console.log('=====================================\n');

  try {
    // Alle Mandanten abrufen
    const { data: mandanten, error: mandantErr } = await supabase
      .from('fibu_mandanten')
      .select('id, name')
      .eq('aktiv', true);

    if (mandantErr) throw mandantErr;
    if (!mandanten?.length) {
      console.log('ℹ️  Keine aktiven Mandanten gefunden');
      return;
    }

    let grandTotal = 0;

    for (const mandant of mandanten) {
      console.log(`📋 Mandant: ${mandant.name}`);
      console.log('-'.repeat(50));

      // Alle Debitoren-Belege im August 2026
      const { data: belege, error: belegeErr } = await supabase
        .from('fibu_debitoren_belege')
        .select(
          `
          id, beleg_nr, belegdatum, betrag_brutto, betrag_netto, betrag_mwst,
          status, belegtyp, kunde:fibu_kunden(id, name, nr)
          `
        )
        .eq('mandant_id', mandant.id)
        .gte('belegdatum', '2026-08-01')
        .lte('belegdatum', '2026-08-31')
        .order('belegdatum', { ascending: true });

      if (belegeErr) throw belegeErr;

      if (!belege?.length) {
        console.log('  ℹ️  Keine Rechnungen im August\n');
        continue;
      }

      // Nach Status gruppieren
      const byStatus = {};
      let mandantTotal = 0;

      for (const beleg of belege) {
        if (!byStatus[beleg.status]) {
          byStatus[beleg.status] = { count: 0, summe: 0, details: [] };
        }
        byStatus[beleg.status].count++;
        byStatus[beleg.status].summe += beleg.betrag_brutto;
        byStatus[beleg.status].details.push(beleg);
        mandantTotal += beleg.betrag_brutto;
      }

      // Output nach Status
      const statusOrder = ['entwurf', 'offen', 'teilbezahlt', 'bezahlt', 'storniert'];
      for (const status of statusOrder) {
        if (byStatus[status]) {
          const data = byStatus[status];
          const emoji = {
            entwurf: '📝',
            offen: '⏳',
            teilbezahlt: '💰',
            bezahlt: '✅',
            storniert: '❌',
          }[status];

          console.log(`\n  ${emoji} ${status.toUpperCase()} (${data.count})`);
          console.log(`     Summe: CHF ${data.summe.toLocaleString('de-CH', { minimumFractionDigits: 2 })}`);

          // Detail-Liste
          for (const beleg of data.details) {
            const typ = beleg.belegtyp === 'gutschrift' ? ' (Gutschrift)' : '';
            console.log(
              `       • ${beleg.beleg_nr} | ${beleg.belegdatum} | ${beleg.kunde.name} | ` +
              `CHF ${beleg.betrag_brutto.toLocaleString('de-CH', { minimumFractionDigits: 2 })}${typ}`
            );
          }
        }
      }

      console.log(`\n  📊 Mandant-Total (Brutto): CHF ${mandantTotal.toLocaleString('de-CH', { minimumFractionDigits: 2 })}`);
      grandTotal += mandantTotal;
      console.log('\n');
    }

    console.log('=====================================');
    console.log(`\n🎯 GRAND TOTAL AUGUST 2026: CHF ${grandTotal.toLocaleString('de-CH', { minimumFractionDigits: 2 })}\n`);

  } catch (error) {
    console.error('❌ Fehler:', error.message);
    process.exit(1);
  }
}

generateAugustReport();
