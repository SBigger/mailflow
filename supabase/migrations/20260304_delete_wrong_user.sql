-- ============================================================
-- Falschen User sascha.bigger11@gmail.com und alle seine Daten löschen
-- Ausführen im Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

DO $$
DECLARE wrong_user_id UUID;
BEGIN
  SELECT id INTO wrong_user_id FROM auth.users WHERE email = 'sascha.bigger11@gmail.com';

  IF wrong_user_id IS NOT NULL THEN
    RAISE NOTICE 'Lösche Daten für User: %', wrong_user_id;

    DELETE FROM mail_kanban_mappings WHERE created_by = wrong_user_id;
    DELETE FROM mail_items          WHERE created_by = wrong_user_id;
    DELETE FROM kanban_columns      WHERE created_by = wrong_user_id;
    DELETE FROM tasks               WHERE created_by = wrong_user_id;
    DELETE FROM tags                WHERE created_by = wrong_user_id;
    DELETE FROM domain_tag_rules    WHERE created_by = wrong_user_id;
    DELETE FROM profiles            WHERE id = wrong_user_id;

    -- Auth-User selbst löschen (benötigt service_role)
    DELETE FROM auth.users WHERE id = wrong_user_id;

    RAISE NOTICE 'User und alle Daten gelöscht.';
  ELSE
    RAISE NOTICE 'User sascha.bigger11@gmail.com nicht gefunden – nichts zu löschen.';
  END IF;
END $$;
