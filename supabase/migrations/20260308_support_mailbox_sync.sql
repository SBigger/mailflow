-- ============================================================
-- Support Mailbox Sync: outlook_message_id + system_settings
-- ============================================================

-- 1. outlook_message_id auf support_tickets (Deduplizierung)
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS outlook_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_outlook_message_id_idx
  ON public.support_tickets(outlook_message_id)
  WHERE outlook_message_id IS NOT NULL;

-- 2. System-Settings Tabelle (Delta-Link für Support-Postfach, etc.)
CREATE TABLE IF NOT EXISTS public.system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Nur Admins dürfen lesen/schreiben
CREATE POLICY "system_settings_admin_all"
  ON public.system_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
