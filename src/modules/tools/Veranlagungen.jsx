// Veranlagungs-Tracker — separates Tool fuer den Veranlagungsstand pro Kunde,
// Jahr und Kanton. Speichert via api/veranlagungen.js in der `steuerdaten`-
// Tabelle unter reserviertem kanton-Key `_VERANLAGUNG`.
//
// Layout:
//   Linke Sidebar:    Kundenliste (filtert auf juristische Personen, "+" fuer neu)
//   Mitte/Rechts:     Matrix Jahre x Kantone, Klick auf Zelle oeffnet Editor
//   Editor (rechts):  Stand, Datum, prov. Steuer, def. Gewinn, Bemerkung,
//                     verknuepfte Veranlagungs-Dokumente (BelegePicker)
import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../api/supabaseClient.js';
import {
  veranlagungen as db,
  VERANLAGUNGSSTAND_OPTIONEN,
  ALLE_KANTONE_PLUS_BUND,
} from '../../api/veranlagungen.js';
import {
  Search, Building2, User2, Plus, ChevronRight, X, Save,
  Receipt, Edit3, Check, Calendar, FileText, GripVertical,
} from 'lucide-react';
import { toast } from 'sonner';
import BelegePicker from '../../components/BelegePicker.jsx';

const CY    = new Date().getFullYear();
const JAHRE = [CY, CY - 1, CY - 2, CY - 3, CY - 4];

const C = {
  pageBg:  '#f2f5f2', panelBg: '#ffffff', panelBdr: '#ccd8cc',
  heading: '#1a3a1a', sub:     '#4a6a4a', accent:   '#5b8a5b',
  accentBg:'#eef5ee', muted:   '#9ca3af', rowHov:   '#f0f5f0',
  inputBg: '#f8faf8',
};

// Stabile Empty-Referenz, damit `byYear[jahr] || EMPTY_FELDER` keinen
// Infinite-Render in JahrZeile.useEffect ausloest.
const EMPTY_FELDER = {};

// ── Person-Typ-Helfer ────────────────────────────────────────────────────────
function isPrivatperson(kunde) {
  return kunde?.person_type === 'privatperson' || kunde?.person_type === 'privatperson_partner';
}
function displayName(kunde) {
  if (!kunde) return '';
  if (isPrivatperson(kunde)) {
    const np = [kunde.vorname, kunde.nachname].filter(Boolean).join(' ');
    return np || kunde.company_name || '–';
  }
  return kunde.company_name || '–';
}
// Liefert die richtigen Labels je Person-Typ + Steuerstelle (Kanton vs Bund)
function labelsFor(kunde, kanton) {
  const np = isPrivatperson(kunde);
  return {
    gewinnLabel:      np ? 'Definitiv veranlagtes Einkommen (CHF)' : 'Definitiv veranlagter Gewinn (CHF)',
    kapitalLabel:     np ? 'Definitiv veranlagtes Vermögen (CHF)'  : 'Definitiv veranlagtes Kapital (CHF)',
    provKapitalLabel: np ? 'Provisorisch steuerbares Vermögen (CHF)' : 'Provisorisch steuerbares Kapital (CHF)',
    gewinnShort:      np ? 'Eink.'                                  : 'Gewinn',
    kapitalShort:     np ? 'Verm.'                                  : 'Kapital',
    provKapitalShort: np ? 'p.Verm.'                                : 'p.Kap.',
    showKapital:      kanton !== 'Bund',  // Bund hat keine Vermoegens-/Kapitalsteuer
  };
}

function fmtCHF(val) {
  if (val == null || val === '') return '–';
  const n = parseFloat(val);
  if (isNaN(n)) return String(val);
  return n.toLocaleString('de-CH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function standBadge(stand) {
  const opt = VERANLAGUNGSSTAND_OPTIONEN.find(o => o.value === stand);
  if (!opt) return null;
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 8,
      backgroundColor: opt.bg, color: opt.farbe, whiteSpace: 'nowrap',
    }}>
      {opt.label}
    </span>
  );
}

