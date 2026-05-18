import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { manuelleBuchungApi, buchungssperreApi, kontenApi, mwstCodesApi } from '../api';

const CHF  = (n) => n == null ? '—' : new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const DATE = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('de-CH') : '—';
const today = () => new Date().toISOString().slice(0, 10);

const ART_BADGE = {
  normal:       { label: 'Buchung',       bg: '#e8f0e8', color: '#3d6641' },
  storno:       { label: 'Storno',        bg: '#fde7e7', color: '#8a2d2d' },
  saldovortrag: { label: 'Saldovortrag',  bg: '#ede9fe', color: '#5b21b6' },
};

const emptyZeile = () => ({ _k: Math.random(), konto_soll: '', konto_haben: '', betrag: '', mwst_code: '', text: '' });

// ── Konto-Combobox: Typeahead-Suche, vollständig tastatursteuerbar ──
function KontoCombobox({ value, onChange, konten, placeholder, fwdRef, onTab, style = {} }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi]       = useState(0);
  const internalRef       = useRef(null);
  const ref               = fwdRef || internalRef;
  const listRef           = useRef(null);

  const selected = konten.find(k => k.konto_nr === value);

  const filtered = useMemo(() => {
    if (!query) return konten.slice(0, 60);
    const q = query.toLowerCase();
    // Kontonummer-Prefix hat Priorität
    const byNr   = konten.filter(k => k.konto_nr.startsWith(query));
    const byName = konten.filter(k => !k.konto_nr.startsWith(query) && k.bezeichnung.toLowerCase().includes(q));
    return [...byNr, ...byName].slice(0, 14);
  }, [query, konten]);

  // Scroll highlighted item ins Sichtfeld
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[hi];
    item?.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  const doSelect = (konto) => {
    onChange(konto.konto_nr);
    setOpen(false);
    setQuery('');
  };

  const handleFocus = () => {
    setQuery(value || '');   // Vorbelegung mit aktueller Nr. → sofort nachtippen möglich
    setOpen(true);
    setHi(0);
  };

  const handleBlur = () => {
    // Kurze Verzögerung damit onMouseDown auf Listeneintrag noch feuern kann
    setTimeout(() => { setOpen(false); setQuery(''); }, 180);
  };

  const handleChange = (e) => {
    setQuery(e.target.value);
    setHi(0);
    if (!open) setOpen(true);
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); setOpen(true); setHi(0); }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHi(h => Math.min(h + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHi(h => Math.max(h - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[hi]) doSelect(filtered[hi]);
        break;
      case 'Tab':
        if (filtered[hi]) doSelect(filtered[hi]);
        // kein preventDefault → Tab bewegt natürlich weiter
        onTab?.(e);
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        setQuery('');
        break;
      default: break;
    }
  };

  const displayValue = open
    ? query
    : (selected ? `${selected.konto_nr} ${selected.bezeichnung}` : '');

  const inp = {
    background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7,
    padding: '5px 7px', fontSize: 12.5, color: '#1a1a2e', outline: 'none',
    width: '100%', boxSizing: 'border-box',
    ...style,
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={ref}
        value={displayValue}
        placeholder={selected ? undefined : placeholder}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        spellCheck={false}
        style={inp}
      />
      {open && filtered.length > 0 && (
        <div
          ref={listRef}
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
            background: '#fff', border: '1px solid #c5d0c5', borderRadius: 8,
            boxShadow: '0 6px 20px rgba(0,0,0,.14)', maxHeight: 230, overflowY: 'auto',
            marginTop: 2,
          }}
        >
          {filtered.map((k, i) => (
            <div
              key={k.konto_nr}
              onMouseDown={() => doSelect(k)}
              style={{
                padding: '6px 10px', cursor: 'pointer', fontSize: 12,
                background: i === hi ? '#e8f4e8' : '#fff',
                display: 'flex', gap: 8, alignItems: 'baseline',
                borderBottom: i < filtered.length - 1 ? '1px solid #f0f3f0' : 'none',
              }}
            >
              <span style={{ fontWeight: 700, color: '#4a7a4a', width: 36, flexShrink: 0, fontFamily: 'monospace', fontSize: 12 }}>
                {k.konto_nr}
              </span>
              <span style={{ color: '#1a2a1a', flex: 1 }}>{k.bezeichnung}</span>
              <span style={{ fontSize: 10, color: '#94a394', flexShrink: 0 }}>
                {k.konto_typ === 'aktiv' ? 'A' : k.konto_typ === 'passiv' ? 'P' : k.konto_typ === 'ertrag' ? 'E' : 'K'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ManuelleBuchungen() {
  const { mandant, canWrite } = useMandant();
  const jahr = new Date().getFullYear();

  const [belege, setBelege]   = useState([]);
  const [konten, setKonten]   = useState([]);
  const [mwst, setMwst]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [von, setVon]         = useState(`${jahr}-01-01`);
  const [bis, setBis]         = useState(`${jahr}-12-31`);

  const [gesperrtBis, setGesperrtBis] = useState(mandant?.gesperrt_bis ?? null);
  const [sperrInput, setSperrInput]   = useState('');

  const [expanded, setExpanded]       = useState(null);
  const [zeilenCache, setZeilenCache] = useState({});

  const [editing, setEditing] = useState(null);
  const [form, setForm]       = useState(null);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState(null);

  // Ref für Autofokus auf neue Zeile
  const newRowSollRef = useRef(null);
  const [pendingFocusNewRow, setPendingFocusNewRow] = useState(false);

  useEffect(() => { setGesperrtBis(mandant?.gesperrt_bis ?? null); }, [mandant?.gesperrt_bis]);

  const load = async () => {
    if (!mandant) return;
    setLoading(true);
    try {
      setBelege(await manuelleBuchungApi.listeBelege(mandant.id, von, bis));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [mandant?.id, von, bis]);

  useEffect(() => {
    if (!mandant) return;
    kontenApi.list(mandant.id).then(k => setKonten(k.filter(x => x.aktiv)));
    mwstCodesApi.listAktiv(mandant.id).then(setMwst);
  }, [mandant?.id]);

  // Fokus auf neue Zeile nach Render
  useEffect(() => {
    if (pendingFocusNewRow && newRowSollRef.current) {
      newRowSollRef.current.focus();
      setPendingFocusNewRow(false);
    }
  }, [pendingFocusNewRow, form?.zeilen?.length]);

  const kontoLabel = (nr) => {
    const k = konten.find(x => x.konto_nr === nr);
    return k ? `${k.konto_nr} ${k.bezeichnung}` : (nr || '—');
  };

  // ── Buchungssperre ──────────────────────────────────────────────
  const setSperre = async (datum) => {
    try {
      await buchungssperreApi.setzen(mandant.id, datum);
      setGesperrtBis(datum);
      setSperrInput('');
    } catch (e) { alert('Fehler: ' + e.message); }
  };

  // ── Beleg-Zeilen aufklappen ─────────────────────────────────────
  const toggleExpand = async (beleg) => {
    if (expanded === beleg.id) { setExpanded(null); return; }
    setExpanded(beleg.id);
    if (!zeilenCache[beleg.id]) {
      const z = await manuelleBuchungApi.zeilen(beleg.id);
      setZeilenCache(prev => ({ ...prev, [beleg.id]: z }));
    }
  };

  // ── Erfassen / Korrigieren ──────────────────────────────────────
  const openNew = () => {
    setForm({ datum: today(), text: '', zeilen: [emptyZeile()], pdfFile: null, pdfPath: null, pdfName: null });
    setEditing('new'); setErr(null);
  };

  const openKorrektur = async (beleg) => {
    const z = zeilenCache[beleg.id] ?? await manuelleBuchungApi.zeilen(beleg.id);
    setForm({
      datum: today(), text: beleg.text ?? '',
      zeilen: z.length ? z.map(r => ({
        _k: Math.random(), konto_soll: r.konto_soll, konto_haben: r.konto_haben,
        betrag: String(r.betrag), mwst_code: r.mwst_code ?? '', text: r.text ?? '',
      })) : [emptyZeile()],
      pdfFile: null, pdfPath: beleg.pdf_path ?? null, pdfName: beleg.pdf_name ?? null,
    });
    setEditing(beleg); setErr(null);
  };

  const close = () => { setEditing(null); setForm(null); setErr(null); };

  const updateZeile = (k, field, value) =>
    setForm(f => ({ ...f, zeilen: f.zeilen.map(z => z._k === k ? { ...z, [field]: value } : z) }));

  const addZeile = useCallback(() =>
    setForm(f => ({ ...f, zeilen: [...f.zeilen, emptyZeile()] })), []);

  const addZeileAndFocus = useCallback(() => {
    addZeile();
    setPendingFocusNewRow(true);
  }, [addZeile]);

  const removeZeile = (k) => setForm(f => ({ ...f, zeilen: f.zeilen.filter(z => z._k !== k) }));

  const validZeilen = form?.zeilen.filter(z => z.konto_soll && z.konto_haben && parseFloat(z.betrag) > 0) ?? [];
  const formTotal   = validZeilen.reduce((s, z) => s + parseFloat(z.betrag || 0), 0);
  const canSave     = form?.datum && validZeilen.length > 0 && !saving;

  // ── Keyboard-Shortcuts für Modal ────────────────────────────────
  useEffect(() => {
    if (!editing) return;
    const handler = (e) => {
      if (e.key === 'Escape') { close(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (canSave) handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editing, canSave]);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true); setErr(null);
    try {
      let pdfPath = form.pdfPath, pdfName = form.pdfName;
      if (form.pdfFile) {
        const up = await manuelleBuchungApi.uploadPdf(mandant.id, form.pdfFile);
        pdfPath = up.path; pdfName = up.name;
      }
      const zeilen = validZeilen.map(z => ({
        konto_soll: z.konto_soll, konto_haben: z.konto_haben,
        betrag: parseFloat(z.betrag),
        mwst_code: z.mwst_code || null, text: z.text || null,
      }));
      if (editing === 'new') {
        await manuelleBuchungApi.erstellen({
          mandantId: mandant.id, datum: form.datum, text: form.text,
          pdfPath, pdfName, zeilen,
        });
      } else {
        await manuelleBuchungApi.korrigieren({
          belegId: editing.id, datum: form.datum, text: form.text,
          pdfPath, pdfName, zeilen,
        });
      }
      setZeilenCache({});
      await load();
      close();
    } catch (e) {
      setErr(e.message);
    } finally { setSaving(false); }
  };

  const handleStorno = async (beleg) => {
    if (!window.confirm(`Beleg ${beleg.beleg_nr} stornieren? Es wird eine Gegenbuchung per ${DATE(today())} erstellt.`)) return;
    try {
      await manuelleBuchungApi.stornieren(beleg.id, today());
      setZeilenCache({});
      await load();
    } catch (e) { alert('Fehler: ' + e.message); }
  };

  const openPdf = async (path) => {
    try {
      const url = await manuelleBuchungApi.signedPdfUrl(path);
      if (url) window.open(url, '_blank');
    } catch (e) { alert('PDF konnte nicht geöffnet werden: ' + e.message); }
  };

  const hdr = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: '#6b826b', padding: '9px 12px', borderBottom: '2px solid #e4e9e4', textAlign: 'left', background: '#fafcfa', whiteSpace: 'nowrap' };
  const td  = { padding: '8px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5, verticalAlign: 'middle' };
  const inp = { background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, color: '#1a1a2e', outline: 'none', width: '100%', boxSizing: 'border-box' };
  const lbl = { fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 4, display: 'block' };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ flexShrink: 0, background: '#fff', borderBottom: '1px solid #e4e9e4' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', flexWrap: 'wrap' }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: '#7a9b7f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15 }}>📓</div>
          <span style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e' }}>Manuelle Buchungen</span>
          <input type="date" value={von} onChange={e => setVon(e.target.value)} style={{ ...inp, width: 140 }} />
          <span style={{ color: '#94a394' }}>–</span>
          <input type="date" value={bis} onChange={e => setBis(e.target.value)} style={{ ...inp, width: 140 }} />
          <div style={{ flex: 1 }} />
          {canWrite && (
            <button onClick={openNew} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
              + Neue Buchung
            </button>
          )}
        </div>

        {/* Buchungssperre-Leiste */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderTop: '1px solid #f0f3f0', background: gesperrtBis ? '#fdf6ec' : '#f7faf7' }}>
          <span style={{ fontSize: 16 }}>{gesperrtBis ? '🔒' : '🔓'}</span>
          <span style={{ fontSize: 12, color: '#4a5a4a' }}>
            {gesperrtBis
              ? <>Buchungssperre aktiv – gesperrt bis <strong>{DATE(gesperrtBis)}</strong>. Buchungen bis zu diesem Datum sind blockiert.</>
              : <>Keine Buchungssperre gesetzt.</>}
          </span>
          <div style={{ flex: 1 }} />
          {canWrite && (
            <>
              <input type="date" value={sperrInput} onChange={e => setSperrInput(e.target.value)} style={{ ...inp, width: 150 }} />
              <button
                onClick={() => sperrInput && setSperre(sperrInput)}
                disabled={!sperrInput}
                style={{ padding: '5px 12px', borderRadius: 7, border: 'none', background: sperrInput ? '#b9802e' : '#e4e9e4', color: sperrInput ? '#fff' : '#94a394', fontSize: 12, fontWeight: 600, cursor: sperrInput ? 'pointer' : 'default' }}
              >Sperren bis</button>
              {gesperrtBis && (
                <button
                  onClick={() => { if (window.confirm('Buchungssperre aufheben?')) setSperre(null); }}
                  style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#4a5a4a' }}
                >Aufheben</button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Liste */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#f7faf7' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94a394', fontSize: 13 }}>Lädt…</div>
        ) : belege.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94a394', fontSize: 13 }}>Keine manuellen Buchungen in diesem Zeitraum</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <thead><tr>
              <th style={{ ...hdr, width: 30 }}></th>
              <th style={hdr}>Beleg-Nr.</th>
              <th style={hdr}>Datum</th>
              <th style={hdr}>Text</th>
              <th style={hdr}>Art</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Betrag</th>
              <th style={{ ...hdr, textAlign: 'center' }}>PDF</th>
              <th style={{ ...hdr, textAlign: 'right' }}>Aktionen</th>
            </tr></thead>
            <tbody>
              {belege.map(b => {
                const ab = ART_BADGE[b.art] ?? ART_BADGE.normal;
                const z  = zeilenCache[b.id];
                const tot = z ? z.reduce((s, r) => s + Number(r.betrag), 0) : null;
                const isOpen = expanded === b.id;
                return (
                  <React.Fragment key={b.id}>
                    <tr style={{ background: b.storniert ? '#fafafa' : '#fff', opacity: b.storniert ? 0.7 : 1 }}>
                      <td style={{ ...td, textAlign: 'center', cursor: 'pointer', color: '#94a394' }} onClick={() => toggleExpand(b)}>{isOpen ? '▾' : '▸'}</td>
                      <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600 }}>{b.beleg_nr}</td>
                      <td style={td}>{DATE(b.buchungsdatum)}</td>
                      <td style={{ ...td, textDecoration: b.storniert ? 'line-through' : 'none' }}>{b.text || '—'}</td>
                      <td style={td}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: ab.bg, color: ab.color }}>{ab.label}</span>
                        {b.storniert && <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: '#fde7e7', color: '#8a2d2d' }}>storniert</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{tot != null ? CHF(tot) : <span style={{ color: '#c5cdc5' }}>…</span>}</td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        {b.pdf_path
                          ? <button onClick={() => openPdf(b.pdf_path)} title={b.pdf_name} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 14 }}>📎</button>
                          : <span style={{ color: '#c5cdc5' }}>—</span>}
                      </td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {canWrite && b.art === 'normal' && !b.storniert && (
                          <>
                            <button onClick={() => openKorrektur(b)} style={{ padding: '4px 9px', borderRadius: 6, border: '1px solid #d4dcd4', background: '#fff', fontSize: 11.5, cursor: 'pointer', color: '#3d6641', marginRight: 5 }}>Korrigieren</button>
                            <button onClick={() => handleStorno(b)} style={{ padding: '4px 9px', borderRadius: 6, border: '1px solid #e0c0c0', background: '#fff', fontSize: 11.5, cursor: 'pointer', color: '#8a2d2d' }}>Stornieren</button>
                          </>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0, background: '#f7faf7', borderBottom: '1px solid #e4e9e4' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead><tr>
                              <th style={{ ...hdr, fontSize: 9.5, background: '#eef2ee' }}>Soll-Konto</th>
                              <th style={{ ...hdr, fontSize: 9.5, background: '#eef2ee' }}>Haben-Konto</th>
                              <th style={{ ...hdr, fontSize: 9.5, background: '#eef2ee' }}>Text</th>
                              <th style={{ ...hdr, fontSize: 9.5, background: '#eef2ee' }}>MWST</th>
                              <th style={{ ...hdr, fontSize: 9.5, background: '#eef2ee', textAlign: 'right' }}>Betrag</th>
                            </tr></thead>
                            <tbody>
                              {(z ?? []).map(r => (
                                <tr key={r.id}>
                                  <td style={{ ...td, fontSize: 12 }}>{kontoLabel(r.konto_soll)}</td>
                                  <td style={{ ...td, fontSize: 12 }}>{kontoLabel(r.konto_haben)}</td>
                                  <td style={{ ...td, fontSize: 12, color: '#6b826b' }}>{r.text || '—'}</td>
                                  <td style={{ ...td, fontSize: 12 }}>{r.mwst_code || '—'}</td>
                                  <td style={{ ...td, fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{CHF(r.betrag)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Erfassungs-/Korrektur-Modal ── */}
      {editing && form && (
        <div
          onClick={close}
          style={{ position: 'fixed', inset: 0, background: 'rgba(26,26,46,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 14, width: 900, maxWidth: '96vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,.25)' }}
          >
            {/* Titel */}
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #e4e9e4', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>
                {editing === 'new' ? 'Neue manuelle Buchung' : `Beleg ${editing.beleg_nr} korrigieren`}
                {editing !== 'new' && <span style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 400, color: '#8a6d2d' }}>· Original wird storniert, Korrektur als neuer Beleg gebucht</span>}
              </span>
              <button onClick={close} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a394', fontSize: 18, lineHeight: 1, padding: '0 4px' }} title="Schliessen (Esc)">✕</button>
            </div>

            {/* Body */}
            <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Datum + Text */}
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ width: 160 }}>
                  <label style={lbl}>Buchungsdatum *</label>
                  {/* autoFocus auf Datum beim Öffnen */}
                  <input
                    type="date"
                    style={inp}
                    value={form.datum}
                    onChange={e => setForm(f => ({ ...f, datum: e.target.value }))}
                    autoFocus
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Buchungstext</label>
                  <input
                    style={inp}
                    value={form.text}
                    onChange={e => setForm(f => ({ ...f, text: e.target.value }))}
                    placeholder="z.B. Lohnzahlung März, Abschreibung Mobiliar …"
                  />
                </div>
              </div>

              {/* Buchungssätze */}
              <div>
                <label style={lbl}>Buchungssätze (jede Zeile = ein Soll-an-Haben-Satz)</label>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...hdr, fontSize: 9.5 }}>Soll-Konto</th>
                      <th style={{ ...hdr, fontSize: 9.5 }}>Haben-Konto</th>
                      <th style={{ ...hdr, fontSize: 9.5 }}>Text</th>
                      <th style={{ ...hdr, fontSize: 9.5, width: 100 }}>MWST</th>
                      <th style={{ ...hdr, fontSize: 9.5, width: 120, textAlign: 'right' }}>Betrag CHF</th>
                      <th style={{ ...hdr, fontSize: 9.5, width: 28 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.zeilen.map((z, i) => {
                      const isLastRow = i === form.zeilen.length - 1;
                      return (
                        <tr key={z._k}>
                          {/* Soll-Konto */}
                          <td style={{ ...td, padding: '3px 4px' }}>
                            <KontoCombobox
                              value={z.konto_soll}
                              onChange={v => updateZeile(z._k, 'konto_soll', v)}
                              konten={konten}
                              placeholder="Soll-Konto"
                              fwdRef={isLastRow && pendingFocusNewRow ? newRowSollRef : undefined}
                            />
                          </td>
                          {/* Haben-Konto */}
                          <td style={{ ...td, padding: '3px 4px' }}>
                            <KontoCombobox
                              value={z.konto_haben}
                              onChange={v => updateZeile(z._k, 'konto_haben', v)}
                              konten={konten}
                              placeholder="Haben-Konto"
                            />
                          </td>
                          {/* Positions-Text */}
                          <td style={{ ...td, padding: '3px 4px' }}>
                            <input
                              style={{ ...inp, padding: '5px 7px', fontSize: 12.5 }}
                              value={z.text}
                              onChange={e => updateZeile(z._k, 'text', e.target.value)}
                              placeholder="optional"
                            />
                          </td>
                          {/* MWST */}
                          <td style={{ ...td, padding: '3px 4px' }}>
                            <select
                              style={{ ...inp, padding: '5px 6px', fontSize: 12.5 }}
                              value={z.mwst_code}
                              onChange={e => updateZeile(z._k, 'mwst_code', e.target.value)}
                            >
                              <option value="">—</option>
                              {mwst.map(m => (
                                <option key={m.code} value={m.code}>{m.code} {m.satz}%</option>
                              ))}
                            </select>
                          </td>
                          {/* Betrag */}
                          <td style={{ ...td, padding: '3px 4px' }}>
                            <input
                              type="number"
                              step="0.05"
                              min="0"
                              style={{ ...inp, padding: '5px 7px', fontSize: 13, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
                              value={z.betrag}
                              onChange={e => updateZeile(z._k, 'betrag', e.target.value)}
                              placeholder="0.00"
                              onKeyDown={e => {
                                // Tab auf letzter Zeile → neue Zeile + Fokus
                                if (e.key === 'Tab' && !e.shiftKey && isLastRow) {
                                  e.preventDefault();
                                  addZeileAndFocus();
                                }
                                // Enter → neue Zeile
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  addZeileAndFocus();
                                }
                              }}
                            />
                          </td>
                          {/* Löschen */}
                          <td style={{ ...td, padding: '3px 4px', textAlign: 'center' }}>
                            {form.zeilen.length > 1 && (
                              <button
                                onClick={() => removeZeile(z._k)}
                                tabIndex={-1}
                                style={{ border: 'none', background: 'none', color: '#ccc', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
                                title="Zeile entfernen"
                              >✕</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                  <button
                    onClick={addZeileAndFocus}
                    style={{ padding: '4px 10px', borderRadius: 7, border: 'none', background: 'transparent', color: '#7a9b7f', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                    tabIndex={-1}
                  >
                    + Zeile <span style={{ fontWeight: 400, color: '#94a394', fontSize: 11 }}>(oder Tab/Enter im Betrag-Feld)</span>
                  </button>
                  <div style={{ fontSize: 13, color: '#4a5a4a' }}>
                    Total: <strong style={{ fontVariantNumeric: 'tabular-nums' }}>CHF {CHF(formTotal)}</strong>
                  </div>
                </div>
              </div>

              {/* PDF */}
              <div>
                <label style={lbl}>Beleg-PDF (optional)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="file" accept="application/pdf,image/*" onChange={e => setForm(f => ({ ...f, pdfFile: e.target.files[0] ?? null }))} style={{ fontSize: 12 }} />
                  {form.pdfFile && <span style={{ fontSize: 11.5, color: '#3d6641' }}>{form.pdfFile.name}</span>}
                  {!form.pdfFile && form.pdfName && <span style={{ fontSize: 11.5, color: '#6b826b' }}>📎 {form.pdfName} (übernommen)</span>}
                </div>
              </div>

              {err && (
                <div style={{ fontSize: 12, color: '#8a2d2d', background: '#fdf0f0', border: '1px solid #e0b8b8', borderRadius: 7, padding: '8px 11px' }}>{err}</div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '10px 18px', borderTop: '1px solid #e4e9e4', display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Tastatur-Hinweise */}
              <div style={{ flex: 1, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {[
                  ['↑↓', 'Konto navigieren'],
                  ['Enter/Tab', 'Konto wählen'],
                  ['Tab im Betrag', 'Neue Zeile'],
                  ['Ctrl+Enter', 'Buchen'],
                  ['Esc', 'Abbrechen'],
                ].map(([k, v]) => (
                  <span key={k} style={{ fontSize: 10.5, color: '#94a394' }}>
                    <kbd style={{ background: '#f0f3f0', border: '1px solid #d4dcd4', borderRadius: 3, padding: '1px 4px', fontSize: 10, fontFamily: 'monospace', color: '#4a5a4a' }}>{k}</kbd>
                    {' '}{v}
                  </span>
                ))}
              </div>
              <button onClick={close} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>
                Abbrechen
              </button>
              <button
                onClick={handleSave}
                disabled={!canSave}
                style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: canSave ? '#7a9b7f' : '#c5cdc5', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: canSave ? 'pointer' : 'not-allowed' }}
              >
                {saving ? 'Speichert…' : (editing === 'new' ? 'Buchen' : 'Korrektur buchen')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
