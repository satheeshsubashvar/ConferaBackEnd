-- Add Social Media Center under Event Marketing without disturbing existing navigation.
DO $$
DECLARE marketing_parent uuid;
BEGIN
  SELECT "AdminNavItemId" INTO marketing_parent FROM "AdminNavItems" WHERE "Key"='event-marketing' LIMIT 1;
  IF marketing_parent IS NOT NULL THEN
    INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder")
    VALUES (marketing_parent,'social-media-center','Social Media Center',13)
    ON CONFLICT ("Key") DO UPDATE
      SET "ParentId"=EXCLUDED."ParentId", "Label"=EXCLUDED."Label", "SortOrder"=EXCLUDED."SortOrder";
  END IF;
END $$;
