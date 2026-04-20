import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fillPdfBytes, fetchPdfBytes } from '@/lib/pdfFill';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href;

const C = { accent: '#5b8a5b', panelBdr: '#ccd8cc', muted: '#9ca3af', heading: '#1a3a1a', pageBg: '#f2f5f2' };

// ── Einzelne PDF-Seite (mit ResizeObserver für automatische Skalierung) ──────
function PdfPage({ page }) {
  const wrapperRef = useRef(null);
  const canvasRef  = useRef(null);
  const taskRef    = useRef(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas  = canvasRef.current;
    if (!wrapper || !canvas) return;

    function renderAt(availW) {
      taskRef.current?.cancel();
      const vp0   = page.getViewport({ scale: 1 });
      const scale = Math.max(0.3, availW / vp0.width);
      const vp    = page.getViewport({ scale });
      canvas.width  = vp.width;
      canvas.height = vp.height;
      const ctx = canvas.getContext('2d');
      taskRef.current = page.render({ canvasContext: ctx, viewport: vp });
    }

    const ro = new ResizeObserver(entries => {
      renderAt(entries[0].contentRect.width || wrapper.clientWidth);
    });
    ro.observe(wrapper);
    renderAt(wrapper.clientWidth);
    return () => { ro.disconnect(); taskRef.current?.cancel(); };
  }, [page]);

  return (
    <div ref={wrapperRef} style={{ width: '100%' }}>
      <canvas ref={canvasRef} style={{ width: '100%', display: 'block' }} />
    </div>
  );
}

// ── PdfViewer ─────────────────────────────────────────────────────────────────
export function PdfViewer({ pdfUrl, formDef, felder }) {
  const [pages,   setPages]   = useState([]);
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const srcBytesRef = useRef(null);
  const debounceRef = useRef(null);
  const cancelRef   = useRef(null);

  // Bytes durch pdfjs in einzelne Seiten umwandeln
  async function renderBytes(bytes) {
    cancelRef.current?.();
    let cancelled = false;
    cancelRef.current = () => { cancelled = true; };
    setLoading(true);
    try {
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      if (cancelled) return;
      const pageList = [];
      for (let i = 1; i <= pdf.numPages; i++) pageList.push(await pdf.getPage(i));
      if (!cancelled) {
        setPages(pageList);
        setCurrent(c => Math.min(c, pageList.length - 1));
        setLoading(false);
      }
    } catch (e) {
      if (!cancelled) { setError(e.message); setLoading(false); }
    }
  }

  // 1) Beim pdfUrl-/formDef-Wechsel: Original-Bytes laden, durch fillPdfBytes
  //    schicken (damit Booklets sofort als 4 A4-Seiten erscheinen).
  useEffect(() => {
    if (!pdfUrl || !formDef) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPages([]);
    setCurrent(0);

    (async () => {
      try {
        const bytes = await fetchPdfBytes(pdfUrl);
        if (cancelled) return;
        srcBytesRef.current = bytes;
        const initial = await fillPdfBytes(formDef, felder || {}, bytes);
        if (cancelled) return;
        await renderBytes(initial);
      } catch (e) {
        if (!cancelled) { setError(e.message); setLoading(false); }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfUrl, formDef]);

  // 2) Wenn felder sich ändern: nach 700ms gefülltes PDF rendern
  useEffect(() => {
    if (!srcBytesRef.current || !formDef || !felder) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const filled = await fillPdfBytes(formDef, felder, srcBytesRef.current);
        await renderBytes(filled);
      } catch {
        // Bei Fehler: Originalanzeige behalten
      }
    }, 700);
    return () => clearTimeout(debounceRef.current);
  }, [felder, formDef]);

  const total   = pages.length;
  const canPrev = current > 0;
  const canNext = current < total - 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: C.pageBg }}>

      {/* Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '8px 16px', borderBottom: `1px solid ${C.panelBdr}`, backgroundColor: '#fff', flexShrink: 0 }}>
        <button
          onClick={() => setCurrent(c => c - 1)}
          disabled={!canPrev}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6, border: `1px solid ${C.panelBdr}`, background: canPrev ? '#fff' : '#f9fafb', cursor: canPrev ? 'pointer' : 'default', color: canPrev ? C.heading : C.muted }}
        >
          <ChevronLeft size={16} />
        </button>
        <span style={{ fontSize: 12, fontWeight: 600, color: C.heading, minWidth: 80, textAlign: 'center' }}>
          {loading ? 'Lädt…' : total > 0 ? `Seite ${current + 1} / ${total}` : '–'}
        </span>
        <button
          onClick={() => setCurrent(c => c + 1)}
          disabled={!canNext}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6, border: `1px solid ${C.panelBdr}`, background: canNext ? '#fff' : '#f9fafb', cursor: canNext ? 'pointer' : 'default', color: canNext ? C.heading : C.muted }}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Seiteninhalt */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {error && (
          <div style={{ color: '#ef4444', fontSize: 12, padding: 16, textAlign: 'center' }}>Fehler: {error}</div>
        )}
        {!error && pages[current] && (
          <div style={{ borderRadius: 4, overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,0.12)', background: '#fff' }}>
            <PdfPage page={pages[current]} />
          </div>
        )}
      </div>
    </div>
  );
}
