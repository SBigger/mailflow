-- ─────────────────────────────────────────────────────────────────
-- FiBu Benutzerverwaltung: RPCs für Admin-UI
--   • fibu_list_mandant_users   – User mit Email/Name auflisten
--   • fibu_set_mandant_user_role – Rolle setzen / User hinzufügen
--   • fibu_remove_mandant_user  – User entfernen (letzter Admin geschützt)
-- ─────────────────────────────────────────────────────────────────

-- ── 1. User auflisten (liest auth.users → SECURITY DEFINER) ──────
CREATE OR REPLACE FUNCTION fibu_list_mandant_users(p_mandant_id UUID)
RETURNS TABLE(
  user_id      UUID,
  email        TEXT,
  display_name TEXT,
  role         TEXT,
  created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT fibu_user_is_admin_for(p_mandant_id) THEN
    RAISE EXCEPTION 'Nur Administratoren können Benutzer verwalten';
  END IF;

  RETURN QUERY
  SELECT
    a.user_id,
    u.email::TEXT,
    COALESCE(
      u.raw_user_meta_data->>'full_name',
      u.raw_user_meta_data->>'name',
      split_part(u.email, '@', 1)
    )::TEXT AS display_name,
    a.role,
    a.created_at
  FROM fibu_user_mandant_access a
  JOIN auth.users u ON u.id = a.user_id
  WHERE a.mandant_id = p_mandant_id
  ORDER BY a.created_at;
END;
$$;

-- ── 2. Rolle setzen / User hinzufügen ────────────────────────────
CREATE OR REPLACE FUNCTION fibu_set_mandant_user_role(
  p_mandant_id    UUID,
  p_target_user_id UUID,
  p_role           TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT fibu_user_is_admin_for(p_mandant_id) THEN
    RAISE EXCEPTION 'Nur Administratoren können Benutzerrollen ändern';
  END IF;

  IF p_role NOT IN ('admin', 'buchhalter', 'readonly') THEN
    RAISE EXCEPTION 'Ungültige Rolle: %', p_role;
  END IF;

  INSERT INTO fibu_user_mandant_access (mandant_id, user_id, role)
  VALUES (p_mandant_id, p_target_user_id, p_role)
  ON CONFLICT (user_id, mandant_id) DO UPDATE SET role = EXCLUDED.role;
END;
$$;

-- ── 3. User entfernen ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fibu_remove_mandant_user(
  p_mandant_id     UUID,
  p_target_user_id UUID
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin_count INT;
  v_target_role TEXT;
BEGIN
  IF NOT fibu_user_is_admin_for(p_mandant_id) THEN
    RAISE EXCEPTION 'Nur Administratoren können Benutzer entfernen';
  END IF;

  SELECT role INTO v_target_role
  FROM fibu_user_mandant_access
  WHERE mandant_id = p_mandant_id AND user_id = p_target_user_id;

  IF v_target_role = 'admin' THEN
    SELECT COUNT(*) INTO v_admin_count
    FROM fibu_user_mandant_access
    WHERE mandant_id = p_mandant_id AND role = 'admin';

    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'Der letzte Administrator kann nicht entfernt werden';
    END IF;
  END IF;

  DELETE FROM fibu_user_mandant_access
  WHERE mandant_id = p_mandant_id AND user_id = p_target_user_id;
END;
$$;
