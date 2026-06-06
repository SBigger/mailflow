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
import LieferantLink from '../components/LieferantLink';
import { useMandant } from '../contexts/MandantContext';
import { kreditorenApi, lieferantenApi, kontenApi, mwstCodesApi } from '../api';

const CHF  = n => n == null ? '—' : new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const DATE = s => s ? new Date(s).toLocaleDateString('de-CH') : '—';
const today = () => new Date().toISOString().slice(0, 10);

const STATUS_META = {
  offen:       { bg: '#e4e4ea', color: '#4a4a5a', label: 'offen' },
  ausstehend:  { bg: '#fef3c7', color: '#92400e', label: 'ausstehend' },
  ebanking:    { bg: '#dbeafe', color: '#1e40af', label: 'DSP' },
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
  const vorsteuerCodes  = mwstCodes.filter(c => c.typ === 'vorsteuer' || c.typ === 'steuerbefreit');
  const mwstMap         = Object.fromEntries(mwstCodes.map(c => [c.code, c.satz ?? 0]));

  const calcMwst = (brutto, code) => {
    const satz = mwstMap[code] ?? 0;
    const b = parseFloat(brutto) || 0;
    const netto = satz > 0 ? Math.round(b / (1 + satz / 100) * 100) / 100 : b;
    return { betrag_netto: netto, betrag_mwst: Math.round((b - netto) * 100) / 100 };
  };

  const [form, setForm] = useState({
    belegdatum:         beleg.belegdatum ?? '',
    buchungsdatum:      beleg.buchungsdatum ?? beleg.belegdatum ?? '',
    faelligkeit:        beleg.faelligkeit ?? '',
    lieferant_id:       beleg.lieferant_id ?? '',
    lieferant_beleg_nr: beleg.lieferant_beleg_nr ?? '',
    zahlungsreferenz:   beleg.zahlungsreferenz ?? '',
    notiz:              beleg.notiz ?? '',
  });

  // Positionen – aus Beleg vorbelegen oder Einzel-Position aus Beleg-Totals erzeugen
  const [positionen, setPositionen] = useState(() => {
    const pos = beleg.positionen ?? [];
    const dfltCode = vorsteuerCodes[0]?.code ?? 'M81';
    if (pos.length === 0) {
      const brutto = String(Math.abs(beleg.betrag_brutto ?? 0));
      return [{
        _key: Math.random(), konto_nr: '', bezeichnung: '',
        mwst_code: dfltCode, betrag_brutto: brutto,
        ...calcMwst(brutto, dfltCode),
      }];
    }
    return pos.map(p => ({
      ...p, _key: p.id ?? Math.random(),
      betrag_brutto: String(Math.abs(p.betrag_brutto ?? 0)),
      betrag_netto:  Math.abs(p.betrag_netto ?? 0),
      betrag_mwst:   Math.abs(p.betrag_mwst  ?? 0),
    }));
  });

  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const updatePos = (idx, field, val) => {
    setPositionen(prev => {
      const next = [...prev];
      const p = { ...next[idx], [field]: val };
      if (field === 'betrag_brutto' || field === 'mwst_code') {
        Object.assign(p, calcMwst(p.betrag_brutto, p.mwst_code));
      }
      next[idx] = p;
      return next;
    });
  };

  const addPos = () => {
    const code = vorsteuerCodes[0]?.code ?? 'M81';
    setPositionen(prev => [...prev, {
      _key: Math.random(), konto_nr: '', bezeichnung: '',
      mwst_code: code, betrag_brutto: '', betrag_netto: 0, betrag_mwst: 0,
    }]);
  };

  const removePos = (idx) => {
    if (positionen.length <= 1) return;
    setPositionen(prev => prev.filter((_, i) => i !== idx));
  };

  const totalBrutto = positionen.reduce((s, p) => s + (parseFloat(p.betrag_brutto) || 0), 0);
  const multiPos    = positionen.length > 1;

  const handleSave = async () => {
    setSaving(true);
    try {
      const enriched = positionen.map(p => ({
        ...p, ...calcMwst(p.betrag_brutto, p.mwst_code),
        betrag_brutto: parseFloat(p.betrag_brutto) || 0,
      }));
      await onSave(beleg.id, form, enriched);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const fmtN = n => (n == null ? '—' : Number(n).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  // Kompakter Stil für Positions-Tabelle
  const piS  = { ...inp, fontSize: 11.5, padding: '3px 6px' };
  const piSD = { ...inpDis, fontSize: 11.5, padding: '3px 6px' };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#fff', borderRadius: 14, width: 720, maxHeight: '92vh',
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
              Beträge und MWST-Code sind gesperrt. Das Buchungskonto bleibt anpassbar.
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

          {/* ── Buchungskonten / Aufteilung ── */}
          <div style={{ border: '1px solid #e4e9e4', borderRadius: 9, overflow: 'hidden' }}>
            {/* Abschnitt-Header */}
            <div style={{
              display: 'flex', alignItems: 'center', padding: '8px 12px',
              background: multiPos ? '#fff8f0' : '#fafcfa',
              borderBottom: '1px solid #e4e9e4',
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b' }}>
                {multiPos
                  ? `⊞ Kontoaufteilung — ${positionen.length} Zeilen`
                  : 'Buchungskonto'}
                {mwstAbgerechnet && <span style={{ fontWeight: 400, color: '#7a5aaa', marginLeft: 6, fontSize: 10.5, textTransform: 'none' }}>auch nach MWST-Abrechnung änderbar</span>}
              </span>
              <span style={{ flex: 1 }} />
              {!mwstAbgerechnet && (
                <button onClick={addPos}
                  style={{ fontSize: 11.5, fontWeight: 500, color: '#7a9b7f', border: 'none', background: 'none', cursor: 'pointer', padding: '2px 4px' }}
                  title="Zusätzliche Konto-Zeile für Aufteilung">
                  + Aufteilungszeile
                </button>
              )}
            </div>

            {/* Spalten-Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 65px 68px 22px', gap: 4, padding: '4px 10px 3px', background: '#f7faf7', borderBottom: '1px solid #eff3ef' }}>
              {['Konto (Aufwand)', 'Brutto CHF', 'MWST', 'Netto CHF', ''].map((h, i) => (
                <span key={i} style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#94a394', paddingLeft: i === 0 ? 2 : (i === 1 || i === 3) ? 0 : 2, textAlign: (i === 1 || i === 3) ? 'right' : 'left' }}>{h}</span>
              ))}
            </div>

            {/* Positions-Zeilen */}
            {positionen.map((p, idx) => (
              <div key={p._key ?? idx} style={{
                display: 'grid', gridTemplateColumns: '1fr 80px 65px 68px 22px',
                gap: 4, padding: '5px 10px', alignItems: 'center',
                borderBottom: idx < positionen.length - 1 ? '1px solid #f5f7f5' : 'none',
                background: idx % 2 === 0 ? '#fff' : '#fafcfa',
              }}>
                {/* Konto — immer editierbar */}
                <select style={piS} value={p.konto_nr} onChange={e => updatePos(idx, 'konto_nr', e.target.value)}>
                  <option value="">— Konto wählen —</option>
                  {aufwandKonten.map(k => (
                    <option key={k.konto_nr} value={k.konto_nr}>{k.konto_nr} {k.bezeichnung}</option>
                  ))}
                </select>

                {/* Brutto CHF — gesperrt wenn mwst_abgerechnet */}
                <input type="number" step="0.01"
                  style={{ ...((mwstAbgerechnet) ? piSD : piS), textAlign: 'right' }}
                  value={p.betrag_brutto}
                  onChange={e => updatePos(idx, 'betrag_brutto', e.target.value)}
                  disabled={mwstAbgerechnet}
                  placeholder="0.00"
                />

                {/* MWST-Code — gesperrt wenn mwst_abgerechnet */}
                {mwstAbgerechnet
                  ? <input style={piSD} value={p.mwst_code ?? '—'} readOnly />
                  : (
                    <select style={piS} value={p.mwst_code} onChange={e => updatePos(idx, 'mwst_code', e.target.value)}>
                      {vorsteuerCodes.map(c => (
                        <option key={c.code} value={c.code}>{c.code}{c.satz > 0 ? ` ${c.satz}%` : ''}</option>
                      ))}
                    </select>
                  )
                }

                {/* Netto — immer read-only (berechnet) */}
                <span style={{ textAlign: 'right', fontSize: 12, color: '#4a5a4a', fontVariantNumeric: 'tabular-nums', paddingRight: 2 }}>
                  {fmtN(p.betrag_netto)}
                </span>

                {/* Löschen — nur wenn >1 Position */}
                <button
                  onClick={() => removePos(idx)}
                  disabled={positionen.length <= 1}
                  title="Zeile entfernen"
                  style={{
                    border: 'none', background: 'none', cursor: positionen.length > 1 ? 'pointer' : 'default',
                    color: positionen.length > 1 ? '#c0726a' : '#e0e4e0',
                    fontSize: 13, padding: '0 2px', lineHeight: 1,
                  }}>✕</button>
              </div>
            ))}

            {/* Total-Zeile — nur bei Aufteilung */}
            {multiPos && (
              <div style={{
                display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
                padding: '6px 36px 6px 12px', background: '#f7faf7',
                borderTop: '2px solid #e4e9e4', gap: 16,
              }}>
                <span style={{ fontSize: 11.5, color: '#6b826b' }}>Total Brutto:</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e', fontVariantNumeric: 'tabular-nums', minWidth: 70, textAlign: 'right' }}>
                  CHF {fmtN(totalBrutto)}
                </span>
              </div>
            )}
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
        <div style={{ padding: '14px 20px', borderTop: '1px solid #e4e9e4', display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          {multiPos && (
            <span style={{ fontSize: 11.5, color: '#6b826b', marginRight: 'auto' }}>
              {positionen.length} Buchungskonten — Total CHF {fmtN(totalBrutto)}
            </span>
          )}
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

  // Storno-State
  const [stornoBeleg,      setStornoBeleg]      = useState(null);
  const [stornoDatum,      setStornoDatum]      = useState('');
  const [stornoProcessing, setStornoProcessing] = useState(false);

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

  const handleStorno = async () => {
    if (!stornoBeleg || !stornoDatum) return;
    setStornoProcessing(true);
    try {
      await kreditorenApi.storno(stornoBeleg.id, stornoDatum);
      setStornoBeleg(null);
      setStornoDatum('');
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setStornoProcessing(false);
    }
  };

  const handleDelete = async (b) => {
    if (!window.confirm(`Beleg ${b.beleg_nr} wirklich löschen?\n\nDiese Aktion kann nicht rückgängig gemacht werden.`)) return;
    try {
      await kreditorenApi.deleteBeleg(b.id);
      await load();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleDeleteAllStorniert = async () => {
    const stornierte = belege.filter(b =>
      b.status === 'storniert' && !b.mwst_abgerechnet && (b.betrag_bezahlt || 0) === 0
    );
    if (!stornierte.length) return;
    if (!window.confirm(`${stornierte.length} stornierte Belege (inkl. Storno-Gegenbuchungen) wirklich löschen?\n\nDiese Aktion kann nicht rückgängig gemacht werden.`)) return;
    const errs = [];
    // Reihenfolge: zuerst die -S Storno-Belege (die auf Originale zeigen),
    // dann die Originale. Heuristik: storno_beleg_id NULL = Storno-Beleg selbst.
    const sorted = [...stornierte].sort((a, b) => {
      const aIsStorno = (a.beleg_nr || '').endsWith('-S');
      const bIsStorno = (b.beleg_nr || '').endsWith('-S');
      return (bIsStorno ? 1 : 0) - (aIsStorno ? 1 : 0);
    });
    for (const b of sorted) {
      try { await kreditorenApi.deleteBeleg(b.id); }
      catch (e) { errs.push(`${b.beleg_nr}: ${e.message}`); }
    }
    await load();
    if (errs.length > 0) {
      alert(`${errs.length} Beleg(e) konnten nicht gelöscht werden:\n\n${errs.slice(0, 5).join('\n')}${errs.length > 5 ? `\n…und ${errs.length - 5} weitere` : ''}`);
    }
  };

  // Belege mit Positionen für Edit-Modal laden
  const openEdit = async (b) => {
    const full = await kreditorenApi.get(b.id);
    setEditBeleg(full);
  };

  const handleSave = async (id, form, positionen) => {
    // 1. Beleg-Kopffelder aktualisieren
    await kreditorenApi.update(id, {
      belegdatum:         form.belegdatum,
      buchungsdatum:      form.buchungsdatum,
      faelligkeit:        form.faelligkeit,
      lieferant_id:       form.lieferant_id,
      lieferant_beleg_nr: form.lieferant_beleg_nr,
      zahlungsreferenz:   form.zahlungsreferenz,
      notiz:              form.notiz,
    });

    // 2. Positionen ersetzen (Delete + Insert)
    const validPos = (positionen ?? []).filter(p => (p.betrag_brutto ?? 0) > 0);
    if (validPos.length > 0 && editBeleg?.mandant_id) {
      const { supabase: sb } = await import('@/api/supabaseClient');

      // Alle bisherigen Positionen löschen
      await sb.from('fibu_kreditoren_positionen').delete().eq('beleg_id', id);

      // Neue Positionen einfügen
      await sb.from('fibu_kreditoren_positionen').insert(
        validPos.map((p, i) => ({
          beleg_id:      id,
          mandant_id:    editBeleg.mandant_id,
          position:      i + 1,
          konto_nr:      p.konto_nr || null,
          bezeichnung:   p.bezeichnung || null,
          mwst_code:     p.mwst_code,
          mwst_satz:     mwstCodes.find(c => c.code === p.mwst_code)?.satz ?? 0,
          betrag_netto:  Math.round((p.betrag_netto  ?? 0) * 100) / 100,
          betrag_mwst:   Math.round((p.betrag_mwst   ?? 0) * 100) / 100,
          betrag_brutto: Math.round((p.betrag_brutto ?? 0) * 100) / 100,
        }))
      );

      // Beleg-Totals aus Positionen neu berechnen
      const tot = validPos.reduce((a, p) => ({
        netto:  a.netto  + (p.betrag_netto  ?? 0),
        mwst:   a.mwst   + (p.betrag_mwst   ?? 0),
        brutto: a.brutto + (p.betrag_brutto  ?? 0),
      }), { netto: 0, mwst: 0, brutto: 0 });

      await sb.from('fibu_kreditoren_belege').update({
        betrag_netto:  Math.round(tot.netto  * 100) / 100,
        betrag_mwst:   Math.round(tot.mwst   * 100) / 100,
        betrag_brutto: Math.round(tot.brutto * 100) / 100,
      }).eq('id', id);
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {belege.filter(b => b.status === 'storniert' && !b.mwst_abgerechnet && (b.betrag_bezahlt||0)===0).length > 0 && (
            <button
              onClick={handleDeleteAllStorniert}
              title="Alle stornierten Belege (inkl. Gegenbuchungen) löschen"
              style={{ padding: '8px 14px', borderRadius: 9, border: '1px solid #f0b0b0', background: '#fff5f5', color: '#c0302a', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
            >
              🗑 {belege.filter(b => b.status === 'storniert' && !b.mwst_abgerechnet && (b.betrag_bezahlt||0)===0).length} Stornierte löschen
            </button>
          )}
          <button
            onClick={() => navigate(`/fibu/${mandant?.id}/kreditoren/erfassen`)}
            style={{ padding: '8px 18px', borderRadius: 9, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >+ Neue Rechnung</button>
        </div>
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
                      <td style={{ ...td, fontWeight: 500 }}><LieferantLink id={b.lieferant_id} name={b.lieferant?.name} /></td>
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
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <button
                          onClick={e => { e.stopPropagation(); openEdit(b); }}
                          style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 6, border: '1px solid #d4dcd4', background: '#fff', cursor: 'pointer' }}
                        >Bearbeiten</button>
                        {b.status !== 'storniert' && b.status !== 'bezahlt' && (
                          <button
                            onClick={e => { e.stopPropagation(); setStornoBeleg(b); setStornoDatum(today()); }}
                            title="Beleg stornieren"
                            style={{ marginLeft: 4, fontSize: 11.5, padding: '3px 10px', borderRadius: 6, border: '1px solid #f0c0b0', background: '#fff8f5', color: '#8a4a2a', cursor: 'pointer' }}
                          >Storno</button>
                        )}
                        {!['bezahlt','teilbezahlt','ebanking'].includes(b.status) && !b.mwst_abgerechnet && (b.betrag_bezahlt || 0) === 0 && (
                          <button
                            onClick={e => { e.stopPropagation(); handleDelete(b); }}
                            title="Beleg löschen"
                            style={{ marginLeft: 4, fontSize: 13, padding: '2px 7px', borderRadius: 6, border: '1px solid #f0b0b0', background: '#fff5f5', color: '#c0302a', cursor: 'pointer', lineHeight: 1.2 }}
                          >🗑</button>
                        )}
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

      {/* ── Storno-Dialog ── */}
      {stornoBeleg && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) { setStornoBeleg(null); setStornoDatum(''); } }}>
          <div style={{ background: '#fff', borderRadius: 14, width: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', border: '1px solid #f0c0b0' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0e4e4', background: 'linear-gradient(135deg, #fff8f5 0%, #fef2ee 100%)', borderRadius: '14px 14px 0 0' }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#8a2d2d' }}>Beleg stornieren</div>
              <div style={{ fontSize: 12, color: '#6b826b', marginTop: 2 }}>{stornoBeleg.beleg_nr} — {stornoBeleg.lieferant?.name}</div>
            </div>
            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 12.5, color: '#4a4a5a' }}>
                Es wird eine Storno-Gutschrift erstellt. Der Beleg wird als «storniert» markiert.
              </div>
              <div>
                <label style={lbl}>Storno-Datum</label>
                <input type="date" style={inp} value={stornoDatum} onChange={e => setStornoDatum(e.target.value)} />
              </div>
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid #f0e4e4', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setStornoBeleg(null); setStornoDatum(''); }}
                style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>
                Abbrechen
              </button>
              <button onClick={handleStorno} disabled={stornoProcessing || !stornoDatum}
                style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#c0402a', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', opacity: (stornoProcessing || !stornoDatum) ? .6 : 1 }}>
                {stornoProcessing ? 'Storniert…' : 'Stornieren'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