// ── Editor fuer einen Kanton-Eintrag ─────────────────────────────────────────
function KantonEditor({ kunde, steuerjahr, kanton, eintrag, onChange, onClose }) {
  const isBund = kanton === 'Bund';
  const lbl   = labelsFor(kunde, kanton);
  const set   = (key, val) => onChange({ ...eintrag, [key]: val });

  const numInput = (key, placeholder = '0.00') => (
    <input
      type="number" step="0.01"
      value={eintrag[key] ?? ''}
      onChange={e => set(key, e.target.value === '' ? '' : parseFloat(e.target.value))}
      placeholder={placeholder}
      style={{
        width: '100%', height: 32, padding: '5px 10px',
        fontSize: 12, color: C.heading, textAlign: 'right',
        backgroundColor: C.inputBg, border: `1px solid ${C.panelBdr}`,
        borderRadius: 6, marginTop: 4, fontVariantNumeric: 'tabular-nums',
      }}
    />
  );

  return (
    <div style={{
      borderTop: `1px solid ${C.panelBdr}`, padding: '14px 18px',
      backgroundColor: C.accentBg + '50',
    }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Edit3 className="w-4 h-4" style={{ color: C.accent }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: C.heading }}>
            {isBund ? 'Direkte Bundessteuer' : `Kanton ${kanton}`} – {steuerjahr}
          </span>
        </div>
        <button onClick={onClose} title="Schliessen" style={{ color: C.muted }}>
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Veranlagungsstand */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: C.muted }}>
            Veranlagungsstand
          </label>
          <select
            value={eintrag.stand || ''}
            onChange={e => set('stand', e.target.value)}
            style={{
              width: '100%', height: 32, padding: '5px 10px',
              fontSize: 12, color: C.heading,
              backgroundColor: C.inputBg, border: `1px solid ${C.panelBdr}`,
              borderRadius: 6, marginTop: 4,
            }}
          >
            <option value="">– waehlen –</option>
            {VERANLAGUNGSSTAND_OPTIONEN.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: C.muted }}>
            Veranlagungsdatum
          </label>
          <input
            type="date"
            value={eintrag.datum || ''}
            onChange={e => set('datum', e.target.value)}
            style={{
              width: '100%', height: 32, padding: '5px 10px',
              fontSize: 12, color: C.heading,
              backgroundColor: C.inputBg, border: `1px solid ${C.panelBdr}`,
              borderRadius: 6, marginTop: 4,
            }}
          />
        </div>

        <div>
          <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: C.muted }}>
            Provisorische Rechnung {isBund ? 'Bund' : 'Kanton'} (CHF)
          </label>
          {numInput('prov_steuer')}
        </div>

        {lbl.showKapital && (
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: C.muted }}>
              {lbl.provKapitalLabel}
            </label>
            {numInput('prov_kapital')}
          </div>
        )}

        <div>
          <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: C.muted }}>
            {lbl.gewinnLabel}
          </label>
          {numInput('def_gewinn')}
        </div>

        {lbl.showKapital && (
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: C.muted }}>
              {lbl.kapitalLabel}
            </label>
            {numInput('def_kapital')}
          </div>
        )}

        <div className="col-span-2">
          <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: C.muted }}>
            Bemerkung
          </label>
          <textarea
            value={eintrag.bemerkung || ''}
            onChange={e => set('bemerkung', e.target.value)}
            rows={2}
            placeholder="Notiz, Datum Einsprache, etc."
            style={{
              width: '100%', padding: '6px 10px', fontSize: 12, color: C.heading,
              backgroundColor: C.inputBg, border: `1px solid ${C.panelBdr}`,
              borderRadius: 6, marginTop: 4, resize: 'vertical', minHeight: 50,
            }}
          />
        </div>

        <div className="col-span-2">
          <label className="text-[10px] font-semibold uppercase tracking-widest mb-1 block" style={{ color: C.muted }}>
            Verknuepfte Veranlagungs-Dokumente
          </label>
          <BelegePicker
            value={eintrag.belege || []}
            onChange={belege => set('belege', belege)}
            customerId={kunde.id}
            defaultYear={steuerjahr}
            category="steuern"
            pickerTitle={`Veranlagung verknuepfen — ${kanton} ${steuerjahr}`}
            emptyText="Noch keine Veranlagung verknuepft"
            linkButtonText="Veranlagung verknuepfen"
          />
        </div>
      </div>
    </div>
  );
}

