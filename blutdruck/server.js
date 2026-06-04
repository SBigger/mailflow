import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import exifr from 'exifr';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { insertReading, listReadings, getReading, updateReading, deleteReading } from './db.js';
import { analyzeImage, aiConfigured } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

// Datum aus den EXIF-Daten des Fotos lesen (Wunsch: "Datum vom Foto nehmen").
async function exifDate(buffer) {
  try {
    const ex = await exifr.parse(buffer, ['DateTimeOriginal', 'CreateDate', 'ModifyDate']);
    const d = ex?.DateTimeOriginal || ex?.CreateDate || ex?.ModifyDate;
    if (d instanceof Date && !isNaN(d)) return d;
  } catch {
    /* kein EXIF vorhanden */
  }
  return null;
}

// Foto hochladen -> EXIF-Datum -> KI-Auslesung -> direkt speichern.
app.post('/api/readings/upload', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Kein Foto erhalten.' });

    const mime = req.file.mimetype || 'image/jpeg';
    const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), req.file.buffer);

    const fromExif = await exifDate(req.file.buffer);

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

    // Messzeitpunkt: EXIF-Datum hat Vorrang, dann ein evtl. im Display lesbares Datum, sonst jetzt.
    let measuredAt = fromExif;
    if (!measuredAt && ai?.date) measuredAt = new Date(ai.date + 'T12:00:00');
    if (!measuredAt) measuredAt = new Date();

    const reading = insertReading({
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
app.post('/api/readings', (req, res) => {
  const b = req.body || {};
  const measuredAt = b.measured_at ? new Date(b.measured_at) : new Date();
  const reading = insertReading({
    measured_at: measuredAt.toISOString(),
    systolic: b.systolic ?? null,
    diastolic: b.diastolic ?? null,
    pulse: b.pulse ?? null,
    arrhythmia: !!b.arrhythmia,
    note: b.note ?? null,
    source: 'manuell',
  });
  res.json({ reading });
});

app.get('/api/readings', (_req, res) => {
  res.json({ readings: listReadings(), aiConfigured: aiConfigured() });
});

app.patch('/api/readings/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getReading(id)) return res.status(404).json({ error: 'Nicht gefunden.' });
  const b = req.body || {};
  const fields = {};
  for (const k of ['systolic', 'diastolic', 'pulse', 'note']) if (k in b) fields[k] = b[k];
  if ('arrhythmia' in b) fields.arrhythmia = !!b.arrhythmia;
  if ('measured_at' in b && b.measured_at) fields.measured_at = new Date(b.measured_at).toISOString();
  res.json({ reading: updateReading(id, fields) });
});

app.delete('/api/readings/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = deleteReading(id);
  if (row?.photo) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, row.photo)); } catch { /* egal */ }
  }
  res.json({ ok: true });
});

// Foto eines Eintrags anzeigen.
app.get('/api/readings/:id/photo', (req, res) => {
  const row = getReading(Number(req.params.id));
  if (!row?.photo) return res.status(404).end();
  const file = path.join(UPLOAD_DIR, row.photo);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

// Excel-Export aller Werte.
app.get('/api/export.xlsx', async (_req, res) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Blutdruck-Tracker';
  const ws = wb.addWorksheet('Blutdruck');
  ws.columns = [
    { header: 'Datum', key: 'datum', width: 12 },
    { header: 'Zeit', key: 'zeit', width: 8 },
    { header: 'Oberer (SYS)', key: 'systolic', width: 14 },
    { header: 'Unterer (DIA)', key: 'diastolic', width: 14 },
    { header: 'Puls', key: 'pulse', width: 8 },
    { header: 'Herzrhythmusstörung', key: 'arrhythmia', width: 20 },
    { header: 'Notiz', key: 'note', width: 30 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of listReadings()) {
    const d = new Date(r.measured_at);
    ws.addRow({
      datum: d.toLocaleDateString('de-CH'),
      zeit: d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }),
      systolic: r.systolic,
      diastolic: r.diastolic,
      pulse: r.pulse,
      arrhythmia: r.arrhythmia ? 'ja' : 'nein',
      note: r.note || '',
    });
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="blutdruck_${new Date().toISOString().slice(0, 10)}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Blutdruck-Tracker läuft auf http://localhost:${PORT}`);
  console.log(`KI-Auslesung: ${aiConfigured() ? 'aktiv' : 'NICHT konfiguriert (nur manuelle Eingabe)'}`);
});
