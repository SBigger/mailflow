-- ============================================================================
-- Welle 1 · Rollen-Fundament
-- Einheitliches Zugriffsrollen-Modell auf profiles.role:
--   admin | mandatsleiter | sachbearbeiter | readonly | task_user
-- is_admin (bool) wird nur noch aus role abgeleitet (nicht mehr eigenständig).
-- Behebt Review-Funde: Self-Admin (profiles-RLS), task_comments offen,
-- fehlende zentrale Rollen-Helfer (search_path).
-- ============================================================================

-- 1) Bestehende Rollen verlustfrei migrieren (do-no-harm) --------------------
alter table public.profiles drop constraint if exists profiles_role_check;

update public.profiles
set role = case
  when is_admin = true or role = 'admin'                        then 'admin'
  when role = 'task_user'                                       then 'task_user'
  when role in ('mandatsleiter','sachbearbeiter','readonly')    then role
  else 'mandatsleiter'   -- 'user'/NULL/Sonstiges -> behaelt heutige Vollrechte
end;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin','mandatsleiter','sachbearbeiter','readonly','task_user'));

alter table public.profiles alter column role set default 'sachbearbeiter';

-- is_admin konsistent an role koppeln (Altspalte, bleibt lesbar)
update public.profiles set is_admin = (role = 'admin');

-- 2) Zentrale Rollen-Helfer (SECURITY DEFINER + fixer search_path) -----------
create or replace function public.app_role() returns text
  language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.can_approve() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin','mandatsleiter') from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.can_manage_stammdaten() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin','mandatsleiter') from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.can_write() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin','mandatsleiter','sachbearbeiter') from public.profiles where id = auth.uid()), false);
$$;

-- Altbestand-Helfer auf role umstellen + haerten (Verhalten unveraendert) ----
create or replace function public.is_admin_user() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.le_is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

grant execute on function
  public.app_role(), public.is_admin(), public.can_approve(),
  public.can_manage_stammdaten(), public.can_write()
  to authenticated, service_role;

-- 3) Self-Escalation blocken -------------------------------------------------
-- role/is_admin duerfen NUR ueber service_role (Edge Functions makeAdmin/
-- inviteUser) geaendert werden, nie vom Client mit dem eigenen JWT.
create or replace function public.profiles_guard_role_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.is_admin is distinct from old.is_admin)
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Rollenaenderung nur ueber die Benutzerverwaltung (Admin) moeglich';
  end if;
  -- is_admin immer aus role ableiten (keine Divergenz mehr)
  new.is_admin := (new.role = 'admin');
  return new;
end;
$$;

drop trigger if exists profiles_guard_role_change_trg on public.profiles;
create trigger profiles_guard_role_change_trg
  before update on public.profiles
  for each row execute function public.profiles_guard_role_change();

-- 4) anon-Zugriff auf profiles entziehen (RLS blockt zwar, defense-in-depth) -
revoke all on table public.profiles from anon;

-- 5) task_comments schliessen (war using(true) with check(true)) -------------
drop policy if exists "allow_all"          on public.task_comments;
drop policy if exists task_comments_read   on public.task_comments;
drop policy if exists task_comments_write  on public.task_comments;

create policy task_comments_read on public.task_comments
  for select to authenticated using (true);

create policy task_comments_write on public.task_comments
  for all to authenticated
  using (public.can_write()) with check (public.can_write());

revoke all on table public.task_comments from anon;
