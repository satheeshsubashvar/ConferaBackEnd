-- Normalize legacy/duplicate EMS sidebar rows without removing working pages.
-- Keeps Speaker Manager under Speaker Center and exposes exactly one
-- canonical 1-1 meeting item for each center.
DO $$
DECLARE
  speaker_group uuid;
  exhibitor_group uuid;
  sponsor_group uuid;
  keep_id uuid;
BEGIN
  SELECT "AdminNavItemId" INTO speaker_group FROM "AdminNavItems" WHERE "Key"='speaker-center-group' LIMIT 1;
  SELECT "AdminNavItemId" INTO exhibitor_group FROM "AdminNavItems" WHERE "Key"='exhibitor-center-group' LIMIT 1;
  SELECT "AdminNavItemId" INTO sponsor_group FROM "AdminNavItems" WHERE "Key"='sponsor-center-group' LIMIT 1;

  -- Speaker Manager must be a leaf. Move its two companion pages to the
  -- Speaker Center group so the sidebar is exactly:
  -- Speaker Center -> Speaker Manager, Message Speakers, Speaker 1-1 Meetings.
  IF speaker_group IS NOT NULL THEN
    UPDATE "AdminNavItems" SET "ParentId"=speaker_group, "Label"='Speaker Manager', "SortOrder"=0
      WHERE "Key"='speaker-center';
    UPDATE "AdminNavItems" SET "ParentId"=speaker_group, "SortOrder"=1
      WHERE "Key"='message-speakers';
    UPDATE "AdminNavItems" SET "ParentId"=speaker_group, "SortOrder"=2
      WHERE "Key"='speaker-1-1-meetings';
    DELETE FROM "AdminNavItems" WHERE "Key"='speaker-1on1-meetings';
  END IF;

  -- Speaker 1-1: remove legacy key(s), then ensure canonical route key exists.
  IF speaker_group IS NOT NULL THEN
    DELETE FROM "AdminNavItems" WHERE "Key"='speaker-1on1-meetings';
    SELECT "AdminNavItemId" INTO keep_id FROM "AdminNavItems" WHERE "Key"='speaker-1-1-meetings' ORDER BY "SortOrder", "AdminNavItemId" LIMIT 1;
    IF keep_id IS NULL THEN
      INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES (speaker_group,'speaker-1-1-meetings','Speaker 1-1 Meetings',2);
    ELSE
      UPDATE "AdminNavItems" SET "ParentId"=speaker_group,"Label"='Speaker 1-1 Meetings',"SortOrder"=2 WHERE "AdminNavItemId"=keep_id;
      DELETE FROM "AdminNavItems" WHERE "Key"='speaker-1-1-meetings' AND "AdminNavItemId"<>keep_id;
    END IF;
  END IF;

  -- Exhibitor 1-1: normalize the legacy "1on1" spelling to the frontend route key.
  IF exhibitor_group IS NOT NULL THEN
    DELETE FROM "AdminNavItems" WHERE "Key"='exhibitor-1on1-meetings';
    SELECT "AdminNavItemId" INTO keep_id FROM "AdminNavItems" WHERE "Key"='exhibitor-1-1-meetings' ORDER BY "SortOrder", "AdminNavItemId" LIMIT 1;
    IF keep_id IS NULL THEN
      INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES (exhibitor_group,'exhibitor-1-1-meetings','Exhibitor 1-1 Meetings',5);
    ELSE
      UPDATE "AdminNavItems" SET "ParentId"=exhibitor_group,"Label"='Exhibitor 1-1 Meetings',"SortOrder"=5 WHERE "AdminNavItemId"=keep_id;
      DELETE FROM "AdminNavItems" WHERE "Key"='exhibitor-1-1-meetings' AND "AdminNavItemId"<>keep_id;
    END IF;
  END IF;

  -- Sponsor 1-1: normalize the legacy "1on1" spelling to the frontend route key.
  IF sponsor_group IS NOT NULL THEN
    DELETE FROM "AdminNavItems" WHERE "Key"='sponsor-1on1-meetings';
    SELECT "AdminNavItemId" INTO keep_id FROM "AdminNavItems" WHERE "Key"='sponsor-1-1-meetings' ORDER BY "SortOrder", "AdminNavItemId" LIMIT 1;
    IF keep_id IS NULL THEN
      INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES (sponsor_group,'sponsor-1-1-meetings','Sponsor 1-1 Meetings',5);
    ELSE
      UPDATE "AdminNavItems" SET "ParentId"=sponsor_group,"Label"='Sponsor 1-1 Meetings',"SortOrder"=5 WHERE "AdminNavItemId"=keep_id;
      DELETE FROM "AdminNavItems" WHERE "Key"='sponsor-1-1-meetings' AND "AdminNavItemId"<>keep_id;
    END IF;
  END IF;
END $$;
