-- ════════════════════════════════════════════════════════════════
--  Blutdruck-Tracker – Supabase-Einrichtung
--  Einmalig im Supabase-Dashboard unter  SQL Editor  ausführen.
--  (Funktioniert auch, wenn schon andere Mini-Apps im selben Projekt
--   liegen – es wird nur die Tabelle "readings" + ein Foto-Bucket angelegt.)
-- ════════════════════════════════════════════════════════════════

-- 1) Tabelle für die Messwerte
create table if not exists public.readings (
  id          bigint generated always as identity primary key,
  measured_at timestamptz not null,                 -- Zeitpunkt der Messung
  systolic    integer,                              -- oberer Blutdruck (SYS)
  diastolic   integer,                              -- unterer Blutdruck (DIA)
  pulse       integer,                              -- Puls
  arrhythmia  boolean     not null default false,   -- Herzrhythmusstörung
  note        text,
  photo       text,                                 -- Dateiname im Storage-Bucket
  source      text        not null default 'foto',  -- 'foto' | 'manuell'
  ai_provider text,                                 -- welche KI hat ausgelesen
  created_at  timestamptz not null default now()
);

create index if not exists idx_readings_measured_at on public.readings (measured_at);

-- Row-Level-Security aktivieren. Die App greift serverseitig mit dem
-- Service-Role-Key zu (umgeht RLS); ohne diesen Key ist die Tabelle dicht.
alter table public.readings enable row level security;

-- 2) Privater Bucket für die Fotos
insert into storage.buckets (id, name, public)
values ('blutdruck-fotos', 'blutdruck-fotos', false)
on conflict (id) do nothing;
