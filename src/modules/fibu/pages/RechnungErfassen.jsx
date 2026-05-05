import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMandant } from '../contexts/MandantContext';
import { lieferantenApi, kontenApi, kreditorenApi, mwstCodesApi, kiVorschlagApi } from '../api';
import { supabase } from '@/api/supabaseClient';
import * as pdfjsLib from 'pdfjs-dist';
// Worker aus public/ – funktioniert in Vite ohne ?url-Trick
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

const CHF = (n) => n == null ? '' : Number(n).toFixed(2);
const inp = { background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '6px 10px', fontSize: 12.5, color: '#1a1a2e', outline: 'none', width: '100%' };
const lbl = { fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 3, display: 'block' };

function addDays(dateStr, days) {
  if (!dateStr) return '';
  const d = new Date(dateStr); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Swiss SPC QR-Rechnung Parser ─────────────────────────────────
// Format: https://www.paymentstandards.ch/dam/downloads/ig-qr-bill-de.pdf
// 30 Zeilen, Zeile 0 = "SPC", Zeile 1 = "0200", Zeile 2 = "1"
function parseSpc(text) {
  if (!text || !text.startsWith('SPC')) return null;
  const lines = text.split(/\r?\n/).map(l => l.trim());
  if (lines[0] !== 'SPC') return null;

  const addrType = lines[4] ?? 'S'; // S = Strukturiert, K = Kombiniert
  let plz = '', ort = '';
  if (addrType === 'S') {
    plz = lines[8] ?? '';
    ort = lines[9] ?? '';
  } else {
    // Kombiniert: Zeile 7 = "PLZ Ort"
    const combined = lines[7] ?? '';
    const m = combined.match(/^(\d{4,5})\s+(.+)/);
    if (m) { plz = m[1]; ort = m[2]; }
  }

  return {
    iban:        (lines[3] ?? '').replace(/\s+/g, ''),
    name:        lines[5] ?? '',
    strasse:     addrType === 'S' ? (lines[6] ?? '') : (lines[6] ?? ''),
    plz,
    ort,
    land:        lines[10] ?? 'CH',
    betrag:      lines[18] ? parseFloat(lines[18]) || null : null,
    waehrung:    lines[19] ?? 'CHF',
    referenzTyp: lines[27] ?? '',
    referenz:    (lines[28] ?? '').replace(/\s+/g, ''),
    mitteilung:  lines[29] ?? '',
  };
}

// ── QR-Code aus PDF oder Bild lesen ──────────────────────────────
// pdfjsLib ist statisch oben importiert, GlobalWorkerOptions.workerSrc gesetzt.
async function scanQrInFile(file) {
  const jsQR = (await import('jsqr')).default;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (file.type === 'application/pdf') {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    // Von letzter Seite: Zahlschein ist immer am Ende
    for (let pageNum = pdf.numPages; pageNum >= 1; pageNum--) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 3.0 }); // 3x für QR-Auflösung
      canvas.width  = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(imageData.data, canvas.width, canvas.height);
      if (result?.data) return result.data;
    }
    return null;
  } else {
    // Bild (JPG/PNG/WEBP)
    await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        res();
      };
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(imageData.data, canvas.width, canvas.height);
    return result?.data ?? null;
  }
}

function calcPosition(pos, mwstMap) {
  const satz = mwstMap[pos.mwst_code] ?? 0;
  const netto = parseFloat(pos.betrag_netto) || 0;
  const mwst  = Math.round(netto * satz) / 100;
  return { ...pos, mwst_satz: satz, betrag_mwst: mwst, betrag_brutto: netto + mwst };
}

const emptyPos = (defaultCode = 'M81') => ({
  _key: Math.random(), konto_nr: '', bezeichnung: '',
  mwst_code: defaultCode, betrag_netto: '', betrag_mwst: 0, betrag_brutto: 0, mwst_satz: 0,
});

