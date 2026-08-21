-- ============================================================================
-- Externe Kundenbenutzer — Fundament + Zugriffshaertung
--
-- Ziel: Ein Kunde soll in Smartis eingeladen werden koennen und dort GENAU
-- einen (oder mehrere) Fibu-Mandanten sehen — und sonst NICHTS.
--
-- Ausgangslage (live geprueft auf smartis.me am 20.08.2026):
--   * Das Fibu-Modul ist bereits sauber mandantenscharf
--     (fibu_user_mandant_access + fibu_mandant_ids_for_user() + RLS auf allen
--     31 fibu_*-Tabellen inkl. Storage-Buckets). Dort ist NICHTS zu tun.
--   * ABER: 63 Policies auf ~50 Nicht-Fibu-Tabellen stehen auf USING (true),
--     d.h. JEDER angemeldete Benutzer darf alles lesen und schreiben
--     (customers, dokumente, tasks, der komplette le_*-Block, ...).
--   * chartis_is_staff() prueft nur "hat eine profiles-Zeile" — also fuer
--     Externe true. Damit haengen 10 Policies auf den internen Chat-Tabellen.
--   * 12 SECURITY-DEFINER-Funktionen umgehen RLS ohne jede Rollenpruefung,
--     die meisten davon sogar fuer anon (ohne Login!) ausfuehrbar.
--
-- Diese Migration dreht das um: Zugriff nur noch fuer Mitarbeitende
-- (is_staff()), Externe kommen ueberall dort nicht mehr durch. Der Fibu-Teil
-- bleibt unveraendert, weil er seine eigene Mandantenpruefung hat.
--
-- Idempotent: mehrfaches Ausfuehren aendert nichts mehr.
-- ============================================================================


-- ── Teil 1: Rolle 'extern' erlauben ─────────────────────────────────────────
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin','mandatsleiter','sachbearbeiter','readonly','task_user','extern'));


-- ── Teil 2: Zentrale Helfer ─────────────────────────────────────────────────
-- is_staff() = Artis-Mitarbeitende. Bewusst eine Positivliste: 'extern' und
-- Benutzer ohne profiles-Zeile sind damit automatisch draussen.
create or replace function public.is_staff() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin','mandatsleiter','sachbearbeiter','readonly','task_user')
                     from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_extern() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'extern' from public.profiles where id = auth.uid()), false);
$$;

-- EXECUTE auch fuer anon: einzelne Policies gelten fuer die Rolle "public"
-- (also inkl. anon). Fehlt dort das Ausfuehrungsrecht, wirft die Policy einen
-- Fehler statt sauber "false" zu liefern.
grant execute on function public.is_staff(), public.is_extern()
  to anon, authenticated, service_role;

-- chartis_is_staff() hing an "hat ueberhaupt ein Profil" → fuer Externe true.
-- Haengt an 10 Policies der internen Kommunikation (chartis_threads etc.).
create or replace function public.chartis_is_staff() returns boolean
  language sql stable security definer set search_path = public as $$
  select public.is_staff();
$$;


-- ── Teil 3: Protokoll fuer die Policy-Umstellung ────────────────────────────
-- Haelt fest, was umgestellt wurde — sowohl zum Nachvollziehen als auch als
-- Grundlage fuer ein Rollback.
create table if not exists public.rls_hardening_log (
  id            bigserial   primary key,
  geaendert_am  timestamptz not null default now(),
  tabelle       text        not null,
  policy_name   text        not null,
  cmd           text,
  alt_using     text,
  alt_check     text
);
alter table public.rls_hardening_log enable row level security;
drop policy if exists rls_hardening_log_admin on public.rls_hardening_log;
create policy rls_hardening_log_admin on public.rls_hardening_log
  for select to authenticated using (public.is_admin());


-- ── Teil 4: Alle USING(true)-Policies auf is_staff() umstellen ──────────────
-- ALTER POLICY laesst Name, Befehl und Rollen unveraendert und tauscht nur den
-- Ausdruck — nichts wird geloescht.
--
-- Ausgenommen:
--   * fibu_* — hat die eigene, feinere Mandantenpruefung. Genau hier SOLLEN
--     Externe ja arbeiten koennen.
--   * rls_hardening_log — eigene Policy, siehe oben.
do $$
declare
  p   record;
  sql text;
