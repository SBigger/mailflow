import React, { useState, useRef, useEffect, useContext } from 'react';
import { supabase } from '@/api/supabaseClient';
import { ThemeContext } from '@/Layout';
import { Search, Building2, MapPin, X, Loader2, AlertCircle } from 'lucide-react';

export default function ZefixAssistent({ open, onClose, onCreate }) {
  const { theme } = useContext(ThemeContext);
  const isArtis = theme === 'artis';
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setError(null);
      setSearched(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const doSearch = async (q) => {
    if (q.trim().length < 3) { setResults([]); setSearched(false); return; }
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('zefix-search', {
        body: { query: q.trim() },
      });
      if (fnErr) throw fnErr;
      setResults(data?.results || []);
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg.includes('ZEFIX_USER') || msg.includes('nicht konfiguriert')) {
        setError('Zefix-Zugang noch nicht konfiguriert. Zugangsdaten ausstehend.');
      } else {
        setError('Suche fehlgeschlagen: ' + msg);
      }
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleInput = (val) => {
    setQuery(val);
    clearTimeout(timerRef.current);
    if (val.trim().length >= 3) {
      timerRef.current = setTimeout(() => doSearch(val), 400);
    } else {
      setResults([]);
      setSearched(false);
    }
  };

  const handleSelect = (r) => {
    onCreate({
      company_name: r.name,
      uid_nr: r.uid || '',
      rechtsform: r.rechtsform || '',
      ort: r.sitz || '',
      plz: r.plz || '',
      strasse: r.strasse || '',
      kanton: r.kanton || '',
      zefix_ehraid: r.ehraid || null,
      person_type: 'unternehmen',
      activities: [],
      contact_persons: [],
      tags: [],
    });
  };

  const handleManual = () => {
    onCreate({
      company_name: query.trim() || 'Neuer Kunde',
      person_type: 'unternehmen',
      activities: [],
      contact_persons: [],
      tags: [],
    });
  };

  if (!open) return null;

  const accent = isArtis ? '#7a9b7f' : '#7c3aed';
  const accentLight = isArtis ? '#e6ede6' : '#ede9fe';
  const accentText = isArtis ? '#3d6641' : '#5b21b6';
  const border = isArtis ? '#ccd8cc' : '#d4d4e8';
  const muted = isArtis ? '#6b826b' : '#71717a';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(3px)',
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: '#fff', borderRadius: 16, width: 520, maxHeight: '80vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        border: `1px solid ${border}`,
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e' }}>Neues Unternehmen erfassen</div>
            <div style={{ fontSize: 12, color: muted, marginTop: 2 }}>Firmendaten aus dem Handelsregister laden</div>
          </div>
          <button onClick={onClose} style={{
            width: 30, height: 30, borderRadius: 8, border: 'none',
            background: 'transparent', cursor: 'pointer', color: muted,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><X size={18} /></button>
        </div>

        {/* Search */}
        <div style={{ padding: '16px 24px 12px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: '#f8f9fa', border: `1px solid ${border}`,
            borderRadius: 10, padding: '0 14px',
          }}>
            <Search size={16} style={{ color: muted, flexShrink: 0 }} />
            <input
              ref={inputRef}
              value={query}
              onChange={e => handleInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && query.trim().length >= 3) doSearch(query); }}
              placeholder="Firmenname oder UID eingeben..."
              style={{
                flex: 1, padding: '12px 0', fontSize: 14, border: 'none',
                outline: 'none', background: 'transparent', color: '#1a1a2e',
              }}
            />
            {loading && <Loader2 size={16} style={{ color: accent, animation: 'spin 1s linear infinite' }} />}
          </div>
          <div style={{ fontSize: 11, color: muted, marginTop: 6 }}>
            Suche im Schweizer Handelsregister (Zefix) &mdash; min. 3 Zeichen
          </div>
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 16px' }}>
          {error && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              background: '#fef3cd', border: '1px solid #ffc107', borderRadius: 10,
              padding: '12px 14px', fontSize: 12.5, color: '#856404',
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}

          {!error && searched && !loading && results.length === 0 && (
            <div style={{ textAlign: 'center', padding: '24px 0', color: muted, fontSize: 13 }}>
              Keine Treffer gefunden
            </div>
          )}

          {results.map((r, i) => (
            <button
              key={r.ehraid || i}
              onClick={() => handleSelect(r)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                width: '100%', textAlign: 'left',
                padding: '12px 14px', marginBottom: 6,
                background: '#fff', border: `1px solid ${border}`,
                borderRadius: 10, cursor: 'pointer',
                transition: 'all .15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = accentLight; e.currentTarget.style.borderColor = accent; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = border; }}
            >
              <div style={{
                width: 38, height: 38, borderRadius: 10, background: accentLight,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: accentText, flexShrink: 0,
              }}>
                <Building2 size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#1a1a2e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.name}
                </div>
                <div style={{ fontSize: 11, color: muted, marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {r.uid && <span>{r.uid}</span>}
                  {r.rechtsform && <span style={{ background: accentLight, padding: '1px 6px', borderRadius: 4, fontWeight: 500 }}>{r.rechtsform}</span>}
                  {r.sitz && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><MapPin size={10} />{r.sitz}</span>}
                </div>
              </div>
              <span style={{ color: accent, fontSize: 18, flexShrink: 0 }}>&rsaquo;</span>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 24px 16px', borderTop: `1px solid ${border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <button onClick={onClose} style={{
            padding: '8px 16px', borderRadius: 8, border: `1px solid ${border}`,
            background: '#fff', fontSize: 13, cursor: 'pointer', color: muted,
          }}>Abbrechen</button>
          <button onClick={handleManual} style={{
            padding: '8px 16px', borderRadius: 8, border: 'none',
            background: accent, color: '#fff', fontSize: 13, fontWeight: 500,
            cursor: 'pointer', opacity: 0.9,
          }}>Manuell erfassen</button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
