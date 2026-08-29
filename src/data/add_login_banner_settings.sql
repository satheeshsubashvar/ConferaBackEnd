-- Global Confera Admin login screen customization and its Settings menu entry.
CREATE TABLE IF NOT EXISTS "LoginPageSettings" (
  "SettingsId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "SettingsJson" text NOT NULL DEFAULT '{}',
  "CreatedAt" timestamp without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  "UpdatedAt" timestamp without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

DO $$
DECLARE
  settings_section uuid;
  video_group uuid;
BEGIN
  SELECT "AdminNavItemId" INTO settings_section
  FROM "AdminNavItems"
  WHERE "Key" = 'settings-section'
  LIMIT 1;

  IF settings_section IS NULL THEN
    INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection")
    VALUES ('settings-section','Settings','Settings',7,true)
    ON CONFLICT ("Key") DO UPDATE SET "Label"='Settings',"Icon"='Settings',"IsSection"=true
    RETURNING "AdminNavItemId" INTO settings_section;
  END IF;

  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder")
  VALUES (settings_section,'settings-video-conferencing','Video Conferencing API Settings',0)
  ON CONFLICT ("Key") DO UPDATE SET "ParentId"=EXCLUDED."ParentId", "Label"=EXCLUDED."Label", "SortOrder"=EXCLUDED."SortOrder", "IsActive"=true;

  SELECT "AdminNavItemId" INTO video_group
  FROM "AdminNavItems" WHERE "Key"='settings-video-conferencing' LIMIT 1;

  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (video_group,'settings-google-meet','Google Meet API',0),
    (video_group,'settings-zoom','Zoom API',1),
    (video_group,'settings-custom-video-call','Custom Video Call API',2)
  ON CONFLICT ("Key") DO UPDATE SET "ParentId"=EXCLUDED."ParentId", "Label"=EXCLUDED."Label", "SortOrder"=EXCLUDED."SortOrder", "IsActive"=true;

  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (settings_section,'settings-email','Email Settings',1),
    (settings_section,'settings-sms','SMS Settings',2),
    (settings_section,'settings-2fa','Two-Factor Authentication',3),
    (settings_section,'settings-email-templates','Email Templates',4),
    (settings_section,'settings-payment','Payment Settings',5),
    (settings_section,'settings-login-banner','Login Banner',6)
  ON CONFLICT ("Key") DO UPDATE SET "ParentId"=EXCLUDED."ParentId", "Label"=EXCLUDED."Label", "SortOrder"=EXCLUDED."SortOrder", "IsActive"=true;
END $$;
