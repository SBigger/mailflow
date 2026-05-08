// Wiederverwendbare Belege-Verknüpfung – Pattern aus Abschlussdokumentation.jsx.
// Wird sowohl in der Steuern-Maske (potenziell) als auch im Veranlagungs-Tool
// genutzt. Speichert Doc-Refs (id, name, filename, storage_path, year, category,
// file_type) im aufrufenden state.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Paperclip, X, Plus, CheckCircle2, ExternalLink } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { toast } from 'sonner';

const BUCKET = 'dokumente';

const T = {
  panelBdr: '#ccd8cc', heading: '#1a3a1a', sub: '#4a6a4a',
  accent: '#5b8a5b', accentBg: '#eef5ee', muted: '#9ca3af',
  inputBg: '#f8faf8',
};

function fileLabel(ft, fn) {
  if (ft?.includes('pdf')) return { label: 'PDF', bg: '#fee2e2', col: '#dc2626' };
  const ext = fn?.split('.').pop()?.toUpperCase() || 'DOC';
  return { label: ext, bg: '#dbeafe', col: '#1d4ed8' };
}

export default function BelegePicker({
  value,
  onChange,
  customerId,
  defaultYear        = null,    // wenn gesetzt: Picker startet mit Year-Filter
  category           = null,    // Filter z.B. 'steuern'
  pickerTitle        = 'Dokument verknüpfen',
  emptyText          = 'Noch keine Dokumente verknüpft',
  linkButtonText     = 'Dokument verknüpfen',
  multiline          = true,    // Chip-Liste umbrechen lassen
}) {
  const belege = Array.isArray(value) ? value : [];
  const [showPicker, setShowPicker] = useState(false);
  const [search,     setSearch]     = useState('');
  const [docs,       setDocs]       = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [yearFilter, setYearFilter] = useState(defaultYear);
  const linkedIds = new Set(belege.map(b => b.id));

  // Beim Wechsel von Kunde oder Year-Filter: docs leeren → Reload
  useEffect(() => { setDocs([]); }, [customerId, yearFilter]);

  // Dokumente laden, wenn Picker öffnet
  useEffect(() => {
    if (!showPicker || !customerId || docs.length > 0) return;
    setLoading(true);
    let q = supabase.from('dokumente')
      .select('id, name, filename, storage_path, category, year, file_type')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(500);
    if (category)   q = q.eq('category', category);
    if (yearFilter) q = q.eq('year', yearFilter);
    q.then(({ data }) => { setDocs(data || []); setLoading(false); });
  }, [showPicker, customerId, yearFilter, category, docs.length]);

  function addBeleg(doc) {
    if (linkedIds.has(doc.id)) return;
    onChange([...belege, {
      id: doc.id, name: doc.name, filename: doc.filename,
      storage_path: doc.storage_path, year: doc.year,
      category: doc.category, file_type: doc.file_type,
    }]);
  }

  function removeBeleg(id) {
    onChange(belege.filter(b => b.id !== id));
  }

  async function openDoc(beleg) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(beleg.storage_path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
    else toast.error('Dokument konnte nicht geöffnet werden');
  }

  const filtered = docs.filter(d => !search ||
    d.name?.toLowerCase().includes(search.toLowerCase()) ||
    d.filename?.toLowerCase().includes(search.toLowerCase())
  );

  const pickerModal = showPicker && createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={e => { if (e.target === e.currentTarget) setShowPicker(false); }}>
      <div style={{ backgroundColor: '#fff', borderRadius: 14, boxShadow: '0 24px 64px rgba(0,0,0,0.22)', width: 'min(820px, 94vw)', maxHeight: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.panelBdr}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Paperclip className="w-4 h-4" style={{ color: T.accent }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: T.heading, flex: 1 }}>{pickerTitle}</span>
          <span style={{ fontSize: 12, color: T.sub }}>
            {category ? `Kategorie: ${category}` : 'Alle Kategorien'} · {yearFilter ? `Jahr ${yearFilter}` : 'Alle Jahre'} · {filtered.length} Dokumente
          </span>
          <button onClick={() => setShowPicker(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, padding: '0 4px' }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div style={{ padding: '10px 18px', borderBottom: `1px solid ${T.panelBdr}`, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Dokument suchen…"
            style={{ flex: 1, fontSize: 13, padding: '7px 12px', borderRadius: 8, border: `1px solid ${T.panelBdr}`, outline: 'none' }} />
          <button onClick={() => setYearFilter(yearFilter ? null : (defaultYear || null))}
            title={yearFilter ? 'Alle Jahre zeigen' : `Nur Jahr ${defaultYear}`}
            style={{ fontSize: 11, padding: '6px 10px', borderRadius: 6, border: `1px solid ${T.panelBdr}`, background: yearFilter ? T.accentBg : '#fff', color: yearFilter ? T.accent : T.sub, cursor: 'pointer', fontWeight: 600 }}>
            {yearFilter ? `Jahr ${yearFilter}` : 'Alle Jahre'}
          </button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading
            ? <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: T.sub }}>Lädt…</div>
            : filtered.length === 0
              ? <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: T.sub }}>Keine Dokumente gefunden</div>
              : filtered.map(doc => {
                  const fl = fileLabel(doc.file_type, doc.filename);
                  const already = linkedIds.has(doc.id);
                  return (
                    <div key={doc.id} onClick={() => { if (!already) addBeleg(doc); }}
                      style={{ padding: '10px 18px', cursor: already ? 'default' : 'pointer', opacity: already ? 0.5 : 1, borderBottom: `1px solid ${T.panelBdr}`, display: 'flex', alignItems: 'center', gap: 12, transition: 'background 0.1s' }}
                      onMouseEnter={e => { if (!already) e.currentTarget.style.backgroundColor = T.accent + '10'; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4, backgroundColor: fl.bg, color: fl.col, flexShrink: 0, minWidth: 36, textAlign: 'center' }}>{fl.label}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: T.heading, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</div>
                        <div style={{ fontSize: 11, color: T.sub, marginTop: 2 }}>{doc.filename}</div>
                      </div>
                      <div style={{ flexShrink: 0, textAlign: 'right' }}>
                        {doc.year && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, backgroundColor: T.accent + '15', color: T.accent }}>{doc.year}</span>}
                        {doc.category && <div style={{ fontSize: 10, color: T.sub, marginTop: 3 }}>{doc.category}</div>}
                      </div>
                      {already
                        ? <CheckCircle2 className="w-3.5 h-3.5" style={{ color: '#16a34a', flexShrink: 0 }} />
                        : <Plus className="w-3.5 h-3.5" style={{ color: T.accent, flexShrink: 0 }} />}
                    </div>
                  );
                })
          }
        </div>
      </div>
    </div>,
    document.body
  );

  return (
    <div style={{ width: '100%' }}>
      {pickerModal}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: T.sub }}>
          {belege.length === 0 ? emptyText : `${belege.length} Dokument${belege.length === 1 ? '' : 'e'} verknüpft`}
        </span>
        <button
          type="button"
          onClick={() => setShowPicker(true)}
          disabled={!customerId}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
            cursor: customerId ? 'pointer' : 'not-allowed',
            backgroundColor: T.accent + '14', border: `1px solid ${T.accent}40`, color: T.accent,
            opacity: customerId ? 1 : 0.5,
          }}>
          <Plus className="w-3 h-3" /> {linkButtonText}
        </button>
      </div>
      {belege.length > 0 && (
        <div style={{ display: 'flex', flexWrap: multiline ? 'wrap' : 'nowrap', gap: 5 }}>
          {belege.map(b => {
            const fl = fileLabel(b.file_type, b.filename);
            return (
              <div key={b.id} style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '3px 6px 3px 5px',
                borderRadius: 6, backgroundColor: T.inputBg, border: `1px solid ${T.panelBdr}`, fontSize: 11,
              }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 4px', borderRadius: 3, backgroundColor: fl.bg, color: fl.col, flexShrink: 0 }}>{fl.label}</span>
                <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.heading }} title={b.name}>{b.name}</span>
                {b.year && <span style={{ color: T.sub, fontSize: 10, flexShrink: 0 }}>{b.year}</span>}
                <button onClick={() => openDoc(b)} title="Öffnen"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.accent, padding: '0 2px', display: 'flex', alignItems: 'center' }}>
                  <ExternalLink className="w-3 h-3" />
                </button>
                <button onClick={() => removeBeleg(b.id)} title="Verknüpfung entfernen"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, fontSize: 14, padding: '0 1px', opacity: 0.55, lineHeight: 1 }}>×</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
