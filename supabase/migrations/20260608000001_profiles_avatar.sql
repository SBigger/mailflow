-- =====================================================================
-- Mitarbeiter-Fotos (Profilbilder) für Task-Kacheln (Monday-Variante)
-- =====================================================================
-- 1) avatar_url-Spalte auf profiles  → fliesst via getAllUsers (profiles.*)
--    automatisch zu allen Stellen (Task-Board, Zuweisung, etc.)
-- 2) Öffentlicher Storage-Bucket 'avatars' für die Foto-Dateien.
-- =====================================================================

alter table public.profiles
  add column if not exists avatar_url text;

-- Öffentlicher Bucket (Fotos sind interne Mitarbeiter-Headshots, nicht sensibel) -
-- public=true erlaubt direkte URL-Einbindung auf den Kacheln ohne signierte URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true, 5242880,
  array['image/jpeg','image/png','image/webp','image/heic']::text[]
)
on conflict (id) do nothing;

-- Policies: lesen = öffentlich; schreiben/ändern/löschen = authentifiziert
drop policy if exists "avatars_read" on storage.objects;
create policy "avatars_read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars_insert" on storage.objects;
create policy "avatars_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'avatars');

drop policy if exists "avatars_update" on storage.objects;
create policy "avatars_update" on storage.objects
  for update to authenticated using (bucket_id = 'avatars') with check (bucket_id = 'avatars');

drop policy if exists "avatars_delete" on storage.objects;
create policy "avatars_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'avatars');
