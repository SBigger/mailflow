import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMandant } from '../contexts/MandantContext';
import { lieferantenApi, mwstCodesApi } from '../api';

const WAEHRUNGEN = ['CHF', 'EUR', 'USD', 'GBP'];

const inp = { background: '#f7faf7', border: '1px solid #d4dcd4', borderRadius: 7, padding: '6px 10px', fontSize: 12.5, color: '#1a1a2e', outline: 'none', width: '100%' };
const lbl = { fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 3, display: 'block' };

function LieferantForm({ initial, onSave, onCancel, saving, mwstCodes }) {
  const [v, setV] = useState(initial ?? {
    name: '', uid: '', adresse: '', plz: '', ort: '', land: 'CH',
    iban: '', bank_name: '', zahlungsbedingung_tage: 30, waehrung: 'CHF',
    standard_konto_nr: '6800', mwst_code: 'M81', notiz: '',
  });
  const set = (k) => (e) => setV(prev => ({ ...prev, [k]: e.target.value }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={lbl}>Firmenname *</label>
          <input style={inp} value={v.name} onChange={set('name')} placeholder="Muster AG" />
        </div>
        <div>
          <label style={lbl}>UID (CHE-xxx.xxx.xxx)</label>
          <input style={inp} value={v.uid ?? ''} onChange={set('uid')} placeholder="CHE-" />
        </div>
        <div>
          <label style={lbl}>Land</label>
          <select style={inp} value={v.land ?? 'CH'} onChange={set('land')}>
            <option value="CH">🇨🇭 Schweiz (CH)</option>
            <option value="DE">🇩🇪 Deutschland (DE)</option>
            <option value="AT">🇦🇹 Österreich (AT)</option>
            <option value="FR">🇫🇷 Frankreich (FR)</option>
            <option value="IT">🇮🇹 Italien (IT)</option>
            <option value="LI">🇱🇮 Liechtenstein (LI)</option>
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={lbl}>Adresse</label>
          <input style={inp} value={v.adresse ?? ''} onChange={set('adresse')} placeholder="Musterstrasse 1" />
        </div>
        <div>
          <label style={lbl}>PLZ</label>
          <input style={inp} value={v.plz ?? ''} onChange={set('plz')} placeholder="8000" />
        </div>
        <div>
          <label style={lbl}>Ort</label>
          <input style={inp} value={v.ort ?? ''} onChange={set('ort')} placeholder="Zürich" />
        </div>

        {/* Zahlungsdaten */}
        <div>
          <label style={lbl}>IBAN</label>
          <input style={{ ...inp, fontFamily: 'monospace' }} value={v.iban ?? ''} onChange={set('iban')} placeholder="CH00 0000 0000 0000 0000 0" />
        </div>
        <div>
          <label style={lbl}>Bank</label>
          <input style={inp} value={v.bank_name ?? ''} onChange={set('bank_name')} placeholder="UBS, ZKB, PostFinance…" />
        </div>
        <div>
          <label style={lbl}>Zahlungsbedingung (Tage)</label>
          <input style={inp} type="number" min="0" max="365" value={v.zahlungsbedingung_tage} onChange={set('zahlungsbedingung_tage')} />
        </div>
        <div>
          <label style={lbl}>Währung</label>
          <select style={inp} value={v.waehrung ?? 'CHF'} onChange={set('waehrung')}>
            {WAEHRUNGEN.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>

        {/* Buchhaltungsdaten */}
        <div>
          <label style={lbl}>Standard-Buchungskonto</label>
          <input style={inp} value={v.standard_konto_nr ?? ''} onChange={set('standard_konto_nr')} placeholder="z.B. 6800" />
        </div>
        <div>
          <label style={lbl}>MWST-Code (Vorsteuer)</label>
          <select style={inp} value={v.mwst_code ?? 'M81'} onChange={set('mwst_code')}>
            {mwstCodes.filter(c => c.typ === 'vorsteuer' || c.typ === 'steuerbefreit').map(c => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.bezeichnung} {c.satz > 0 ? `(${c.satz}%)` : ''}
              </option>
            ))}
            {/* Fallback falls DB noch keine Codes hat */}
            {mwstCodes.length === 0 && (
              <>
                <option value="M81">M81 — Vorsteuer 8.1%</option>
                <option value="M26">M26 — Vorsteuer 2.6%</option>
                <option value="M38">M38 — Vorsteuer 3.8%</option>
                <option value="M0">M0 — Keine MWST</option>
              </>
            )}
          </select>
        </div>
      </div>

      <div>
        <label style={lbl}>Notiz / Bemerkung</label>
        <textarea style={{ ...inp, height: 56, resize: 'vertical' }} value={v.notiz ?? ''} onChange={set('notiz')} />
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12.5, cursor: 'pointer' }}
        >Abbrechen</button>
        <button
          disabled={!v.name || saving}
          onClick={() => onSave(v)}
          style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', opacity: (!v.name || saving) ? .5 : 1 }}
        >{saving ? 'Speichert…' : 'Speichern'}</button>
      </div>
    </div>
  );
}

