import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMandant } from '../contexts/MandantContext';
import { supabase } from '@/api/supabaseClient';

const STATUS_LABEL = {
  pending:      { label: 'Neu',       bg: '#fef3c7', color: '#92400e' },
  verarbeitet:  { label: 'Verbucht',  bg: '#dcfce7', color: '#166534' },
  ignoriert:    { label: 'Ignoriert', bg: '#e4e4ea', color: '#4a4a5a' },
};

const SOURCE_LABEL = {
  manual:  { label: '↑ Upload',  color: '#6b826b' },
  imap:    { label: '✉ IMAP',    color: '#2e4a7d' },
  webhook: { label: '⚡ Webhook', color: '#7c3aed' },
};

const td  = { padding: '10px 14px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5, verticalAlign: 'middle' };
const hdr = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6b826b', padding: '9px 14px', borderBottom: '2px solid #e4e9e4', textAlign: 'left', background: '#fff' };

function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Manueller Upload ─────────────────────────────────────────────
async function uploadFiles(files, mandantId) {
  const results = [];
  for (const file of files) {
    const uuid = crypto.randomUUID();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${mandantId}/${uuid}_${safeName}`;

    const { error: uploadErr } = await supabase.storage
      .from('fibu-inbox')
      .upload(storagePath, file, { contentType: file.type, upsert: false });

    if (uploadErr) {
      console.error('Upload-Fehler:', uploadErr);
      results.push({ ok: false, name: file.name, error: uploadErr.message });
      continue;
    }

    const { data, error: insertErr } = await supabase
      .from('fibu_rechnung_inbox')
      .insert({
        mandant_id:   mandantId,
        source:       'manual',
        pdf_path:     storagePath,
        pdf_name:     file.name,
        betreff:      file.name.replace(/\.[^.]+$/, ''), // Dateiname ohne Extension als Betreff
        received_at:  new Date().toISOString(),
      })
      .select()
      .single();

    if (insertErr) {
      console.error('Insert-Fehler:', insertErr);
      results.push({ ok: false, name: file.name, error: insertErr.message });
    } else {
      results.push({ ok: true, name: file.name, id: data.id });
    }
  }
  return results;
}

// ── Upload-Dropzone ──────────────────────────────────────────────
function UploadDropzone({ mandantId, onDone }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState([]); // {name, status}
  const fileRef = useRef();

  const handleFiles = async (files) => {
    if (!files?.length) return;
    const arr = Array.from(files).filter(f =>
      ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(f.type)
    );
    if (!arr.length) return;
    setUploading(true);
    setProgress(arr.map(f => ({ name: f.name, status: 'upload' })));
    const results = await uploadFiles(arr, mandantId);
    setProgress(results.map(r => ({ name: r.name, status: r.ok ? 'ok' : 'error', error: r.error })));
    setUploading(false);
    setTimeout(() => { setProgress([]); onDone(); }, 1800);
  };

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
      style={{
        border: `2px dashed ${dragging ? '#7a9b7f' : '#c5d4ea'}`,
        borderRadius: 12,
        padding: '24px 20px',
        textAlign: 'center',
        background: dragging ? '#f0f7f0' : '#f7faff',
        transition: 'all .15s',
        cursor: uploading ? 'wait' : 'pointer',
      }}
      onClick={() => !uploading && fileRef.current?.click()}
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="application/pdf,image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={e => handleFiles(e.target.files)}
      />
      {uploading || progress.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {progress.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: p.status === 'ok' ? '#166534' : p.status === 'error' ? '#991b1b' : '#4a5a4a' }}>
              <span>{p.status === 'ok' ? '✅' : p.status === 'error' ? '❌' : '⏳'}</span>
              <span style={{ flex: 1, textAlign: 'left', fontFamily: 'monospace', fontSize: 11 }}>{p.name}</span>
              {p.error && <span style={{ fontSize: 10.5, color: '#991b1b' }}>{p.error}</span>}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#2e4a7d', marginBottom: 4 }}>
            PDFs hier ablegen oder klicken
          </div>
          <div style={{ fontSize: 11.5, color: '#6b826b' }}>
            PDF, JPG, PNG, WEBP — mehrere Dateien gleichzeitig möglich
          </div>
        </>
      )}
    </div>
  );
}

// ── Hauptkomponente ──────────────────────────────────────────────
export default function RechnungInbox() {
  const { mandant, canWrite } = useMandant();
  const navigate = useNavigate();

  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState('pending');
  const [selected, setSelected]   = useState(null);
  const [pdfUrl, setPdfUrl]       = useState(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [inboxEmail, setInboxEmail] = useState('');

  const load = useCallback(async () => {
    if (!mandant) return;
    setLoading(true);
    let q = supabase
      .from('fibu_rechnung_inbox')
      .select('*')
      .eq('mandant_id', mandant.id)
      .order('received_at', { ascending: false });
    if (filter !== 'alle') q = q.eq('status', filter);
    const { data } = await q;
    setItems(data ?? []);
    setLoading(false);
    if (mandant.inbox_code) setInboxEmail(`rechnungen+${mandant.inbox_code}@smartis.me`);
  }, [mandant?.id, filter]);

  useEffect(() => { load(); }, [load]);

  const handleSelect = async (item) => {
    setSelected(item);
    setPdfUrl(null);
    if (!item.pdf_path) return;
    setLoadingPdf(true);
    try {
      const { data } = await supabase.storage
        .from('fibu-inbox')
        .createSignedUrl(item.pdf_path, 600);
      setPdfUrl(data?.signedUrl ?? null);
    } finally {
      setLoadingPdf(false);
    }
  };

  const handleVerbuchen = () => {
    if (!selected) return;
    navigate(`/fibu/${mandant.id}/kreditoren/erfassen?inboxId=${selected.id}`);
  };

  const handleStatusChange = async (newStatus) => {
    if (!selected) return;
    await supabase.from('fibu_rechnung_inbox').update({ status: newStatus }).eq('id', selected.id);
    setSelected(prev => ({ ...prev, status: newStatus }));
    load();
  };

  const pendingCount = items.filter(i => i.status === 'pending').length;
  const filterTabs = [
    ['pending',     `Neu${pendingCount > 0 ? ` (${pendingCount})` : ''}`],
    ['verarbeitet', 'Verbucht'],
    ['ignoriert',   'Ignoriert'],
    ['alle',        'Alle'],
  ];

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* ── Linke Spalte: Liste ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid #e4e9e4' }}>

        {/* Inbox-Email Info */}
        {inboxEmail && (
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: '#f0f7ff', borderBottom: '1px solid #c5d4ea' }}>
            <svg style={{ width: 14, height: 14, flexShrink: 0 }} viewBox="0 0 24 24" fill="none" stroke="#2e4a7d" strokeWidth={2}>
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
            </svg>
            <span style={{ fontSize: 11.5, color: '#1e3a6e' }}>
              <strong>Später via IMAP:</strong>{' '}Verbindet sich automatisch zu Ihrem Postfach und importiert Rechnungs-PDFs
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 10.5, background: '#dbeafe', color: '#1e40af', padding: '2px 7px', borderRadius: 4, fontWeight: 600 }}>bereit zur Konfiguration</span>
          </div>
        )}

        {/* Toolbar */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#fff', borderBottom: '1px solid #e4e9e4', flexWrap: 'wrap' }}>
          {/* Status-Tabs */}
          <div style={{ display: 'flex', gap: 2, background: '#f0f3f0', borderRadius: 8, padding: 3 }}>
            {filterTabs.map(([v, l]) => (
              <button
                key={v}
                onClick={() => setFilter(v)}
                style={{
                  padding: '4px 10px', borderRadius: 6, border: 'none', fontSize: 11.5, fontWeight: 500,
                  cursor: 'pointer',
                  background: filter === v ? '#fff' : 'transparent',
                  color: filter === v ? '#1a1a2e' : '#6b826b',
                  boxShadow: filter === v ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
                }}
              >{l}</button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <button
            onClick={load}
            style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#4a5a4a' }}
          >↻</button>
          {canWrite && (
            <button
              onClick={() => setShowUpload(u => !u)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 14px', borderRadius: 8, border: 'none',
                background: showUpload ? '#5a7b5f' : '#7a9b7f',
                color: '#fff', fontSize: 12.5, fontWeight: 500, cursor: 'pointer'
              }}
            >
              <svg style={{ width: 13, height: 13 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              PDFs importieren
            </button>
          )}
        </div>

        {/* Upload-Dropzone */}
        {showUpload && canWrite && (
          <div style={{ flexShrink: 0, padding: '12px 14px', background: '#f7faff', borderBottom: '1px solid #c5d4ea' }}>
            <UploadDropzone
              mandantId={mandant.id}
              onDone={() => { setShowUpload(false); load(); }}
            />
          </div>
        )}

        {/* Tabelle */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>Lädt…</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#94a394' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>
                {filter === 'pending' ? '📬' : filter === 'verarbeitet' ? '✅' : '📭'}
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: '#6b826b', marginBottom: 6 }}>
                {filter === 'pending' ? 'Keine neuen Rechnungen' : filter === 'verarbeitet' ? 'Noch nichts verbucht' : 'Nichts hier'}
              </div>
              {filter === 'pending' && (
                <div style={{ fontSize: 12, color: '#b0c0b0', maxWidth: 300, margin: '0 auto', lineHeight: 1.6 }}>
                  Laden Sie PDFs mit dem Button «PDFs importieren» hoch — oder richten Sie später den IMAP-Abruf ein.
                </div>
              )}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={hdr}>Eingang</th>
                <th style={hdr}>Von / Datei</th>
                <th style={hdr}>Betreff</th>
                <th style={hdr}>Quelle</th>
                <th style={hdr}>Status</th>
              </tr></thead>
              <tbody>
                {items.map(item => {
                  const st  = STATUS_LABEL[item.status]  ?? STATUS_LABEL.pending;
                  const src = SOURCE_LABEL[item.source]  ?? SOURCE_LABEL.manual;
                  const isPending = item.status === 'pending';
                  return (
                    <tr
                      key={item.id}
                      onClick={() => handleSelect(item)}
                      style={{
                        cursor: 'pointer',
                        background: selected?.id === item.id ? '#f0f7f0' : isPending ? '#fffef8' : undefined,
                      }}
                      onMouseEnter={e => { if (selected?.id !== item.id) e.currentTarget.querySelectorAll('td').forEach(c => c.style.background = '#f7faf7'); }}
                      onMouseLeave={e => { if (selected?.id !== item.id) e.currentTarget.querySelectorAll('td').forEach(c => c.style.background = ''); }}
                    >
                      <td style={{ ...td, fontSize: 11.5, color: '#6b826b', whiteSpace: 'nowrap' }}>
                        {formatDate(item.received_at)}
                      </td>
                      <td style={td}>
                        {item.source === 'manual' ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ fontSize: 14 }}>📄</span>
                            <span style={{ fontSize: 12, color: '#4a5a4a' }}>{item.pdf_name || '—'}</span>
                          </div>
                        ) : (
                          <>
                            <div style={{ fontWeight: 500, fontSize: 12.5 }}>{item.sender_name || item.sender_email || '—'}</div>
                            {item.sender_name && <div style={{ fontSize: 11, color: '#94a394' }}>{item.sender_email}</div>}
                          </>
                        )}
                      </td>
                      <td style={{ ...td, fontSize: 12, color: '#4a5a4a' }}>
                        {item.betreff || '(kein Betreff)'}
                      </td>
                      <td style={td}>
                        <span style={{ fontSize: 10.5, fontWeight: 500, color: src.color }}>{src.label}</span>
                      </td>
                      <td style={td}>
                        <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 6, fontWeight: 600, background: st.bg, color: st.color }}>
                          {st.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Rechte Spalte: Detail + PDF ── */}
      <div style={{ flexShrink: 0, width: 400, display: 'flex', flexDirection: 'column', background: '#fff' }}>
        {selected ? (
          <>
            {/* Header */}
            <div style={{ flexShrink: 0, padding: '14px 16px', borderBottom: '1px solid #e4e9e4' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  {selected.source === 'manual' ? (
                    <div style={{ fontWeight: 700, fontSize: 13 }}>📄 {selected.pdf_name}</div>
                  ) : (
                    <>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{selected.sender_name || selected.sender_email}</div>
                      {selected.sender_name && <div style={{ fontSize: 11, color: '#94a394' }}>{selected.sender_email}</div>}
                    </>
                  )}
                  <div style={{ fontSize: 12, color: '#4a5a4a', marginTop: 3 }}>{selected.betreff || '(kein Betreff)'}</div>
                  <div style={{ fontSize: 11, color: '#94a394', marginTop: 2 }}>{formatDate(selected.received_at)}</div>
                </div>
                <span style={{ flexShrink: 0, fontSize: 10.5, padding: '2px 8px', borderRadius: 6, fontWeight: 600, background: STATUS_LABEL[selected.status]?.bg, color: STATUS_LABEL[selected.status]?.color }}>
                  {STATUS_LABEL[selected.status]?.label}
                </span>
              </div>

              {selected.email_body && (
                <div style={{ padding: '8px 10px', background: '#f7faf7', borderRadius: 6, fontSize: 11.5, color: '#4a5a4a', maxHeight: 70, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                  {selected.email_body}
                </div>
              )}
            </div>

            {/* PDF Vorschau */}
            <div style={{ flex: 1, position: 'relative', background: '#f0f2f0', overflow: 'hidden' }}>
              {loadingPdf && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(248,250,248,.8)', zIndex: 1 }}>
                  <span style={{ fontSize: 12, color: '#94a394' }}>PDF lädt…</span>
                </div>
              )}
              {pdfUrl ? (
                <iframe
                  src={pdfUrl}
                  style={{ width: '100%', height: '100%', border: 'none' }}
                  title="Rechnung Vorschau"
                />
              ) : (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#94a394' }}>
                  <div style={{ fontSize: 40 }}>📄</div>
                  <div style={{ fontSize: 12 }}>{selected.pdf_name || 'Kein Anhang'}</div>
                </div>
              )}
            </div>

            {/* Aktionsleiste */}
            {canWrite && (
              <div style={{ flexShrink: 0, padding: '12px 14px', borderTop: '1px solid #e4e9e4', background: '#fff' }}>
                {selected.status === 'pending' ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => handleStatusChange('ignoriert')}
                      style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12.5, cursor: 'pointer', color: '#4a4a5a' }}
                    >Ignorieren</button>
                    <button
                      onClick={handleVerbuchen}
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                    >
                      <svg style={{ width: 14, height: 14 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
                      </svg>
                      Rechnung erfassen
                    </button>
                  </div>
                ) : selected.status === 'ignoriert' ? (
                  <button
                    onClick={() => handleStatusChange('pending')}
                    style={{ width: '100%', padding: '7px 14px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12.5, cursor: 'pointer', color: '#4a5a4a' }}
                  >↩ Reaktivieren</button>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#166534' }}>
                    <span>✅</span>
                    <span>Als Kreditoren-Beleg verbucht</span>
                    {selected.beleg_id && (
                      <button
                        onClick={() => navigate(`/fibu/${mandant.id}/kreditoren/journal`)}
                        style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, border: '1px solid #86efac', background: '#dcfce7', color: '#166534', fontSize: 11.5, cursor: 'pointer' }}
                      >Journal →</button>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          /* Leer-Zustand mit IMAP-Info */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 28 }}>
            <div style={{ fontSize: 44 }}>📬</div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#4a5a4a', textAlign: 'center' }}>Eingangspostfach</div>

            {/* Drei Wege erklärt */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
              {[
                { icon: '↑', title: 'Manueller Upload', desc: 'PDF direkt hochladen — jetzt verfügbar', done: true },
                { icon: '✉', title: 'IMAP-Abruf', desc: 'Automatisch aus Ihrem Postfach (kommt)', done: false },
                { icon: '⚡', title: 'E-Mail-Webhook', desc: 'Via Mailgun / Postmark (kommt)', done: false },
              ].map(item => (
                <div key={item.title} style={{ display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 8, background: item.done ? '#f0f7f0' : '#f7f7f7', border: `1px solid ${item.done ? '#b6d8bc' : '#e4e4ea'}`, opacity: item.done ? 1 : 0.7 }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{item.icon}</span>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: '#1a1a2e' }}>{item.title}</div>
                    <div style={{ fontSize: 11.5, color: '#6b826b', marginTop: 1 }}>{item.desc}</div>
                  </div>
                  {item.done && <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#166534', fontWeight: 600, alignSelf: 'center' }}>✓ aktiv</span>}
                </div>
              ))}
            </div>

            <div style={{ fontSize: 11.5, color: '#94a394', textAlign: 'center', lineHeight: 1.6 }}>
              Klicken Sie auf einen Eintrag, um ihn anzuzeigen und als Rechnung zu erfassen.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