export default function RechnungErfassen() {
  const { mandant, canWrite } = useMandant();
  const { belegId } = useParams();
  const [searchParams] = useSearchParams();
  const inboxId = searchParams.get('inboxId'); // aus Inbox-Navigation
  const navigate = useNavigate();

  const [lieferanten, setLieferanten] = useState([]);
  const [konten, setKonten]           = useState([]);
  const [mwstCodes, setMwstCodes]     = useState([]);
  const [saving, setSaving]           = useState(false);

  // QR-Scanner State
  const [scanFile, setScanFile]     = useState(null);          // hochgeladene Datei
  const [scanStatus, setScanStatus] = useState('idle');        // idle | scanning | found | notfound | error
  const [scanData, setScanData]     = useState(null);          // parsiertes SPC-Objekt
  const [scanMatch, setScanMatch]   = useState(null);          // gefundener Lieferant aus DB
  const [inboxItem, setInboxItem]   = useState(null);          // Inbox-Eintrag (wenn aus Inbox geöffnet)
  const [kiLoading, setKiLoading]   = useState(false);         // KI-Vorschlag lädt
  const [kiVorschlag, setKiVorschlag] = useState(null);        // {vorschlaege, lieferant_kategorie, quelle}
  const fileRef = useRef();

  const today = new Date().toISOString().slice(0, 10);
  const [head, setHead] = useState({
    lieferant_id: '', lieferant_beleg_nr: '',
    belegdatum: today, faelligkeit: '',
    zahlungsbedingung_tage: 30, waehrung: 'CHF',
    zahlungsreferenz: '', notiz: '',
  });
  const [positionen, setPositionen] = useState([emptyPos()]);

  // MWST-Code → Satz Map für Berechnungen
  const mwstMap = Object.fromEntries(mwstCodes.map(c => [c.code, c.satz ?? 0]));

  useEffect(() => {
    if (!mandant) return;
    Promise.all([
      lieferantenApi.list(mandant.id),
      kontenApi.list(mandant.id),
      mwstCodesApi.listAktiv(mandant.id),
    ]).then(([l, k, mc]) => {
      setLieferanten(l);
      setKonten(k.filter(k => k.konto_typ === 'aufwand'));
      setMwstCodes(mc);
    });
  }, [mandant?.id]);

  // Inbox-PDF laden wenn via ?inboxId geöffnet
  useEffect(() => {
    if (!inboxId || !mandant) return;
    (async () => {
      const { data: item } = await supabase
        .from('fibu_rechnung_inbox')
        .select('*')
        .eq('id', inboxId)
        .single();
      if (!item?.pdf_path) return;
      setInboxItem(item);

      // Signierte URL → Blob → File → Auto-Scan
      const { data: signedData } = await supabase.storage
        .from('fibu-inbox')
        .createSignedUrl(item.pdf_path, 300);
      if (!signedData?.signedUrl) return;

      const resp = await fetch(signedData.signedUrl);
      const blob = await resp.blob();
      const file = new File([blob], item.pdf_name || 'rechnung.pdf', { type: blob.type });
      setScanFile(file);
      // Kurz warten bis lieferanten geladen
      setScanStatus('idle');
    })();
  }, [inboxId, mandant?.id]);

  const handleLieferantChange = (id) => {
    const l = lieferanten.find(x => x.id === id);
    setHead(prev => ({
      ...prev,
      lieferant_id: id,
      waehrung: l?.waehrung ?? prev.waehrung,
      zahlungsbedingung_tage: l?.zahlungsbedingung_tage ?? 30,
      faelligkeit: addDays(prev.belegdatum, l?.zahlungsbedingung_tage ?? 30),
    }));
    if (l?.standard_konto_nr && positionen.length === 1 && !positionen[0].konto_nr) {
      setPositionen([calcPosition(
        { ...positionen[0], konto_nr: l.standard_konto_nr, mwst_code: l.mwst_code ?? 'M81' },
        mwstMap
      )]);
    }
  };

  const handleBelegdatumChange = (val) => {
    setHead(prev => ({ ...prev, belegdatum: val, faelligkeit: addDays(val, prev.zahlungsbedingung_tage) }));
  };

  // ── KI-Vorschlag abrufen ────────────────────────────────────────
  const handleKiVorschlag = useCallback(async () => {
    if (!mandant) return;
    setKiLoading(true);
    setKiVorschlag(null);
    try {
      const lieferant = lieferanten.find(l => l.id === head.lieferant_id);
      // Kontext aus QR-Daten + manuellen Feldern
      const kontextParts = [
        scanData?.mitteilung,
        scanData?.name,
        head.notiz,
        head.lieferant_beleg_nr,
      ].filter(Boolean);
      const result = await kiVorschlagApi.suggest({
        mandantId:     mandant.id,
        lieferantId:   head.lieferant_id || null,
        lieferantName: lieferant?.name ?? '',
        kontextText:   kontextParts.join('\n'),
        konten:        konten,
        mwstCodes:     mwstCodes,
        waehrung:      head.waehrung,
        betragBrutto:  scanData?.betrag ?? null,
      });
      setKiVorschlag(result);
    } catch (e) {
      console.error('KI-Vorschlag Fehler:', e);
      setKiVorschlag({ error: e.message });
    } finally {
      setKiLoading(false);
    }
  }, [mandant, head, konten, mwstCodes, scanData, lieferanten]);

  // KI-Vorschlag übernehmen
  const handleKiUebernehmen = (vorschlag) => {
    setPositionen(prev => prev.map((p, i) => i === 0
      ? calcPosition({ ...p, konto_nr: vorschlag.konto_nr, mwst_code: vorschlag.mwst_code, bezeichnung: vorschlag.bezeichnung || p.bezeichnung }, mwstMap)
      : p
    ));
    setKiVorschlag(null);
  };

  const updatePos = (idx, field, value) => {
    setPositionen(prev => {
      const next = [...prev];
      next[idx] = calcPosition({ ...next[idx], [field]: value }, mwstMap);
      return next;
    });
  };

  const totals = positionen.reduce(
    (s, p) => ({ netto: s.netto + (parseFloat(p.betrag_netto) || 0), mwst: s.mwst + (p.betrag_mwst || 0), brutto: s.brutto + (p.betrag_brutto || 0) }),
    { netto: 0, mwst: 0, brutto: 0 }
  );

  // ── QR-Scan Logik ───────────────────────────────────────────────
  const handleScan = useCallback(async () => {
    if (!scanFile) return;
    setScanStatus('scanning');
    setScanData(null);
    setScanMatch(null);

    try {
      const rawQr = await scanQrInFile(scanFile);
      if (!rawQr) {
        setScanStatus('notfound');
        return;
      }

      const spc = parseSpc(rawQr);
      if (!spc) {
        setScanStatus('notfound');
        return;
      }

      setScanData(spc);
      setScanStatus('found');

      // IBAN gegen Lieferanten matchen
      const normalIban = spc.iban.replace(/\s+/g, '').toUpperCase();
      const matched = lieferanten.find(l => l.iban && l.iban.replace(/\s+/g, '').toUpperCase() === normalIban);
      setScanMatch(matched ?? null);

      // Formular befüllen
      setHead(prev => {
        const l = matched ?? null;
        return {
          ...prev,
          lieferant_id: matched?.id ?? prev.lieferant_id,
          waehrung: spc.waehrung ?? prev.waehrung,
          zahlungsbedingung_tage: l?.zahlungsbedingung_tage ?? prev.zahlungsbedingung_tage,
          faelligkeit: addDays(prev.belegdatum, l?.zahlungsbedingung_tage ?? prev.zahlungsbedingung_tage),
          zahlungsreferenz: spc.referenz ?? prev.zahlungsreferenz,
          notiz: spc.mitteilung ? spc.mitteilung : prev.notiz,
        };
      });

      // Betrag übernehmen wenn vorhanden
      if (spc.betrag && spc.betrag > 0) {
        const defaultCode = matched?.mwst_code ?? 'M81';
        const satz = mwstMap[defaultCode] ?? 0;
        // Brutto → Netto
        const netto = satz > 0
          ? Math.round(spc.betrag / (1 + satz / 100) * 100) / 100
          : spc.betrag;
        setPositionen([calcPosition({
          _key: Math.random(),
          konto_nr: matched?.standard_konto_nr ?? '',
          bezeichnung: spc.mitteilung || '',
          mwst_code: defaultCode,
          betrag_netto: CHF(netto),
          betrag_mwst: 0,
          betrag_brutto: 0,
          mwst_satz: satz,
        }, mwstMap)]);
      }
    } catch (e) {
      console.error('QR-Scan Fehler:', e);
      setScanStatus('error');
    }
  }, [scanFile, lieferanten, mwstMap]);

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setScanFile(f);
    setScanStatus('idle');
    setScanData(null);
    setScanMatch(null);
  };

  // ── Speichern ───────────────────────────────────────────────────
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
      const beleg = await kreditorenApi.create(mandant.id, {
        ...head,
        beleg_nr: belegNr,
        betrag_netto: totals.netto,
        betrag_mwst: totals.mwst,
        betrag_brutto: totals.brutto,
      }, pos);

      // Inbox-Eintrag als verarbeitet markieren
      if (inboxId && beleg?.id) {
        await supabase
          .from('fibu_rechnung_inbox')
          .update({ status: 'verarbeitet', beleg_id: beleg.id })
          .eq('id', inboxId);
      }

      navigate(`/fibu/${mandant.id}/kreditoren`);
    } finally {
      setSaving(false);
    }
  };

  const hdrTd  = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b', padding: '8px 10px', borderBottom: '1px solid #e4e9e4', textAlign: 'left', background: '#fff', whiteSpace: 'nowrap' };
  const cellTd = { padding: '6px 8px', borderBottom: '1px solid #f0f3f0', verticalAlign: 'middle' };

  // Nur Vorsteuer-Codes in Positionen-Dropdown
  const vorsteuerCodes = mwstCodes.filter(c => c.typ === 'vorsteuer' || c.typ === 'steuerbefreit');

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* Formular */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16, borderRight: '1px solid #e4e9e4' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>
            {belegId ? 'Rechnung bearbeiten' : 'Neue Kreditoren-Rechnung'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => navigate(`/fibu/${mandant?.id}/kreditoren`)}
              style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12.5, cursor: 'pointer' }}
            >Abbrechen</button>
            <button
              onClick={handleSave}
              disabled={!canWrite || saving || !head.lieferant_id || !head.faelligkeit}
              style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', opacity: (!canWrite || saving || !head.lieferant_id || !head.faelligkeit) ? .5 : 1 }}
            >{saving ? 'Speichert…' : 'Speichern & Buchen'}</button>
          </div>
        </div>

        {/* ── Inbox-Banner ── */}
        {inboxItem && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: '#f0f7ff', border: '1px solid #c5d4ea' }}>
            <span style={{ fontSize: 16 }}>📬</span>
            <div style={{ fontSize: 12, color: '#1e3a6e' }}>
              <strong>Aus Eingangspostfach:</strong>{' '}
              {inboxItem.sender_name || inboxItem.sender_email}
              {inboxItem.betreff ? ` — ${inboxItem.betreff}` : ''}
            </div>
          </div>
        )}

        {/* ── QR-Zahlschein Scanner ── */}
        <div style={{ background: '#fff', border: '1px solid #c5d4ea', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#e8f0fb', borderBottom: '1px solid #c5d4ea' }}>
            <svg style={{ width: 18, height: 18, flexShrink: 0 }} viewBox="0 0 24 24" fill="none" stroke="#2e4a7d" strokeWidth={2}>
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="3" height="3"/>
              <rect x="18" y="14" width="3" height="3"/><rect x="14" y="18" width="3" height="3"/>
              <rect x="18" y="18" width="3" height="3"/>
            </svg>
            <span style={{ fontWeight: 600, fontSize: 12.5, color: '#1e3a6e' }}>Swiss QR-Rechnung scanner</span>
            <span style={{ fontSize: 11, color: '#4a6a9e' }}>— PDF oder Bild mit QR-Zahlschein hochladen</span>
            <div style={{ flex: 1 }} />
            <input ref={fileRef} type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={handleFileChange} />
            <button
              onClick={() => fileRef.current?.click()}
              style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #8ba8d4', background: '#fff', color: '#2e4a7d', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
            >📄 Datei wählen</button>
            {scanFile && (
              <button
                onClick={handleScan}
                disabled={scanStatus === 'scanning'}
                style={{ padding: '5px 14px', borderRadius: 7, border: 'none', background: '#2e4a7d', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer', opacity: scanStatus === 'scanning' ? .6 : 1 }}
              >{scanStatus === 'scanning' ? '⏳ Scannt…' : '🔍 QR scannen'}</button>
            )}
          </div>

          {/* Status-Anzeige */}
          {scanFile && scanStatus !== 'idle' && (
            <div style={{ padding: '10px 14px' }}>
              {scanStatus === 'scanning' && (
                <div style={{ fontSize: 12, color: '#2e4a7d', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>Scannt PDF auf QR-Zahlschein…</span>
                </div>
              )}
              {scanStatus === 'notfound' && (
                <div style={{ fontSize: 12, color: '#854d0e', background: '#fef9c3', padding: '8px 12px', borderRadius: 7, border: '1px solid #fde68a' }}>
                  ⚠️ Kein Swiss QR-Zahlschein gefunden. Bitte Felder manuell ausfüllen.
                </div>
              )}
              {scanStatus === 'error' && (
                <div style={{ fontSize: 12, color: '#991b1b', background: '#fee2e2', padding: '8px 12px', borderRadius: 7, border: '1px solid #fca5a5' }}>
                  ❌ Scan-Fehler. Bitte PDF prüfen oder Felder manuell ausfüllen.
                </div>
              )}
              {scanStatus === 'found' && scanData && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#166534', background: '#dcfce7', padding: '8px 12px', borderRadius: 7, border: '1px solid #86efac' }}>
                    <span>✅ QR-Zahlschein erkannt</span>
                    {scanMatch
                      ? <span style={{ marginLeft: 4, fontWeight: 600 }}>— Lieferant gefunden: <em>{scanMatch.name}</em></span>
                      : <span style={{ marginLeft: 4, color: '#92400e' }}>— IBAN nicht in Lieferantenstamm. Bitte Lieferant manuell wählen oder neu erfassen.</span>
                    }
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 11.5 }}>
                    {[
                      ['Empfänger', scanData.name],
                      ['IBAN', scanData.iban],
                      ['Betrag', scanData.betrag ? `${scanData.waehrung} ${CHF(scanData.betrag)}` : '(kein Betrag)'],
                      ['Referenz', scanData.referenz || '—'],
                      ['Mitteilung', scanData.mitteilung || '—'],
                      ['Adresse', [scanData.strasse, [scanData.plz, scanData.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'],
                    ].map(([k, v]) => (
                      <div key={k} style={{ background: '#f7faf7', borderRadius: 6, padding: '6px 10px' }}>
                        <div style={{ fontWeight: 600, color: '#6b826b', textTransform: 'uppercase', fontSize: 9.5, letterSpacing: '.06em' }}>{k}</div>
                        <div style={{ color: '#1a1a2e', marginTop: 2, fontFamily: k === 'IBAN' || k === 'Referenz' ? 'monospace' : undefined, wordBreak: 'break-all' }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Dateiname */}
          {scanFile && (
            <div style={{ padding: '6px 14px', fontSize: 11, color: '#6b826b', borderTop: '1px solid #e8f0fb', background: '#f4f8ff' }}>
              📎 {scanFile.name} ({(scanFile.size / 1024).toFixed(0)} KB)
            </div>
          )}
        </div>

        {/* ── Belegkopf ── */}
        <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#94a394', marginBottom: 12 }}>Belegkopf</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={lbl}>Lieferant *</label>
              <select style={inp} value={head.lieferant_id} onChange={e => handleLieferantChange(e.target.value)}>
                <option value="">— wählen —</option>
                {lieferanten.filter(l => l.aktiv).map(l => (
                  <option key={l.id} value={l.id}>{l.name} ({l.nr})</option>
                ))}
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
              <input type="date" style={{ ...inp, borderColor: head.faelligkeit ? '#7a9b7f' : '#e87070' }} value={head.faelligkeit} onChange={e => setHead(p => ({ ...p, faelligkeit: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Zahlungsbedingung (Tage)</label>
              <input type="number" style={inp} value={head.zahlungsbedingung_tage} onChange={e => setHead(p => ({ ...p, zahlungsbedingung_tage: parseInt(e.target.value) || 30 }))} />
            </div>
            <div>
              <label style={lbl}>Währung</label>
              <select style={inp} value={head.waehrung} onChange={e => setHead(p => ({ ...p, waehrung: e.target.value }))}>
                <option>CHF</option><option>EUR</option><option>USD</option><option>GBP</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Zahlungsreferenz / QR-Ref.</label>
              <input style={{ ...inp, fontFamily: 'monospace', fontSize: 11.5 }} value={head.zahlungsreferenz} onChange={e => setHead(p => ({ ...p, zahlungsreferenz: e.target.value }))} placeholder="Optionale Referenznummer" />
            </div>
            <div>
              <label style={lbl}>Interne Notiz</label>
              <input style={inp} value={head.notiz} onChange={e => setHead(p => ({ ...p, notiz: e.target.value }))} />
            </div>
          </div>
        </div>

        {/* ── Buchungspositionen ── */}
        <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #e4e9e4' }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#94a394' }}>Buchungspositionen</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleKiVorschlag}
                disabled={kiLoading || !mandant}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 12px', borderRadius: 7, border: '1px solid #c5d4ea',
                  background: kiLoading ? '#e8f0fb' : '#f0f7ff',
                  color: '#2e4a7d', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  opacity: kiLoading ? .7 : 1,
                }}
              >
                {kiLoading
                  ? <><span style={{ fontSize: 13 }}>⏳</span> KI denkt…</>
                  : <><span style={{ fontSize: 13 }}>🤖</span> KI-Vorschlag</>
                }
              </button>
              <button
                onClick={() => setPositionen(p => [...p, emptyPos(vorsteuerCodes[0]?.code ?? 'M81')])}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 7, border: 'none', background: 'transparent', color: '#7a9b7f', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
              >+ Position hinzufügen</button>
            </div>
          </div>

          {/* ── KI-Vorschlag Panel ── */}
          {kiVorschlag && !kiVorschlag.error && (
            <div style={{ padding: '10px 14px', background: '#f0f7ff', borderBottom: '1px solid #c5d4ea' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13 }}>🤖</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#1e3a6e' }}>
                  KI-Buchungsvorschlag
                  {kiVorschlag.quelle === 'historie' && <span style={{ marginLeft: 6, fontSize: 10.5, background: '#dcfce7', color: '#166534', padding: '1px 6px', borderRadius: 4 }}>aus Buchungshistorie</span>}
                  {kiVorschlag.quelle === 'ki'       && <span style={{ marginLeft: 6, fontSize: 10.5, background: '#dbeafe', color: '#1e40af', padding: '1px 6px', borderRadius: 4 }}>Claude AI</span>}
                </span>
                {kiVorschlag.lieferant_kategorie && (
                  <span style={{ fontSize: 11, color: '#4a6a9e', marginLeft: 4 }}>— {kiVorschlag.lieferant_kategorie}</span>
                )}
                <button onClick={() => setKiVorschlag(null)} style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: '#94a394', fontSize: 16 }}>✕</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {kiVorschlag.vorschlaege?.map((v, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#fff', borderRadius: 8, border: '1px solid #c5d4ea' }}>
                    {/* Confidence-Bar */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, gap: 2 }}>
                      <div style={{ width: 36, height: 6, borderRadius: 3, background: '#e8f0fb', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.round(v.confidence * 100)}%`, background: v.confidence > .8 ? '#22c55e' : v.confidence > .6 ? '#f59e0b' : '#94a394', borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 9.5, color: '#94a394' }}>{Math.round(v.confidence * 100)}%</span>
                    </div>
                    {/* Vorschlag-Details */}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1a1a2e' }}>
                          {v.konto_nr} {v.konto_bezeichnung}
                        </span>
                        <span style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 4, background: '#e3eaf5', color: '#2e4a7d', fontWeight: 500 }}>{v.mwst_code} ({v.mwst_satz}%)</span>
                        {v.bezeichnung && <span style={{ fontSize: 11, color: '#6b826b', fontStyle: 'italic' }}>"{v.bezeichnung}"</span>}
                      </div>
                      <div style={{ fontSize: 11, color: '#6b826b', marginTop: 2 }}>{v.begruendung}</div>
                    </div>
                    {/* Übernehmen */}
                    <button
                      onClick={() => handleKiUebernehmen(v)}
                      style={{ flexShrink: 0, padding: '5px 12px', borderRadius: 7, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                    >Übernehmen</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {kiVorschlag?.error && (
            <div style={{ padding: '8px 14px', background: '#fee2e2', borderBottom: '1px solid #fca5a5', fontSize: 12, color: '#991b1b' }}>
              ❌ KI-Fehler: {kiVorschlag.error} — Bitte Konto manuell wählen.
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...hdrTd, width: 28 }}>#</th>
                <th style={{ ...hdrTd, width: 170 }}>Aufwandskonto *</th>
                <th style={hdrTd}>Bezeichnung</th>
                <th style={{ ...hdrTd, width: 110 }}>MWST-Code</th>
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
                    <td style={cellTd}>
                      <input style={{ ...inp, padding: '4px 8px', fontSize: 12 }} value={p.bezeichnung} onChange={e => updatePos(i, 'bezeichnung', e.target.value)} />
                    </td>
                    <td style={cellTd}>
                      <select style={{ ...inp, padding: '4px 8px', fontSize: 12 }} value={p.mwst_code} onChange={e => updatePos(i, 'mwst_code', e.target.value)}>
                        {vorsteuerCodes.length > 0
                          ? vorsteuerCodes.map(c => (
                              <option key={c.code} value={c.code}>
                                {c.code} {c.satz > 0 ? `(${c.satz}%)` : '(befreit)'}
                              </option>
                            ))
                          : <>
                              <option value="M81">M81 (8.1%)</option>
                              <option value="M26">M26 (2.6%)</option>
                              <option value="M38">M38 (3.8%)</option>
                              <option value="M0">M0 (befreit)</option>
                            </>
                        }
                      </select>
                    </td>
                    <td style={cellTd}>
                      <input
                        type="number" step="0.05"
                        style={{ ...inp, padding: '4px 8px', fontSize: 12, textAlign: 'right' }}
                        value={p.betrag_netto}
                        onChange={e => updatePos(i, 'betrag_netto', e.target.value)}
                      />
                    </td>
                    <td style={{ ...cellTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#2e4a7d', fontSize: 12 }}>{CHF(p.betrag_mwst)}</td>
                    <td style={{ ...cellTd, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{CHF(p.betrag_brutto)}</td>
                    <td style={cellTd}>
                      <button
                        onClick={() => setPositionen(prev => prev.filter((_, j) => j !== i))}
                        style={{ border: 'none', background: 'none', color: '#c00', cursor: 'pointer', fontSize: 14, padding: '2px 6px' }}
                      >✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, padding: '12px 16px', borderTop: '1px solid #e4e9e4', background: '#fafcfa' }}>
            {[['Netto', totals.netto], ['MWST', totals.mwst], ['Brutto', totals.brutto]].map(([k, v]) => (
              <div key={k} style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#94a394' }}>{k}</div>
                <div style={{ fontWeight: k === 'Brutto' ? 700 : 500, fontSize: k === 'Brutto' ? 14 : 12.5, color: k === 'MWST' ? '#2e4a7d' : '#1a1a2e', marginTop: 2 }}>
                  {head.waehrung} {CHF(v)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Belegvorschau ── */}
      <div style={{ flexShrink: 0, width: 360, display: 'flex', flexDirection: 'column', background: '#f8f8f8' }}>
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', background: '#fff', borderBottom: '1px solid #e4e9e4' }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#4a5a4a' }}>Belegvorschau</span>
          {scanFile && (
            <span style={{ fontSize: 11, color: '#94a394' }}>— {scanFile.name}</span>
          )}
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
          {scanFile && scanFile.type.startsWith('image/') ? (
            <img
              src={URL.createObjectURL(scanFile)}
              alt="Beleg"
              style={{ maxWidth: '100%', borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,.12)' }}
            />
          ) : scanFile && scanFile.type === 'application/pdf' ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: '#6b826b', textAlign: 'center' }}>
              <svg style={{ width: 56, height: 56, stroke: '#7a9b7f' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
              <div style={{ fontSize: 12.5, fontWeight: 500, color: '#4a5a4a' }}>{scanFile.name}</div>
              <div style={{ fontSize: 11, color: '#94a394' }}>({(scanFile.size / 1024).toFixed(0)} KB)</div>
              {scanStatus === 'found' && (
                <div style={{ marginTop: 8, fontSize: 11.5, color: '#166534', background: '#dcfce7', padding: '8px 14px', borderRadius: 8, border: '1px solid #86efac' }}>
                  ✅ QR-Zahlschein<br/>erfolgreich gelesen
                </div>
              )}
              {scanStatus === 'idle' && (
                <div style={{ fontSize: 11, color: '#6b826b' }}>
                  Klicken Sie «QR scannen»<br/>zum Lesen des Zahlscheins
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: '#bbb' }}>
              <svg style={{ width: 48, height: 48, stroke: '#d4dcd4' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <span style={{ fontSize: 12 }}>PDF oder Bild laden für QR-Scan</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
