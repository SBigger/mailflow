// Auswertung: Aufwand ↔ Rechnung
// - Pauschalprojekte: effektiver Aufwand (rapportierte Stunden × Ansatz) vs.
//   tatsächlich fakturierter Betrag -> Marge (deckt die Pauschale den Aufwand?).
// - Effektiv-Projekte: rapportierte Stunden vs. effektiv abgerechnete (verrechnete)
//   Rapportierungen -> offener/nicht fakturierter Anteil.
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { leProject, leTimeEntry, effectiveHours } from '@/lib/leApi';
import { supabase } from '@/api/supabaseClient';

const chf = (n) => (Number(n) || 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const h1 = (n) => (Number(n) || 0).toLocaleString('de-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (n) => (n == null || !isFinite(n)) ? '–' : `${(Number(n)).toLocaleString('de-CH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}%`;

const GREEN = '#2d5a2d';
const RED = '#b0242b';

export default function GegenueberstellungPanel() {
  const nowYear = new Date().getFullYear();
  const [year, setYear] = useState(nowYear);
  const fromIso = `${year}-01-01`;
  const toIso = `${year}-12-31`;

  const projectsQ = useQuery({
    queryKey: ['le', 'projects', 'gegenueber'],
    queryFn: () => leProject.list({ status: null }),
  });
  const entriesQ = useQuery({
    queryKey: ['le', 'entries', 'gegenueber', fromIso, toIso],
    queryFn: () => leTimeEntry.listForRangeAll(fromIso, toIso, {}),
  });
  const invoicesQ = useQuery({
    queryKey: ['le', 'invoices', 'gegenueber', fromIso, toIso],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('le_invoice')
        .select('id, project_id, subtotal, invoice_type, status, issue_date')
        .gte('issue_date', fromIso)
        .lte('issue_date', toIso)
        .not('status', 'in', '(entwurf,storniert)');
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = useMemo(() => {
    const projects = projectsQ.data ?? [];
    const entries = entriesQ.data ?? [];
    const invoices = invoicesQ.data ?? [];

    const byId = new Map();
    for (const p of projects) {
      byId.set(p.id, {
        proj: p,
        aufwandHours: 0, aufwandChf: 0,
        verrechnetHours: 0, verrechnetChf: 0,
        fakturiertChf: 0,
      });
    }
    for (const e of entries) {
      const r = byId.get(e.project_id);
      if (!r) continue;
      const hrs = effectiveHours(e);
      const val = hrs * Number(e.rate_snapshot || 0);
      r.aufwandHours += hrs;
      r.aufwandChf += val;
      if (e.status === 'verrechnet') {
        r.verrechnetHours += hrs;
        r.verrechnetChf += val;
      }
    }
    for (const inv of invoices) {
      const r = byId.get(inv.project_id);
      if (!r) continue;
      // Gutschriften haben negatives subtotal -> reduzieren korrekt
      r.fakturiertChf += Number(inv.subtotal || 0);
    }

    const all = [...byId.values()].filter(
      (r) => r.aufwandHours > 0 || r.fakturiertChf !== 0
    );
    return {
      pauschal: all.filter((r) => r.proj.billing_mode === 'pauschal')
        .sort((a, b) => (a.proj.name ?? '').localeCompare(b.proj.name ?? '')),
      effektiv: all.filter((r) => r.proj.billing_mode !== 'pauschal')
        .sort((a, b) => (a.proj.name ?? '').localeCompare(b.proj.name ?? '')),
    };
  }, [projectsQ.data, entriesQ.data, invoicesQ.data]);

  const loading = projectsQ.isLoading || entriesQ.isLoading || invoicesQ.isLoading;
  const error = projectsQ.error || entriesQ.error || invoicesQ.error;

  const years = [];
  for (let y = nowYear + 1; y >= nowYear - 5; y--) years.push(y);

  // Summen
  const sumP = rows.pauschal.reduce((a, r) => ({
    aufwand: a.aufwand + r.aufwandChf, fakt: a.fakt + r.fakturiertChf,
  }), { aufwand: 0, fakt: 0 });
  const sumE = rows.effektiv.reduce((a, r) => ({
    rap: a.rap + r.aufwandChf, abg: a.abg + r.verrechnetChf,
  }), { rap: 0, abg: 0 });

  return (
    <div className="p-4 space-y-6">
      {/* Jahr-Auswahl */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-zinc-500">Jahr</span>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="border rounded-md px-2 py-1 text-sm bg-white"
          style={{ borderColor: '#d9e0d9' }}
        >
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {error && <div className="text-sm" style={{ color: RED }}>Fehler: {String(error.message || error)}</div>}
      {loading && <div className="text-sm text-zinc-400">Lädt …</div>}

      {!loading && !error && (
        <>
          {/* Pauschalprojekte */}
          <section>
            <h2 className="text-sm font-semibold text-zinc-800 mb-1">Pauschalprojekte — Aufwand vs. Rechnung</h2>
            <p className="text-xs text-zinc-500 mb-2">Deckt die Pauschale den effektiven Aufwand? Marge = Fakturiert − Aufwand.</p>
            <div className="overflow-x-auto border rounded-lg bg-white" style={{ borderColor: '#e4e7e4' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 border-b" style={{ borderColor: '#eef0ee' }}>
                    <th className="px-3 py-2 font-medium">Projekt</th>
                    <th className="px-3 py-2 font-medium">Kunde</th>
                    <th className="px-3 py-2 font-medium text-right">Aufwand h</th>
                    <th className="px-3 py-2 font-medium text-right">Aufwand CHF</th>
                    <th className="px-3 py-2 font-medium text-right">Fakturiert CHF</th>
                    <th className="px-3 py-2 font-medium text-right">Marge CHF</th>
                    <th className="px-3 py-2 font-medium text-right">Marge %</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.pauschal.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-4 text-center text-zinc-400">Keine Pauschalprojekte mit Aufwand/Rechnung in {year}.</td></tr>
                  )}
                  {rows.pauschal.map((r) => {
                    const marge = r.fakturiertChf - r.aufwandChf;
                    const margePct = r.fakturiertChf ? (marge / r.fakturiertChf) * 100 : null;
                    return (
                      <tr key={r.proj.id} className="border-t" style={{ borderColor: '#f2f4f2' }}>
                        <td className="px-3 py-2 font-medium text-zinc-800">{r.proj.name}</td>
                        <td className="px-3 py-2 text-zinc-500">{r.proj.customer?.company_name ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{h1(r.aufwandHours)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{chf(r.aufwandChf)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium" style={{ color: GREEN }}>{chf(r.fakturiertChf)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium" style={{ color: marge < 0 ? RED : GREEN }}>{chf(marge)}</td>
                        <td className="px-3 py-2 text-right tabular-nums" style={{ color: marge < 0 ? RED : '#555' }}>{pct(margePct)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                {rows.pauschal.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 font-semibold" style={{ borderColor: '#e4e7e4' }}>
                      <td className="px-3 py-2" colSpan={3}>Total</td>
                      <td className="px-3 py-2 text-right tabular-nums">{chf(sumP.aufwand)}</td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: GREEN }}>{chf(sumP.fakt)}</td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: (sumP.fakt - sumP.aufwand) < 0 ? RED : GREEN }}>{chf(sumP.fakt - sumP.aufwand)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pct(sumP.fakt ? ((sumP.fakt - sumP.aufwand) / sumP.fakt) * 100 : null)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          {/* Effektiv-Projekte */}
          <section>
            <h2 className="text-sm font-semibold text-zinc-800 mb-1">Effektiv-Projekte — Rapportiert vs. Abgerechnet</h2>
            <p className="text-xs text-zinc-500 mb-2">Rapportierte Stunden gegen die effektiv verrechneten. Offen = noch nicht fakturierter Aufwand.</p>
            <div className="overflow-x-auto border rounded-lg bg-white" style={{ borderColor: '#e4e7e4' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 border-b" style={{ borderColor: '#eef0ee' }}>
                    <th className="px-3 py-2 font-medium">Projekt</th>
                    <th className="px-3 py-2 font-medium">Kunde</th>
                    <th className="px-3 py-2 font-medium text-right">Rapportiert h</th>
                    <th className="px-3 py-2 font-medium text-right">Rapportiert CHF</th>
                    <th className="px-3 py-2 font-medium text-right">Abgerechnet CHF</th>
                    <th className="px-3 py-2 font-medium text-right">Offen CHF</th>
                    <th className="px-3 py-2 font-medium text-right">Abger. %</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.effektiv.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-4 text-center text-zinc-400">Keine Effektiv-Projekte mit Aufwand in {year}.</td></tr>
                  )}
                  {rows.effektiv.map((r) => {
                    const offen = r.aufwandChf - r.verrechnetChf;
                    const abgPct = r.aufwandChf ? (r.verrechnetChf / r.aufwandChf) * 100 : null;
                    return (
                      <tr key={r.proj.id} className="border-t" style={{ borderColor: '#f2f4f2' }}>
                        <td className="px-3 py-2 font-medium text-zinc-800">{r.proj.name}</td>
                        <td className="px-3 py-2 text-zinc-500">{r.proj.customer?.company_name ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{h1(r.aufwandHours)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{chf(r.aufwandChf)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium" style={{ color: GREEN }}>{chf(r.verrechnetChf)}</td>
                        <td className="px-3 py-2 text-right tabular-nums" style={{ color: offen > 0.005 ? RED : '#555' }}>{chf(offen)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(abgPct)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                {rows.effektiv.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 font-semibold" style={{ borderColor: '#e4e7e4' }}>
                      <td className="px-3 py-2" colSpan={3}>Total</td>
                      <td className="px-3 py-2 text-right tabular-nums">{chf(sumE.rap)}</td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: GREEN }}>{chf(sumE.abg)}</td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: (sumE.rap - sumE.abg) > 0.005 ? RED : '#555' }}>{chf(sumE.rap - sumE.abg)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pct(sumE.rap ? (sumE.abg / sumE.rap) * 100 : null)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
