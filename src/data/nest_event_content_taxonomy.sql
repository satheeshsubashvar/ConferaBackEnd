-- =====================================================================
-- Restructures the sidebar's Event Content section from a flat list
-- of 12 items into real nested sub-groups, matching the reference
-- screenshots: Basics stays a plain top-level link; Branding Center,
-- Agenda Center, Speaker Center, Exhibitor Center, and Sponsor Center
-- each become their own collapsible group with their own children —
-- a genuine 3rd tree level, now supported by the rewritten
-- EventSidebar.jsx (NavItem renders any item with children as its
-- own collapsible sub-group, recursively).
--
-- Also removes "Conflict Check" entirely (page/route/store function
-- were already deleted from the codebase in this same change) and
-- keeps "Category Manager" under Agenda Center even though it's not
-- shown in the reference screenshot, since it's a real, working,
-- tested feature that shouldn't be silently dropped.
--
-- Every key with a real page behind it (home, app-branding,
-- customize-resources, web-speaker-page, branded-url,
-- session-manager, track-manager, category-manager, speaker-center)
-- is preserved exactly — only ParentId/SortOrder/Label change for
-- these, and speaker-center's original key is reused for its new
-- "Speaker Manager" child so the existing page stays reachable.
--
-- Safe to re-run: checks whether 'agenda-center' already exists
-- (the clearest single signal this batch has already run) first.
-- =====================================================================

DO $$
DECLARE
  event_content_id uuid;
  branding_center_id uuid;
  agenda_center_id uuid;
  speaker_center_group_id uuid;
  exhibitor_center_group_id uuid;
  sponsor_center_group_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM "AdminNavItems" WHERE "Key" = 'agenda-center') THEN
    RAISE NOTICE 'Nested Event Content taxonomy already present — nothing to do.';
    RETURN;
  END IF;

  SELECT "AdminNavItemId" INTO event_content_id FROM "AdminNavItems" WHERE "Key" = 'event-content';
  IF event_content_id IS NULL THEN
    RAISE NOTICE 'event-content section not found — run earlier migrations first.';
    RETURN;
  END IF;

  UPDATE "AdminNavItems" SET "SortOrder" = 0 WHERE "Key" = 'home';

  INSERT INTO "AdminNavItems" ("ParentId", "Key", "Label", "SortOrder")
  VALUES (event_content_id, 'branding-center', 'Branding Center', 1)
  RETURNING "AdminNavItemId" INTO branding_center_id;

  UPDATE "AdminNavItems" SET "ParentId" = branding_center_id, "SortOrder" = 0 WHERE "Key" = 'app-branding';
  UPDATE "AdminNavItems" SET "ParentId" = branding_center_id, "SortOrder" = 1 WHERE "Key" = 'customize-resources';
  UPDATE "AdminNavItems" SET "ParentId" = branding_center_id, "SortOrder" = 2 WHERE "Key" = 'web-speaker-page';
  UPDATE "AdminNavItems" SET "ParentId" = branding_center_id, "SortOrder" = 3 WHERE "Key" = 'branded-url';

  INSERT INTO "AdminNavItems" ("ParentId", "Key", "Label", "SortOrder")
  VALUES (event_content_id, 'agenda-center', 'Agenda Center', 2)
  RETURNING "AdminNavItemId" INTO agenda_center_id;

  UPDATE "AdminNavItems" SET "ParentId" = agenda_center_id, "SortOrder" = 0 WHERE "Key" = 'session-manager';
  UPDATE "AdminNavItems" SET "ParentId" = agenda_center_id, "SortOrder" = 1 WHERE "Key" = 'track-manager';
  UPDATE "AdminNavItems" SET "ParentId" = agenda_center_id, "SortOrder" = 2 WHERE "Key" = 'category-manager';
  DELETE FROM "AdminNavItems" WHERE "Key" = 'session-qa-manager';
  INSERT INTO "AdminNavItems" ("ParentId", "Key", "Label", "SortOrder")
  VALUES (agenda_center_id, 'session-qa-manager', 'Session Q&A Manager', 3);

  INSERT INTO "AdminNavItems" ("ParentId", "Key", "Label", "SortOrder")
  VALUES (event_content_id, 'speaker-center-group', 'Speaker Center', 3)
  RETURNING "AdminNavItemId" INTO speaker_center_group_id;

  UPDATE "AdminNavItems"
  SET "ParentId" = speaker_center_group_id, "Label" = 'Speaker Manager', "SortOrder" = 0
  WHERE "Key" = 'speaker-center';

  INSERT INTO "AdminNavItems" ("ParentId", "Key", "Label", "SortOrder") VALUES
    (speaker_center_group_id, 'message-speakers', 'Message Speakers', 1),
    (speaker_center_group_id, 'speaker-1on1-meetings', 'Speaker 1-1 Meetings', 2);

  DELETE FROM "AdminNavItems" WHERE "Key" = 'exhibitor-center';
  INSERT INTO "AdminNavItems" ("ParentId", "Key", "Label", "SortOrder")
  VALUES (event_content_id, 'exhibitor-center-group', 'Exhibitor Center', 4)
  RETURNING "AdminNavItemId" INTO exhibitor_center_group_id;

  INSERT INTO "AdminNavItems" ("ParentId", "Key", "Label", "SortOrder") VALUES
    (exhibitor_center_group_id, 'exhibitor-manager', 'Exhibitor Manager', 0),
    (exhibitor_center_group_id, 'message-exhibitors', 'Message Exhibitors', 1),
    (exhibitor_center_group_id, 'passport-contest', 'Passport Contest', 2),
    (exhibitor_center_group_id, 'exhibitor-outreach-campaigns', 'Outreach Campaigns', 3),
    (exhibitor_center_group_id, 'compliance-documents', 'Compliance Documents', 4),
    (exhibitor_center_group_id, 'exhibitor-1on1-meetings', 'Exhibitor 1-1 Meetings', 5),
    (exhibitor_center_group_id, 'exhibitor-trivia', 'Exhibitor Trivia', 6);

  DELETE FROM "AdminNavItems" WHERE "Key" = 'sponsor-center';
  INSERT INTO "AdminNavItems" ("ParentId", "Key", "Label", "SortOrder")
  VALUES (event_content_id, 'sponsor-center-group', 'Sponsor Center', 5)
  RETURNING "AdminNavItemId" INTO sponsor_center_group_id;

  INSERT INTO "AdminNavItems" ("ParentId", "Key", "Label", "SortOrder") VALUES
    (sponsor_center_group_id, 'sponsor-manager', 'Sponsor Manager', 0),
    (sponsor_center_group_id, 'sponsor-tiering', 'Sponsor Tiering', 1),
    (sponsor_center_group_id, 'message-sponsors', 'Message Sponsors', 2),
    (sponsor_center_group_id, 'advanced-banners', 'Advanced Banners', 3),
    (sponsor_center_group_id, 'sponsor-outreach-campaigns', 'Outreach Campaigns', 4),
    (sponsor_center_group_id, 'sponsor-1on1-meetings', 'Sponsor 1-1 Meetings', 5);

  RAISE NOTICE 'Event Content restructured into nested Branding/Agenda/Speaker/Exhibitor/Sponsor Center groups.';
END $$;
