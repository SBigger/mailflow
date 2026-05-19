// src/modules/fibu/pages/SetupAssistent.jsx
// Schritt-für-Schritt Einrichtungsassistent für einen neuen FiBu-Mandanten
// Schritte: Firmendaten → Kontenplan → MWST → Zahlstellen → Saldovorträge → Fertig

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMandant } from '../contexts/MandantContext';
import { supabase } from '@/api/supabaseClient';
import { kontenApi, saldovortragApi, zahlstellenApi, mandantenApi } from '../api';
import { useSetupProgress, SETUP_TOTAL } from '../hooks/useSetupProgress';

// ── Hilfsfunktionen ───────────────────────────────────────────────
const CHF = (n) => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const nrmIBAN = (s) => (s || '').replace(/\s/g, '').toUpperCase();

// ── Design-Tokens ─────────────────────────────────────────────────
const G   = '#7a9b7f';
const GD  = '#5a7b5f';
const GL  = '#f0f7f0';
const OK  = { bg: '#dcfce7', color: '#166534' };
const ER  = { bg: '#fee2e2', color: '#991b1b' };
const WARN = { bg: '#fef3c7', color: '#92400e' };

const btn = (variant = 'primary', extra = {}) => ({
  padding: '9px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
  fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 7,
  transition: 'opacity .15s',
  ...(variant === 'primary'  ? { background: G,    color: '#fff' } : {}),
  ...(variant === 'dark'     ? { background: GD,   color: '#fff' } : {}),
  ...(variant === 'outline'  ? { background: '#fff', color: '#4a5a4a', border: '1px solid #d4dcd4' } : {}),
  ...(variant === 'ghost'    ? { background: 'transparent', color: '#6b826b', padding: '9px 12px' } : {}),
  ...(variant === 'skip'     ? { background: 'transparent', color: '#94a394', padding: '9px 12px', fontSize: 12 } : {}),
  ...extra,
});
const inp = {
  background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 8,
  padding: '8px 11px', fontSize: 13, color: '#1a1a2e', outline: 'none',
  width: '100%', boxSizing: 'border-box',
};
const card = {
  background: '#fff', borderRadius: 12, border: '1px solid #e4e9e4',
  padding: '22px 24px', marginBottom: 16,
};

// ── Step-Definitionen ─────────────────────────────────────────────
const STEPS = [
  { id: 'firmendaten',   emoji: '🏢', title: 'Firmendaten',   sub: 'Adresse & UID erfassen', optional: true  },
  { id: 'kontenplan',    emoji: '📒', title: 'Kontenplan',    sub: 'CH-KMU Standard laden',  optional: false },
  { id: 'mwst',          emoji: '🧾', title: 'MWST-Codes',   sub: 'Steuersätze 2024',        optional: false },
  { id: 'zahlstellen',   emoji: '🏦', title: 'Zahlstellen',  sub: 'Bankkonten erfassen',     optional: true  },
  { id: 'saldovortraege',emoji: '⚖️', title: 'Saldovorträge',sub: 'Eröffnungssaldi',         optional: true  },
];

