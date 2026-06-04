import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import exifr from 'exifr';
import ExcelJS from 'exceljs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { insertReading, listReadings, getReading, updateReading, deleteReading, dbConfigured } from './db.js';
import { savePhoto, loadPhoto, removePhoto } from './storage.js';
import { analyzeImage, aiConfigured } from './ai.js';
import { requireAuth, getPublicConfig } from './auth.js';

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
app.use(['/api/readings', '/api/export.xlsx'], requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB (Bild wird im Browser ohnehin verkleinert)
});

// Datum aus den EXIF-Daten des Fotos lesen (Fallback; primär liefert es der Browser mit).
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

// Foto hochladen -> Datum bestimmen -> KI-Auslesung -> direkt speichern.
app.post('/api/readings/upload', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Kein Foto erhalten.' });

    const mime = req.file.mimetype || 'image/jpeg';
    const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    await savePhoto(filename, req.file.buffer, mime);

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

    const reading = await insertReading({
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
    const reading = await insertReading({
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

app.get('/api/readings', async (_req, res) => {
  try {
    res.json({ readings: await listReadings(), aiConfigured: aiConfigured() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/readings/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!(await getReading(id))) return res.status(404).json({ error: 'Nicht gefunden.' });
    const b = req.body || {};
    const fields = {};
    for (const k of ['systolic', 'diastolic', 'pulse', 'note']) if (k in b) fields[k] = b[k];
    if ('arrhythmia' in b) fields.arrhythmia = !!b.arrhythmia;
    if ('measured_at' in b && b.measured_at) fields.measured_at = new Date(b.measured_at).toISOString();
    res.json({ reading: await updateReading(id, fields) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/readings/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await deleteReading(id);
    if (row?.photo) {
      try { await removePhoto(row.photo); } catch { /* egal */ }
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
    const row = await getReading(Number(req.params.id));
    if (!row?.photo) return res.status(404).end();
    const file = await loadPhoto(row.photo);
    if (!file) return res.status(404).end();
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(file.buffer);
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

// Excel-Export aller Werte.
app.get('/api/export.xlsx', async (_req, res) => {
  try {
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
    for (const r of await listReadings()) {
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
    console.log(`Datenbank (Supabase): ${dbConfigured() ? 'konfiguriert' : 'NICHT konfiguriert'}`);
    console.log(`KI-Auslesung: ${aiConfigured() ? 'aktiv' : 'NICHT konfiguriert (nur manuelle Eingabe)'}`);
  });
}

export default app;
