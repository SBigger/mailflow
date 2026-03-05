-- Allow admins to update any profile (e.g. change full_name in Settings)
-- Execute in Supabase Dashboard → SQL Editor

DROP POLICY IF EXISTS "profiles_admin_update_all" ON profiles;

CREATE POLICY "profiles_admin_update_all"
  ON profiles
  FOR UPDATE
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());
