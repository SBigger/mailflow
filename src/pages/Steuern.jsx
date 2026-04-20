import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { steuerdaten as db } from '@/api/steuerdaten';
import { fillAndDownload, listPdfFields } from '@/lib/pdfFill';
import { SG_JP1B, FAVORITEN_IDS as SG_FAV } from '@/forms/sg_jp1b';
import { TG_50I,  FAVORITEN_IDS as TG_FAV } from '@/forms/tg_50i';
import { ESTV_19, FAVORITEN_IDS as ESTV_FAV } from '@/forms/estv_19';
import {
  Search, Download, Save, Plus, ChevronRight, FileText,
  Building2, X, Wrench, Check, CheckCircle2, Star, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { PdfViewer } from '@/components/PdfViewer';

const FORMS    = { SG: SG_JP1B, TG: TG_50I, ESTV: ESTV_19 };
const FORM_FAV = { SG: SG_FAV,  TG: TG_FAV, ESTV: ESTV_FAV };
const TABS = [
  { id: 'SG',   label: 'Kanton SG'           },
  { id: 'TG',   label: 'Kanton TG'           },
  { id: 'ESTV', label: 'ESTV Beteiligungen'  },
];
const CY    = new Date().getFullYear();
const JAHRE = [CY, CY - 1, CY - 2, CY - 3];

const C = {
  pageBg:  '#f2f5f2', panelBg: '#ffffff', panelBdr: '#ccd8cc',
  heading: '#1a3a1a', sub:     '#4a6a4a', accent:   '#5b8a5b',
  accentBg:'#eef5ee', muted:   '#9ca3af', rowHov:   '#f0f5f0',
  inputBg: '#f8faf8',
};

function iStyle(focus) {
  return {
    backgroundColor: C.inputBg,
    border: `1px solid ${focus ? C.accent : C.panelBdr}`,
    borderRadius: 6, padding: '5px 10px', fontSize: 12,
    color: C.heading, width: '100%', outline: 'none',
    height: 32, boxSizing: 'border-box', transition: 'border-color 0.15s',
  };
}

function fmtCHF(val) {
  if (val == null || val === '') return '';
  const n = parseFloat(val);
  if (isNaN(n)) return String(val);
  return n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function FormInput({ feld, value, onChange }) {
  const [focus, setFocus] = useState(false);
  const base = iStyle(focus);

  if (feld.typ === 'checkbox') {
    return (
      <label className="flex items-center gap-2 cursor-pointer select-none" style={{ fontSize: 12 }}>
        <input
          type="checkbox"
          checked={!!value}
          onChange={e => onChange(e.target.checked)}
          style={{ accentColor: C.accent, width: 14, height: 14 }}
        />
        <span style={{ color: C.heading }}>Ja</span>
      </label>
    );
  }

  if (feld.typ === 'textarea') {
    return (
      <textarea
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        rows={3}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{ ...base, height: 'auto', padding: '6px 10px', resize: 'vertical', minHeight: 64 }}
        placeholder={feld.label}
      />
    );
  }

  if (feld.typ === 'select') {
    return (
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={base}
      >
        <option value="">– wählen –</option>
        {(feld.optionen || []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  if (feld.typ === 'datum') {
    return (
      <input
        type="date"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={base}
      />
    );
  }

  if (feld.typ === 'betrag') {
    return (
      <input
        type={focus ? 'number' : 'text'}
        step="0.01"
        value={focus ? (value ?? '') : fmtCHF(value)}
        onChange={e => onChange(e.target.value === '' ? '' : parseFloat(e.target.value))}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{ ...base, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
        placeholder="0.00"
      />
    );
  }

  // text, zahl
  return (
    <input
      type={feld.typ === 'zahl' ? 'number' : 'text'}
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? '' : feld.typ === 'zahl' ? parseFloat(e.target.value) : e.target.value)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={base}
    />
  );
}

function loadFav(kanton) {
  try {
    const s = localStorage.getItem(`fav_${kanton}`);
    if (s) return new Set(JSON.parse(s));
  } catch {}
  return new Set(FORM_FAV[kanton] || []);
}

// ── FormEditor ───────────────────────────────────────────────────────────────
function FormEditor({ kunde, kanton, steuerjahr, onFelderChange }) {
  const formDef = FORMS[kanton];
  const qc = useQueryClient();

  const [favIds, setFavIds] = useState(() => loadFav(kanton));

  // Wenn kanton wechselt, neue Favoriten laden
  const prevKanton = useRef(kanton);
  if (prevKanton.current !== kanton) {
    prevKanton.current = kanton;
    setFavIds(loadFav(kanton));
  }

  function toggleFav(id) {
    setFavIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem(`fav_${kanton}`, JSON.stringify([...next]));
      return next;
    });
  }

  const { data: gespeichert, isLoading } = useQuery({
    queryKey: ['steuerdaten', kunde.id, kanton, steuerjahr],
    queryFn:  () => db.get(kunde.id, kanton, steuerjahr),
  });

  const [felder,   setFelder]   = useState({});
  const [erledigt, setErledigt] = useState(false);
  const [dirty,    setDirty]    = useState(false);
  const [showAll,  setShowAll]  = useState(false);
  const initKey = useRef('');

  // Felder beim Laden/Wechsel initialisieren (im Render, bewusst als abgesichertes Muster)
  const key = `${kunde.id}-${kanton}-${steuerjahr}`;
  if (initKey.current !== key && !isLoading) {
    initKey.current = key;
    const saved = gespeichert?.felder || {};
    const { _erledigt, ...rest } = saved;
    const pre = Object.keys(rest).length > 0 ? rest : {
      firma_name: kunde.company_name || '',
      strasse:    kunde.strasse      || '',
      plz:        kunde.plz          || '',
      ort:        kunde.ort          || '',
    };
    setFelder(pre);
    setErledigt(!!_erledigt);
    setDirty(false);
    setShowAll(false);
    onFelderChange?.(pre);
  }

  const set = useCallback((id, val) => {
    setFelder(prev => {
      const next = { ...prev, [id]: val };
      onFelderChange?.(next);
      return next;
    });
    setDirty(true);
  }, [onFelderChange]);

  const saveMutation = useMutation({
    mutationFn: () => db.upsert(
      kunde.id, kanton, steuerjahr,
      { ...felder, _erledigt: erledigt },
      felder.bemerkungen || null,
    ),
    onSuccess: () => {
      toast.success('Gespeichert');
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['steuerdaten', kunde.id, kanton, steuerjahr] });
      qc.invalidateQueries({ queryKey: ['steuerdaten_ids'] });
      qc.invalidateQueries({ queryKey: ['steuerdaten_kunde', kunde.id] });
    },
    onError: e => toast.error('Fehler: ' + e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => db.delete(kunde.id, kanton, steuerjahr),
    onSuccess: () => {
      toast.success('Eintrag gelöscht');
      qc.invalidateQueries({ queryKey: ['steuerdaten', kunde.id, kanton, steuerjahr] });
      qc.invalidateQueries({ queryKey: ['steuerdaten_ids'] });
      qc.invalidateQueries({ queryKey: ['steuerdaten_kunde', kunde.id] });
    },
    onError: e => toast.error('Fehler: ' + e.message),
  });

  function handleDelete() {
    if (!gespeichert) return; // nichts gespeichert → nichts zu löschen
    if (!window.confirm(`Eintrag ${kanton} ${steuerjahr} wirklich löschen?`)) return;
    deleteMutation.mutate();
  }

  const [downloading, setDownloading] = useState(false);
  async function handleDownload() {
    setDownloading(true);
    try {
      await fillAndDownload(formDef, felder, kunde.company_name, steuerjahr);
      toast.success('PDF heruntergeladen');
    } catch (e) {
      toast.error('PDF-Fehler: ' + e.message);
    } finally {
      setDownloading(false);
    }
  }

  const [inspOpen,    setInspOpen]    = useState(false);
  const [inspFelder,  setInspFelder]  = useState(null);
  const [inspLoading, setInspLoading] = useState(false);

  async function handleInspect() {
    setInspOpen(true);
    if (inspFelder) return;
    setInspLoading(true);
    try {
      setInspFelder(await listPdfFields(formDef.pdfUrl));
    } catch (e) {
      toast.error('Inspector-Fehler: ' + e.message);
      setInspOpen(false);
    } finally {
      setInspLoading(false);
    }
  }

  if (isLoading) {
    return <div className="flex-1 flex items-center justify-center" style={{ color: C.muted }}>Lade…</div>;
  }

  const visibleSections = formDef.sections
    .map(s => ({ ...s, felder: showAll ? s.felder : s.felder.filter(f => favIds.has(f.id)) }))
    .filter(s => s.felder.length > 0);

  const hiddenCount = formDef.sections.reduce((n, s) =>
    n + s.felder.filter(f => !favIds.has(f.id)).length, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-3 flex-shrink-0"
        style={{ borderBottom: `1px solid ${C.panelBdr}`, backgroundColor: C.accentBg }}>
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4" style={{ color: C.accent }} />
          <span className="text-sm font-semibold" style={{ color: C.heading }}>
            {formDef.name} – {steuerjahr}
          </span>
          {dirty && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
              Ungespeichert
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setErledigt(v => !v); setDirty(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={{
              backgroundColor: erledigt ? '#dcfce7' : C.panelBg,
              color:           erledigt ? '#15803d' : C.sub,
              border:          `1px solid ${erledigt ? '#86efac' : C.panelBdr}`,
            }}
          >
            <Check className="w-3.5 h-3.5" />
            {erledigt ? 'Erledigt' : 'Als erledigt markieren'}
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity"
            style={{ backgroundColor: C.accent, opacity: saveMutation.isPending ? 0.6 : 1 }}
          >
            <Save className="w-3.5 h-3.5" />
            {saveMutation.isPending ? 'Speichern…' : 'Speichern'}
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={{ border: `1px solid ${C.accent}`, color: C.accent, backgroundColor: C.panelBg, opacity: downloading ? 0.6 : 1 }}
          >
            <Download className="w-3.5 h-3.5" />
            {downloading ? 'Lade PDF…' : 'PDF herunterladen'}
          </button>
          {formDef.typ === 'acroform' && (
            <button
              onClick={handleInspect}
              title="AcroForm-Felder anzeigen"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
              style={{ border: `1px solid ${C.panelBdr}`, color: C.muted, backgroundColor: C.panelBg }}
            >
              <Wrench className="w-3.5 h-3.5" />
            </button>
          )}
          {gespeichert && (
            <button
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              title="Eintrag löschen"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
              style={{ border: '1px solid #fca5a5', color: '#dc2626', backgroundColor: '#fff5f5', opacity: deleteMutation.isPending ? 0.6 : 1 }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Felder-Bereich */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
        {visibleSections.map(section => (
          <div key={section.id}>
            <h3 className="text-xs font-bold uppercase tracking-widest mb-3"
              style={{ color: C.accent, borderBottom: `1px solid ${C.panelBdr}`, paddingBottom: 6 }}>
              {section.titel}
            </h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {section.felder.map(feld => {
                const isFav = favIds.has(feld.id);
                return (
                <div key={feld.id} className={feld.typ === 'textarea' ? 'col-span-2' : ''}>
                  <div className="flex items-center gap-1 mb-1">
                    <label className="flex-1 text-[10px] font-semibold uppercase tracking-widest"
                      style={{ color: C.muted }}>
                      {feld.label}{feld.pflicht && <span style={{ color: '#dc2626' }}> *</span>}
                    </label>
                    <button
                      onClick={() => toggleFav(feld.id)}
                      tabIndex={-1}
                      title={isFav ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
                      style={{ flexShrink: 0, color: isFav ? '#f59e0b' : C.muted, opacity: isFav ? 1 : 0.4, transition: 'opacity 0.15s' }}
                      className="hover:opacity-100"
                    >
                      <Star size={11} fill={isFav ? '#f59e0b' : 'none'} />
                    </button>
                  </div>
                  <FormInput feld={feld} value={felder[feld.id]} onChange={val => set(feld.id, val)} />
                </div>
              );
              })}
            </div>
          </div>
        ))}

        {hiddenCount > 0 && (
          <button
            onClick={() => setShowAll(v => !v)}
            className="w-full py-2 rounded-lg text-xs font-semibold transition-colors"
            style={{ border: `1px dashed ${C.panelBdr}`, color: C.sub }}
          >
            {showAll
              ? 'Nur Favoriten anzeigen'
              : `+ ${hiddenCount} weitere Felder einblenden`}
          </button>
        )}

        {formDef.typ === 'static' && (
          <div className="rounded-lg p-3 text-xs"
            style={{ backgroundColor: '#fef9c3', color: '#854d0e', border: '1px solid #fde047' }}>
            <strong>Hinweis SG:</strong> Statisches Formular – Textpositionen können je nach Version leicht abweichen.
          </div>
        )}
      </div>

      {/* Inspector-Modal */}
      {inspOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="rounded-2xl overflow-hidden flex flex-col"
            style={{ background: C.panelBg, border: `1px solid ${C.panelBdr}`, width: 640, maxHeight: '80vh' }}>
            <div className="flex items-center justify-between px-5 py-3 flex-shrink-0"
              style={{ borderBottom: `1px solid ${C.panelBdr}`, backgroundColor: C.accentBg }}>
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4" style={{ color: C.accent }} />
                <span className="text-sm font-semibold" style={{ color: C.heading }}>
                  AcroForm-Felder – {formDef.name}
                </span>
              </div>
              <button onClick={() => setInspOpen(false)}>
                <X className="w-4 h-4" style={{ color: C.muted }} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {inspLoading ? (
                <div className="text-sm text-center py-8" style={{ color: C.muted }}>PDF wird geladen…</div>
              ) : inspFelder ? (
                <>
                  <p className="text-xs mb-3" style={{ color: C.sub }}>
                    {inspFelder.length} Felder gefunden. Diese Feldnamen in <code>src/forms/</code> eintragen.
                  </p>
                  <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${C.panelBdr}` }}>
                        <th className="text-left py-1.5 pr-4 font-semibold" style={{ color: C.sub }}>Feldname (acroField)</th>
                        <th className="text-left py-1.5 font-semibold" style={{ color: C.sub }}>Typ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inspFelder.map((f, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${C.panelBdr}20` }}>
                          <td className="py-1 pr-4 font-mono" style={{ color: C.heading }}>{f.name}</td>
                          <td className="py-1" style={{ color: C.muted }}>{f.typ}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Hauptkomponente ──────────────────────────────────────────────────────────
export default function Steuern() {
  const [search,     setSearch]     = useState('');
  const [selected,   setSelected]   = useState(null);
  const [activeTab,  setActiveTab]  = useState('SG');
  const [steuerjahr, setSteuerjahr] = useState(CY - 1);
  const [neuesJahr,  setNeuesJahr]  = useState(false);
  const [pendingIds, setPendingIds] = useState(new Set());
  const [addingNew,  setAddingNew]  = useState(false);
  const [addSearch,  setAddSearch]  = useState('');
  const [splitWidth,    setSplitWidth]    = useState(440);
  const [previewFelder, setPreviewFelder] = useState({});
  const addRef  = useRef(null);
  const dragRef = useRef({ active: false, startX: 0, startW: 0 });

  function onDragStart(e) {
    dragRef.current = { active: true, startX: e.clientX, startW: splitWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    function onMove(e) {
      if (!dragRef.current.active) return;
      const delta = e.clientX - dragRef.current.startX;
      setSplitWidth(Math.max(280, Math.min(720, dragRef.current.startW + delta)));
    }
    function onUp() {
      dragRef.current.active = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Dropdown schließen bei Klick außerhalb
  useEffect(() => {
    if (!addingNew) return;
    function handle(e) {
      if (addRef.current && !addRef.current.contains(e.target)) setAddingNew(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [addingNew]);

  // Alle Unternehmenskunden
  const { data: alleKunden = [] } = useQuery({
    queryKey: ['customers_all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, company_name, ort, plz, strasse, kanton, person_type, aktiv')
        .neq('person_type', 'privatperson')
        .neq('person_type', 'privatperson_partner')
        .order('company_name');
      if (error) throw new Error(error.message);
      return (data || []).filter(k => k.aktiv !== false);
    },
  });

  // Kunden mit bestehenden Steuerdaten
  const { data: mitDaten = [] } = useQuery({
    queryKey: ['steuerdaten_ids'],
    queryFn: () => db.listCustomerIds(),
  });
  const mitDatenSet = new Set(mitDaten);

  // Linkes Panel: nur Kunden MIT Daten + pending neue
  const listeKunden = alleKunden.filter(k => mitDatenSet.has(k.id) || pendingIds.has(k.id));
  const gefiltert   = listeKunden.filter(k =>
    !search || k.company_name?.toLowerCase().includes(search.toLowerCase())
  );

  // Kunden für "+" Dropdown (noch nicht in der Liste)
  const verfuegbar = alleKunden.filter(k => !mitDatenSet.has(k.id) && !pendingIds.has(k.id));
  const verfuegbarGefiltert = verfuegbar.filter(k =>
    !addSearch || k.company_name?.toLowerCase().includes(addSearch.toLowerCase())
  );

  // Steuerdaten des gewählten Kunden (inkl. felder für _erledigt-Status)
  const { data: kundenDaten = [] } = useQuery({
    queryKey: ['steuerdaten_kunde', selected?.id],
    queryFn: () => selected ? db.listForCustomer(selected.id) : Promise.resolve([]),
    enabled: !!selected,
  });

  const hatEintrag  = (kanton, jahr) => kundenDaten.some(d => d.kanton === kanton && d.steuerjahr === jahr);
  const istErledigt = (kanton, jahr) => kundenDaten.some(d => d.kanton === kanton && d.steuerjahr === jahr && d.felder?._erledigt);

  function selectKunde(k) {
    setSelected(k);
    setActiveTab('SG');
    setSteuerjahr(CY - 1);
    setNeuesJahr(false);
    setPreviewFelder({});
  }

  function addKunde(k) {
    setPendingIds(prev => new Set([...prev, k.id]));
    selectKunde(k);
    setAddingNew(false);
    setAddSearch('');
  }

  return (
    <div className="flex h-full overflow-hidden" style={{ backgroundColor: C.pageBg }}>

      {/* ── Linke Sidebar ── */}
      <aside className="w-64 flex-shrink-0 flex flex-col border-r overflow-hidden"
        style={{ backgroundColor: C.pageBg, borderColor: C.panelBdr }}>

        <div className="px-3 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${C.panelBdr}` }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4" style={{ color: C.accent }} />
              <span className="text-sm font-semibold" style={{ color: C.heading }}>Steuererklärungen</span>
            </div>

            {/* + Firma hinzufügen */}
            <div className="relative" ref={addRef}>
              <button
                onClick={() => { setAddingNew(v => !v); setAddSearch(''); }}
                className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
                title="Firma hinzufügen"
                style={{
                  backgroundColor: addingNew ? C.accent : C.accentBg,
                  color:           addingNew ? '#fff'   : C.accent,
                }}
              >
                <Plus className="w-4 h-4" />
              </button>

              {addingNew && (
                <div className="absolute top-9 right-0 z-50 rounded-xl overflow-hidden shadow-lg"
                  style={{ background: C.panelBg, border: `1px solid ${C.panelBdr}`, width: 240 }}>
                  <div className="p-2" style={{ borderBottom: `1px solid ${C.panelBdr}` }}>
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: C.muted }} />
                      <input
                        autoFocus
                        value={addSearch}
                        onChange={e => setAddSearch(e.target.value)}
                        placeholder="Firma suchen…"
                        className="w-full rounded-lg pl-7 pr-3 py-1.5 text-xs outline-none"
                        style={{ backgroundColor: C.inputBg, border: `1px solid ${C.panelBdr}`, color: C.heading }}
                      />
                    </div>
                  </div>
                  <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                    {verfuegbarGefiltert.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-center" style={{ color: C.muted }}>
                        Keine weiteren Firmen
                      </div>
                    ) : verfuegbarGefiltert.map(k => (
                      <button
                        key={k.id}
                        onClick={() => addKunde(k)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors"
                        style={{ color: C.heading }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = C.rowHov}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <Building2 className="w-3 h-3 flex-shrink-0" style={{ color: C.muted }} />
                        <span className="flex-1 truncate">{k.company_name}</span>
                        {k.ort && <span className="text-[9px]" style={{ color: C.muted }}>{k.ort}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: C.muted }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Suchen…"
              className="w-full rounded-lg pl-8 pr-3 py-1.5 text-xs outline-none"
              style={{ backgroundColor: C.panelBg, border: `1px solid ${C.panelBdr}`, color: C.heading }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {gefiltert.length === 0 && (
            <div className="px-3 py-10 text-xs text-center" style={{ color: C.muted }}>
              <Building2 className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p>Noch keine Einträge</p>
              <p className="mt-1 opacity-60">Mit «+» Firma hinzufügen</p>
            </div>
          )}
          {gefiltert.map(k => {
            const isActive  = k.id === selected?.id;
            const isPending = pendingIds.has(k.id) && !mitDatenSet.has(k.id);
            return (
              <button
                key={k.id}
                onClick={() => selectKunde(k)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors"
                style={{
                  backgroundColor: isActive ? C.accent + '20' : 'transparent',
                  color:      isActive ? C.accent : C.heading,
                  fontWeight: isActive ? 600 : 400,
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = C.rowHov; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  backgroundColor: isPending ? C.muted + '60' : C.accent + '99',
                }} />
                <span className="flex-1 truncate">{k.company_name}</span>
                {k.ort && <span className="text-[9px] truncate max-w-[55px]" style={{ color: C.muted }}>{k.ort}</span>}
                {isActive && <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: C.accent }} />}
              </button>
            );
          })}
        </div>
      </aside>

      {/* ── Rechter Bereich ── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ color: C.muted }}>
            <Building2 className="w-12 h-12 opacity-20" />
            <p className="text-sm">Firma aus der Liste wählen oder mit «+» hinzufügen</p>
          </div>
        ) : (
          <>
            {/* Kunden-Header */}
            <div className="flex-shrink-0 px-5 py-3 flex items-center justify-between"
              style={{ borderBottom: `1px solid ${C.panelBdr}`, backgroundColor: C.panelBg }}>
              <div>
                <h2 className="text-base font-bold" style={{ color: C.heading }}>{selected.company_name}</h2>
                <p className="text-xs" style={{ color: C.sub }}>
                  {[selected.plz, selected.ort].filter(Boolean).join(' ')}
                  {selected.kanton ? ` · ${selected.kanton}` : ''}
                </p>
              </div>

              {/* Steuerjahr-Wähler */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold" style={{ color: C.sub }}>Steuerjahr:</span>
                {JAHRE.map(j => {
                  const erled = istErledigt(activeTab, j);
                  const hatD  = hatEintrag(activeTab, j);
                  const akt   = steuerjahr === j && !neuesJahr;
                  return (
                    <button
                      key={j}
                      onClick={() => { setSteuerjahr(j); setNeuesJahr(false); }}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors relative"
                      style={{
                        backgroundColor: akt ? C.accent : C.panelBg,
                        color:  akt ? '#fff' : C.sub,
                        border: `1px solid ${akt ? C.accent : C.panelBdr}`,
                      }}
                    >
                      {j}
                      {erled && (
                        <span style={{
                          position: 'absolute', top: -5, right: -5,
                          width: 14, height: 14, borderRadius: '50%',
                          backgroundColor: '#22c55e', border: '2px solid white',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Check style={{ width: 8, height: 8, color: 'white', strokeWidth: 3 }} />
                        </span>
                      )}
                      {!erled && hatD && (
                        <span style={{
                          position: 'absolute', top: -3, right: -3,
                          width: 8, height: 8, borderRadius: '50%',
                          backgroundColor: '#93c5fd', border: '1.5px solid white',
                        }} />
                      )}
                    </button>
                  );
                })}
                {neuesJahr ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="number" min="2010" max="2099"
                      defaultValue={steuerjahr}
                      onChange={e => setSteuerjahr(parseInt(e.target.value) || steuerjahr)}
                      className="w-16 rounded-lg px-2 py-1 text-xs text-center outline-none"
                      style={{ border: `1px solid ${C.accent}`, backgroundColor: C.inputBg, color: C.heading }}
                    />
                    <button onClick={() => setNeuesJahr(false)}>
                      <X className="w-3.5 h-3.5" style={{ color: C.muted }} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setNeuesJahr(true)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs"
                    style={{ color: C.sub, border: `1px solid ${C.panelBdr}` }}
                  >
                    <Plus className="w-3 h-3" /> Jahr
                  </button>
                )}
              </div>
            </div>

            {/* Kanton-Tabs */}
            <div className="flex-shrink-0 flex border-b px-5 gap-1 pt-2"
              style={{ borderColor: C.panelBdr, backgroundColor: C.panelBg }}>
              {TABS.map(tab => {
                const erled = istErledigt(tab.id, steuerjahr);
                const hatD  = hatEintrag(tab.id, steuerjahr);
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className="px-4 py-2 text-xs font-semibold rounded-t-lg transition-colors flex items-center gap-1.5"
                    style={{
                      backgroundColor: activeTab === tab.id ? C.accentBg : 'transparent',
                      color:           activeTab === tab.id ? C.accent   : C.sub,
                      borderBottom:    activeTab === tab.id ? `2px solid ${C.accent}` : '2px solid transparent',
                    }}
                  >
                    {tab.label}
                    {erled && <CheckCircle2 className="w-3 h-3" style={{ color: '#22c55e' }} />}
                    {!erled && hatD && <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#93c5fd' }} />}
                  </button>
                );
              })}
            </div>

            {/* Formular-Editor + PDF-Vorschau */}
            <div className="flex-1 flex overflow-hidden">
              {/* Felder-Panel */}
              <div className="flex flex-col overflow-hidden" style={{ width: splitWidth, flexShrink: 0, backgroundColor: C.panelBg }}>
                <FormEditor
                  key={`${selected.id}-${activeTab}-${steuerjahr}`}
                  kunde={selected}
                  kanton={activeTab}
                  steuerjahr={steuerjahr}
                  onFelderChange={setPreviewFelder}
                />
              </div>

              {/* Drag Handle */}
              <div
                onMouseDown={onDragStart}
                style={{ width: 8, flexShrink: 0, cursor: 'col-resize', backgroundColor: C.panelBdr, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = C.accent + '55'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = C.panelBdr}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{ width: 3, height: 3, borderRadius: '50%', backgroundColor: C.sub }} />
                  ))}
                </div>
              </div>

              {/* PDF-Vorschau */}
              <div className="flex-1 overflow-hidden">
                <PdfViewer
                  pdfUrl={FORMS[activeTab]?.pdfUrl}
                  formDef={FORMS[activeTab]}
                  felder={previewFelder}
                />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
