-- =====================================================================
-- Video Hosting: tracks videos uploaded per event (via the existing
-- /api/uploads/video endpoint) so a real storage quota can be shown
-- and enforced, matching the "3.00 GB available / X.XX GB used"
-- reference UI. Distinct from SponsorProfile.VideoUrl / Session
-- recordings — this is the event's general video library.
-- =====================================================================

CREATE TABLE IF NOT EXISTS "EventVideos" (
    "EventVideoId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "EventId" uuid NOT NULL REFERENCES "Event"("EventId") ON DELETE CASCADE,
    "Title" character varying(300) NOT NULL,
    "FileUrl" character varying(1000) NOT NULL,
    "FileSizeKB" integer NOT NULL,
    "UploadedByPersonId" uuid NOT NULL REFERENCES "Person"("PersonId"),
    "ViewCount" integer NOT NULL DEFAULT 0,
    "CreatedAt" timestamp without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS "IX_EventVideos_EventId" ON "EventVideos" ("EventId");

-- Per-event storage quota, in KB, so the limit itself is
-- configurable rather than hardcoded — defaults to 3 GB, matching
-- the reference screenshot ("3.00 GB available").
ALTER TABLE "Event"
  ADD COLUMN IF NOT EXISTS "VideoStorageQuotaKB" integer NOT NULL DEFAULT 3145728;

-- =====================================================================
-- Attendee Video Access: which ticket tiers can view the event's
-- video recordings/hosted videos. Anchored on the real TicketTypes
-- table (migration-era schema, not yet exposed in any Confera Admin
-- UI) rather than inventing a new tier concept — "Tier 1/2/3" in the
-- reference screenshot are literally ticket types.
-- =====================================================================

CREATE TABLE IF NOT EXISTS "TicketTypeVideoAccess" (
    "TicketTypeId" uuid PRIMARY KEY REFERENCES "TicketTypes"("TicketTypeId") ON DELETE CASCADE,
    "HasVideoAccess" boolean NOT NULL DEFAULT false,
    "UpdatedAt" timestamp without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

-- Event-level toggle for whether the Attendee Video Access add-on is
-- enabled at all (matches the reference's "Enable" / "Enable Add-on"
-- buttons — the feature starts off, same as a real paid add-on would).
ALTER TABLE "Event"
  ADD COLUMN IF NOT EXISTS "AttendeeVideoAccessEnabled" boolean NOT NULL DEFAULT false;
