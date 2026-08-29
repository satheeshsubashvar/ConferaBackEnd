-- Portal realtime features: session chat, organizer feedback, and Confera guides.
CREATE TABLE IF NOT EXISTS "SessionChatMessages" (
  "MessageId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "EventId" uuid NOT NULL REFERENCES "Event"("EventId") ON DELETE CASCADE,
  "SessionId" uuid NOT NULL REFERENCES "Sessions"("SessionId") ON DELETE CASCADE,
  "SenderPersonId" uuid NOT NULL REFERENCES "Person"("PersonId") ON DELETE CASCADE,
  "Body" text NOT NULL,
  "CreatedAt" timestamp without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  "IsDeleted" boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS "IX_SessionChatMessages_Session" ON "SessionChatMessages" ("EventId","SessionId","CreatedAt");

CREATE TABLE IF NOT EXISTS "PortalFeedback" (
  "FeedbackId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "EventId" uuid NOT NULL REFERENCES "Event"("EventId") ON DELETE CASCADE,
  "PersonId" uuid REFERENCES "Person"("PersonId") ON DELETE SET NULL,
  "Rating" integer,
  "FeedbackText" text NOT NULL,
  "CreatedAt" timestamp without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS "IX_PortalFeedback_Event" ON "PortalFeedback" ("EventId","CreatedAt");

CREATE TABLE IF NOT EXISTS "ConferaGuides" (
  "GuideId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "Title" varchar(250) NOT NULL,
  "Description" text,
  "ImageUrl" varchar(1000),
  "Url" varchar(1000),
  "SortOrder" integer NOT NULL DEFAULT 0,
  "IsPublished" boolean NOT NULL DEFAULT true,
  "CreatedAt" timestamp without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
INSERT INTO "ConferaGuides" ("Title","Description","SortOrder")
SELECT v.title, v.description, v.sort_order
FROM (VALUES
 ('Confera App Attendee Guide','Learn how to use the Confera attendee experience.',0),
 ('Confera Exhibitor Guide','Everything exhibitors need for the event portal.',1),
 ('Confera Sponsor Guide','Tools and features available to event sponsors.',2),
 ('Confera Speaker Guide','Prepare your speaker profile and sessions.',3),
 ('Presenter Guide','Guidance for presenters and session participation.',4),
 ('Confera FAQ','Frequently asked questions about Confera events.',5),
 ('Confera Network Guide','Discover networking and attendee connections.',6),
 ('How to Participate in an Event','Tips for getting the most from an event.',7),
 ('App Tips','Quick tips for a smoother event experience.',8)
) AS v(title,description,sort_order)
WHERE NOT EXISTS (SELECT 1 FROM "ConferaGuides");

CREATE TABLE IF NOT EXISTS "PortalGamificationPoints" (
  "PointId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "EventId" uuid NOT NULL REFERENCES "Event"("EventId") ON DELETE CASCADE,
  "PersonId" uuid NOT NULL REFERENCES "Person"("PersonId") ON DELETE CASCADE,
  "Points" integer NOT NULL DEFAULT 0,
  "UpdatedAt" timestamp without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  UNIQUE ("EventId","PersonId")
);
CREATE INDEX IF NOT EXISTS "IX_PortalGamificationPoints_Event" ON "PortalGamificationPoints" ("EventId","Points" DESC);
