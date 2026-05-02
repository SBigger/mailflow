import React, { useEffect, useState, useMemo } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { supabase } from '@/api/supabaseClient';

const KLASSEN = [
  { nr: '1', label: 'Klasse 1 – Aktiven' },
  { nr: '2', label: 'Klasse 2 – Passiven' },
  { nr: '3', label: 'Klasse 3 – Betriebsertrag' },
  { nr: '4', label: 'Klasse 4 – Material- / Warenaufwand' },
  { nr: '5', label: 'Klasse 5 – Personalaufwand' },
  { nr: '6', label: 'Klasse 6 – Übriger Betriebsaufwand' },
  { nr: '7', label: 'Klasse 7 – Nebenbetrieb / Liegenschaften' },
  { nr: '8', label: 'Klasse 8 – Ausserordentliches' },
  { nr: '9', label: 'Klasse 9 – Abschlusskonten' },
];

const TYP_COLORS = {
  aktiv:      { bg: '#e8f4fd', color: '#1e6fa8' },
  passiv:     { bg: '#fdf0e8', color: '#a85a1e' },
  ertrag:     { bg: '#e8fdf0', color: '#1ea84f' },
  aufwand:    { bg: '#fde8e8', color: '#a81e1e' },
  abschluss:  { bg: '#f0e8fd', color: '#6b1ea8' },
};

function Toggle({ value, onChange, disabled }) {
  return (
    <div
      onClick={() => !disabled && onChange(!value)}
      title={value ? 'Aktiv – klicken zum Deaktivieren' : 'Inaktiv – klicken zum Aktivieren'}
      style={{
        width: 38, height: 22, borderRadius: 11,
        background: value ? '#7a9b7f' : '#d1d5db',
        position: 'relative', cursor: disabled ? 'default' : 'pointer',
        transition: 'background .15s', flexShrink: 0,
        opacity: disabled ? .5 : 1,
      }}
    >
      <div style={{
        position: 'absolute', top: 3, left: value ? 19 : 3,
        width: 16, height: 16, borderRadius: '50%',
        background: '#fff', transition: 'left .15s',
        boxShadow: '0 1px 3px rgba(0,0,0,.25)',
      }} />
    </div>
  );
}