// ── Fortschritts-Stepper ──────────────────────────────────────────
function Stepper({ step, done }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, marginBottom: 32 }}>
      {STEPS.map((s, i) => {
        const aktiv  = i === step;
        const fertig = done.has(s.id);
        const past   = i < step;
        return (
          <React.Fragment key={s.id}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              <div style={{
                width: 38, height: 38, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 17, fontWeight: 700,
                background: fertig ? OK.bg : aktiv ? G : past ? '#e8f4e8' : '#f0f3f0',
                color:      fertig ? OK.color : aktiv ? '#fff' : past ? GD : '#9aa8a0',
                border:     aktiv ? `2px solid ${GD}` : '2px solid transparent',
                transition: 'all .2s',
              }}>
                {fertig ? '✓' : s.emoji}
              </div>
              <div style={{ fontSize: 11, fontWeight: aktiv ? 700 : 500, color: aktiv ? '#1a1a2e' : '#6b826b', marginTop: 5, textAlign: 'center', maxWidth: 72, lineHeight: 1.3 }}>
                {s.title}
                {s.optional && <div style={{ fontSize: 9.5, color: '#94a394', fontWeight: 400 }}>optional</div>}
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ flex: 0, width: 36, height: 2, background: (past || fertig) ? G : '#e4e9e4', borderRadius: 1, alignSelf: 'flex-start', marginTop: 18, transition: 'background .3s' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Step 0: Firmendaten ───────────────────────────────────────────
function StepFirmendaten({ mandant, onDone }) {
  const [form, setForm] = useState({
    name:    mandant?.name    ?? '',
    uid:     mandant?.uid     ?? '',
    adresse: mandant?.adresse ?? '',
    plz:     mandant?.plz     ?? '',
    ort:     mandant?.ort     ?? '',
    land:    mandant?.land    ?? 'CH',
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState(null);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) { setMsg({ type: 'err', text: 'Firmenname ist Pflicht.' }); return; }
    setSaving(true); setMsg(null);
    try {
      await mandantenApi.update(mandant.id, {
        name:    form.name.trim(),
        uid:     form.uid.trim()     || null,
        adresse: form.adresse.trim() || null,
        plz:     form.plz.trim()     || null,
        ort:     form.ort.trim()     || null,
        land:    (form.land || 'CH').toUpperCase().slice(0, 2),
      });
      setMsg({ type: 'ok', text: '✓ Firmenangaben gespeichert.' });
      onDone();
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally { setSaving(false); }
  };

  const lbl = { fontSize: 11.5, fontWeight: 600, color: '#6b826b', display: 'block', marginBottom: 4 };

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>🏢 Firmendaten</h2>
      <p style={{ fontSize: 13.5, color: '#4a5a4a', marginBottom: 20, lineHeight: 1.6 }}>
        Die Firmenadresse erscheint im Zahlungslauf (pain.001) und hilft der KI,
        die eigene Firma beim Belegscan als Empfänger zu erkennen.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
        <div style={{ gridColumn: '1/2' }}>
          <label style={lbl}>Firmenname *</label>
          <input style={inp} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Muster AG" />
        </div>
        <div>
          <label style={lbl}>UID</label>
          <input style={inp} value={form.uid} onChange={e => set('uid', e.target.value)} placeholder="CHE-xxx.xxx.xxx" />
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={lbl}>Strasse / Hausnummer</label>
          <input style={inp} value={form.adresse} onChange={e => set('adresse', e.target.value)} placeholder="Musterstrasse 1" />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ width: 90 }}>
            <label style={lbl}>PLZ</label>
            <input style={{ ...inp, width: 'auto' }} value={form.plz} onChange={e => set('plz', e.target.value)} placeholder="8000" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Ort</label>
            <input style={inp} value={form.ort} onChange={e => set('ort', e.target.value)} placeholder="Zürich" />
          </div>
        </div>
        <div>
          <label style={lbl}>Land</label>
          <input style={{ ...inp, width: 70 }} value={form.land} onChange={e => set('land', e.target.value.toUpperCase().slice(0, 2))} placeholder="CH" />
        </div>
      </div>

      <button style={btn('dark')} onClick={save} disabled={saving}>
        {saving ? '⏳ Speichert…' : '✓ Firmendaten speichern'}
      </button>

      {msg && (
        <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, fontSize: 13, background: msg.type === 'ok' ? OK.bg : ER.bg, color: msg.type === 'ok' ? OK.color : ER.color }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

// ── Kleiner Toggle-Schalter ───────────────────────────────────────
function Toggle({ on, onChange, disabled }) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      style={{
        width: 34, height: 18, borderRadius: 9,
        background: on ? G : '#d0d8d0',
        border: 'none', cursor: disabled ? 'default' : 'pointer',
        position: 'relative', padding: 0, flexShrink: 0,
        transition: 'background .15s', outline: 'none',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span style={{
        position: 'absolute', top: 2,
        left: on ? 16 : 2,
        width: 14, height: 14, borderRadius: '50%',
        background: '#fff', transition: 'left .15s',
        boxShadow: '0 1px 2px rgba(0,0,0,.25)',
        display: 'block',
      }} />
    </button>
  );
}

// ── Step 1: Kontenplan ────────────────────────────────────────────
const KLASSEN_LABEL = {
  '1': 'Aktiven',
  '2': 'Passiven',
  '3': 'Betriebsertrag',
  '4': 'Material- / Warenaufwand',
  '5': 'Personalaufwand',
  '6': 'Übriger Betriebsaufwand',
  '7': 'Nebenbetrieb / Liegenschaften',
  '8': 'Ausserordentliches',
  '9': 'Abschlusskonten',
};

function StepKontenplan({ mandant, onDone }) {
  const [seedStatus, setSeedStatus] = useState(null);   // null | 'loading' | 'ok' | 'err'
  const [seedMsg, setSeedMsg]       = useState('');
  const [konten, setKonten]         = useState(null);   // null = noch nicht geladen
  const [toggling, setToggling]     = useState(new Set());

  const loadKonten = useCallback(async () => {
    const all = await kontenApi.list(mandant.id, false); // nurAktiv=false → alle
    setKonten(all);
    if (all.length > 0) onDone();
  }, [mandant.id]);

  useEffect(() => { loadKonten(); }, [loadKonten]);

  const seed = async () => {
    setSeedStatus('loading'); setSeedMsg('');
    try {
      const { error } = await supabase.rpc('fibu_seed_kontenplan_ch_kmu', { p_mandant_id: mandant.id });
      if (error) throw error;
      await loadKonten();
      setSeedStatus('ok');
      setSeedMsg('✓ Standard-Kontenplan geladen (Schweizer KMU-Kontenrahmen nach OR 2013)');
    } catch (e) {
      setSeedStatus('err');
      setSeedMsg(e.message);
    }
  };

  const handleToggle = async (konto) => {
    if (toggling.has(konto.id)) return;
    setToggling(s => new Set([...s, konto.id]));
    const next = !konto.aktiv;
    // optimistic update
    setKonten(prev => prev.map(k => k.id === konto.id ? { ...k, aktiv: next } : k));
    try {
      await kontenApi.toggleAktiv(konto.id, next);
    } catch {
      // revert
      setKonten(prev => prev.map(k => k.id === konto.id ? { ...k, aktiv: !next } : k));
    } finally {
      setToggling(s => { const n = new Set(s); n.delete(konto.id); return n; });
    }
  };

  // Gruppierung nach Klasse (1. Ziffer)
  const grouped = useMemo(() => {
    if (!konten || konten.length === 0) return [];
    const map = {};
    for (const k of konten) {
      const cls = k.konto_nr[0] ?? '?';
      if (!map[cls]) map[cls] = [];
      map[cls].push(k);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [konten]);

  const aktiveCount = konten ? konten.filter(k => k.aktiv).length : 0;
  const totalCount  = konten ? konten.length : 0;

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>📒 Kontenplan</h2>
      <p style={{ fontSize: 13.5, color: '#4a5a4a', marginBottom: 16, lineHeight: 1.6 }}>
        Schweizer KMU-Kontenrahmen (nach OR 2013). Bereits vorhandene Konten werden nicht überschrieben.
        Einzelne Konten können per Schieberegler aktiviert oder deaktiviert werden.
      </p>

      {/* Status + Seed-Button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <button style={btn('dark')} onClick={seed} disabled={seedStatus === 'loading'}>
          {seedStatus === 'loading' ? '⏳ Lädt…' : totalCount > 0 ? '⟳ Konten ergänzen' : '⟳ Standard-Kontenplan laden'}
        </button>
        {totalCount > 0 && (
          <span style={{ fontSize: 12.5, color: '#6b826b', fontWeight: 500 }}>
            {aktiveCount} / {totalCount} Konten aktiv
          </span>
        )}
      </div>

      {seedMsg && (
        <div style={{ marginBottom: 14, padding: '9px 14px', borderRadius: 8, fontSize: 13, background: seedStatus === 'ok' ? OK.bg : ER.bg, color: seedStatus === 'ok' ? OK.color : ER.color }}>
          {seedMsg}
        </div>
      )}

      {/* Konten-Liste mit Toggles */}
      {konten === null && (
        <div style={{ color: '#94a394', fontSize: 13 }}>Lädt…</div>
      )}
      {konten !== null && konten.length === 0 && (
        <div style={{ padding: '14px 16px', borderRadius: 10, background: '#fef3c7', border: '1px solid #fde68a', fontSize: 13, color: '#92400e' }}>
          ⚠ Noch keine Konten — bitte Standard-Kontenplan laden.
        </div>
      )}
      {grouped.length > 0 && (
        <div style={{ border: '1px solid #e4e9e4', borderRadius: 10, overflow: 'hidden', maxHeight: 420, overflowY: 'auto' }}>
          {grouped.map(([cls, accounts]) => (
            <div key={cls}>
              {/* Klassen-Header */}
              <div style={{
                background: '#f0f4f0', padding: '5px 12px',
                fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase',
                letterSpacing: '.08em', color: '#5a7b5f',
                position: 'sticky', top: 0, zIndex: 1,
                borderBottom: '1px solid #e4e9e4',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ color: G, fontVariantNumeric: 'tabular-nums' }}>{cls}</span>
                <span>{KLASSEN_LABEL[cls] || `Klasse ${cls}`}</span>
                <span style={{ marginLeft: 'auto', fontWeight: 500, color: '#94a394', textTransform: 'none', fontSize: 11 }}>
                  {accounts.filter(k => k.aktiv).length}/{accounts.length}
                </span>
              </div>
              {/* Konten-Zeilen */}
              {accounts.map((k, i) => (
                <div
                  key={k.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '5px 12px',
                    borderBottom: i < accounts.length - 1 ? '1px solid #f4f7f4' : 'none',
                    background: k.aktiv ? '#fff' : '#fafbfa',
                    transition: 'background .1s',
                  }}
                >
                  <span style={{
                    width: 40, flexShrink: 0,
                    fontFamily: 'monospace', fontSize: 12, fontWeight: 700,
                    color: k.aktiv ? G : '#c0c8c0',
                  }}>
                    {k.konto_nr}
                  </span>
                  <span style={{
                    flex: 1, fontSize: 12.5, lineHeight: 1.3,
                    color: k.aktiv ? '#2a3a2a' : '#b0b8b0',
                  }}>
                    {k.bezeichnung}
                  </span>
                  {k.mwst_code && (
                    <span style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 5, background: '#f0f4f8', color: '#4a6b8a', fontWeight: 600, flexShrink: 0 }}>
                      {k.mwst_code}
                    </span>
                  )}
                  <Toggle
                    on={k.aktiv}
                    onChange={() => handleToggle(k)}
                    disabled={toggling.has(k.id)}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Step 2: MWST-Codes ────────────────────────────────────────────
function StepMwst({ mandant, onDone }) {
  const [status, setStatus] = useState(null);
  const [msg, setMsg]       = useState('');
  const [codes, setCodes]   = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('fibu_mwst_codes')
      .select('code,bezeichnung,satz,typ')
      .eq('mandant_id', mandant.id)
      .order('sortierung');
    setCodes(data ?? []);
    if ((data ?? []).length > 0) onDone();
  }, [mandant.id]);

  useEffect(() => { load(); }, [load]);

  const seed = async () => {
    setStatus('loading'); setMsg('');
    try {
      const { error } = await supabase.rpc('fibu_seed_mwst_codes', { p_mandant_id: mandant.id });
      if (error) throw error;
      await load();
      setStatus('ok');
      setMsg('✓ Schweizer MWST-Codes 2024 geladen (8.1% / 3.8% / 2.6% + Vorsteuercodes)');
    } catch (e) {
      setStatus('err');
      setMsg(e.message);
    }
  };

  const TYP_LABEL = { vorsteuer: 'Vorsteuer', umsatzsteuer: 'Umsatzsteuer', steuerbefreit: 'Befreit' };
  const TYP_COLOR = { vorsteuer: '#2e4a7d', umsatzsteuer: '#166534', steuerbefreit: '#92400e' };

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>🧾 MWST-Codes</h2>
      <p style={{ fontSize: 13.5, color: '#4a5a4a', marginBottom: 20, lineHeight: 1.6 }}>
        Lädt die aktuellen Schweizer Steuersätze (gültig ab 1.1.2024):
        Normalsatz 8.1%, Beherbergung 3.8%, Sondersatz 2.6%, sowie alle Vorsteuercodes.
      </p>

      {codes !== null && codes.length > 0 && (
        <div style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 20 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Code', 'Bezeichnung', 'Satz', 'Typ'].map(h => (
                  <th key={h} style={{ padding: '9px 14px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b', textAlign: 'left', background: '#fafcfa', borderBottom: '2px solid #e4e9e4' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {codes.map((c, i) => (
                <tr key={c.code} style={{ background: i % 2 ? '#fafcfa' : '#fff' }}>
                  <td style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: 700, color: G }}>{c.code}</td>
                  <td style={{ padding: '7px 14px', fontSize: 12.5 }}>{c.bezeichnung}</td>
                  <td style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: 600 }}>{c.satz}%</td>
                  <td style={{ padding: '7px 14px', fontSize: 11.5 }}>
                    <span style={{ padding: '2px 8px', borderRadius: 10, background: '#f0f3f0', color: TYP_COLOR[c.typ] || '#4a4a5a', fontWeight: 600 }}>
                      {TYP_LABEL[c.typ] || c.typ}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {codes !== null && codes.length === 0 && (
        <div style={{ ...card, ...WARN, marginBottom: 20 }}>
          ⚠ Noch keine MWST-Codes — Standard-Codes laden wird empfohlen.
        </div>
      )}

      <button style={btn('dark')} onClick={seed} disabled={status === 'loading'}>
        {status === 'loading' ? '⏳ Lädt…' : codes?.length > 0 ? '⟳ Codes aktualisieren' : '⟳ CH-Standard MWST-Codes laden'}
      </button>

      {msg && (
        <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, fontSize: 13, background: status === 'ok' ? OK.bg : ER.bg, color: status === 'ok' ? OK.color : ER.color }}>
          {msg}
        </div>
      )}
    </div>
  );
}

// ── Step 3: Zahlstellen ───────────────────────────────────────────
const BLANK_ZS = { bezeichnung: '', bank_name: '', iban: '', bic: '', konto_nr: '1020', waehrung: 'CHF' };

function StepZahlstellen({ mandant, onDone }) {
  const [list, setList]     = useState([]);
  const [form, setForm]     = useState(BLANK_ZS);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState(null);
  const [konten, setKonten] = useState([]);

  const load = useCallback(async () => {
    const [zs, k] = await Promise.all([
      zahlstellenApi.list(mandant.id),
      kontenApi.list(mandant.id),
    ]);
    setList(zs);
    setKonten(k.filter(x => x.aktiv && x.konto_typ === 'aktiv'));
    if (zs.length > 0) onDone();
  }, [mandant.id]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.bezeichnung || !form.iban) {
      setMsg({ type: 'err', text: 'Bezeichnung und IBAN sind Pflicht.' });
      return;
    }
    setSaving(true); setMsg(null);
    try {
      await zahlstellenApi.create(mandant.id, {
        ...form,
        iban: nrmIBAN(form.iban),
        ist_standard: list.length === 0,
      });
      setForm(BLANK_ZS);
      await load();
      setMsg({ type: 'ok', text: '✓ Zahlstelle gespeichert.' });
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally { setSaving(false); }
  };

  const remove = async (id) => { await zahlstellenApi.remove(id); await load(); };
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const bankKonten = konten.filter(k => k.konto_nr.startsWith('10') || k.konto_nr.startsWith('11'));

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>🏦 Zahlstellen</h2>
      <p style={{ fontSize: 13.5, color: '#4a5a4a', marginBottom: 20, lineHeight: 1.6 }}>
        Erfasse die Bankkonten der Firma — sie werden im Zahlungslauf verwendet und
        mit dem Fibu-Konto verknüpft. <em style={{ color: '#94a394' }}>(optional, kann jederzeit ergänzt werden)</em>
      </p>

      {list.length > 0 && (
        <div style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: 20 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Bezeichnung', 'IBAN', 'Bank', 'Konto', ''].map(h => (
                  <th key={h} style={{ padding: '9px 14px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b', textAlign: 'left', background: '#fafcfa', borderBottom: '2px solid #e4e9e4' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((z, i) => (
                <tr key={z.id} style={{ background: i % 2 ? '#fafcfa' : '#fff' }}>
                  <td style={{ padding: '8px 14px', fontSize: 13 }}>
                    {z.bezeichnung}
                    {z.ist_standard && <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 8, background: GL, color: GD, fontWeight: 700 }}>Standard</span>}
                  </td>
                  <td style={{ padding: '8px 14px', fontSize: 12, fontFamily: 'monospace', color: '#4a5a4a' }}>
                    {z.iban?.replace(/(.{4})/g, '$1 ').trim()}
                  </td>
                  <td style={{ padding: '8px 14px', fontSize: 12.5, color: '#6b826b' }}>{z.bank_name || '—'}</td>
                  <td style={{ padding: '8px 14px', fontSize: 12.5, fontWeight: 600, color: G }}>{z.konto_nr}</td>
                  <td style={{ padding: '8px 14px' }}>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9aa0a0', fontSize: 16 }} onClick={() => remove(z.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, color: '#1a1a2e' }}>
          {list.length === 0 ? 'Erste Zahlstelle erfassen' : '+ Weitere Zahlstelle'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: '#6b826b', display: 'block', marginBottom: 4 }}>Bezeichnung *</label>
            <input style={inp} placeholder="UBS Geschäftskonto" value={form.bezeichnung} onChange={e => setF('bezeichnung', e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: '#6b826b', display: 'block', marginBottom: 4 }}>IBAN *</label>
            <input style={inp} placeholder="CH56 0483 5012 3456 7800 9" value={form.iban} onChange={e => setF('iban', e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: '#6b826b', display: 'block', marginBottom: 4 }}>Bank</label>
            <input style={inp} placeholder="UBS Switzerland AG" value={form.bank_name} onChange={e => setF('bank_name', e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: '#6b826b', display: 'block', marginBottom: 4 }}>BIC / SWIFT</label>
            <input style={inp} placeholder="UBSWCHZH80A" value={form.bic} onChange={e => setF('bic', e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: '#6b826b', display: 'block', marginBottom: 4 }}>Fibu-Konto</label>
            <select style={inp} value={form.konto_nr} onChange={e => setF('konto_nr', e.target.value)}>
              {bankKonten.length > 0
                ? bankKonten.map(k => <option key={k.konto_nr} value={k.konto_nr}>{k.konto_nr} {k.bezeichnung}</option>)
                : <option value="1020">1020 Bank</option>}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: '#6b826b', display: 'block', marginBottom: 4 }}>Währung</label>
            <select style={inp} value={form.waehrung} onChange={e => setF('waehrung', e.target.value)}>
              {['CHF', 'EUR', 'USD', 'GBP'].map(w => <option key={w}>{w}</option>)}
            </select>
          </div>
        </div>
        <button style={btn('dark')} onClick={save} disabled={saving}>
          {saving ? '⏳ Speichert…' : '+ Zahlstelle hinzufügen'}
        </button>
        {msg && (
          <div style={{ marginTop: 12, padding: '9px 13px', borderRadius: 7, fontSize: 12.5, background: msg.type === 'ok' ? OK.bg : ER.bg, color: msg.type === 'ok' ? OK.color : ER.color }}>
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Step 4: Saldovorträge ─────────────────────────────────────────
function StepSaldovortraege({ mandant, onDone }) {
  const aktuellesJahr = new Date().getFullYear();
  const [jahr, setJahr]       = useState(aktuellesJahr);
  const [alleKonten, setAlleKonten] = useState([]);   // vollständiger Kontenplan
  const [aktiveNrs, setAktiveNrs]   = useState(new Set()); // angezeigte Konten
  const [salden, setSalden]   = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState(null);
  const [suche, setSuche]     = useState('');
  const [showSuche, setShowSuche] = useState(false);
  const sucheRef = useRef(null);

  const isFW = (k) => k.waehrung && k.waehrung !== 'CHF';

  const load = useCallback(async () => {
    if (!mandant) return;
    setLoading(true);
    try {
      const [k, vortrag] = await Promise.all([
        kontenApi.list(mandant.id),
        saldovortragApi.lesen(mandant.id, jahr),
      ]);
      const bilanz = k.filter(x => x.aktiv && (x.konto_typ === 'aktiv' || x.konto_typ === 'passiv'));
      setAlleKonten(bilanz);

      const map = {};
      const nrsWithData = new Set();
      vortrag.forEach(v => {
        const chf = Number(v.saldo) || 0;
        const fw  = Number(v.fw_saldo) || 0;
        if (chf !== 0 || fw !== 0) {
          map[v.konto_nr] = { chf: String(chf), fw: fw ? String(fw) : '' };
          nrsWithData.add(v.konto_nr);
        }
      });
      setSalden(map);
      setAktiveNrs(nrsWithData);
      if (vortrag.filter(v => Number(v.saldo) !== 0).length > 0) onDone();
    } finally { setLoading(false); }
  }, [mandant?.id, jahr]);

  useEffect(() => { load(); }, [load]);

  const chfVal = (nr) => parseFloat(salden[nr]?.chf) || 0;
  const fwVal  = (nr) => parseFloat(salden[nr]?.fw)  || 0;
  const setVal = (nr, feld, v) => setSalden(s => ({ ...s, [nr]: { ...(s[nr] || { chf: '', fw: '' }), [feld]: v } }));

  const addKonto = (konto) => {
    setAktiveNrs(s => new Set([...s, konto.konto_nr]));
    setSuche('');
    setShowSuche(false);
  };

  const removeKonto = (nr) => {
    setAktiveNrs(s => { const n = new Set(s); n.delete(nr); return n; });
    setSalden(s => { const n = { ...s }; delete n[nr]; return n; });
  };

  const aktiveKonten = alleKonten.filter(k => aktiveNrs.has(k.konto_nr));
  const aktiv  = aktiveKonten.filter(k => k.konto_typ === 'aktiv');
  const passiv = aktiveKonten.filter(k => k.konto_typ === 'passiv');

  const sumCHF   = (list) => list.reduce((s, k) => s + chfVal(k.konto_nr), 0);
  const totalA   = sumCHF(aktiv);
  const totalP   = sumCHF(passiv);
  const diff     = totalA - totalP;
  const balanced = Math.abs(diff) < 0.005;

  // Suchvorschläge
  const sucheLC = suche.toLowerCase();
  const vorschlaege = suche.length >= 1
    ? alleKonten.filter(k => !aktiveNrs.has(k.konto_nr) && (
        k.konto_nr.startsWith(suche) ||
        k.bezeichnung.toLowerCase().includes(sucheLC)
      )).slice(0, 8)
    : [];

  const handleSave = async () => {
    setSaving(true); setMsg(null);
    try {
      const list = aktiveKonten
        .map(k => ({
          konto_nr:    k.konto_nr,
          saldo:       chfVal(k.konto_nr),
          fw_saldo:    isFW(k) ? fwVal(k.konto_nr) : null,
          fw_waehrung: isFW(k) ? k.waehrung : null,
        }))
        .filter(x => x.saldo !== 0 || (x.fw_saldo ?? 0) !== 0);
      await saldovortragApi.speichern(mandant.id, jahr, list);
      setMsg({ type: 'ok', text: `✓ ${list.length} Konten per 01.01.${jahr} gespeichert.` });
      onDone();
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally { setSaving(false); }
  };

  const hdr = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b', padding: '8px 12px', borderBottom: '2px solid #e4e9e4', textAlign: 'left', background: '#fafcfa' };
  const tdS = { padding: '5px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5 };
  const inpN = { ...inp, width: 110, textAlign: 'right', padding: '5px 8px', fontSize: 12 };

  if (loading) return <div style={{ color: '#6b826b', fontSize: 13 }}>Lädt Kontenplan…</div>;

  if (alleKonten.length === 0) return (
    <div style={{ ...card, ...WARN }}>
      ⚠ Bitte zuerst den Kontenplan (Schritt 2) laden — ohne Konten keine Saldovorträge.
    </div>
  );

  const Seite = ({ titel, list, farbe }) => (
    <div style={{ flex: 1, minWidth: 320 }}>
      <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.07em', color: farbe, marginBottom: 6 }}>{titel}</div>
      {list.length === 0
        ? <div style={{ padding: '12px', fontSize: 12.5, color: '#94a394', background: '#fafcfa', borderRadius: 8, border: '1px solid #e4e9e4' }}>
            Noch kein Konto hinzugefügt
          </div>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden', border: '1px solid #e4e9e4' }}>
            <thead>
              <tr>
                <th style={hdr}>Konto</th>
                <th style={hdr}>Bezeichnung</th>
                <th style={{ ...hdr, textAlign: 'right' }}>Saldo CHF</th>
                {list.some(isFW) && <th style={{ ...hdr, textAlign: 'right' }}>FW</th>}
                <th style={hdr} />
              </tr>
            </thead>
            <tbody>
              {list.map(k => (
                <tr key={k.konto_nr}>
                  <td style={{ ...tdS, fontWeight: 700, color: G }}>{k.konto_nr}</td>
                  <td style={{ ...tdS, color: '#4a5a4a', maxWidth: 160 }}>{k.bezeichnung}</td>
                  <td style={{ ...tdS, textAlign: 'right' }}>
                    <input type="number" step="0.01" style={inpN}
                      value={salden[k.konto_nr]?.chf ?? ''}
                      onChange={e => setVal(k.konto_nr, 'chf', e.target.value)}
                      placeholder="0.00"
                    />
                  </td>
                  {list.some(isFW) && isFW(k) && (
                    <td style={{ ...tdS, textAlign: 'right' }}>
                      <input type="number" step="0.01" style={{ ...inpN, width: 80 }}
                        value={salden[k.konto_nr]?.fw ?? ''}
                        onChange={e => setVal(k.konto_nr, 'fw', e.target.value)}
                        placeholder="0.00"
                      />
                      <span style={{ fontSize: 10, color: '#9aa0a0', marginLeft: 3 }}>{k.waehrung}</span>
                    </td>
                  )}
                  {list.some(isFW) && !isFW(k) && <td style={tdS} />}
                  <td style={{ ...tdS, textAlign: 'center' }}>
                    <button onClick={() => removeKonto(k.konto_nr)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc', fontSize: 13, lineHeight: 1 }} title="Entfernen">✕</button>
                  </td>
                </tr>
              ))}
              <tr style={{ background: '#f7faf7' }}>
                <td colSpan={2} style={{ ...tdS, fontWeight: 700 }}>Total {titel}</td>
                <td style={{ ...tdS, textAlign: 'right', fontWeight: 700, color: farbe }}>{CHF(sumCHF(list))}</td>
                {list.some(isFW) && <td style={tdS} />}
                <td style={tdS} />
              </tr>
            </tbody>
          </table>
        )}
    </div>
  );

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>⚖️ Saldovorträge</h2>
      <p style={{ fontSize: 13.5, color: '#4a5a4a', marginBottom: 20, lineHeight: 1.6 }}>
        Erfasse die Eröffnungssaldi per 01.01. Aktiven und Passiven müssen ausgeglichen sein.{' '}
        <em style={{ color: '#94a394' }}>(optional)</em>
      </p>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>GJ:</label>
          <select style={{ ...inp, width: 90 }} value={jahr} onChange={e => setJahr(Number(e.target.value))}>
            {[aktuellesJahr - 1, aktuellesJahr, aktuellesJahr + 1].map(y => <option key={y}>{y}</option>)}
          </select>
        </div>

        {/* Konto hinzufügen – Suche */}
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 8, overflow: 'hidden' }}>
            <span style={{ padding: '0 8px', color: '#94a394', fontSize: 14, userSelect: 'none' }}>+</span>
            <input
              ref={sucheRef}
              style={{ ...inp, border: 'none', background: 'transparent', flex: 1, borderRadius: 0 }}
              placeholder="Konto-Nr. oder Name suchen…"
              value={suche}
              onChange={e => { setSuche(e.target.value); setShowSuche(true); }}
              onFocus={() => setShowSuche(true)}
              onBlur={() => setTimeout(() => setShowSuche(false), 150)}
            />
          </div>
          {showSuche && vorschlaege.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #d4dcd4', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,.1)', zIndex: 20, marginTop: 2, overflow: 'hidden' }}>
              {vorschlaege.map(k => (
                <button key={k.konto_nr}
                  onMouseDown={() => addKonto(k)}
                  style={{ width: '100%', display: 'flex', gap: 8, padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', alignItems: 'center' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f0f7f0'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <span style={{ fontWeight: 700, color: G, fontSize: 12.5, width: 42, flexShrink: 0 }}>{k.konto_nr}</span>
                  <span style={{ fontSize: 12.5, color: '#3a4a3a', flex: 1 }}>{k.bezeichnung}</span>
                  <span style={{ fontSize: 11, color: '#94a394' }}>{k.konto_typ === 'aktiv' ? 'Aktiv' : 'Passiv'}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Bilanz-Status */}
        <div style={{ padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, flexShrink: 0, background: aktiveKonten.length === 0 ? '#f0f3f0' : balanced ? OK.bg : WARN.bg, color: aktiveKonten.length === 0 ? '#94a394' : balanced ? OK.color : WARN.color }}>
          {aktiveKonten.length === 0 ? 'Noch leer' : balanced ? '✓ Ausgeglichen' : `Diff: ${CHF(diff)}`}
        </div>
      </div>

      {/* Aktiven / Passiven Tabellen */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <Seite titel="Aktiven"  list={aktiv}  farbe="#1e6fa8" />
        <Seite titel="Passiven" list={passiv} farbe="#a85a1e" />
      </div>

      {aktiveKonten.length === 0 && (
        <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 12.5, background: '#f7faf7', color: '#6b826b', marginBottom: 12 }}>
          💡 Konten über das Suchfeld oben hinzufügen, z.B. «1000» für Kasse oder «1020» für Bank.
        </div>
      )}

      {msg && (
        <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12, background: msg.type === 'ok' ? OK.bg : ER.bg, color: msg.type === 'ok' ? OK.color : ER.color }}>
          {msg.text}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          style={btn('dark', { opacity: (balanced && aktiveKonten.length > 0) ? 1 : 0.5 })}
          onClick={handleSave}
          disabled={saving || !balanced || aktiveKonten.length === 0}
        >
          {saving ? '⏳ Speichert…' : `✓ Saldovorträge ${jahr} speichern`}
        </button>
        {!balanced && aktiveKonten.length > 0 && (
          <span style={{ fontSize: 12, color: WARN.color }}>Aktiven ≠ Passiven</span>
        )}
      </div>
    </div>
  );
}

// ── Abschluss-Screen ──────────────────────────────────────────────
function StepFertig({ mandant, done }) {
  const navigate = useNavigate();
  const links = [
    { id: 'firmendaten',   label: 'Firmenangaben',       to: 'einstellungen' },
    { id: 'kontenplan',    label: 'Kontenplan',           to: 'kontenplan' },
    { id: 'mwst',          label: 'MWST-Codes',          to: 'mwstcodes' },
    { id: 'zahlstellen',   label: 'Zahlstellen',         to: 'zahlstellen' },
    { id: 'saldovortraege',label: 'Saldovorträge',       to: 'saldovortraege' },
  ];

  return (
    <div style={{ textAlign: 'center', padding: '20px 0' }}>
      <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
      <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Einrichtung abgeschlossen!</h2>
      <p style={{ fontSize: 14, color: '#4a5a4a', maxWidth: 460, margin: '0 auto 32px', lineHeight: 1.6 }}>
        Die Buchhaltung ist bereit. Du kannst jetzt Rechnungen erfassen,
        Zahlungsläufe erstellen und mit der täglichen Arbeit beginnen.
      </p>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 32 }}>
        {links.map(l => (
          <button key={l.id}
            style={btn(done.has(l.id) ? 'outline' : 'ghost', { opacity: done.has(l.id) ? 1 : 0.4 })}
            onClick={() => navigate(`/fibu/${mandant.id}/${l.to}`)}
            disabled={!done.has(l.id)}
          >
            {done.has(l.id) ? '✓ ' : '○ '}{l.label}
          </button>
        ))}
      </div>

      <button style={btn('dark', { fontSize: 14, padding: '12px 28px' })}
        onClick={() => navigate(`/fibu/${mandant.id}/kreditoren`)}>
        → Zur Buchhaltung
      </button>
    </div>
  );
}

// ── Hauptkomponente ───────────────────────────────────────────────
export default function SetupAssistent() {
  const { mandant } = useMandant();
  const { done: dbDone, loading: dbLoading, refresh } = useSetupProgress(mandant?.id, mandant);

  // done-Set aus DB initialisieren sobald geladen
  const [done, setDone]     = useState(new Set());
  const [step, setStep]     = useState(0);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!dbLoading && !initialized) {
      setDone(new Set(dbDone));
      setInitialized(true);
    }
  }, [dbLoading, dbDone, initialized]);

  const markDone = useCallback((id) => {
    setDone(d => new Set([...d, id]));
    refresh(); // Sidebar-Badge aktualisieren
  }, [refresh]);

  if (!mandant || (dbLoading && !initialized)) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b826b', fontSize: 13 }}>
        Lädt…
      </div>
    );
  }

  const isLast   = step === STEPS.length - 1;
  const curStep  = STEPS[step];
  const isOptional = curStep?.optional ?? false;
  const isDone   = curStep ? done.has(curStep.id) : false;

  const next = () => {
    if (step >= STEPS.length - 1) { setStep(STEPS.length); return; }
    setStep(s => s + 1);
  };
  const back = () => setStep(s => Math.max(s - 1, 0));

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '28px 32px', maxWidth: 1060, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1a1a2e', marginBottom: 4 }}>
          🚀 Einrichtungs-Assistent
        </h1>
        <p style={{ fontSize: 13.5, color: '#6b826b' }}>
          {mandant.name} — Neue Buchhaltung schrittweise einrichten
          <span style={{ marginLeft: 12, padding: '2px 10px', borderRadius: 10, background: GL, color: GD, fontSize: 12, fontWeight: 600 }}>
            {done.size} / {SETUP_TOTAL} Schritte erledigt
          </span>
        </p>
      </div>

      {step >= STEPS.length ? (
        <div style={card}>
          <StepFertig mandant={mandant} done={done} />
        </div>
      ) : (
        <>
          <Stepper step={step} done={done} />

          <div style={{ ...card, minHeight: 380 }}>
            {step === 0 && <StepFirmendaten    mandant={mandant} onDone={() => markDone('firmendaten')} />}
            {step === 1 && <StepKontenplan     mandant={mandant} onDone={() => markDone('kontenplan')} />}
            {step === 2 && <StepMwst           mandant={mandant} onDone={() => markDone('mwst')} />}
            {step === 3 && <StepZahlstellen    mandant={mandant} onDone={() => markDone('zahlstellen')} />}
            {step === 4 && <StepSaldovortraege mandant={mandant} onDone={() => markDone('saldovortraege')} />}
          </div>

          {/* Navigation */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
            <button style={btn('outline')} onClick={back} disabled={step === 0}>← Zurück</button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12.5, color: '#9aa0a0' }}>Schritt {step + 1} von {STEPS.length}</span>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {isOptional && !isDone && (
                <button style={btn('skip')} onClick={next} title="Diesen Schritt später nachholen">
                  Später ›
                </button>
              )}
              <button
                style={btn(isDone ? 'dark' : 'primary')}
                onClick={next}
              >
                {isLast ? 'Abschliessen →' : 'Weiter →'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
