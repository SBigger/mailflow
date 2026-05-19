-- ─────────────────────────────────────────────────────────────────
-- fibu_delete_mandant: Mandant inkl. aller Daten löschen (CASCADE)
-- Nur der Admin des Mandanten darf löschen.
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fibu_delete_mandant(p_mandant_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Nur Admins dürfen löschen
  IF NOT fibu_user_is_admin_for(p_mandant_id) THEN
    RAISE EXCEPTION 'Nur Administratoren können einen Mandanten löschen';
  END IF;

  -- Löschen — ON DELETE CASCADE übernimmt alle Abhängigkeiten
  DELETE FROM fibu_mandanten WHERE id = p_mandant_id;
END;
$$;
