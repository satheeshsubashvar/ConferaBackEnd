import bcrypt from 'bcryptjs';
import { pool } from './db.js';

// Seeds the REAL schema (original 72-table Confera.sql + the 32
// multi-tenancy/feature migrations + AdminNavItems/PortalNavItems).
// Only runs when Organizations is empty, so it never overwrites real
// data on later boots.
//
// Key relational facts this respects (verified against the actual
// schema, not assumed):
//   - Person.FullName is a GENERATED column — never insert into it.
//   - Organizations.OwnerPersonId is required; OrganizationUsers links
//     a Person to an Organization via a RoleId (not a free-text role).
//   - Event has no direct "attendee/organizer" account distinction —
//     both Admin organizers and Portal attendees are just Person rows.
//     A Person becomes a Portal attendee for an event by getting an
//     EventParticipant row (Role='Attendee') for that EventId.
//   - SponsorProfile requires an EventParticipant row first (a sponsor
//     IS a participant with Role='Sponsor'); TierId is optional and
//     references SponsorTiers.
export async function seedIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM "Organizations"');
  if (rows[0].n > 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // -----------------------------------------------------------
    // Organizer Person + Organization + OrganizationUsers (Owner)
    // -----------------------------------------------------------
    const personRes = await client.query(
      `INSERT INTO "Person" ("Email", "NormalizedEmail", "PasswordHash", "FirstName", "LastName")
       VALUES ($1, $2, $3, $4, $5) RETURNING "PersonId"`,
      [
        'satheesh@confera.io',
        'SATHEESH@CONFERA.IO',
        bcrypt.hashSync('Password123', 10),
        'Satheesh',
        'Kaliyamoorthy',
      ]
    );
    const organizerPersonId = personRes.rows[0].PersonId;

    const orgRes = await client.query(
      `INSERT INTO "Organizations" ("Name", "Slug", "OwnerPersonId")
       VALUES ($1, $2, $3) RETURNING "OrganizationId"`,
      ['Confera Demo Organization', 'confera-demo', organizerPersonId]
    );
    const organizationId = orgRes.rows[0].OrganizationId;

    // "Owner" is a global system role seeded by migration 001
    // (OrganizationId IS NULL). Look it up rather than re-inserting.
    const ownerRoleRes = await client.query(
      `SELECT "RoleId" FROM "OrganizationRoles" WHERE "Name" = 'Owner' AND "OrganizationId" IS NULL LIMIT 1`
    );
    if (ownerRoleRes.rows.length === 0) {
      throw new Error(
        'OrganizationRoles has no global "Owner" role. Has migration 001_multi_tenancy.sql been applied?'
      );
    }
    const ownerRoleId = ownerRoleRes.rows[0].RoleId;

    await client.query(
      `INSERT INTO "OrganizationUsers" ("OrganizationId", "PersonId", "RoleId", "Status", "JoinedAt")
       VALUES ($1, $2, $3, 'Active', now())`,
      [organizationId, organizerPersonId, ownerRoleId]
    );

    // -----------------------------------------------------------
    // Event
    // -----------------------------------------------------------
    const eventRes = await client.query(
      `INSERT INTO "Event" (
        "EventCode", "Title", "Slug", "Description", "Status",
        "StartDate", "EndDate", "VenueName", "VenueAddress", "VenueCity",
        "VenueCountry", "MaxAttendees", "WebsiteUrl", "LogoUrl",
        "BannerImageUrl", "OwnerId", "OrganizationId"
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
      ) RETURNING "EventId"`,
      [
        'HR2026',
        'HRM Summit India 2026',
        'hrm-summit-india-2026',
        'HRM Summit 2026 is an event focused on quality, not merely quantity. People, in the business of people are set to witness 90+ painstakingly selected speakers tell their honest, passionate and sometimes personal stories on how the turning points of their pasts changed the trajectory of the future.',
        'Published',
        '2026-08-03 09:00:00',
        '2026-08-07 18:00:00',
        'Chennai Trade Centre',
        'Chennai Trade Centre',
        'Chennai',
        'India',
        1500,
        'hrmsummit.in',
        '',
        '',
        organizerPersonId,
        organizationId,
      ]
    );
    const eventId = eventRes.rows[0].EventId;

    // -----------------------------------------------------------
    // Sponsors: each sponsor is a Person -> EventParticipant(Role
    // ='Sponsor') -> SponsorProfile chain, matching the real schema.
    // A shared placeholder Person is used per sponsor company since
    // the schema models sponsor *contacts*, not just company names.
    // -----------------------------------------------------------
    const sponsors = [
      { company: 'Microsoft', tier: 'Gold', description: 'Cloud infrastructure partner', email: 'sponsor-microsoft@confera.io' },
      { company: 'Google', tier: 'Gold', description: '', email: 'sponsor-google@confera.io' },
      { company: 'ATLAS', tier: null, description: '', email: 'sponsor-atlas@confera.io' },
      { company: 'FORGE Labs', tier: null, description: '', email: 'sponsor-forgelabs@confera.io' },
      { company: 'VERIDIAN', tier: null, description: '', email: 'sponsor-veridian@confera.io' },
    ];

    // Look up (or the Gold tier must already exist via SponsorTiers
    // seed data in a real deployment; here we create it defensively
    // if missing, since SponsorTiers has no default seed of its own).
    let goldTierId = null;
    const goldTierRes = await client.query(`SELECT "TierId" FROM "SponsorTiers" WHERE "Name" = 'Gold' LIMIT 1`);
    if (goldTierRes.rows.length > 0) {
      goldTierId = goldTierRes.rows[0].TierId;
    } else {
      const createTier = await client.query(
        `INSERT INTO "SponsorTiers" ("Name", "SortOrder") VALUES ('Gold', 0) RETURNING "TierId"`
      );
      goldTierId = createTier.rows[0].TierId;
    }

    for (const s of sponsors) {
      const sponsorPersonRes = await client.query(
        `INSERT INTO "Person" ("Email", "NormalizedEmail", "PasswordHash", "FirstName", "LastName", "Company")
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING "PersonId"`,
        [s.email, s.email.toUpperCase(), bcrypt.hashSync('Password123', 10), 'Sponsor', 'Contact', s.company]
      );
      const sponsorPersonId = sponsorPersonRes.rows[0].PersonId;

      const participantRes = await client.query(
        `INSERT INTO "EventParticipant" ("EventId", "PersonId", "Role", "Company", "RegistrationCode")
         VALUES ($1,$2,'Sponsor',$3,$4) RETURNING "EventParticipantId"`,
        [eventId, sponsorPersonId, s.company, `SPN-${s.company.replace(/\s+/g, '').toUpperCase()}`]
      );
      const eventParticipantId = participantRes.rows[0].EventParticipantId;

      await client.query(
        `INSERT INTO "SponsorProfile" ("EventParticipantId", "TierId", "CompanyName", "Description", "IsPublished")
         VALUES ($1,$2,$3,$4,true)`,
        [eventParticipantId, s.tier === 'Gold' ? goldTierId : null, s.company, s.description]
      );
    }

    // -----------------------------------------------------------
    // Attendee (Portal login demo account): a Person + an
    // EventParticipant row with Role='Attendee' for this event.
    // -----------------------------------------------------------
    const attendeePersonRes = await client.query(
      `INSERT INTO "Person" ("Email", "NormalizedEmail", "PasswordHash", "FirstName", "LastName")
       VALUES ($1,$2,$3,$4,$5) RETURNING "PersonId"`,
      ['attendee@confera.io', 'ATTENDEE@CONFERA.IO', bcrypt.hashSync('Password123', 10), 'Satheesh', 'K']
    );
    const attendeePersonId = attendeePersonRes.rows[0].PersonId;

    await client.query(
      `INSERT INTO "EventParticipant" ("EventId", "PersonId", "Role", "RegistrationCode", "Status", "ConfirmedAt")
       VALUES ($1,$2,'Attendee',$3,'Confirmed', now())`,
      [eventId, attendeePersonId, 'ATT-0001']
    );

    // -----------------------------------------------------------
    // AdminNavItems: mirrors the current Event Management sidebar
    // -----------------------------------------------------------
    const insertAdminNav = async (key, label, opts = {}) => {
      const { icon = null, sortOrder = 0, isSection = false, badge = null, parentId = null } = opts;
      const res = await client.query(
        `INSERT INTO "AdminNavItems" ("ParentId", "Key", "Label", "Icon", "SortOrder", "IsSection", "Badge")
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING "AdminNavItemId"`,
        [parentId, key, label, icon, sortOrder, isSection, badge]
      );
      return res.rows[0].AdminNavItemId;
    };

    // =============================================================
    // Admin sidebar — matches the 7-section EMS Admin taxonomy.
    // Keys with real, working pages behind them (home, app-branding,
    // customize-resources, web-speaker-page, branded-url,
    // session-manager, track-manager) are preserved exactly, since
    // EventManagementPage.jsx routes on these specific strings.
    // Every other item is a new stub — no page built yet.
    // =============================================================

    const eventContent = await insertAdminNav('event-content', 'Event Content', { icon: 'Home', sortOrder: 0, isSection: true });
    await insertAdminNav('home', 'Basics', { parentId: eventContent, sortOrder: 0 });

    // Branding Center: a real 3rd-level collapsible group, not flat
    // siblings — EventSidebar.jsx renders any item with children as
    // its own sub-group.
    const brandingCenter = await insertAdminNav('branding-center', 'Branding Center', { parentId: eventContent, sortOrder: 1 });
    await insertAdminNav('app-branding', 'App Branding', { parentId: brandingCenter, sortOrder: 0 });
    await insertAdminNav('customize-resources', 'Customize Resources', { parentId: brandingCenter, sortOrder: 1 });
    await insertAdminNav('web-speaker-page', 'Web App Speaker Page', { parentId: brandingCenter, sortOrder: 2 });
    await insertAdminNav('branded-url', 'Branded Event URL', { parentId: brandingCenter, sortOrder: 3 });
    await insertAdminNav('documents', 'Documents', { parentId: brandingCenter, sortOrder: 4 });
    await insertAdminNav('video-hosting', 'Video Hosting', { parentId: brandingCenter, sortOrder: 5 });
    await insertAdminNav('attendee-video-access', 'Attendee Video Access', { parentId: brandingCenter, sortOrder: 6 });

    // Agenda Center. Category Manager is kept even though the
    // reference screenshot doesn't show it — it's a real, working,
    // tested feature. Conflict Check is deliberately not included;
    // its page/route/store function were removed.
    const agendaCenter = await insertAdminNav('agenda-center', 'Agenda Center', { parentId: eventContent, sortOrder: 2 });
    await insertAdminNav('session-manager', 'Session Manager', { parentId: agendaCenter, sortOrder: 0 });
    await insertAdminNav('track-manager', 'Track Manager', { parentId: agendaCenter, sortOrder: 1 });
    await insertAdminNav('category-manager', 'Category Manager', { parentId: agendaCenter, sortOrder: 2 });
    await insertAdminNav('session-qa-manager', 'Session Q&A Manager', { parentId: agendaCenter, sortOrder: 3 });

    // Speaker Center. The 'speaker-center' key keeps its real working
    // page (SpeakerCenterPage) but becomes the group's first child,
    // relabeled "Speaker Manager" — matching the reference, where
    // "Speaker Center" is the collapsible header and "Speaker
    // Manager" is the selected item inside it.
    const speakerCenterGroup = await insertAdminNav('speaker-center-group', 'Speaker Center', { parentId: eventContent, sortOrder: 3 });
    await insertAdminNav('speaker-center', 'Speaker Manager', { parentId: speakerCenterGroup, sortOrder: 0 });
    await insertAdminNav('message-speakers', 'Message Speakers', { parentId: speakerCenterGroup, sortOrder: 1 });
    await insertAdminNav('speaker-1on1-meetings', 'Speaker 1-1 Meetings', { parentId: speakerCenterGroup, sortOrder: 2 });

    const exhibitorCenterGroup = await insertAdminNav('exhibitor-center-group', 'Exhibitor Center', { parentId: eventContent, sortOrder: 4 });
    await insertAdminNav('exhibitor-manager', 'Exhibitor Manager', { parentId: exhibitorCenterGroup, sortOrder: 0 });
    await insertAdminNav('message-exhibitors', 'Message Exhibitors', { parentId: exhibitorCenterGroup, sortOrder: 1 });
    await insertAdminNav('passport-contest', 'Passport Contest', { parentId: exhibitorCenterGroup, sortOrder: 2 });
    await insertAdminNav('exhibitor-outreach-campaigns', 'Outreach Campaigns', { parentId: exhibitorCenterGroup, sortOrder: 3 });
    await insertAdminNav('compliance-documents', 'Compliance Documents', { parentId: exhibitorCenterGroup, sortOrder: 4 });
    await insertAdminNav('exhibitor-1on1-meetings', 'Exhibitor 1-1 Meetings', { parentId: exhibitorCenterGroup, sortOrder: 5 });
    await insertAdminNav('exhibitor-trivia', 'Exhibitor Trivia', { parentId: exhibitorCenterGroup, sortOrder: 6 });

    const sponsorCenterGroup = await insertAdminNav('sponsor-center-group', 'Sponsor Center', { parentId: eventContent, sortOrder: 5 });
    await insertAdminNav('sponsor-manager', 'Sponsor Manager', { parentId: sponsorCenterGroup, sortOrder: 0 });
    await insertAdminNav('sponsor-tiering', 'Sponsor Tiering', { parentId: sponsorCenterGroup, sortOrder: 1 });
    await insertAdminNav('message-sponsors', 'Message Sponsors', { parentId: sponsorCenterGroup, sortOrder: 2 });
    await insertAdminNav('advanced-banners', 'Advanced Banners', { parentId: sponsorCenterGroup, sortOrder: 3 });
    await insertAdminNav('sponsor-outreach-campaigns', 'Outreach Campaigns', { parentId: sponsorCenterGroup, sortOrder: 4 });
    await insertAdminNav('sponsor-1on1-meetings', 'Sponsor 1-1 Meetings', { parentId: sponsorCenterGroup, sortOrder: 5 });

    const eventMarketing = await insertAdminNav('event-marketing', 'Event Marketing', { icon: 'Globe', sortOrder: 1, isSection: true });
    await insertAdminNav('agenda-webpage', 'Agenda Webpage', { parentId: eventMarketing, sortOrder: 0 });
    await insertAdminNav('webpage-analytics', 'Analytics', { parentId: eventMarketing, sortOrder: 1 });
    await insertAdminNav('speaker-webpage', 'Speaker Webpage', { parentId: eventMarketing, sortOrder: 2 });
    await insertAdminNav('sponsor-webpage', 'Sponsor Webpage', { parentId: eventMarketing, sortOrder: 3 });
    await insertAdminNav('exhibitor-webpage', 'Exhibitor Webpage', { parentId: eventMarketing, sortOrder: 4 });
    await insertAdminNav('logistics-webpage', 'Logistics Webpage', { parentId: eventMarketing, sortOrder: 5 });
    await insertAdminNav('venue-map-webpage', 'Venue Map Webpage', { parentId: eventMarketing, sortOrder: 6 });
    await insertAdminNav('event-website', 'Event Website', { parentId: eventMarketing, sortOrder: 7 });
    await insertAdminNav('my-event-listing', 'My Event Listing', { parentId: eventMarketing, sortOrder: 8 });
    await insertAdminNav('traffic-analytics', 'Traffic Analytics', { parentId: eventMarketing, sortOrder: 9 });
    await insertAdminNav('social-wall-customization', 'Social Wall Customization', { parentId: eventMarketing, sortOrder: 10 });
    await insertAdminNav('activity-stream-webpage', 'Activity Stream Webpage', { parentId: eventMarketing, sortOrder: 11 });
    await insertAdminNav('social-media-center', 'Social Media Center', { parentId: eventMarketing, sortOrder: 12 });

    const engageNetwork = await insertAdminNav('engage-network', 'Engage & Network', { icon: 'Users', sortOrder: 2, isSection: true });
    await insertAdminNav('announcement', 'Announcement', { parentId: engageNetwork, sortOrder: 0 });
    await insertAdminNav('meetups', 'Meet-ups', { parentId: engageNetwork, sortOrder: 1 });
    await insertAdminNav('discussion-topics', 'Discussion Topics', { parentId: engageNetwork, sortOrder: 2 });
    await insertAdminNav('social-groups', 'Social Groups', { parentId: engageNetwork, sortOrder: 3 });
    await insertAdminNav('gamification', 'Gamification', { parentId: engageNetwork, sortOrder: 4 });
    await insertAdminNav('session-feedback', 'Session Feedback', { parentId: engageNetwork, sortOrder: 5 });
    await insertAdminNav('surveys', 'Surveys', { parentId: engageNetwork, sortOrder: 6 });
    await insertAdminNav('floormap', 'Floormap', { parentId: engageNetwork, sortOrder: 7 });
    await insertAdminNav('manage-live-poll', 'Live Polling', { parentId: engageNetwork, sortOrder: 8 });
    await insertAdminNav('photos', 'Photos', { parentId: engageNetwork, sortOrder: 9 });

    const attendeesSection = await insertAdminNav('attendees-section', 'Attendees', { icon: 'ClipboardList', sortOrder: 3, isSection: true });
    await insertAdminNav('attendee-admin-settings', 'Admin Settings', { parentId: attendeesSection, sortOrder: 0 });
    await insertAdminNav('attendees', 'Attendees', { parentId: attendeesSection, sortOrder: 1 });
    await insertAdminNav('attendees-limit-upgrade', 'Attendees Limit Upgrade', { parentId: attendeesSection, sortOrder: 2 });
    await insertAdminNav('ticket-session-mapping', 'Ticket Session Mapping', { parentId: attendeesSection, sortOrder: 3 });
    await insertAdminNav('session-cap', 'Session Cap', { parentId: attendeesSection, sortOrder: 4 });
    await insertAdminNav('waiver-form', 'Waiver Form (Covid 19)', { parentId: attendeesSection, sortOrder: 5 });
    await insertAdminNav('attendee-checkin', 'Attendee Check-in', { parentId: attendeesSection, sortOrder: 6 });
    await insertAdminNav('attendee-checkout', 'Attendee Checkout', { parentId: attendeesSection, sortOrder: 7 });
    await insertAdminNav('name-badges', 'Name Badges', { parentId: attendeesSection, sortOrder: 8 });
    await insertAdminNav('crm-integration', 'CRM Integration via Zapier', { parentId: attendeesSection, sortOrder: 9 });

    const ticketsSection = await insertAdminNav('tickets-section', 'Tickets', { icon: 'Store', sortOrder: 4, isSection: true });
    await insertAdminNav('create-tickets', 'Create Tickets', { parentId: ticketsSection, sortOrder: 0 });
    await insertAdminNav('question-form', 'Question / Form', { parentId: ticketsSection, sortOrder: 1 });
    await insertAdminNav('confirmation-email', 'Confirmation Email', { parentId: ticketsSection, sortOrder: 2 });
    await insertAdminNav('ticket-addons', 'Ticket Add-ons', { parentId: ticketsSection, sortOrder: 3 });
    await insertAdminNav('discount-codes', 'Discount Codes', { parentId: ticketsSection, sortOrder: 4 });
    await insertAdminNav('ticket-additional-settings', 'Additional Settings', { parentId: ticketsSection, sortOrder: 5 });
    await insertAdminNav('payouts', 'Payouts', { parentId: ticketsSection, sortOrder: 6 });
    await insertAdminNav('preview-registration', 'Preview Registration', { parentId: ticketsSection, sortOrder: 7 });
    await insertAdminNav('go-live', 'Go Live', { parentId: ticketsSection, sortOrder: 8 });
    await insertAdminNav('ticket-buttons-links', 'Buttons & Links', { parentId: ticketsSection, sortOrder: 9 });
    await insertAdminNav('registration-widgets', 'Registration Widgets', { parentId: ticketsSection, sortOrder: 10 });
    await insertAdminNav('registration-page', 'Registration Page', { parentId: ticketsSection, sortOrder: 11 });
    await insertAdminNav('ticket-event-website', 'Event Website', { parentId: ticketsSection, sortOrder: 12 });
    await insertAdminNav('email-campaign', 'Email Campaign', { parentId: ticketsSection, sortOrder: 13 });
    await insertAdminNav('campaign-contact-list', 'Campaign Contact List', { parentId: ticketsSection, sortOrder: 14 });
    await insertAdminNav('all-orders', 'All Orders', { parentId: ticketsSection, sortOrder: 15 });
    await insertAdminNav('add-orders', 'Add Orders', { parentId: ticketsSection, sortOrder: 16 });

    const payPublish = await insertAdminNav('pay-publish', 'Pay & Publish', { icon: 'Wallet', sortOrder: 5, isSection: true });
    await insertAdminNav('balance', 'Balance', { parentId: payPublish, sortOrder: 0 });
    await insertAdminNav('order-details', 'Order Details', { parentId: payPublish, sortOrder: 1 });

    const toolsSection = await insertAdminNav('tools-section', 'Tools', { icon: 'Wrench', sortOrder: 6, isSection: true });
    await insertAdminNav('app-download-email', 'App Download Email', { parentId: toolsSection, sortOrder: 0 });
    await insertAdminNav('app-download-button', 'App Download Button', { parentId: toolsSection, sortOrder: 1 });
    await insertAdminNav('tools-social-media', 'Social Media', { parentId: toolsSection, sortOrder: 2 });
    await insertAdminNav('web-app-link', 'Web App Link', { parentId: toolsSection, sortOrder: 3 });
    await insertAdminNav('materials', 'Materials', { parentId: toolsSection, sortOrder: 4 });
    await insertAdminNav('tools-buttons', 'Buttons', { parentId: toolsSection, sortOrder: 5 });
    await insertAdminNav('mod-photos', 'Photos', { parentId: toolsSection, sortOrder: 6 });
    await insertAdminNav('session-chats', 'Session Chats', { parentId: toolsSection, sortOrder: 7 });
    await insertAdminNav('community-board', 'Community Board', { parentId: toolsSection, sortOrder: 8 });
    await insertAdminNav('moderate-session-qa', 'Moderate Session Q&A', { parentId: toolsSection, sortOrder: 9 });
    await insertAdminNav('reports', 'Reports', { parentId: toolsSection, sortOrder: 10 });

    // "Branded Event URL" and "Web App Speaker Page" now live under
    // Event Content (see above), not here.

    // -----------------------------------------------------------
    // PortalNavItems: mirrors the attendee sidebar for this event
    // -----------------------------------------------------------
    const insertPortalNav = async (key, label, opts = {}) => {
      const { icon = null, sortOrder = 0, route = null, badgeCount = null, parentId = null } = opts;
      const res = await client.query(
        `INSERT INTO "PortalNavItems" ("EventId", "ParentId", "Key", "Label", "Icon", "Route", "SortOrder", "BadgeCount")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING "PortalNavItemId"`,
        [eventId, parentId, key, label, icon, route, sortOrder, badgeCount]
      );
      return res.rows[0].PortalNavItemId;
    };

    await insertPortalNav('home', 'Home', { icon: 'Home', sortOrder: 0, route: '/home' });

    const agendaNav = await insertPortalNav('agenda', 'Agenda', { icon: 'Calendar', sortOrder: 1 });
    await insertPortalNav('agenda-sessions', 'Sessions', { icon: 'Clock', sortOrder: 0, parentId: agendaNav, route: '/agenda/sessions' });

    await insertPortalNav('attendees', 'Attendees', { icon: 'User', sortOrder: 2, route: '/attendees' });
    // badgeCount intentionally omitted here — the /nav API overrides
    // these with live counts from DiscussionTopics / PortalMessageThreads.
    await insertPortalNav('community', 'Community', { icon: 'MessageSquare', sortOrder: 3, route: '/community' });
    await insertPortalNav('messages', 'Messages', { icon: 'Mail', sortOrder: 4, route: '/messages' });
    await insertPortalNav('photos', 'Photos', { icon: 'Image', sortOrder: 5, route: '/photos' });
    await insertPortalNav('sponsors', 'Sponsors', { icon: 'Star', sortOrder: 6, route: '/sponsors' });
    await insertPortalNav('leaderboard', 'Leaderboard', { icon: 'Trophy', sortOrder: 7, route: '/leaderboard' });

    const resources = await insertPortalNav('resources', 'Resources', { icon: 'Folder', sortOrder: 8 });
    const resourceItems = [
      ['session-qa', 'Session Q&A', 'MessageCircle'],
      ['recordings', 'Recordings', 'Video'],
      ['floormap', 'Floormap', 'Map'],
      ['logistics', 'Logistics', 'Truck'],
      ['instagram', 'Instagram', 'Instagram'],
      ['documents', 'Documents', 'FileText'],
      ['polls', 'Polls', 'BarChart2'],
      ['surveys', 'Surveys', 'ClipboardList'],
      ['twitter', 'Twitter', 'Twitter'],
      ['confera-guides', 'Confera Guides', 'Compass'],
    ];
    for (let i = 0; i < resourceItems.length; i++) {
      const [key, label, icon] = resourceItems[i];
      await insertPortalNav(`resources-${key}`, label, { icon, sortOrder: i, parentId: resources });
    }

    const myStuff = await insertPortalNav('my-stuff', 'My Stuff', { icon: 'Users', sortOrder: 9 });
    await insertPortalNav('my-agenda', 'My Agenda', { icon: 'Calendar', sortOrder: 0, parentId: myStuff, route: '/my-stuff/agenda' });
    await insertPortalNav('my-notes', 'My Notes', { icon: 'Edit3', sortOrder: 1, parentId: myStuff, route: '/my-stuff/notes' });
    await insertPortalNav('profile', 'Profile', { icon: 'User', sortOrder: 2, parentId: myStuff, route: '/my-stuff/profile' });

    await insertPortalNav('feedback-to-confera', 'Feedback to Confera', { icon: 'MessageCircle', sortOrder: 10, route: '/feedback' });
    await insertPortalNav('organizer-tips', 'Organizer Tips', { icon: 'Lightbulb', sortOrder: 11, route: '/organizer-tips' });

    await client.query('COMMIT');
    console.log(`Seeded ${process.env.PGDATABASE || 'Confera'} (real schema) with initial demo data.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
