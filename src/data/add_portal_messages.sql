CREATE TABLE IF NOT EXISTS "PortalMessageThreads" (
  "ThreadId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "EventId" uuid NOT NULL REFERENCES "Event"("EventId") ON DELETE CASCADE,
  "Subject" character varying(300),
  "CreatedAt" timestamp without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  "UpdatedAt" timestamp without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  "IsDeleted" boolean NOT NULL DEFAULT false,
  "DeletedAt" timestamp without time zone,
  "DeletedBy" uuid
);

CREATE TABLE IF NOT EXISTS "PortalMessageParticipants" (
  "ThreadParticipantId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ThreadId" uuid NOT NULL REFERENCES "PortalMessageThreads"("ThreadId") ON DELETE CASCADE,
  "PersonId" uuid NOT NULL REFERENCES "Person"("PersonId") ON DELETE CASCADE,
  "LastReadAt" timestamp without time zone,
  "CreatedAt" timestamp without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  UNIQUE ("ThreadId", "PersonId")
);

CREATE TABLE IF NOT EXISTS "PortalMessages" (
  "MessageId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ThreadId" uuid NOT NULL REFERENCES "PortalMessageThreads"("ThreadId") ON DELETE CASCADE,
  "SenderPersonId" uuid NOT NULL REFERENCES "Person"("PersonId") ON DELETE CASCADE,
  "Body" text NOT NULL,
  "CreatedAt" timestamp without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  "IsDeleted" boolean NOT NULL DEFAULT false,
  "DeletedAt" timestamp without time zone,
  "DeletedBy" uuid
);

CREATE INDEX IF NOT EXISTS "IX_PortalMessageThreads_EventId_UpdatedAt"
  ON "PortalMessageThreads" ("EventId", "UpdatedAt" DESC);
CREATE INDEX IF NOT EXISTS "IX_PortalMessageParticipants_PersonId"
  ON "PortalMessageParticipants" ("PersonId");
CREATE INDEX IF NOT EXISTS "IX_PortalMessages_ThreadId_CreatedAt"
  ON "PortalMessages" ("ThreadId", "CreatedAt" DESC);

-- Seed database-backed demo threads only when the event has no portal
-- message threads. This is database seed data, not frontend hardcoding.
DO $$
DECLARE
  v_event uuid;
  v_attendee uuid;
  v_organizer uuid;
  v_thread uuid;
BEGIN
  SELECT "EventId" INTO v_event FROM "Event" WHERE "IsDeleted" = false ORDER BY "CreatedAt" LIMIT 1;
  SELECT p."PersonId" INTO v_attendee
    FROM "Person" p
    JOIN "EventParticipant" ep ON ep."PersonId" = p."PersonId"
   WHERE ep."EventId" = v_event AND ep."Role" = 'Attendee' AND ep."IsDeleted" = false
   ORDER BY p."CreatedAt" LIMIT 1;
  SELECT "OwnerId" INTO v_organizer FROM "Event" WHERE "EventId" = v_event;

  IF v_event IS NOT NULL AND v_attendee IS NOT NULL AND v_organizer IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "PortalMessageThreads" WHERE "EventId" = v_event AND "IsDeleted" = false) THEN

    INSERT INTO "PortalMessageThreads" ("EventId", "Subject")
      VALUES (v_event, 'Event registration and ticketing') RETURNING "ThreadId" INTO v_thread;
    INSERT INTO "PortalMessageParticipants" ("ThreadId", "PersonId") VALUES (v_thread, v_attendee), (v_thread, v_organizer);
    INSERT INTO "PortalMessages" ("ThreadId", "SenderPersonId", "Body")
      VALUES (v_thread, v_organizer, 'Learn how to streamline registration and save fees at our Event Registration and Ticketing Workshop.');

    INSERT INTO "PortalMessageThreads" ("EventId", "Subject")
      VALUES (v_event, 'Final reminder') RETURNING "ThreadId" INTO v_thread;
    INSERT INTO "PortalMessageParticipants" ("ThreadId", "PersonId") VALUES (v_thread, v_attendee), (v_thread, v_organizer);
    INSERT INTO "PortalMessages" ("ThreadId", "SenderPersonId", "Body")
      VALUES (v_thread, v_organizer, 'Dear Satheesh, I''m glad I reached you in time! This is our final reminder.');

    INSERT INTO "PortalMessageThreads" ("EventId", "Subject")
      VALUES (v_event, 'Sponsor opportunities') RETURNING "ThreadId" INTO v_thread;
    INSERT INTO "PortalMessageParticipants" ("ThreadId", "PersonId") VALUES (v_thread, v_attendee), (v_thread, v_organizer);
    INSERT INTO "PortalMessages" ("ThreadId", "SenderPersonId", "Body")
      VALUES (v_thread, v_organizer, 'We are currently offering a discount on the sponsors and would be happy to share the details.');

    INSERT INTO "PortalMessageThreads" ("EventId", "Subject")
      VALUES (v_event, 'Welcome to HRM Summit India') RETURNING "ThreadId" INTO v_thread;
    INSERT INTO "PortalMessageParticipants" ("ThreadId", "PersonId") VALUES (v_thread, v_attendee), (v_thread, v_organizer);
    INSERT INTO "PortalMessages" ("ThreadId", "SenderPersonId", "Body")
      VALUES (v_thread, v_organizer, 'Hi Satheesh, welcome to HRM Summit India! Do you want to participate in the community?');
  END IF;
END $$;
