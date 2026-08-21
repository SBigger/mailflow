-- ============================================================================
-- Benutzerliste eines Fibu-Mandanten: Kunden von Mitarbeitenden unterscheiden
--
-- Ergaenzt fibu_list_mandant_users() um das Kennzeichen ist_extern, damit in
-- der Benutzerverwaltung sichtbar ist, wer ein eingeladener Kundenbenutzer
-- (profiles.role = 'extern') und wer Artis-Mitarbeiter ist.
--
-- Der Rueckgabetyp aendert sich → DROP + CREATE statt CREATE OR REPLACE.
-- ============================================================================

drop function if exists public.fibu_list_mandant_users(uuid);

create function public.fibu_list_mandant_users(p_mandant_id uuid)
returns table (
  user_id      uuid,
  email        text,
  display_name text,
  role         text,
  created_at   timestamptz,
  ist_extern   boolean
)
language plpgsql security definer set search_path to 'public' as $function$
begin
  if not fibu_user_is_admin_for(p_mandant_id) then
    raise exception 'Nur Administratoren koennen Benutzer verwalten';
  end if;

  return query
  select
    a.user_id,
    u.email::text,
    coalesce(
      p.full_name,
      u.raw_user_meta_data->>'full_name',
      u.raw_user_meta_data->>'name',
      split_part(u.email, '@', 1)
    )::text as display_name,
    a.role,
    a.created_at,
    coalesce(p.role = 'extern', false) as ist_extern
  from fibu_user_mandant_access a
  join auth.users u on u.id = a.user_id
  left join profiles p on p.id = a.user_id
  where a.mandant_id = p_mandant_id
  order by a.created_at;
end;
$function$;

grant execute on function public.fibu_list_mandant_users(uuid) to authenticated, service_role;
