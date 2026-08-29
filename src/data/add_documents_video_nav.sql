-- =====================================================================
-- Adds Documents, Video Hosting, and Attendee Video Access as sidebar
-- items under Branding Center. Safe to re-run: checks whether
-- 'documents' already exists first.
-- =====================================================================

DO $$
DECLARE
  branding_center_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM "AdminNavItems" WHERE "Key" = 'documents') THEN
    RAISE NOTICE 'Documents/Video Hosting/Attendee Video Access already present — nothing to do.';
    RETURN;
  END IF;

  SELECT "AdminNavItemId" INTO branding_center_id FROM "AdminNavItems" WHERE "Key" = 'branding-center';
  IF branding_center_id IS NULL THEN
    RAISE NOTICE 'branding-center section not found — run the nesting migration first.';
    RETURN;
  END IF;

  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (branding_center_id, 'documents', 'Documents', 4),
    (branding_center_id, 'video-hosting', 'Video Hosting', 5),
    (branding_center_id, 'attendee-video-access', 'Attendee Video Access', 6);

  RAISE NOTICE 'Documents/Video Hosting/Attendee Video Access added under Branding Center.';
END $$;
