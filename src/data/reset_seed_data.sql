-- =====================================================================
-- Resets Confera Admin/Portal's seeded application data so the
-- backend's seed.js can run cleanly on next boot. Does NOT touch the
-- schema (tables/columns) — only removes rows this app's seed script
-- created, scoped precisely to the demo event and demo Person emails.
-- Safe to run multiple times.
--
-- Matches by Slug (the actual unique constraint that collides on
-- reseed) with EventCode as a fallback, in case an earlier partial
-- seed attempt left a row with a different EventCode but the same
-- Slug, or vice versa. Every dependent DELETE is scoped to that
-- specific EventId — earlier versions of this script deleted
-- PortalNavItems/AdminNavItems/AppBrandings/SponsorProfile/
-- EventParticipant unconditionally, which would also wipe any other,
-- unrelated event's data in the same database. Fixed here.
-- =====================================================================

DO $$
DECLARE
  demo_event_id uuid;
BEGIN
  SELECT "EventId" INTO demo_event_id
  FROM "Event"
  WHERE "Slug" = 'hrm-summit-india-2026' OR "EventCode" = 'HR2026'
  LIMIT 1;

  IF demo_event_id IS NOT NULL THEN
    DELETE FROM "PortalNavItems" WHERE "EventId" = demo_event_id;
    DELETE FROM "AppBrandings" WHERE "EventId" = demo_event_id;
    DELETE FROM "SponsorProfile" WHERE "EventParticipantId" IN (
      SELECT "EventParticipantId" FROM "EventParticipant" WHERE "EventId" = demo_event_id
    );
    DELETE FROM "SpeakerProfile" WHERE "EventParticipantId" IN (
      SELECT "EventParticipantId" FROM "EventParticipant" WHERE "EventId" = demo_event_id
    );
    DELETE FROM "EventParticipant" WHERE "EventId" = demo_event_id;
    DELETE FROM "Event" WHERE "EventId" = demo_event_id;
  END IF;
END $$;

-- AdminNavItems has no EventId (it's global to the whole Admin app,
-- not per-event) — safe to clear unconditionally, since it only ever
-- holds this app's fixed sidebar structure.
DELETE FROM "AdminNavItems";

DELETE FROM "OrganizationUsers" WHERE "OrganizationId" IN (
  SELECT "OrganizationId" FROM "Organizations" WHERE "Slug" = 'confera-demo'
);
DELETE FROM "Organizations" WHERE "Slug" = 'confera-demo';

DELETE FROM "Person" WHERE "Email" IN (
  'satheesh@confera.io',
  'attendee@confera.io',
  'sponsor-microsoft@confera.io',
  'sponsor-google@confera.io',
  'sponsor-atlas@confera.io',
  'sponsor-forgelabs@confera.io',
  'sponsor-veridian@confera.io'
);
