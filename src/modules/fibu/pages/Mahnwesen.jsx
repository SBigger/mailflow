/**
 * Debitoren · Mahnwesen — überfällige Ausgangsrechnungen mahnen.
 * Liste aller offenen/überfälligen Rechnungen, je Rechnung:
 *   Mahnstufe (1–3) wählen, Mahngebühr + neue Frist, Mahnung-PDF erzeugen,
 *   protokollieren (fibu_debitoren_mahnungen) und optional per E-Mail senden.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMandant } from '../contexts/MandantContext';
import { mahnungApi, debitorenApi, mandantenApi, zahlstellenApi, belegMailApi } from '../api';
import { generateMahnungPdf } from '../utils/mahnungPdf';

const CHF = (n) => (parseFloat(n) || 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE = (s) => s ? new Date(s).toLocaleDateString('de-CH') : '—';
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const GEBUEHR_DEFAULT = { 1: 0, 2: 20, 3: 40 };

const inp = { width: '100%', padding: '7px 9px', border: '1px solid #d4dcd4', borderRadius: 7, fontSize: 12.5, background: '#f7faf7', boxSizing: 'border-box', fontFamily: 'inherit' };
const lbl = { display: 'block', fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 4 };

function tageÜberfällig(faelligkeit) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const f = new Date(faelligkeit); f.setHours(0, 0, 0, 0);
  return Math.round((t - f) / 86400000);
}

export default function Mahnwesen() {
  const { mandant } = useMandant();
  const navigate = useNavigate();
  const [posten, setPosten] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mSettings, setMSettings] = useState(null);
  const [zahlstellen, setZahlstellen] = useState([]);
  const [nurUeberfaellig, setNurUeberfaellig] = useState(true);

  const [dlg, setDlg] = useState(null);  // { beleg, stufe, gebuehr, frist, sendMail }
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!mandant?.id) return;
    setLoading(true);
    mahnungApi.offenePosten(mandant.id).then(setPosten).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(() => {
    if (!mandant?.id) return;
    load();
    mandantenApi.get(mandant.id).then(setMSettings).catch(console.error);
    zahlstellenApi.list(mandant.id).then(setZahlstellen).catch(console.error);
  }, [mandant?.id]);

  const liste = useMemo(() => {
    const l = posten.map(b => ({ ...b, tage: tageÜberfällig(b.faelligkeit), offen: (b.betrag_brutto || 0) - (b.betrag_bezahlt || 0) }));
    return (nurUeberfaellig ? l.filter(b => b.tage > 0) : l).sort((a, b) => b.tage - a.tage);
  }, [posten, nurUeberfaellig]);

  const totalOffen = liste.reduce((s, b) => s + b.offen, 0);

  const openDlg = (beleg) => {
    const stufe = Math.min((beleg.mahnstufe || 0) + 1, 3);
    setDlg({ beleg, stufe, gebuehr: GEBUEHR_DEFAULT[stufe], frist: addDays(stufe === 3 ? 5 : 10), sendMail: !!beleg.kunde?.email });
  };
  const setDlgField = (patch) => setDlg(d => {
    const next = { ...d, ...patch };
    if (patch.stufe != null) next.gebuehr = GEBUEHR_DEFAULT[patch.stufe] ?? d.gebuehr;
    return next;
  });

  const zsFor = () => zahlstellen.find(z => z.id === mSettings?.rechnung_zahlstelle_id) || zahlstellen[0] || {};

  const doMahnung = async (alsoSend) => {
    if (!dlg) return;
    setBusy(true);
    try {
      const full = await debitorenApi.get(dlg.beleg.id);
      const { url, blob } = await generateMahnungPdf({
        beleg: full, kunde: full.kunde || {}, mandant: mSettings || mandant, zahlstelle: zsFor(),
        stufe: dlg.stufe, gebuehr: parseFloat(dlg.gebuehr) || 0, faelligAm: dlg.frist,
      });
      let gesendetAn = null;
      if (alsoSend) {
        const to = full.kunde?.email;
        if (!to) throw new Error('Keine E-Mail-Adresse beim Kunden hinterlegt.');
        if (!url) throw new Error('PDF-URL nicht verfügbar (Storage-Upload fehlgeschlagen).');
        const html = `<p>Sehr geehrte Damen und Herren${full.kunde?.name ? ` (${full.kunde.name})` : ''}</p>
          <p>im Anhang erhalten Sie eine ${dlg.stufe === 1 ? 'Zahlungserinnerung' : dlg.stufe + '. Mahnung'} zu Rechnung
          <strong>${full.beleg_nr}</strong>. Offener Betrag inkl. Gebühr: <strong>CHF ${CHF((full.betrag_brutto - (full.betrag_bezahlt || 0)) + (parseFloat(dlg.gebuehr) || 0))}</strong>,
          zahlbar bis ${DATE(dlg.frist)}.</p>
          <p>Freundliche Grüsse<br>${mSettings?.name || mandant?.name || ''}</p>`;
        await belegMailApi.send({ to, subject: `${dlg.stufe === 1 ? 'Zahlungserinnerung' : dlg.stufe + '. Mahnung'} – Rechnung ${full.beleg_nr}`, html, attachmentUrl: url, attachmentFilename: `Mahnung-${full.beleg_nr}.pdf` });
        gesendetAn = to;
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `Mahnung-${full.beleg_nr}-S${dlg.stufe}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
      await mahnungApi.erstellen(mandant.id, full, { stufe: dlg.stufe, gebuehr: parseFloat(dlg.gebuehr) || 0, faelligAm: dlg.frist, pdfUrl: url, gesendetAn });
      setDlg(null);
      load();
      if (alsoSend) alert('Mahnung gesendet an ' + gesendetAn);
    } catch (e) { alert('Fehler: ' + e.message); }
    finally { setBusy(false); }
  };

  const hdr = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6b826b', padding: '9px 12px', borderBottom: '2px solid #e4e9e4', textAlign: 'left', whiteSpace: 'nowrap', background: '#fff' };
  const td = { padding: '9px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5, verticalAlign: 'middle' };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Mahnwesen</div>
          <div style={{ fontSize: 11.5, color: '#7a9a7f' }}>Debitoren · überfällige Ausgangsrechnungen</div>
        </div>
        <label style={{ marginLeft: 'auto', fontSize: 12, color: '#4a5a4a', display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={nurUeberfaellig} onChange={e => setNurUeberfaellig(e.target.checked)} /> nur überfällige
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        <Kpi label="Offene Posten" value={liste.length} sub="Rechnungen" />
        <Kpi label="Total offen" value={`CHF ${CHF(totalOffen)}`} color="#8a2d2d" />
        <Kpi label="Bereits gemahnt" value={liste.filter(b => b.mahnstufe > 0).length} sub={`von ${liste.length}`} />
      </div>

      <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 12, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>Lädt…</div>
        ) : liste.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>Keine {nurUeberfaellig ? 'überfälligen' : 'offenen'} Rechnungen 🎉</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={hdr}>Beleg-Nr.</th><th style={hdr}>Kunde</th><th style={hdr}>Fällig</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Tage</th><th style={{ ...hdr, textAlign: 'right' }}>Offen CHF</th>
              <th style={hdr}>Mahnstufe</th><th style={hdr}></th>
            </tr></thead>
            <tbody>
              {liste.map(b => (
                <tr key={b.id} style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/fibu/${mandant.id}/debitoren/erfassen/${b.id}`)}
                    onMouseEnter={e => e.currentTarget.querySelectorAll('td').forEach(t => t.style.background = '#f7faf7')}
                    onMouseLeave={e => e.currentTarget.querySelectorAll('td').forEach(t => t.style.background = '')}>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{b.beleg_nr}</td>
                  <td style={{ ...td, fontWeight: 500 }}>{b.kunde?.name || '—'}{!b.kunde?.email && <span title="keine E-Mail" style={{ color: '#c4893a', marginLeft: 6 }}>✉?</span>}</td>
                  <td style={td}>{DATE(b.faelligkeit)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: b.tage > 0 ? '#8a2d2d' : '#4a5a4a' }}>{b.tage > 0 ? `+${b.tage}` : b.tage}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{CHF(b.offen)}</td>
                  <td style={td}>{b.mahnstufe > 0
                    ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: '#fef0c7', color: '#8a5a00' }}>Stufe {b.mahnstufe}{b.letzte_mahnung_am ? ` · ${DATE(b.letzte_mahnung_am)}` : ''}</span>
                    : <span style={{ fontSize: 11, color: '#94a394' }}>—</span>}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button onClick={(e) => { e.stopPropagation(); openDlg(b); }} style={{ fontSize: 11.5, padding: '4px 12px', borderRadius: 7, border: '1px solid #c4893a', background: '#fff', color: '#9a6a00', fontWeight: 600, cursor: 'pointer' }}>
                      {(b.mahnstufe || 0) >= 3 ? 'Erneut mahnen' : `${Math.min((b.mahnstufe || 0) + 1, 3)}. mahnen`}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Mahn-Dialog */}
      {dlg && (
        <div onClick={() => !busy && setDlg(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,30,20,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 22, width: 460, maxWidth: '92vw', boxShadow: '0 12px 40px rgba(0,0,0,.18)' }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Mahnen · {dlg.beleg.beleg_nr}</div>
            <div style={{ fontSize: 12, color: '#7a9a7f', marginBottom: 16 }}>{dlg.beleg.kunde?.name} · offen CHF {CHF(dlg.beleg.offen ?? ((dlg.beleg.betrag_brutto || 0) - (dlg.beleg.betrag_bezahlt || 0)))}</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div><label style={lbl}>Mahnstufe</label>
                <select style={inp} value={dlg.stufe} onChange={e => setDlgField({ stufe: parseInt(e.target.value) })}>
                  <option value={1}>1 · Zahlungserinnerung</option>
                  <option value={2}>2 · Mahnung</option>
                  <option value={3}>3 · letzte Mahnung</option>
                </select>
              </div>
              <div><label style={lbl}>Mahngebühr (CHF)</label>
                <input type="number" step="0.05" style={inp} value={dlg.gebuehr} onChange={e => setDlgField({ gebuehr: e.target.value })} /></div>
              <div style={{ gridColumn: '1 / 3' }}><label style={lbl}>Neue Zahlungsfrist (zahlbar bis)</label>
                <input type="date" style={inp} value={dlg.frist} onChange={e => setDlgField({ frist: e.target.value })} /></div>
            </div>
            <div style={{ fontSize: 11, color: '#94a394', marginBottom: 16 }}>
              Die Mahngebühr wird im PDF/QR-Betrag ausgewiesen, aber <strong>nicht</strong> automatisch ins Hauptbuch gebucht.
              {!dlg.beleg.kunde?.email && <div style={{ color: '#c4893a', marginTop: 4 }}>Kein E-Mail beim Kunden – Versand nicht möglich, nur Download.</div>}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setDlg(null)} disabled={busy} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #bfcfbf', background: '#fff', color: '#4a5a4a', fontWeight: 600, cursor: 'pointer' }}>Abbrechen</button>
              <button onClick={() => doMahnung(false)} disabled={busy} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #3d6641', background: '#fff', color: '#3d6641', fontWeight: 600, cursor: 'pointer' }}>{busy ? '…' : '↓ PDF'}</button>
              <button onClick={() => doMahnung(true)} disabled={busy || !dlg.beleg.kunde?.email} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: dlg.beleg.kunde?.email ? '#3d6641' : '#a0b8a0', color: '#fff', fontWeight: 600, cursor: dlg.beleg.kunde?.email ? 'pointer' : 'default' }}>{busy ? 'Sendet…' : '✉ Erstellen & senden'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, color }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, padding: '16px 18px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#94a394' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.03em', lineHeight: 1, margin: '6px 0 3px', color: color ?? '#1a1a2e' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: '#6b826b' }}>{sub}</div>}
    </div>
  );
}
