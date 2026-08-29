-- Event Webpage configuration shared by Agenda/Speaker/Sponsor/Exhibitor Webpage modules.
-- Kept as JSON so new page options can be added without another schema change.
ALTER TABLE "WebsiteThemes"
  ADD COLUMN IF NOT EXISTS "WebPageSettingsJson" text;

CREATE INDEX IF NOT EXISTS "IX_SessionQA_SessionId_Status"
  ON "SessionQA" ("SessionId", "Status");

CREATE INDEX IF NOT EXISTS "IX_SessionQA_CreatedAt"
  ON "SessionQA" ("CreatedAt");
