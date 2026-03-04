-- Fix domain_tag_rules RLS: separate INSERT WITH CHECK from SELECT USING
-- The original FOR ALL with only USING can cause INSERT issues in some Postgres versions

ALTER TABLE domain_tag_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own domain_tag_rules" ON domain_tag_rules;

-- SELECT / UPDATE / DELETE: only own rules
CREATE POLICY "domain_tag_rules_select"
  ON domain_tag_rules FOR SELECT
  USING (auth.uid() = created_by);

CREATE POLICY "domain_tag_rules_insert"
  ON domain_tag_rules FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "domain_tag_rules_update"
  ON domain_tag_rules FOR UPDATE
  USING (auth.uid() = created_by);

CREATE POLICY "domain_tag_rules_delete"
  ON domain_tag_rules FOR DELETE
  USING (auth.uid() = created_by);

-- Fix profiles RLS: allow admins to see all profiles (needed for user management)
-- Without this, Settings > Benutzer only shows the logged-in user

DROP POLICY IF EXISTS "Users see own profile" ON profiles;

-- Helper function to check admin role without RLS recursion
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Own profile: always visible + editable
CREATE POLICY "profiles_own"
  ON profiles FOR ALL
  USING (auth.uid() = id);

-- Admins can also read all profiles
CREATE POLICY "profiles_admin_read_all"
  ON profiles FOR SELECT
  USING (public.is_admin_user());
