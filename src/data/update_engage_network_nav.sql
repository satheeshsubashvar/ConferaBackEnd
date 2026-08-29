-- =====================================================================
-- Align the Engage & Network section with the legacy EMS Admin sidebar.
-- Reference order:
-- Announcement, Meet-ups, Discussion Topics, Social Groups,
-- Gamification, Session Feedback, Surveys, Floormap, Live Polling, Photos.
-- Customize Resources belongs to Branding Center, not Engage & Network.
-- Safe to re-run.
-- =====================================================================

DO $$
DECLARE
  engage_network_id uuid;
  branding_center_id uuid;
BEGIN
  SELECT "AdminNavItemId" INTO engage_network_id
  FROM "AdminNavItems"
  WHERE "Key" = 'engage-network'
  LIMIT 1;

  IF engage_network_id IS NULL THEN
    INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection")
    VALUES ('engage-network','Engage & Network','Users',2,true)
    RETURNING "AdminNavItemId" INTO engage_network_id;
  END IF;

  -- Move Customize Resources back to Branding Center if that group exists.
  SELECT "AdminNavItemId" INTO branding_center_id
  FROM "AdminNavItems"
  WHERE "Key" IN ('branding-center','app-branding')
  ORDER BY CASE WHEN "Key" = 'branding-center' THEN 0 ELSE 1 END
  LIMIT 1;

  IF branding_center_id IS NOT NULL THEN
    UPDATE "AdminNavItems"
    SET "ParentId" = branding_center_id,
        "SortOrder" = 1
    WHERE "Key" = 'customize-resources';
  ELSE
    UPDATE "AdminNavItems"
    SET "ParentId" = NULL,
        "SortOrder" = 999
    WHERE "Key" = 'customize-resources'
      AND "ParentId" = engage_network_id;
  END IF;

  -- Remove the legacy/incorrect child from Engage & Network only.
  UPDATE "AdminNavItems"
  SET "ParentId" = NULL
  WHERE "Key" = 'customize-resources'
    AND "ParentId" = engage_network_id;

  -- Ensure every EMS item exists under the correct section.
  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder")
  VALUES
    (engage_network_id,'announcement','Announcement',0),
    (engage_network_id,'meetups','Meet-ups',1),
    (engage_network_id,'discussion-topics','Discussion Topics',2),
    (engage_network_id,'social-groups','Social Groups',3),
    (engage_network_id,'gamification','Gamification',4),
    (engage_network_id,'session-feedback','Session Feedback',5),
    (engage_network_id,'surveys','Surveys',6),
    (engage_network_id,'floormap','Floormap',7),
    (engage_network_id,'manage-live-poll','Live Polling',8),
    (engage_network_id,'photos','Photos',9)
  ON CONFLICT ("Key") DO UPDATE
    SET "ParentId" = EXCLUDED."ParentId",
        "Label" = EXCLUDED."Label",
        "SortOrder" = EXCLUDED."SortOrder";

  -- Make sure no unexpected children remain in this section.
  DELETE FROM "AdminNavItems"
  WHERE "ParentId" = engage_network_id
    AND "Key" NOT IN (
      'announcement','meetups','discussion-topics','social-groups',
      'gamification','session-feedback','surveys','floormap',
      'manage-live-poll','photos'
    );
END $$;
