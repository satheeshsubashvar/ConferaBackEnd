-- Discussion Topics can now optionally belong to a single session (posted
-- from a session's Community tab) rather than only ever being event-wide
-- (posted from the standalone Community Board). NULL = event-wide topic,
-- matching the existing Community Board behavior.
ALTER TABLE "DiscussionTopics"
  ADD COLUMN IF NOT EXISTS "SessionId" uuid REFERENCES "Sessions"("SessionId") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "IX_DiscussionTopics_SessionId" ON "DiscussionTopics" ("SessionId");