export default function Lieferanten() {
  const { mandant, canWrite } = useMandant();
  const { lieferantId } = useParams();
  const navigate = useNavigate();
  const [list, setList]       = useState([]);
  const [mwstCodes, setMwstCodes] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    if (!mandant) return;
    setLoading(true);
    Promise.all([
      lieferantenApi.list(mandant.id),
      mwstCodesApi.listAktiv(mandant.id),
    ]).then(([data, codes]) => {
      setList(data);
      setMwstCodes(codes);
      if (lieferantId) setSelected(data.find(l => l.id === lieferantId) ?? null);
    }).finally(() => setLoading(false));
  }, [mandant?.id, lieferantId]);

  const filtered = list.filter(l => !search || l.name.toLowerCase().includes(search.toLowerCase()));

  const handleSave = async (form) => {
    setSaving(true);
    try {
      if (selected?.id) {
        const updated = await lieferantenApi.update(selected.id, form);
        setList(prev => prev.map(l => l.id === updated.id ? updated : l));
        setSelected(updated);
      } else {
        const nr = await lieferantenApi.nextNr(mandant.id);
        const created = await lieferantenApi.create(mandant.id, { ...form, nr });
        setList(prev => [...prev, created]);
        setSelected(created);
      }
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  };

  // Code → Label-Mapping aus DB-Daten
  const codeLabel = (code) => {
    const found = mwstCodes.find(c => c.code === code);
    if (found) return `${found.code} (${found.satz > 0 ? found.satz + '%' : 'befreit'})`;
    return code ?? '—';
  };

  const hdr = { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6b826b', padding: '9px 12px', borderBottom: '2px solid #e4e9e4', textAlign: 'left', whiteSpace: 'nowrap', background: '#fff' };
  const td  = { padding: '9px 12px', borderBottom: '1px solid #f0f3f0', fontSize: 12.5, verticalAlign: 'middle' };

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* Lieferantenliste */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid #e4e9e4' }}>
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#fff', borderBottom: '1px solid #e4e9e4' }}>
          <input
            style={{ ...inp, maxWidth: 220 }}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Lieferant suchen…"
          />
          <div style={{ fontSize: 12, color: '#94a394' }}>{filtered.length} Lieferanten</div>
          <div style={{ flex: 1 }} />
          {canWrite && (
            <button
              onClick={() => { setSelected(null); setShowForm(true); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}
            >+ Neuer Lieferant</button>
          )}
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>Lädt…</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={hdr}>Nr.</th>
                <th style={hdr}>Name</th>
                <th style={hdr}>Ort</th>
                <th style={hdr}>Zahlung</th>
                <th style={hdr}>Währung</th>
                <th style={hdr}>Konto</th>
                <th style={hdr}>MWST</th>
                <th style={hdr}>Status</th>
              </tr></thead>
              <tbody>
                {filtered.map(l => (
                  <tr
                    key={l.id}
                    onClick={() => { setSelected(l); setShowForm(false); }}
                    style={{ cursor: 'pointer', background: selected?.id === l.id ? '#f0f7f0' : undefined }}
                    onMouseEnter={e => { if (selected?.id !== l.id) e.currentTarget.querySelectorAll('td').forEach(c => c.style.background = '#f7faf7'); }}
                    onMouseLeave={e => { if (selected?.id !== l.id) e.currentTarget.querySelectorAll('td').forEach(c => c.style.background = ''); }}
                  >
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 12, color: '#94a394' }}>{l.nr}</td>
                    <td style={{ ...td, fontWeight: 500 }}>
                      {l.name}
                      {l.uid && <span style={{ display: 'block', fontSize: 10.5, color: '#94a394', fontFamily: 'monospace' }}>{l.uid}</span>}
                    </td>
                    <td style={td}>{[l.plz, l.ort].filter(Boolean).join(' ') || '—'}</td>
                    <td style={td}>{l.zahlungsbedingung_tage} Tage</td>
                    <td style={td}>
                      <span style={{ fontSize: 10.5, padding: '2px 6px', borderRadius: 5, background: l.waehrung !== 'CHF' ? '#fef3c7' : '#f0f3f0', color: l.waehrung !== 'CHF' ? '#92400e' : '#4a5a4a', fontWeight: 600, fontFamily: 'monospace' }}>
                        {l.waehrung ?? 'CHF'}
                      </span>
                    </td>
                    <td style={{ ...td, fontSize: 12 }}>{l.standard_konto_nr ?? '—'}</td>
                    <td style={td}>
                      <span style={{ fontSize: 10.5, padding: '2px 6px', borderRadius: 5, background: '#e3eaf5', color: '#2e4a7d', fontWeight: 500 }}>
                        {l.mwst_code}
                      </span>
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 6, background: l.aktiv ? '#dcf0e1' : '#e4e4ea', color: l.aktiv ? '#1d6b35' : '#4a4a5a', fontWeight: 500 }}>
                        {l.aktiv ? 'aktiv' : 'inaktiv'}
                      </span>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 32, textAlign: 'center', color: '#94a394', fontSize: 12.5 }}>
                    {search ? 'Keine Treffer' : 'Noch keine Lieferanten erfasst — klicken Sie auf «+ Neuer Lieferant»'}
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Detail / Formular */}
      <div style={{ flexShrink: 0, width: 360, overflowY: 'auto', background: '#fff', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {showForm ? (
          <>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{selected ? 'Lieferant bearbeiten' : 'Neuer Lieferant'}</div>
            <LieferantForm
              initial={selected}
              onSave={handleSave}
              onCancel={() => setShowForm(false)}
              saving={saving}
              mwstCodes={mwstCodes}
            />
          </>
        ) : selected ? (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{selected.name}</div>
                <div style={{ fontSize: 11.5, color: '#94a394' }}>Lieferant Nr. {selected.nr}</div>
                {selected.uid && <div style={{ fontSize: 11, color: '#6b826b', fontFamily: 'monospace', marginTop: 2 }}>{selected.uid}</div>}
              </div>
              <span style={{ flexShrink: 0, fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 500, background: selected.aktiv ? '#dcf0e1' : '#e4e4ea', color: selected.aktiv ? '#1d6b35' : '#4a4a5a' }}>
                {selected.aktiv ? 'aktiv' : 'inaktiv'}
              </span>
            </div>

            <div style={{ height: 1, background: '#e4e9e4' }} />

            {/* Adresse */}
            {(selected.adresse || selected.ort) && (
              <div>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: '#6b826b', textTransform: 'uppercase', letterSpacing: '.07em' }}>Adresse</span>
                <div style={{ fontSize: 12.5, color: '#1a1a2e', marginTop: 2 }}>
                  {selected.adresse && <div>{selected.adresse}</div>}
                  {(selected.plz || selected.ort) && <div>{[selected.plz, selected.ort].filter(Boolean).join(' ')}</div>}
                  {selected.land && selected.land !== 'CH' && <div style={{ color: '#6b826b' }}>{selected.land}</div>}
                </div>
              </div>
            )}

            {/* Zahlungsdaten */}
            {[
              ['IBAN', selected.iban, true],
              ['Bank', selected.bank_name],
              ['Zahlungsbedingung', selected.zahlungsbedingung_tage ? `${selected.zahlungsbedingung_tage} Tage netto` : null],
              ['Währung', selected.waehrung ?? 'CHF'],
            ].map(([k, v, mono]) => v ? (
              <div key={k}>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: '#6b826b', textTransform: 'uppercase', letterSpacing: '.07em' }}>{k}</span>
                <div style={{ fontSize: 12.5, color: '#1a1a2e', marginTop: 2, fontFamily: mono ? 'monospace' : undefined }}>{v}</div>
              </div>
            ) : null)}

            <div style={{ height: 1, background: '#e4e9e4' }} />

            {/* Buchhaltung */}
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: '#94a394' }}>Buchhaltung</div>
            {[
              ['Buchungskonto', selected.standard_konto_nr],
              ['MWST-Code', codeLabel(selected.mwst_code)],
            ].map(([k, v]) => v ? (
              <div key={k}>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: '#6b826b', textTransform: 'uppercase', letterSpacing: '.07em' }}>{k}</span>
                <div style={{ fontSize: 12.5, color: '#1a1a2e', marginTop: 2 }}>{v}</div>
              </div>
            ) : null)}

            {selected.notiz && (
              <div>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: '#6b826b', textTransform: 'uppercase', letterSpacing: '.07em' }}>Notiz</span>
                <div style={{ fontSize: 12.5, color: '#1a1a2e', marginTop: 2, whiteSpace: 'pre-wrap' }}>{selected.notiz}</div>
              </div>
            )}

            {canWrite && (
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 8 }}>
                <button
                  onClick={() => setShowForm(true)}
                  style={{ flex: 1, padding: '6px 10px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', fontSize: 12.5, cursor: 'pointer', fontWeight: 500 }}
                >Bearbeiten</button>
                <button
                  onClick={() => navigate(`/fibu/${mandant.id}/kreditoren/erfassen`)}
                  style={{ flex: 1, padding: '6px 10px', borderRadius: 8, border: 'none', background: '#7a9b7f', color: '#fff', fontSize: 12.5, cursor: 'pointer', fontWeight: 500 }}
                >Neue Rechnung</button>
              </div>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: '#94a394', fontSize: 12.5, textAlign: 'center', padding: 20 }}>
            Lieferant auswählen oder neu erstellen
          </div>
        )}
      </div>
    </div>
  );
}