begin
  for p in
    select tablename, policyname, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (qual = 'true' or with_check = 'true')
       and tablename not like 'fibu\_%'
       and tablename <> 'rls_hardening_log'
     order by tablename, policyname
  loop
    insert into public.rls_hardening_log (tabelle, policy_name, cmd, alt_using, alt_check)
      values (p.tablename, p.policyname, p.cmd, p.qual, p.with_check);

    sql := format('alter policy %I on public.%I', p.policyname, p.tablename);
    if p.qual = 'true' then
      sql := sql || ' using (public.is_staff())';
    end if;
    if p.with_check = 'true' then
      sql := sql || ' with check (public.is_staff())';
    end if;

    execute sql;
    raise notice 'Policy gehaertet: %.% (%)', p.tablename, p.policyname, p.cmd;
  end loop;
end $$;


-- ── Teil 5: SECURITY-DEFINER-Funktionen mit Rollenpruefung versehen ─────────
-- Diese Funktionen umgehen RLS per Definition. Ohne Pruefung waere die
-- Policy-Haertung oben wirkungslos — ein Externer koennte z.B. ueber
-- search_dokumente saemtliche Dokumente aller Mandate durchsuchen.
--
-- Der Wachposten wird direkt hinter das BEGIN des Funktionskoerpers gesetzt.
-- Vorher geprueft: alle 12 Funktionen haben genau EIN alleinstehendes BEGIN.
-- Wiederholtes Ausfuehren ueberspringt bereits gehaertete Funktionen.
do $$
declare
  f       record;
  guard   text := E'\n  if not public.is_staff() then\n'
                || E'    raise exception ''Kein Zugriff: diese Funktion ist Mitarbeitenden vorbehalten''\n'
                || E'      using errcode = ''42501'';\n'
                || E'  end if;\n';
  neu     text;
begin
  for f in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_language  l on l.oid = p.prolang
     where n.nspname = 'public'
       and l.lanname = 'plpgsql'
       and p.prosecdef
       and p.prosrc !~ 'is_staff'
       and p.proname = any (array[
             'search_dokumente',
             'versioning_diagnose',
             'le_create_dunning_drafts',
             'le_create_expense_invoices',
             'le_create_invoice_drafts',
             'le_generate_recurring_drafts',
             'le_customer_can_delete',
             'le_employee_can_delete',
             'le_project_can_delete',
             'le_service_type_can_delete',
             'le_get_fibu_binding',
             'le_resolve_fibu_sales_tax'
           ])
  loop
    -- nur das erste alleinstehende BEGIN (= Beginn des Koerpers)
    neu := regexp_replace(f.def, '(\n[ \t]*)(begin)([ \t\r]*\n)', '\1\2\3' || guard, 'i');

    if neu = f.def then
      raise exception 'Wachposten konnte in % nicht eingesetzt werden (BEGIN nicht gefunden)', f.proname;
    end if;

    execute neu;
    raise notice 'Wachposten gesetzt: %', f.proname;
  end loop;
end $$;

-- Ausfuehrungsrecht fuer anon entziehen (diese Funktionen sind ausnahmslos
-- Mitarbeiter-Werkzeuge; heute darf sie jeder mit dem oeffentlichen anon-Key
-- aufrufen — auch voellig ohne Login).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array[
             'search_dokumente','versioning_diagnose','chartis_list_staff',
             'le_create_dunning_drafts','le_create_expense_invoices','le_create_invoice_drafts',
             'le_generate_recurring_drafts','le_customer_can_delete','le_employee_can_delete',
             'le_project_can_delete','le_service_type_can_delete','le_get_fibu_binding',
             'le_resolve_fibu_sales_tax','le_list_bound_fibu_revenue_accounts',
             'le_list_fibu_binding_candidates'
           ])
  loop
    execute format('revoke execute on function %s from anon', f.sig);
  end loop;
end $$;

-- BEWUSST NICHT angefasst: get_customers_for_addin() / get_tags_for_addin().
-- Die ruft das Word-Add-in (SmartisWord.dotm) auf; dessen Quelle liegt nicht im
-- Repo, der Aufrufweg (anon-Key oder Benutzer-Token) ist ungeklaert. Beide sind
-- weiterhin ohne Login abrufbar und geben Kundennamen bzw. die Tag-Liste preis.
-- Eigener Auftrag: Add-in auf eine Edge Function mit Token umstellen.