export default function Kontenplan() {
  const { mandant, canWrite } = useMandant();
  const [konten, setKonten] = useState([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('alle'); // alle | aktiv | inaktiv
  const [collapsed, setCollapsed] = useState({});
  const [saving, setSaving] = useState({});

  useEffect(() => { if (mandant) load(); }, [mandant]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('fibu_konten')
      .select('*')
      .eq('mandant_id', mandant.id)
      .order('konto_nr');
    setKonten(data ?? []);
    setLoading(false);
  }

  async function handleToggle(konto) {
    if (!canWrite) return;
    setSaving(s => ({ ...s, [konto.id]: true }));
    const neu = !konto.aktiv;
    setKonten(prev => prev.map(k => k.id === konto.id ? { ...k, aktiv: neu } : k));
    await supabase.from('fibu_konten').update({ aktiv: neu }).eq('id', konto.id);
    setSaving(s => ({ ...s, [konto.id]: false }));
  }

  async function handleSeed() {
    setSeeding(true);
    await supabase.rpc('fibu_seed_kontenplan_ch_kmu', { p_mandant_id: mandant.id });
    await supabase.rpc('fibu_seed_mwst_codes', { p_mandant_id: mandant.id });
    await load();
    setSeeding(false);
  }

  const filtered = useMemo(() => {
    let list = konten;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(k => k.konto_nr.includes(q) || k.bezeichnung.toLowerCase().includes(q));
    }
    if (filter === 'aktiv') list = list.filter(k => k.aktiv);
    if (filter === 'inaktiv') list = list.filter(k => !k.aktiv);
    return list;
  }, [konten, search, filter]);

  const byKlasse = useMemo(() => {
    const map = {};
    KLASSEN.forEach(kl => { map[kl.nr] = []; });
    filtered.forEach(k => {
      const kl = k.konto_nr[0];
      if (map[kl]) map[kl].push(k);
    });
    return map;
  }, [filtered]);

  const aktiv = konten.filter(k => k.aktiv).length;
  const inaktiv = konten.length - aktiv;

  const s = {
    page: { padding: 28, fontFamily: "'Inter', system-ui, sans-serif", maxWidth: 1100 },
    header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 },
    title: { fontWeight: 700, fontSize: 20, color: '#1a1a2e', margin: 0 },
    kpi: { display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' },
    kpiBox: { background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, padding: '10px 18px', fontSize: 13 },
    controls: { display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' },
    search: { border: '1px solid #d4dcd4', borderRadius: 8, padding: '7px 12px', fontSize: 13, outline: 'none', width: 240, background: '#fff' },
    filterBtn: (active) => ({
      border: '1px solid #d4dcd4', borderRadius: 8, padding: '7px 14px', fontSize: 12,
      fontWeight: 500, cursor: 'pointer', background: active ? '#7a9b7f' : '#fff',
      color: active ? '#fff' : '#3d6641', transition: 'all .1s',
    }),
    seedBtn: {
      border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12,
      fontWeight: 500, cursor: 'pointer', background: '#e6ede6', color: '#3d6641',
      marginLeft: 'auto',
    },
    klasse: { marginBottom: 16 },
    klasseHeader: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#e6ede6', borderRadius: 8, cursor: 'pointer', marginBottom: 2, userSelect: 'none' },
    klasseLabel: { fontWeight: 600, fontSize: 12.5, color: '#3d6641', flex: 1 },
    klasseBadge: { fontSize: 11, color: '#6b826b', background: '#d4dcd4', borderRadius: 10, padding: '1px 7px' },
    table: { width: '100%', borderCollapse: 'collapse' },
    th: { fontSize: 11, fontWeight: 600, color: '#94a394', textAlign: 'left', padding: '5px 10px', borderBottom: '1px solid #f0f3f0' },
    td: { fontSize: 13, padding: '8px 10px', borderBottom: '1px solid #f7faf7', verticalAlign: 'middle' },
    nrCell: { fontWeight: 600, color: '#3d6641', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
    typBadge: (typ) => ({
      display: 'inline-block', fontSize: 10.5, fontWeight: 600,
      padding: '2px 7px', borderRadius: 5,
      background: TYP_COLORS[typ]?.bg ?? '#f0f0f0',
      color: TYP_COLORS[typ]?.color ?? '#666',
    }),
    mwstBadge: { display: 'inline-block', fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: '#e8f0fd', color: '#1e50a8' },
    empty: { fontSize: 12, color: '#94a394', padding: '10px 12px' },
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: '#7a9b7f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16 }}>📊</div>
        <h1 style={s.title}>Kontenplan</h1>
        <span style={{ fontSize: 12, color: '#94a394', marginLeft: 4 }}>KMU-Kontenrahmen CH (OR 2013)</span>
      </div>

      <div style={s.kpi}>
        <div style={s.kpiBox}><span style={{ color: '#94a394' }}>Total Konten</span> <strong style={{ marginLeft: 8 }}>{konten.length}</strong></div>
        <div style={s.kpiBox}><span style={{ color: '#7a9b7f' }}>Aktiv</span> <strong style={{ marginLeft: 8 }}>{aktiv}</strong></div>
        <div style={s.kpiBox}><span style={{ color: '#94a394' }}>Inaktiv</span> <strong style={{ marginLeft: 8 }}>{inaktiv}</strong></div>
      </div>

      <div style={s.controls}>
        <input
          style={s.search}
          placeholder="Suche Konto-Nr oder Bezeichnung…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {['alle', 'aktiv', 'inaktiv'].map(f => (
          <button key={f} style={s.filterBtn(filter === f)} onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <button style={s.seedBtn} onClick={handleSeed} disabled={seeding || !canWrite} title="Fehlende Standardkonten ergänzen">
          {seeding ? 'Ergänze…' : '⟳ Standardkonten ergänzen'}
        </button>
      </div>

      {loading ? (
        <div style={{ color: '#94a394', fontSize: 13 }}>Lade Kontenplan…</div>
      ) : (
        KLASSEN.map(kl => {
          const list = byKlasse[kl.nr] ?? [];
          if (list.length === 0 && search) return null;
          const open = !collapsed[kl.nr];
          return (
            <div key={kl.nr} style={s.klasse}>
              <div style={s.klasseHeader} onClick={() => setCollapsed(c => ({ ...c, [kl.nr]: !c[kl.nr] }))}>
                <span style={{ fontSize: 12, color: '#6b826b' }}>{open ? '▾' : '▸'}</span>
                <span style={s.klasseLabel}>{kl.label}</span>
                <span style={s.klasseBadge}>{list.length} Konten</span>
              </div>
              {open && (
                list.length === 0 ? (
                  <div style={s.empty}>Keine Konten in dieser Klasse.</div>
                ) : (
                  <table style={s.table}>
                    <thead>
                      <tr>
                        <th style={s.th}>Konto-Nr</th>
                        <th style={s.th}>Bezeichnung</th>
                        <th style={s.th}>Typ</th>
                        <th style={s.th}>MWST-Code</th>
                        <th style={{ ...s.th, textAlign: 'right' }}>Aktiv</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map(k => (
                        <tr key={k.id} style={{ opacity: k.aktiv ? 1 : .5 }}>
                          <td style={{ ...s.td, ...s.nrCell }}>{k.konto_nr}</td>
                          <td style={s.td}>{k.bezeichnung}</td>
                          <td style={s.td}><span style={s.typBadge(k.konto_typ)}>{k.konto_typ}</span></td>
                          <td style={s.td}>
                            {k.mwst_code
                              ? <span style={s.mwstBadge}>{k.mwst_code}</span>
                              : <span style={{ color: '#d1d5db', fontSize: 11 }}>—</span>}
                          </td>
                          <td style={{ ...s.td, textAlign: 'right' }}>
                            <Toggle value={k.aktiv} onChange={() => handleToggle(k)} disabled={saving[k.id] || !canWrite} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
