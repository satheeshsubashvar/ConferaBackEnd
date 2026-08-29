-- =====================================================================
-- Adds the fields Exhibitor Manager's real form needs but the base
-- ExhibitorProfile table doesn't have: Slogan, Address, and a full
-- Secondary Contact (email/name/phone) — the real table already had
-- a single "primary" contact set (ContactEmail/ContactName/
-- ContactPhone), which the reference form calls "Primary Contact".
--
-- Also adds:
-- 1. ExhibitorCategories — a real join table, since the reference
--    form's "Sponsor Level" field (despite the odd label) is really
--    a multi-value category list per exhibitor ("Add Category"
--    button, repeatable), not a single field.
-- 2. EventDocuments.ExhibitorProfileId — same nullable-FK-with-
--    SET-NULL pattern already used for SessionId, letting a document
--    ("Handouts") attach to a specific exhibitor while remaining a
--    normal event-wide document when unset.
-- =====================================================================

ALTER TABLE "ExhibitorProfile"
  ADD COLUMN IF NOT EXISTS "Slogan" character varying(300),
  ADD COLUMN IF NOT EXISTS "Address" character varying(500),
  ADD COLUMN IF NOT EXISTS "SecondaryContactEmail" character varying(256),
  ADD COLUMN IF NOT EXISTS "SecondaryContactName" character varying(200),
  ADD COLUMN IF NOT EXISTS "SecondaryContactPhone" character varying(30);

CREATE TABLE IF NOT EXISTS "ExhibitorCategories" (
    "ExhibitorCategoryId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "ExhibitorProfileId" uuid NOT NULL REFERENCES "ExhibitorProfile"("ExhibitorProfileId") ON DELETE CASCADE,
    "Name" character varying(200) NOT NULL,
    "SortOrder" integer NOT NULL DEFAULT 0,
    "CreatedAt" timestamp without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS "IX_ExhibitorCategories_ExhibitorProfileId" ON "ExhibitorCategories" ("ExhibitorProfileId");

ALTER TABLE "EventDocuments"
  ADD COLUMN IF NOT EXISTS "ExhibitorProfileId" uuid REFERENCES "ExhibitorProfile"("ExhibitorProfileId") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "IX_EventDocuments_ExhibitorProfileId" ON "EventDocuments" ("ExhibitorProfileId");
