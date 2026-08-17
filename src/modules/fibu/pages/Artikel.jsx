/**
 * Produktstamm (Artikel) — Dienstleistungen + Material. CRUD für fibu_artikel + XLSX/CSV Import.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useMandant } from '../contexts/MandantContext';
import { artikelApi, kontenApi, mwstCodesApi } from '../api';

const card = { background: '#fff', border: '1px solid #d4dcd4', borderRadius: 12 };
const inp  = { width: '100%', padding: '8px 10px', border: '1px solid #d4dcd4', borderRadius: 8, fontSize: 12.5, background: '#f7faf7', boxSizing: 'border-box', fontFamily: 'inherit' };
const lbl  = { display: 'block', fontSize: 11, fontWeight: 600, color: '#6b826b', marginBottom: 4 };
const CHF  = n => (parseFloat(n) || 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TYP_BADGE = {
  dienstleistung: { bg: '#e8f0fb', color: '#1e40af', label: 'Dienstleistung' },
  material:       { bg: '#fdf0e6', color: '#b45309', label: 'Material' },
};

const EMPTY = { typ: 'dienstleistung', name: '', beschreibung: '', einheit: 'Std',
  verkaufspreis: 0, waehrung: 'CHF', mwst_code: 'U81', ertragskonto: '3400', aktiv: true };

// ==========================================
// EXCEL / CSV IMPORTER HELPER
// ==========================================
const processExcelImport = async (file, mandantId) => {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array' });

  // Erste Tabelle auslesen
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];

  // In JSON-Objekte konvertieren
  const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  if (!rawData || rawData.length === 0) {
    throw new Error('Die Excel-Datei enthält keine Daten.');
  }

  // Bexio-Spalten mappen
  const parsedArtikel = rawData.map(row => {
    // Spalten aus dem Bexio-Export abfragen
    const name = row['Produktname'] || row['Titel'] || row['Bezeichnung'] || row['Name'] || '';
    // Beschreibung
    const beschreibung = row['Produktbeschreibung'] || row['Beschreibung'] || row['Text'] || '';

    // Preis
    const preisRaw = row['Verkaufspreis'] || row['Preis'] || row['VK-Preis'] || 0;
    const preis = parseFloat(String(preisRaw).replace("'", "").replace(',', '.')) || 0;

    // Einheit
    const einheit = row['Einheit'] || row['Mengeneinheit'] || 'Stk';

    // Ertragskonto
    const ertragskontoRaw = row['Ertragskonto'] || row['Konto'] || '';
    const ertragskonto = ertragskontoRaw ? String(Math.floor(parseFloat(ertragskontoRaw))) : '';

    // MWST
    const mwstRaw = row['MwSt Umsatzsteuer'] || row['MWST-Code'] || row['MWST'] || '';

    // Typ bestimmen (Bexio: "Dienstleistung" / "Ware" / "Material")
    const typRaw = String(row['Produktart'] || row['Typ'] || '').toLowerCase();
    const typ = (typRaw.includes('material') || typRaw.includes('ware') || typRaw.includes('artikel')) ? 'material' : 'dienstleistung';

    return {
      name: String(name).trim(),
      beschreibung: String(beschreibung).trim(),
      typ: typ,
      einheit: String(einheit).trim() || 'Stk',
      verkaufspreis: preis,
      ertragskonto: ertragskonto || (typ === 'material' ? '3200' : '3400'),
      mwst_code: mwstRaw || 'U81',
      waehrung: row['Währung'] || 'CHF',
      aktiv: true
    };
  }).filter(a => a.name !== '');

  if (parsedArtikel.length === 0) {
    throw new Error('Keine gültigen Produkte mit Bezeichnung in der Excel-Datei gefunden.');
  }

    return await artikelApi.bulkCreate(mandantId, parsedArtikel);
};

// ==========================================
// HAUPTKOMPONENTE
// ==========================================
export default function Artikel() {
  const { mandant } = useMandant();
  const [artikel, setArtikel] = useState([]);
  const [konten, setKonten] = useState([]);
  const [mwstCodes, setMwstCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('alle');

  // States für Excel Import
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);

  const load = useCallback(() => {
    if (!mandant?.id) return;
    setLoading(true);
    artikelApi.list(mandant.id).then(setArtikel).catch(console.error).finally(() => setLoading(false));
  }, [mandant?.id]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!mandant?.id) return;
    kontenApi.list(mandant.id).then(setKonten).catch(console.error);
    mwstCodesApi.listAktiv(mandant.id).then(setMwstCodes).catch(console.error);
  }, [mandant?.id]);

  const ertragKonten = konten.filter(k => k.konto_typ === 'ertrag');
  const umsatzCodes  = mwstCodes.filter(c => c.typ === 'umsatzsteuer' || c.code === 'U0');

  const openNew = async () => {
    const nr = await artikelApi.nextNr(mandant.id, 'dienstleistung').catch(() => '');
    setModal({ ...EMPTY, nr });
  };

  const save = async () => {
    if (!modal.name?.trim()) { alert('Name fehlt'); return; }
    setSaving(true);
    try {
      const payload = { ...modal }; delete payload.id;
      payload.verkaufspreis = parseFloat(payload.verkaufspreis) || 0;
      if (modal.id) await artikelApi.update(modal.id, payload);
      else await artikelApi.create(mandant.id, payload);
      setModal(null); load();
    } catch (e) { alert('Fehler: ' + e.message); }
    finally { setSaving(false); }
  };

  const del = async (a) => {
    if (!confirm(`Artikel «${a.name}» löschen?`)) return;
    try { await artikelApi.remove(a.id); load(); }
    catch (e) { alert('Löschen nicht möglich: ' + e.message); }
  };

  const handleImport = async () => {
    if (!importFile) return;

    setImporting(true);
    try {
      const importedData = await processExcelImport(importFile, mandant.id);
      alert(`${importedData.length} Produkte erfolgreich importiert!`);
      setShowImportModal(false);
      setImportFile(null);
      load();
    } catch (e) {
      alert('Fehler beim Importieren: ' + e.message);
    } finally {
      setImporting(false);
    }
  };

  const set = async (patch) => {
    if (patch.typ && !modal.id) {
      const nr = await artikelApi.nextNr(mandant.id, patch.typ).catch(() => modal.nr);
      patch.nr = nr;
      patch.einheit = patch.typ === 'material' ? 'Stk' : 'Std';
      patch.ertragskonto = patch.typ === 'material' ? '3200' : '3400';
    }
    setModal(m => ({ ...m, ...patch }));
  };

  const shown = filter === 'alle' ? artikel : artikel.filter(a => a.typ === filter);

  return (
      <div style={{ flex: 1, overflow: 'auto', background: '#f2f5f2' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 24px', background: '#fff', borderBottom: '1px solid #d4dcd4', gap: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Produktstamm</div>
            <div style={{ fontSize: 11.5, color: '#7a9a7f' }}>Dienstleistungen &amp; Material</div>
          </div>
          <select value={filter} onChange={e => setFilter(e.target.value)} style={{ ...inp, width: 'auto', marginLeft: 16 }}>
            <option value="alle">Alle</option>
            <option value="dienstleistung">Dienstleistungen</option>
            <option value="material">Material</option>
          </select>

          {/* Buttons oben rechts */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button
                onClick={() => setShowImportModal(true)}
                style={{
                  padding: '8px 16px', borderRadius: 8, border: '1px solid #d4dcd4',
                  background: '#fff', color: '#3d6641', fontSize: 12.5, fontWeight: 600,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6
                }}
            >
              📊 Import
            </button>
            <button onClick={openNew} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#3d6641', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
              + Neuer Artikel
            </button>
          </div>
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ ...card, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
              <tr style={{ background: '#f7faf7', color: '#6b826b', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                <th style={{ textAlign: 'left', padding: '9px 12px' }}>Nr.</th>
                <th style={{ textAlign: 'left', padding: '9px 12px' }}>Typ</th>
                <th style={{ textAlign: 'left', padding: '9px 12px' }}>Bezeichnung</th>
                <th style={{ textAlign: 'left', padding: '9px 12px' }}>Einheit</th>
                <th style={{ textAlign: 'right', padding: '9px 12px' }}>VK-Preis</th>
                <th style={{ textAlign: 'left', padding: '9px 12px' }}>MWST</th>
                <th style={{ textAlign: 'left', padding: '9px 12px' }}>Ertragskonto</th>
                <th style={{ width: 80 }}></th>
              </tr>
              </thead>
              <tbody>
              {loading && <tr><td colSpan={8} style={{ padding: 20, color: '#94a394' }}>Lädt…</td></tr>}
              {!loading && shown.length === 0 && <tr><td colSpan={8} style={{ padding: 20, color: '#94a394' }}>Keine Artikel — lege den ersten an.</td></tr>}
              {shown.map(a => {
                const b = TYP_BADGE[a.typ] ?? TYP_BADGE.dienstleistung;
                return (
                    <tr key={a.id} style={{ borderTop: '1px solid #f0f3f0', opacity: a.aktiv ? 1 : 0.5 }}>
                      <td style={{ padding: '9px 12px', fontVariantNumeric: 'tabular-nums', color: '#6b826b' }}>{a.nr}</td>
                      <td style={{ padding: '9px 12px' }}><span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: b.bg, color: b.color }}>{b.label}</span></td>
                      <td style={{ padding: '9px 12px', fontWeight: 600, cursor: 'pointer' }} onClick={() => setModal({ ...a })}>{a.name}</td>
                      <td style={{ padding: '9px 12px' }}>{a.einheit}</td>
                      <td style={{ padding: '9px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{CHF(a.verkaufspreis)}</td>
                      <td style={{ padding: '9px 12px', color: '#5a7aaa' }}>{a.mwst_code}</td>
                      <td style={{ padding: '9px 12px', fontVariantNumeric: 'tabular-nums', color: '#6b826b' }}>{a.ertragskonto || '—'}</td>
                      <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                        <button onClick={() => setModal({ ...a })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5a7aaa', marginRight: 8 }}>✎</button>
                        <button onClick={() => del(a)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c4893a' }}>✕</button>
                      </td>
                    </tr>
                );
              })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal: Artikel bearbeiten / anlegen */}
        {modal && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                 onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
              <div style={{ ...card, width: 520, maxWidth: '96vw' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #eef2ee', fontWeight: 700, fontSize: 14 }}>
                  {modal.id ? 'Artikel bearbeiten' : 'Neuer Artikel'} {modal.nr && <span style={{ color: '#94a394', fontWeight: 500 }}>· {modal.nr}</span>}
                </div>
                <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div><label style={lbl}>Typ</label>
                    <select style={inp} value={modal.typ} onChange={e => set({ typ: e.target.value })}>
                      <option value="dienstleistung">Dienstleistung</option>
                      <option value="material">Material</option>
                    </select>
                  </div>
                  <div><label style={lbl}>Einheit</label><input style={inp} value={modal.einheit} onChange={e => set({ einheit: e.target.value })} /></div>
                  <div style={{ gridColumn: '1 / 3' }}><label style={lbl}>Bezeichnung *</label><input style={inp} value={modal.name} onChange={e => set({ name: e.target.value })} /></div>
                  <div style={{ gridColumn: '1 / 3' }}><label style={lbl}>Beschreibung</label><input style={inp} value={modal.beschreibung || ''} onChange={e => set({ beschreibung: e.target.value })} /></div>
                  <div><label style={lbl}>VK-Preis (netto)</label><input type="number" step="0.05" style={inp} value={modal.verkaufspreis} onChange={e => set({ verkaufspreis: e.target.value })} /></div>
                  <div><label style={lbl}>MWST-Code</label>
                    <select style={inp} value={modal.mwst_code} onChange={e => set({ mwst_code: e.target.value })}>
                      {umsatzCodes.map(c => <option key={c.code} value={c.code}>{c.code} · {c.satz}%</option>)}
                      {umsatzCodes.length === 0 && <option value="U81">U81 · 8.1%</option>}
                    </select>
                  </div>
                  <div style={{ gridColumn: '1 / 3' }}><label style={lbl}>Ertragskonto</label>
                    <select style={inp} value={modal.ertragskonto || ''} onChange={e => set({ ertragskonto: e.target.value })}>
                      <option value="">— wählen —</option>
                      {ertragKonten.map(k => <option key={k.konto_nr} value={k.konto_nr}>{k.konto_nr} {k.bezeichnung}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ padding: '14px 20px', borderTop: '1px solid #eef2ee', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button onClick={() => setModal(null)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #d4dcd4', background: '#fff', cursor: 'pointer' }}>Abbrechen</button>
                  <button onClick={save} disabled={saving} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#3d6641', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>{saving ? 'Speichert…' : 'Speichern'}</button>
                </div>
              </div>
            </div>
        )}

        {/* Modal: XLSX / CSV Import */}
        {showImportModal && (
            <div
                style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={e => { if (e.target === e.currentTarget && !importing) setShowImportModal(false); }}
            >
              <div style={{ ...card, width: 440, maxWidth: '96vw' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #eef2ee', fontWeight: 700, fontSize: 14 }}>
                  Produkte importieren (Bexio Excel)
                </div>
                <div style={{ padding: 20 }}>
                  <p style={{ fontSize: 12.5, color: '#555', marginTop: 0, marginBottom: 16 }}>
                    Wähle eine `.xlsx` Datei aus deinem Bexio-Export.
                  </p>

                  <div
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        border: '2px dashed #d4dcd4',
                        borderRadius: 8,
                        padding: 24,
                        textAlign: 'center',
                        background: '#f7faf7',
                        cursor: 'pointer'
                      }}
                  >
                    <input
                        type="file"
                        ref={fileInputRef}
                        accept=".xlsx"
                        style={{ display: 'none' }}
                        onChange={e => setImportFile(e.target.files[0] || null)}
                    />
                    <div style={{ fontSize: 24, marginBottom: 8 }}>📊</div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: '#3d6641' }}>
                      {importFile ? importFile.name : 'Excel-Datei auswählen'}
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