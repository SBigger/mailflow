/**
 * MassenImport — Batch-Upload von Kreditoren-Rechnungen
 *
 * Workflow:
 *  1. Mehrere PDFs / Bilder per Drag & Drop oder Datei-Picker
 *  2. QR-Scan automatisch im Hintergrund (sequenziell)
 *  3. Grid mit Inline-Editing für alle fehlenden Felder
 *  4. Rechts: PDF-Vorschau des selektierten Rows
 *  5. „Alle buchen" → kreditorenApi.create für jeden fertigen Row
 */
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { useMandant } from '../contexts/MandantContext';
import { lieferantenApi, kontenApi, mwstCodesApi, kreditorenApi } from '../api';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

// ── Swiss SPC QR-Rechnung Parser ──────────────────────────────────
function parseSpc(text) {
  if (!text || !text.startsWith('SPC')) return null;
  const lines = text.split(/\r?\n/).map(l => l.trim());
  if (lines[0] !== 'SPC') return null;
  const addrType = lines[4] ?? 'S';
  let plz = '', ort = '', strasse = '';
  if (addrType === 'S') {
    strasse = [lines[6], lines[7]].filter(Boolean).join(' ').trim();
    plz = lines[8] ?? ''; ort = lines[9] ?? '';
  } else {
    strasse = (lines[6] ?? '').trim();
    const m = (lines[7] ?? '').match(/^(\d{4,5})\s+(.+)/);
    if (m) { plz = m[1]; ort = m[2]; }
  }
  return {
    iban:       (lines[3] ?? '').replace(/\s+/g, ''),
    name:       lines[5] ?? '',
    strasse, plz, ort,
    land:       (lines[10] ?? '').trim() || 'CH',
    betrag:     lines[18] ? parseFloat(lines[18]) || null : null,
    referenz:   (lines[28] ?? '').replace(/\s+/g, ''),
    mitteilung: lines[29] ?? '',
  };
}

// ── QR-Code aus PDF oder Bild lesen ───────────────────────────────
async function scanQrInFile(file) {
  const jsQR = (await import('jsqr')).default;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (file.type === 'application/pdf') {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    for (let p = pdf.numPages; p >= 1; p--) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 3.0 });
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const res = jsQR(imgData.data, imgData.width, imgData.height);
      if (res?.data) return res.data;
    }
    return null;
  } else {
    await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { canvas.width = img.width; canvas.height = img.height; ctx.drawImage(img, 0, 0); resolve(); };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(imgData.data, imgData.width, imgData.height)?.data ?? null;
  }
}

