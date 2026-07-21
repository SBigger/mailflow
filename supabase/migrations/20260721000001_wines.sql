-- ══════════════════════════════════════════════════════════════════════
-- Migration: wines
-- Zweck:     Schnelle Weinregistrierung per Handyfoto (KI-Erkennung) + Anzahl
--
-- ADDITIV: keine bestehende Tabelle wird verändert.
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS wines (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Von der KI erkannte (oder manuell nachgetragene) Weinangaben
  name         TEXT,
  winzer       TEXT,
  jahrgang     INT,
  rebsorte     TEXT,
  region       TEXT,
  land         TEXT,
  ai_erkannt   BOOLEAN     DEFAULT FALSE,

  -- Bestand
  quantity     INT         NOT NULL DEFAULT 1,
  notizen      TEXT,
  photo_url    TEXT,

  -- User-Isolation
  created_by   UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wines_created_by ON wines (created_by, created_at DESC);

ALTER TABLE wines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own wines"
  ON wines
  FOR ALL
  USING (created_by = auth.uid());

-- ──────────────────────────────────────────────────────────────────────
-- Storage bucket für Weinflaschen-Fotos
-- ──────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wine-photos',
  'wine-photos',
  true,
  8388608,  -- 8 MB max
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "wine_photos_select" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'wine-photos');

CREATE POLICY "wine_photos_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'wine-photos');

CREATE POLICY "wine_photos_update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'wine-photos');

CREATE POLICY "wine_photos_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'wine-photos');
