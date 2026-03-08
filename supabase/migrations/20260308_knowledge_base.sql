-- Wissensdatenbank für KI-Antwortvorschläge
CREATE TABLE IF NOT EXISTS public.knowledge_base (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'Allgemein',
  source_file TEXT,             -- originaler Dateiname (PDF etc.)
  is_active   BOOLEAN DEFAULT TRUE,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage knowledge_base"
  ON public.knowledge_base FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- updated_at Trigger
CREATE OR REPLACE FUNCTION update_knowledge_base_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_knowledge_base_updated_at
  BEFORE UPDATE ON public.knowledge_base
  FOR EACH ROW EXECUTE FUNCTION update_knowledge_base_updated_at();

-- Index für Suche
CREATE INDEX IF NOT EXISTS idx_knowledge_base_category ON public.knowledge_base(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_active   ON public.knowledge_base(is_active);
