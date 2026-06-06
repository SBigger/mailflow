import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { insertReading, listReadings, getReading, updateReading, deleteReading } from './db.js';
import { savePhoto, loadPhoto, removePhoto } from './storage.js';
import { analyzeImage, aiConfigured } from './ai.js';
import { requireAuth, getPublicConfig, authConfigured } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
// Lokal (npm start) bedient Express auch das Frontend. Auf Vercel werden die
// Dateien in /public direkt von Vercel ausgeliefert – dort greift das nicht.
app.use(express.static(path.join(__dirname, 'public')));

// Öffentliche Frontend-Konfiguration (anon-/publishable-Key ist für den Browser bestimmt).
app.get('/api/config', (_req, res) => {
  res.json({ ...getPublicConfig(), aiConfigured: aiConfigured() });
});

// Ab hier sind alle Datenendpunkte nur nach Anmeldung (gültiger Token) erreichbar.
// Jeder Zugriff läuft als der angemeldete Nutzer (req.sb), RLS schützt die Daten.
app.use(['/api/readings', '/api/export.xlsx'], requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB (Bild wird im Browser ohnehin verkleinert)
});

// Datum aus den EXIF-Daten des Fotos lesen (Fallback; primär liefert es der Browser mit).
async function exifDate(buffer) {
  try {
    const { default: exifr } = await import('exifr'); // erst bei Bedarf laden (schnellerer Cold-Start)
    const ex = await exifr.parse(buffer, ['DateTimeOriginal', 'CreateDate', 'ModifyDate']);
    const d = ex?.DateTimeOriginal || ex?.CreateDate || ex?.ModifyDate;
    if (d instanceof Date && !isNaN(d)) return d;
  } catch {
    /* kein EXIF vorhanden */
  }
  return null;
}

// Blutdruck-Kategorie (für Excel-Export & Auswertung); ARGB-Farben für ExcelJS.
const CATEGORIES = [
  { label: 'Hypertonie Grad 3', color: 'FF7F1D1D', test: (s, d) => s >= 180 || d >= 110 },
  { label: 'Hypertonie Grad 2', color: 'FFB91C1C', test: (s, d) => s >= 160 || d >= 100 },
  { label: 'Hypertonie Grad 1', color: 'FFEA580C', test: (s, d) => s >= 140 || d >= 90 },
  { label: 'Hoch-normal',       color: 'FFCA8A04', test: (s, d) => s >= 130 || d >= 85 },
  { label: 'Normal',            color: 'FF65A30D', test: (s, d) => s >= 120 || d >= 80 },
  { label: 'Optimal',           color: 'FF16A34A', test: () => true },
];
function categoryOf(sys, dia) {
  if (sys == null || dia == null) return { label: '–', color: 'FF9CA3AF' };
  return CATEGORIES.find((c) => c.test(sys, dia)) || { label: '–', color: 'FF9CA3AF' };
}

// Hilfen für den Import
function toInt(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'object' && v.result != null) v = v.result;
  const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}
function parseDateTime(datumVal, zeitVal) {
  let d = null;
  if (datumVal instanceof Date) {
    d = new Date(datumVal);
  } else if (typeof datumVal === 'string') {
    const m = datumVal.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/) || datumVal.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      if (m[0].includes('-')) d = new Date(+m[1], +m[2] - 1, +m[3]);
      else { let y = +m[3]; if (y < 100) y += 2000; d = new Date(y, +m[2] - 1, +m[1]); }
    }
  }
  if (!d || isNaN(d)) return null;
  let hh = 12, mm = 0;
  if (zeitVal instanceof Date) { hh = zeitVal.getHours(); mm = zeitVal.getMinutes(); }
  else if (typeof zeitVal === 'number') { const t = Math.round(zeitVal * 24 * 60); hh = Math.floor(t / 60) % 24; mm = t % 60; }
  else if (typeof zeitVal === 'string') { const t = zeitVal.match(/(\d{1,2}):(\d{2})/); if (t) { hh = +t[1]; mm = +t[2]; } }
  d.setHours(hh, mm, 0, 0);
  return d;
}

