import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMandant } from '../contexts/MandantContext';
import { lieferantenApi, kontenApi, kreditorenApi } from '../api';

const MWST = { VS81: 8.1, VS26: 2.6, VS38: 3.8, '0': 0 };
const CHF = (n) => n == null ? '' : Number(n).toFixed(2);
const inp = { background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '6px 10px', fontSize: 12.5, color: '#1a1a2e', outline: 'none', width: '100%' };
const lbl = { fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 3, display: 'block' };

function addDays(dateStr, days) {
  if (!dateStr) return '';
  const d = new Date(dateStr); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function calcPosition(pos) {
  const satz = MWST[pos.mwst_code] ?? 0;
  const netto = parseFloat(pos.betrag_netto) || 0;
  const mwst = Math.round(netto * satz) / 100;
  return { ...pos, mwst_satz: satz, betrag_mwst: mwst, betrag_brutto: netto + mwst };
}

const emptyPos = () => ({ _key: Math.random(), konto_nr: '', bezeichnung: '', mwst_code: 'VS81', betrag_netto: '', betrag_mwst: 0, betrag_brutto: 0, mwst_satz: 8.1 });

export default function RechnungErfassen() {
  const { mandant, canWrite } = useMandant();
  const { belegId } = useParams();
  const navigate = useNavigate();

  const [lieferanten, setLieferanten] = useState([]);
  const [konten, setKonten] = useState([]);
  const [saving, setSaving] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [pdfFile, setPdfFile] = useState(null);
  const fileRef = useRef();

  const today = new Date().toISOString().slice(0, 10);
  const [head, setHead] = useState({
    lieferant_id: '', lieferant_beleg_nr: '',
    belegdatum: today, faelligkeit: '',
    zahlungsbedingung_tage: 30, waehrung: 'CHF',
    zahlungsreferenz: '', notiz: '',
  });
  const [positionen, setPositionen] = useState([emptyPos()]);

  useEffect(() => {
    if (!mandant) return;
    Promise.all([lieferantenApi.list(mandant.id), kontenApi.list(mandant.id)])
      .then(([l, k]) => { setLieferanten(l); setKonten(k.filter(k => k.konto_typ === 'aufwand')); });
  }, [mandant?.id]);

  // Auto-fälligkeit aus Lieferant
  const handleLieferantChange = (id) => {
    const l = lieferanten.find(x => x.id === id);
    setHead(prev => ({
      ...prev,
      lieferant_id: id,
      zahlungsbedingung_tage: l?.zahlungsbedingung_tage ?? 30,
      faelligkeit: addDays(prev.belegdatum, l?.zahlungsbedingung_tage ?? 30),
    }));
    if (l?.standard_konto_nr && positionen.length === 1 && !positionen[0].konto_nr) {
      setPositionen([{ ...positionen[0], konto_nr: l.standard_konto_nr, mwst_code: l.mwst_code ?? 'VS81' }].map(calcPosition));
    }
  };

  const handleBelegdatumChange = (val) => {
    setHead(prev => ({ ...prev, belegdatum: val, faelligkeit: addDays(val, prev.zahlungsbedingung_tage) }));
  };

  const updatePos = (idx, field, value) => {
    setPositionen(prev => {
      const next = [...prev];
      next[idx] = calcPosition({ ...next[idx], [field]: value });
      return next;
    });
  };

  const totals = positionen.reduce(
    (s, p) => ({ netto: s.netto + (parseFloat(p.betrag_netto) || 0), mwst: s.mwst + (p.betrag_mwst || 0), brutto: s.brutto + (p.betrag_brutto || 0) }),
    { netto: 0, mwst: 0, brutto: 0 }
  );

  const handleOcr = async () => {
    if (!pdfFile) return;
    setOcrLoading(true);
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('deu');
      const { data: { text } } = await worker.recognize(pdfFile);
      await worker.terminate();
      // Einfache Heuristik: Betrag suchen
      const betragMatch = text.match(/(?:Total|Betrag|CHF)[^\d]*(\d[\d'.,]+)/i);
      if (betragMatch) {
        const raw = betragMatch[1].replace(/'/g, '').replace(',', '.');
        const brutto = parseFloat(raw);
        if (!isNaN(brutto)) {
          const satz = MWST[positionen[0]?.mwst_code ?? 'VS81'] ?? 8.1;
          const netto = Math.round(brutto / (1 + satz / 100) * 100) / 100;
          updatePos(0, 'betrag_netto', CHF(netto));
        }
      }
      // Datum suchen
      const datumMatch = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      if (datumMatch) {
        const [, d, m, y] = datumMatch;
        setHead(prev => ({ ...prev, belegdatum: `${y}-${m}-${d}`, faelligkeit: addDays(`${y}-${m}-${d}`, prev.zahlungsbedingung_tage) }));
      }
    } catch (e) {
      console.error('OCR Fehler:', e);
    } finally {
      setOcrLoading(false);
    }
  };

  const handleSave = async () => {
    if (!head.lieferant_id || !head.belegdatum || !head.faelligkeit) return;
    setSaving(true);
    try {
      const belegNr = await kreditorenApi.nextBelegNr(mandant.id);
      const pos = positionen.filter(p => parseFloat(p.betrag_netto) > 0).map(p => ({
        konto_nr: p.konto_nr || '6800',
        bezeichnung: p.bezeichnung,
        mwst_code: p.mwst_code,
        mwst_satz: p.mwst_satz,
        betrag_netto: parseFloat(p.betrag_netto) || 0,
        betrag_mwst: p.betrag_mwst,
        betrag_brutto: p.betrag_brutto,
      }));
      await kreditorenApi.create(mandant.id, {
        ...head,
        beleg_nr: belegNr,
        betrag_netto: totals.netto,
        betrag_mwst: totals.mwst,
        betrag_brutto: totals.brutto,
      }, pos);
      navigate(`/fibu/${mandant.id}/kreditoren`);
    } finally {
      setSaving(false);
    }
  };

  const hdrTd = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b', padding: '8px 10px', borderBottom: '1px solid #e4e9e4', textAlign: 'left', background: '#fff', whiteSpace: 'nowrap' };
  const cellTd = { padding: '6px 8px', borderBottom: '1px solid #f0f3f0', verticalAlign: 'middle' };

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* Form */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16, borderRight: '1px solid #e4e9e4' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{belegId ? 'Rechnung bearbeiten' : 'Neue Kreditoren-Rechnung'}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => navigate(`/fibu/${mandant?.id}/kreditoren`)} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>Abbrechen</button>
            <button
              onClick={handleSave}
              disabled={!canWrite || saving || !head.lieferant_id}
              style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', opacity: (!canWrite || saving || !head.lieferant_id) ? .5 : 1 }}
            >{saving ? 'Speichert…' : 'Speichern & Buchen'}</button>
          </div>
        </div>

        {/* Belegkopf */}
        <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#94a394', marginBottom: 12 }}>Belegkopf</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Lieferant *</label>
              <select style={inp} value={head.lieferant_id} onChange={e => handleLieferantChange(e.target.value)}>
                <option value="">— wählen —</option>
                {lieferanten.filter(l => l.aktiv).map(l => <option key={l.id} value={l.id}>{l.name} ({l.nr})</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Beleg-Nr. Lieferant</label>
              <input style={inp} value={head.lieferant_beleg_nr} onChange={e => setHead(p => ({ ...p, lieferant_beleg_nr: e.target.value }))} placeholder="Rechnungsnummer des Lieferanten" />
            </div>
            <div>
              <label style={lbl}>Belegdatum *</label>
              <input type="date" style={inp} value={head.belegdatum} onChange={e => handleBelegdatumChange(e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Fälligkeit *</label>
              <input type="date" style={{ ...inp, borderColor: head.faelligkeit ? '#7a9b7f' : '#d4dcd4' }} value={head.faelligkeit} onChange={e => setHead(p => ({ ...p, faelligkeit: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Zahlungsbedingung (Tage)</label>
              <input type="number" style={inp} value={head.zahlungsbedingung_tage} onChange={e => setHead(p => ({ ...p, zahlungsbedingung_tage: parseInt(e.target.value) || 30 }))} />
            </div>
            <div>
              <label style={lbl}>Währung</label>
              <select style={inp} value={head.waehrung} onChange={e => setHead(p => ({ ...p, waehrung: e.target.value }))}>
                <option>CHF</option><option>EUR</option><option>USD</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Zahlungsreferenz / QR-Ref.</label>
              <input style={inp} value={head.zahlungsreferenz} onChange={e => setHead(p => ({ ...p, zahlungsreferenz: e.target.value }))} placeholder="Optionale Referenznummer" />
            </div>
            <div>
              <label style={lbl}>Interne Notiz</label>
              <input style={inp} value={head.notiz} onChange={e => setHead(p => ({ ...p, notiz: e.target.value }))} />
            </div>
          </div>
        </div>

        {/* Positionen */}
        <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #e4e9e4' }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#94a394' }}>Buchungspositionen</span>
            <button onClick={() => setPositionen(p => [...p, emptyPos()])} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 7, border: 'none', background: 'transparent', color: '#7a9b7f', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>+ Position hinzufügen</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...hdrTd, width: 28 }}>#</th>
                <th style={{ ...hdrTd, width: 170 }}>Aufwandskonto *</th>
                <th style={hdrTd}>Bezeichnung</th>
                <th style={{ ...hdrTd, width: 100 }}>MWST-Code</th>
                <th style={{ ...hdrTd, width: 110, textAlign: 'right' }}>Netto CHF *</th>
                <th style={{ ...hdrTd, width: 100, textAlign: 'right' }}>MWST CHF</th>
                <th style={{ ...hdrTd, width: 110, textAlign: 'right' }}>Brutto CHF</th>
                <th style={{ ...hdrTd, width: 28 }}></th>
              </tr></thead>
              <tbody>
                {positionen.map((p, i) => (
                  <tr key={p._key}>
                    <td style={{ ...cellTd, color: '#94a394', fontSize: 11, textAlign: 'center' }}>{i + 1}</td>
                    <td style={cellTd}>
                      <select style={{ ...inp, padding: '4px 8px', fontSize: 12 }} value={p.konto_nr} onChange={e => updatePos(i, 'konto_nr', e.target.value)}>
                        <option value="">— Konto —</option>
                        {konten.map(k => <option key={k.id} value={k.konto_nr}>{k.konto_nr} {k.bezeichnung}</option>)}
                      </select>
                    </td>
                    <td style={cellTd}><input style={{ ...inp, padding: '4px 8px', fontSize: 12 }} value={p.bezeichnung} onChange={e => updatePos(i, 'bezeichnung', e.target.value)} /></td>
                    <td style={cellTd}>
                      <select style={{ ...inp, padding: '4px 8px', fontSize: 12 }} value={p.mwst_code} onChange={e => updatePos(i, 'mwst_code', e.target.value)}>
                        {Object.keys(MWST).map(c => <option key={c} value={c}>{c} {c !== '0' ? `(${MWST[c]}%)` : '(keine)'}</option>)}
                      </select>
                    </td>
                    <td style={cellTd}><input type="number" step="0.05" style={{ ...inp, padding: '4px 8px', fontSize: 12, textAlign: 'right' }} value={p.betrag_netto} onChange={e => updatePos(i, 'betrag_netto', e.target.value)} /></td>
                    <td style={{ ...cellTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#2e4a7d', fontSize: 12 }}>{CHF(p.betrag_mwst)}</td>
                    <td style={{ ...cellTd, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{CHF(p.betrag_brutto)}</td>
                    <td style={cellTd}><button onClick={() => setPositionen(prev => prev.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', color: '#c00', cursor: 'pointer', fontSize: 14, padding: '2px 6px' }}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, padding: '12px 16px', borderTop: '1px solid #e4e9e4', background: '#fafcfa' }}>
            {[['Netto', totals.netto], ['MWST', totals.mwst], ['Brutto', totals.brutto]].map(([k, v]) => (
              <div key={k} style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#94a394' }}>{k}</div>
                <div style={{ fontWeight: k === 'Brutto' ? 700 : 500, fontSize: k === 'Brutto' ? 14 : 12.5, color: k === 'MWST' ? '#2e4a7d' : '#1a1a2e', marginTop: 2 }}>CHF {CHF(v)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* OCR Banner */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 10, background: '#e3eaf5', border: '1px solid #c5d4ea' }}>
          <span style={{ fontSize: 18 }}>🔍</span>
          <div style={{ flex: 1, fontSize: 12, color: '#2e4a7d' }}>
            <strong>Lokales OCR (tesseract.js)</strong> — PDF hochladen, Felder werden automatisch vorausgefüllt. Läuft vollständig lokal, kein Cloud-API.
          </div>
          <input ref={fileRef} type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={e => { setPdfFile(e.target.files[0]); }} />
          {pdfFile && (
            <button onClick={handleOcr} disabled={ocrLoading} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: '#2e4a7d', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: ocrLoading ? .6 : 1 }}>
              {ocrLoading ? 'Scannt…' : 'OCR starten'}
            </button>
          )}
          <button onClick={() => fileRef.current?.click()} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: '#2e4a7d', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>PDF laden</button>
          {pdfFile && <span style={{ fontSize: 11, color: '#2e4a7d' }}>{pdfFile.name}</span>}
        </div>
      </div>

      {/* PDF Preview */}
      <div style={{ flexShrink: 0, width: 360, display: 'flex', flexDirection: 'column', background: '#f8f8f8' }}>
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', background: '#fff', borderBottom: '1px solid #e4e9e4' }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#4a5a4a' }}>Belegvorschau</span>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          {pdfFile && pdfFile.type.startsWith('image/') ? (
            <img src={URL.createObjectURL(pdfFile)} alt="Beleg" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,.12)' }} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: '#bbb' }}>
              <svg style={{ width: 48, height: 48, stroke: '#d4dcd4' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span style={{ fontSize: 12 }}>{pdfFile ? 'PDF wird angezeigt nach Upload' : 'PDF laden für Vorschau'}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
