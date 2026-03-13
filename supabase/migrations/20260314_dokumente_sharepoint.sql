-- SharePoint Integration: 2 neue Spalten fuer Dokumente
ALTER TABLE dokumente
  ADD COLUMN IF NOT EXISTS sharepoint_item_id TEXT,
  ADD COLUMN IF NOT EXISTS sharepoint_web_url  TEXT;

CREATE INDEX IF NOT EXISTS idx_dok_sp_item ON dokumente(sharepoint_item_id)
  WHERE sharepoint_item_id IS NOT NULL;

COMMENT ON COLUMN dokumente.sharepoint_item_id IS 'Microsoft Graph DriveItem ID in SharePoint';
COMMENT ON COLUMN dokumente.sharepoint_web_url  IS 'Direktlink zur Datei in SharePoint';