// Foto hochladen -> Datum bestimmen -> KI-Auslesung -> direkt speichern.
app.post('/api/readings/upload', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Kein Foto erhalten.' });

    const mime = req.file.mimetype || 'image/jpeg';
    const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    await savePhoto(req.sb, filename, req.file.buffer, mime);

    // Messzeitpunkt: vom Browser gelesenes EXIF-Datum hat Vorrang, dann Server-EXIF.
    let measuredAt = null;
    if (req.body?.measured_at) {
      const d = new Date(req.body.measured_at);
      if (!isNaN(d)) measuredAt = d;
    }
    if (!measuredAt) measuredAt = await exifDate(req.file.buffer);

    let ai = null;
    let aiError = null;
    if (aiConfigured()) {
      try {
        ai = await analyzeImage(req.file.buffer, mime);
      } catch (err) {
        aiError = err.message;
      }
    } else {
      aiError = 'Kein KI-Schlüssel konfiguriert – Werte bitte manuell ergänzen.';
    }

    // Fallback-Reihenfolge fürs Datum: EXIF -> im Display lesbares Datum -> jetzt.
    if (!measuredAt && ai?.date) measuredAt = new Date(ai.date + 'T12:00:00');
    if (!measuredAt) measuredAt = new Date();

    const reading = await insertReading(req.sb, {
      measured_at: measuredAt.toISOString(),
      systolic: ai?.systolic ?? null,
      diastolic: ai?.diastolic ?? null,
      pulse: ai?.pulse ?? null,
      arrhythmia: ai?.arrhythmia ?? false,
      photo: filename,
      source: 'foto',
      ai_provider: ai?.ai_provider ?? null,
    });

    res.json({ reading, aiError });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Manuell anlegen (ohne Foto).
app.post('/api/readings', async (req, res) => {
  try {
    const b = req.body || {};
    const measuredAt = b.measured_at ? new Date(b.measured_at) : new Date();
    const reading = await insertReading(req.sb, {
      measured_at: measuredAt.toISOString(),
      systolic: b.systolic ?? null,
      diastolic: b.diastolic ?? null,
      pulse: b.pulse ?? null,
      arrhythmia: !!b.arrhythmia,
      note: b.note ?? null,
      source: 'manuell',
    });
    res.json({ reading });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/readings', async (req, res) => {
  try {
    res.json({ readings: await listReadings(req.sb), aiConfigured: aiConfigured() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/readings/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!(await getReading(req.sb, id))) return res.status(404).json({ error: 'Nicht gefunden.' });
    const b = req.body || {};
    const fields = {};
    for (const k of ['systolic', 'diastolic', 'pulse', 'note']) if (k in b) fields[k] = b[k];
    if ('arrhythmia' in b) fields.arrhythmia = !!b.arrhythmia;
    if ('measured_at' in b && b.measured_at) fields.measured_at = new Date(b.measured_at).toISOString();
    res.json({ reading: await updateReading(req.sb, id, fields) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/readings/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await deleteReading(req.sb, id);
    if (row?.photo) {
      try { await removePhoto(req.sb, row.photo); } catch { /* egal */ }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Foto eines Eintrags anzeigen (aus Supabase Storage gestreamt).
app.get('/api/readings/:id/photo', async (req, res) => {
  try {
    const row = await getReading(req.sb, Number(req.params.id));
    if (!row?.photo) return res.status(404).end();
    const file = await loadPhoto(req.sb, row.photo);
    if (!file) return res.status(404).end();
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(file.buffer);
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

// Excel/CSV-Import: Datei hochladen, Zeilen als Messwerte übernehmen.
app.post('/api/readings/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Keine Datei erhalten.' });
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const name = (req.file.originalname || '').toLowerCase();
    let ws;
    if (name.endsWith('.csv')) {
      const { Readable } = await import('node:stream');
      ws = await wb.csv.read(Readable.from(req.file.buffer.toString('utf8')));
    } else {
      await wb.xlsx.load(req.file.buffer);
      ws = wb.getWorksheet('Messwerte') || wb.worksheets[0];
    }
    if (!ws) return res.status(400).json({ error: 'Keine Tabelle in der Datei gefunden.' });

    // Spalten anhand der Kopfzeile (Zeile 1) erkennen.
    const col = {};
    ws.getRow(1).eachCell((cell, c) => {
      const t = String(cell.value ?? '').toLowerCase();
      if (t.includes('datum')) col.datum = c;
      else if (t.includes('zeit')) col.zeit = c;
      else if (t.includes('sys') || t.includes('ober')) col.sys = c;
      else if (t.includes('dia') || t.includes('unter')) col.dia = c;
      else if (t.includes('puls')) col.puls = c;
      else if (t.includes('rhythm')) col.arr = c;
      else if (t.includes('notiz') || t.includes('note')) col.note = c;
    });

    const dataRows = [];
    ws.eachRow((row, n) => { if (n > 1) dataRows.push(row); });

    let imported = 0, skipped = 0;
    for (const row of dataRows) {
      const get = (c) => (c ? row.getCell(c).value : null);
      const measuredAt = parseDateTime(get(col.datum), get(col.zeit));
      const sys = toInt(get(col.sys));
      const dia = toInt(get(col.dia));
      const puls = toInt(get(col.puls));
      const arrTxt = String(get(col.arr) ?? '').trim().toLowerCase();
      const arrhythmia = ['ja', 'true', '1', 'yes', 'x'].includes(arrTxt);
      const noteVal = get(col.note);
      if (!measuredAt && sys == null && dia == null && puls == null) { skipped++; continue; }
      await insertReading(req.sb, {
        measured_at: (measuredAt || new Date()).toISOString(),
        systolic: sys,
        diastolic: dia,
        pulse: puls,
        arrhythmia,
        note: noteVal ? String(noteVal) : null,
        source: 'import',
      });
      imported++;
    }
    res.json({ imported, skipped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Excel-Export: gestylte Messwert-Tabelle + Auswertungs-Blatt.
app.get('/api/export.xlsx', async (req, res) => {
  try {
    const { default: ExcelJS } = await import('exceljs'); // schwere Lib nur beim Export laden
    const readings = await listReadings(req.sb);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Blutdruck-Tracker';
    wb.created = new Date();

    // ── Blatt 1: Messwerte ──
    const ws = wb.addWorksheet('Messwerte', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Datum', key: 'datum', width: 12 },
      { header: 'Zeit', key: 'zeit', width: 8 },
      { header: 'SYS', key: 'sys', width: 8 },
      { header: 'DIA', key: 'dia', width: 8 },
      { header: 'Puls', key: 'puls', width: 8 },
      { header: 'Kategorie', key: 'kat', width: 20 },
      { header: 'Rhythmusstörung', key: 'arr', width: 18 },
      { header: 'Notiz', key: 'note', width: 30 },
    ];
    const head = ws.getRow(1);
    head.height = 22;
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.alignment = { vertical: 'middle', horizontal: 'center' };
    head.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB91C1C' } };
    });

    for (const r of readings) {
      const cat = categoryOf(r.systolic, r.diastolic);
      const d = new Date(r.measured_at);
      const row = ws.addRow({
        datum: d.toLocaleDateString('de-CH'),
        zeit: d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }),
        sys: r.systolic ?? null,
        dia: r.diastolic ?? null,
        puls: r.pulse ?? null,
        kat: cat.label,
        arr: r.arrhythmia ? 'ja' : 'nein',
        note: r.note || '',
      });
      ['sys', 'dia', 'puls', 'arr'].forEach((k) => { row.getCell(k).alignment = { horizontal: 'center' }; });
      const katCell = row.getCell('kat');
      katCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cat.color } };
      katCell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      katCell.alignment = { horizontal: 'center' };
      if (r.arrhythmia) row.getCell('arr').font = { color: { argb: 'FFB91C1C' }, bold: true };
    }
    ws.autoFilter = { from: 'A1', to: 'H1' };
    ws.eachRow((row) => row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      };
    }));

    // ── Blatt 2: Auswertung ──
    const sum = wb.addWorksheet('Auswertung');
    sum.columns = [{ width: 30 }, { width: 24 }];
    const valid = readings.filter((r) => r.systolic != null && r.diastolic != null);
    const nums = (key) => readings.map((r) => r[key]).filter((x) => x != null);
    const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : '–');
    const sysArr = nums('systolic'), diaArr = nums('diastolic'), pulsArr = nums('pulse');
    const dates = readings.map((r) => new Date(r.measured_at)).sort((a, b) => a - b);
    const fmt = (dt) => (dt ? dt.toLocaleDateString('de-CH') : '–');
    const title = (text) => {
      const r = sum.addRow([text]);
      r.getCell(1).font = { bold: true, size: 12, color: { argb: 'FFB91C1C' } };
    };
    const kv = (label, value) => {
      const r = sum.addRow([label, value]);
      r.getCell(1).font = { bold: true };
    };

    title('Auswertung Blutdruck');
    sum.addRow([]);
    kv('Anzahl Messungen', readings.length);
    kv('Zeitraum', dates.length ? `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}` : '–');
    kv('Mit Rhythmusstörung', readings.filter((r) => r.arrhythmia).length);
    sum.addRow([]);
    title('Mittelwerte');
    kv('Ø Oberer (SYS)', avg(sysArr));
    kv('Ø Unterer (DIA)', avg(diaArr));
    kv('Ø Puls', avg(pulsArr));
    sum.addRow([]);
    title('Bereich (Min – Max)');
    kv('SYS', sysArr.length ? `${Math.min(...sysArr)} – ${Math.max(...sysArr)}` : '–');
    kv('DIA', diaArr.length ? `${Math.min(...diaArr)} – ${Math.max(...diaArr)}` : '–');
    kv('Puls', pulsArr.length ? `${Math.min(...pulsArr)} – ${Math.max(...pulsArr)}` : '–');
    sum.addRow([]);
    const morning = valid.filter((r) => new Date(r.measured_at).getHours() < 12);
    const evening = valid.filter((r) => new Date(r.measured_at).getHours() >= 12);
    title('Tageszeit');
    kv('Morgens (vor 12 Uhr)', `${morning.length} Messungen · Ø ${avg(morning.map((r) => r.systolic))}/${avg(morning.map((r) => r.diastolic))}`);
    kv('Abends (ab 12 Uhr)', `${evening.length} Messungen · Ø ${avg(evening.map((r) => r.systolic))}/${avg(evening.map((r) => r.diastolic))}`);
    sum.addRow([]);
    title('Verteilung nach Kategorie');
    for (const c of [...CATEGORIES].reverse()) {
      const count = valid.filter((r) => categoryOf(r.systolic, r.diastolic).label === c.label).length;
      const r = sum.addRow([c.label, count]);
      r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.color } };
      r.getCell(1).font = { color: { argb: 'FFFFFFFF' }, bold: true };
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="blutdruck_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

// Lokal als Server starten – auf Vercel wird die App stattdessen aus
// api/index.js als serverlose Funktion importiert (kein listen()).
const isRunDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isRunDirectly) {
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`Blutdruck-Tracker läuft auf http://localhost:${PORT}`);
    console.log(`Login/Supabase: ${authConfigured() ? 'konfiguriert' : 'NICHT konfiguriert'}`);
    console.log(`KI-Auslesung: ${aiConfigured() ? 'aktiv' : 'NICHT konfiguriert (nur manuelle Eingabe)'}`);
  });
}

export default app;
