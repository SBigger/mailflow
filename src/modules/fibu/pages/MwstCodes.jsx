import React, { useEffect, useState } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { supabase } from '@/api/supabaseClient';

const TYP_LABELS = {
  vorsteuer:     { label: 'Vorsteuer (Einkauf)',   color: '#1e6fa8', bg: '#e8f4fd' },
  umsatzsteuer:  { label: 'Umsatzsteuer (Verkauf)', color: '#1ea84f', bg: '#e8fdf0' },
  steuerbefreit: { label: 'Steuerbefreit / Kein MWST', color: '#6b1ea8', bg: '#f0e8fd' },
};

const SATZ_COLORS = {
  8.1: { bg: '#fde8e8', color: '#a81e1e' },
  3.8: { bg: '#fdf4e8', color: '#a8631e' },
  2.6: { bg: '#fdf9e8', color: '#8a7e1e' },
  0.0: { bg: '#f0f0f0', color: '#666' },
};

function Toggle({ value, onChange, disabled }) {
  return (
    <div
      onClick={() => !disabled && onChange(!value)}
      title={value ? 'Aktiv' : 'Inaktiv'}
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

function SatzBadge({ satz }) {
  const c = SATZ_COLORS[parseFloat(satz)] ?? { bg: '#f0f0f0', color: '#666' };
  return (
    <span style={{
      display: 'inline-block', fontSize: 12, fontWeight: 700,
      padding: '3px 10px', borderRadius: 20,
      background: c.bg, color: c.color, letterSpacing: '.01em',
    }}>
      {parseFloat(satz).toFixed(1)} %
    </span>
  );
}

export default function MwstCodes() {
  const { mandant, canWrite } = useMandant();
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [saving, setSaving] = useState({});

  useEffect(() => { if (mandant) load(); }, [mandant]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('fibu_mwst_codes')
      .select('*')
      .eq('mandant_id', mandant.id)
      .order('sortierung');
    setCodes(data ?? []);
    setLoading(false);
  }

  async function handleToggle(code) {
    if (!canWrite) return;
    setSaving(s => ({ ...s, [code.id]: true }));
    const neu = !code.aktiv;
    setCodes(prev => prev.map(c => c.id === code.id ? { ...c, aktiv: neu } : c));
    await supabase.from('fibu_mwst_codes').update({ aktiv: neu }).eq('id', code.id);
    setSaving(s => ({ ...s, [code.id]: false }));
  }

  async function handleSeed() {
    setSeeding(true);
    await supabase.rpc('fibu_seed_mwst_codes', { p_mandant_id: mandant.id });
    await load();
    setSeeding(false);
  }

  const grouped = {
    vorsteuer:     codes.filter(c => c.typ === 'vorsteuer'),
    umsatzsteuer:  codes.filter(c => c.typ === 'umsatzsteuer'),
    steuerbefreit: codes.filter(c => c.typ === 'steuerbefreit'),
  };

  const s = {
    page: { padding: 28, fontFamily: "'Inter', system-ui, sans-serif", maxWidth: 900 },
    header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 },
    title: { fontWeight: 700, fontSize: 20, color: '#1a1a2e', margin: 0 },
    subtitle: { fontSize: 12, color: '#94a394', marginBottom: 20 },
    infoBox: {
      background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 10,
      padding: '12px 16px', marginBottom: 20, fontSize: 12.5, color: '#3d6641',
      display: 'flex', gap: 20, flexWrap: 'wrap',
    },
    controls: { display: 'flex', justifyContent: 'flex-end', marginBottom: 20 },
    seedBtn: {
      border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12,
      fontWeight: 500, cursor: 'pointer', background: '#e6ede6', color: '#3d6641',
    },
    section: { marginBottom: 24 },
    sectionHeader: (typ) => ({
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 14px', borderRadius: 8, marginBottom: 6,
      background: TYP_LABELS[typ]?.bg ?? '#f5f5f5',
    }),
    sectionLabel: (typ) => ({
      fontWeight: 700, fontSize: 12.5,
      color: TYP_LABELS[typ]?.color ?? '#333',
      flex: 1,
    }),
    card: { background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, overflow: 'hidden' },
    row: (idx, active) => ({
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '12px 16px',
      borderTop: idx > 0 ? '1px solid #f7faf7' : 'none',
      opacity: active ? 1 : .45,
    }),
    codeBadge: {
      fontWeight: 800, fontSize: 13, width: 44, textAlign: 'center',
      padding: '4px 8px', borderRadius: 7,
      background: '#1a1a2e', color: '#fff', letterSpacing: '.03em',
      flexShrink: 0,
    },
    bezeichnung: { flex: 1, fontSize: 13, color: '#1a1a2e' },
    konto: { fontSize: 11.5, color: '#94a394', minWidth: 120 },
    empty: { fontSize: 12, color: '#94a394', padding: '12px 16px' },
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: '#7a9b7f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16 }}>%</div>
        <h1 style={s.title}>MWST-Codes</h1>
      </div>
      <div style={s.subtitle}>Gültig ab 1. Januar 2024 · Schweiz (ESTV)</div>

      <div style={s.infoBox}>
        <span>🟥 <strong>Normalsatz 8.1 %</strong> – Standardleistungen</span>
        <span>🟧 <strong>Sonderrate 3.8 %</strong> – Beherbergung</span>
        <span>🟨 <strong>Reduziertensatz 2.6 %</strong> – Lebensmittel, Bücher, Medikamente</span>
        <span>⬜ <strong>0 % / befreit</strong> – Versicherungen, Zinsen, Export</span>
      </div>

      <div style={s.controls}>
        <button style={s.seedBtn} onClick={handleSeed} disabled={seeding || !canWrite}>
          {seeding ? 'Ergänze…' : '⟳ Standard-Codes ergänzen'}
        </button>
      </div>

      {loading ? (
        <div style={{ color: '#94a394', fontSize: 13 }}>Lade MWST-Codes…</div>
      ) : (
        Object.entries(grouped).map(([typ, list]) => (
          <div key={typ} style={s.section}>
            <div style={s.sectionHeader(typ)}>
              <span style={s.sectionLabel(typ)}>{TYP_LABELS[typ]?.label ?? typ}</span>
              <span style={{ fontSize: 11, opacity: .7 }}>{list.filter(c => c.aktiv).length} / {list.length} aktiv</span>
            </div>
            <div style={s.card}>
              {list.length === 0 ? (
                <div style={s.empty}>Keine Codes — klicke «Standard-Codes ergänzen».</div>
              ) : (
                list.map((c, idx) => (
                  <div key={c.id} style={s.row(idx, c.aktiv)}>
                    <span style={s.codeBadge}>{c.code}</span>
                    <span style={s.bezeichnung}>{c.bezeichnung}</span>
                    <SatzBadge satz={c.satz} />
                    <span style={s.konto}>
                      {c.konto_vorsteuer && <span title="Vorsteuerkonto">Kto {c.konto_vorsteuer}</span>}
                      {c.konto_umsatz && <span title="Umsatzsteuerkonto">Kto {c.konto_umsatz}</span>}
                      {!c.konto_vorsteuer && !c.konto_umsatz && '—'}
                    </span>
                    <Toggle
                      value={c.aktiv}
                      onChange={() => handleToggle(c)}
                      disabled={saving[c.id] || !canWrite}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
