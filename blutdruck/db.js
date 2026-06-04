// Kleine SQL-Datenbank (SQLite) für die Blutdruckwerte.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Speicherort: per DATA_DIR konfigurierbar (z.B. gemountete Festplatte beim Hosting),
// sonst lokaler Ordner ./data.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'blutdruck.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS readings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    measured_at TEXT    NOT NULL,            -- ISO-Zeitpunkt der Messung (aus Foto-EXIF)
    systolic    INTEGER,                     -- oberer Blutdruck (SYS)
    diastolic   INTEGER,                     -- unterer Blutdruck (DIA)
    pulse       INTEGER,                     -- Puls
    arrhythmia  INTEGER NOT NULL DEFAULT 0,  -- Herzrhythmusstörung: 1 = ja, 0 = nein
    note        TEXT,
    photo       TEXT,                        -- Dateiname des gespeicherten Fotos
    source      TEXT    NOT NULL DEFAULT 'foto', -- 'foto' | 'manuell'
    ai_provider TEXT,                        -- welche KI hat ausgelesen
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_readings_measured_at ON readings(measured_at);
`);

const toBit = (v) => (v ? 1 : 0);

export function insertReading(r) {
  const stmt = db.prepare(`
    INSERT INTO readings (measured_at, systolic, diastolic, pulse, arrhythmia, note, photo, source, ai_provider)
    VALUES (@measured_at, @systolic, @diastolic, @pulse, @arrhythmia, @note, @photo, @source, @ai_provider)
  `);
  const info = stmt.run({
    measured_at: r.measured_at,
    systolic: r.systolic ?? null,
    diastolic: r.diastolic ?? null,
    pulse: r.pulse ?? null,
    arrhythmia: toBit(r.arrhythmia),
    note: r.note ?? null,
    photo: r.photo ?? null,
    source: r.source ?? 'foto',
    ai_provider: r.ai_provider ?? null,
  });
  return getReading(info.lastInsertRowid);
}

export function listReadings() {
  return db.prepare('SELECT * FROM readings ORDER BY measured_at ASC, id ASC').all();
}

export function getReading(id) {
  return db.prepare('SELECT * FROM readings WHERE id = ?').get(id);
}

export function updateReading(id, fields) {
  const allowed = ['measured_at', 'systolic', 'diastolic', 'pulse', 'arrhythmia', 'note'];
  const sets = [];
  const params = { id };
  for (const key of allowed) {
    if (key in fields) {
      sets.push(`${key} = @${key}`);
      params[key] = key === 'arrhythmia' ? toBit(fields[key]) : fields[key];
    }
  }
  if (!sets.length) return getReading(id);
  db.prepare(`UPDATE readings SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getReading(id);
}

export function deleteReading(id) {
  const row = getReading(id);
  db.prepare('DELETE FROM readings WHERE id = ?').run(id);
  return row;
}

export default db;
