-- =====================================================================
-- Applies the Dashboard/sidebar "quick fixes" round:
--   - Renames "Event Basics" -> "Basics" (Key: home)
--   - Renames "Branding Center" -> "App Branding" (Key: app-branding)
--   - Moves Customize Resources, Branded Event URL, and Web App
--     Speaker Page to sit as siblings under Event Content, directly
--     after App Branding (rather than under Engage & Network /
--     Event Marketing where they lived before)
--   - Adds a new "Session Q&A Manager" stub under Event Content,
--     grouped with Session/Track/Category Manager
--   - Re-sequences SortOrder for the rest of Event Content's children
--     to make room
--
-- Safe to re-run: checks whether 'session-qa-manager' already exists
-- (the one genuinely new row this migration adds) before doing
-- anything, since every other change here is idempotent by itself
-- but there's no cheap single flag for "has this whole batch run".
-- =====================================================================

DO $$
DECLARE
  event_content_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM "AdminNavItems" WHERE "Key" = 'session-qa-manager') THEN
    RAISE NOTICE 'Dashboard/sidebar quick-fixes batch already applied — nothing to do.';
    RETURN;
  END IF;

  SELECT "AdminNavItemId" INTO event_content_id FROM "AdminNavItems" WHERE "Key" = 'event-content';
  IF event_content_id IS NULL THEN
    RAISE NOTICE 'event-content section not found — run the taxonomy replacement migration first.';
    RETURN;
  END IF;

  -- Renames
  UPDATE "AdminNavItems" SET "Label" = 'Basics' WHERE "Key" = 'home';
  UPDATE "AdminNavItems" SET "Label" = 'App Branding' WHERE "Key" = 'app-branding';

  -- Move the three items under Event Content, right after App Branding
  UPDATE "AdminNavItems" SET "ParentId" = event_content_id, "SortOrder" = 2 WHERE "Key" = 'customize-resources';
  UPDATE "AdminNavItems" SET "ParentId" = event_content_id, "SortOrder" = 3 WHERE "Key" = 'branded-url';
  UPDATE "AdminNavItems" SET "ParentId" = event_content_id, "SortOrder" = 4 WHERE "Key" = 'web-speaker-page';

  -- Shift the remaining Event Content children down to make room
  UPDATE "AdminNavItems" SET "SortOrder" = 5 WHERE "Key" = 'session-manager';
  UPDATE "AdminNavItems" SET "SortOrder" = 6 WHERE "Key" = 'track-manager';
  UPDATE "AdminNavItems" SET "SortOrder" = 7 WHERE "Key" = 'category-manager';
  UPDATE "AdminNavItems" SET "SortOrder" = 9 WHERE "Key" = 'speaker-center';
  UPDATE "AdminNavItems" SET "SortOrder" = 10 WHERE "Key" = 'sponsor-center';
  UPDATE "AdminNavItems" SET "SortOrder" = 11 WHERE "Key" = 'exhibitor-center';

  -- New stub, grouped with the other Agenda-related items
  INSERT INTO "AdminNavItems" ("ParentId", "Key", "Label", "SortOrder")
  VALUES (event_content_id, 'session-qa-manager', 'Session Q&A Manager', 8);

  RAISE NOTICE 'Dashboard/sidebar quick-fixes batch applied.';
END $$;
