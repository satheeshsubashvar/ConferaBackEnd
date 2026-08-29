-- =====================================================================
-- Adds Categories, a genuinely new concept confirmed against the
-- reference EMS Admin app: a flat, per-event list of category names
-- (list/add/edit/delete only — no color, no description, no icon,
-- matching the reference's single-field "Category Name" form exactly).
-- Distinct from Tracks (which the reference keeps as a separate,
-- richer feature) and distinct from the "Select Category" dropdown
-- used for speaker roles inside Session Manager, which is an
-- unrelated concept that happens to share the word "Category".
-- =====================================================================

CREATE TABLE IF NOT EXISTS "Categories" (
    "CategoryId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "EventId" uuid NOT NULL REFERENCES "Event"("EventId") ON DELETE CASCADE,
    "Name" character varying(200) NOT NULL,
    "SortOrder" integer NOT NULL DEFAULT 0,
    "CreatedAt" timestamp without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS "IX_Categories_EventId" ON "Categories" ("EventId");

-- Sessions.CategoryId, added the same way TrackId already exists —
-- optional, no CASCADE (matches how TrackId behaves: deleting a
-- Category in use should be blocked, not silently orphan sessions).
ALTER TABLE "Sessions"
  ADD COLUMN IF NOT EXISTS "CategoryId" uuid REFERENCES "Categories"("CategoryId");

CREATE INDEX IF NOT EXISTS "IX_Sessions_CategoryId" ON "Sessions" ("CategoryId");
