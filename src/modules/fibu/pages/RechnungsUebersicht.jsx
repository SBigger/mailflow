/**
 * RechnungsUebersicht – Alle Kreditoren-Belege, editierbar
 *
 * - Filtert nach GJ / Zeitraum, Status, Lieferant, Suchtext
 * - Violetter Tint für MWST-abgerechnete Belege
 * - Edit-Modal: alle Felder änderbar AUSSER mwst_code + betrag wenn mwst_abgerechnet
 * - buchungsdatum steuert Verbuchung ins GJ (unabhängig vom Belegdatum)
 */
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMandant } from '../contexts/MandantContext';
import { kreditorenApi, lieferantenApi, kontenApi, mwstCodesApi } from '../api';

const CHF  = n => n == null ? '—' : new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const DATE = s => s ? new Date(s).toLocaleDateString('de-CH') : '—';
const today = () => new Date().toISOString().slice(0, 10);

const STATUS_META = {
  offen:       { bg: '#e4e4ea', color: '#4a4a5a', label: 'offen' },
  teilbezahlt: { bg: '#efe4f8', color: '#5f3a9c', label: 'teilbez.' },
  bezahlt:     { bg: '#e3eaf5', color: '#2e4a7d', label: 'bezahlt' },
  storniert:   { bg: '#fde7e7', color: '#8a2d2d', label: 'storniert' },
};

function StatusChip({ status }) {
  const m = STATUS_META[status] ?? STATUS_META.offen;
  return (
    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 600, background: m.bg, color: m.color }}>
      {m.label}
    </span>
  );
}

const inp = {
  background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7,
  padding: '6px 10px', fontSize: 12.5, color: '#1a1a2e', outline: 'none', width: '100%',
};
const inpDis = { ...inp, background: '#f0f0f0', color: '#888', cursor: 'not-allowed' };
const lbl = { fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 3, display: 'block' };

