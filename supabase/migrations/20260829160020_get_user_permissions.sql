create or replace function public.get_user_permissions(user_id uuid)
              returns setof text
              language plpgsql
              security definer
              as $$
              declare
              v_role text;
begin
-- Rolle des Benutzers aus der Profile-Tabelle auslesen
select role into v_role
from public.profiles
where id = user_id;

if v_role is null then
        return;
end if;

    -- Prüfen, ob für diese Rolle ein Wildcard-Pfad '*' existiert
if exists (
        select 1 from public.module_permissions mp
        where mp.role = v_role
          and mp.allowed_path = '*'
    ) then
        return next '*';
return;
end if;

    -- Andernfalls alle spezifischen Pfade für die Rolle zurückgeben
return query
select distinct mp.allowed_path
from public.module_permissions mp
where mp.role = v_role;
end;
$$;

INSERT INTO permissions (id, role, some_column, route, created_at) VALUES
                                                                       ('uuid-1', 'mandatsleiter', NULL, '*', '2026-08-28 10:06:00'),
                                                                       ('uuid-2', 'admin', NULL, '*', '2026-08-29 14:24:00'),
                                                                       ('uuid-3', 'sachbearbeiter', NULL, '*', '2026-08-28 10:07:00'),
                                                                       ('uuid-4', 'extern', NULL, '/fibu', '2026-08-28 10:16:00');