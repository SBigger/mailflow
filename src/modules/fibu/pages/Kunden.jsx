/**
 * Kundenstamm (Debitoren) — CRUD für fibu_kunden mit Excel/CSV-Import
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useMandant } from '../contexts/MandantContext';
import { kundenApi } from '../api';

const card = { background: '#fff', border: '1px solid #d4dcd4', borderRadius: 12 };
const inp  = { width: '100%', padding: '8px 10px', border: '1px solid #d4dcd4', borderRadius: 8, fontSize: 12.5, background: '#f7faf7', boxSizing: 'border-box', fontFamily: 'inherit' };
const lbl  = { display: 'block', fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 4 };

const EMPTY = { name: '', uid: '', adresse: '', plz: '', ort: '', land: 'CH', email: '',
  zahlungsbedingung_tage: 30, standard_konto_nr: '', mwst_code: 'U81', notiz: '', aktiv: true };

export default function Kunden() {
  const { mandant } = useMandant();
  const [kunden, setKunden] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);       // { id?, ...fields }
  const [saving, setSaving] = useState(false);

  // States für den Excel-Import
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);

  const load = useCallback(() => {
    if (!mandant?.id) return;
    setLoading(true);
    kundenApi.list(mandant.id).then(setKunden).catch(console.error).finally(() => setLoading(false));
  }, [mandant?.id]);

  useEffect(load, [load]);

  const openNew = async () => {
    const nr = await kundenApi.nextNr(mandant.id).catch(() => '');
    setModal({ ...EMPTY, nr });
  };

  const save = async () => {
    if (!modal.name?.trim()) { alert('Name fehlt'); return; }
    setSaving(true);
    try {
      const payload = { ...modal };
      delete payload.id;
      if (modal.id) await kundenApi.update(modal.id, payload);
      else await kundenApi.create(mandant.id, payload);
      setModal(null);
      load();
    } catch (e) { alert('Fehler: ' + e.message); }
    finally { setSaving(false); }
  };

  const del = async (k) => {
    if (!confirm(`Kunde «${k.name}» löschen?`)) return;
    try { await kundenApi.remove(k.id); load(); }
    catch (e) { alert('Löschen nicht möglich (evtl. mit Rechnungen verknüpft): ' + e.message); }
  };

  // Parsed eine CSV-Zeile unter Berücksichtigung von Anführungszeichen
  function parseCSVLine(text, delimiter = ',') {
    const result = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (inQuotes && text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === delimiter && !inQuotes) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    result.push(cur.trim());
    return result;
  }

// Konvertiert den gesamten CSV-Text in ein Array von Objekten
  function parseCSV(csvText) {
    const firstLine = csvText.split(/\r?\n/)[0] || '';
    const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

    const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) return [];

    // Header säubern (Anführungszeichen entfernen)
    const headers = parseCSVLine(lines[0], delimiter).map(h => h.replace(/^"|"$/g, '').trim());

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i], delimiter).map(v => v.replace(/^"|"$/g, '').trim());
      if (values.length < headers.length) continue;

      const row = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx] ?? '';
      });
      rows.push(row);
    }
    return rows;
  }

  // Hilfsfunktion: Wandelt Ländernamen in 2-stellige ISO-Codes um
  function mapLandCode(landRaw) {
    if (!landRaw) return 'CH';

    // Bereinigen (Apostrophe/Anführungszeichen & Leerzeichen entfernen)
    const land = String(landRaw).replace(/['"]/g, '').trim().toUpperCase();

    // Falls es schon 2 Zeichen lang ist (z.B. "CH", "DE", "AT")
    if (land.length === 2) return land;

    // Bexio-Ausschreibungen mappen
    const landMap = {
      'SCHWEIZ': 'CH',
      'SWITZERLAND': 'CH',
      'DEUTSCHLAND': 'DE',
      'GERMANY': 'DE',
      'ÖSTERREICH': 'AT',
      'AUSTRIA': 'AT',
      'FRANKREICH': 'FR',
      'FRANCE': 'FR',
      'ITALIEN': 'IT',
      'ITALY': 'IT',
      'LIECHTENSTEIN': 'LI'
    };

    return landMap[land] || land.substring(0, 2) || 'CH';
  }

  const processCSVImport = async (file, mandantId) => {
    const text = await file.text();
    const rawData = parseCSV(text);

    if (rawData.length === 0) {
      throw new Error('Die CSV-Datei enthält keine gültigen Daten.');
    }

    // Bexio Mapping mit erweiterter Bereinigung
    const parsedKunden = rawData.map(row => ({
      name: row['Name 1'] || row['Name'] || row['Firma'] || 'Unbekannt',
      uid: row['MWST-Nummer'] || row['Umsatzsteuer-Identifikationsnummer'] || row['UID'] || '',
      adresse: (row['Adresse'] || '').replace(/^'/, '').trim(),
      plz: (row['PLZ'] || '').replace(/^'/, '').trim(),
      ort: (row['Ort'] || '').trim(),

      // 🔥 Hier wird das Land nun sicher auf 2 Zeichen gekürzt/gemappt:
      land: mapLandCode(row['Land']),

      email: (row['E-Mail'] || '').trim(),
      notiz: (row['Bemerkungen'] || '').trim()
    })).filter(k => k.name.trim() !== '' && k.name !== 'Unbekannt');

    if (parsedKunden.length === 0) {
      throw new Error('Keine gültigen Kunden in der Datei gefunden.');
    }

    return await kundenApi.bulkCreate(mandantId, parsedKunden);
  };

  const handleImport = async () => {
    if (!importFile) return;

    setImporting(true);
    try {
      const importedData = await processCSVImport(importFile, mandant.id);
      alert(`${importedData.length} Kunden erfolgreich aus CSV importiert!`);
      setShowImportModal(false);
      setImportFile(null);
      load(); // Tabelle aktualisieren
    } catch (e) {
      alert('Fehler beim Importieren: ' + e.message);
    } finally {
      setImporting(false);
    }
  };

  const set = (patch) => setModal(m => ({ ...m, ...patch }));

  return (
      <div style={{ flex: 1, overflow: 'auto', background: '#f2f5f2' }}>
        {/* Header Bereich */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 24px', background: '#fff', borderBottom: '1px solid #d4dcd4' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Kundenstamm</div>
            <div style={{ fontSize: 11.5, color: '#7a9a7f' }}>Debitoren · Kunden verwalten</div>
          </div>

          {/* Buttons oben rechts */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button
                onClick={() => setShowImportModal(true)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: '1px solid #d4dcd4',
                  background: '#fff',
                  color: '#3d6641',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
            >
              <span>📥</span> Import
            </button>

            <button
                onClick={openNew}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#3d6641',
                  color: '#fff',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
            >
              + Neuer Kunde
            </button>
          </div>
        </div>

        {/* Tabelle */}
        <div style={{ padding: 24 }}>
          <div style={{ ...card, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
              <tr style={{ background: '#f7faf7', color: '#6b826b', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                <th style={{ textAlign: 'left', padding: '9px 12px' }}>Nr.</th>
                <th style={{ textAlign: 'left', padding: '9px 12px' }}>Name</th>
                <th style={{ textAlign: 'left', padding: '9px 12px' }}>Ort</th>
                <th style={{ textAlign: 'left', padding: '9px 12px' }}>UID</th>
                <th style={{ textAlign: 'right', padding: '9px 12px' }}>Zahlungsfrist</th>
                <th style={{ width: 80 }}></th>
              </tr>
              </thead>
              <tbody>
              {loading && <tr><td colSpan={6} style={{ padding: 20, color: '#94a394' }}>Lädt…</td></tr>}
              {!loading && kunden.length === 0 && <tr><td colSpan={6} style={{ padding: 20, color: '#94a394' }}>Noch keine Kunden — lege den ersten an.</td></tr>}
              {kunden.map(k => (
                  <tr key={k.id} style={{ borderTop: '1px solid #f0f3f0', opacity: k.aktiv ? 1 : 0.5 }}>
                    <td style={{ padding: '9px 12px', fontVariantNumeric: 'tabular-nums', color: '#6b826b' }}>{k.nr}</td>
                    <td style={{ padding: '9px 12px', fontWeight: 600, cursor: 'pointer' }} onClick={() => setModal({ ...k })}>{k.name}</td>
                    <td style={{ padding: '9px 12px' }}>{[k.plz, k.ort].filter(Boolean).join(' ')}</td>
                    <td style={{ padding: '9px 12px', color: '#6b826b' }}>{k.uid || '—'}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right' }}>{k.zahlungsbedingung_tage} Tage</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                      <button onClick={() => setModal({ ...k })} title="Bearbeiten" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5a7aaa', marginRight: 8 }}>✎</button>
                      <button onClick={() => del(k)} title="Löschen" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c4893a' }}>✕</button>
                    </td>
                  </tr>
              ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal: Kunde erstellen/bearbeiten */}
        {modal && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                 onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
              <div style={{ ...card, width: 520, maxWidth: '96vw' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #eef2ee', fontWeight: 700, fontSize: 14 }}>
                  {modal.id ? 'Kunde bearbeiten' : 'Neuer Kunde'} {modal.nr && <span style={{ color: '#94a394', fontWeight: 500 }}>· {modal.nr}</span>}
                </div>
                <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div style={{ gridColumn: '1 / 3' }}><label style={lbl}>Name *</label><input style={inp} value={modal.name} onChange={e => set({ name: e.target.value })} /></div>
                  <div><label style={lbl}>UID</label><input style={inp} value={modal.uid || ''} placeholder="CHE-123.456.789" onChange={e => set({ uid: e.target.value })} /></div>
                  <div><label style={lbl}>E-Mail (Rechnung)</label><input style={inp} value={modal.email || ''} onChange={e => set({ email: e.target.value })} /></div>
                  <div style={{ gridColumn: '1 / 3' }}><label style={lbl}>Adresse</label><input style={inp} value={modal.adresse || ''} onChange={e => set({ adresse: e.target.value })} /></div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <div style={{ width: 90 }}><label style={lbl}>PLZ</label><input style={inp} value={modal.plz || ''} onChange={e => set({ plz: e.target.value })} /></div>
                    <div style={{ flex: 1 }}><label style={lbl}>Ort</label><input style={inp} value={modal.ort || ''} onChange={e => set({ ort: e.target.value })} /></div>
                  </div>
                  <div><label style={lbl}>Land</label><input style={inp} value={modal.land || 'CH'} onChange={e => set({ land: e.target.value.toUpperCase() })} /></div>
                  <div><label style={lbl}>Zahlungsfrist (Tage)</label><input type="number" style={inp} value={modal.zahlungsbedingung_tage} onChange={e => set({ zahlungsbedingung_tage: parseInt(e.target.value) || 30 })} /></div>
                  <div><label style={lbl}>Standard-Ertragskonto</label><input style={inp} value={modal.standard_konto_nr || ''} placeholder="3400" onChange={e => set({ standard_konto_nr: e.target.value })} /></div>
                  <div style={{ gridColumn: '1 / 3' }}><label style={lbl}>Notiz</label><input style={inp} value={modal.notiz || ''} onChange={e => set({ notiz: e.target.value })} /></div>
                </div>
                <div style={{ padding: '14px 20px', borderTop: '1px solid #eef2ee', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button onClick={() => setModal(null)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', cursor: 'pointer' }}>Abbrechen</button>
                  <button onClick={save} disabled={saving} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#3d6641', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>{saving ? 'Speichert…' : 'Speichern'}</button>
                </div>
              </div>
            </div>
        )}

        {/* Modal: Excel/CSV Import */}
        {showImportModal && (
            <div
                style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={e => { if (e.target === e.currentTarget && !importing) setShowImportModal(false); }}
            >
              <div style={{ ...card, width: 440, maxWidth: '96vw' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #eef2ee', fontWeight: 700, fontSize: 14 }}>
                  Kunden importieren (Bexio / Excel)
                </div>
                <div style={{ padding: 20 }}>
                  <p style={{ fontSize: 12.5, color: '#555', marginTop: 0, marginBottom: 16 }}>
                    Lade eine CSV-Datei (Bexio-Export) hoch, um Kundenstamm-Daten zu importieren.
                  </p>

                  {/* Upload Drop-Area */}
                  <div
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        border: '2px dashed #d4dcd4',
                        borderRadius: 8,
                        padding: 24,
                        textAlign: 'center',
                        background: '#f7faf7',
                        cursor: 'pointer',
                        transition: 'border-color 0.2s'
                      }}
                  >
                    <input
                        type="file"
                        ref={fileInputRef}
                        accept=".csv"
                        style={{ display: 'none' }}
                        onChange={e => setImportFile(e.target.files[0] || null)}
                    />
                    <div style={{ fontSize: 24, marginBottom: 8 }}>📄</div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: '#3d6641' }}>
                      {importFile ? importFile.name : 'Excel/CSV Datei auswählen'}
                    </div>
                    <div style={{ fontSize: 11, color: '#7a9a7f', marginTop: 4 }}>
                      {importFile ? `${(importFile.size / 1024).toFixed(1)} KB` : 'Klicke hier zum Durchsuchen'}
                    </div>
                  </div>
                </div>

                <div style={{ padding: '14px 20px', borderTop: '1px solid #eef2ee', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button
                      onClick={() => { setShowImportModal(false); setImportFile(null); }}
                      disabled={importing}
                      style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', cursor: 'pointer' }}
                  >
                    Abbrechen
                  </button>
                  <button
                      onClick={handleImport}
                      disabled={importing || !importFile}
                      style={{
                        padding: '8px 18px',
                        borderRadius: 8,
                        border: 'none',
                        background: importing || !importFile ? '#94a394' : '#3d6641',
                        color: '#fff',
                        fontWeight: 600,
                        cursor: importing || !importFile ? 'not-allowed' : 'pointer'
                      }}
                  >
                    {importing ? 'Importiert…' : 'Datei Importieren'}
                  </button>
                </div>
              </div>
            </div>
        )}
      </div>
  );
}