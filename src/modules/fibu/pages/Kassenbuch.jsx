import React, { useEffect, useState, useMemo } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { supabase } from '@/api/supabaseClient';
import { kontenApi, manuelleBuchungApi, kassenbuchApi, mwstCodesApi } from '../api';

const CHF  = (n) => n == null ? '—' : new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const DATE = (s) => s ? new Date(s).toLocaleDateString('de-CH') : '—';
const today = () => new Date().toISOString().slice(0, 10);

const fileToBase64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).replace(/^data:[^,]+,/, ''));
  r.onerror = rej;
  r.readAsDataURL(file);
});

const emptyForm = () => ({ datum: today(), typ: 'ausgabe', betrag: '', beschreibung: '', gegenkonto: '', mwst_code: '', file: null });

export default function Kassenbuch() {
  const { mandant, canWrite } = useMandant();
  const jahr = new Date().getFullYear();

  const [konten, setKonten]   = useState([]);
  const [kasse, setKasse]     = useState('1000');
  const [von, setVon]         = useState(`${jahr}-01-01`);
  const [bis, setBis]         = useState(`${jahr}-12-31`);
  const [rows, setRows]       = useState([]);
  const [eroeff, setEroeff]   = useState(0);
  const [loading, setLoading] = useState(false);

  const [form, setForm]       = useState(null);    // null = Modal zu
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrMsg, setOcrMsg]   = useState(null);
  const [saving, setSaving]   = useState(false);
  const [mwstCodes, setMwstCodes] = useState([]);

  useEffect(() => {
    if (!mandant) return;
    kontenApi.list(mandant.id).then(k => {
      const akt = k.filter(x => x.aktiv);
      setKonten(akt);
      const kasseKonto = akt.find(x => x.konto_nr === '1000')
        ?? akt.find(x => /kasse/i.test(x.bezeichnung || ''));
      if (kasseKonto) setKasse(kasseKonto.konto_nr);
    }).catch(() => {});
    mwstCodesApi.listAktiv(mandant.id).then(setMwstCodes).catch(() => {});
  }, [mandant?.id]);

  const load = async () => {
    if (!mandant || !kasse) return;
    setLoading(true);
    try {
      const [b, e] = await Promise.all([
        supabase.rpc('fibu_kontoblatt', { p_mandant_id: mandant.id, p_konto_nr: kasse, p_von: von, p_bis: bis }),
        supabase.rpc('fibu_kontoblatt_eroeffnung', { p_mandant_id: mandant.id, p_konto_nr: kasse, p_stichtag: von }),
      ]);
      setRows(b.data ?? []);
      setEroeff(e.data ?? 0);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [mandant?.id, kasse, von, bis]);

  const einnahmen = rows.reduce((s, r) => s + (r.soll ?? 0), 0);
  const ausgaben  = rows.reduce((s, r) => s + (r.haben ?? 0), 0);
  const schluss   = rows.length ? rows[rows.length - 1].saldo_lfd : eroeff;

  const gegenkonten = useMemo(() => konten.filter(k => k.konto_nr !== kasse), [konten, kasse]);

  // ── Beleg-Foto auslesen ─────────────────────────────────────────
  const handlePhoto = async (file) => {
    if (!file) return;
    setForm(f => ({ ...(f || emptyForm()), file }));
    setOcrBusy(true); setOcrMsg(null);
    try {
      const b64 = await fileToBase64(file);
      const res = await kassenbuchApi.ocr(b64, file.type || 'image/jpeg');
      if (res?.ok) {
        setForm(f => ({
          ...f,
          datum:        res.datum || f.datum,
          betrag:       res.betrag ? String(res.betrag) : f.betrag,
          beschreibung: res.beschreibung || f.beschreibung,
          typ:          res.typ || f.typ,
        }));
        setOcrMsg({ type: 'ok', text: `Beleg erkannt (${res.modell}). Bitte prüfen.` });
      } else {
        setOcrMsg({ type: 'err', text: res?.fehler || 'Beleg konnte nicht gelesen werden.' });
      }
    } catch (e) {
      setOcrMsg({ type: 'err', text: 'OCR-Fehler: ' + e.message });
    } finally { setOcrBusy(false); }
  };

  const canSave = form && form.datum && parseFloat(form.betrag) > 0 && form.gegenkonto && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      let pdfPath = null, pdfName = null;
      if (form.file) {
        const up = await manuelleBuchungApi.uploadPdf(mandant.id, form.file);
        pdfPath = up.path; pdfName = up.name;
      }
      const betrag = parseFloat(form.betrag);
      const mwst_code = form.mwst_code || null;
      const zeile = form.typ === 'einnahme'
        ? { konto_soll: kasse, konto_haben: form.gegenkonto, betrag, mwst_code, text: form.beschreibung }
        : { konto_soll: form.gegenkonto, konto_haben: kasse, betrag, mwst_code, text: form.beschreibung };
      await manuelleBuchungApi.erstellen({
        mandantId: mandant.id, datum: form.datum,
        text: form.beschreibung || 'Kassenbuchung',
        pdfPath, pdfName, zeilen: [zeile],
      });
      setForm(null); setOcrMsg(null);
      await load();
    } catch (e) {
      alert('Fehler: ' + e.message);
    } finally { setSaving(false); }
  };

  const hdr = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b', padding: '8px 12px', borderBottom: '2px solid #e4e9e4', textAlign: 'left', background: '#fafcfa', whiteSpace: 'nowrap' };
  const td  = { padding: '7px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5 };
  const tdR = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
  const inp = { background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, outline: 'none', width: '100%', boxSizing: 'border-box' };
  const lbl = { fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 4, display: 'block' };
  const kontoLabel = (nr) => { const k = konten.find(x => x.konto_nr === nr); return k ? `${k.konto_nr} ${k.bezeichnung}` : nr; };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#fff', borderBottom: '1px solid #e4e9e4', flexWrap: 'wrap' }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: '#7a9b7f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15 }}>💵</div>
        <span style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e' }}>Kassenbuch</span>
        <select value={kasse} onChange={e => setKasse(e.target.value)} style={{ ...inp, width: 'auto' }}>
          {konten.map(k => <option key={k.konto_nr} value={k.konto_nr}>{k.konto_nr} {k.bezeichnung}</option>)}
        </select>
        <input type="date" value={von} onChange={e => setVon(e.target.value)} style={{ ...inp, width: 'auto' }} />
        <span style={{ color: '#94a394' }}>–</span>
        <input type="date" value={bis} onChange={e => setBis(e.target.value)} style={{ ...inp, width: 'auto' }} />
        <div style={{ flex: 1 }} />
        {canWrite && (
          <button onClick={() => { setForm(emptyForm()); setOcrMsg(null); }}
            style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            + Kassenbuchung
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ flexShrink: 0, display: 'flex', background: '#fff', borderBottom: '1px solid #e4e9e4' }}>
        {[
          { label: 'Anfangsbestand', value: eroeff },
          { label: 'Einnahmen',      value: einnahmen, color: '#166534' },
          { label: 'Ausgaben',       value: ausgaben,  color: '#991b1b' },
          { label: 'Bestand',        value: schluss, bold: true },
        ].map((k, i) => (
          <div key={i} style={{ padding: '8px 16px', flex: 1, borderRight: i < 3 ? '1px solid #f0f3f0' : 'none' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#94a394' }}>{k.label}</div>
            <div style={{ fontSize: 14, fontWeight: k.bold ? 800 : 600, fontVariantNumeric: 'tabular-nums', color: k.color ?? (k.value < 0 ? '#991b1b' : '#1a1a2e') }}>CHF {CHF(k.value)}</div>
          </div>
        ))}
      </div>

      {/* Tabelle */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#f7faf7' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94a394', fontSize: 13 }}>Lädt…</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <thead><tr>
              <th style={hdr}>Datum</th>
              <th style={hdr}>Beleg</th>
              <th style={hdr}>Text</th>
              <th style={hdr}>Gegenkonto</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Einnahme</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Ausgabe</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Bestand</th>
            </tr></thead>
            <tbody>
              <tr style={{ background: '#e8f0e8' }}>
                <td style={{ ...td, fontStyle: 'italic', color: '#6b826b' }} colSpan={6}>Anfangsbestand</td>
                <td style={{ ...tdR, fontWeight: 700 }}>{CHF(eroeff)}</td>
              </tr>
              {rows.map((r, i) => (
                <tr key={r.buchungs_nr ?? i}>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: '#6b826b' }}>{DATE(r.buchungsdatum)}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11.5 }}>{r.beleg_ref || '—'}</td>
                  <td style={td}>{r.buch_text || '—'}</td>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{r.gegenkonto}</td>
                  <td style={{ ...tdR, color: r.soll > 0 ? '#166534' : '#d1d5db' }}>{r.soll > 0 ? CHF(r.soll) : ''}</td>
                  <td style={{ ...tdR, color: r.haben > 0 ? '#991b1b' : '#d1d5db' }}>{r.haben > 0 ? CHF(r.haben) : ''}</td>
                  <td style={{ ...tdR, fontWeight: 600, color: r.saldo_lfd < 0 ? '#991b1b' : '#1a1a2e' }}>{CHF(r.saldo_lfd)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>Keine Kassenbuchungen in diesem Zeitraum</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Erfassungs-Modal */}
      {form && (
        <div onClick={() => !saving && setForm(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(26,26,46,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 500, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,.25)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #e4e9e4', fontWeight: 700, fontSize: 14 }}>Kassenbuchung erfassen</div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Beleg-Foto / OCR */}
              <div style={{ background: '#f0f7ff', border: '1px solid #c5d4ea', borderRadius: 9, padding: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#2e4a7d', marginBottom: 6 }}>📷 Beleg fotografieren / hochladen</div>
                <div style={{ fontSize: 11, color: '#4a6a9e', marginBottom: 8 }}>Quittung oder handschriftlicher Beleg – die KI liest Datum, Betrag und Text aus.</div>
                <input type="file" accept="image/*,application/pdf" capture="environment"
                  onChange={e => handlePhoto(e.target.files?.[0])} style={{ fontSize: 12 }} />
                {ocrBusy && <div style={{ fontSize: 11.5, color: '#2e4a7d', marginTop: 6 }}>⏳ Beleg wird gelesen…</div>}
                {ocrMsg && <div style={{ fontSize: 11.5, marginTop: 6, color: ocrMsg.type === 'ok' ? '#166534' : '#8a2d2d' }}>{ocrMsg.text}</div>}
                {form.file && !ocrBusy && <div style={{ fontSize: 11, color: '#6b826b', marginTop: 4 }}>📎 {form.file.name}</div>}
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ width: 150 }}>
                  <label style={lbl}>Datum *</label>
                  <input type="date" style={inp} value={form.datum} onChange={e => setForm(f => ({ ...f, datum: e.target.value }))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Art *</label>
                  <div style={{ display: 'flex', gap: 4, background: '#eef2ee', borderRadius: 8, padding: 3 }}>
                    {[['ausgabe', 'Ausgabe'], ['einnahme', 'Einnahme']].map(([v, l]) => (
                      <button key={v} onClick={() => setForm(f => ({ ...f, typ: v, mwst_code: '' }))}
                        style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                          background: form.typ === v ? '#fff' : 'transparent',
                          color: form.typ === v ? (v === 'einnahme' ? '#166534' : '#991b1b') : '#6b826b',
                          boxShadow: form.typ === v ? '0 1px 3px rgba(0,0,0,.1)' : 'none' }}>{l}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <label style={lbl}>Beschreibung</label>
                <input style={inp} value={form.beschreibung} onChange={e => setForm(f => ({ ...f, beschreibung: e.target.value }))} placeholder="z.B. Büromaterial, Porto …" />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ width: 150 }}>
                  <label style={lbl}>Betrag *</label>
                  <input type="number" step="0.05" style={{ ...inp, textAlign: 'right' }} value={form.betrag} onChange={e => setForm(f => ({ ...f, betrag: e.target.value }))} placeholder="0.00" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Gegenkonto *</label>
                  <select style={inp} value={form.gegenkonto} onChange={e => setForm(f => ({ ...f, gegenkonto: e.target.value }))}>
                    <option value="">— wählen —</option>
                    {gegenkonten.map(k => <option key={k.konto_nr} value={k.konto_nr}>{k.konto_nr} {k.bezeichnung}</option>)}
                  </select>
                </div>
                <div style={{ width: 120 }}>
                  <label style={lbl}>MWST-Code</label>
                  <select style={inp} value={form.mwst_code} onChange={e => setForm(f => ({ ...f, mwst_code: e.target.value }))}>
                    <option value="">— kein —</option>
                    {mwstCodes
                      .filter(m => form.typ === 'einnahme' ? m.typ === 'umsatzsteuer' : m.typ === 'vorsteuer')
                      .map(m => <option key={m.code} value={m.code}>{m.code} ({m.satz}%)</option>)}
                  </select>
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#6b826b', background: '#f7faf7', borderRadius: 7, padding: '7px 10px' }}>
                Buchung: {form.typ === 'einnahme'
                  ? <>Soll <strong>{kontoLabel(kasse)}</strong> / Haben <strong>{form.gegenkonto ? kontoLabel(form.gegenkonto) : '…'}</strong></>
                  : <>Soll <strong>{form.gegenkonto ? kontoLabel(form.gegenkonto) : '…'}</strong> / Haben <strong>{kontoLabel(kasse)}</strong></>}
              </div>
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid #e4e9e4', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setForm(null)} disabled={saving} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>Abbrechen</button>
              <button onClick={handleSave} disabled={!canSave}
                style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: canSave ? '#7a9b7f' : '#c5cdc5', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: canSave ? 'pointer' : 'not-allowed' }}>
                {saving ? 'Bucht…' : 'Buchen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
