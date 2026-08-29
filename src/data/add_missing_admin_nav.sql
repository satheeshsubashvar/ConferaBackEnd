-- =====================================================================
-- Adds the Admin sidebar sections for modules built across all 32
-- migrations that were missing from the original seed (only Basics,
-- Branding Center, Agenda Center, Speaker Center, and Exhibitor
-- Center existed). Safe to run once; re-running will create
-- duplicate rows since AdminNavItems.Key only has a UNIQUE constraint,
-- not an upsert guard — check first if unsure (see query at bottom).
-- =====================================================================

DO $$
DECLARE
  registration_id uuid;
  checkin_id uuid;
  crm_id uuid;
  attendance_id uuid;
  feedback_id uuid;
  networking_id uuid;
  operations_id uuid;
  sponsor_pkg_id uuid;
  marketing_id uuid;
  content_id uuid;
  legal_id uuid;
  developer_id uuid;
BEGIN
  -- Skip entirely if already applied (idempotent guard)
  IF EXISTS (SELECT 1 FROM "AdminNavItems" WHERE "Key" = 'registration') THEN
    RAISE NOTICE 'Missing nav sections already present — nothing to do.';
    RETURN;
  END IF;

  INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection") VALUES ('registration','Registration Center','ClipboardList',5,true) RETURNING "AdminNavItemId" INTO registration_id;
  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (registration_id,'registration-forms','Registration Forms',0),
    (registration_id,'ticket-types','Ticket Types',1),
    (registration_id,'coupons','Coupons',2),
    (registration_id,'waitlist','Waitlist',3);

  INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection") VALUES ('checkin','Check-In & Badges','ScanLine',6,true) RETURNING "AdminNavItemId" INTO checkin_id;
  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (checkin_id,'checkin-stations','Check-In Stations',0),
    (checkin_id,'badge-templates','Badge Templates',1),
    (checkin_id,'badge-print-jobs','Badge Print Jobs',2);

  INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection") VALUES ('crm','Sponsor CRM & Leads','Handshake',7,true) RETURNING "AdminNavItemId" INTO crm_id;
  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (crm_id,'lead-scans','Lead Scans',0),
    (crm_id,'lead-qualification','Lead Qualification',1),
    (crm_id,'companies-contacts','Companies & Contacts',2),
    (crm_id,'business-card-scanner','Business Card Scanner',3);

  INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection") VALUES ('attendance','Attendance & Certificates','BadgeCheck',8,true) RETURNING "AdminNavItemId" INTO attendance_id;
  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (attendance_id,'session-attendance','Session Attendance',0),
    (attendance_id,'certificate-templates','Certificate Templates',1),
    (attendance_id,'issued-certificates','Issued Certificates',2);

  INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection") VALUES ('feedback','Surveys & Ratings','Star',9,true) RETURNING "AdminNavItemId" INTO feedback_id;
  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (feedback_id,'survey-templates','Survey Templates',0),
    (feedback_id,'session-ratings','Session Ratings',1),
    (feedback_id,'speaker-ratings','Speaker Ratings',2);

  INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection") VALUES ('networking','AI Matchmaking','Users',10,true) RETURNING "AdminNavItemId" INTO networking_id;
  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (networking_id,'networking-preferences','Networking Preferences',0),
    (networking_id,'suggested-connections','Suggested Connections',1),
    (networking_id,'appointment-scheduler','Appointment Scheduler',2);

  INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection") VALUES ('operations','Operations','ListTodo',11,true) RETURNING "AdminNavItemId" INTO operations_id;
  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (operations_id,'tasks','Tasks',0),
    (operations_id,'volunteers','Volunteers',1),
    (operations_id,'budget','Budget',2),
    (operations_id,'vendors','Vendors',3),
    (operations_id,'event-timeline','Event Timeline',4),
    (operations_id,'accommodation','Accommodation',5),
    (operations_id,'travel','Travel',6);

  INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection") VALUES ('sponsor-packages','Sponsor Packages','Package',12,true) RETURNING "AdminNavItemId" INTO sponsor_pkg_id;
  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (sponsor_pkg_id,'packages','Packages',0),
    (sponsor_pkg_id,'package-benefits','Package Benefits',1),
    (sponsor_pkg_id,'sponsor-roi','Sponsor ROI Analytics',2),
    (sponsor_pkg_id,'exhibitor-products','Exhibitor Products',3);

  INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection") VALUES ('marketing','Marketing','Megaphone',13,true) RETURNING "AdminNavItemId" INTO marketing_id;
  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (marketing_id,'email-campaigns','Email Campaigns',0),
    (marketing_id,'push-campaigns','Push Campaigns',1),
    (marketing_id,'sms-campaigns','SMS Campaigns',2),
    (marketing_id,'utm-referrals','UTM & Referral Links',3),
    (marketing_id,'website-builder','Website Builder',4);

  INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection") VALUES ('content','Content & Streaming','Video',14,true) RETURNING "AdminNavItemId" INTO content_id;
  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder","Badge") VALUES
    (content_id,'live-streaming','Live Streaming',0,NULL),
    (content_id,'agenda-calendar-sync','Agenda & Calendar Sync',1,NULL),
    (content_id,'ai-features','AI Features',2,'NEW');

  INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection") VALUES ('legal','Legal & Marketplace','FileSignature',15,true) RETURNING "AdminNavItemId" INTO legal_id;
  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (legal_id,'document-signing','Document Signing',0),
    (legal_id,'marketplace','Marketplace',1);

  INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection") VALUES ('developer','Developer','Code2',16,true) RETURNING "AdminNavItemId" INTO developer_id;
  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (developer_id,'api-keys','API Keys',0),
    (developer_id,'workflow-engine','Workflow Engine',1);

  RAISE NOTICE 'Added 12 new sidebar sections and their items.';
END $$;
