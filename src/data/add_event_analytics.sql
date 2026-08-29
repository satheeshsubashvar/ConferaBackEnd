-- Real-time public event analytics. Idempotent and safe to re-run.
CREATE TABLE IF NOT EXISTS "EventAnalyticsEvents" (
  "AnalyticsEventId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "EventId" uuid NOT NULL REFERENCES "Event"("EventId") ON DELETE CASCADE,
  "EventType" varchar(40) NOT NULL DEFAULT 'page_view',
  "PageKey" varchar(100),
  "SessionId" uuid,
  "SpeakerId" uuid,
  "VisitorId" varchar(120),
  "Path" varchar(500),
  "Referrer" varchar(1000),
  "UserAgent" varchar(1000),
  "DeviceType" varchar(30),
  "Country" varchar(120),
  "City" varchar(120),
  "CreatedAt" timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS "IX_EventAnalyticsEvents_Event_Created" ON "EventAnalyticsEvents" ("EventId", "CreatedAt");
CREATE INDEX IF NOT EXISTS "IX_EventAnalyticsEvents_Event_Type" ON "EventAnalyticsEvents" ("EventId", "EventType");
CREATE INDEX IF NOT EXISTS "IX_EventAnalyticsEvents_Session" ON "EventAnalyticsEvents" ("SessionId");