// ── Edit-Modal ────────────────────────────────────────────────────
function EditModal({ beleg, konten, mwstCodes, lieferanten, onSave, onClose }) {
  const mwstAbgerechnet = beleg.mwst_abgerechnet;
  const aufwandKonten   = konten.filter(k => k.konto_typ === 'aufwand');

  const [form, setForm] = useState({
    belegdatum:        beleg.belegdatum ?? '',
    buchungsdatum:     beleg.buchungsdatum ?? beleg.belegdatum ?? '',
    faelligkeit:       beleg.faelligkeit ?? '',
    lieferant_id:      beleg.lieferant_id ?? '',
    lieferant_beleg_nr: beleg.lieferant_beleg_nr ?? '',
    zahlungsreferenz:  beleg.zahlungsreferenz ?? '',
    notiz:             beleg.notiz ?? '',
  });

  // Konto-Änderung direkt auf Positionen (erste Position)
  const [konto, setKonto] = useState(beleg.positionen?.[0]?.konto_nr ?? '');
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(beleg.id, form, konto);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#fff', borderRadius: 14, width: 640, maxHeight: '90vh',
        overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        border: mwstAbgerechnet ? '2px solid #c9b8f0' : '1px solid #e4e9e4',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #e4e9e4',
          display: 'flex', alignItems: 'center', gap: 12,
          background: mwstAbgerechnet ? 'linear-gradient(135deg, #f8f4ff 0%, #f3eeff 100%)' : '#fff',
          borderRadius: '14px 14px 0 0',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a2e' }}>
              Beleg bearbeiten — {beleg.beleg_nr}
            </div>
            <div style={{ fontSize: 11.5, color: '#6b826b', marginTop: 2 }}>
              {beleg.lieferant?.name}
              {mwstAbgerechnet && (
                <span style={{ marginLeft: 8, background: '#ede4ff', color: '#5f3a9c', fontSize: 10.5, padding: '1px 7px', borderRadius: 5, fontWeight: 600 }}>
                  MWST abgerechnet – {beleg.mwst_abrechnung_ref}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 20, color: '#94a394' }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* MWST-Hinweis */}
          {mwstAbgerechnet && (
            <div style={{ background: '#f3eeff', border: '1px solid #c9b8f0', borderRadius: 9, padding: '10px 14px', fontSize: 12, color: '#5f3a9c' }}>
              ⚠ Dieser Beleg ist in der MWST-Abrechnung <strong>{beleg.mwst_abrechnung_ref}</strong> enthalten.
              MWST-Code und Beträge können nicht mehr geändert werden. Das Buchungskonto bleibt anpassbar.
            </div>
          )}

          {/* Zeile 1: Belegdatum + Buchungsdatum */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Belegdatum (Rechnungsdatum)</label>
              <input type="date" style={inp} value={form.belegdatum}
                onChange={e => set('belegdatum', e.target.value)} />
            </div>
            <div>
              <label style={lbl}>
                Buchungsdatum
                <span style={{ fontWeight: 400, color: '#94a394', marginLeft: 4 }}>— steuert Verbuchungsjahr</span>
              </label>
              <input type="date" style={inp} value={form.buchungsdatum}
                onChange={e => set('buchungsdatum', e.target.value)} />
            </div>
          </div>

          {/* Zeile 2: Fälligkeit + Lieferant */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Fälligkeit</label>
              <input type="date" style={inp} value={form.faelligkeit}
                onChange={e => set('faelligkeit', e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Lieferant</label>
              <select style={inp} value={form.lieferant_id} onChange={e => set('lieferant_id', e.target.value)}>
                {lieferanten.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>

          {/* Buchungskonto — immer änderbar */}
          <div>
            <label style={lbl}>
              Buchungskonto (Aufwand)
              {mwstAbgerechnet && (
                <span style={{ marginLeft: 6, fontWeight: 400, color: '#7a5aaa', fontSize: 10.5 }}>auch nach MWST-Abrechnung änderbar</span>
              )}
            </label>
            <select style={inp} value={konto} onChange={e => setKonto(e.target.value)}>
              <option value="">— Konto wählen —</option>
              {aufwandKonten.map(k => (
                <option key={k.konto_nr} value={k.konto_nr}>{k.konto_nr} {k.bezeichnung}</option>
              ))}
            </select>
          </div>

          {/* MWST-Info — gesperrt wenn abgerechnet */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>MWST-Code</label>
              {mwstAbgerechnet
                ? <input style={inpDis} value={beleg.positionen?.[0]?.mwst_code ?? '—'} readOnly />
                : (
                  <select style={inp} disabled>
                    <option>{beleg.positionen?.[0]?.mwst_code ?? '—'}</option>
                  </select>
                )
              }
            </div>
            <div>
              <label style={lbl}>Betrag netto</label>
              <input style={inpDis} value={CHF(beleg.betrag_netto)} readOnly />
            </div>
            <div>
              <label style={lbl}>Betrag brutto</label>
              <input style={inpDis} value={CHF(beleg.betrag_brutto)} readOnly />
            </div>
          </div>

          {/* Referenz + Notiz */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Beleg-Nr. Lieferant</label>
              <input style={inp} value={form.lieferant_beleg_nr}
                onChange={e => set('lieferant_beleg_nr', e.target.value)} placeholder="Rechnungsnummer des Lieferanten" />
            </div>
            <div>
              <label style={lbl}>Zahlungsreferenz</label>
              <input style={{ ...inp, fontFamily: 'monospace', fontSize: 11.5 }} value={form.zahlungsreferenz}
                onChange={e => set('zahlungsreferenz', e.target.value)} />
            </div>
          </div>
          <div>
            <label style={lbl}>Interne Notiz</label>
            <input style={inp} value={form.notiz} onChange={e => set('notiz', e.target.value)} />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid #e4e9e4', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>
            Abbrechen
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', opacity: saving ? .6 : 1 }}>
            {saving ? 'Speichert…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Hauptkomponente ───────────────────────────────────────────────
export default function RechnungsUebersicht() {
  const { mandant } = useMandant();
  const navigate    = useNavigate();

  const [belege,     setBelege]     = useState([]);
  const [lieferanten, setLieferanten] = useState([]);
  const [konten,     setKonten]     = useState([]);
  const [mwstCodes,  setMwstCodes]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [editBeleg,  setEditBeleg]  = useState(null);

  // Filter
  const curYear = new Date().getFullYear();
  const [vonFilter,    setVonFilter]    = useState(`${curYear}-01-01`);
  const [bisFilter,    setBisFilter]    = useState(`${curYear}-12-31`);
  const [statusFilter, setStatusFilter] = useState('alle');
  const [liefFilter,   setLiefFilter]   = useState('');
  const [search,       setSearch]       = useState('');

  const load = useCallback(async () => {
    if (!mandant?.id) return;
    setLoading(true);
    try {
      const data = await kreditorenApi.listAll(mandant.id, vonFilter || null, bisFilter || null);
      // Nach buchungsdatum sortieren (neueste zuerst), fallback auf belegdatum
      data.sort((a, b) => {
        const da = a.buchungsdatum || a.belegdatum || '';
        const db = b.buchungsdatum || b.belegdatum || '';
        return db.localeCompare(da);
      });
      setBelege(data);
    } finally {
      setLoading(false);
    }
  }, [mandant?.id, vonFilter, bisFilter]);

  useEffect(() => {
    if (!mandant?.id) return;
    Promise.all([
      lieferantenApi.list(mandant.id),
      kontenApi.list(mandant.id),
      mwstCodesApi.listAktiv(mandant.id),
    ]).then(([l, k, mc]) => {
      setLieferanten(l);
      setKonten(k);
      setMwstCodes(mc);
    });
  }, [mandant?.id]);

  useEffect(() => { load(); }, [load]);

  // Belege mit Positionen für Edit-Modal laden
  const openEdit = async (b) => {
    const full = await kreditorenApi.get(b.id);
    setEditBeleg(full);
  };

  const handleSave = async (id, form, konto) => {
    await kreditorenApi.update(id, {
      belegdatum:        form.belegdatum,
      buchungsdatum:     form.buchungsdatum,
      faelligkeit:       form.faelligkeit,
      lieferant_id:      form.lieferant_id,
      lieferant_beleg_nr: form.lieferant_beleg_nr,
      zahlungsreferenz:  form.zahlungsreferenz,
      notiz:             form.notiz,
    });
    // Konto auf erste Position schreiben
    if (konto && editBeleg?.positionen?.[0]?.id) {
      const { supabase } = await import('@/api/supabaseClient');
      await supabase
        .from('fibu_kreditoren_positionen')
        .update({ konto_nr: konto })
        .eq('id', editBeleg.positionen[0].id);
    }
    await load();
  };

  // Filter anwenden
  const filtered = useMemo(() => {
    return belege.filter(b => {
      if (statusFilter !== 'alle' && b.status !== statusFilter) return false;
      if (liefFilter && b.lieferant_id !== liefFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hit = (
          b.beleg_nr?.toLowerCase().includes(q) ||
          b.lieferant?.name?.toLowerCase().includes(q) ||
          b.lieferant_beleg_nr?.toLowerCase().includes(q) ||
          b.notiz?.toLowerCase().includes(q)
        );
        if (!hit) return false;
      }
      return true;
    });
  }, [belege, statusFilter, liefFilter, search]);

  const totalBrutto = filtered.reduce((s, b) => s + (b.betrag_brutto ?? 0), 0);
  const totalOffen  = filtered.filter(b => b.status !== 'bezahlt' && b.status !== 'storniert')
    .reduce((s, b) => s + (b.betrag_brutto - b.betrag_bezahlt), 0);

  const hdr = {
    fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em',
    color: '#6b826b', padding: '9px 12px', borderBottom: '2px solid #e4e9e4',
    textAlign: 'left', whiteSpace: 'nowrap', background: '#fff',
  };
  const td = { padding: '8px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5, verticalAlign: 'middle' };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e' }}>Rechnungsübersicht</div>
          <div style={{ fontSize: 12, color: '#6b826b', marginTop: 2 }}>
            Alle Kreditoren-Belege — bearbeitbar
          </div>
        </div>
        <button
          onClick={() => navigate(`/fibu/${mandant?.id}/kreditoren/erfassen`)}
          style={{ padding: '8px 18px', borderRadius: 9, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >+ Neue Rechnung</button>
      </div>

      {/* ── Filter-Zeile ── */}
      <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Zeitraum */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11.5, color: '#6b826b', fontWeight: 600 }}>Buchungsdatum</span>
          <input type="date" value={vonFilter} onChange={e => setVonFilter(e.target.value)}
            style={{ fontSize: 12, border: '1px solid #d4dcd4', borderRadius: 6, padding: '4px 8px', outline: 'none' }} />
          <span style={{ color: '#94a394' }}>–</span>
          <input type="date" value={bisFilter} onChange={e => setBisFilter(e.target.value)}
            style={{ fontSize: 12, border: '1px solid #d4dcd4', borderRadius: 6, padding: '4px 8px', outline: 'none' }} />
        </div>

        {/* Status */}
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ fontSize: 12, border: '1px solid #d4dcd4', borderRadius: 6, padding: '4px 8px', outline: 'none' }}>
          <option value="alle">Alle Status</option>
          <option value="offen">Offen</option>
          <option value="teilbezahlt">Teilbezahlt</option>
          <option value="bezahlt">Bezahlt</option>
          <option value="storniert">Storniert</option>
        </select>

        {/* Lieferant */}
        <select value={liefFilter} onChange={e => setLiefFilter(e.target.value)}
          style={{ fontSize: 12, border: '1px solid #d4dcd4', borderRadius: 6, padding: '4px 8px', outline: 'none' }}>
          <option value="">Alle Lieferanten</option>
          {lieferanten.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>

        {/* Suche */}
        <input placeholder="🔍 Suchen (Beleg-Nr, Lieferant, Notiz…)" value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200, fontSize: 12, border: '1px solid #d4dcd4', borderRadius: 6, padding: '4px 10px', outline: 'none' }} />

        {/* MWST-Legende */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: '#e8e0f8', border: '1px solid #c9b8f0' }} />
          <span style={{ fontSize: 11, color: '#7a5aaa' }}>MWST abgerechnet</span>
        </div>
      </div>

      {/* ── KPI Zeile ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {[
          { label: 'Belege (gefiltert)', value: filtered.length, unit: '' },
          { label: 'Total Brutto', value: 'CHF ' + CHF(totalBrutto), unit: '' },
          { label: 'Noch offen', value: 'CHF ' + CHF(totalOffen), color: totalOffen > 0 ? '#8a5a00' : '#3d6641' },
        ].map(k => (
          <div key={k.label} style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 9, padding: '12px 16px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#94a394' }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: k.color ?? '#1a1a2e' }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* ── Tabelle ── */}
      <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 12, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>Lädt…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>Keine Belege gefunden</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={hdr}>Beleg-Nr.</th>
                  <th style={hdr}>Lieferant</th>
                  <th style={hdr}>Belegdatum</th>
                  <th style={hdr}>Buchungsdatum</th>
                  <th style={hdr}>Fälligkeit</th>
                  <th style={{ ...hdr, textAlign: 'right' }}>Brutto CHF</th>
                  <th style={{ ...hdr, textAlign: 'right' }}>Offen CHF</th>
                  <th style={hdr}>Status</th>
                  <th style={hdr}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(b => {
                  const isMwstAbgerechnet = b.mwst_abgerechnet;
                  const offen = b.betrag_brutto - (b.betrag_bezahlt ?? 0);
                  const rowBg = isMwstAbgerechnet ? '#f5f0ff' : '#fff';
                  const hoverBg = isMwstAbgerechnet ? '#ede6ff' : '#f7faf7';

                  return (
                    <tr key={b.id}
                      style={{ cursor: 'pointer', background: rowBg }}
                      onMouseEnter={e => { e.currentTarget.querySelectorAll('td').forEach(t => t.style.background = hoverBg); }}
                      onMouseLeave={e => { e.currentTarget.querySelectorAll('td').forEach(t => t.style.background = ''); }}
                      onClick={() => openEdit(b)}
                    >
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>
                        {b.beleg_nr}
                        {isMwstAbgerechnet && (
                          <span title={`MWST abgerechnet ${b.mwst_abrechnung_ref ?? ''}`}
                            style={{ marginLeft: 5, fontSize: 10, background: '#ede4ff', color: '#5f3a9c', padding: '1px 5px', borderRadius: 3, fontFamily: 'sans-serif' }}>
                            MWST
                          </span>
                        )}
                      </td>
                      <td style={{ ...td, fontWeight: 500 }}>{b.lieferant?.name ?? '—'}</td>
                      <td style={td}>{DATE(b.belegdatum)}</td>
                      <td style={{ ...td, color: b.buchungsdatum !== b.belegdatum ? '#5f3a9c' : '#4a5a4a', fontWeight: b.buchungsdatum !== b.belegdatum ? 600 : 400 }}>
                        {DATE(b.buchungsdatum || b.belegdatum)}
                        {b.buchungsdatum && b.buchungsdatum !== b.belegdatum && (
                          <span title="Buchungsdatum weicht vom Belegdatum ab"
                            style={{ marginLeft: 5, fontSize: 10.5 }}>※</span>
                        )}
                      </td>
                      <td style={td}>{DATE(b.faelligkeit)}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{CHF(b.betrag_brutto)}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: offen > 0 ? '#8a5a00' : '#94a394' }}>
                        {b.status === 'bezahlt' || b.status === 'storniert' ? '—' : CHF(offen)}
                      </td>
                      <td style={td}><StatusChip status={b.status} /></td>
                      <td style={td}>
                        <button
                          onClick={e => { e.stopPropagation(); openEdit(b); }}
                          style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 6, border: '1px solid #d4dcd4', background: '#fff', cursor: 'pointer' }}
                        >Bearbeiten</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ ...td, fontWeight: 700, background: '#f7faf7', borderTop: '2px solid #d4dcd4', fontSize: 12 }}>
                    {filtered.length} Belege
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, background: '#f7faf7', borderTop: '2px solid #d4dcd4', fontVariantNumeric: 'tabular-nums' }}>
                    CHF {CHF(totalBrutto)}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, background: '#f7faf7', borderTop: '2px solid #d4dcd4', fontVariantNumeric: 'tabular-nums', color: totalOffen > 0 ? '#8a5a00' : '#94a394' }}>
                    CHF {CHF(totalOffen)}
                  </td>
                  <td colSpan={2} style={{ ...td, background: '#f7faf7', borderTop: '2px solid #d4dcd4' }} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {editBeleg && (
        <EditModal
          beleg={editBeleg}
          konten={konten}
          mwstCodes={mwstCodes}
          lieferanten={lieferanten}
          onSave={handleSave}
          onClose={() => setEditBeleg(null)}
        />
      )}
    </div>
  );
}
