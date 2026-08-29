-- Generic persistence for EMS/Admin modules that do not yet have a dedicated domain table.
CREATE TABLE IF NOT EXISTS "EmsModuleRecords" (
  "EmsModuleRecordId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "EventId" uuid NOT NULL REFERENCES "Event"("EventId") ON DELETE CASCADE,
  "ModuleKey" text NOT NULL,
  "Data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "CreatedAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "UpdatedAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "IsDeleted" boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS "IX_EmsModuleRecords_Event_Module"
  ON "EmsModuleRecords" ("EventId", "ModuleKey")
  WHERE "IsDeleted" = false;

CREATE INDEX IF NOT EXISTS "IX_EmsModuleRecords_UpdatedAt"
  ON "EmsModuleRecords" ("UpdatedAt" DESC);
