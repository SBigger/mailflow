-- =====================================================================
-- Projekt-eigene Rechnungs-E-Mail. Beim Rechnungsversand wird diese (falls
-- gesetzt) statt der Kunden-E-Mail (customers.billing_email) verwendet.
-- Idempotent.
-- =====================================================================

alter table public.le_project
  add column if not exists billing_email text;
