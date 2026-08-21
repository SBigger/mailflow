-- ============================================================================
-- get_customers_for_addin / get_tags_for_addin schliessen
--
-- Beide Funktionen sind SECURITY DEFINER (umgehen also RLS) und waren fuer die
-- Rolle anon ausfuehrbar: mit dem oeffentlichen anon-Key bekam JEDER ohne
-- Anmeldung die Liste aller Kunden (company_name, 500 Stueck) und die komplette
-- Tag-Struktur.
--
-- Geprueft am 20.08.2026, warum sie offen standen: Sie stammen aus einem
-- frueheren Entwurf des Word-Add-ins. Das tatsaechlich installierte Add-in
-- (%APPDATA%\Microsoft\Word\STARTUP\SmartisWord.dotm) wurde dekomprimiert und
-- durchsucht — es spricht ausschliesslich http://localhost:7788/upload an
-- (die Desktop-App) und ruft weder Supabase noch diese Funktionen auf.
-- Kein Aufrufer wird also abgeschnitten.
-- ============================================================================

create or replace function public.get_customers_for_addin()
 returns table(id uuid, company_name text)
 language sql security definer set search_path to 'public'
as $function$
  select id, company_name from customers
   where public.is_staff()
   order by company_name limit 500;
$function$;

create or replace function public.get_tags_for_addin()
 returns table(id uuid, name text, parent_id uuid, color text, category text, sort_order integer)
 language sql security definer set search_path to 'public'
as $function$
  select id, name, parent_id, color, category, sort_order from dok_tags
   where public.is_staff()
   order by sort_order limit 500;
$function$;

-- WICHTIG: Postgres gibt neuen Funktionen automatisch EXECUTE an PUBLIC.
-- Ein blosses "revoke ... from anon" laeuft deshalb ins Leere — anon erbt das
-- Recht weiterhin ueber PUBLIC. Erst PUBLIC entziehen, dann gezielt vergeben.
revoke execute on function public.get_customers_for_addin() from public, anon;
revoke execute on function public.get_tags_for_addin()      from public, anon;
grant  execute on function public.get_customers_for_addin() to authenticated, service_role;
grant  execute on function public.get_tags_for_addin()      to authenticated, service_role;

-- Derselbe Fehler steckte in 20260820120000: dort wurde nur anon entzogen.
-- Die Wachposten in den Funktionen greifen zwar, aber anon soll gar nicht erst
-- aufrufen duerfen.
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
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant  execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