function addDays(d, n) {
  if (!d) return '';
  const dt = new Date(d); dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
}
const today = () => new Date().toISOString().slice(0, 10);
const CHF = n => (parseFloat(n) || 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function makeRow(file) {
  return {
    _id:              Math.random().toString(36).slice(2),
    file,
    fileUrl:          URL.createObjectURL(file),
    fileName:         file.name,
    status:           'parsing',  // parsing | manual | ready | saving | saved | error
    lieferant_id:     '',
    lieferant_search: '',
    belegdatum:       today(),
    faelligkeit:      addDays(today(), 30),
    zahlungsreferenz: '',
    konto_nr:         '',
    mwst_code:        'M81',
    betrag_brutto:    '',
    errorMsg:         '',
  };
}

// Welche Pflichtfelder fehlen noch, damit der Beleg gebucht werden kann?
function missingFields(row) {
  const m = [];
  if (!row.lieferant_id)                     m.push('Lieferant');
  if (!row.belegdatum)                       m.push('Belegdatum');
  if (!row.faelligkeit)                      m.push('Fälligkeit');
  if (!(parseFloat(row.betrag_brutto) > 0))  m.push('Betrag');
  if (!row.konto_nr)                         m.push('Konto');
  if (!row.mwst_code)                        m.push('MWST-Code');
  return m;
}

function isComplete(row) {
  return (
    missingFields(row).length === 0 &&
    row.status !== 'saving' &&
    row.status !== 'saved'
  );
}

// ── Status-Badge ──────────────────────────────────────────────────
function StatusIcon({ row }) {
  if (row.status === 'parsing') {
    return (
      <svg className="animate-spin" style={{ width: 14, height: 14, color: '#7a9b7f' }} viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>
    );
  }
  if (row.status === 'saved') {
    return <span style={{ fontSize: 14, color: '#3d6641' }}>✓</span>;
  }
  if (row.status === 'error') {
    return <span style={{ fontSize: 14, color: '#b94a3a' }} title={row.errorMsg}>✗</span>;
  }
  if (row.status === 'saving') {
    return (
      <svg className="animate-spin" style={{ width: 14, height: 14, color: '#5a7aaa' }} viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>
    );
  }
  if (isComplete(row)) {
    return <span style={{ fontSize: 14, color: '#5a7aaa' }} title="Bereit zum Buchen">◉</span>;
  }
  const fehlt = missingFields(row);
  return (
    <span style={{ fontSize: 14, color: '#c4893a' }}
      title={fehlt.length ? 'Fehlt noch: ' + fehlt.join(', ') : 'Unvollständig'}>◎</span>
  );
}

// ── Inline-Cell Styles ────────────────────────────────────────────
const cellInp = {
  width: '100%', background: 'transparent', border: 'none',
  borderBottom: '1px solid transparent', borderRadius: 0,
  padding: '2px 4px', fontSize: 11.5, color: '#1a1a2e',
  outline: 'none', boxSizing: 'border-box',
};
const cellInpFocus = {
  ...cellInp,
  borderBottom: '1px solid #7a9b7f',
  background: '#f0f5f0',
  borderRadius: 3,
};

// ── Lieferant-Combobox in Grid-Zeile ─────────────────────────────
function LiefCell({ row, lieferanten, onChange, onCreateNew }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(row.lieferant_search || '');
  const wrapRef = useRef(null);

  const filtered = query.length >= 1
    ? lieferanten.filter(l => l.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : lieferanten.slice(0, 8);

  useEffect(() => {
    setQuery(row.lieferant_search || '');
  }, [row.lieferant_search]);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <input
        value={query}
        placeholder="— wählen —"
        disabled={row.status === 'saved' || row.status === 'saving'}
        style={cellInp}
        onFocus={() => setOpen(true)}
        onChange={e => {
          setQuery(e.target.value);
          setOpen(true);
          // Clear selection if text changes
          if (row.lieferant_id && e.target.value !== row.lieferant_search) {
            onChange({ lieferant_id: '', lieferant_search: e.target.value });
          } else {
            onChange({ lieferant_search: e.target.value });
          }
        }}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150);
        }}
      />
      {open && (filtered.length > 0 || query.trim().length >= 2) && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 50,
          background: '#fff', border: '1px solid #d4dcd4', borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.12)', minWidth: 220, maxHeight: 240,
          overflowY: 'auto',
        }}>
          {query.trim().length >= 2
            && !lieferanten.some(l => l.name.trim().toLowerCase() === query.trim().toLowerCase())
            && (
            <button
              type="button"
              onMouseDown={() => { onCreateNew?.(query.trim()); setOpen(false); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '7px 10px', fontSize: 11.5, border: 'none',
                borderBottom: '1px solid #eef2ee', background: '#f0f7f0',
                cursor: 'pointer', color: '#3d6641', fontWeight: 600,
              }}
            >+ Neuer Lieferant: «{query.trim()}»</button>
          )}
          {filtered.map(l => (
            <button
              key={l.id}
              type="button"
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '6px 10px', fontSize: 11.5, border: 'none',
                background: 'none', cursor: 'pointer', color: '#1a1a2e',
              }}
              onMouseOver={e => e.currentTarget.style.background = '#f0f5f0'}
              onMouseOut={e => e.currentTarget.style.background = 'none'}
              onMouseDown={() => {
                onChange({
                  lieferant_id: l.id,
                  lieferant_search: l.name,
                  konto_nr: l.standard_konto_nr || row.konto_nr,
                  mwst_code: l.mwst_code || row.mwst_code,
                });
                setQuery(l.name);
                setOpen(false);
              }}
            >
              <span style={{ fontWeight: 500 }}>{l.name}</span>
              {l.nr && <span style={{ color: '#94a394', marginLeft: 6, fontSize: 10.5 }}>#{l.nr}</span>}
            </button>
          ))}
        </div>
      )}
      {!row.lieferant_id && query.trim().length >= 1 && (
        <button
          type="button"
          onClick={() => onCreateNew?.(query.trim())}
          style={{ fontSize: 9, color: '#c4893a', padding: '1px 4px', border: 'none',
            background: 'none', cursor: 'pointer', textAlign: 'left' }}
        >⚠ nicht zugeordnet · anlegen</button>
      )}
    </div>
  );
}

