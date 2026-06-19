-- =====================================================================
-- Robuste Akonto-Verrechnung: direkte Verknuepfung der Abzugs-Position zum
-- Akonto. Bisher wurde die negative "Abzug Akonto ..."-Line beim Entfernen
-- per String-Match in der Beschreibung gesucht -> verwaiste, wenn der User
-- die Beschreibung aenderte. Jetzt ueber le_invoice_line.akonto_invoice_id.
-- Idempotent (add column if not exists).
-- =====================================================================

alter table public.le_invoice_line
  add column if not exists akonto_invoice_id uuid
  references public.le_invoice(id) on delete set null;

create index if not exists idx_le_invoice_line_akonto
  on public.le_invoice_line(akonto_invoice_id);
