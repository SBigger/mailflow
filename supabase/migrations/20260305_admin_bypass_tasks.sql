-- ============================================================
-- Admin-Bypass für Tasks: Admins sehen und bearbeiten ALLE Tasks
-- (z.B. Tasks von gelöschten Usern oder ohne Assignee)
-- Ausführen im Supabase Dashboard → SQL Editor
-- ============================================================

-- Admin kann alle Tasks lesen und bearbeiten
DROP POLICY IF EXISTS "tasks_admin_all" ON tasks;
CREATE POLICY "tasks_admin_all"
  ON tasks FOR ALL
  USING (public.is_admin_user());

-- ============================================================
-- Admin kann alle Profile aktualisieren (für Name-Änderung in Settings)
-- ============================================================
DROP POLICY IF EXISTS "profiles_admin_update_all" ON profiles;
CREATE POLICY "profiles_admin_update_all"
  ON profiles FOR UPDATE
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());
