-- ============================================================
-- Aktienbuch (Aktienregister) nach schweizer Obligationenrecht
-- Art. 686 OR (Namenaktien), Art. 697l OR (Wirtschaftl. Berechtigte)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.aktienbuch (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                UUID        REFERENCES auth.users(id),

  -- Gesellschaft (Unternehmen aus customers-Tabelle)
  customer_id               UUID        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,

  -- ── Aktionär (Art. 686 Abs. 1 OR) ────────────────────────────────────────
  aktionaer_name            TEXT        NOT NULL DEFAULT '',  -- Vor-/Nachname oder Firma
  aktionaer_adresse         TEXT        NOT NULL DEFAULT '',  -- Vollständige Adresse
  wirtschaftlich_berechtigter TEXT      NOT NULL DEFAULT '',  -- Art. 697l OR (wenn abweichend)
  nutzniesser               TEXT        NOT NULL DEFAULT '',  -- Nutzniesser (wenn abweichend)

  -- ── Aktien ────────────────────────────────────────────────────────────────
  aktienart                 TEXT        NOT NULL DEFAULT 'Namenaktie',
  -- Werte: Namenaktie | Stammaktie | Vorzugsaktie | Stimmrechtsaktie
  anzahl                    INT         NOT NULL DEFAULT 0,
  nominalwert               NUMERIC(10,2) NOT NULL DEFAULT 100, -- CHF pro Aktie
  liberierungsgrad          INT         NOT NULL DEFAULT 100,   -- 0–100 %

  -- ── Zertifikat (bei verbrieften Aktien) ──────────────────────────────────
  zertifikat_nr             TEXT        NOT NULL DEFAULT '',  -- z.B. "Z-001" oder Nummernreihe
  aktien_nr_von             INT,        -- Aktiennummer von
  aktien_nr_bis             INT,        -- Aktiennummer bis

  -- ── Transaktion ───────────────────────────────────────────────────────────
  transaktionstyp           TEXT        NOT NULL DEFAULT 'Emission',
  -- Emission | Übertragung | Split | Einzug | Korrektur | Gründung
  kaufdatum                 DATE,
  verkaufsdatum             DATE,       -- gesetzt wenn übertragen (aktiv → false)
  datum_vr_entscheid        DATE,       -- Verwaltungsrats-Entscheid (bei Vinkulierung)
  vorgaenger_id             UUID        REFERENCES public.aktienbuch(id), -- Split/Übertragung

  -- ── Status ────────────────────────────────────────────────────────────────
  aktiv                     BOOLEAN     NOT NULL DEFAULT TRUE,  -- false = historisch
  vinkuliert                BOOLEAN     NOT NULL DEFAULT FALSE,

  notizen                   TEXT        NOT NULL DEFAULT '',
  sort_order                INT         NOT NULL DEFAULT 0
);

-- RLS
ALTER TABLE public.aktienbuch ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aktienbuch_auth"
  ON public.aktienbuch FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Indizes
CREATE INDEX IF NOT EXISTS idx_aktienbuch_customer    ON public.aktienbuch(customer_id);
CREATE INDEX IF NOT EXISTS idx_aktienbuch_aktiv       ON public.aktienbuch(customer_id, aktiv);
CREATE INDEX IF NOT EXISTS idx_aktienbuch_vorgaenger  ON public.aktienbuch(vorgaenger_id);
