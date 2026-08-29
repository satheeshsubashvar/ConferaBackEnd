CREATE TABLE IF NOT EXISTS "EventAdminSettings" (
  "EventId" uuid PRIMARY KEY REFERENCES "Event"("EventId") ON DELETE CASCADE,
  "SettingsJson" text NOT NULL DEFAULT '{}',
  "CreatedAt" timestamp without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  "UpdatedAt" timestamp without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
