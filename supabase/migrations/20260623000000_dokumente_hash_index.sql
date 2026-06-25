-- Schneller Duplikat-Check beim Ablegen (M-Files-Stil):
-- Index auf content_hash, damit "gibt es diese Datei schon?" in wenigen ms geht.
CREATE INDEX IF NOT EXISTS dokumente_content_hash_idx
  ON public.dokumente (content_hash)
  WHERE content_hash IS NOT NULL AND deleted_at IS NULL;
