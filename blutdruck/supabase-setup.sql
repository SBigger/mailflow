-- ════════════════════════════════════════════════════════════════
--  Blutdruck-Tracker – Supabase-Einrichtung
--  Einmalig im Supabase-Dashboard unter  SQL Editor  ausführen.
--
--  SICHER für ein GETEILTES Projekt (z. B. zusammen mit Graphia):
--  Es wird NUR die Tabelle "readings" + ein eigener Foto-Bucket angelegt,
--  alles mit Row-Level-Security – jeder sieht nur seine eigenen Daten.
--  Andere Tabellen/Buckets im Projekt bleiben unberührt.
-- ════════════════════════════════════════════════════════════════

-- 1) Tabelle für die Messwerte
create table if not exists public.readings (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null default auth.uid(),   -- Besitzer der Zeile
  measured_at timestamptz not null,
  systolic    integer,
  diastolic   integer,
  pulse       integer,
  arrhythmia  boolean     not null default false,
  note        text,
  photo       text,
  source      text        not null default 'foto',
  ai_provider text,
  created_at  timestamptz not null default now()
);
-- falls die Tabelle aus einer früheren Version ohne user_id existiert:
alter table public.readings add column if not exists user_id uuid not null default auth.uid();

create index if not exists idx_readings_measured_at on public.readings (measured_at);
create index if not exists idx_readings_user        on public.readings (user_id);

-- 2) Row-Level-Security: jeder Nutzer nur seine eigenen Zeilen
alter table public.readings enable row level security;

drop policy if exists "readings_select_own" on public.readings;
create policy "readings_select_own" on public.readings
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "readings_insert_own" on public.readings;
create policy "readings_insert_own" on public.readings
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "readings_update_own" on public.readings;
create policy "readings_update_own" on public.readings
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "readings_delete_own" on public.readings;
create policy "readings_delete_own" on public.readings
  for delete to authenticated using (auth.uid() = user_id);

-- 3) Privater Foto-Bucket + Policies (nur eigene Fotos)
insert into storage.buckets (id, name, public)
values ('blutdruck-fotos', 'blutdruck-fotos', false)
on conflict (id) do nothing;

drop policy if exists "blutdruck_fotos_insert" on storage.objects;
create policy "blutdruck_fotos_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'blutdruck-fotos' and owner = auth.uid());

drop policy if exists "blutdruck_fotos_select" on storage.objects;
create policy "blutdruck_fotos_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'blutdruck-fotos' and owner = auth.uid());

drop policy if exists "blutdruck_fotos_delete" on storage.objects;
create policy "blutdruck_fotos_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'blutdruck-fotos' and owner = auth.uid());
