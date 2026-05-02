import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { mandantenApi } from '../api';

export default function MandantSelect() {
  const navigate = useNavigate();
  const [mandanten, setMandanten] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState({ name: '', uid: '', mwst_nr: '', ort: '' });

  useEffect(() => {
    mandantenApi.list()
      .then(data => {
        setMandanten(data);
        if (data.length === 1) navigate(`/fibu/${data[0].id}/kreditoren`, { replace: true });
      })
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (!form.name) return;
    setSaving(true);
    setErr(null);
    try {
      const m = await mandantenApi.create(form);
      navigate(`/fibu/${m.id}/kreditoren`);
    } catch (e) {
      setErr(e?.message ?? 'Unbekannter Fehler');
    } finally {
      setSaving(false);
    }
  };

  const inp = { background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '7px 10px', fontSize: 13, outline: 'none', width: '100%' };

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f2f5f2', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ width: 460, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: '#7a9b7f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 22, margin: '0 auto 12px' }}>A</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#1a1a2e' }}>Artis FiBu</div>
          <div style={{ fontSize: 13, color: '#6b826b', marginTop: 4 }}>Mandant auswählen oder neu anlegen</div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: '#94a394', fontSize: 13 }}>Lädt…</div>
        ) : (
          <>
            {mandanten.length > 0 && (
              <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 12, overflow: 'hidden' }}>
                {mandanten.map((m, i) => (
                  <button
                    key={m.id}
                    onClick={() => navigate(`/fibu/${m.id}/kreditoren`)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 18px', background: '#fff', border: 'none', borderTop: i > 0 ? '1px solid #f0f3f0' : 'none', cursor: 'pointer', textAlign: 'left' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f7faf7'}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                  >
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: '#e6ede6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, color: '#3d6641', flexShrink: 0 }}>
                      {m.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5, color: '#1a1a2e' }}>{m.name}</div>
                      <div style={{ fontSize: 11.5, color: '#94a394' }}>{[m.uid, m.ort].filter(Boolean).join(' · ') || 'FiBu-Mandant'}</div>
                    </div>
                    <span style={{ color: '#7a9b7f', fontSize: 18 }}>›</span>
                  </button>
                ))}
              </div>
            )}

            {!showNew ? (
              <button
                onClick={() => setShowNew(true)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: '2px dashed #d4dcd4', background: 'transparent', color: '#7a9b7f', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
              >+ Neuer Mandant anlegen</button>
            ) : (
              <div style={{ background: '#fff', border: '1px solid #e4e9e4', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Neuer Mandant</div>
                {[['name','Firmenname *','z.B. Muster AG'],['uid','UID','CHE-xxx.xxx.xxx'],['mwst_nr','MWST-Nr.','CHE-xxx.xxx.xxx MWST'],['ort','Ort','z.B. Zürich']].map(([k,l,ph]) => (
                  <div key={k}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#6b826b', display: 'block', marginBottom: 3 }}>{l}</label>
                    <input style={inp} placeholder={ph} value={form[k]} onChange={e => setForm(p => ({ ...p, [k]: e.target.value }))} />
                  </div>
                ))}
                {err && (
                  <div style={{ background: '#fde8e8', border: '1px solid #f5c6c6', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, color: '#8a2d2d' }}>
                    ⚠ {err}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button onClick={() => setShowNew(false)} style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 13, cursor: 'pointer' }}>Abbrechen</button>
                  <button onClick={handleCreate} disabled={!form.name || saving} style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: (!form.name || saving) ? .5 : 1 }}>
                    {saving ? 'Anlegen…' : 'Mandant anlegen'}
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={() => navigate('/Dashboard')}
              style={{ background: 'transparent', border: 'none', color: '#94a394', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
            >← Zurück zu MailFlow</button>
          </>
        )}
      </div>
    </div>
  );
}
