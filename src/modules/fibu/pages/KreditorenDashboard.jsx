import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMandant } from '../contexts/MandantContext';
import { kreditorenApi } from '../api';

const CHF = (n) => n == null ? '—' : new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const DATE = (s) => s ? new Date(s).toLocaleDateString('de-CH') : '—';

function KpiCard({ label, value, sub, color }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#94a394' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.03em', lineHeight: 1, margin: '6px 0 3px', color: color ?? '#1a1a2e' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: '#6b826b' }}>{sub}</div>}
    </div>
  );
}

const STATUS_CHIP = {
  offen:       { bg: '#e4e4ea', color: '#4a4a5a', label: 'offen' },
  teilbezahlt: { bg: '#efe4f8', color: '#5f3a9c', label: 'teilbez.' },
  bezahlt:     { bg: '#e3eaf5', color: '#2e4a7d', label: 'bezahlt' },
  storniert:   { bg: '#fde7e7', color: '#8a2d2d', label: 'storniert' },
};

function StatusChip({ status }) {
  const s = STATUS_CHIP[status] ?? STATUS_CHIP.offen;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 500, background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

function faelligStatus(faelligkeit) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const f = new Date(faelligkeit); f.setHours(0, 0, 0, 0);
  const diff = Math.round((f - today) / 86400000);
  if (diff < 0) return { label: `überfällig +${Math.abs(diff)}`, bg: '#fde7e7', color: '#8a2d2d' };
  if (diff <= 7)  return { label: 'fällig',   bg: '#fef0c7', color: '#8a5a00' };
  return { label: 'offen', bg: '#e4e4ea', color: '#4a4a5a' };
}

