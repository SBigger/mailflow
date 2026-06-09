/**
 * Rechnungsübersicht (Debitoren) — Liste aller Ausgangsrechnungen + KPIs.
 * Entwürfe können gestellt (verbucht) werden.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMandant } from '../contexts/MandantContext';
import { debitorenApi } from '../api';

const CHF = n => (parseFloat(n) || 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

const STATUS_META = {
  entwurf:     { bg: '#eceef0', color: '#5a6470', label: 'Entwurf' },
  offen:       { bg: '#e4e4ea', color: '#4a4a5a', label: 'offen' },
  teilbezahlt: { bg: '#efe4f8', color: '#5f3a9c', label: 'teilbezahlt' },
  bezahlt:     { bg: '#e3eaf5', color: '#2e4a7d', label: 'bezahlt' },
  storniert:   { bg: '#fde7e7', color: '#8a2d2d', label: 'storniert' },
};

export default function DebitorenUebersicht() {
  const { mandant } = useMandant();
  const navigate = useNavigate();
  const [belege, setBelege] = useState([]);
  const [loading, setLoading] = useState(true);
  const base = `/fibu/${mandant?.id}/debitoren`;

  const load = useCallback(() => {
    if (!mandant?.id) return;
    setLoading(true);
    debitorenApi.list(mandant.id).then(setBelege).catch(console.error).finally(() => setLoading(false));
  }, [mandant?.id]);
  useEffect(load, [load]);

  const stellen = async (b) => {
    if (!confirm(`Rechnung ${b.beleg_nr} stellen und verbuchen?`)) return;
    try { await debitorenApi.stellen(b.id); load(); }
    catch (e) { alert('Fehler: ' + e.message); }
  };

  const offenSum = belege.filter(b => ['offen', 'teilbezahlt'].includes(b.status))
    .reduce((s, b) => s + (b.betrag_brutto - (b.betrag_bezahlt || 0)), 0);
  const ueberfaellig = belege.filter(b => ['offen', 'teilbezahlt'].includes(b.status) && b.faelligkeit < today())
    .reduce((s, b) => s + (b.betrag_brutto - (b.betrag_bezahlt || 0)), 0);
  const entwuerfe = belege.filter(b => b.status === 'entwurf').length;

  const KPI = ({ label, val, color }) => (
    <div style={{ background: '#fff', border: '1px solid #d4dcd4', borderRadius: 12, padding: '14px 16px', flex: 1 }}>
      <div style={{ fontSize: 11, color: '#7a9a7f', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: color || '#1a1a2e' }}>{val}</div>
    </div>
  );

  return (
    <div style={{ flex: 1, overflow: 'auto', background: '#f2f5f2' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '14px 24px', background: '#fff', borderBottom: '1px solid #d4dcd4' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Rechnungen</div>
          <div style={{ fontSize: 11.5, color: '#7a9a7f' }}>Debitoren · Ausgangsrechnungen</div>
        </div>
        <button onClick={() => navigate(`${base}/erfassen`)} style={{ marginLeft: 'auto', padding: '8px 16px', borderRadius: 8, border: 'none', background: '#3d6641', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          + Neue Rechnung
        </button>
      </div>

      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', gap: 14, marginBottom: 18 }}>
          <KPI label="Offen total" val={`CHF ${CHF(offenSum)}`} />
          <KPI label="Überfällig" val={`CHF ${CHF(ueberfaellig)}`} color={ueberfaellig > 0 ? '#c0392b' : undefined} />
          <KPI label="Entwürfe" val={entwuerfe} color={entwuerfe > 0 ? '#c47a1e' : undefined} />
          <KPI label="Rechnungen total" val={belege.length} />
        </div>

        <div style={{ background: '#fff', border: '1px solid #d4dcd4', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: '#f7faf7', color: '#6b826b', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                <th style={{ textAlign: 'left', padding: '9px 12px' }}>Nr.</th>
                <th style={{ textAlign: 'left', padding: '9px 12px' }}>Kunde</th>
                <th style={{ textAlign: 'left', padding: '9px 12px' }}>Titel</th>
                <th style={{ textAlign: 'left', padding: '9px 12px' }}>Datum</th>
                <th style={{ textAlign: 'left', padding: '9px 12px' }}>Fällig</th>
                <th style={{ textAlign: 'right', padding: '9px 12px' }}>Betrag</th>
                <th style={{ textAlign: 'left', padding: '9px 12px' }}>Status</th>
                <th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} style={{ padding: 20, color: '#94a394' }}>Lädt…</td></tr>}
              {!loading && belege.length === 0 && <tr><td colSpan={8} style={{ padding: 20, color: '#94a394' }}>Noch keine Rechnungen — erstelle die erste.</td></tr>}
              {belege.map(b => {
                const m = STATUS_META[b.status] ?? STATUS_META.offen;
                const ueber = ['offen', 'teilbezahlt'].includes(b.status) && b.faelligkeit < today();
                return (
                  <tr key={b.id} style={{ borderTop: '1px solid #f0f3f0' }}>
                    <td style={{ padding: '9px 12px', fontVariantNumeric: 'tabular-nums', color: '#6b826b' }}>{b.beleg_nr}</td>
                    <td style={{ padding: '9px 12px', fontWeight: 600 }}>{b.kunde?.name || '—'}</td>
                    <td style={{ padding: '9px 12px', color: '#6b826b' }}>{b.titel || '—'}</td>
                    <td style={{ padding: '9px 12px' }}>{b.belegdatum}</td>
                    <td style={{ padding: '9px 12px', color: ueber ? '#c0392b' : undefined, fontWeight: ueber ? 600 : 400 }}>{b.faelligkeit}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{CHF(b.betrag_brutto)}</td>
                    <td style={{ padding: '9px 12px' }}><span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 600, background: m.bg, color: m.color }}>{ueber ? 'überfällig' : m.label}</span></td>
                    <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                      {b.status === 'entwurf' && (
                        <button onClick={() => stellen(b)} style={{ fontSize: 11.5, padding: '4px 10px', borderRadius: 6, border: '1px solid #3d6641', background: '#fff', color: '#3d6641', fontWeight: 600, cursor: 'pointer' }}>Stellen</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
