-- Zeitblock für Task-Planung im Kalender (Drag & Drop von Tasks aufs Wochenraster)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scheduled_end   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tasks_scheduled_start ON tasks (scheduled_start);