export default function KreditorenDashboard() {
  const { mandant } = useMandant();
  const navigate = useNavigate();
  const [belege, setBelege] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!mandant) return;
    setLoading(true);
    kreditorenApi.listOffen(mandant.id)
      .then(setBelege)
      .finally(() => setLoading(false));
  }, [mandant?.id]);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const in7  = new Date(today.getTime() + 7 * 86400000);

  const totalOffen     = belege.reduce((s, b) => s + (b.betrag_brutto - b.betrag_bezahlt), 0);
  const fälligWoche    = belege.filter(b => new Date(b.faelligkeit) <= in7 && new Date(b.faelligkeit) >= today);
  const überfällig     = belege.filter(b => new Date(b.faelligkeit) < today);
  const totalFällig    = fälligWoche.reduce((s, b) => s + (b.betrag_brutto - b.betrag_bezahlt), 0);
  const totalÜberfällig = überfällig.reduce((s, b) => s + (b.betrag_brutto - b.betrag_bezahlt), 0);

  const base = `/fibu/${mandant?.id}`;

  const hdr = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6b826b', padding: '9px 12px', borderBottom: '2px solid #e4e9e4', textAlign: 'left', whiteSpace: 'nowrap', background: '#fff' };
  const td  = { padding: '9px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5, verticalAlign: 'middle' };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KpiCard label="Offene Rechnungen" value={`CHF ${CHF(totalOffen)}`} sub={`${belege.length} Beleg${belege.length !== 1 ? 'e' : ''} ausstehend`} />
        <KpiCard label="Fällig diese Woche" value={`CHF ${CHF(totalFällig)}`} sub={`${fälligWoche.length} Rechnungen bis ${in7.toLocaleDateString('de-CH')}`} color={totalFällig > 0 ? '#8a5a00' : undefined} />
        <KpiCard label="Überfällig" value={`CHF ${CHF(totalÜberfällig)}`} sub={`${überfällig.length} Rechnung${überfällig.length !== 1 ? 'en' : ''}`} color={totalÜberfällig > 0 ? '#8a2d2d' : undefined} />
        <KpiCard label="MWST-Abrechnung" value="— Q1" sub="Wird in Phase 2 berechnet" color="#2e4a7d" />
      </div>

      {/* Table + Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 14 }}>
        {/* Pending invoices */}
        <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #e4e9e4' }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>Offene Kreditoren-Rechnungen</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {überfällig.length > 0 && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 500, background: '#fde7e7', color: '#8a2d2d' }}>{überfällig.length} überfällig</span>}
              {fälligWoche.length > 0 && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 500, background: '#fef0c7', color: '#8a5a00' }}>{fälligWoche.length} fällig diese Woche</span>}
            </div>
          </div>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>Lädt…</div>
          ) : belege.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>Keine offenen Rechnungen</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={hdr}>Beleg-Nr.</th>
                    <th style={hdr}>Lieferant</th>
                    <th style={hdr}>Fälligkeit</th>
                    <th style={{ ...hdr, textAlign: 'right' }}>Offen CHF</th>
                    <th style={hdr}>Status</th>
                    <th style={hdr}></th>
                  </tr>
                </thead>
                <tbody>
                  {belege.slice(0, 8).map(b => {
                    const fs = faelligStatus(b.faelligkeit);
                    const offen = b.betrag_brutto - b.betrag_bezahlt;
                    return (
                      <tr key={b.id} style={{ cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.querySelectorAll('td').forEach(td => td.style.background = '#f7faf7')}
                          onMouseLeave={e => e.currentTarget.querySelectorAll('td').forEach(td => td.style.background = '')}
                      >
                        <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{b.beleg_nr}</td>
                        <td style={{ ...td, fontWeight: 500 }}>{b.lieferant?.name}</td>
                        <td style={{ ...td, color: fs.color, fontWeight: 500 }}>{DATE(b.faelligkeit)}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: fs.color === '#8a2d2d' ? '#8a2d2d' : undefined }}>{CHF(offen)}</td>
                        <td style={td}><span style={{ display: 'inline-flex', fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 500, background: fs.bg, color: fs.color }}>{fs.label}</span></td>
                        <td style={td}>
                          <button
                            style={{ fontSize: 11.5, padding: '4px 10px', borderRadius: 7, border: '1px solid #d4dcd4', background: '#fff', cursor: 'pointer', fontWeight: 500 }}
                            onClick={() => navigate(`${base}/kreditoren/zahlungslauf`)}
                          >Zahlen</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {belege.length > 0 && (
                  <tfoot>
                    <tr>
                      <td colSpan={3} style={{ ...td, fontWeight: 700, background: '#f7faf7', borderTop: '2px solid #d4dcd4' }}>Total offen</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700, background: '#f7faf7', borderTop: '2px solid #d4dcd4', fontVariantNumeric: 'tabular-nums' }}>CHF {CHF(totalOffen)}</td>
                      <td colSpan={2} style={{ ...td, background: '#f7faf7', borderTop: '2px solid #d4dcd4' }}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, padding: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Schnellaktionen</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: 'Neue Rechnung erfassen', path: 'kreditoren/erfassen', primary: true },
                { label: 'Zahlungslauf starten',   path: 'kreditoren/zahlungslauf' },
                { label: 'OP-Liste per Stichtag',   path: 'kreditoren/opliste' },
                { label: 'Lieferanten verwalten',   path: 'kreditoren/lieferanten' },
              ].map(a => (
                <button
                  key={a.label}
                  onClick={() => navigate(`${base}/${a.path}`)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
                    borderRadius: 8, border: a.primary ? 'none' : '1px solid #d4dcd4',
                    background: a.primary ? '#7a9b7f' : '#fff',
                    color: a.primary ? '#fff' : '#4a5a4a',
                    fontSize: 12.5, fontWeight: 500, cursor: 'pointer', width: '100%',
                    textAlign: 'left',
                  }}
                >{a.label}</button>
              ))}
            </div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, padding: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Mandant</div>
            <div style={{ fontSize: 12, color: '#4a5a4a', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div><span style={{ color: '#94a394' }}>Name: </span>{mandant?.name}</div>
              {mandant?.uid && <div><span style={{ color: '#94a394' }}>UID: </span>{mandant.uid}</div>}
              {mandant?.mwst_nr && <div><span style={{ color: '#94a394' }}>MWST-Nr: </span>{mandant.mwst_nr}</div>}
              <div><span style={{ color: '#94a394' }}>Währung: </span>{mandant?.waehrung}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
