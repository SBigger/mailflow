-- Digitale Signaturanfragen (Skribble Integration)
-- Art. 14 Abs. 2bis OR: AES (Fortgeschrittene Elektronische Signatur) ist rechtsgültig

CREATE TABLE IF NOT EXISTS public.signaturen (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID        REFERENCES auth.users(id),
  customer_id         UUID        REFERENCES public.customers(id) ON DELETE SET NULL,

  -- Dokument-Informationen
  document_name       TEXT        NOT NULL DEFAULT '',
  document_url        TEXT        NOT NULL DEFAULT '',  -- Supabase Storage URL (temp)
  dokument_id         UUID        REFERENCES public.dokumente(id) ON DELETE SET NULL, -- Quell-Dokument (optional)

  -- Skribble-Referenzen
  skribble_request_id TEXT        UNIQUE,              -- Skribble signature request ID
  skribble_document_id TEXT,                           -- Skribble document ID
  signing_url         TEXT,                            -- Direct link to sign

  -- Status: draft | open | signed | declined | withdrawn | expired
  skribble_status     TEXT        NOT NULL DEFAULT 'draft'
                      CHECK (skribble_status IN ('draft','open','signed','declined','withdrawn','expired')),

  -- Unterzeichner (JSONB array)
  -- Format: [{name: "", email: "", mobile: "", signed_at: null, declined_at: null}]
  signers             JSONB       NOT NULL DEFAULT '[]',

  -- Optionen
  message             TEXT        NOT NULL DEFAULT '',
  signature_type      TEXT        NOT NULL DEFAULT 'AES'
                      CHECK (signature_type IN ('SES','AES','QES')),
  expires_at          TIMESTAMPTZ,

  -- Ergebnis
  signed_stored       BOOLEAN     NOT NULL DEFAULT FALSE,  -- In Dokumente abgelegt?
  signed_dokument_url TEXT,                                -- URL des signierten PDFs in Storage
  signed_dokument_id  UUID        REFERENCES public.dokumente(id) ON DELETE SET NULL,
  signed_at           TIMESTAMPTZ,

  -- Metadaten
  notizen             TEXT        NOT NULL DEFAULT ''
);

-- Row Level Security
ALTER TABLE public.signaturen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage signaturen"
  ON public.signaturen FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_signaturen_customer_id    ON public.signaturen(customer_id);
CREATE INDEX IF NOT EXISTS idx_signaturen_status         ON public.signaturen(skribble_status);
CREATE INDEX IF NOT EXISTS idx_signaturen_skribble_id    ON public.signaturen(skribble_request_id)
  WHERE skribble_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_signaturen_created_by     ON public.signaturen(created_by);
