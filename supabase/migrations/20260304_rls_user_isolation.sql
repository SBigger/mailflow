-- ============================================================
-- Row Level Security: Jeder User sieht nur seine eigenen Daten
-- Ausführen im Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- MAIL ITEMS: Jeder User sieht nur seine eigenen Mails
ALTER TABLE mail_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own mail_items" ON mail_items;
CREATE POLICY "Users see own mail_items"
  ON mail_items
  FOR ALL
  USING (auth.uid() = created_by::uuid);

-- KANBAN COLUMNS: Jeder User sieht nur seine eigenen Spalten
ALTER TABLE kanban_columns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own kanban_columns" ON kanban_columns;
CREATE POLICY "Users see own kanban_columns"
  ON kanban_columns
  FOR ALL
  USING (auth.uid() = created_by::uuid);

-- MAIL KANBAN MAPPINGS: Jeder User sieht nur seine eigenen Mappings
ALTER TABLE mail_kanban_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own mail_kanban_mappings" ON mail_kanban_mappings;
CREATE POLICY "Users see own mail_kanban_mappings"
  ON mail_kanban_mappings
  FOR ALL
  USING (auth.uid() = created_by::uuid);

-- TASKS: Jeder User sieht Tasks die er erstellt hat ODER die ihm zugewiesen sind
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own or assigned tasks" ON tasks;
CREATE POLICY "Users see own or assigned tasks"
  ON tasks
  FOR ALL
  USING (
    auth.uid() = created_by::uuid
    OR assignee = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- TAGS: Jeder User sieht nur seine eigenen Tags
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own tags" ON tags;
CREATE POLICY "Users see own tags"
  ON tags
  FOR ALL
  USING (auth.uid() = created_by::uuid);

-- DOMAIN TAG RULES: Jeder User sieht nur seine eigenen Regeln
ALTER TABLE domain_tag_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own domain_tag_rules" ON domain_tag_rules;
CREATE POLICY "Users see own domain_tag_rules"
  ON domain_tag_rules
  FOR ALL
  USING (auth.uid() = created_by::uuid);

-- PROFILES: Jeder User sieht nur sein eigenes Profil
-- (Admins können alle sehen - via Edge Functions mit service_role key)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own profile" ON profiles;
CREATE POLICY "Users see own profile"
  ON profiles
  FOR ALL
  USING (auth.uid() = id);

-- ============================================================
-- NEUE FELDER (falls noch nicht vorhanden)
-- Ausführen im Supabase SQL Editor
-- ============================================================

-- mail_items: is_archived (Mail aus Outlook gelöscht, aber in Kanban behalten)
ALTER TABLE mail_items ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;

-- mail_items: customer_id (welchem Kunden gehört diese Mail)
ALTER TABLE mail_items ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

-- ============================================================
-- HINWEIS: Tabellen ohne RLS (geteilte Daten, kein user-filter):
--   - customers, task_columns, priorities, projects, customers,
--     activity_templates, staff
-- Diese Tabellen sind bewusst für alle sichtbar.
-- ============================================================
