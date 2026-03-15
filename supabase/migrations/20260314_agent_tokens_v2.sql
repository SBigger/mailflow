-- agent_tokens: download_url fuer direkten Download ohne SharePoint API
ALTER TABLE agent_tokens ADD COLUMN IF NOT EXISTS download_url TEXT NOT NULL DEFAULT '';
