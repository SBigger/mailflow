-- =====================================================================
-- Leistungserfassung · Mitarbeiter ↔ Profiles Sync
-- =====================================================================
-- Stellt sicher, dass jeder Smartis-User (profiles) auch ein le_employee
-- ist und 1:1 verknüpft bleibt. Backfill bestehender Profiles + Trigger
-- für neue Profiles.
-- =====================================================================

-- Hilfs-Funktion: short_code aus full_name generieren ("Sascha Bigger" → "SB")
create or replace function public.le_short_code_from_name(p_name text)
returns text language plpgsql immutable as $$
declare
  parts text[];
  out text := '';
  i int;
begin
  if p_name is null or length(trim(p_name)) = 0 then return 'XX'; end if;
  parts := regexp_split_to_array(trim(p_name), '\s+');
  for i in 1..least(array_length(parts, 1), 3) loop
    if length(parts[i]) > 0 then
      out := out || upper(substring(parts[i] from 1 for 1));
    end if;
  end loop;
  if length(out) = 0 then out := 'XX'; end if;
  return out;
end $$;

-- Hilfs-Funktion: eindeutigen short_code finden (mit Suffix-1/-2/...)
create or replace function public.le_unique_short_code(p_base text)
returns text language plpgsql as $$
declare
  candidate text := p_base;
  i int := 2;
begin
  while exists (select 1 from public.le_employee where short_code = candidate) loop
    candidate := p_base || i::text;
    i := i + 1;
    if i > 99 then exit; end if;
  end loop;
  return candidate;
end $$;

-- =====================================================================
-- 1) Backfill: jeder profile ohne le_employee → neu anlegen
-- =====================================================================
do $$
declare
  prof record;
  base_code text;
  unique_code text;
begin
  for prof in
    select p.id, p.email,
           coalesce(p.full_name, split_part(p.email, '@', 1)) as nom,
           p.role
    from public.profiles p
    where not exists (
      select 1 from public.le_employee e where e.profile_id = p.id
    )
  loop
    base_code := public.le_short_code_from_name(prof.nom);
    unique_code := public.le_unique_short_code(base_code);
    insert into public.le_employee (profile_id, short_code, full_name, email, role, active)
    values (prof.id, unique_code, prof.nom, prof.email, prof.role, true);
  end loop;
end $$;

-- =====================================================================
-- 2) Trigger: bei neuem Profile auto-create le_employee
-- =====================================================================
create or replace function public.le_sync_profile_to_employee()
returns trigger language plpgsql security definer as $$
declare
  base_code text;
  unique_code text;
  nom text;
begin
  -- Nur einfügen wenn noch keiner existiert
  if exists (select 1 from public.le_employee where profile_id = new.id) then
    return new;
  end if;

  nom := coalesce(new.full_name, split_part(new.email, '@', 1));
  base_code := public.le_short_code_from_name(nom);
  unique_code := public.le_unique_short_code(base_code);

  insert into public.le_employee (profile_id, short_code, full_name, email, role, active)
  values (new.id, unique_code, nom, new.email, new.role, true);
  return new;
end $$;

drop trigger if exists trg_profile_to_employee on public.profiles;
create trigger trg_profile_to_employee
  after insert on public.profiles
  for each row execute function public.le_sync_profile_to_employee();

-- =====================================================================
-- 3) Update-Trigger: Profile-Änderungen synchronisieren (full_name, email, role)
-- =====================================================================
create or replace function public.le_update_employee_from_profile()
returns trigger language plpgsql security definer as $$
begin
  if (new.full_name is distinct from old.full_name)
     or (new.email is distinct from old.email)
     or (new.role is distinct from old.role)
  then
    update public.le_employee
       set full_name = coalesce(new.full_name, full_name),
           email = coalesce(new.email, email),
           role = coalesce(new.role, role)
     where profile_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_profile_update_employee on public.profiles;
create trigger trg_profile_update_employee
  after update on public.profiles
  for each row execute function public.le_update_employee_from_profile();
