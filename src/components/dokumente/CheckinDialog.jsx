import React, { useState, useRef, useEffect } from 'react';
import { Lock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

export default function CheckinDialog({ doc, fileHandle, onCancel, onCheckin, s, border, accent }) {
  const [autoFile,    setAutoFile]    = useState(null);
  const [autoLoading, setAutoLoading] = useState(false);
  const [manualFile,  setManualFile]  = useState(null);
  const [saving,      setSaving]      = useState(false);
  const [useManual,   setUseManual]   = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    if (!fileHandle) return;
    setAutoLoading(true);
    (async () => {
      try {
        let perm = await fileHandle.queryPermission({ mode: 'read' });
        if (perm !== 'granted') perm = await fileHandle.requestPermission({ mode: 'read' });
        if (perm === 'granted') setAutoFile(await fileHandle.getFile());
      } catch (e) { console.log('FileHandle not accessible:', e.message); }
      finally { setAutoLoading(false); }
    })();
  }, [fileHandle]);

  const activeFile = useManual ? manualFile : (autoFile || manualFile);

  const handleSubmit = async (file) => {
    setSaving(true);
    try { await onCheckin(file || null); }
    catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: s.cardBg, border: '1px solid ' + border, borderRadius: 12,
        padding: 24, width: 460, maxWidth: '95vw' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Lock size={16} style={{ color: accent }} />
            <h3 style={{ color: s.textMain, fontSize: 14, fontWeight: 700 }}>Dokument einchecken</h3>
          </div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: s.textMuted }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ fontSize: 12, color: s.textMuted, marginBottom: 16,
          padding: '6px 10px', background: s.sidebarBg, borderRadius: 6, border: '1px solid ' + border }}>
          {doc.name}
          <span style={{ marginLeft: 6, color: s.textMuted + '88', fontSize: 11 }}>({doc.filename})</span>
        </div>

        {fileHandle && !useManual && (
          <div style={{ marginBottom: 14 }}>
            {autoLoading ? (
              <div style={{ fontSize: 12, color: s.textMuted, padding: '8px 0' }}>
                Gespeicherte Datei wird gelesen...
              </div>
            ) : autoFile ? (
              <div style={{ background: accent + '12', border: '1px solid ' + accent + '44',
                borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 12, color: accent, fontWeight: 600, marginBottom: 4,
                  display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Lock size={12} /> Lokale Version gefunden
                </div>
                <div style={{ fontSize: 12, color: s.textMain }}>{autoFile.name}</div>
                <div style={{ fontSize: 11, color: s.textMuted, marginTop: 2 }}>
                  {formatBytes(autoFile.size)} &nbsp;&middot;&nbsp;
                  Gespeichert: {new Date(autoFile.lastModified).toLocaleString('de-CH')}
                </div>
                <button onClick={() => setUseManual(true)}
                  style={{ marginTop: 8, fontSize: 11, color: s.textMuted, background: 'none',
                    border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                  Andere Datei verwenden
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: s.textMuted, marginBottom: 6 }}>
                Gespeicherte Datei nicht mehr zugreifbar. Bitte manuell waehlen:
              </div>
            )}
          </div>
        )}

        {(!fileHandle || useManual || (!autoLoading && !autoFile)) && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: s.textMuted, display: 'block', marginBottom: 4 }}>
              Neue Version hochladen (optional)
            </label>
            <div onClick={() => fileRef.current?.click()}
              style={{ border: '2px dashed ' + (manualFile ? accent : border), borderRadius: 8,
                padding: '12px 14px', textAlign: 'center', cursor: 'pointer',
                color: manualFile ? accent : s.textMuted, fontSize: 12 }}>
              {manualFile
                ? manualFile.name + ' (' + formatBytes(manualFile.size) + ')'
                : 'Datei auswaehlen oder hier ablegen'}
              <input ref={fileRef} type="file" style={{ display: 'none' }}
                onChange={e => e.target.files[0] && setManualFile(e.target.files[0])} />
            </div>
            {useManual && autoFile && (
              <button onClick={() => { setUseManual(false); setManualFile(null); }}
                style={{ marginTop: 6, fontSize: 11, color: s.textMuted, background: 'none',
                  border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                Zurueck zur gespeicherten Datei
              </button>
            )}
          </div>
        )}

        <div style={{ fontSize: 11, color: s.textMuted, marginBottom: 16, fontStyle: 'italic' }}>
          {activeFile ? 'Die alte Datei wird durch die neue Version ersetzt.' : 'Ohne neue Datei wird nur die Sperre aufgehoben.'}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="outline" onClick={onCancel} style={{ color: s.textMuted, borderColor: border }}>
            Abbrechen
          </Button>
          <Button variant="outline" onClick={() => handleSubmit(null)} disabled={saving}
            style={{ color: s.textMuted, borderColor: border }}>
            Nur entsperren
          </Button>
          <Button onClick={() => handleSubmit(activeFile || null)} disabled={saving}
            style={{ background: accent, color: '#fff', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Lock size={13} />
            {saving ? 'Bitte warten...' : (activeFile ? 'Einchecken & hochladen' : 'Einchecken')}
          </Button>
        </div>
      </div>
    </div>
  );
}
