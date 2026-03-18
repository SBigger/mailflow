-- Verantwortlich-Feld für Tasks (speichert E-Mail wie assignee)
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS verantwortlich TEXT;

-- Index für schnelle Abfragen
CREATE INDEX IF NOT EXISTS tasks_verantwortlich_idx ON public.tasks(verantwortlich);

-- RLS Policy erweitern: User sieht Tasks wo er assignee ODER verantwortlich ist
DROP POLICY IF EXISTS "Users see own or assigned tasks" ON tasks;
CREATE POLICY "Users see own or assigned tasks"
  ON tasks
  FOR ALL
  USING (
    auth.uid() = created_by::uuid
    OR assignee      = (SELECT email FROM auth.users WHERE id = auth.uid())
    OR verantwortlich = (SELECT email FROM auth.users WHERE id = auth.uid())
  );
