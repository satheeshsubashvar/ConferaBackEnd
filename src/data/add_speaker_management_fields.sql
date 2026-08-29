-- Speaker Center additions
-- Run this once against the Confera database before using the new
-- speaker form fields. Existing data remains unchanged.
ALTER TABLE "SpeakerProfile"
  ADD COLUMN IF NOT EXISTS "SpeakerInformationFormLink" varchar(1000),
  ADD COLUMN IF NOT EXISTS "LinkedInUrl" varchar(500),
  ADD COLUMN IF NOT EXISTS "TwitterUrl" varchar(500),
  ADD COLUMN IF NOT EXISTS "InstagramUrl" varchar(500),
  ADD COLUMN IF NOT EXISTS "FacebookUrl" varchar(500);

CREATE INDEX IF NOT EXISTS "IX_SpeakerProfile_EventParticipantId"
  ON "SpeakerProfile" ("EventParticipantId");