// ── Modal: neuen Lieferant erfassen ───────────────────────────────
function NeuerLieferantModal({ init, onSave, onClose, saving }) {
  const [f, setF] = useState({
    name:      init?.name || '',
    uid:       init?.uid || '',
    adresse:   init?.strasse || '',
    plz:       init?.plz || '',
    ort:       init?.ort || '',
    land:      init?.land || 'CH',
    iban:      init?.iban || '',
    bank_name: init?.bank_name || '',
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const canSave = f.name.trim().length > 0 && !saving;

  const lbl = { fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 3, display: 'block' };
  const inp = { background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, color: '#1a1a2e', outline: 'none', width: '100%', boxSizing: 'border-box' };

  return (
    <div onClick={() => !saving && onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(26,26,46,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 14, width: 480, maxWidth: '96vw', boxShadow: '0 16px 48px rgba(0,0,0,.25)' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e4e9e4', fontWeight: 700, fontSize: 14 }}>
          Neuen Lieferant erfassen
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={lbl}>Name *</label>
            <input style={inp} value={f.name} autoFocus onChange={e => set('name', e.target.value)} placeholder="Firmenname" />
          </div>
          {/* Adresse */}
          <div style={{ background: '#f7faf7', border: '1px solid #e4e9e4', borderRadius: 9, padding: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#94a394', marginBottom: 8 }}>Adresse</div>
            <div style={{ marginBottom: 8 }}>
              <label style={lbl}>Strasse / Nr.</label>
              <input style={inp} value={f.adresse} onChange={e => set('adresse', e.target.value)} placeholder="z.B. Bahnhofstrasse 1" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ width: 90 }}>
                <label style={lbl}>PLZ</label>
                <input style={inp} value={f.plz} onChange={e => set('plz', e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Ort</label>
                <input style={inp} value={f.ort} onChange={e => set('ort', e.target.value)} />
              </div>
              <div style={{ width: 64 }}>
                <label style={lbl}>Land</label>
                <input style={inp} value={f.land} onChange={e => set('land', e.target.value.toUpperCase().slice(0, 2))} />
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>IBAN</label>
              <input style={{ ...inp, fontFamily: 'monospace', fontSize: 11.5 }} value={f.iban} onChange={e => set('iban', e.target.value)} placeholder="CH.." />
            </div>
            <div style={{ width: 130 }}>
              <label style={lbl}>UID</label>
              <input style={inp} value={f.uid} onChange={e => set('uid', e.target.value)} placeholder="CHE-..." />
            </div>
          </div>
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #e4e9e4', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} disabled={saving}
            style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>Abbrechen</button>
          <button onClick={() => canSave && onSave(f)} disabled={!canSave}
            style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: canSave ? '#7a9b7f' : '#c5cdc5', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: canSave ? 'pointer' : 'not-allowed' }}>
            {saving ? 'Speichert…' : 'Lieferant anlegen'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Hauptkomponente ───────────────────────────────────────────────
export default function MassenImport() {
  const { mandant } = useMandant();
  const [rows, setRows]             = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [lieferanten, setLieferanten] = useState([]);
  const [konten, setKonten]           = useState([]);
  const [mwstCodes, setMwstCodes]     = useState([]);
  const [mwstMap, setMwstMap]         = useState({});
  const [saving, setSaving]           = useState(false);
  const [nrCounter, setNrCounter]     = useState(0);
  const [dragOver, setDragOver]       = useState(false);
  const [liefModal, setLiefModal]     = useState(null);   // { init, targetName }
  const [liefSaving, setLiefSaving]   = useState(false);
  const fileInputRef = useRef(null);
  const parseQueueRef = useRef([]);
  const parsingRef    = useRef(false);
  const lieferantenRef = useRef([]);

  // Master-Daten laden
  useEffect(() => {
    if (!mandant?.id) return;
    lieferantenApi.list(mandant.id).then(data => {
      setLieferanten(data);
      lieferantenRef.current = data;
    }).catch(console.error);
    kontenApi.list(mandant.id).then(setKonten).catch(console.error);
    mwstCodesApi.listAktiv(mandant.id).then(codes => {
      setMwstCodes(codes);
      const m = {}; codes.forEach(c => { m[c.code] = c.satz; });
      setMwstMap(m);
    }).catch(console.error);
    kreditorenApi.nextBelegNr(mandant.id).then(nr => {
      const n = parseInt(nr.split('-')[2] ?? '0', 10);
      setNrCounter(n);
    }).catch(console.error);
  }, [mandant?.id]);

  // Sequenzielle QR-Parse-Queue
  const processQueue = useCallback(async () => {
    if (parsingRef.current) return;
    parsingRef.current = true;
    while (parseQueueRef.current.length > 0) {
      const { rowId, file } = parseQueueRef.current.shift();
      try {
        const qrText = await scanQrInFile(file);
        const spc = qrText ? parseSpc(qrText) : null;
        setRows(prev => prev.map(r => {
          if (r._id !== rowId) return r;
          if (spc) {
            const lief = lieferantenRef.current.find(l => l.iban && l.iban.replace(/\s/g,'') === spc.iban);
            return {
              ...r,
              status:           'manual',
              lieferant_id:     lief?.id ?? '',
              lieferant_search: lief?.name ?? spc.name,
              betrag_brutto:    spc.betrag != null ? String(spc.betrag) : r.betrag_brutto,
              zahlungsreferenz: spc.referenz ?? '',
              konto_nr:         lief?.standard_konto_nr ?? r.konto_nr,
              mwst_code:        lief?.mwst_code ?? r.mwst_code,
              // QR-Kreditordaten für die Schnellerfassung eines Lieferanten
              qr: {
                name:    spc.name, iban: spc.iban,
                strasse: spc.strasse, plz: spc.plz, ort: spc.ort, land: spc.land,
              },
            };
          }
          return { ...r, status: 'manual' };
        }));
      } catch {
        setRows(prev => prev.map(r => r._id === rowId ? { ...r, status: 'manual' } : r));
      }
    }
    parsingRef.current = false;
  }, []);

  const addFiles = useCallback((files) => {
    const valid = Array.from(files).filter(f =>
      f.type === 'application/pdf' || f.type.startsWith('image/')
    );
    if (!valid.length) return;
    const newRows = valid.map(makeRow);
    setRows(prev => {
      const updated = [...prev, ...newRows];
      return updated;
    });
    setSelectedId(prev => prev ?? newRows[0]._id);
    newRows.forEach(r => parseQueueRef.current.push({ rowId: r._id, file: r.file }));
    processQueue();
  }, [processQueue]);

  const onDrop = useCallback(e => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const updateRow = useCallback((id, patch) => {
    setRows(prev => prev.map(r => r._id === id ? { ...r, ...patch } : r));
  }, []);

  const removeRow = useCallback((id) => {
    setRows(prev => {
      const rest = prev.filter(r => r._id !== id);
      if (selectedId === id) setSelectedId(rest[0]?._id ?? null);
      return rest;
    });
  }, [selectedId]);

  // Alle fertigen Rows buchen
  const bookAll = async () => {
    const ready = rows.filter(isComplete);
    if (!ready.length || saving) return;
    setSaving(true);
    let counter = nrCounter;
    const year = new Date().getFullYear();

    for (const row of ready) {
      updateRow(row._id, { status: 'saving' });
      try {
        counter++;
        const belegNr = `KR-${year}-${String(counter).padStart(4, '0')}`;
        const satz   = mwstMap[row.mwst_code] ?? 0;
        const brutto = parseFloat(row.betrag_brutto) || 0;
        const netto  = satz > 0 ? Math.round(brutto / (1 + satz / 100) * 100) / 100 : brutto;
        const mwst   = Math.round((brutto - netto) * 100) / 100;

        await kreditorenApi.create(
          mandant.id,
          {
            lieferant_id:     row.lieferant_id || null,
            beleg_nr:         belegNr,
            belegdatum:       row.belegdatum,
            faelligkeit:      row.faelligkeit,
            zahlungsreferenz: row.zahlungsreferenz || null,
            betrag_brutto:    brutto,
            betrag_netto:     netto,
            betrag_mwst:      mwst,
            waehrung:         'CHF',
            status:           'offen',
          },
          [{
            konto_nr:      row.konto_nr,
            bezeichnung:   row.fileName.replace(/\.[^.]+$/, '').slice(0, 80),
            mwst_code:     row.mwst_code,
            mwst_satz:     satz,
            betrag_brutto: brutto,
            betrag_netto:  netto,
            betrag_mwst:   mwst,
          }]
        );
        updateRow(row._id, { status: 'saved' });
      } catch (e) {
        updateRow(row._id, { status: 'error', errorMsg: e.message });
      }
    }
    setNrCounter(counter);
    setSaving(false);
  };

  const selectedRow  = rows.find(r => r._id === selectedId);
  const readyCount   = rows.filter(isComplete).length;
  const savedCount   = rows.filter(r => r.status === 'saved').length;
  const aufwandKonten = konten.filter(k => k.konto_typ === 'aufwand');

  // ── Noch nicht erfasste Lieferanten (eindeutige Namen) ──────────
  const offeneLieferanten = useMemo(() => {
    const map = new Map();
    rows.forEach(r => {
      if (r.lieferant_id) return;
      if (['saved', 'saving', 'parsing'].includes(r.status)) return;
      const nm = (r.lieferant_search || r.qr?.name || '').trim();
      if (!nm) return;
      const key = nm.toLowerCase();
      if (!map.has(key)) map.set(key, { name: nm, row: r, count: 0 });
      map.get(key).count++;
    });
    return [...map.values()];
  }, [rows]);

  // Schnellerfassung eines Lieferanten öffnen (mit QR-Adressdaten)
  const openLiefModal = (row, name) => {
    const qr = row?.qr || {};
    setLiefModal({
      init: { name: name || qr.name || '', strasse: qr.strasse || '',
              plz: qr.plz || '', ort: qr.ort || '', land: qr.land || 'CH',
              iban: qr.iban || '' },
      targetName: (name || qr.name || '').trim().toLowerCase(),
    });
  };

  // Lieferant anlegen und allen passenden Belegen zuordnen
  const handleSaveLieferant = async (form) => {
    if (!mandant) return;
    setLiefSaving(true);
    try {
      const nr = await lieferantenApi.nextNr(mandant.id);
      const neu = await lieferantenApi.create(mandant.id, {
        nr,
        name:      form.name.trim(),
        uid:       form.uid.trim() || null,
        adresse:   form.adresse.trim() || null,
        plz:       form.plz.trim() || null,
        ort:       form.ort.trim() || null,
        land:      (form.land || 'CH').trim().toUpperCase() || 'CH',
        iban:      form.iban.replace(/\s+/g, '') || null,
        bank_name: form.bank_name?.trim() || null,
      });
      const updated = [...lieferantenRef.current, neu].sort((a, b) => a.name.localeCompare(b.name));
      lieferantenRef.current = updated;
      setLieferanten(updated);

      const tgt = liefModal?.targetName;
      setRows(prev => prev.map(r => {
        if (r.lieferant_id) return r;
        const nm = (r.lieferant_search || r.qr?.name || '').trim().toLowerCase();
        if (nm !== tgt) return r;
        return {
          ...r,
          lieferant_id:     neu.id,
          lieferant_search: neu.name,
          konto_nr:         r.konto_nr || neu.standard_konto_nr || '',
          mwst_code:        neu.mwst_code || r.mwst_code,
        };
      }));
      setLiefModal(null);
    } catch (e) {
      alert('Lieferant konnte nicht angelegt werden: ' + e.message);
    } finally { setLiefSaving(false); }
  };

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#f2f5f2' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '14px 20px 12px', background: '#fff', borderBottom: '1px solid #d4dcd4', gap: 12, flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>Massen-Import</div>
          <div style={{ fontSize: 11.5, color: '#7a9a7f', marginTop: 1 }}>
            Kreditoren-Rechnungen hochladen, prüfen und buchen
          </div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {savedCount > 0 && (
            <span style={{ fontSize: 11.5, color: '#3d6641', background: '#e8f5e8', padding: '4px 10px', borderRadius: 12 }}>
              ✓ {savedCount} gebucht
            </span>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 500,
              background: '#e6ede6', border: '1px solid #bfcfbf', color: '#4a5a4a', cursor: 'pointer',
            }}
          >
            + Dateien hinzufügen
          </button>
          <button
            onClick={bookAll}
            disabled={readyCount === 0 || saving}
            style={{
              padding: '7px 18px', borderRadius: 7, fontSize: 12.5, fontWeight: 600,
              background: readyCount > 0 && !saving ? '#3d6641' : '#a0b8a0',
              border: 'none', color: '#fff', cursor: readyCount > 0 && !saving ? 'pointer' : 'default',
              transition: 'background 0.15s',
            }}
          >
            {saving ? 'Wird gebucht…' : `${readyCount} Beleg${readyCount !== 1 ? 'e' : ''} buchen`}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {/* Banner: noch nicht erfasste Lieferanten zuerst anlegen */}
      {offeneLieferanten.length > 0 && (
        <div style={{ flexShrink: 0, padding: '9px 20px', background: '#fdf6ec', borderBottom: '1px solid #f0e0c4', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#8a5a00' }}>
            ⚠ {offeneLieferanten.length} Lieferant{offeneLieferanten.length !== 1 ? 'en' : ''} noch nicht erfasst – zuerst anlegen, dann können die Belege gebucht werden:
          </span>
          {offeneLieferanten.map(o => (
            <button key={o.name}
              onClick={() => openLiefModal(o.row, o.name)}
              style={{ padding: '3px 10px', borderRadius: 12, border: '1px solid #e0c98a', background: '#fff', color: '#8a5a00', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
              + {o.name}{o.count > 1 ? ` (${o.count})` : ''}
            </button>
          ))}
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Linke Seite: Drop-Zone + Grid ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid #d4dcd4' }}>

          {/* Drop-Zone (immer sichtbar oben, kompakt wenn Rows vorhanden) */}
          {rows.length === 0 ? (
            <div
              onDrop={onDrop}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 12, cursor: 'pointer',
                border: `2px dashed ${dragOver ? '#7a9b7f' : '#bfcfbf'}`,
                borderRadius: 12, margin: 20,
                background: dragOver ? '#eef4ee' : '#fff',
                transition: 'all 0.15s',
              }}
            >
              <svg style={{ width: 48, height: 48, color: '#bfcfbf' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#4a5a4a' }}>PDFs hier ablegen</div>
                <div style={{ fontSize: 12, color: '#94a394', marginTop: 4 }}>
                  oder klicken zum Auswählen — mehrere Dateien gleichzeitig möglich
                </div>
                <div style={{ fontSize: 11, color: '#bfcfbf', marginTop: 6 }}>
                  PDF, JPG, PNG — Swiss QR-Zahlschein wird automatisch erkannt
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Compact Drop-Bar */}
              <div
                onDrop={onDrop}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
                  background: dragOver ? '#eef4ee' : '#f7faf7',
                  border: `1px dashed ${dragOver ? '#7a9b7f' : '#bfcfbf'}`,
                  borderRadius: 6, margin: '10px 12px 0', cursor: 'pointer',
                  fontSize: 11.5, color: '#7a9a7f', flexShrink: 0,
                }}
              >
                <svg style={{ width: 14, height: 14 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                Weitere PDFs hier ablegen oder klicken
              </div>

              {/* Grid */}
              <div style={{ flex: 1, overflow: 'auto', padding: '10px 12px 12px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: 28 }} />
                    <col style={{ width: 30 }} />
                    <col style={{ width: '18%' }} />
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '14%' }} />
                    <col style={{ width: 100 }} />
                    <col style={{ width: 100 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 28 }} />
                  </colgroup>
                  <thead>
                    <tr style={{ background: '#e6ede6', color: '#6b826b', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      <th style={{ padding: '6px 4px', textAlign: 'center' }}></th>
                      <th style={{ padding: '6px 4px', textAlign: 'center' }}></th>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>Datei</th>
                      <th style={{ padding: '6px 4px', textAlign: 'left' }}>Lieferant</th>
                      <th style={{ padding: '6px 4px', textAlign: 'left' }}>Konto</th>
                      <th style={{ padding: '6px 4px', textAlign: 'left' }}>Datum</th>
                      <th style={{ padding: '6px 4px', textAlign: 'left' }}>Fälligkeit</th>
                      <th style={{ padding: '6px 4px', textAlign: 'right' }}>Brutto CHF</th>
                      <th style={{ padding: '6px 4px', textAlign: 'left' }}>MWST</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => {
                      const isSelected = row._id === selectedId;
                      const complete   = isComplete(row);
                      const isSaved    = row.status === 'saved';
                      const rowBg      = isSaved
                        ? '#f0f8f0'
                        : isSelected
                          ? '#edf5f0'
                          : idx % 2 === 0 ? '#fff' : '#fafcfa';

                      return (
                        <tr
                          key={row._id}
                          onClick={() => setSelectedId(row._id)}
                          style={{
                            background: rowBg,
                            cursor: 'pointer',
                            borderBottom: '1px solid #e8eee8',
                            outline: isSelected ? '2px solid #7a9b7f' : 'none',
                            outlineOffset: -1,
                          }}
                        >
                          {/* Status */}
                          <td style={{ padding: '4px 4px', textAlign: 'center', verticalAlign: 'middle' }}>
                            <StatusIcon row={row} />
                          </td>

                          {/* Zeilen-Nr */}
                          <td style={{ padding: '4px 4px', textAlign: 'center', color: '#94a394', fontSize: 10.5, verticalAlign: 'middle' }}>
                            {idx + 1}
                          </td>

                          {/* Dateiname */}
                          <td style={{ padding: '4px 8px', verticalAlign: 'middle' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <svg style={{ width: 11, height: 11, flexShrink: 0, color: '#7a9b7f' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                              </svg>
                              <span style={{ fontSize: 11, color: '#4a5a4a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                title={row.fileName}>
                                {row.fileName.replace(/\.[^.]+$/, '')}
                              </span>
                            </div>
                          </td>

                          {/* Lieferant */}
                          <td style={{ padding: '2px 4px', verticalAlign: 'middle' }} onClick={e => e.stopPropagation()}>
                            {isSaved
                              ? <span style={{ fontSize: 11.5, color: '#4a5a4a', padding: '2px 4px' }}>{row.lieferant_search}</span>
                              : <LiefCell row={row} lieferanten={lieferanten}
                                  onChange={patch => updateRow(row._id, patch)}
                                  onCreateNew={name => openLiefModal(row, name)} />
                            }
                          </td>

                          {/* Konto */}
                          <td style={{ padding: '2px 4px', verticalAlign: 'middle' }} onClick={e => e.stopPropagation()}>
                            {isSaved
                              ? <span style={{ fontSize: 11.5, color: '#4a5a4a', padding: '2px 4px' }}>{row.konto_nr}</span>
                              : (
                                <select
                                  value={row.konto_nr}
                                  style={{ ...cellInp, fontSize: 11 }}
                                  onChange={e => updateRow(row._id, { konto_nr: e.target.value })}
                                >
                                  <option value="">— Konto —</option>
                                  {aufwandKonten.map(k => (
                                    <option key={k.konto_nr} value={k.konto_nr}>
                                      {k.konto_nr} {k.bezeichnung}
                                    </option>
                                  ))}
                                </select>
                              )
                            }
                          </td>

                          {/* Belegdatum */}
                          <td style={{ padding: '2px 4px', verticalAlign: 'middle' }} onClick={e => e.stopPropagation()}>
                            {isSaved
                              ? <span style={{ fontSize: 11.5, color: '#4a5a4a', padding: '2px 4px' }}>{row.belegdatum}</span>
                              : (
                                <input
                                  type="date"
                                  value={row.belegdatum}
                                  style={{ ...cellInp, fontSize: 11 }}
                                  onChange={e => updateRow(row._id, { belegdatum: e.target.value })}
                                />
                              )
                            }
                          </td>

                          {/* Fälligkeit */}
                          <td style={{ padding: '2px 4px', verticalAlign: 'middle' }} onClick={e => e.stopPropagation()}>
                            {isSaved
                              ? <span style={{ fontSize: 11.5, color: '#4a5a4a', padding: '2px 4px' }}>{row.faelligkeit}</span>
                              : (
                                <input
                                  type="date"
                                  value={row.faelligkeit}
                                  style={{ ...cellInp, fontSize: 11 }}
                                  onChange={e => updateRow(row._id, { faelligkeit: e.target.value })}
                                />
                              )
                            }
                          </td>

                          {/* Brutto */}
                          <td style={{ padding: '2px 4px', verticalAlign: 'middle' }} onClick={e => e.stopPropagation()}>
                            {isSaved
                              ? <span style={{ fontSize: 11.5, color: '#3d6641', padding: '2px 4px', display: 'block', textAlign: 'right' }}>
                                  {CHF(row.betrag_brutto)}
                                </span>
                              : (
                                <input
                                  type="number"
                                  step="0.05"
                                  min="0"
                                  placeholder="0.00"
                                  value={row.betrag_brutto}
                                  style={{ ...cellInp, textAlign: 'right', background: parseFloat(row.betrag_brutto) > 0 ? '#f0f8f2' : 'transparent', fontSize: 11.5, fontWeight: 600, color: '#3d6641' }}
                                  onChange={e => updateRow(row._id, { betrag_brutto: e.target.value })}
                                />
                              )
                            }
                          </td>

                          {/* MWST-Code */}
                          <td style={{ padding: '2px 4px', verticalAlign: 'middle' }} onClick={e => e.stopPropagation()}>
                            {isSaved
                              ? <span style={{ fontSize: 11, color: '#5a7aaa', padding: '2px 4px' }}>{row.mwst_code}</span>
                              : (
                                <select
                                  value={row.mwst_code}
                                  style={{ ...cellInp, fontSize: 11 }}
                                  onChange={e => updateRow(row._id, { mwst_code: e.target.value })}
                                >
                                  {mwstCodes.map(c => (
                                    <option key={c.code} value={c.code}>
                                      {c.code} {c.satz > 0 ? `${c.satz}%` : ''}
                                    </option>
                                  ))}
                                </select>
                              )
                            }
                          </td>

                          {/* Entfernen */}
                          <td style={{ padding: '2px 4px', textAlign: 'center', verticalAlign: 'middle' }}>
                            {!isSaved && (
                              <button
                                type="button"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c4893a', fontSize: 14, padding: 0, lineHeight: 1 }}
                                onClick={e => { e.stopPropagation(); removeRow(row._id); }}
                                title="Entfernen"
                              >✕</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Legende */}
                {rows.length > 0 && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 16, fontSize: 10.5, color: '#94a394' }}>
                    <span>◎ fehlende Felder</span>
                    <span>◉ bereit zum Buchen</span>
                    <span>✓ gebucht</span>
                    <span style={{ marginLeft: 'auto' }}>
                      {rows.filter(r => r.status !== 'parsing').length} / {rows.length} analysiert
                      {readyCount > 0 && ` · ${readyCount} bereit`}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── Rechte Seite: PDF-Vorschau ── */}
        <div style={{ width: 380, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid #e8eee8', flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#7a9a7f', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              PDF Vorschau
            </div>
            {selectedRow && (
              <div style={{ fontSize: 11, color: '#94a394', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedRow.fileName}
              </div>
            )}
          </div>

          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            {selectedRow ? (
              <iframe
                key={selectedRow._id}
                src={selectedRow.fileUrl}
                title={selectedRow.fileName}
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
              />
            ) : (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <svg style={{ width: 40, height: 40, color: '#d4dcd4' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="9" y1="13" x2="15" y2="13"/>
                  <line x1="9" y1="17" x2="13" y2="17"/>
                </svg>
                <span style={{ fontSize: 12, color: '#bfcfbf' }}>Zeile anklicken für Vorschau</span>
              </div>
            )}
          </div>

          {/* Quick-Edit Panel für selektierten Row */}
          {selectedRow && selectedRow.status !== 'saved' && (
            <div style={{ borderTop: '1px solid #e8eee8', padding: '10px 14px', flexShrink: 0, background: '#fafcfa' }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: '#7a9a7f', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Zahlungsreferenz
              </div>
              <input
                type="text"
                placeholder="QR-Referenz / Mitteilung (optional)"
                value={selectedRow.zahlungsreferenz}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: '#f7faf7', border: '1px solid #d4dcd4',
                  borderRadius: 6, padding: '5px 8px', fontSize: 11.5, color: '#1a1a2e', outline: 'none',
                }}
                onChange={e => updateRow(selectedRow._id, { zahlungsreferenz: e.target.value })}
              />

              {/* MWST-Vorschau */}
              {parseFloat(selectedRow.betrag_brutto) > 0 && (
                <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                  {[
                    { label: 'Netto', val: (() => { const b = parseFloat(selectedRow.betrag_brutto)||0; const s = mwstMap[selectedRow.mwst_code]??0; return s > 0 ? Math.round(b/(1+s/100)*100)/100 : b; })() },
                    { label: 'MWST',  val: (() => { const b = parseFloat(selectedRow.betrag_brutto)||0; const s = mwstMap[selectedRow.mwst_code]??0; if (!s) return 0; const n = Math.round(b/(1+s/100)*100)/100; return Math.round((b-n)*100)/100; })() },
                    { label: 'Brutto', val: parseFloat(selectedRow.betrag_brutto)||0 },
                  ].map(({ label, val }) => (
                    <div key={label} style={{ background: '#fff', border: '1px solid #e8eee8', borderRadius: 5, padding: '5px 6px', textAlign: 'center' }}>
                      <div style={{ fontSize: 9.5, color: '#94a394', marginBottom: 2 }}>{label}</div>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: label === 'Brutto' ? '#3d6641' : '#1a1a2e' }}>{CHF(val)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {liefModal && (
        <NeuerLieferantModal
          init={liefModal.init}
          saving={liefSaving}
          onSave={handleSaveLieferant}
          onClose={() => setLiefModal(null)}
        />
      )}
    </div>
  );
}
