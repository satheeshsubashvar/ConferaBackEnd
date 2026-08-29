-- =====================================================================
-- Adds three genuinely new tables for Session Manager features that
-- have no equivalent anywhere in the real schema:
--
-- 1. SessionSponsors: links a SponsorProfile to a Session (sponsor
--    exposure per session, as in the reference "Session Sponsors").
-- 2. SessionTags / SessionTagAssignments: reusable per-event tag
--    catalog (e.g. "Live session", "Pre-recorded") + a join table,
--    same pattern as LeadTags (migration 004) — up to 4 per session,
--    enforced at the application layer since a CHECK on a many-to-
--    many count isn't practical in plain SQL.
-- 3. SessionAuthors: academic-paper-style authors who aren't
--    necessarily EventParticipants (unlike Speakers) — plain name/
--    affiliation/email fields, not a Person reference, matching the
--    reference's description that authors aren't added to the
--    attendee or speaker list.
-- =====================================================================

CREATE TABLE IF NOT EXISTS "SessionSponsors" (
    "SessionSponsorId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "SessionId" uuid NOT NULL REFERENCES "Sessions"("SessionId") ON DELETE CASCADE,
    "SponsorProfileId" uuid NOT NULL REFERENCES "SponsorProfile"("SponsorProfileId") ON DELETE CASCADE,
    "SortOrder" integer NOT NULL DEFAULT 0,
    "CreatedAt" timestamp without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    UNIQUE ("SessionId", "SponsorProfileId")
);

CREATE INDEX IF NOT EXISTS "IX_SessionSponsors_SessionId" ON "SessionSponsors" ("SessionId");
CREATE INDEX IF NOT EXISTS "IX_SessionSponsors_SponsorProfileId" ON "SessionSponsors" ("SponsorProfileId");

CREATE TABLE IF NOT EXISTS "SessionTags" (
    "SessionTagId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "EventId" uuid NOT NULL REFERENCES "Event"("EventId") ON DELETE CASCADE,
    "Name" character varying(100) NOT NULL,
    "Color" character varying(20),
    "IsSystemTag" boolean NOT NULL DEFAULT false,
    "CreatedAt" timestamp without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    UNIQUE ("EventId", "Name")
);

CREATE INDEX IF NOT EXISTS "IX_SessionTags_EventId" ON "SessionTags" ("EventId");

CREATE TABLE IF NOT EXISTS "SessionTagAssignments" (
    "SessionId" uuid NOT NULL REFERENCES "Sessions"("SessionId") ON DELETE CASCADE,
    "SessionTagId" uuid NOT NULL REFERENCES "SessionTags"("SessionTagId") ON DELETE CASCADE,
    PRIMARY KEY ("SessionId", "SessionTagId")
);

CREATE TABLE IF NOT EXISTS "SessionAuthors" (
    "SessionAuthorId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "SessionId" uuid NOT NULL REFERENCES "Sessions"("SessionId") ON DELETE CASCADE,
    "FirstName" character varying(150) NOT NULL,
    "LastName" character varying(150) NOT NULL,
    "Email" character varying(256),
    "Affiliation" character varying(300),
    "SortOrder" integer NOT NULL DEFAULT 0,
    "CreatedAt" timestamp without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS "IX_SessionAuthors_SessionId" ON "SessionAuthors" ("SessionId");

-- Session Feedback toggle and session document attachment both need
-- a small addition to existing tables rather than new ones:
ALTER TABLE "Sessions"
  ADD COLUMN IF NOT EXISTS "FeedbackEnabled" boolean NOT NULL DEFAULT false;

-- EventDocuments is event-scoped (no SessionId) in the real schema —
-- adding an optional SessionId lets a document attach to a specific
-- session while still supporting event-wide documents (SessionId NULL).
ALTER TABLE "EventDocuments"
  ADD COLUMN IF NOT EXISTS "SessionId" uuid REFERENCES "Sessions"("SessionId") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "IX_EventDocuments_SessionId" ON "EventDocuments" ("SessionId");

-- Seed a few common system tags per event, matching the reference's
-- examples. Only inserted for events that don't already have tags.
INSERT INTO "SessionTags" ("EventId", "Name", "Color", "IsSystemTag")
SELECT e."EventId", v.name, v.color, true
FROM "Event" e
CROSS JOIN (VALUES
  ('Live session', '#10b981'),
  ('Pre-recorded session', '#6366f1'),
  ('Interactive', '#f59e0b'),
  ('Beginner friendly', '#0ea5e9')
) AS v(name, color)
WHERE NOT EXISTS (
  SELECT 1 FROM "SessionTags" st WHERE st."EventId" = e."EventId"
);
