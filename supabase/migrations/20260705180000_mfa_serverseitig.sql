-- ============================================================================
-- MFA serverseitig erzwingen (bisher nur clientseitig).
-- Problem: Eine aal1-Session (nur Passwort, 2. Faktor noch nicht bestaetigt)
-- konnte die DB via PostgREST direkt lesen/schreiben -> ein geklautes Passwort
-- allein reichte. Der Client zeigt zwar den MFA-Dialog, die API/DB erzwang aber
-- nichts.
--
-- Fix: Helfer mfa_satisfied() = (aal2) ODER (Nutzer hat KEINE verifizierten
-- MFA-Faktoren). Fuer Nutzer OHNE MFA ein No-Op; fuer MFA-Nutzer ist der Zugriff
-- auf sensible Tabellen erst nach dem 2. Faktor (aal2) erlaubt. Als RESTRICTIVE
-- Policy (AND-verknuepft) auf die sensiblen Daten-Tabellen. service_role (Edge
-- Functions) umgeht RLS; anon ist ohnehin durch die permissiven Policies gesperrt.
--
-- Hinweis: Der Client liest bei aal1-braucht-MFA keine Tabellen (zeigt den MFA-
-- Dialog); loadProfile laeuft erst nach aal2 -> kein Bruch des Login-Ablaufs.
-- profiles wird bewusst NICHT gegated (Setup-/Invite-Flow).
-- ============================================================================

create or replace function public.mfa_satisfied()
  returns boolean
  language sql stable security definer set search_path = public
  as $$
  select
    coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
    or not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = auth.uid() and f.status = 'verified'
    );
$$;
grant execute on function public.mfa_satisfied() to authenticated, service_role;

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and (
        tablename like 'fibu\_%' escape '\'
        or tablename like 'le\_%' escape '\'
        or tablename in (
          'customers','personen','dokumente','dokumente_versions','share_links',
          'fristen','tasks','task_comments','chartis_messages','chartis_threads',
          'aktienbuch','signaturen'
        )
      )
      -- Zaehler/Config/oeffentliche Kurse ausnehmen (kein sensibler Mandantsinhalt
      -- bzw. per service_role/cron beschrieben)
      and tablename not in (
        'fibu_buchungs_counter','le_invoice_counter','le_number_sequence',
        'fibu_wechselkurse'
      )
  loop
    execute format('drop policy if exists require_mfa on public.%I', t);
    execute format(
      'create policy require_mfa on public.%I as restrictive for all to authenticated '
      || 'using (public.mfa_satisfied()) with check (public.mfa_satisfied())', t);
  end loop;
end $$;
