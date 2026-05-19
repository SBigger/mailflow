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
import { lieferantenApi, kontenApi, mwstCodesApi, kreditorenApi, kontierungsregelnApi } from '../api';
import NeuerLieferantModal from '../components/NeuerLieferantModal';
import { findKontoVorschlag, istEigeneFirma } from '../utils/kontierung';
import { supabase } from '@/api/supabaseClient';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

// ── Zeilen-Cache: überlebt React-Navigation (kein Page-Reload) ────
let _rowCache = [];
let _rowCacheMandantId = null;

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

// ── PDF-Text extrahieren (erste 3 Seiten, für Datum + Rechnungsnr) ──
async function extractPdfText(file) {
  if (file.type !== 'application/pdf') return '';
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    let text = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(it => it.str).join(' ') + '\n';
    }
    return text.trim();
  } catch { return ''; }
}

// ── Rechnungsnummer aus Text extrahieren ──────────────────────────
function extractInvoiceNr(text) {
  if (!text) return '';

  // pdfjs konkateniert Text oft ohne Leerzeichen – wir normalisieren kurz
  // (ersetzt Bindestriche/Schrägstriche NICHT – die sind Teil von Rechnungsnummern)
  const t = text.replace(/\r\n/g, '\n');

  // ── 1. Label-basierte Extraktion ──────────────────────────────────
  // Reihenfolge: spezifischste zuerst
  const labelPatterns = [
    // Deutsch
    /Rechnungs[-\s]?(?:nummer|nr\.?|#|No\.?)\s*[:\s\-#]*([A-Za-z0-9][\w\-\/\.]{1,30})/i,
    /Beleg[-\s]?(?:nummer|nr\.?)\s*[:\s\-#]*([A-Za-z0-9][\w\-\/\.]{1,30})/i,
    /Rg\.?[-\s]?Nr\.?\s*[:\s\-#]*([A-Za-z0-9][\w\-\/\.]{1,30})/i,
    /R\.?[-\s]?Nr\.?\s*[:\s\-#]*([A-Za-z0-9][\w\-\/\.]{1,30})/i,
    /Referenz(?:nummer|nr\.?)?\s*[:\s\-#]*([A-Za-z0-9][\w\-\/\.]{1,30})/i,
    /Ref\.?\s*[:\s\-#]+([A-Za-z0-9][\w\-\/\.]{2,30})/i,
    /Dok\.?(?:ument)?[-\s]?Nr\.?\s*[:\s\-#]*([A-Za-z0-9][\w\-\/\.]{1,30})/i,
    // Englisch
    /Invoice\s*(?:No\.?|Number|#|ID)\s*[:\s\-#]*([A-Za-z0-9][\w\-\/\.]{1,30})/i,
    /Inv\.?\s*(?:No\.?|#)\s*[:\s\-#]*([A-Za-z0-9][\w\-\/\.]{1,30})/i,
    /Bill\s*(?:No\.?|Number|#)\s*[:\s\-#]*([A-Za-z0-9][\w\-\/\.]{1,30})/i,
    /Order\s*(?:No\.?|Number|#)\s*[:\s\-#]*([A-Za-z0-9][\w\-\/\.]{2,30})/i,
    // Französisch
    /(?:N°|No\.?|Nº)\s*(?:de\s*)?(?:facture|commande)\s*[:\s\-#]*([A-Za-z0-9][\w\-\/\.]{1,30})/i,
    /Facture\s*(?:N°|No\.?|Nº|Nr\.?)\s*[:\s\-#]*([A-Za-z0-9][\w\-\/\.]{1,30})/i,
    // Italienisch
    /Fattura\s*(?:N\.?|Nr\.?|No\.?|Nº)\s*[:\s\-#]*([A-Za-z0-9][\w\-\/\.]{1,30})/i,
    // Generisch "Nr."
    /\bNr\.?\s+([A-Za-z0-9][\w\-\/\.]{3,30})/,
    // Nummer: / No: Muster
    /\b(?:Nummer|Number)\s*[:\s]+([A-Za-z0-9][\w\-\/\.]{2,30})/i,
  ];

  for (const p of labelPatterns) {
    const m = t.match(p);
    if (m?.[1]) {
      const val = m[1].trim().replace(/[.,;:]+$/, ''); // trailing Satzzeichen entfernen
      // Filter: kein reines Jahr, keine kurzen generischen Tokens
      if (val.length >= 2 && val.length <= 30 && !/^(20\d{2}|19\d{2})$/.test(val)) {
        return val;
      }
    }
  }

  // ── 2. Strukturierte Präfix-Muster (ohne Label) ───────────────────
  // Typische CH/DE/AT Rechnungsnummern: RE-2026-001, INV-001, KR2026-0001, F2026001 usw.
  const prefixPatterns = [
    /\b((?:RE|RG|RN|INV|KR|AR|DR|VR|DN|GS|CR|AV|FA|FR|FT|AUT|BEL|DOC|FACT|RECH|BILL)\s*[-\/]?\s*(?:20\d{2}\s*[-\/]?\s*)?\d{3,8})\b/i,
    /\b((?:20\d{2})\s*[-\/]\s*\d{3,6})\b/, // 2026-001 Format
    /\b(\d{3,6}\s*[-\/]\s*(?:20\d{2}))\b/,  // 001-2026 Format
  ];

  for (const p of prefixPatterns) {
    const m = t.match(p);
    if (m?.[1]) {
      const val = m[1].trim().replace(/\s+/g, '');
      if (val.length >= 4 && val.length <= 25) return val;
    }
  }

  return '';
}

// ── Belegdatum aus Text extrahieren ──────────────────────────────
function extractBelegdatum(text) {
  if (!text) return '';
  // Suche Datum nahe an Label-Wörtern
  const labeled = text.match(/(?:Datum|Rechnungsdatum|Invoice\s*Date|Ausstellungsdatum)[:\s]*(\d{1,2}[\.\/]\d{1,2}[\.\/]20\d{2})/i);
  const raw = labeled?.[1] || text.match(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/)?.[0];
  if (!raw) return '';
  const m = raw.match(/(\d{1,2})[\.\/](\d{1,2})[\.\/](20\d{2})/);
  if (!m) return '';
  const d = m[1].padStart(2,'0'), mo = m[2].padStart(2,'0'), y = m[3];
  // Sanity check: Monat 1-12, Tag 1-31
  if (parseInt(mo) < 1 || parseInt(mo) > 12 || parseInt(d) < 1 || parseInt(d) > 31) return '';
  return `${y}-${mo}-${d}`;
}

// ── Lieferant per Name matchen (Fallback wenn kein IBAN-Match) ───
function normLiefName(s) {
  return (s || '')
    .toLowerCase()
    // Rechtsformen entfernen
    .replace(/\b(ag|gmbh|sarl|sàrl|sa|ltd|inc|co\.?|cie\.?|kag|ohg|kg|eg|llc|bv|nv|plc|srl|spa)\b\.?/g, '')
    // Sonderzeichen → Leerzeichen
    .replace(/[^a-zäöüàáéèêëïîôùûüß0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchLieferantByName(name, lieferanten) {
  if (!name || !lieferanten?.length) return null;
  const n = normLiefName(name);
  if (!n || n.length < 3) return null;

  // 1. Exakter Match (normalisiert)
  let found = lieferanten.find(l => normLiefName(l.name) === n);
  if (found) return found;

  // 2. Einer enthält den anderen (mind. 5 Zeichen)
  if (n.length >= 5) {
    found = lieferanten.find(l => {
      const ln = normLiefName(l.name);
      return ln.length >= 5 && (n.includes(ln) || ln.includes(n));
    });
    if (found) return found;
  }

  // 3. Wort-Overlap-Score: Mehrheit der signifikanten Wörter (≥4 Zeichen) übereinstimmt
  const words = n.split(' ').filter(w => w.length >= 4);
  if (words.length >= 2) {
    let best = null, bestScore = 0;
    for (const l of lieferanten) {
      const lwords = normLiefName(l.name).split(' ').filter(w => w.length >= 4);
      if (!lwords.length) continue;
      const matches = words.filter(w => lwords.some(lw => lw.includes(w) || w.includes(lw))).length;
      const score = matches / Math.max(words.length, lwords.length);
      if (score >= 0.65 && score > bestScore) { best = l; bestScore = score; }
    }
    if (best) return best;
  }

  return null;
}

// Kurztext aus OCR/Mitteilung ableiten (max 12 Zeichen)
function deriveBelegtext(mitteilung, name, fileName) {
  const raw = (mitteilung || name || fileName || '').trim();
  // Entferne Dateiendung, Zahlen-Referenzen, Sonderzeichen
  const clean = raw
    .replace(/\.[a-z]{2,4}$/i, '')          // Dateiendung
    .replace(/\b\d{6,}\b/g, '')             // lange Zahlen (Referenzen)
    .replace(/[_\-]{2,}/g, ' ')             // mehrere Trennzeichen
    .replace(/[^\wäöüÄÖÜ\s]/g, '')         // Sonderzeichen
    .replace(/\s+/g, ' ').trim();
  // Ersten sinnvollen Teil nehmen (12 Zeichen)
  return clean.slice(0, 12).trim();
}

// ── Duplikat-Prüfung gegen bestehende Belege ─────────────────────
async function checkDuplicate(mandantId, lieferantId, belegreferenz) {
  if (!mandantId || !lieferantId || !belegreferenz || belegreferenz.trim().length < 3) return null;
  try {
    const { data } = await supabase
      .from('fibu_kreditoren_belege')
      .select('id, beleg_nr, belegdatum, betrag_brutto')
      .eq('mandant_id', mandantId)
      .eq('lieferant_id', lieferantId)
      .ilike('belegreferenz', belegreferenz.trim())
      .not('status', 'eq', 'storniert')
      .limit(1);
    return data?.[0] ?? null;
  } catch { return null; }
}

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
    buchungsdatum:    today(),    // Verbuchungsdatum, Standard = heute
    faelligkeit:      addDays(today(), 30),
    zahlungsreferenz: '',
    konto_nr:         '',
    mwst_code:        'M81',
    betrag_brutto:    '',
    belegreferenz:    '',
    gruppe:           '',
    belegtext:        deriveBelegtext('', '', file.name),
    errorMsg:         '',
    duplicate:        null,   // { id, beleg_nr, belegdatum, betrag_brutto } | null
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
    ? lieferanten.filter(l => l.name.toLowerCase().includes(query.toLowerCase()))
    : lieferanten;

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
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 50,
          background: '#fff', border: '1px solid #d4dcd4', borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.12)', minWidth: 220, maxHeight: 240,
          overflowY: 'auto',
        }}>
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
          {/* Always-visible "Neuer Lieferant" button at the bottom */}
          {!lieferanten.some(l => l.name.trim().toLowerCase() === query.trim().toLowerCase()) && (
            <button
              type="button"
              onMouseDown={() => { onCreateNew?.(query.trim()); setOpen(false); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '7px 10px', fontSize: 11.5, border: 'none',
                borderTop: filtered.length > 0 ? '1px solid #eef2ee' : 'none',
                background: '#f0f7f0',
                cursor: 'pointer', color: '#3d6641', fontWeight: 600,
              }}
            >
              {query.trim()
                ? `+ Neuer Lieferant: «${query.trim()}»`
                : '+ Neuer Lieferant anlegen'
              }
            </button>
          )}
        </div>
      )}
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
  // ── Preview panel state ──
  const [previewVisible, setPreviewVisible] = useState(true);
  const [previewWidth, setPreviewWidth]     = useState(380);
  // ── PDF zoom / page state ──
  const [pdfZoom, setPdfZoom]         = useState(1.0);
  const [pdfPageNum, setPdfPageNum]   = useState(1);
  const [pdfTotalPages, setPdfTotalPages] = useState(1);
  const pdfCanvasRef  = useRef(null);
  const pdfDocRef     = useRef(null);
  const renderTaskRef = useRef(null);
  const fileInputRef = useRef(null);
  const parseQueueRef = useRef([]);
  const parsingRef    = useRef(false);
  const lieferantenRef = useRef([]);
  const regelnRef      = useRef([]);
  const mandantRef     = useRef(null);

  // ── PDF canvas rendering ──────────────────────────────────────────
  const renderPdfPage = useCallback(async (doc, pageNum, zoom) => {
    if (!pdfCanvasRef.current) return;
    if (renderTaskRef.current) { renderTaskRef.current.cancel(); renderTaskRef.current = null; }
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: zoom });
    const canvas = pdfCanvasRef.current;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    const task = page.render({ canvasContext: ctx, viewport });
    renderTaskRef.current = task;
    try { await task.promise; } catch (e) { if (e?.name !== 'RenderingCancelledException') console.error(e); }
  }, []);

  // Load PDF doc when selected row changes
  useEffect(() => {
    const row = rows.find(r => r._id === selectedId);
    if (!row?.file) { pdfDocRef.current = null; setPdfTotalPages(1); setPdfPageNum(1); return; }
    if (row.file.type !== 'application/pdf') { pdfDocRef.current = null; return; }
    let cancelled = false;
    (async () => {
      const buf = await row.file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      if (cancelled) return;
      pdfDocRef.current = doc;
      setPdfTotalPages(doc.numPages);
      setPdfPageNum(1);
      await renderPdfPage(doc, 1, pdfZoom);
    })();
    return () => { cancelled = true; };
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render when zoom or page changes
  useEffect(() => {
    if (pdfDocRef.current) renderPdfPage(pdfDocRef.current, pdfPageNum, pdfZoom);
  }, [pdfZoom, pdfPageNum, renderPdfPage]);

  // Master-Daten laden
  useEffect(() => {
    if (!mandant?.id) return;
    // Zeilen wiederherstellen falls gleicher Mandant
    if (_rowCacheMandantId === mandant.id && _rowCache.length > 0) {
      setRows(_rowCache.filter(r => r.status !== 'saving')); // saving-Status zurücksetzen
      if (!selectedId) setSelectedId(_rowCache[0]?._id ?? null);
    }
    mandantRef.current = mandant;
    lieferantenApi.list(mandant.id).then(data => {
      setLieferanten(data);
      lieferantenRef.current = data;
    }).catch(console.error);
    kontierungsregelnApi.list(mandant.id).then(r => { regelnRef.current = r; }).catch(console.error);
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

  useEffect(() => {
    if (mandant?.id) {
      _rowCache = rows;
      _rowCacheMandantId = mandant.id;
    }
  }, [rows, mandant?.id]);

  // Sequenzielle QR-Parse-Queue
  const processQueue = useCallback(async () => {
    if (parsingRef.current) return;
    parsingRef.current = true;
    while (parseQueueRef.current.length > 0) {
      const { rowId, file } = parseQueueRef.current.shift();
      try {
        // 1. QR scannen
        const qrText = await scanQrInFile(file);
        const spc = qrText ? parseSpc(qrText) : null;

        // 2. PDF-Text extrahieren (für Datum + Rechnungsnr., parallel zum QR-Scan)
        const pdfText = await extractPdfText(file);

        // 3. Rechnungsnummer + Datum aus Text
        const invoiceNr = extractInvoiceNr(spc?.mitteilung || pdfText);
        const rawDatum  = extractBelegdatum(pdfText);

        setRows(prev => prev.map(r => {
          if (r._id !== rowId) return r;
          const datumPatch = rawDatum ? {
            belegdatum:    rawDatum,
            buchungsdatum: rawDatum,
            faelligkeit:   addDays(rawDatum, 30),
          } : {};

          if (spc) {
            // Lieferant: erst per IBAN, dann per Name
            const liefByIban = lieferantenRef.current.find(l => l.iban && l.iban.replace(/\s/g,'') === spc.iban);
            const eigen = istEigeneFirma(spc.name, mandantRef.current);
            const lief  = liefByIban ?? (!eigen ? matchLieferantByName(spc.name, lieferantenRef.current) : null);
            let konto = lief?.standard_konto_nr ?? r.konto_nr;
            let mcode = lief?.mwst_code ?? r.mwst_code;
            if (!konto) {
              const v = findKontoVorschlag([r.fileName, spc.name, spc.mitteilung], regelnRef.current);
              if (v) { konto = v.konto_nr; if (v.mwst_code) mcode = v.mwst_code; }
            }
            return {
              ...r,
              ...datumPatch,
              status:           'manual',
              lieferant_id:     lief?.id ?? '',
              lieferant_search: lief?.name ?? (eigen ? '' : spc.name),
              betrag_brutto:    spc.betrag != null ? String(spc.betrag) : r.betrag_brutto,
              zahlungsreferenz: spc.referenz ?? '',
              belegreferenz:    spc.mitteilung || invoiceNr || r.belegreferenz,
              konto_nr:         konto,
              mwst_code:        mcode,
              belegtext:        deriveBelegtext(spc.mitteilung, spc.name, r.fileName),
              qr: eigen ? null : {
                name: spc.name, iban: spc.iban,
                strasse: spc.strasse, plz: spc.plz, ort: spc.ort, land: spc.land,
              },
            };
          }
          // Kein QR: Kontovorschlag + Datum + Rechnungsnr. aus Text
          const v = findKontoVorschlag([r.fileName], regelnRef.current);
          return {
            ...r,
            ...datumPatch,
            status:       'manual',
            belegreferenz: invoiceNr || r.belegreferenz,
            konto_nr:     r.konto_nr || v?.konto_nr || '',
            mwst_code:    (!r.konto_nr && v?.mwst_code) ? v.mwst_code : r.mwst_code,
          };
        }));
        // Duplikat-Check (nach setRows, Werte aus der Row direkt verwenden)
        const finalLiefId = spc
          ? (lieferantenRef.current.find(l => l.iban && l.iban.replace(/\s/g,'') === spc.iban)?.id
             ?? matchLieferantByName(spc.name, lieferantenRef.current)?.id)
          : null;
        const finalBelegref = spc
          ? (spc.mitteilung || invoiceNr || '')
          : (invoiceNr || '');

        if (finalLiefId && finalBelegref && mandantRef.current?.id) {
          const dup = await checkDuplicate(mandantRef.current.id, finalLiefId, finalBelegref);
          if (dup) {
            setRows(prev => prev.map(r => r._id === rowId ? { ...r, duplicate: dup } : r));
          }
        }
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
            buchungsdatum:    row.buchungsdatum || row.belegdatum,
            faelligkeit:      row.faelligkeit,
            zahlungsreferenz: row.zahlungsreferenz || null,
            betrag_brutto:    brutto,
            betrag_netto:     netto,
            betrag_mwst:      mwst,
            waehrung:         'CHF',
            status:           'offen',
            belegreferenz:    row.belegreferenz || null,
            gruppe:           row.gruppe || null,
            belegtext:        row.belegtext || null,
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
        name:              form.name.trim(),
        uid:               form.uid.trim() || null,
        adresse:           form.adresse.trim() || null,
        plz:               form.plz.trim() || null,
        ort:               form.ort.trim() || null,
        land:              (form.land || 'CH').trim().toUpperCase() || 'CH',
        iban:              form.iban.replace(/\s+/g, '') || null,
        bank_name:         form.bank_name?.trim() || null,
        standard_konto_nr: form.standard_konto_nr?.trim() || '6800',
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
                    <col style={{ width: '13%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '11%' }} />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 60 }} />
                    <col style={{ width: 28 }} />
                  </colgroup>
                  <thead>
                    <tr style={{ background: '#e6ede6', color: '#6b826b', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      <th style={{ padding: '6px 4px', textAlign: 'center' }}></th>
                      <th style={{ padding: '6px 4px', textAlign: 'center' }}></th>
                      <th style={{ padding: '6px 8px', textAlign: 'left' }}>Datei</th>
                      <th style={{ padding: '6px 4px', textAlign: 'left' }}>Lieferant</th>
                      <th style={{ padding: '6px 4px', textAlign: 'left' }}>Rechnungsnr.</th>
                      <th style={{ padding: '6px 4px', textAlign: 'left' }}>Konto</th>
                      <th style={{ padding: '6px 4px', textAlign: 'left' }}>Belegdatum</th>
                      <th style={{ padding: '6px 4px', textAlign: 'left' }}>Buchungsdatum</th>
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
                          : row.duplicate
                            ? (idx % 2 === 0 ? '#fff8f0' : '#fdf5ec')
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
                            {row.duplicate && (
                              <div title={`⚠ Mögliches Duplikat: ${row.duplicate.beleg_nr} vom ${row.duplicate.belegdatum}`}
                                style={{ fontSize: 9, color: '#c05a00', fontWeight: 700, lineHeight: 1, marginTop: 2, cursor: 'default' }}>
                                DUP
                              </div>
                            )}
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

                          {/* Belegreferenz */}
                          <td style={{ padding: '2px 4px', verticalAlign: 'middle' }} onClick={e => e.stopPropagation()}>
                            {isSaved
                              ? <span style={{ fontSize: 11, color: '#4a5a4a', padding: '2px 4px' }}>{row.belegreferenz}</span>
                              : (
                                <input
                                  value={row.belegreferenz || ''}
                                  placeholder="Rechnungsnr."
                                  style={{ ...cellInp, fontSize: 10.5 }}
                                  onChange={e => updateRow(row._id, { belegreferenz: e.target.value })}
                                />
                              )
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
                                  onChange={e => {
                                    const val = e.target.value;
                                    // Buchungsdatum mitziehen wenn noch synchron
                                    const patch = { belegdatum: val };
                                    if (row.buchungsdatum === row.belegdatum) patch.buchungsdatum = val;
                                    updateRow(row._id, patch);
                                  }}
                                />
                              )
                            }
                          </td>

                          {/* Buchungsdatum */}
                          <td style={{ padding: '2px 4px', verticalAlign: 'middle' }} onClick={e => e.stopPropagation()}>
                            {isSaved
                              ? <span style={{ fontSize: 11.5, color: '#4a5a4a', padding: '2px 4px' }}>{row.buchungsdatum}</span>
                              : (
                                <input
                                  type="date"
                                  value={row.buchungsdatum}
                                  style={{ ...cellInp, fontSize: 11, borderBottom: row.buchungsdatum !== row.belegdatum ? '1px solid #7a5aaa' : undefined }}
                                  onChange={e => updateRow(row._id, { buchungsdatum: e.target.value })}
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
                            {row.duplicate && !isSaved && (
                              <span
                                title={`Mögliches Duplikat!\nBeleg ${row.duplicate.beleg_nr} · ${row.duplicate.belegdatum} · CHF ${(row.duplicate.betrag_brutto||0).toLocaleString('de-CH',{minimumFractionDigits:2,maximumFractionDigits:2})}\n\nFalls korrekt: Beleg trotzdem buchen.`}
                                style={{ display: 'block', fontSize: 10, background: '#fff3e0', color: '#c05a00', border: '1px solid #ffb74d', borderRadius: 4, padding: '1px 5px', cursor: 'help', fontWeight: 700, marginBottom: 2 }}>
                                ⚠ DUP
                              </span>
                            )}
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

        {/* ── Resize Divider + Toggle ── */}
        <div
          style={{
            width: 14, flexShrink: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', position: 'relative', background: 'transparent',
          }}
        >
          {/* Drag handle strip */}
          <div
            onMouseDown={e => {
              e.preventDefault();
              const startX = e.clientX;
              const startW = previewWidth;
              const onMove = mv => setPreviewWidth(Math.max(200, Math.min(800, startW - (mv.clientX - startX))));
              const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp);
            }}
            style={{
              position: 'absolute', top: 0, bottom: 0, left: 5, width: 4,
              cursor: 'col-resize', background: '#d4dcd4', transition: 'background 0.1s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#7a9b7f'}
            onMouseLeave={e => e.currentTarget.style.background = '#d4dcd4'}
          />
          {/* Toggle button */}
          <button
            onClick={() => setPreviewVisible(v => !v)}
            title={previewVisible ? 'Vorschau ausblenden' : 'Vorschau einblenden'}
            style={{
              marginTop: 12, zIndex: 1, background: '#f2f5f2', border: '1px solid #d4dcd4',
              borderRadius: 4, cursor: 'pointer', fontSize: 13, color: '#7a9a7f',
              lineHeight: 1, padding: '3px 2px', width: 20,
            }}
          >
            {previewVisible ? '◧' : '◨'}
          </button>
        </div>

        {/* ── Rechte Seite: PDF-Vorschau ── */}
        <div style={{
          width: previewVisible ? previewWidth : 0,
          flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: '#fff', overflow: 'hidden',
          transition: 'width 0.2s',
        }}>
          {previewVisible && (
            <>
              <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid #e8eee8', flexShrink: 0, display: 'flex', alignItems: 'center', minWidth: 0 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#7a9a7f', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    PDF Vorschau
                  </div>
                  {selectedRow && (
                    <div style={{ fontSize: 11, color: '#94a394', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedRow.fileName}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setPreviewVisible(v => !v)}
                  title="Vorschau ausblenden"
                  style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#94a394', lineHeight: 1, flexShrink: 0 }}
                >
                  ◧
                </button>
              </div>

              <div style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
                {selectedRow ? (
                  selectedRow.file?.type === 'application/pdf' ? (
                    <div style={{ flex: 1, overflow: 'auto', background: '#525659', display: 'flex', flexDirection: 'column' }}>
                      {/* Zoom + Seiten-Toolbar */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: '#3c3f41', flexShrink: 0 }}>
                        <button
                          onClick={() => setPdfPageNum(p => Math.max(1, p - 1))}
                          disabled={pdfPageNum <= 1}
                          style={{ background: 'none', border: 'none', color: pdfPageNum <= 1 ? '#666' : '#ccc', cursor: pdfPageNum <= 1 ? 'default' : 'pointer', fontSize: 14, padding: '0 4px' }}
                        >‹</button>
                        <span style={{ fontSize: 11, color: '#ccc', minWidth: 60, textAlign: 'center' }}>
                          {pdfPageNum} / {pdfTotalPages}
                        </span>
                        <button
                          onClick={() => setPdfPageNum(p => Math.min(pdfTotalPages, p + 1))}
                          disabled={pdfPageNum >= pdfTotalPages}
                          style={{ background: 'none', border: 'none', color: pdfPageNum >= pdfTotalPages ? '#666' : '#ccc', cursor: pdfPageNum >= pdfTotalPages ? 'default' : 'pointer', fontSize: 14, padding: '0 4px' }}
                        >›</button>
                        <div style={{ flex: 1 }} />
                        <button
                          onClick={() => setPdfZoom(z => Math.max(0.3, +(z - 0.25).toFixed(2)))}
                          style={{ background: '#555', border: 'none', color: '#fff', cursor: 'pointer', borderRadius: 4, padding: '2px 8px', fontSize: 13, fontWeight: 700 }}
                        >−</button>
                        <span style={{ fontSize: 11, color: '#ccc', minWidth: 42, textAlign: 'center' }}>{Math.round(pdfZoom * 100)}%</span>
                        <button
                          onClick={() => setPdfZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))}
                          style={{ background: '#555', border: 'none', color: '#fff', cursor: 'pointer', borderRadius: 4, padding: '2px 8px', fontSize: 13, fontWeight: 700 }}
                        >+</button>
                        <button
                          onClick={() => setPdfZoom(1.0)}
                          title="100% zurücksetzen"
                          style={{ background: 'none', border: '1px solid #666', color: '#aaa', cursor: 'pointer', borderRadius: 4, padding: '2px 6px', fontSize: 10, marginLeft: 4 }}
                        >⊡</button>
                      </div>
                      {/* Canvas */}
                      <div style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: 12 }}>
                        <canvas ref={pdfCanvasRef} style={{ display: 'block', boxShadow: '0 2px 12px rgba(0,0,0,0.4)', background: '#fff' }} />
                      </div>
                    </div>
                  ) : (
                    /* Bilder: img-Tag mit Zoom */
                    <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', background: '#525659', padding: 12 }}>
                      <img
                        src={selectedRow.fileUrl}
                        alt={selectedRow.fileName}
                        style={{ maxWidth: '100%', boxShadow: '0 2px 12px rgba(0,0,0,0.4)', transform: `scale(${pdfZoom})`, transformOrigin: 'top center', transition: 'transform 0.15s' }}
                      />
                    </div>
                  )
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
            </>
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
