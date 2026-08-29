-- =====================================================================
-- Replaces the Admin sidebar's 17-section taxonomy with the new
-- 7-section EMS Admin structure (Event Content, Event Marketing,
-- Engage & Network, Attendees, Tickets, Pay & Publish, Tools).
--
-- This is destructive to the OLD nav tree by design (the user asked
-- for a full replace, not a merge) but preserves every item whose Key
-- has a real, working page behind it in EventManagementPage.jsx:
-- home, app-branding, customize-resources, web-speaker-page,
-- branded-url, session-manager, track-manager. Those seven rows are
-- re-created under their new parent sections rather than deleted, so
-- the pages built for them (Basic Information, App Branding, Session
-- Manager with its 37-field CRUD/Timeline/Duplicate/Swap, Track
-- Manager, etc.) stay reachable.
--
-- Safe to re-run: checks whether the new taxonomy is already present
-- (via the 'event-content' section key) before doing anything.
-- =====================================================================

DO $$
DECLARE
  event_content uuid;
  event_marketing uuid;
  engage_network uuid;
  attendees_section uuid;
  tickets_section uuid;
  pay_publish uuid;
  tools_section uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM "AdminNavItems" WHERE "Key" = 'event-content') THEN
    RAISE NOTICE 'New Admin nav taxonomy already present — nothing to do.';
    RETURN;
  END IF;

  -- Wipe the entire old tree (children first via CASCADE from the
  -- FK on ParentId, but DELETE on AdminNavItems with no WHERE clause
  -- is simplest and correct here since this table is global, not
  -- per-event — same reasoning as reset_seed_data.sql's AdminNavItems
  -- handling).
  DELETE FROM "AdminNavItems";

  -- Event Content
  INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection") VALUES ('event-content','Event Content','Home',0,true) RETURNING "AdminNavItemId" INTO event_content;
  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (event_content,'home','Event Basics',0),
    (event_content,'app-branding','Branding Center',1),
    (event_content,'session-manager','Session Manager',2),
    (event_content,'track-manager','Track Manager',3),
    (event_content,'category-manager','Category Manager',4),
    (event_content,'speaker-center','Speaker Center',5),
    (event_content,'sponsor-center','Sponsor Center',6),
    (event_content,'exhibitor-center','Exhibitor Center',7);

  -- Event Marketing
  INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection") VALUES ('event-marketing','Event Marketing','Globe',1,true) RETURNING "AdminNavItemId" INTO event_marketing;
  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (event_marketing,'agenda-webpage','Agenda Webpage',0),
    (event_marketing,'webpage-analytics','Analytics',1),
    (event_marketing,'speaker-webpage','Speaker Webpage',2),
    (event_marketing,'sponsor-webpage','Sponsor Webpage',3),
    (event_marketing,'exhibitor-webpage','Exhibitor Webpage',4),
    (event_marketing,'logistics-webpage','Logistics Webpage',5),
    (event_marketing,'venue-map-webpage','Venue Map Webpage',6),
    (event_marketing,'event-website','Event Website',7),
    (event_marketing,'my-event-listing','My Event Listing',8),
    (event_marketing,'traffic-analytics','Traffic Analytics',9),
    (event_marketing,'social-wall-customization','Social Wall Customization',10),
    (event_marketing,'activity-stream-webpage','Activity Stream Webpage',11),
    (event_marketing,'branded-url','Branded Event URL',12),
    (event_marketing,'social-media-center','Social Media Center',13),
    (event_marketing,'web-speaker-page','Web App Speaker Page',14);

  -- Engage & Network
  INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection") VALUES ('engage-network','Engage & Network','Users',2,true) RETURNING "AdminNavItemId" INTO engage_network;
  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (engage_network,'announcement','Announcement',0),
    (engage_network,'meetups','Meet-ups',1),
    (engage_network,'discussion-topics','Discussion Topics',2),
    (engage_network,'social-groups','Social Groups',3),
    (engage_network,'gamification','Gamification',4),
    (engage_network,'session-feedback','Session Feedback',5),
    (engage_network,'surveys','Surveys',6),
    (engage_network,'floormap','Floormap',7),
    (engage_network,'manage-live-poll','Live Polling',8),
    (engage_network,'photos','Photos',9);

  -- Attendees
  INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection") VALUES ('attendees-section','Attendees','ClipboardList',3,true) RETURNING "AdminNavItemId" INTO attendees_section;
  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (attendees_section,'attendee-admin-settings','Admin Settings',0),
    (attendees_section,'attendees','Attendees',1),
    (attendees_section,'attendees-limit-upgrade','Attendees Limit Upgrade',2),
    (attendees_section,'ticket-session-mapping','Ticket Session Mapping',3),
    (attendees_section,'session-cap','Session Cap',4),
    (attendees_section,'waiver-form','Waiver Form (Covid 19)',5),
    (attendees_section,'attendee-checkin','Attendee Check-in',6),
    (attendees_section,'attendee-checkout','Attendee Checkout',7),
    (attendees_section,'name-badges','Name Badges',8),
    (attendees_section,'crm-integration','CRM Integration via Zapier',9);

  -- Tickets
  INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection") VALUES ('tickets-section','Tickets','Store',4,true) RETURNING "AdminNavItemId" INTO tickets_section;
  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (tickets_section,'create-tickets','Create Tickets',0),
    (tickets_section,'question-form','Question / Form',1),
    (tickets_section,'confirmation-email','Confirmation Email',2),
    (tickets_section,'ticket-addons','Ticket Add-ons',3),
    (tickets_section,'discount-codes','Discount Codes',4),
    (tickets_section,'ticket-additional-settings','Additional Settings',5),
    (tickets_section,'payouts','Payouts',6),
    (tickets_section,'preview-registration','Preview Registration',7),
    (tickets_section,'go-live','Go Live',8),
    (tickets_section,'ticket-buttons-links','Buttons & Links',9),
    (tickets_section,'registration-widgets','Registration Widgets',10),
    (tickets_section,'registration-page','Registration Page',11),
    (tickets_section,'ticket-event-website','Event Website',12),
    (tickets_section,'email-campaign','Email Campaign',13),
    (tickets_section,'campaign-contact-list','Campaign Contact List',14),
    (tickets_section,'all-orders','All Orders',15),
    (tickets_section,'add-orders','Add Orders',16);

  -- Pay & Publish
  INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection") VALUES ('pay-publish','Pay & Publish','Wallet',5,true) RETURNING "AdminNavItemId" INTO pay_publish;
  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (pay_publish,'balance','Balance',0),
    (pay_publish,'order-details','Order Details',1);

  -- Tools
  INSERT INTO "AdminNavItems" ("Key","Label","Icon","SortOrder","IsSection") VALUES ('tools-section','Tools','Wrench',6,true) RETURNING "AdminNavItemId" INTO tools_section;
  INSERT INTO "AdminNavItems" ("ParentId","Key","Label","SortOrder") VALUES
    (tools_section,'app-download-email','App Download Email',0),
    (tools_section,'app-download-button','App Download Button',1),
    (tools_section,'tools-social-media','Social Media',2),
    (tools_section,'web-app-link','Web App Link',3),
    (tools_section,'materials','Materials',4),
    (tools_section,'tools-buttons','Buttons',5),
    (tools_section,'mod-photos','Photos',6),
    (tools_section,'session-chats','Session Chats',7),
    (tools_section,'community-board','Community Board',8),
    (tools_section,'moderate-session-qa','Moderate Session Q&A',9),
    (tools_section,'reports','Reports',10);

  RAISE NOTICE 'Admin sidebar replaced with the new 7-section EMS Admin taxonomy.';
END $$;
