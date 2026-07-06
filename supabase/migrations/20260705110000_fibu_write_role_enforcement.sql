-- ============================================================================
-- Welle 3a · Fibu: Schreibrechte an die Mandantsrolle koppeln
-- Behebt Review-Fund: RLS prueft nur fibu_mandant_ids_for_user() (Mandantszugriff),
-- NICHT die Rolle -> 'readonly'-User koennen trotzdem INSERT/UPDATE/DELETE.
--
-- Ansatz (risikoarm, additiv): Die bestehenden (permissiven) Policies bleiben
-- unveraendert; wir legen pro Tabelle RESTRICTIVE Write-Guards drueber. Restriktive
-- Policies werden mit den permissiven UND-verknuepft, greifen NUR fuer die
-- Schreibbefehle (INSERT/UPDATE/DELETE) und lassen SELECT voellig unberuehrt.
-- Ergebnis: Lesen wie bisher; Schreiben nur fuer admin/buchhalter des Mandanten.
-- service_role (Edge Functions) umgeht RLS ohnehin.
-- ============================================================================

-- Rollen-Helfer: darf der aktuelle User im Mandanten schreiben?
create or replace function public.fibu_can_write_for(p_mandant_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from fibu_user_mandant_access
    where user_id = auth.uid()
      and mandant_id = p_mandant_id
      and role in ('admin','buchhalter')
  );
$$;
grant execute on function public.fibu_can_write_for(uuid) to authenticated, service_role;

do $$
declare
  t text;
  tables text[] := array[
    'fibu_bank_imports','fibu_bank_transaktionen','fibu_kreditoren_belege',
    'fibu_buchung_belege','fibu_buchung_serien','fibu_buchungen','fibu_budget',
    'fibu_kreditoren_dauerbelege','fibu_rechnung_inbox','fibu_konten',
    'fibu_kontierungsregeln','fibu_lieferanten','fibu_mwst_codes',
    'fibu_mwst_abrechnungsperioden','fibu_kreditoren_positionen',
    'fibu_kreditoren_verrechnungen','fibu_zahlstellen','fibu_zahlungslaeufe',
    'fibu_zahlungslauf_positionen','fibu_jahresabschluss'
  ];
begin
  foreach t in array tables loop
    -- nur Tabellen mit Spalte mandant_id
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='mandant_id'
    ) then
      execute format('drop policy if exists %I on public.%I', t||'_wguard_ins', t);
      execute format('drop policy if exists %I on public.%I', t||'_wguard_upd', t);
      execute format('drop policy if exists %I on public.%I', t||'_wguard_del', t);

      execute format(
        'create policy %I on public.%I as restrictive for insert '
        || 'with check (public.fibu_can_write_for(mandant_id))',
        t||'_wguard_ins', t);
      execute format(
        'create policy %I on public.%I as restrictive for update '
        || 'using (public.fibu_can_write_for(mandant_id)) '
        || 'with check (public.fibu_can_write_for(mandant_id))',
        t||'_wguard_upd', t);
      execute format(
        'create policy %I on public.%I as restrictive for delete '
        || 'using (public.fibu_can_write_for(mandant_id))',
        t||'_wguard_del', t);
    end if;
  end loop;
end $$;