// ── JahrZeile: Eine Zeile in der Matrix mit Klick-zum-Bearbeiten ─────────────
function JahrZeile({ kunde, steuerjahr, jahresFelder, kantone, onSave, isOpen, openKanton, setOpenKanton }) {
  const [draft, setDraft] = useState(jahresFelder);
  const [dirty, setDirty] = useState(false);

  // Wenn jahresFelder von oben aktualisiert wird (nach successful save) → reset
  useEffect(() => { setDraft(jahresFelder); setDirty(false); }, [jahresFelder]);

  function setKantonEintrag(kanton, neuesEintrag) {
    setDraft(prev => ({ ...prev, [kanton]: neuesEintrag }));
    setDirty(true);
  }

  function save() {
    onSave(steuerjahr, draft);
    setDirty(false);
  }

  return (
    <div style={{ borderBottom: `1px solid ${C.panelBdr}`, backgroundColor: C.panelBg }}>
      {/* Matrix-Zeile */}
      <div className="flex items-stretch">
        <div style={{
          width: 90, flexShrink: 0, padding: '14px 12px',
          borderRight: `1px solid ${C.panelBdr}`, backgroundColor: C.accentBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, color: C.heading,
        }}>
          {steuerjahr}
        </div>

        <div className="flex-1 flex">
          {kantone.map(kt => {
            const eintrag = draft[kt] || {};
            const aktiv   = isOpen && openKanton === kt;
            const lbl     = labelsFor(kunde, kt);
            const hatDaten = eintrag.stand || eintrag.datum
              || eintrag.prov_steuer != null || eintrag.prov_kapital != null
              || eintrag.def_gewinn != null || eintrag.def_kapital != null
              || (eintrag.belege?.length > 0);
            return (
              <button
                key={kt}
                onClick={() => setOpenKanton(aktiv ? null : kt)}
                style={{
                  flex: 1, minWidth: 160, padding: '10px 12px', cursor: 'pointer',
                  borderRight: `1px solid ${C.panelBdr}`,
                  backgroundColor: aktiv ? C.accentBg : 'transparent',
                  textAlign: 'left',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (!aktiv) e.currentTarget.style.backgroundColor = C.rowHov; }}
                onMouseLeave={e => { if (!aktiv) e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span style={{ fontSize: 11, fontWeight: 700, color: aktiv ? C.accent : C.sub, letterSpacing: '0.04em' }}>
                    {kt === 'Bund' ? 'BUND (DBSt)' : kt.toUpperCase()}
                  </span>
                  {standBadge(eintrag.stand) || (
                    <span style={{ fontSize: 10, color: C.muted }}>–</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1" style={{ fontSize: 11, color: C.sub }}>
                  {eintrag.prov_steuer != null && eintrag.prov_steuer !== '' && (
                    <span title="Provisorische Rechnung">
                      prov. <span style={{ color: C.heading, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtCHF(eintrag.prov_steuer)}</span>
                    </span>
                  )}
                  {lbl.showKapital && eintrag.prov_kapital != null && eintrag.prov_kapital !== '' && (
                    <span title={lbl.provKapitalLabel}>
                      {lbl.provKapitalShort} <span style={{ color: C.heading, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtCHF(eintrag.prov_kapital)}</span>
                    </span>
                  )}
                  {eintrag.def_gewinn != null && eintrag.def_gewinn !== '' && (
                    <span title={lbl.gewinnLabel}>
                      {lbl.gewinnShort} <span style={{ color: C.heading, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtCHF(eintrag.def_gewinn)}</span>
                    </span>
                  )}
                  {lbl.showKapital && eintrag.def_kapital != null && eintrag.def_kapital !== '' && (
                    <span title={lbl.kapitalLabel}>
                      {lbl.kapitalShort} <span style={{ color: C.heading, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtCHF(eintrag.def_kapital)}</span>
                    </span>
                  )}
                  {eintrag.datum && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <Calendar className="w-3 h-3" />{new Date(eintrag.datum).toLocaleDateString('de-CH')}
                    </span>
                  )}
                  {eintrag.belege?.length > 0 && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <FileText className="w-3 h-3" />{eintrag.belege.length}
                    </span>
                  )}
                  {!hatDaten && <span style={{ fontStyle: 'italic', color: C.muted }}>noch keine Daten</span>}
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ width: 80, flexShrink: 0, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {dirty && (
            <button
              onClick={save}
              className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold text-white"
              style={{ backgroundColor: C.accent }}
            >
              <Save className="w-3 h-3" /> Speichern
            </button>
          )}
        </div>
      </div>

      {/* Editor-Slot fuer offenen Kanton */}
      {isOpen && openKanton && (
        <KantonEditor
          kunde={kunde}
          steuerjahr={steuerjahr}
          kanton={openKanton}
          eintrag={draft[openKanton] || {}}
          onChange={neuesEintrag => setKantonEintrag(openKanton, neuesEintrag)}
          onClose={() => setOpenKanton(null)}
        />
      )}
    </div>
  );
}

// ── KundeMatrix: Hauptansicht fuer einen Kunden ──────────────────────────────
function KundeMatrix({ kunde }) {
  const qc = useQueryClient();
  const [openYear, setOpenYear] = useState(null);
  const [openKanton, setOpenKanton] = useState(null);
  const [neuesJahr, setNeuesJahr] = useState(false);
  const [zusatzJahr, setZusatzJahr] = useState(CY - 5);
  const [showAddKanton, setShowAddKanton] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);

  // Daten laden
  const { data: alle = [], isLoading } = useQuery({
    queryKey: ['veranlagungen_kunde', kunde.id],
    queryFn:  () => db.listForCustomer(kunde.id),
  });

  // Kantonsliste pro Kunde laden (Default = Wohnsitz/Sitz-Kanton + Bund)
  const { data: dbKantone } = useQuery({
    queryKey: ['veranlagungen_kantone', kunde.id],
    queryFn:  () => db.getKantone(kunde.id),
  });
  // Lokale Kantonsliste — initialisiert aus DB oder Default
  const [kantone, setKantone] = useState(null);
  useEffect(() => {
    if (kantone !== null) return; // schon initialisiert
    if (dbKantone === undefined) return; // noch nicht geladen
    if (dbKantone && dbKantone.length > 0) {
      setKantone(dbKantone);
    } else {
      // Default: Sitz-Kanton + Bund (falls Sitz vorhanden)
      const def = kunde.kanton ? [kunde.kanton, 'Bund'] : ['Bund'];
      setKantone(def);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbKantone, kunde.id]);

  // Wenn Kunde wechselt: Kantonsliste reset
  useEffect(() => {
    setKantone(null);
    setOpenYear(null);
    setOpenKanton(null);
  }, [kunde.id]);

  // Speichern der Kantonsliste
  const kantoneSave = useMutation({
    mutationFn: (newList) => db.setKantone(kunde.id, newList),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['veranlagungen_kantone', kunde.id] });
    },
    onError: e => toast.error('Spalten konnten nicht gespeichert werden: ' + e.message),
  });
  function applyKantone(neueListe) {
    setKantone(neueListe);
    kantoneSave.mutate(neueListe);
  }

  const byYear = useMemo(() => {
    const m = {};
    for (const r of alle) m[r.steuerjahr] = r.felder || {};
    return m;
  }, [alle]);

  // Speichern-Mutation
  const saveMutation = useMutation({
    mutationFn: ({ jahr, felder }) => db.upsert(kunde.id, jahr, felder),
    onSuccess: () => {
      toast.success('Gespeichert');
      qc.invalidateQueries({ queryKey: ['veranlagungen_kunde', kunde.id] });
      qc.invalidateQueries({ queryKey: ['veranlagungen_ids'] });
    },
    onError: e => toast.error('Fehler: ' + e.message),
  });

  function handleSave(jahr, felder) {
    saveMutation.mutate({ jahr, felder });
  }

  // Welche Jahre sollen wir zeigen? Standard 4 + benutzerdef. Zusaetze
  const zusatzJahre = useMemo(() => {
    return Object.keys(byYear).map(Number).filter(y => !JAHRE.includes(y));
  }, [byYear]);
  const angezeigteJahre = [...JAHRE, ...zusatzJahre].sort((a, b) => b - a);

  const verfuegbareKantone = ALLE_KANTONE_PLUS_BUND.filter(k => !(kantone || []).includes(k));

  // Solange Kantonsliste noch nicht initialisiert (DB-Read pendant)
  if (kantone === null) {
    return (
      <main className="flex-1 flex items-center justify-center" style={{ color: C.muted, fontSize: 13 }}>
        Lädt…
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-5 py-3 flex items-center justify-between"
        style={{ borderBottom: `1px solid ${C.panelBdr}`, backgroundColor: C.panelBg }}>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold" style={{ color: C.heading }}>{displayName(kunde)}</h2>
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 8,
              backgroundColor: isPrivatperson(kunde) ? '#fef3c7' : C.accentBg,
              color: isPrivatperson(kunde) ? '#92400e' : C.accent,
              letterSpacing: '0.04em',
            }}>{isPrivatperson(kunde) ? 'NP' : 'JP'}</span>
          </div>
          <p className="text-xs" style={{ color: C.sub }}>
            {[kunde.plz, kunde.ort].filter(Boolean).join(' ')}
            {kunde.kanton ? ` · ${kunde.kanton}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Spalten verwalten */}
          <div className="relative">
            <button
              onClick={() => setShowAddKanton(v => !v)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs"
              style={{ border: `1px solid ${C.panelBdr}`, color: C.sub, backgroundColor: C.panelBg }}
            >
              <Plus className="w-3 h-3" /> Kanton/Spalte
            </button>
            {showAddKanton && (
              <div className="absolute top-9 right-0 z-50 rounded-xl overflow-hidden shadow-lg"
                style={{ background: C.panelBg, border: `1px solid ${C.panelBdr}`, width: 200, maxHeight: 280, overflowY: 'auto' }}>
                {verfuegbareKantone.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-center" style={{ color: C.muted }}>Alle hinzugefuegt</div>
                ) : verfuegbareKantone.map(k => (
                  <button
                    key={k}
                    onClick={() => { applyKantone([...(kantone || []), k]); setShowAddKanton(false); }}
                    className="w-full text-left px-3 py-2 text-xs"
                    style={{ color: C.heading }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = C.rowHov}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    {k === 'Bund' ? 'Bund (DBSt)' : k}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Zusaetzliches Jahr hinzufuegen */}
          {neuesJahr ? (
            <div className="flex items-center gap-1">
              <input
                type="number" min="2010" max="2099"
                value={zusatzJahr}
                onChange={e => setZusatzJahr(parseInt(e.target.value) || zusatzJahr)}
                className="w-20 rounded-lg px-2 py-1 text-xs text-center outline-none"
                style={{ border: `1px solid ${C.accent}`, backgroundColor: C.inputBg, color: C.heading }}
              />
              <button onClick={() => { handleSave(zusatzJahr, byYear[zusatzJahr] || {}); setNeuesJahr(false); }}
                className="px-2 py-1 rounded-lg text-xs font-semibold text-white" style={{ backgroundColor: C.accent }}>
                <Check className="w-3 h-3" />
              </button>
              <button onClick={() => setNeuesJahr(false)}>
                <X className="w-3.5 h-3.5" style={{ color: C.muted }} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setNeuesJahr(true)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs"
              style={{ color: C.sub, border: `1px solid ${C.panelBdr}` }}
            >
              <Plus className="w-3 h-3" /> Jahr
            </button>
          )}
        </div>
      </div>

      {/* Spaltenkopf — Drag-and-Drop Reordering via HTML5 native */}
      <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: `1px solid ${C.panelBdr}`, backgroundColor: C.accentBg }}>
        <div style={{ width: 90, flexShrink: 0, padding: '8px 12px', borderRight: `1px solid ${C.panelBdr}`, fontSize: 11, fontWeight: 700, color: C.accent, letterSpacing: '0.04em' }}>JAHR</div>
        <div className="flex-1 flex">
          {kantone.map((kt, idx) => (
            <div
              key={kt}
              draggable
              onDragStart={() => setDragIdx(idx)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => {
                if (dragIdx == null || dragIdx === idx) return;
                const next = [...kantone];
                const [moved] = next.splice(dragIdx, 1);
                next.splice(idx, 0, moved);
                applyKantone(next);
                setDragIdx(null);
              }}
              onDragEnd={() => setDragIdx(null)}
              style={{
                flex: 1, minWidth: 160, padding: '8px 12px',
                borderRight: `1px solid ${C.panelBdr}`,
                fontSize: 11, fontWeight: 700, color: C.accent, letterSpacing: '0.04em',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                cursor: 'grab',
                opacity: dragIdx === idx ? 0.4 : 1,
                backgroundColor: dragIdx != null && dragIdx !== idx ? C.accent + '22' : 'transparent',
                transition: 'background 0.1s, opacity 0.1s',
              }}
              title="Per Drag & Drop verschieben"
            >
              <div className="flex items-center gap-1">
                <GripVertical className="w-3 h-3" style={{ color: C.muted, opacity: 0.6 }} />
                <span>{kt === 'Bund' ? 'BUND (DBSt)' : kt.toUpperCase()}</span>
              </div>
              <button
                onClick={() => applyKantone(kantone.filter(x => x !== kt))}
                title="Spalte entfernen"
                style={{ color: C.muted, opacity: 0.5 }}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
        <div style={{ width: 80, flexShrink: 0, padding: '8px 12px', fontSize: 11, fontWeight: 700, color: C.accent }}></div>
      </div>

      {/* Matrix-Zeilen */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="text-sm text-center py-8" style={{ color: C.muted }}>Laedt…</div>
        ) : (
          angezeigteJahre.map(jahr => (
            <JahrZeile
              key={jahr}
              kunde={kunde}
              steuerjahr={jahr}
              jahresFelder={byYear[jahr] || EMPTY_FELDER}
              kantone={kantone}
              onSave={handleSave}
              isOpen={openYear === jahr}
              openKanton={openYear === jahr ? openKanton : null}
              setOpenKanton={kt => { setOpenYear(jahr); setOpenKanton(kt); }}
            />
          ))
        )}
      </div>
    </main>
  );
}

// ── Hauptkomponente ──────────────────────────────────────────────────────────
export default function Veranlagungen() {
  const [search,    setSearch]    = useState('');
  const [selected,  setSelected]  = useState(null);
  const [pendingIds, setPendingIds] = useState(new Set());
  const [addingNew, setAddingNew] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addHighlight, setAddHighlight] = useState(0); // Index fuer ArrowKey-Nav
  const addRef = useRef(null);
  const highlightRef = useRef(null); // gehoeriges DOM-Element zum Auto-Scroll

  // Schliessen, wenn aussen geklickt
  useEffect(() => {
    if (!addingNew) return;
    function handle(e) {
      if (addRef.current && !addRef.current.contains(e.target)) setAddingNew(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [addingNew]);

  // Highlight-Index zuruecksetzen, wenn Suchbegriff sich aendert
  useEffect(() => { setAddHighlight(0); }, [addSearch, addingNew]);

  // Aktiv markierten Eintrag in den sichtbaren Bereich scrollen
  useEffect(() => {
    if (highlightRef.current?.scrollIntoView) {
      highlightRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [addHighlight]);

  // ALLE Kunden (juristische + natuerliche Personen)
  const { data: alleKunden = [] } = useQuery({
    queryKey: ['customers_all_veranlagungen'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, company_name, vorname, nachname, ort, plz, strasse, kanton, person_type, aktiv')
        .order('company_name');
      if (error) throw new Error(error.message);
      return (data || []).filter(k => k.aktiv !== false);
    },
  });

  // Kunden mit bestehenden Veranlagungs-Eintraegen
  const { data: mitDaten = [] } = useQuery({
    queryKey: ['veranlagungen_ids'],
    queryFn: () => db.listCustomerIds(),
  });
  const mitDatenSet = new Set(mitDaten);

  const listeKunden = alleKunden.filter(k => mitDatenSet.has(k.id) || pendingIds.has(k.id));
  const gefiltert = listeKunden.filter(k => !search || displayName(k).toLowerCase().includes(search.toLowerCase()));

  const verfuegbar = alleKunden.filter(k => !mitDatenSet.has(k.id) && !pendingIds.has(k.id));
  const verfuegbarGefiltert = verfuegbar.filter(k =>
    !addSearch || displayName(k).toLowerCase().includes(addSearch.toLowerCase())
  );

  function selectKunde(k) {
    setSelected(k);
  }

  function addKunde(k) {
    setPendingIds(prev => new Set([...prev, k.id]));
    selectKunde(k);
    setAddingNew(false);
    setAddSearch('');
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ backgroundColor: C.pageBg }}>
      {/* Linke Sidebar */}
      <aside className="w-64 flex-shrink-0 flex flex-col border-r overflow-hidden"
        style={{ backgroundColor: C.pageBg, borderColor: C.panelBdr }}>

        <div className="px-3 py-3 flex-shrink-0" style={{ borderBottom: `1px solid ${C.panelBdr}` }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4" style={{ color: C.accent }} />
              <span className="text-sm font-semibold" style={{ color: C.heading }}>Veranlagungen</span>
            </div>

            <div className="relative" ref={addRef}>
              <button
                onClick={() => { setAddingNew(v => !v); setAddSearch(''); }}
                className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
                title="Firma hinzufuegen"
                style={{ backgroundColor: addingNew ? C.accent : C.accentBg, color: addingNew ? '#fff' : C.accent }}
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
                        onKeyDown={e => {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setAddHighlight(i => Math.min(verfuegbarGefiltert.length - 1, i + 1));
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setAddHighlight(i => Math.max(0, i - 1));
                          } else if (e.key === 'Enter') {
                            e.preventDefault();
                            const pick = verfuegbarGefiltert[addHighlight];
                            if (pick) addKunde(pick);
                          } else if (e.key === 'Escape') {
                            setAddingNew(false);
                          }
                        }}
                        placeholder="Firma suchen… (↑↓ Enter)"
                        className="w-full rounded-lg pl-7 pr-3 py-1.5 text-xs outline-none"
                        style={{ backgroundColor: C.inputBg, border: `1px solid ${C.panelBdr}`, color: C.heading }}
                      />
                    </div>
                  </div>
                  <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                    {verfuegbarGefiltert.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-center" style={{ color: C.muted }}>Keine weiteren Firmen</div>
                    ) : verfuegbarGefiltert.map((k, idx) => {
                      const focused = idx === addHighlight;
                      return (
                        <button
                          key={k.id}
                          ref={focused ? highlightRef : null}
                          onClick={() => addKunde(k)}
                          onMouseEnter={() => setAddHighlight(idx)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs"
                          style={{
                            color: C.heading,
                            backgroundColor: focused ? C.accent + '20' : 'transparent',
                          }}
                        >
                          {isPrivatperson(k)
                            ? <User2 className="w-3 h-3 flex-shrink-0" style={{ color: '#92400e' }} />
                            : <Building2 className="w-3 h-3 flex-shrink-0" style={{ color: C.muted }} />}
                          <span className="flex-1 truncate">{displayName(k)}</span>
                          {k.ort && <span className="text-[9px]" style={{ color: C.muted }}>{k.ort}</span>}
                        </button>
                      );
                    })}
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
              <Receipt className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p>Noch keine Eintraege</p>
              <p className="mt-1 opacity-60">Mit «+» Firma hinzufuegen</p>
            </div>
          )}
          {gefiltert.map(k => {
            const isActive = k.id === selected?.id;
            const isPending = pendingIds.has(k.id) && !mitDatenSet.has(k.id);
            return (
              <button
                key={k.id}
                onClick={() => selectKunde(k)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs"
                style={{
                  backgroundColor: isActive ? C.accent + '20' : 'transparent',
                  color: isActive ? C.accent : C.heading,
                  fontWeight: isActive ? 600 : 400,
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = C.rowHov; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  backgroundColor: isPending ? C.muted + '60' : (isPrivatperson(k) ? '#f59e0b' : C.accent + '99'),
                }} title={isPrivatperson(k) ? 'Natürliche Person' : 'Juristische Person'} />
                <span className="flex-1 truncate">{displayName(k)}</span>
                {k.ort && <span className="text-[9px] truncate max-w-[55px]" style={{ color: C.muted }}>{k.ort}</span>}
                {isActive && <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: C.accent }} />}
              </button>
            );
          })}
        </div>
      </aside>

      {/* Hauptbereich */}
      {!selected ? (
        <main className="flex-1 flex flex-col items-center justify-center gap-3" style={{ color: C.muted }}>
          <Receipt className="w-12 h-12 opacity-20" />
          <p className="text-sm">Firma aus der Liste waehlen oder mit «+» hinzufuegen</p>
        </main>
      ) : (
        <KundeMatrix kunde={selected} />
      )}
    </div>
  );
}
