import React, { useEffect, useState, useMemo } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { kontenApi, saldovortragApi } from '../api';

const CHF = (n) => new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

export default function Saldovortraege() {
  const { mandant, canWrite } = useMandant();
  const aktuellesJahr = new Date().getFullYear();

  const [jahr, setJahr]       = useState(aktuellesJahr);
  const [konten, setKonten]   = useState([]);
  const [salden, setSalden]   = useState({});       // konto_nr → string-Betrag
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState(null);

  const load = async () => {
    if (!mandant) return;
    setLoading(true);
    try {
      const [k, vortrag] = await Promise.all([
        kontenApi.list(mandant.id),
        saldovortragApi.lesen(mandant.id, jahr),
      ]);
      setKonten(k.filter(x => x.aktiv && (x.konto_typ === 'aktiv' || x.konto_typ === 'passiv')));
      const map = {};
      vortrag.forEach(v => { if (Number(v.saldo) !== 0) map[v.konto_nr] = String(v.saldo); });
      setSalden(map);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [mandant?.id, jahr]);

  const aktiv  = useMemo(() => konten.filter(k => k.konto_typ === 'aktiv'),  [konten]);
  const passiv = useMemo(() => konten.filter(k => k.konto_typ === 'passiv'), [konten]);

  const sum = (list) => list.reduce((s, k) => s + (parseFloat(salden[k.konto_nr]) || 0), 0);
  const totalAktiv  = sum(aktiv);
  const totalPassiv = sum(passiv);
  const differenz   = totalAktiv - totalPassiv;
  const ausgeglichen = Math.abs(differenz) < 0.005;

  const handleSave = async () => {
    if (!canWrite) return;
    setSaving(true); setMsg(null);
    try {
      const list = Object.entries(salden)
        .map(([konto_nr, v]) => ({ konto_nr, saldo: parseFloat(v) || 0 }))
        .filter(x => x.saldo !== 0);
      await saldovortragApi.speichern(mandant.id, jahr, list);
      setMsg({ type: 'ok', text: `Saldovorträge ${jahr} gespeichert (${list.length} Konten, gebucht per 01.01.${jahr}).` });
      await load();
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally { setSaving(false); }
  };

  const hdr = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b', padding: '8px 12px', borderBottom: '2px solid #e4e9e4', textAlign: 'left', background: '#fafcfa' };
  const td  = { padding: '6px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5 };
  const inp = { background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, color: '#1a1a2e', outline: 'none' };

  const Spalte = ({ titel, list, farbe }) => (
    <div style={{ flex: 1, minWidth: 320 }}>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: farbe, padding: '4px 2px' }}>{titel}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden' }}>
        <thead><tr>
          <th style={{ ...hdr, width: 70 }}>Konto</th>
          <th style={hdr}>Bezeichnung</th>
          <th style={{ ...hdr, width: 140, textAlign: 'right' }}>Eröffnungssaldo</th>
        </tr></thead>
        <tbody>
          {list.map(k => (
            <tr key={k.id}>
              <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600 }}>{k.konto_nr}</td>
              <td style={td}>{k.bezeichnung}</td>
              <td style={{ ...td, textAlign: 'right' }}>
                <input
                  type="number" step="0.05"
                  disabled={!canWrite}
                  value={salden[k.konto_nr] ?? ''}
                  onChange={e => setSalden(s => ({ ...s, [k.konto_nr]: e.target.value }))}
                  placeholder="0.00"
                  style={{ ...inp, width: 120, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                />
              </td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={3} style={{ ...td, color: '#94a394', textAlign: 'center' }}>Keine Konten</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#fff', borderBottom: '1px solid #e4e9e4', flexWrap: 'wrap' }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: '#7a9b7f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15 }}>📥</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e' }}>Saldovorträge</div>
          <div style={{ fontSize: 11.5, color: '#94a394' }}>Eröffnungssaldi der Bilanzkonten – gebucht gegen 9100 Eröffnungsbilanz</div>
        </div>
        <div style={{ flex: 1 }} />
        <label style={{ fontSize: 12, color: '#6b826b' }}>Jahr</label>
        <input type="number" value={jahr} onChange={e => setJahr(parseInt(e.target.value) || aktuellesJahr)} style={{ ...inp, width: 90 }} />
        {canWrite && (
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            {saving ? 'Speichert…' : 'Saldovorträge speichern'}
          </button>
        )}
      </div>

      {/* Bilanzkontrolle */}
      <div style={{ flexShrink: 0, display: 'flex', gap: 0, background: '#fff', borderBottom: '1px solid #e4e9e4' }}>
        {[
          { label: 'Total Aktiven',  value: totalAktiv,  color: '#1e40af' },
          { label: 'Total Passiven', value: totalPassiv, color: '#9a3412' },
          { label: ausgeglichen ? '✓ Ausgeglichen' : '⚠ Differenz', value: differenz, color: ausgeglichen ? '#166534' : '#8a2d2d' },
        ].map((k, i) => (
          <div key={i} style={{ padding: '8px 16px', flex: 1, borderRight: i < 2 ? '1px solid #f0f3f0' : 'none' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#94a394' }}>{k.label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: k.color }}>CHF {CHF(k.value)}</div>
          </div>
        ))}
      </div>

      {msg && (
        <div style={{ flexShrink: 0, padding: '8px 16px', fontSize: 12, background: msg.type === 'ok' ? '#f0f7f0' : '#fdf0f0', color: msg.type === 'ok' ? '#166534' : '#8a2d2d', borderBottom: '1px solid #e4e9e4' }}>
          {msg.text}
        </div>
      )}

      {/* Konten */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#f7faf7', padding: 16 }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#94a394', fontSize: 13 }}>Lädt…</div>
        ) : (
          <>
            <div style={{ fontSize: 11.5, color: '#6b826b', marginBottom: 12, background: '#eef4ee', borderRadius: 8, padding: '8px 12px' }}>
              Beträge als <strong>positive Zahl</strong> erfassen (natürlicher Saldo): Aktivkonten = Sollsaldo, Passivkonten = Habensaldo.
              Negative Werte für Gegensalden. Beim Speichern werden alte Saldovorträge des Jahres ersetzt.
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <Spalte titel="Aktiven"  list={aktiv}  farbe="#1e40af" />
              <Spalte titel="Passiven" list={passiv} farbe="#9a3412" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
