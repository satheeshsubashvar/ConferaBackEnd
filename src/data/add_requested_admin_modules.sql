-- Additional EMS Admin modules requested for the current Confera build.
-- Existing parent rows are retained; children are inserted idempotently.
DO $$
DECLARE speaker_parent uuid; speaker_group uuid; exhibitor_parent uuid; sponsor_parent uuid; marketing_parent uuid; video_parent uuid;
BEGIN
  SELECT "AdminNavItemId" INTO speaker_parent FROM "AdminNavItems" WHERE "Key"='speaker-center' LIMIT 1;
  SELECT "AdminNavItemId" INTO speaker_group FROM "AdminNavItems" WHERE "Key"='speaker-center-group' LIMIT 1;
  SELECT "AdminNavItemId" INTO exhibitor_parent FROM "AdminNavItems" WHERE "Key"='exhibitor-center' LIMIT 1;
  SELECT "AdminNavItemId" INTO sponsor_parent FROM "AdminNavItems" WHERE "Key"='sponsor-center' LIMIT 1;
  SELECT "AdminNavItemId" INTO marketing_parent FROM "AdminNavItems" WHERE "Key"='event-marketing' LIMIT 1;
  SELECT "AdminNavItemId" INTO video_parent FROM "AdminNavItems" WHERE "Key"='settings-video-conferencing' LIMIT 1;

  IF speaker_group IS NOT NULL THEN
    speaker_parent := speaker_group;
  END IF;

  IF speaker_parent IS NOT NULL THEN
    INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
      (speaker_parent,'message-speakers','Message Speakers',1),
      (speaker_parent,'speaker-1-1-meetings','Speaker 1-1 Meetings',2)
    ON CONFLICT ("Key") DO UPDATE SET "ParentId"=EXCLUDED."ParentId", "Label"=EXCLUDED."Label", "SortOrder"=EXCLUDED."SortOrder";
  END IF;

  IF exhibitor_parent IS NOT NULL THEN
    INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
      (exhibitor_parent,'message-exhibitors','Message Exhibitors',20),
      (exhibitor_parent,'passport-contest','Passport Contest',21),
      (exhibitor_parent,'exhibitor-outreach-campaigns','Exhibitor Outreach Campaigns',22),
      (exhibitor_parent,'compliance-documents','Compliance Documents',23),
      (exhibitor_parent,'exhibitor-1-1-meetings','Exhibitor 1-1 Meetings',24),
      (exhibitor_parent,'exhibitor-trivia','Exhibitor Trivia',25)
    ON CONFLICT ("Key") DO UPDATE SET "ParentId"=EXCLUDED."ParentId", "Label"=EXCLUDED."Label", "SortOrder"=EXCLUDED."SortOrder";
  END IF;

  IF sponsor_parent IS NOT NULL THEN
    INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
      (sponsor_parent,'sponsor-tiering','Sponsor Tiering',20),
      (sponsor_parent,'message-sponsors','Message Sponsors',21),
      (sponsor_parent,'sponsor-outreach-campaigns','Sponsor Outreach Campaigns',22),
      (sponsor_parent,'sponsor-1-1-meetings','Sponsor 1-1 Meetings',23)
    ON CONFLICT ("Key") DO UPDATE SET "ParentId"=EXCLUDED."ParentId", "Label"=EXCLUDED."Label", "SortOrder"=EXCLUDED."SortOrder";
  END IF;

  IF video_parent IS NOT NULL THEN
    INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
      (video_parent,'settings-custom-video-call','Custom Video Call API',2)
    ON CONFLICT ("Key") DO UPDATE SET "ParentId"=EXCLUDED."ParentId", "Label"=EXCLUDED."Label", "SortOrder"=EXCLUDED."SortOrder";
  END IF;

  IF marketing_parent IS NOT NULL THEN
    UPDATE "AdminNavItems" SET "Label"='Venue Map Webpages' WHERE "Key"='venue-map-webpage';
  END IF;
END $$;
