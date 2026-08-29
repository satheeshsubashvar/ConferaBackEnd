DO $$
DECLARE settings_section uuid; video_group uuid;
BEGIN
  SELECT "AdminNavItemId" INTO settings_section FROM "AdminNavItems" WHERE "Key"='settings-section' LIMIT 1;
  IF settings_section IS NULL THEN
    INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection")
    VALUES ('settings-section','Settings','Settings',7,true)
    RETURNING "AdminNavItemId" INTO settings_section;
  END IF;

  DELETE FROM "AdminNavItems" WHERE "ParentId" IN (SELECT "AdminNavItemId" FROM "AdminNavItems" WHERE "ParentId" = settings_section);
  DELETE FROM "AdminNavItems" WHERE "ParentId" = settings_section;

  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder")
  VALUES (settings_section,'settings-video-conferencing','Video Conferencing API Settings',0)
  RETURNING "AdminNavItemId" INTO video_group;

  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (video_group,'settings-google-meet','Google Meet API',0),
    (video_group,'settings-zoom','Zoom API',1),
    (settings_section,'settings-email','Email Settings',1),
    (settings_section,'settings-sms','SMS Settings',2),
    (settings_section,'settings-2fa','Two-Factor Authentication',3),
    (settings_section,'settings-email-templates','Email Templates',4),
    (settings_section,'settings-payment','Payment Settings',5);
END $$;
