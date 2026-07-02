/**
 * Rechnung / Gutschrift (Debitoren) — kombinierte Ansicht:
 *   • Neu erfassen      (kein :belegId)
 *   • Entwurf bearbeiten (:belegId, status 'entwurf')
 *   • Detail + Lebenszyklus (:belegId, gestellt/verbucht):
 *       Zahlungseingang erfassen · Stornieren · PDF · per E-Mail senden
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMandant } from '../contexts/MandantContext';
import { kundenApi, artikelApi, kontenApi, mwstCodesApi, debitorenApi, mandantenApi, zahlstellenApi, belegMailApi } from '../api';
import { generateDebitorenPdf } from '../utils/debitorenInvoicePdf';

const card = { background: '#fff', border: '1px solid #d4dcd4', borderRadius: 12 };
const inp  = { width: '100%', padding: '7px 9px', border: '1px solid #d4dcd4', borderRadius: 7, fontSize: 12.5, background: '#f7faf7', boxSizing: 'border-box', fontFamily: 'inherit' };
const cell = { ...inp, padding: '5px 6px', background: 'transparent', border: '1px solid transparent' };
const lbl  = { display: 'block', fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 4 };
const CHF  = n => (parseFloat(n) || 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2   = n => Math.round((parseFloat(n) || 0) * 100) / 100;
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

const newRow = () => ({ _id: Math.random().toString(36).slice(2), artikel_id: '', bezeichnung: '', menge: 1, einheit: '', einzelpreis: 0, konto_nr: '', mwst_code: 'U81' });

export default function DebitorenRechnung() {
  const { mandant } = useMandant();
  const navigate = useNavigate();
  const { belegId } = useParams();
  const [kunden, setKunden] = useState([]);
  const [artikel, setArtikel] = useState([]);
  const [konten, setKonten] = useState([]);
  const [mwstMap, setMwstMap] = useState({});
  const [umsatzCodes, setUmsatzCodes] = useState([]);
  const [saving, setSaving] = useState(false);

  // Kopf
  const [belegtyp, setBelegtyp] = useState('rechnung');
  const [kundeId, setKundeId] = useState('');
  const [titel, setTitel] = useState('');
  const [belegdatum, setBelegdatum] = useState(todayISO());
  const [zahlungsfrist, setZahlungsfrist] = useState(30);
  const [rows, setRows] = useState([newRow()]);

  // Geladener Beleg (Edit/View)
  const [loaded, setLoaded] = useState(null);   // ganzes Beleg-Objekt bei :belegId
  const [loading, setLoading] = useState(!!belegId);
  const [mSettings, setMSettings] = useState(null);
  const [zahlstellen, setZahlstellen] = useState([]);

  // Lebenszyklus-Aktionen
  const [zahlOpen, setZahlOpen]   = useState(false);
  const [zahlBetrag, setZahlBetrag] = useState('');
  const [zahlDatum, setZahlDatum]   = useState(todayISO());
  const [stornoOpen, setStornoOpen] = useState(false);
  const [stornoDatum, setStornoDatum] = useState(todayISO());
  const [busy, setBusy] = useState(null);   // 'pdf'|'mail'|'zahl'|'storno'

  // Stammdaten laden
  useEffect(() => {
    if (!mandant?.id) return;
    kundenApi.list(mandant.id).then(setKunden).catch(console.error);
    artikelApi.list(mandant.id).then(setArtikel).catch(console.error);
    kontenApi.list(mandant.id).then(setKonten).catch(console.error);
    mandantenApi.get(mandant.id).then(setMSettings).catch(console.error);
    zahlstellenApi.list(mandant.id).then(setZahlstellen).catch(console.error);
    mwstCodesApi.listAktiv(mandant.id).then(codes => {
      const m = {}; codes.forEach(c => { m[c.code] = c.satz; });
      setMwstMap(m);
      // Nur Verkaufs-Codes: Umsatzsteuer + steuerbefreite Umsätze (U0). M0 ist Vorsteuer-seitig.
      setUmsatzCodes(codes.filter(c => c.typ === 'umsatzsteuer' || c.code === 'U0'));
    }).catch(console.error);
  }, [mandant?.id]);

  // Beleg laden (Edit/View)
  useEffect(() => {
    if (!belegId) { setLoaded(null); setLoading(false); return; }
    setLoading(true);
    debitorenApi.get(belegId).then(b => {
      setLoaded(b);
      setBelegtyp(b.belegtyp || 'rechnung');
      setKundeId(b.kunde_id || '');
      setTitel(b.titel || '');
      setBelegdatum(b.belegdatum || todayISO());
      setZahlungsfrist(b.zahlungsbedingung_tage ?? 30);
      const pos = (b.positionen || []).sort((a, c) => (a.position || 0) - (c.position || 0));
      setRows(pos.length ? pos.map(p => ({
        _id: p.id || Math.random().toString(36).slice(2),
        artikel_id: p.artikel_id || '', bezeichnung: p.bezeichnung || '',
        menge: p.menge, einheit: p.einheit || '', einzelpreis: p.einzelpreis,
        konto_nr: p.konto_nr || '', mwst_code: p.mwst_code || 'U81',
      })) : [newRow()]);
    }).catch(e => alert('Beleg konnte nicht geladen werden: ' + e.message))
      .finally(() => setLoading(false));
  }, [belegId]);

  const mode = !belegId ? 'new' : (loaded?.status === 'entwurf' ? 'edit' : 'view');
  const readOnly = mode === 'view';
  const isGutschrift = belegtyp === 'gutschrift';

    const faelligkeit = useMemo(() => addDays(belegdatum, parseInt(zahlungsfrist) || 0), [belegdatum, zahlungsfrist]);
    const ertragKonten = konten.filter(k => k.konto_typ === 'ertrag');

    // NEU: Berücksichtigung von mSettings.rechnung_steuerart (1=inkl, 2=exkl, 3=ohne)
    const calc = (row) => {
        const steuerart = mSettings?.rechnung_steuerart ?? 2; // Fallback auf 2 (exkl.) falls nicht geladen
        const menge = parseFloat(row.menge) || 0;
        const einzelpreis = parseFloat(row.einzelpreis) || 0;
        const basisBetrag = r2(menge * einzelpreis);

        // Wenn Steuerart "ohne" (3), ist der MWST-Satz effektiv 0
        const satz = steuerart === 3 ? 0 : (mwstMap[row.mwst_code] ?? 0);

        let netto = 0;
        let mwst = 0;
        let brutto = 0;

        if (steuerart === 1) {
            // Inklusive: Einzelpreis enthält bereits die MWST
            brutto = basisBetrag;
            netto = r2(brutto / (1 + satz / 100));
            mwst = r2(brutto - netto);
        } else if (steuerart === 3) {
            // Ohne MWST
            netto = basisBetrag;
            mwst = 0;
            brutto = basisBetrag;
        } else {
            // Exklusive (Standard, Steuerart 2): MWST kommt oben drauf
            netto = basisBetrag;
            mwst = r2(netto * satz / 100);
            brutto = r2(netto + mwst);
        }

        return { netto, mwst, brutto, satz };
    };

    // Anpassung der Gesamt-Summierung, damit Rundungsdifferenzen vermieden werden
    const totals = rows.reduce((t, r) => {
        const c = calc(r);
        t.netto += c.netto;
        t.mwst += c.mwst;
        t.brutto += c.brutto; // Brutto wird nun direkt aus den Zeilen summiert
        return t;
    }, { netto: 0, mwst: 0, brutto: 0 });

    totals.netto = r2(totals.netto);
    totals.mwst = r2(totals.mwst);
    totals.brutto = r2(totals.brutto);

  const setRow = (id, patch) => setRows(rs => rs.map(r => r._id === id ? { ...r, ...patch } : r));
  const pickArtikel = (id, artikelId) => {
    const a = artikel.find(x => x.id === artikelId);
    if (!a) { setRow(id, { artikel_id: '' }); return; }
    setRow(id, { artikel_id: a.id, bezeichnung: a.name, einheit: a.einheit, einzelpreis: a.verkaufspreis, konto_nr: a.ertragskonto || '', mwst_code: a.mwst_code || 'U81' });
  };
  const kundeChange = (id) => {
    setKundeId(id);
    const k = kunden.find(x => x.id === id);
    if (k?.zahlungsbedingung_tage != null) setZahlungsfrist(k.zahlungsbedingung_tage);
  };

  const valid = kundeId && rows.some(r => r.bezeichnung && (parseFloat(r.einzelpreis) || 0) !== 0 && r.konto_nr);

  const buildPositionen = () => rows.filter(r => r.bezeichnung && r.konto_nr).map(r => {
    const c = calc(r);
    return { artikel_id: r.artikel_id || null, bezeichnung: r.bezeichnung, menge: parseFloat(r.menge) || 0,
      einheit: r.einheit || null, einzelpreis: parseFloat(r.einzelpreis) || 0, konto_nr: r.konto_nr,
      mwst_code: r.mwst_code, mwst_satz: c.satz, betrag_netto: c.netto, betrag_mwst: c.mwst, betrag_brutto: c.brutto };
  });

  const save = async (status) => {
    if (!valid) { alert('Bitte Kunde wählen und mind. eine Position mit Bezeichnung, Preis und Konto erfassen.'); return; }
    setSaving(true);
    try {
      const positionen = buildPositionen();
      // Gutschrift: Kopfbeträge negativ (mindert offene Debitoren-Posten, wie beim Storno).
      // Positionen bleiben positiv – fibu_debitoren_verbuchen dreht die Buchungsrichtung.
      const sign = isGutschrift ? -1 : 1;
      const beleg = { kunde_id: kundeId, belegtyp, titel: titel || null, belegdatum, valutadatum: belegdatum,
        faelligkeit, zahlungsbedingung_tage: parseInt(zahlungsfrist) || null, waehrung: 'CHF',
        betrag_netto: sign * totals.netto, betrag_mwst: sign * totals.mwst, betrag_brutto: sign * totals.brutto, status };
      if (mode === 'edit') {
        await debitorenApi.updateFull(mandant.id, belegId, beleg, positionen);
        if (status !== 'entwurf') await debitorenApi.stellen(belegId);
      } else {
        await debitorenApi.create(mandant.id, beleg, positionen);
      }
      navigate(`/fibu/${mandant.id}/debitoren/uebersicht`);
    } catch (e) { alert('Fehler beim Speichern: ' + e.message); }
    finally { setSaving(false); }
  };

  // ── Lebenszyklus-Aktionen (View-Modus) ──────────────────────────
  const reload = () => debitorenApi.get(belegId).then(setLoaded).catch(console.error);
  const offen = loaded ? r2((loaded.betrag_brutto || 0) - (loaded.betrag_bezahlt || 0)) : 0;

  const doZahlung = async () => {
    const betrag = parseFloat(zahlBetrag);
    if (!betrag || betrag <= 0) { alert('Bitte einen Betrag > 0 erfassen.'); return; }
    setBusy('zahl');
    try {
      await debitorenApi.markBezahlt(belegId, r2(betrag), zahlDatum);
      setZahlOpen(false); setZahlBetrag('');
      await reload();
    } catch (e) { alert('Fehler: ' + e.message); }
    finally { setBusy(null); }
  };

  const doStorno = async () => {
    setBusy('storno');
    try {
      await debitorenApi.storno(belegId, stornoDatum);
      setStornoOpen(false);
      await reload();
    } catch (e) { alert('Storno fehlgeschlagen: ' + e.message); }
    finally { setBusy(null); }
  };

  // Erzeugt (falls nötig) das PDF, speichert die URL und gibt {url, blob} zurück.
  const ensurePdf = async () => {
    const full = loaded?.positionen ? loaded : await debitorenApi.get(belegId);
    const zs = zahlstellen.find(z => z.id === mSettings?.rechnung_zahlstelle_id) || zahlstellen[0] || {};
    await generateDebitorenPdf({belegId, vorlageId: mandant.rechnung_vorlage, mandatenId: mandant.id, upload: true});
  };

  const doPdf = async () => {
    setBusy('pdf');
    try { const { blob } = await ensurePdf(); await reload(); }
    catch (e) { alert('PDF-Erzeugung fehlgeschlagen: ' + e.message); }
    finally { setBusy(null); }
  };

  const doMail = async () => {
    const to = loaded?.kunde?.email;
    if (!to) { alert('Für diesen Kunden ist keine E-Mail-Adresse hinterlegt (Debitoren → Kunden).'); return; }
    if (!confirm(`${isGutschrift ? 'Gutschrift' : 'Rechnung'} ${loaded.beleg_nr} an ${to} senden?`)) return;
    setBusy('mail');
    try {
      const { url } = await ensurePdf();
      if (!url) throw new Error('PDF-URL nicht verfügbar (Storage-Upload fehlgeschlagen).');
      const docName = isGutschrift ? 'Gutschrift' : 'Rechnung';
      const html = `<p>Guten Tag${loaded.kunde?.name ? ' ' + loaded.kunde.name : ''}</p>
        <p>im Anhang erhalten Sie ${docName.toLowerCase()} <strong>${loaded.beleg_nr}</strong>${loaded.titel ? ` – ${loaded.titel}` : ''}
        über <strong>CHF ${CHF(loaded.betrag_brutto)}</strong>, zahlbar bis ${new Date(loaded.faelligkeit).toLocaleDateString('de-CH')}.</p>
        <p>Freundliche Grüsse<br>${mSettings?.name || mandant?.name || ''}</p>`;
      await belegMailApi.send({ to, subject: `${docName} ${loaded.beleg_nr}${mSettings?.name ? ' – ' + mSettings.name : ''}`,
        html, attachmentUrl: url, attachmentFilename: `${loaded.beleg_nr}.pdf` });
      await debitorenApi.update(belegId, { gesendet_am: new Date().toISOString(), gesendet_an: to });
      await reload();
      alert('Gesendet an ' + to);
    } catch (e) { alert('Versand fehlgeschlagen: ' + e.message); }
    finally { setBusy(null); }
  };

  if (loading) return <div style={{ flex: 1, padding: 24, color: '#94a394' }}>Lädt…</div>;

  const docLabel = isGutschrift ? 'Gutschrift' : 'Rechnung';
  const titleTxt = mode === 'new' ? `Neue ${docLabel}` : mode === 'edit' ? `${docLabel} bearbeiten` : `${docLabel} ${loaded?.beleg_nr || ''}`;

  return (
    <div style={{ flex: 1, overflow: 'auto', background: '#f2f5f2' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '14px 24px', background: '#fff', borderBottom: '1px solid #d4dcd4', gap: 10 }}>
        <button onClick={() => navigate(`/fibu/${mandant.id}/debitoren/uebersicht`)} style={{ background: 'none', border: 'none', color: '#7a9a7f', cursor: 'pointer', fontSize: 18, padding: '0 6px 0 0' }} title="Zurück zur Übersicht">←</button>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{titleTxt}</div>
          <div style={{ fontSize: 11.5, color: '#7a9a7f' }}>Debitoren · {isGutschrift ? 'Gutschrift' : 'Ausgangsrechnung'}{loaded?.status ? ` · ${loaded.status}` : ''}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          {!readOnly && (
            <>
              <button onClick={() => save('entwurf')} disabled={saving || !valid} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #bfcfbf', background: '#fff', color: '#4a5a4a', fontWeight: 600, cursor: valid ? 'pointer' : 'default' }}>Entwurf speichern</button>
              <button onClick={() => save('offen')} disabled={saving || !valid} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: valid ? '#3d6641' : '#a0b8a0', color: '#fff', fontWeight: 600, cursor: valid ? 'pointer' : 'default' }}>{saving ? 'Speichert…' : `${docLabel} stellen & buchen`}</button>
            </>
          )}
          {readOnly && loaded && (
            <>
              {!isGutschrift && loaded.status !== 'storniert' && offen > 0 && (
                <button onClick={() => { setZahlBetrag(String(offen)); setZahlOpen(true); }} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #2e4a7d', background: '#fff', color: '#2e4a7d', fontWeight: 600, cursor: 'pointer' }}>Zahlungseingang</button>
              )}
              {!isGutschrift && loaded.status !== 'storniert' && loaded.status !== 'bezahlt' && (parseFloat(loaded.betrag_bezahlt) || 0) === 0 && (
                <button onClick={() => setStornoOpen(true)} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e0c0c0', background: '#fff', color: '#8a2d2d', fontWeight: 600, cursor: 'pointer' }}>Stornieren</button>
              )}
              <button onClick={doMail} disabled={busy === 'mail'} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #bfcfbf', background: '#fff', color: '#4a5a4a', fontWeight: 600, cursor: 'pointer' }}>{busy === 'mail' ? 'Sendet…' : '✉ Senden'}</button>
              <button onClick={doPdf} disabled={busy === 'pdf'} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#3d6641', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>{busy === 'pdf' ? '…' : '↓ PDF'}</button>
            </>
          )}
        </div>
      </div>

      {/* View-Status-Leiste */}
      {readOnly && loaded && (
        <div style={{ display: 'flex', gap: 24, padding: '12px 24px', background: '#fff', borderBottom: '1px solid #eef2ee', fontSize: 12.5 }}>
          <div><span style={{ color: '#94a394' }}>Brutto: </span><strong>CHF {CHF(loaded.betrag_brutto)}</strong></div>
          {!isGutschrift && <div><span style={{ color: '#94a394' }}>Bezahlt: </span>CHF {CHF(loaded.betrag_bezahlt)}</div>}
          {!isGutschrift && <div><span style={{ color: '#94a394' }}>Offen: </span><strong style={{ color: offen > 0 ? '#8a2d2d' : '#2e7d32' }}>CHF {CHF(offen)}</strong></div>}
          <div><span style={{ color: '#94a394' }}>Fällig: </span>{new Date(loaded.faelligkeit).toLocaleDateString('de-CH')}</div>
          {loaded.mahnstufe > 0 && <div style={{ color: '#8a5a00' }}>Mahnstufe {loaded.mahnstufe}{loaded.letzte_mahnung_am ? ` (${new Date(loaded.letzte_mahnung_am).toLocaleDateString('de-CH')})` : ''}</div>}
          {loaded.gesendet_am && <div style={{ color: '#2e4a7d' }}>✉ gesendet {new Date(loaded.gesendet_am).toLocaleDateString('de-CH')}</div>}
          {loaded.storno_beleg_id && <div style={{ color: '#8a2d2d' }}>storniert</div>}
        </div>
      )}

      <div style={{ padding: 24}}>
        <div style={{ ...card, padding: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 2fr 1fr 1fr', gap: 16, marginBottom: 18 }}>
            <div><label style={lbl}>Belegart</label>
              <select style={inp} value={belegtyp} disabled={readOnly} onChange={e => setBelegtyp(e.target.value)}>
                <option value="rechnung">Rechnung</option>
                <option value="gutschrift">Gutschrift</option>
              </select>
            </div>
            <div><label style={lbl}>Kunde *</label>
              <select style={inp} value={kundeId} onChange={e => kundeChange(e.target.value)} disabled={readOnly}>
                <option value="">— wählen —</option>
                {kunden.map(k => <option key={k.id} value={k.id}>{k.name}{k.ort ? `, ${k.ort}` : ''}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Belegdatum</label><input type="date" style={inp} value={belegdatum} onChange={e => setBelegdatum(e.target.value)} disabled={readOnly} /></div>
            <div><label style={lbl}>Fällig in (Tagen) → {faelligkeit}</label><input type="number" style={inp} value={zahlungsfrist} onChange={e => setZahlungsfrist(e.target.value)} disabled={readOnly} /></div>
            <div style={{ gridColumn: '1 / 5' }}><label style={lbl}>{isGutschrift ? 'Gutschrift-Grund / Titel' : 'Rechnungstitel'}</label><input style={inp} value={titel} onChange={e => setTitel(e.target.value)} placeholder="z.B. Beratung & Material Q2 2026" disabled={readOnly} /></div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: '#f7faf7', color: '#6b826b', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                <th style={{ textAlign: 'left', padding: '7px 6px', width: 10 }}>Nr.</th>
                <th style={{ textAlign: 'left', padding: '7px 6px', width: 'auto' }}>Artikel / Position</th>
                <th style={{ textAlign: 'center', padding: '7px 6px', width: 70 }}>Menge</th>
                <th style={{ textAlign: 'left', padding: '7px 6px', width: 65 }}>Einheit</th>
                <th style={{ textAlign: 'center', padding: '7px 6px', width: 90 }}>Einzelpreis</th>
                <th style={{ textAlign: 'center', padding: '7px 6px', width: 150 }}>Konto</th>
                <th style={{ textAlign: 'right', padding: '7px 6px', width: 110 }}>MWST</th>
                <th style={{ textAlign: 'right', padding: '7px 6px', width: 120 }}>Betrag</th>
                {!readOnly && <th style={{ width: 28 }}></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const c = calc(row);
                return (
                  <tr key={row._id} style={{ borderBottom: '1px solid #f0f3f0' }}>
            <       td style={{textAlign: 'center'}}>{index +1}</td>
                    <td style={{ padding: '3px 6px' }}>
                      {!readOnly && (
                        <select style={{ ...cell, marginBottom: 2 }} value={row.artikel_id} onChange={e => pickArtikel(row._id, e.target.value)}>
                          <option value="">— frei / Artikel wählen —</option>
                          {artikel.map(a => <option key={a.id} value={a.id}>{a.nr} · {a.name}</option>)}
                        </select>
                      )}
                      <input style={cell} value={row.bezeichnung} placeholder="Bezeichnung" onChange={e => setRow(row._id, { bezeichnung: e.target.value })} disabled={readOnly} />
                    </td>
                    <td style={{ padding: '3px 6px' }}><input type="number" step="1" style={{ ...cell, textAlign: 'center' }} value={row.menge} onChange={e => setRow(row._id, { menge: e.target.value })} disabled={readOnly} /></td>
                    <td style={{ padding: '3px 6px' }}>
                      <select
                          style={cell}
                          value={row.einheit || 'Stk'}
                          onChange={e => setRow(row._id, { einheit: e.target.value })}
                          disabled={readOnly}>
                        <option value="Stk">Stk</option>
                        <option value="h">h</option>
                      </select>
                    </td>
                    <td style={{ padding: '3px 6px' }}>
                      <input
                          id={`preis-${row._id}`} // Eindeutige ID für dieses spezifische Feld
                          type="number"
                          step="0.05"
                          style={{ ...cell, textAlign: 'right' }}
                          // Wir prüfen, ob die ID des aktuell fokussierten Elements mit diesem Feld übereinstimmt
                          value={document.activeElement?.id === `preis-${row._id}` ? row.einzelpreis : Number(row.einzelpreis || 0).toFixed(2)}
                          onChange={e => {
                            let preis = e.target.value;
                            setRow(row._id, { einzelpreis: preis });
                          }}
                          // Verhindert, dass leere Eingaben beim Verlassen zu "0.00" werden
                          onBlur={e => {
                            if (e.target.value !== '') {
                              setRow(row._id, { einzelpreis: Number(e.target.value).toFixed(2) });
                            }
                          }}
                          disabled={readOnly}
                      />
                    </td>
                    <td style={{ padding: '3px 6px', position: 'relative'}}>
                      {(() => {
                        const isFocused = document.activeElement?.id === `search-konto-${row._id}`;
                        const ausgewähltesKonto = ertragKonten.find(k => k.konto_nr === row.konto_nr);

                        return (
                            <div style={{ position: 'relative', width: '100%' }}>
                              {/* Das Such- und Anzeigefeld */}
                              <div style={{ position: 'relative', width: '100%' }}>
                                <input
                                    id={`search-konto-${row._id}`}
                                    type="text"
                                    style={{
                                      ...cell,
                                      cursor: readOnly ? 'default' : 'pointer',
                                      backgroundColor: readOnly ? '#f5f5f5' : '#ffffff',
                                      color: isFocused ? '#000000' : 'transparent',
                                      caretColor: '#000000'
                                    }}
                                    disabled={readOnly}
                                    // KORREKTUR: Platzhalter ausblenden, wenn eine Option selektiert ist
                                    placeholder={!isFocused && ausgewähltesKonto ? "" : "— Konto suchen —"}
                                    value={isFocused ? (row._searchQuery ?? '') : ''}
                                    onFocus={() => setRow(row._id, { _searchQuery: '' })}
                                    onChange={e => setRow(row._id, { _searchQuery: e.target.value })}
                                    onBlur={() => setTimeout(() => setRow(row._id, { _searchQuery: undefined }), 200)}
                                />

                                {/* NUR IM SELEKTIERTEN (GESCHLOSSENEN) ZUSTAND: Der gekürzte Text mit max 150px */}
                                {!isFocused && ausgewähltesKonto && (
                                    <div style={{
                                      position: 'absolute',
                                      left: 8,
                                      top: '50%',
                                      transform: 'translateY(-50%)',
                                      display: 'flex',
                                      flexDirection: 'column', // Richtet die Elemente untereinander aus
                                      justifyContent: 'center',
                                      pointerEvents: 'none', // Klicks gehen durch auf das Input-Feld darunter
                                      lineHeight: '1.2'
                                    }}>
                                      {/* Obere Zeile: Konto-Nummer */}
                                      <span style={{
                                        fontSize: '10px',
                                        fontWeight: 'bold',
                                        color: '#3d6641'
                                      }}>{ausgewähltesKonto.konto_nr}</span>

                                      {/* Untere Zeile: Bezeichnung (Kürzung auf max 140px mit ...) */}
                                      <span style={{
                                        fontSize: '11.5px',
                                        color: '#333333',
                                        maxWidth: 140,
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis'
                                      }}>{ausgewähltesKonto.bezeichnung}</span>
                                    </div>
                                )}
                              </div>

                              {/* Die schwebende Suchergebnis-Liste */}
                              {isFocused && !readOnly && (
                                  <div style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: 0,
                                    right: 0,
                                    zIndex: 1000,
                                    maxHeight: 200,
                                    overflowY: 'auto',
                                    overflowX: 'hidden',
                                    background: '#ffffff',
                                    border: '1px solid #c8dec8',
                                    borderRadius: 4,
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                    marginTop: 2
                                  }}>
                                    {ertragKonten
                                        .filter(k => {
                                          const query = (row._searchQuery || '').toLowerCase();
                                          return k.konto_nr.toLowerCase().includes(query) || k.bezeichnung.toLowerCase().includes(query);
                                        })
                                        .map(k => (
                                            <div
                                                key={k.konto_nr}
                                                onMouseDown={() => setRow(row._id, { konto_nr: k.konto_nr, _searchQuery: undefined })}
                                                style={{
                                                  padding: '6px 10px',
                                                  cursor: 'pointer',
                                                  borderBottom: '1px solid #f0f3f0',
                                                  backgroundColor: row.konto_nr === k.konto_nr ? '#e8f0e8' : '#ffffff',
                                                }}
                                                onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f4f7f4'}
                                                onMouseLeave={e => e.currentTarget.style.backgroundColor = row.konto_nr === k.konto_nr ? '#e8f0e8' : '#ffffff'}
                                            >
                                              {/* Oben: Konto-Nummer */}
                                              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#3d6641' }}>
                                                {k.konto_nr}
                                              </div>

                                              {/* Unten: Volle Bezeichnung OHNE Begrenzung in der Liste */}
                                              <div style={{ fontSize: '12px', color: '#333333' }}>
                                                {k.bezeichnung}
                                              </div>
                                            </div>
                                        ))}

                                    {ertragKonten.filter(k => {
                                      const query = (row._searchQuery || '').toLowerCase();
                                      return k.konto_nr.toLowerCase().includes(query) || k.bezeichnung.toLowerCase().includes(query);
                                    }).length === 0 && (
                                        <div style={{ padding: '8px', fontSize: 11.5, color: '#999', textAlign: 'center' }}>
                                          Keine Konten gefunden
                                        </div>
                                    )}
                                  </div>
                              )}
                            </div>
                        );
                      })()}
                    </td>
                    <td style={{ padding: '3px 6px' }}>
                      <select style={cell} value={row.mwst_code} onChange={e => setRow(row._id, { mwst_code: e.target.value })} disabled={readOnly}>
                        {umsatzCodes.map(co => <option key={co.code} value={co.code}>{co.code} · {co.satz}%</option>)}
                        {umsatzCodes.length === 0 && <option value="U81">U81 · 8.1%</option>}
                      </select>
                    </td>
                    <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{CHF(c.brutto)}</td>
                    {!readOnly && (
                      <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                        <button onClick={() => setRows(rs => rs.length > 1 ? rs.filter(r => r._id !== row._id) : rs)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c4893a' }}>✕</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!readOnly && <button onClick={() => setRows(rs => [...rs, newRow()])} style={{ marginTop: 10, background: 'none', border: 'none', color: '#3d6641', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}>+ Position hinzufügen</button>}

          {/* NEU: Dynamische Berechnung der Beträge pro MWST-Satz */}
          {(() => {
            const mwstGruppen = {};

            rows.forEach(row => {
              const c = calc(row);
              // Satz ermitteln (sucht den passenden Prozentsatz aus umsatzCodes oder nutzt den Fallback)
              const codeObj = umsatzCodes.find(co => co.code === row.mwst_code);
              const satz = codeObj ? Number(codeObj.satz) : (row.mwst_code === 'U81' ? 8.1 : 0);
              const key = `${row.mwst_code} (${satz}%)`;

              if (!mwstGruppen[key]) {
                mwstGruppen[key] = { netto: 0, mwst: 0, brutto: 0 };
              }
              mwstGruppen[key].netto += c.netto || 0;
              mwstGruppen[key].mwst += c.mwst || 0;
              mwstGruppen[key].brutto += c.brutto || 0;
            });

            return (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                  <div style={{ width: 280 }}>

                    {/* Haupt-Netto */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12.5, color: '#4a5a4a' }}>
                      <span>Netto</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>CHF {CHF(totals.netto)}</span>
                    </div>

                    {/* Aufgeteilte MWST-Sätze */}
                    {Object.entries(mwstGruppen).map(([label, werte]) => (
                        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 11.5, color: '#7a8a7a', paddingLeft: 12 }}>
                          <span>davon MWST {label}</span>
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>CHF {CHF(werte.mwst)}</span>
                        </div>
                    ))}

                    {/* Gesamte MWST (optional als Summe, falls gewünscht) */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12.5, color: '#4a5a4a', marginBottom: 4 }}>
                      <span>MWST Total</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>CHF {CHF(totals.mwst)}</span>
                    </div>

                    {/* Endtotal */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #e4e9e4', marginTop: 6, paddingTop: 8, fontSize: 15, fontWeight: 800 }}>
                          <span>
                            Total
                            <span style={{ fontSize: 12, fontWeight: 500, color: '#7a8a7a', marginLeft: 6 }}>
                              {(() => {
                                  const steuerart = mSettings?.rechnung_steuerart ?? 2;
                                  if (steuerart < 3) return '(inkl. MWST)';
                                  if (steuerart === 3) return '(steuerbefreit)';
                                  return '(exkl. MWST)'; // Fallback / Steuerart 2
                              })()}
                            </span>
                          </span>
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>CHF {CHF(totals.brutto)}</span>
                      </div>

                  </div>
                </div>
            );
          })()}
        </div>
        {!readOnly && (
          <div style={{ fontSize: 11.5, color: '#94a394', marginTop: 10 }}>
            „{docLabel} stellen &amp; buchen" verbucht direkt: {isGutschrift ? 'Gegenbuchung (Ertrag / 2200 ↔ 1100 Debitoren).' : 'Soll 1100 Debitoren / Haben Ertrag + 2200 Umsatzsteuer.'}
          </div>
        )}
      </div>

      {/* Zahlungseingang-Dialog */}
      {zahlOpen && (
        <Modal onClose={() => setZahlOpen(false)} title="Zahlungseingang erfassen">
          <div style={{ marginBottom: 12 }}><label style={lbl}>Betrag (CHF) · offen: {CHF(offen)}</label>
            <input type="number" step="0.05" style={inp} value={zahlBetrag} onChange={e => setZahlBetrag(e.target.value)} autoFocus /></div>
          <div style={{ marginBottom: 16 }}><label style={lbl}>Zahlungsdatum</label>
            <input type="date" style={inp} value={zahlDatum} onChange={e => setZahlDatum(e.target.value)} /></div>
          <div style={{ fontSize: 11, color: '#94a394', marginBottom: 14 }}>Setzt den Status auf teilbezahlt/bezahlt. Die Hauptbuchbuchung (Bank/Debitoren) erfolgt über die Bankabstimmung.</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button onClick={() => setZahlOpen(false)} style={btnGhost}>Abbrechen</button>
            <button onClick={doZahlung} disabled={busy === 'zahl'} style={btnPrimary}>{busy === 'zahl' ? 'Speichert…' : 'Erfassen'}</button>
          </div>
        </Modal>
      )}

      {/* Storno-Dialog */}
      {stornoOpen && (
        <Modal onClose={() => setStornoOpen(false)} title={`Rechnung ${loaded?.beleg_nr} stornieren`}>
          <div style={{ fontSize: 12.5, color: '#4a5a4a', marginBottom: 14 }}>Erzeugt eine Storno-Gutschrift (Gegenbuchung) per Storno-Datum. Die Rechnung bleibt erhalten und wird als <em>storniert</em> markiert.</div>
          <div style={{ marginBottom: 16 }}><label style={lbl}>Storno-Datum</label>
            <input type="date" style={inp} value={stornoDatum} onChange={e => setStornoDatum(e.target.value)} /></div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button onClick={() => setStornoOpen(false)} style={btnGhost}>Abbrechen</button>
            <button onClick={doStorno} disabled={busy === 'storno'} style={{ ...btnPrimary, background: '#8a2d2d' }}>{busy === 'storno' ? 'Storniert…' : 'Stornieren'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const btnGhost   = { padding: '8px 16px', borderRadius: 8, border: '1px solid #bfcfbf', background: '#fff', color: '#4a5a4a', fontWeight: 600, cursor: 'pointer' };
const btnPrimary = { padding: '8px 18px', borderRadius: 8, border: 'none', background: '#3d6641', color: '#fff', fontWeight: 600, cursor: 'pointer' };

function Modal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,30,20,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 22, width: 420, maxWidth: '90vw', boxShadow: '0 12px 40px rgba(0,0,0,.18)' }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}
