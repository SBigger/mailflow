-- ============================================================
-- Backfill: vollen KB-Content in ticket.body schreiben
-- ============================================================
-- Beim KB-zu-Ticket-Import wurde body auf 250 Zeichen getrimmt;
-- der volle Text steckt in der 1. ticket_messages-Zeile
-- ("Original-KB-Eintrag aus artis...---\n\n{CONTENT}\n\n---...").
-- Wir extrahieren CONTENT, schreiben ihn in body und loeschen
-- die Duplikat-Message.
-- Nur fuer interne Tickets deren title mit '[' beginnt (KB-Imports).
-- ============================================================

BEGIN;

WITH first_msgs AS (
  SELECT DISTINCT ON (tm.ticket_id)
    tm.id        AS msg_id,
    tm.ticket_id,
    tm.body      AS msg_body,
    substring(tm.body FROM E'---\\n\\n(.+?)\\n\\n---') AS extracted_content
  FROM public.ticket_messages tm
  JOIN public.support_tickets st ON st.id = tm.ticket_id
  WHERE st.ticket_type = 'internal'
    AND st.title LIKE '[%'
    AND tm.body LIKE 'Original-KB-Eintrag%'
  ORDER BY tm.ticket_id, tm.created_at ASC
)
UPDATE public.support_tickets st
SET body = fm.extracted_content
FROM first_msgs fm
WHERE st.id = fm.ticket_id
  AND fm.extracted_content IS NOT NULL
  AND length(fm.extracted_content) > length(coalesce(st.body, ''));

-- Jetzt die Duplikat-Messages loeschen
DELETE FROM public.ticket_messages tm
USING public.support_tickets st
WHERE tm.ticket_id = st.id
  AND st.ticket_type = 'internal'
  AND st.title LIKE '[%'
  AND tm.body LIKE 'Original-KB-Eintrag%';

COMMIT;
