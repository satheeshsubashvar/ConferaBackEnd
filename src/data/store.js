import { pool } from './db.js';
import { seedIfEmpty } from './seed.js';
import { sendPortalInviteIfNeeded } from '../utils/portalInvite.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Data layer for the REAL schema: original 72-table Confera.sql +
// 32 multi-tenancy/feature migrations + AdminNavItems/PortalNavItems.
// Person, Organizations, OrganizationUsers, Event, EventParticipant,
// SponsorProfile, Sessions, SpeakerProfile are all the actual
// production tables — nothing here duplicates or shadows them.

export async function initDatabase() {
  await seedIfEmpty();
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const portalSql = fs.readFileSync(path.join(__dirname, 'add_portal_messages.sql'), 'utf8');
  await pool.query(portalSql);
  const personalFeaturesSql = fs.readFileSync(path.join(__dirname, 'add_portal_personal_features.sql'), 'utf8');
  await pool.query(personalFeaturesSql);
  const requestedModulesSql = fs.readFileSync(path.join(__dirname, 'add_requested_admin_modules.sql'), 'utf8');
  await pool.query(requestedModulesSql);
  const emsModulesSql = fs.readFileSync(path.join(__dirname, 'add_ems_module_records.sql'), 'utf8');
  await pool.query(emsModulesSql);
  const analyticsSql = fs.readFileSync(path.join(__dirname, 'add_event_analytics.sql'), 'utf8');
  await pool.query(analyticsSql);
  const socialMediaNavSql = fs.readFileSync(path.join(__dirname, 'add_social_media_center_nav.sql'), 'utf8');
  await pool.query(socialMediaNavSql);
  const loginBannerSql = fs.readFileSync(path.join(__dirname, 'add_login_banner_settings.sql'), 'utf8');
  await pool.query(loginBannerSql);
  const realtimeSql = fs.readFileSync(path.join(__dirname, 'add_portal_realtime_features.sql'), 'utf8');
  await pool.query(realtimeSql);
  const emailVerificationSql = fs.readFileSync(path.join(__dirname, 'add_email_verification.sql'), 'utf8');
  await pool.query(emailVerificationSql);
  const passwordResetSql = fs.readFileSync(path.join(__dirname, 'add_password_reset.sql'), 'utf8');
  await pool.query(passwordResetSql);
}

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------

export async function findUserByEmail(email) {
  const { rows } = await pool.query(
    'SELECT * FROM "Person" WHERE lower("Email") = lower($1)',
    [email]
  );
  return rows[0] || null;
}

// A Portal attendee is a Person with an EventParticipant row
// (Role='Attendee') for the given event — not a separate account
// table. This mirrors the real schema, which has no standalone
// "Attendees" table.
// Portal login covers Attendee, Speaker, and Sponsor participants (not
// just literal 'Attendee' rows) — the Portal has dedicated Speaker and
// Sponsor experiences (speaker profile pages, sponsor chat), so all
// three registered-participant roles need to be able to sign in here.
// Organizers/admins use the separate Admin login (/api/auth), and
// Exhibitors aren't part of this event's seed data yet.
export async function findAttendeeByEmail(email, eventId) {
  const { rows } = await pool.query(
    `SELECT p.*, ep."EventParticipantId", ep."EventId", ep."Status" AS "ParticipantStatus", ep."Role" AS "ParticipantRole"
     FROM "Person" p
     JOIN "EventParticipant" ep ON ep."PersonId" = p."PersonId"
     WHERE lower(p."Email") = lower($1) AND ep."EventId" = $2 AND ep."Role" IN ('Attendee','Speaker','Sponsor','Exhibitor')
     LIMIT 1`,
    [email, eventId]
  );
  return rows[0] || null;
}

// Powers the Portal's "which event am I part of?" entry point (see
// routes/portalAuth.js POST /find-events) — the reason a shared,
// organizer-agnostic /login screen no longer needs a hardcoded
// VITE_DEFAULT_EVENT_ID to guess which event's branding to show. Given
// just an email, this returns every event that email can actually sign
// into: as a registered participant (Attendee/Speaker/Sponsor/
// Exhibitor) of a *published* event — a Draft event isn't public yet,
// so it's excluded here the same way GET /api/public/events/:id
// excludes it — or as the organizer/owner of an event under their own
// organization, in ANY status, since previewing your own not-yet-
// published event is the whole point of that relationship.
export async function findEventsForEmail(email) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (e."EventId")
       e."EventId" AS id, e."Title" AS name, e."StartDate", e."EndDate",
       e."Status", e."LogoUrl" AS "EventLogoUrl", e."BannerImageUrl",
       ab."LogoUrl" AS "BrandLogoUrl", ab."PrimaryColor", ab."SecondaryColor"
     FROM "Event" e
     LEFT JOIN "AppBrandings" ab ON ab."EventId" = e."EventId"
     WHERE e."IsDeleted" = false
       AND (
         e."EventId" IN (
           SELECT ep."EventId" FROM "EventParticipant" ep
           JOIN "Person" p ON p."PersonId" = ep."PersonId"
           WHERE lower(p."Email") = lower($1)
             AND ep."Role" IN ('Attendee','Speaker','Sponsor','Exhibitor')
             AND e."Status" = 'Published'
         )
         OR e."EventId" IN (
           SELECT e2."EventId" FROM "Event" e2
           JOIN "OrganizationUsers" ou ON ou."OrganizationId" = e2."OrganizationId"
           JOIN "Person" p2 ON p2."PersonId" = ou."PersonId"
           WHERE lower(p2."Email") = lower($1) AND ou."Status" = 'Active'
         )
       )
     ORDER BY e."EventId", e."StartDate" DESC NULLS LAST`,
    [email]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    startDate: r.StartDate,
    endDate: r.EndDate,
    status: r.Status,
    logoUrl: r.BrandLogoUrl || r.EventLogoUrl || '',
    heroImageUrl: r.BannerImageUrl || '',
    colorFrom: r.PrimaryColor || '#7c3aed',
    colorTo: r.SecondaryColor || '#4c1d95',
  }));
}

// Self-registration from the Portal's "Sign up here" (see
// routes/portalAuth.js POST /register and SignUpPage.jsx). Unlike
// every other way a Person gets added to an event — Attendees page,
// Speaker/Sponsor/Exhibitor Center, any Excel import — this person is
// choosing their own password right now, so there's no placeholder
// hash and no invite email to send; createSpeaker/createSponsor/
// createExhibitor are still reused for the Speaker/Sponsor/Exhibitor
// branches (so the resulting rows are identical to an organizer-added
// one, including the SpeakerProfile/SponsorProfile/ExhibitorProfile
// row those need to actually show up anywhere), just with their
// invite email suppressed and the real password swapped in right after.
export async function registerPortalParticipant({ eventId, role, email, passwordHash, firstName, lastName, company, jobTitle }) {
  const normalizedEmail = String(email).trim().toUpperCase();

  const { rows: dupRows } = await pool.query(
    `SELECT ep."EventParticipantId" FROM "EventParticipant" ep
     JOIN "Person" p ON p."PersonId" = ep."PersonId"
     WHERE ep."EventId" = $1 AND p."NormalizedEmail" = $2 AND ep."IsDeleted" = false
       AND ep."Role" IN ('Attendee','Speaker','Sponsor','Exhibitor')
     LIMIT 1`,
    [eventId, normalizedEmail]
  );
  if (dupRows.length) {
    const err = new Error("You're already registered for this event. Try signing in instead.");
    err.status = 409;
    throw err;
  }

  const { rows: existingPersonRows } = await pool.query(
    'SELECT "PersonId", "PasswordHash" FROM "Person" WHERE "NormalizedEmail" = $1',
    [normalizedEmail]
  );
  if (
    existingPersonRows.length &&
    existingPersonRows[0].PasswordHash &&
    !existingPersonRows[0].PasswordHash.startsWith('not-a-real-hash')
  ) {
    const err = new Error('An account with this email already exists. Please sign in instead.');
    err.status = 409;
    throw err;
  }

  const fullName = `${firstName} ${lastName}`.trim();

  if (role === 'Speaker') {
    await createSpeaker(eventId, { email, firstName, lastName, company, jobTitle }, { skipInvite: true });
  } else if (role === 'Sponsor') {
    await createSponsor(
      eventId,
      { contactEmail: email, contactName: fullName, companyName: company || fullName },
      { skipInvite: true }
    );
  } else if (role === 'Exhibitor') {
    await createExhibitor(
      eventId,
      { contactEmail: email, contactName: fullName, company: company || fullName },
      { skipInvite: true }
    );
  } else {
    // Attendee — no dedicated profile table, just Person +
    // EventParticipant, mirroring routes/attendees.js's own POST /.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let personId;
      // "FullName" is a generated/computed column (derived from
      // FirstName + LastName by the database itself) — Postgres
      // rejects any INSERT/UPDATE that names it explicitly with
      // "cannot insert a non-DEFAULT value into column". Never include
      // it in a write; the `fullName` local var above is still used
      // for the EventParticipant insert's registration code and the
      // invite email below.
      if (existingPersonRows.length) {
        personId = existingPersonRows[0].PersonId;
        await client.query(
          `UPDATE "Person" SET "FirstName" = $2, "LastName" = $3,
             "Company" = COALESCE($4, "Company"), "JobTitle" = COALESCE($5, "JobTitle"),
             "UpdatedAt" = (now() AT TIME ZONE 'utc')
           WHERE "PersonId" = $1`,
          [personId, firstName, lastName, company || null, jobTitle || null]
        );
      } else {
        const { rows } = await client.query(
          `INSERT INTO "Person" ("Email", "NormalizedEmail", "PasswordHash", "FirstName", "LastName", "Company", "JobTitle")
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING "PersonId"`,
          [email, normalizedEmail, 'not-a-real-hash-self-registered', firstName, lastName, company || null, jobTitle || null]
        );
        personId = rows[0].PersonId;
      }
      await client.query(
        `INSERT INTO "EventParticipant" ("EventId", "PersonId", "Role", "Company", "JobTitle", "RegistrationCode", "Status")
         VALUES ($1,$2,'Attendee',$3,$4,$5,'Pending')`,
        [eventId, personId, company || null, jobTitle || null, `ATT-${Date.now()}`]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  const { rows: personRows } = await pool.query(
    'SELECT "PersonId" FROM "Person" WHERE "NormalizedEmail" = $1',
    [normalizedEmail]
  );
  const personId = personRows[0].PersonId;
  await pool.query(
    `UPDATE "Person" SET "PasswordHash" = $2, "PasswordResetToken" = NULL, "PasswordResetExpiresAt" = NULL
     WHERE "PersonId" = $1`,
    [personId, passwordHash]
  );

  return { personId, role };
}

// Organizers don't have an EventParticipant row (they own/manage the
// event via OrganizationUsers, not attend it as a participant), but
// the Portal login should still admit them — e.g. to preview the
// attendee experience for their own event. Matched by the event's
// owning OrganizationId rather than a per-event participant row.
export async function findOrganizerByEmailForEvent(email, eventId) {
  const { rows } = await pool.query(
    `SELECT p.*, ou."OrganizationUserId", ou."OrganizationId"
     FROM "Person" p
     JOIN "OrganizationUsers" ou ON ou."PersonId" = p."PersonId"
     JOIN "Event" e ON e."OrganizationId" = ou."OrganizationId"
     WHERE lower(p."Email") = lower($1) AND e."EventId" = $2 AND ou."Status" = 'Active'
     LIMIT 1`,
    [email, eventId]
  );
  return rows[0] || null;
}

// Turns "Bright Meetups & Co." into "bright-meetups-co" and, if that
// slug is already taken, "bright-meetups-co-2", "-3", etc. Mirrors the
// unique Organizations.Slug constraint set up by the seed data.
async function uniqueOrganizationSlug(client, name) {
  const base = String(name || 'organization')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'organization';

  let slug = base;
  let suffix = 2;
  // Small table, small loop — a handful of iterations at most in
  // practice. Simpler and safer than a racy "generate and hope".
  while (true) {
    const { rowCount } = await client.query('SELECT 1 FROM "Organizations" WHERE "Slug" = $1', [slug]);
    if (!rowCount) return slug;
    slug = `${base}-${suffix++}`;
  }
}

// Creates a brand-new Organization owned by a brand-new Person, in one
// transaction — this is what "Create Organizer Account" does. The
// caller (the /api/auth/register route) is responsible for hashing
// the password and generating the verification token; this function
// just persists what it's given.
export async function registerOrganizer({
  email,
  passwordHash,
  firstName,
  lastName,
  organizationName,
  verificationToken,
  verificationExpiresAt,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const normalizedEmail = String(email).trim().toUpperCase();
    const existing = await client.query('SELECT "PersonId" FROM "Person" WHERE "NormalizedEmail" = $1', [normalizedEmail]);
    if (existing.rowCount) {
      const err = new Error('An account with this email already exists.');
      err.status = 409;
      throw err;
    }

    const personRes = await client.query(
      `INSERT INTO "Person"
         ("Email", "NormalizedEmail", "PasswordHash", "FirstName", "LastName",
          "EmailVerifiedAt", "EmailVerificationToken", "EmailVerificationExpiresAt")
       VALUES ($1,$2,$3,$4,$5, NULL, $6, $7)
       RETURNING "PersonId"`,
      [String(email).trim(), normalizedEmail, passwordHash, firstName, lastName, verificationToken, verificationExpiresAt]
    );
    const personId = personRes.rows[0].PersonId;

    const slug = await uniqueOrganizationSlug(client, organizationName);
    const orgRes = await client.query(
      `INSERT INTO "Organizations" ("Name", "Slug", "OwnerPersonId")
       VALUES ($1, $2, $3) RETURNING "OrganizationId"`,
      [organizationName, slug, personId]
    );
    const organizationId = orgRes.rows[0].OrganizationId;

    // "Owner" is the global system role seeded by migration 001
    // (OrganizationId IS NULL) — same lookup seed.js uses.
    const ownerRoleRes = await client.query(
      `SELECT "RoleId" FROM "OrganizationRoles" WHERE "Name" = 'Owner' AND "OrganizationId" IS NULL LIMIT 1`
    );
    if (!ownerRoleRes.rowCount) {
      throw new Error('OrganizationRoles has no global "Owner" role. Has migration 001_multi_tenancy.sql been applied?');
    }
    const ownerRoleId = ownerRoleRes.rows[0].RoleId;

    await client.query(
      `INSERT INTO "OrganizationUsers" ("OrganizationId", "PersonId", "RoleId", "Status", "JoinedAt")
       VALUES ($1, $2, $3, 'Active', now())`,
      [organizationId, personId, ownerRoleId]
    );

    await client.query('COMMIT');
    return { personId, organizationId, slug };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function findPersonByVerificationToken(token) {
  const { rows } = await pool.query(
    'SELECT * FROM "Person" WHERE "EmailVerificationToken" = $1',
    [token]
  );
  return rows[0] || null;
}

export async function markEmailVerified(personId) {
  await pool.query(
    `UPDATE "Person"
     SET "EmailVerifiedAt" = now(), "EmailVerificationToken" = NULL, "EmailVerificationExpiresAt" = NULL
     WHERE "PersonId" = $1`,
    [personId]
  );
}

export async function setEmailVerificationToken(personId, token, expiresAt) {
  await pool.query(
    `UPDATE "Person"
     SET "EmailVerificationToken" = $2, "EmailVerificationExpiresAt" = $3
     WHERE "PersonId" = $1`,
    [personId, token, expiresAt]
  );
}

// Forgot/set-password — shared by every account type (Organizer,
// Attendee, Speaker, Sponsor, Exhibitor) since PasswordHash lives on
// the one shared Person table. See add_password_reset.sql for why
// this exists.
export async function setPasswordResetToken(personId, token, expiresAt) {
  await pool.query(
    `UPDATE "Person" SET "PasswordResetToken" = $2, "PasswordResetExpiresAt" = $3 WHERE "PersonId" = $1`,
    [personId, token, expiresAt]
  );
}

export async function findPersonByPasswordResetToken(token) {
  const { rows } = await pool.query('SELECT * FROM "Person" WHERE "PasswordResetToken" = $1', [token]);
  return rows[0] || null;
}

export async function resetPersonPassword(personId, passwordHash) {
  await pool.query(
    `UPDATE "Person"
     SET "PasswordHash" = $2, "PasswordResetToken" = NULL, "PasswordResetExpiresAt" = NULL,
         "UpdatedAt" = (now() AT TIME ZONE 'utc')
     WHERE "PersonId" = $1`,
    [personId, passwordHash]
  );
}

export async function getOrganizationForPerson(personId) {
  const { rows } = await pool.query(
    'SELECT "OrganizationId" FROM "OrganizationUsers" WHERE "PersonId" = $1 LIMIT 1',
    [personId]
  );
  return rows[0]?.OrganizationId || null;
}

// ---------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------

export async function getEventsForOrg(organizationId) {
  const { rows } = await pool.query(
    'SELECT * FROM "Event" WHERE "OrganizationId" = $1 AND "IsDeleted" = false ORDER BY "StartDate" DESC',
    [organizationId]
  );
  return rows;
}

export async function getEventById(eventId) {
  const { rows } = await pool.query(
    'SELECT * FROM "Event" WHERE "EventId" = $1 AND "IsDeleted" = false',
    [eventId]
  );
  return rows[0] || null;
}

export async function createEvent(organizationId, ownerId, payload) {
  const slug = (payload.name || 'untitled-event')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const eventCode = (payload.shortCode || slug.slice(0, 10)).toUpperCase();

  const { rows } = await pool.query(
    `INSERT INTO "Event" (
      "EventCode", "Title", "Slug", "Description", "Status",
      "StartDate", "EndDate", "VenueName", "VenueAddress", "VenueCity",
      "VenueCountry", "MaxAttendees", "WebsiteUrl", "LogoUrl",
      "BannerImageUrl", "OwnerId", "OrganizationId"
    ) VALUES (
      $1,$2,$3,$4,'Draft',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
    ) RETURNING *`,
    [
      eventCode,
      payload.name || 'Untitled Event',
      slug,
      payload.description || null,
      payload.startDate || new Date(),
      payload.endDate || new Date(),
      payload.venueName || null,
      payload.venueAddress || null,
      payload.city || null,
      payload.country || null,
      payload.numberOfAttendees || null,
      payload.website || null,
      payload.logoUrl || null,
      payload.heroImageUrl || null,
      ownerId,
      organizationId,
    ]
  );
  return rows[0];
}

// Maps this app's camelCase patch fields to the real Event columns.
const UPDATABLE_EVENT_FIELDS = {
  name: 'Title',
  shortCode: 'EventCode',
  shortDescription: 'ShortDescription',
  status: 'Status',
  startDate: 'StartDate',
  endDate: 'EndDate',
  timeZone: 'TimeZone',
  numberOfAttendees: 'MaxAttendees',
  venueName: 'VenueName',
  venueAddress: 'VenueAddress',
  city: 'VenueCity',
  state: 'VenueState',
  postalCode: 'VenuePostalCode',
  country: 'VenueCountry',
  website: 'WebsiteUrl',
  description: 'Description',
  welcomeMessage: 'WelcomeMessage',
  twitterHashtag: 'TwitterHashtag',
  eventTypeId: 'EventTypeId',
  logoUrl: 'LogoUrl',
  heroImageUrl: 'BannerImageUrl',
  // brandColorFrom/brandColorTo/tagline live in AppBrandings, not
  // Event — see upsertBrandingForEvent. startTime/endTime have no
  // direct column; StartDate/EndDate are full timestamps that already
  // carry a time component, so no separate time-only fields exist.
};

export async function updateEvent(eventId, patch) {
  const entries = Object.entries(patch).filter(([k]) => UPDATABLE_EVENT_FIELDS[k]);
  if (entries.length === 0) return getEventById(eventId);

  const setClauses = entries.map(([k], i) => `"${UPDATABLE_EVENT_FIELDS[k]}" = $${i + 2}`);
  const values = entries.map(([, v]) => v);

  const { rows } = await pool.query(
    `UPDATE "Event" SET ${setClauses.join(', ')}, "UpdatedAt" = (now() AT TIME ZONE 'utc')
     WHERE "EventId" = $1 RETURNING *`,
    [eventId, ...values]
  );
  return rows[0] || null;
}

export async function getPublishedEvents() {
  const { rows } = await pool.query(
    `SELECT * FROM "Event" WHERE "Status" = 'Published' AND "IsDeleted" = false`
  );
  return rows;
}

export async function getEventTypes() {
  const { rows } = await pool.query(
    'SELECT * FROM "EventTypes" WHERE "IsActive" = true ORDER BY "Name" ASC'
  );
  return rows;
}

// ---------------------------------------------------------------------
// App Branding — the real schema already has a dedicated table for
// this (AppBrandings: TagLine, PrimaryColor, SecondaryColor, LogoUrl),
// one row per event. Upserted since an event may not have a branding
// row yet on first save.
// ---------------------------------------------------------------------

export async function getBrandingForEvent(eventId) {
  const { rows } = await pool.query(
    'SELECT * FROM "AppBrandings" WHERE "EventId" = $1 LIMIT 1',
    [eventId]
  );
  return rows[0] || null;
}

export async function upsertBrandingForEvent(eventId, eventTitle, patch) {
  const existing = await getBrandingForEvent(eventId);

  if (!existing) {
    const { rows } = await pool.query(
      `INSERT INTO "AppBrandings" (
        "EventId", "AppName", "TagLine", "LogoUrl", "PrimaryColor", "SecondaryColor"
      ) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        eventId,
        eventTitle,
        patch.tagline || null,
        patch.logoUrl || null,
        patch.brandColorFrom || '#7c3aed',
        patch.brandColorTo || '#4c1d95',
      ]
    );
    return rows[0];
  }

  const fieldMap = {
    tagline: 'TagLine',
    logoUrl: 'LogoUrl',
    brandColorFrom: 'PrimaryColor',
    brandColorTo: 'SecondaryColor',
  };
  const entries = Object.entries(patch).filter(([k]) => fieldMap[k] && patch[k] !== undefined);
  if (entries.length === 0) return existing;

  const setClauses = entries.map(([k], i) => `"${fieldMap[k]}" = $${i + 2}`);
  const values = entries.map(([, v]) => v);

  const { rows } = await pool.query(
    `UPDATE "AppBrandings" SET ${setClauses.join(', ')}, "UpdatedAt" = (now() AT TIME ZONE 'utc')
     WHERE "EventId" = $1 RETURNING *`,
    [eventId, ...values]
  );
  return rows[0];
}

// ---------------------------------------------------------------------
// Sponsors / Sessions / Speakers / Attendees — all derived from
// EventParticipant, matching the real schema's participant model.
// ---------------------------------------------------------------------

export async function getSponsorsForEvent(eventId) {
  // "VisitCount" used to be a live COUNT(*) against a "BoothVisits"
  // table — a booth-analytics feature that was apparently planned but
  // never actually built: no migration anywhere in data/*.sql ever
  // creates that table, so this query has been throwing "relation
  // "BoothVisits" does not exist" (a 500) on every single Sponsor
  // Center page load. Nothing in the Admin UI even reads VisitCount
  // yet, so it's hardcoded to 0 here until the booth-visit tracking
  // feature (and its table) actually exists.
  const { rows } = await pool.query(
    `SELECT sp.*, st."Name" AS "TierName", ep."EventId", ep."PersonId" AS "ContactPersonId",
            0 AS "VisitCount"
     FROM "SponsorProfile" sp
     JOIN "EventParticipant" ep ON ep."EventParticipantId" = sp."EventParticipantId"
     LEFT JOIN "SponsorTiers" st ON st."TierId" = sp."TierId"
     WHERE ep."EventId" = $1 AND sp."IsDeleted" = false
     ORDER BY sp."SortOrder" ASC, sp."CreatedAt" ASC`,
    [eventId]
  );
  return rows;
}


// Sponsor tiers are one global lookup table with no admin UI to manage
// it yet — "Sponsor Tiering" in the sidebar is still a placeholder
// page. Historically the only row was a "Gold" tier created
// defensively by seed.js's demo data, which is why the "New Sponsor"
// tier dropdown only ever showed "Gold". Every read here makes sure
// the standard Platinum/Gold/Silver/Bronze set exists (matched
// case-insensitively by name, so it never duplicates a tier an admin
// already created) until a real management page exists.
const DEFAULT_SPONSOR_TIERS = [
  { name: 'Platinum', sortOrder: 10 },
  { name: 'Gold', sortOrder: 20 },
  { name: 'Silver', sortOrder: 30 },
  { name: 'Bronze', sortOrder: 40 },
];

async function ensureDefaultSponsorTiers() {
  for (const tier of DEFAULT_SPONSOR_TIERS) {
    await pool.query(
      `INSERT INTO "SponsorTiers" ("Name","SortOrder")
       SELECT $1,$2 WHERE NOT EXISTS (
         SELECT 1 FROM "SponsorTiers" WHERE LOWER("Name")=LOWER($1) AND "IsDeleted"=false
       )`,
      [tier.name, tier.sortOrder]
    );
    await pool.query(
      `UPDATE "SponsorTiers" SET "SortOrder"=$2 WHERE LOWER("Name")=LOWER($1) AND "IsDeleted"=false`,
      [tier.name, tier.sortOrder]
    );
  }
}

export async function getSponsorTiers() {
  await ensureDefaultSponsorTiers();
  const { rows } = await pool.query(
    'SELECT * FROM "SponsorTiers" WHERE "IsDeleted" = false ORDER BY "SortOrder" ASC, "Name" ASC'
  );
  return rows;
}

export async function getSponsorById(sponsorProfileId) {
  const { rows } = await pool.query(
    `SELECT ep."EventId", ep."EventParticipantId", sp.*, st."Name" AS "TierName"
     FROM "SponsorProfile" sp
     JOIN "EventParticipant" ep ON ep."EventParticipantId" = sp."EventParticipantId"
     LEFT JOIN "SponsorTiers" st ON st."TierId" = sp."TierId"
     WHERE sp."SponsorProfileId" = $1`,
    [sponsorProfileId]
  );
  return rows[0] || null;
}

const SPONSOR_FIELD_MAP = {
  companyName: 'CompanyName', description: 'Description', logoUrl: 'LogoUrl',
  bannerUrl: 'BannerUrl', websiteUrl: 'WebsiteUrl', contactEmail: 'ContactEmail',
  contactName: 'ContactName', contactPhone: 'ContactPhone', videoUrl: 'VideoUrl',
  videoThumbnailUrl: 'VideoThumbnailUrl', videoEmbedCode: 'VideoEmbedCode', linkedInUrl: 'LinkedInUrl',
  twitterHandle: 'TwitterHandle', tierId: 'TierId', isPublished: 'IsPublished',
  sortOrder: 'SortOrder', sponsorPackageId: 'SponsorPackageId',
};

async function findOrCreateSponsorContact(client, email, contactName) {
  const normalizedEmail = String(email || '').trim().toUpperCase();
  if (!normalizedEmail) throw new Error('Sponsor contact email is required.');

  const { rows: existingRows } = await client.query(
    'SELECT "PersonId", "PasswordHash" FROM "Person" WHERE "NormalizedEmail" = $1 LIMIT 1',
    [normalizedEmail]
  );
  if (existingRows.length) {
    return { personId: existingRows[0].PersonId, passwordHash: existingRows[0].PasswordHash, isNew: false };
  }

  const nameParts = (contactName || 'Sponsor Contact').trim().split(/\s+/);
  const firstName = nameParts[0] || 'Sponsor';
  const lastName = nameParts.slice(1).join(' ') || 'Contact';
  const { rows } = await client.query(
    `INSERT INTO "Person" ("Email","NormalizedEmail","PasswordHash","FirstName","LastName")
     VALUES ($1,$2,$3,$4,$5) RETURNING "PersonId", "PasswordHash"`,
    [String(email).trim(), normalizedEmail, 'not-a-real-hash-sponsor-manager-created', firstName, lastName]
  );
  return { personId: rows[0].PersonId, passwordHash: rows[0].PasswordHash, isNew: true };
}

export async function createSponsor(eventId, payload, options = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { personId, passwordHash } = await findOrCreateSponsorContact(client, payload.contactEmail, payload.contactName);
    const regCode = `SPN-${Date.now()}`;
    const { rows: participantRows } = await client.query(
      `INSERT INTO "EventParticipant" ("EventId","PersonId","Role","RegistrationCode")
       VALUES ($1,$2,'Sponsor',$3) RETURNING "EventParticipantId"`,
      [eventId, personId, regCode]
    );
    const participantId = participantRows[0].EventParticipantId;

    const entries = Object.entries(payload)
      .filter(([k]) => SPONSOR_FIELD_MAP[k] && payload[k] !== undefined);
    const columns = ['EventParticipantId', ...entries.map(([k]) => SPONSOR_FIELD_MAP[k])];
    const values = [participantId, ...entries.map(([, v]) => v === '' ? null : v)];
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const { rows } = await client.query(
      `INSERT INTO "SponsorProfile" (${columns.map((c) => `"${c}"`).join(', ')})
       VALUES (${placeholders.join(', ')}) RETURNING "SponsorProfileId"`,
      values
    );

    await client.query('COMMIT');
    if (!options.skipInvite) {
      // Fire-and-forget: a bulk Excel import calls this once per row, and
      // now that real SMTP is configured, each send is a genuine network
      // round-trip to Gmail (hundreds of ms to a few seconds). Awaiting it
      // here made "Import Sponsors" visibly crawl on any file with more
      // than a handful of rows. sendPortalInviteIfNeeded never throws
      // (see its own try/catch), so nothing is lost by not waiting on it —
      // the created sponsor is returned immediately and the invite email
      // goes out in the background.
      sendPortalInviteIfNeeded({
        personId, email: payload.contactEmail, fullName: payload.contactName,
        passwordHash, eventId,
      }).catch(() => {});
    }
    return getSponsorById(rows[0].SponsorProfileId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateSponsor(sponsorProfileId, payload) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entries = Object.entries(payload)
      .filter(([k]) => SPONSOR_FIELD_MAP[k] && payload[k] !== undefined);

    if (entries.length) {
      const setClauses = entries.map(([k], i) => `"${SPONSOR_FIELD_MAP[k]}" = $${i + 2}`);
      const values = entries.map(([, v]) => v === '' ? null : v);
      await client.query(
        `UPDATE "SponsorProfile"
         SET ${setClauses.join(', ')}, "UpdatedAt" = (now() AT TIME ZONE 'utc'), "RowVersion" = "RowVersion" + 1
         WHERE "SponsorProfileId" = $1`,
        [sponsorProfileId, ...values]
      );
    }

    if (payload.contactEmail !== undefined || payload.contactName !== undefined) {
      const { rows } = await client.query(
        `SELECT ep."EventParticipantId", p."PersonId"
         FROM "SponsorProfile" sp
         JOIN "EventParticipant" ep ON ep."EventParticipantId" = sp."EventParticipantId"
         JOIN "Person" p ON p."PersonId" = ep."PersonId"
         WHERE sp."SponsorProfileId" = $1`,
        [sponsorProfileId]
      );
      if (rows.length) {
        const personId = rows[0].PersonId;
        const updates = [];
        const vals = [];
        if (payload.contactEmail !== undefined) {
          updates.push(`"Email" = $2`, `"NormalizedEmail" = $3`);
          vals.push(String(payload.contactEmail || '').trim(), String(payload.contactEmail || '').trim().toUpperCase());
        }
        if (payload.contactName !== undefined) {
          const parts = String(payload.contactName || '').trim().split(/\s+/);
          updates.push(`"FirstName" = $${vals.length + 2}`, `"LastName" = $${vals.length + 3}`);
          vals.push(parts[0] || 'Sponsor', parts.slice(1).join(' ') || 'Contact');
        }
        if (updates.length) {
          await client.query(`UPDATE "Person" SET ${updates.join(', ')} WHERE "PersonId" = $1`, [personId, ...vals]);
        }
      }
    }

    await client.query('COMMIT');
    return getSponsorById(sponsorProfileId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteSponsor(sponsorProfileId) {
  const { rows } = await pool.query(
    `UPDATE "SponsorProfile"
     SET "IsDeleted" = true, "DeletedAt" = (now() AT TIME ZONE 'utc'), "UpdatedAt" = (now() AT TIME ZONE 'utc')
     WHERE "SponsorProfileId" = $1
     RETURNING "SponsorProfileId"`,
    [sponsorProfileId]
  );
  return rows.length > 0;
}

export async function getSessionQAForEvent(eventId) {
  const { rows } = await pool.query(
    `SELECT q.*, s."Title" AS "SessionTitle", s."StartTime", s."EndTime",
            p."FirstName" AS "AskedFirstName", p."LastName" AS "AskedLastName",
            p."FullName" AS "AskedFullName", p."Email" AS "AskedEmail",
            ap."FullName" AS "AnsweredFullName"
     FROM "SessionQA" q
     JOIN "Sessions" s ON s."SessionId" = q."SessionId"
     JOIN "Person" p ON p."PersonId" = q."AskedByPersonId"
     LEFT JOIN "Person" ap ON ap."PersonId" = q."AnsweredByPersonId"
     WHERE s."EventId" = $1 AND q."IsDeleted" = false
     ORDER BY q."IsPinned" DESC, q."CreatedAt" DESC`,
    [eventId]
  );
  return rows;
}

export async function getSessionQAById(questionId) {
  const { rows } = await pool.query(
    `SELECT q.*, s."EventId"
     FROM "SessionQA" q JOIN "Sessions" s ON s."SessionId" = q."SessionId"
     WHERE q."QuestionId" = $1`,
    [questionId]
  );
  return rows[0] || null;
}

export async function updateSessionQA(questionId, patch) {
  const fieldMap = {
    isApproved: 'IsApproved',
    isPinned: 'IsPinned',
    status: 'Status',
    answerText: 'AnswerText',
    isAnswered: 'IsAnswered',
    answeredByPersonId: 'AnsweredByPersonId',
  };
  const entries = Object.entries(patch || {}).filter(([k]) => fieldMap[k]);
  if (!entries.length) return getSessionQAById(questionId);

  const setClauses = [];
  const values = [questionId];
  entries.forEach(([k, v], i) => {
    setClauses.push(`"${fieldMap[k]}" = $${i + 2}`);
    values.push(v === '' ? null : v);
  });
  if (patch.isAnswered === true) {
    setClauses.push(`"AnsweredAt" = (now() AT TIME ZONE 'utc')`);
  } else if (patch.isAnswered === false) {
    setClauses.push(`"AnsweredAt" = NULL`);
  }
  setClauses.push(`"UpdatedAt" = (now() AT TIME ZONE 'utc')`);

  const { rows } = await pool.query(
    `UPDATE "SessionQA" SET ${setClauses.join(', ')} WHERE "QuestionId" = $1 RETURNING *`,
    values
  );
  return rows[0] || null;
}

export async function deleteSessionQA(questionId, deletedBy) {
  const { rows } = await pool.query(
    `UPDATE "SessionQA"
     SET "IsDeleted" = true, "DeletedAt" = (now() AT TIME ZONE 'utc'), "DeletedBy" = $2,
         "UpdatedAt" = (now() AT TIME ZONE 'utc')
     WHERE "QuestionId" = $1 RETURNING "QuestionId"`,
    [questionId, deletedBy || null]
  );
  return rows.length > 0;
}

const DEFAULT_WEB_PAGE_SETTINGS = {
  agenda: { enabled: true, title: 'Agenda', intro: 'Explore the event agenda and sessions.', layout: 'cards', showSearch: true, showFilters: true },
  speaker: { enabled: true, title: 'Speakers', intro: 'Meet our speakers and session experts.', layout: 'cards', showSearch: true, showFilters: false },
  sponsor: { enabled: true, title: 'Sponsors', intro: 'Our event partners and sponsors.', layout: 'cards', showSearch: false, showFilters: true },
  exhibitor: { enabled: true, title: 'Exhibitors', intro: 'Explore exhibitors and their booths.', layout: 'cards', showSearch: true, showFilters: true },
};

export async function getWebPageSettings(eventId, pageKey) {
  const theme = await getWebsiteTheme(eventId);
  let stored = {};
  if (theme?.WebPageSettingsJson) {
    try { stored = JSON.parse(theme.WebPageSettingsJson) || {}; } catch { stored = {}; }
  }
  const base = DEFAULT_WEB_PAGE_SETTINGS[pageKey] || DEFAULT_WEB_PAGE_SETTINGS.agenda;
  return { ...base, ...(stored[pageKey] || {}) };
}

export async function updateWebPageSettings(eventId, eventTitle, pageKey, patch) {
  const theme = await getWebsiteTheme(eventId);
  let stored = {};
  if (theme?.WebPageSettingsJson) {
    try { stored = JSON.parse(theme.WebPageSettingsJson) || {}; } catch { stored = {}; }
  }
  const base = DEFAULT_WEB_PAGE_SETTINGS[pageKey] || DEFAULT_WEB_PAGE_SETTINGS.agenda;
  stored[pageKey] = { ...base, ...(stored[pageKey] || {}), ...(patch || {}) };

  if (!theme) {
    const { rows } = await pool.query(
      `INSERT INTO "WebsiteThemes" ("EventId","Name","WebPageSettingsJson")
       VALUES ($1,$2,$3) RETURNING *`,
      [eventId, eventTitle || 'Event Website', JSON.stringify(stored)]
    );
    return getWebPageSettingsFromRow(rows[0], pageKey);
  }

  const { rows } = await pool.query(
    `UPDATE "WebsiteThemes"
     SET "WebPageSettingsJson" = $2, "UpdatedAt" = (now() AT TIME ZONE 'utc')
     WHERE "EventId" = $1 RETURNING *`,
    [eventId, JSON.stringify(stored)]
  );
  return getWebPageSettingsFromRow(rows[0], pageKey);
}

function getWebPageSettingsFromRow(row, pageKey) {
  let stored = {};
  if (row?.WebPageSettingsJson) {
    try { stored = JSON.parse(row.WebPageSettingsJson) || {}; } catch { stored = {}; }
  }
  const base = DEFAULT_WEB_PAGE_SETTINGS[pageKey] || DEFAULT_WEB_PAGE_SETTINGS.agenda;
  return { ...base, ...(stored[pageKey] || {}) };
}

export async function getSessionsForEvent(eventId) {
  const { rows } = await pool.query(
    'SELECT * FROM "Sessions" WHERE "EventId" = $1 AND "IsDeleted" = false ORDER BY "StartTime" ASC',
    [eventId]
  );
  return rows;
}

export async function getSessionById(sessionId) {
  const { rows } = await pool.query(
    'SELECT * FROM "Sessions" WHERE "SessionId" = $1 AND "IsDeleted" = false',
    [sessionId]
  );
  return rows[0] || null;
}

const SESSION_FIELD_MAP = {
  title: 'Title', shortDescription: 'ShortDescription', description: 'Description',
  learningObjectives: 'LearningObjectives', sessionType: 'SessionType', status: 'Status',
  startTime: 'StartTime', endTime: 'EndTime', location: 'Location',
  virtualRoomUrl: 'VirtualRoomUrl', maxAttendees: 'MaxAttendees', isLivestream: 'IsLivestream',
  isRecorded: 'IsRecorded', isOnDemand: 'IsOnDemand', recordingUrl: 'RecordingUrl',
  slideUrl: 'SlideUrl', thumbnailUrl: 'ThumbnailUrl', streamUrl: 'StreamUrl',
  streamEmbedCode: 'StreamEmbedCode', chatEnabled: 'ChatEnabled', qaEnabled: 'QaEnabled',
  pollsEnabled: 'PollsEnabled', requiresModeration: 'RequiresModeration', moderatorId: 'ModeratorId',
  tags: 'Tags', sortOrder: 'SortOrder', isPrivate: 'IsPrivate', trackId: 'TrackId', formatId: 'FormatId',
  categoryId: 'CategoryId',
};

export async function createSession(eventId, payload) {
  const entries = Object.entries(payload).filter(([k]) => SESSION_FIELD_MAP[k]);
  const columns = ['EventId', ...entries.map(([k]) => SESSION_FIELD_MAP[k])];
  const values = [eventId, ...entries.map(([, v]) => (v === '' ? null : v))];
  const placeholders = values.map((_, i) => `$${i + 1}`);

  const { rows } = await pool.query(
    `INSERT INTO "Sessions" (${columns.map((c) => `"${c}"`).join(', ')})
     VALUES (${placeholders.join(', ')}) RETURNING *`,
    values
  );
  return rows[0];
}

export async function updateSession(sessionId, patch) {
  const entries = Object.entries(patch).filter(([k]) => SESSION_FIELD_MAP[k]);
  if (entries.length === 0) return getSessionById(sessionId);

  const setClauses = entries.map(([k], i) => `"${SESSION_FIELD_MAP[k]}" = $${i + 2}`);
  const values = entries.map(([, v]) => (v === '' ? null : v));

  const { rows } = await pool.query(
    `UPDATE "Sessions" SET ${setClauses.join(', ')}, "UpdatedAt" = (now() AT TIME ZONE 'utc')
     WHERE "SessionId" = $1 RETURNING *`,
    [sessionId, ...values]
  );
  return rows[0] || null;
}

export async function deleteSession(sessionId) {
  // Soft delete — matches the real schema's IsDeleted column pattern
  // used across the base tables, rather than a hard DELETE.
  const { rows } = await pool.query(
    `UPDATE "Sessions" SET "IsDeleted" = true, "UpdatedAt" = (now() AT TIME ZONE 'utc')
     WHERE "SessionId" = $1 RETURNING "SessionId"`,
    [sessionId]
  );
  return rows.length > 0;
}

// Duplicate: copies every real, mappable Sessions column (via the
// same SESSION_FIELD_MAP used for create/update) into a new row,
// appends " (Copy)" to the title — matching the reference's "Welcome
// Address COPY" naming. Sub-resources (speakers, documents, polls,
// streams, sponsors, tags, authors) are intentionally NOT copied —
// duplicating those silently would create surprising side effects
// (e.g. two sessions sharing a live-stream URL); the organizer can
// re-add them to the copy if genuinely needed.
export async function duplicateSession(sessionId) {
  const original = await getSessionById(sessionId);
  if (!original) return null;

  const payload = {};
  for (const [camelKey, columnKey] of Object.entries(SESSION_FIELD_MAP)) {
    payload[camelKey] = original[columnKey];
  }
  payload.title = `${original.Title} (Copy)`;

  return createSession(original.EventId, payload);
}

// Swap: exchanges StartTime, EndTime, and Location between two
// sessions in the same event — the standard "swap slots" meaning in
// agenda tools, and the fields that actually determine a session's
// position on the timeline.
export async function swapSessions(sessionAId, sessionBId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: aRows } = await client.query('SELECT * FROM "Sessions" WHERE "SessionId" = $1 FOR UPDATE', [sessionAId]);
    const { rows: bRows } = await client.query('SELECT * FROM "Sessions" WHERE "SessionId" = $1 FOR UPDATE', [sessionBId]);

    if (aRows.length === 0 || bRows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const a = aRows[0];
    const b = bRows[0];

    await client.query(
      `UPDATE "Sessions" SET "StartTime" = $2, "EndTime" = $3, "Location" = $4, "UpdatedAt" = (now() AT TIME ZONE 'utc') WHERE "SessionId" = $1`,
      [sessionAId, b.StartTime, b.EndTime, b.Location]
    );
    await client.query(
      `UPDATE "Sessions" SET "StartTime" = $2, "EndTime" = $3, "Location" = $4, "UpdatedAt" = (now() AT TIME ZONE 'utc') WHERE "SessionId" = $1`,
      [sessionBId, a.StartTime, a.EndTime, a.Location]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return {
    sessionA: await getSessionById(sessionAId),
    sessionB: await getSessionById(sessionBId),
  };
}

export async function getTracksForEvent(eventId) {
  const { rows } = await pool.query(
    'SELECT * FROM "Tracks" WHERE "EventId" = $1 AND "IsActive" = true ORDER BY "SortOrder" ASC',
    [eventId]
  );
  return rows;
}

// Used by Track Manager itself, which needs to see inactive tracks
// too (to re-enable them) — unlike getTracksForEvent above, used by
// the Session Manager dropdown, which should only offer active ones.
export async function getAllTracksForEvent(eventId) {
  const { rows } = await pool.query(
    `SELECT t.*, COUNT(s."SessionId")::int AS "SessionCount"
     FROM "Tracks" t
     LEFT JOIN "Sessions" s ON s."TrackId" = t."TrackId" AND s."IsDeleted" = false
     WHERE t."EventId" = $1
     GROUP BY t."TrackId"
     ORDER BY t."SortOrder" ASC`,
    [eventId]
  );
  return rows;
}

export async function getTrackById(trackId) {
  const { rows } = await pool.query('SELECT * FROM "Tracks" WHERE "TrackId" = $1', [trackId]);
  return rows[0] || null;
}

export async function createTrack(eventId, payload) {
  const { rows: maxSortRows } = await pool.query(
    `SELECT COALESCE(MAX("SortOrder"), -1) + 1 AS next_sort FROM "Tracks" WHERE "EventId" = $1`,
    [eventId]
  );
  const nextSort = maxSortRows[0].next_sort;

  const { rows } = await pool.query(
    `INSERT INTO "Tracks" ("EventId", "Name", "Description", "Color", "Icon", "SortOrder")
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      eventId,
      payload.name,
      payload.description || null,
      payload.color || '#7c3aed',
      payload.icon || null,
      payload.sortOrder ?? nextSort,
    ]
  );
  return rows[0];
}

const TRACK_FIELD_MAP = { name: 'Name', description: 'Description', color: 'Color', icon: 'Icon', sortOrder: 'SortOrder', isActive: 'IsActive' };

export async function updateTrack(trackId, patch) {
  const entries = Object.entries(patch).filter(([k]) => TRACK_FIELD_MAP[k] && patch[k] !== undefined);
  if (entries.length === 0) return getTrackById(trackId);

  const setClauses = entries.map(([k], i) => `"${TRACK_FIELD_MAP[k]}" = $${i + 2}`);
  const values = entries.map(([, v]) => (v === '' ? null : v));

  const { rows } = await pool.query(
    `UPDATE "Tracks" SET ${setClauses.join(', ')} WHERE "TrackId" = $1 RETURNING *`,
    [trackId, ...values]
  );
  return rows[0] || null;
}

export async function deleteTrack(trackId) {
  // Hard delete is safe here — Sessions.TrackId has no ON DELETE
  // CASCADE in the real schema, so a track in use would raise a real
  // FK violation instead of silently orphaning sessions; the route
  // layer surfaces that as a clear "track is in use" error.
  const { rowCount } = await pool.query('DELETE FROM "Tracks" WHERE "TrackId" = $1', [trackId]);
  return rowCount > 0;
}

export async function reorderTracks(eventId, orderedTrackIds) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < orderedTrackIds.length; i++) {
      await client.query(
        `UPDATE "Tracks" SET "SortOrder" = $1 WHERE "TrackId" = $2 AND "EventId" = $3`,
        [i, orderedTrackIds[i], eventId]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getSessionFormats() {
  const { rows } = await pool.query('SELECT * FROM "SessionFormats" ORDER BY "Name" ASC');
  return rows;
}

export async function getSpeakersForEvent(eventId) {
  // Was previously `SELECT sp.*` with no join to Person, meaning
  // every consumer (the public speakers API, this app's own Web App
  // Speaker Page preview) got a SpeakerProfile row with no name,
  // photo, or company — genuinely unusable for display. Joining
  // Person here fixes that at the source rather than patching each
  // caller separately.
  const { rows } = await pool.query(
    `SELECT sp.*, ep."EventId",
            p."PersonId", p."FirstName", p."LastName", p."FullName",
            p."Company", p."JobTitle", p."Country",
            p."ProfilePictureUrl", p."ProfilePictureThumbnailUrl"
     FROM "SpeakerProfile" sp
     JOIN "EventParticipant" ep ON ep."EventParticipantId" = sp."EventParticipantId"
     JOIN "Person" p ON p."PersonId" = ep."PersonId"
     WHERE ep."EventId" = $1
     ORDER BY sp."SortOrder" ASC`,
    [eventId]
  );
  return rows;
}

export async function getAttendeesForEvent(eventId) {
  const { rows } = await pool.query(
    `SELECT ep.*,
            p."FirstName", p."LastName", p."FullName", p."Email",
            p."Country", p."ProfilePictureUrl", p."ProfilePictureThumbnailUrl"
     FROM "EventParticipant" ep
     JOIN "Person" p ON p."PersonId" = ep."PersonId"
     WHERE ep."EventId" = $1
       AND ep."IsDeleted" = false
     ORDER BY p."LastName" ASC NULLS LAST, p."FirstName" ASC NULLS LAST`,
    [eventId]
  );
  return rows;
}

// ---------------------------------------------------------------------
// Navigation menus (AdminNavItems / PortalNavItems — additive tables,
// see nav_tables.sql)
// ---------------------------------------------------------------------

function buildNavTree(flatRows, idKey, parentKey) {
  const byId = new Map(flatRows.map((r) => [r[idKey], { ...r, children: [] }]));
  const roots = [];
  for (const row of byId.values()) {
    if (row[parentKey]) {
      const parent = byId.get(row[parentKey]);
      if (parent) parent.children.push(row);
      else roots.push(row);
    } else {
      roots.push(row);
    }
  }
  const sortRec = (nodes) => {
    nodes.sort((a, b) => a.SortOrder - b.SortOrder);
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

export async function getAdminNavTree() {
  const { rows } = await pool.query(
    'SELECT * FROM "AdminNavItems" WHERE "IsActive" = true ORDER BY "SortOrder" ASC'
  );
  return buildNavTree(rows, 'AdminNavItemId', 'ParentId');
}

export async function getPortalNavTree(eventId) {
  const { rows } = await pool.query(
    'SELECT * FROM "PortalNavItems" WHERE "EventId" = $1 AND "IsVisible" = true ORDER BY "SortOrder" ASC',
    [eventId]
  );
  return buildNavTree(rows, 'PortalNavItemId', 'ParentId');
}

// ---------------------------------------------------------------------
// WebsiteThemes — Web App Speaker Page banner pattern + speaker card
// style (migration 015's table, extended with two columns; see
// add_speaker_page_and_resource_columns.sql). One row per event,
// upserted since an event may not have a theme row yet.
// ---------------------------------------------------------------------

export async function getWebsiteTheme(eventId) {
  const { rows } = await pool.query(
    'SELECT * FROM "WebsiteThemes" WHERE "EventId" = $1 LIMIT 1',
    [eventId]
  );
  return rows[0] || null;
}

export async function upsertWebsiteTheme(eventId, eventTitle, patch) {
  const existing = await getWebsiteTheme(eventId);

  if (!existing) {
    const { rows } = await pool.query(
      `INSERT INTO "WebsiteThemes" (
        "EventId", "Name", "SpeakerPageBannerPattern", "SpeakerCardStyle", "SpeakerGridColumns"
      ) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [
        eventId,
        eventTitle,
        patch.speakerPageBannerPattern || 'Gradient',
        patch.speakerCardStyle || 'FullWidth',
        Number(patch.speakerGridColumns) || 4,
      ]
    );
    return rows[0];
  }

  const fieldMap = {
    speakerPageBannerPattern: 'SpeakerPageBannerPattern',
    speakerCardStyle: 'SpeakerCardStyle',
    speakerGridColumns: 'SpeakerGridColumns',
  };
  const entries = Object.entries(patch).filter(([k]) => fieldMap[k] && patch[k] !== undefined);
  if (entries.length === 0) return existing;

  const setClauses = entries.map(([k], i) => `"${fieldMap[k]}" = $${i + 2}`);
  const values = entries.map(([, v]) => v);

  const { rows } = await pool.query(
    `UPDATE "WebsiteThemes" SET ${setClauses.join(', ')}, "UpdatedAt" = (now() AT TIME ZONE 'utc')
     WHERE "EventId" = $1 RETURNING *`,
    [eventId, ...values]
  );
  return rows[0];
}

// ---------------------------------------------------------------------
// Customize Resources — management of the Portal Resources submenu.
// Unlike getPortalNavTree (used by Portal's own attendee-facing nav,
// which only returns IsVisible=true items), this returns every
// resource item — including disabled ones — since the Admin
// management page needs to show/toggle them.
// ---------------------------------------------------------------------

export async function getResourceItemsForEvent(eventId) {
  const { rows } = await pool.query(
    `SELECT r.* FROM "PortalNavItems" r
     JOIN "PortalNavItems" parent ON parent."PortalNavItemId" = r."ParentId"
     WHERE r."EventId" = $1 AND parent."Key" = 'resources'
     ORDER BY r."SortOrder" ASC`,
    [eventId]
  );
  return rows;
}

async function getResourcesParentId(eventId) {
  const { rows } = await pool.query(
    `SELECT "PortalNavItemId" FROM "PortalNavItems" WHERE "EventId" = $1 AND "Key" = 'resources' LIMIT 1`,
    [eventId]
  );
  return rows[0]?.PortalNavItemId || null;
}

export async function createCustomResourceItem(eventId, { label, icon, route }) {
  const parentId = await getResourcesParentId(eventId);
  if (!parentId) {
    throw new Error('This event has no "Resources" parent nav item to attach custom resources to.');
  }

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM "PortalNavItems" WHERE "EventId" = $1 AND "ParentId" = $2 AND "IsBuiltIn" = false`,
    [eventId, parentId]
  );
  if (countRows[0].n >= 5) {
    throw new Error('Maximum 5 custom resources allowed.');
  }

  const { rows: maxSortRows } = await pool.query(
    `SELECT COALESCE(MAX("SortOrder"), -1) + 1 AS next_sort FROM "PortalNavItems" WHERE "EventId" = $1 AND "ParentId" = $2`,
    [eventId, parentId]
  );
  const nextSort = maxSortRows[0].next_sort;

  const key = `resources-custom-${Date.now()}`;
  const { rows } = await pool.query(
    `INSERT INTO "PortalNavItems" ("EventId", "ParentId", "Key", "Label", "Icon", "Route", "SortOrder", "IsBuiltIn")
     VALUES ($1,$2,$3,$4,$5,$6,$7,false) RETURNING *`,
    [eventId, parentId, key, label, icon || 'Link', route || null, nextSort]
  );
  return rows[0];
}

export async function updateResourceItem(itemId, patch) {
  const fieldMap = {
    label: 'Label',
    icon: 'Icon',
    route: 'Route',
    isVisible: 'IsVisible',
    sortOrder: 'SortOrder',
  };
  const entries = Object.entries(patch).filter(([k]) => fieldMap[k] && patch[k] !== undefined);
  if (entries.length === 0) {
    const { rows } = await pool.query('SELECT * FROM "PortalNavItems" WHERE "PortalNavItemId" = $1', [itemId]);
    return rows[0] || null;
  }

  const setClauses = entries.map(([k], i) => `"${fieldMap[k]}" = $${i + 2}`);
  const values = entries.map(([, v]) => v);

  const { rows } = await pool.query(
    `UPDATE "PortalNavItems" SET ${setClauses.join(', ')} WHERE "PortalNavItemId" = $1 RETURNING *`,
    [itemId, ...values]
  );
  return rows[0] || null;
}

export async function deleteResourceItem(itemId) {
  const { rows } = await pool.query(
    `SELECT "IsBuiltIn" FROM "PortalNavItems" WHERE "PortalNavItemId" = $1`,
    [itemId]
  );
  if (rows.length === 0) return { deleted: false, reason: 'not_found' };
  if (rows[0].IsBuiltIn) return { deleted: false, reason: 'built_in' };

  await pool.query('DELETE FROM "PortalNavItems" WHERE "PortalNavItemId" = $1', [itemId]);
  return { deleted: true };
}

export async function reorderResourceItems(eventId, orderedItemIds) {
  // Applies new SortOrder values in a single transaction so a
  // partial failure never leaves the list half-reordered.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < orderedItemIds.length; i++) {
      await client.query(
        `UPDATE "PortalNavItems" SET "SortOrder" = $1 WHERE "PortalNavItemId" = $2 AND "EventId" = $3`,
        [i, orderedItemIds[i], eventId]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------
// Session Speakers: SessionSpeakers join table (real schema), with
// SpeakerProfile + Person joined in for display (name, etc.)
// ---------------------------------------------------------------------

export async function getSessionSpeakers(sessionId) {
  const { rows } = await pool.query(
    `SELECT ss.*, sp."SpeakerProfileId", sp."ShortBio", sp."IsKeynote",
            p."FirstName", p."LastName", p."FullName", p."Company", p."JobTitle",
            p."ProfilePictureUrl", p."ProfilePictureThumbnailUrl"
     FROM "SessionSpeakers" ss
     JOIN "SpeakerProfile" sp ON sp."SpeakerProfileId" = ss."SpeakerProfileId"
     JOIN "EventParticipant" ep ON ep."EventParticipantId" = sp."EventParticipantId"
     JOIN "Person" p ON p."PersonId" = ep."PersonId"
     WHERE ss."SessionId" = $1
     ORDER BY ss."SortOrder" ASC`,
    [sessionId]
  );
  return rows;
}

// Speakers available to add to a session: every SpeakerProfile
// belonging to this event, with their Person name joined in — used
// for the "Add Speaker / Select Existing Speaker" search.
export async function getEventSpeakerRoster(eventId) {
  const { rows } = await pool.query(
    `SELECT sp."SpeakerProfileId", p."FirstName", p."LastName", p."FullName"
     FROM "SpeakerProfile" sp
     JOIN "EventParticipant" ep ON ep."EventParticipantId" = sp."EventParticipantId"
     JOIN "Person" p ON p."PersonId" = ep."PersonId"
     WHERE ep."EventId" = $1
     ORDER BY p."FullName" ASC`,
    [eventId]
  );
  return rows;
}

export async function addSessionSpeaker(sessionId, speakerProfileId, role) {
  const { rows: maxSortRows } = await pool.query(
    `SELECT COALESCE(MAX("SortOrder"), -1) + 1 AS next_sort FROM "SessionSpeakers" WHERE "SessionId" = $1`,
    [sessionId]
  );
  const { rows } = await pool.query(
    `INSERT INTO "SessionSpeakers" ("SessionId", "SpeakerProfileId", "Role", "SortOrder")
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [sessionId, speakerProfileId, role || 'Speaker', maxSortRows[0].next_sort]
  );
  return rows[0];
}

export async function updateSessionSpeakerRole(sessionId, speakerProfileId, role) {
  const { rows } = await pool.query(
    `UPDATE "SessionSpeakers" SET "Role" = $3 WHERE "SessionId" = $1 AND "SpeakerProfileId" = $2 RETURNING *`,
    [sessionId, speakerProfileId, role]
  );
  return rows[0] || null;
}

export async function removeSessionSpeaker(sessionId, speakerProfileId) {
  const { rowCount } = await pool.query(
    `DELETE FROM "SessionSpeakers" WHERE "SessionId" = $1 AND "SpeakerProfileId" = $2`,
    [sessionId, speakerProfileId]
  );
  return rowCount > 0;
}

// ---------------------------------------------------------------------
// Session Documents: EventDocuments filtered/attached by SessionId
// ---------------------------------------------------------------------

export async function getSessionDocuments(sessionId) {
  const { rows } = await pool.query(
    'SELECT * FROM "EventDocuments" WHERE "SessionId" = $1 ORDER BY "SortOrder" ASC',
    [sessionId]
  );
  return rows;
}

export async function getEventDocumentRoster(eventId) {
  const { rows } = await pool.query(
    'SELECT * FROM "EventDocuments" WHERE "EventId" = $1 ORDER BY "Title" ASC',
    [eventId]
  );
  return rows;
}

export async function createSessionDocument(eventId, sessionId, uploadedByPersonId, payload) {
  const { rows } = await pool.query(
    `INSERT INTO "EventDocuments" ("EventId", "SessionId", "Title", "FileUrl", "FileType", "FileSizeKB", "UploadedByPersonId")
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [eventId, sessionId, payload.title, payload.fileUrl, payload.fileType || null, payload.fileSizeKb || null, uploadedByPersonId]
  );
  return rows[0];
}

export async function attachExistingDocument(sessionId, documentId) {
  const { rows } = await pool.query(
    `UPDATE "EventDocuments" SET "SessionId" = $2 WHERE "DocumentId" = $1 RETURNING *`,
    [documentId, sessionId]
  );
  return rows[0] || null;
}

export async function removeSessionDocument(documentId) {
  const { rows } = await pool.query(
    `UPDATE "EventDocuments" SET "SessionId" = NULL WHERE "DocumentId" = $1 RETURNING *`,
    [documentId]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------
// Live Polling: LivePolls scoped to a session (real schema table)
// ---------------------------------------------------------------------

export async function getSessionPolls(sessionId) {
  const { rows } = await pool.query(
    'SELECT * FROM "LivePolls" WHERE "SessionId" = $1 ORDER BY "CreatedAt" ASC',
    [sessionId]
  );
  return rows;
}

export async function createSessionPoll(eventId, sessionId, createdByPersonId, payload) {
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM "LivePolls" WHERE "SessionId" = $1`,
    [sessionId]
  );
  if (countRows[0].n >= 20) {
    throw new Error('Limited to 20 polls per session.');
  }

  const { rows } = await pool.query(
    `INSERT INTO "LivePolls" ("EventId", "SessionId", "CreatedByPersonId", "Question", "Description", "PollType", "IsAnonymous", "AllowMultipleAnswers")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      eventId, sessionId, createdByPersonId, payload.question,
      payload.description || null, payload.pollType || 'SingleChoice',
      payload.isAnonymous || false, payload.allowMultipleAnswers || false,
    ]
  );
  return rows[0];
}

export async function deleteSessionPoll(pollId) {
  const { rowCount } = await pool.query('DELETE FROM "LivePolls" WHERE "PollId" = $1', [pollId]);
  return rowCount > 0;
}

// ---------------------------------------------------------------------
// Session Streams: Live Stream / Recorded Video (real SessionStreams
// table, one row per stream type)
// ---------------------------------------------------------------------

export async function getSessionStreams(sessionId) {
  const { rows } = await pool.query(
    'SELECT * FROM "SessionStreams" WHERE "SessionId" = $1 ORDER BY "CreatedAt" ASC',
    [sessionId]
  );
  return rows;
}

export async function upsertSessionStream(sessionId, streamType, payload) {
  const { rows: existingRows } = await pool.query(
    `SELECT * FROM "SessionStreams" WHERE "SessionId" = $1 AND "StreamType" = $2 LIMIT 1`,
    [sessionId, streamType]
  );

  if (existingRows.length === 0) {
    const { rows } = await pool.query(
      `INSERT INTO "SessionStreams" ("SessionId", "StreamType", "StreamUrl", "EmbedCode")
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [sessionId, streamType, payload.streamUrl || null, payload.embedCode || null]
    );
    return rows[0];
  }

  const { rows } = await pool.query(
    `UPDATE "SessionStreams" SET "StreamUrl" = $3, "EmbedCode" = $4, "UpdatedAt" = (now() AT TIME ZONE 'utc')
     WHERE "SessionId" = $1 AND "StreamType" = $2 RETURNING *`,
    [sessionId, streamType, payload.streamUrl || null, payload.embedCode || null]
  );
  return rows[0];
}

// ---------------------------------------------------------------------
// Session Sponsors (new table)
// ---------------------------------------------------------------------

export async function getSessionSponsors(sessionId) {
  const { rows } = await pool.query(
    `SELECT ssp.*, sp."CompanyName", sp."LogoUrl"
     FROM "SessionSponsors" ssp
     JOIN "SponsorProfile" sp ON sp."SponsorProfileId" = ssp."SponsorProfileId"
     WHERE ssp."SessionId" = $1
     ORDER BY ssp."SortOrder" ASC`,
    [sessionId]
  );
  return rows;
}

export async function addSessionSponsor(sessionId, sponsorProfileId) {
  const { rows: maxSortRows } = await pool.query(
    `SELECT COALESCE(MAX("SortOrder"), -1) + 1 AS next_sort FROM "SessionSponsors" WHERE "SessionId" = $1`,
    [sessionId]
  );
  const { rows } = await pool.query(
    `INSERT INTO "SessionSponsors" ("SessionId", "SponsorProfileId", "SortOrder")
     VALUES ($1,$2,$3) RETURNING *`,
    [sessionId, sponsorProfileId, maxSortRows[0].next_sort]
  );
  return rows[0];
}

export async function removeSessionSponsor(sessionSponsorId) {
  const { rowCount } = await pool.query('DELETE FROM "SessionSponsors" WHERE "SessionSponsorId" = $1', [sessionSponsorId]);
  return rowCount > 0;
}

// ---------------------------------------------------------------------
// Session Tags (new tables)
// ---------------------------------------------------------------------

export async function getEventSessionTags(eventId) {
  const { rows } = await pool.query('SELECT * FROM "SessionTags" WHERE "EventId" = $1 ORDER BY "Name" ASC', [eventId]);
  return rows;
}

export async function getSessionTagAssignments(sessionId) {
  const { rows } = await pool.query(
    `SELECT t.* FROM "SessionTagAssignments" sta
     JOIN "SessionTags" t ON t."SessionTagId" = sta."SessionTagId"
     WHERE sta."SessionId" = $1`,
    [sessionId]
  );
  return rows;
}

export async function setSessionTags(sessionId, tagIds) {
  if (tagIds.length > 4) {
    throw new Error('Up to 4 session tags can be selected.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM "SessionTagAssignments" WHERE "SessionId" = $1', [sessionId]);
    for (const tagId of tagIds) {
      await client.query(
        'INSERT INTO "SessionTagAssignments" ("SessionId", "SessionTagId") VALUES ($1, $2)',
        [sessionId, tagId]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getSessionTagAssignments(sessionId);
}

// ---------------------------------------------------------------------
// Session Authors (new table)
// ---------------------------------------------------------------------

export async function getSessionAuthors(sessionId) {
  const { rows } = await pool.query(
    'SELECT * FROM "SessionAuthors" WHERE "SessionId" = $1 ORDER BY "SortOrder" ASC',
    [sessionId]
  );
  return rows;
}

export async function addSessionAuthor(sessionId, payload) {
  const { rows: maxSortRows } = await pool.query(
    `SELECT COALESCE(MAX("SortOrder"), -1) + 1 AS next_sort FROM "SessionAuthors" WHERE "SessionId" = $1`,
    [sessionId]
  );
  const { rows } = await pool.query(
    `INSERT INTO "SessionAuthors" ("SessionId", "FirstName", "LastName", "Email", "Affiliation", "SortOrder")
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [sessionId, payload.firstName, payload.lastName, payload.email || null, payload.affiliation || null, maxSortRows[0].next_sort]
  );
  return rows[0];
}

export async function removeSessionAuthor(authorId) {
  const { rowCount } = await pool.query('DELETE FROM "SessionAuthors" WHERE "SessionAuthorId" = $1', [authorId]);
  return rowCount > 0;
}

// ---------------------------------------------------------------------
// Global Confera Admin Login Page Settings
// ---------------------------------------------------------------------
// Out-of-the-box look for the Admin login screen. Matches the
// Confera marketing site's own hero — same soft coral/brand glow on
// a light background — rather than an arbitrary flat color, so an
// unconfigured install already looks like the rest of the product.
// An organizer can still override any of this from Settings > Login
// Banner Settings; these are just what shows before they do.
const DEFAULT_LOGIN_PAGE_SETTINGS = {
  background: {
    mode: 'color',
    color:
      'radial-gradient(60% 50% at 88% 8%, rgba(255,107,87,.16), transparent 70%), ' +
      'radial-gradient(50% 45% at 0% 100%, rgba(63,60,187,.14), transparent 70%), #F6F5FC',
    imageUrl: '',
  },
  banner: {
    enabled: true,
    imageUrl: '',
    columns: 2,
    title: 'Run your event from one place.',
    subtitle: 'Build the agenda, manage people, and watch it come together — all in Confera Admin.',
    cards: [
      { title: 'Build the agenda', description: 'Sessions, tracks and speakers, organized in minutes.' },
      { title: 'Manage every role', description: 'Attendees, speakers, sponsors and exhibitors, in one place.' },
      { title: 'See it live', description: 'Registrations and engagement, tracked as the event runs.' },
      { title: 'Confera EMS', description: 'Everything your event team needs.' },
    ],
  },
};

export async function getLoginPageSettings() {
  const { rows } = await pool.query('SELECT "SettingsJson" FROM "LoginPageSettings" ORDER BY "CreatedAt" ASC LIMIT 1');
  let stored = {};
  if (rows[0]?.SettingsJson) { try { stored = JSON.parse(rows[0].SettingsJson) || {}; } catch {} }
  return {
    ...DEFAULT_LOGIN_PAGE_SETTINGS,
    ...stored,
    background: { ...DEFAULT_LOGIN_PAGE_SETTINGS.background, ...(stored.background || {}) },
    banner: {
      ...DEFAULT_LOGIN_PAGE_SETTINGS.banner,
      ...(stored.banner || {}),
      cards: Array.from({ length: 4 }, (_, i) => ({
        ...DEFAULT_LOGIN_PAGE_SETTINGS.banner.cards[i],
        ...((stored.banner?.cards || [])[i] || {}),
      })),
    },
  };
}

export async function updateLoginPageSettings(patch) {
  const current = await getLoginPageSettings();
  const merged = {
    ...current,
    ...patch,
    background: { ...current.background, ...(patch.background || {}) },
    banner: {
      ...current.banner,
      ...(patch.banner || {}),
      cards: Array.from({ length: 4 }, (_, i) => ({
        ...current.banner.cards[i],
        ...((patch.banner?.cards || [])[i] || {}),
      })),
    },
  };
  await pool.query(`
    INSERT INTO "LoginPageSettings" ("SettingsId","SettingsJson")
    SELECT gen_random_uuid(), $1
    WHERE NOT EXISTS (SELECT 1 FROM "LoginPageSettings")
  `, [JSON.stringify(merged)]);

  const { rows } = await pool.query('SELECT "SettingsId" FROM "LoginPageSettings" ORDER BY "CreatedAt" ASC LIMIT 1');
  if (rows[0]?.SettingsId) {
    await pool.query('UPDATE "LoginPageSettings" SET "SettingsJson"=$2, "UpdatedAt"=(now() AT TIME ZONE \'utc\') WHERE "SettingsId"=$1', [rows[0].SettingsId, JSON.stringify(merged)]);
  }
  return merged;
}

// ---------------------------------------------------------------------
// Event Admin Settings
// ---------------------------------------------------------------------
const DEFAULT_EVENT_ADMIN_SETTINGS = {
  videoConferencing: { useCustomVideoCall: false, customVideoCall: { enabled: false, apiBaseUrl: '', joinUrlTemplate: '', apiKey: '', apiSecret: '', createRoomEndpoint: '' }, googleMeet: { enabled: false, clientId: '', clientSecret: '', redirectUri: '', refreshToken: '' }, zoom: { enabled: false, accountId: '', clientId: '', clientSecret: '', accessToken: '' } },
  email: { smtpHost: '', smtpPort: '587', smtpUsername: '', smtpPassword: '', fromName: '', fromEmail: '', secure: true },
  sms: { provider: '', apiKey: '', apiSecret: '', senderId: '', enabled: false },
  twoFactor: { enabled: false, method: 'Email', issuer: 'Confera' },
  emailTemplates: {
    welcome: { subject: 'Welcome to {{eventName}}', body: 'Welcome to {{eventName}}. We are pleased to have you with us.' },
    confirmation: { subject: 'Confirm your email', body: 'Please confirm your email address by signing in to {{eventName}}.' },
    resetPassword: { subject: 'Reset your password', body: 'Use the secure link below to reset your Confera password.' },
    videoCallInvitation: { subject: 'Your video call invitation', body: 'Join your meeting using the link below. {{meetingLink}}', signInLabel: 'Sign In' },
  },
  payment: { provider: '', apiKey: '', apiSecret: '', webhookSecret: '', sandbox: true, enabled: false },
};

export async function getEventAdminSettings(eventId) {
  const { rows } = await pool.query('SELECT "SettingsJson" FROM "EventAdminSettings" WHERE "EventId" = $1', [eventId]);
  let stored = {};
  if (rows[0]?.SettingsJson) { try { stored = JSON.parse(rows[0].SettingsJson) || {}; } catch {} }
  return {
    ...DEFAULT_EVENT_ADMIN_SETTINGS,
    ...stored,
    videoConferencing: { ...DEFAULT_EVENT_ADMIN_SETTINGS.videoConferencing, ...(stored.videoConferencing || {}), customVideoCall: { ...DEFAULT_EVENT_ADMIN_SETTINGS.videoConferencing.customVideoCall, ...(stored.videoConferencing?.customVideoCall || {}) }, googleMeet: { ...DEFAULT_EVENT_ADMIN_SETTINGS.videoConferencing.googleMeet, ...(stored.videoConferencing?.googleMeet || {}) }, zoom: { ...DEFAULT_EVENT_ADMIN_SETTINGS.videoConferencing.zoom, ...(stored.videoConferencing?.zoom || {}) } },
    email: { ...DEFAULT_EVENT_ADMIN_SETTINGS.email, ...(stored.email || {}) },
    sms: { ...DEFAULT_EVENT_ADMIN_SETTINGS.sms, ...(stored.sms || {}) },
    twoFactor: { ...DEFAULT_EVENT_ADMIN_SETTINGS.twoFactor, ...(stored.twoFactor || {}) },
    emailTemplates: { ...DEFAULT_EVENT_ADMIN_SETTINGS.emailTemplates, ...(stored.emailTemplates || {}) },
    payment: { ...DEFAULT_EVENT_ADMIN_SETTINGS.payment, ...(stored.payment || {}) },
  };
}

export async function updateEventAdminSettings(eventId, patch) {
  const current = await getEventAdminSettings(eventId);
  const merged = {
    ...current, ...patch,
    videoConferencing: { ...current.videoConferencing, ...(patch.videoConferencing || {}), customVideoCall: { ...current.videoConferencing.customVideoCall, ...(patch.videoConferencing?.customVideoCall || {}) }, googleMeet: { ...current.videoConferencing.googleMeet, ...(patch.videoConferencing?.googleMeet || {}) }, zoom: { ...current.videoConferencing.zoom, ...(patch.videoConferencing?.zoom || {}) } },
    email: { ...current.email, ...(patch.email || {}) },
    sms: { ...current.sms, ...(patch.sms || {}) },
    twoFactor: { ...current.twoFactor, ...(patch.twoFactor || {}) },
    emailTemplates: { ...current.emailTemplates, ...(patch.emailTemplates || {}) },
    payment: { ...current.payment, ...(patch.payment || {}) },
  };
  await pool.query(`INSERT INTO "EventAdminSettings" ("EventId","SettingsJson") VALUES ($1,$2)
    ON CONFLICT ("EventId") DO UPDATE SET "SettingsJson"=$2,"UpdatedAt"=(now() AT TIME ZONE 'utc')`, [eventId, JSON.stringify(merged)]);
  return merged;
}

// ---------------------------------------------------------------------
// Categories: flat per-event list, matching the reference EMS Admin's
// Category Manager exactly (name only — no color/description/icon,
// unlike the richer Tracks feature). See add_categories.sql.
// ---------------------------------------------------------------------

export async function getCategoriesForEvent(eventId) {
  const { rows } = await pool.query(
    `SELECT c.*, COUNT(s."SessionId")::int AS "SessionCount"
     FROM "Categories" c
     LEFT JOIN "Sessions" s ON s."CategoryId" = c."CategoryId" AND s."IsDeleted" = false
     WHERE c."EventId" = $1
     GROUP BY c."CategoryId"
     ORDER BY c."SortOrder" ASC`,
    [eventId]
  );
  return rows;
}

export async function getCategoryById(categoryId) {
  const { rows } = await pool.query('SELECT * FROM "Categories" WHERE "CategoryId" = $1', [categoryId]);
  return rows[0] || null;
}

export async function createCategory(eventId, name, color = '#7c3aed') {
  const { rows: maxSortRows } = await pool.query(
    `SELECT COALESCE(MAX("SortOrder"), -1) + 1 AS next_sort FROM "Categories" WHERE "EventId" = $1`,
    [eventId]
  );
  const { rows } = await pool.query(
    `INSERT INTO "Categories" ("EventId", "Name", "SortOrder", "Color") VALUES ($1,$2,$3,$4) RETURNING *`,
    [eventId, name, maxSortRows[0].next_sort, color]
  );
  return rows[0];
}

export async function updateCategory(categoryId, name, color = '#7c3aed') {
  const { rows } = await pool.query(
    `UPDATE "Categories" SET "Name" = $2, "Color" = $3 WHERE "CategoryId" = $1 RETURNING *`,
    [categoryId, name, color]
  );
  return rows[0] || null;
}

export async function deleteCategory(categoryId) {
  // No CASCADE on Sessions.CategoryId — same as Tracks, a real FK
  // violation surfaces if a session still uses this category, caught
  // by the route layer (error code 23503).
  const { rowCount } = await pool.query('DELETE FROM "Categories" WHERE "CategoryId" = $1', [categoryId]);
  return rowCount > 0;
}

// ---------------------------------------------------------------------
// Speaker Center: full CRUD over the real Person + EventParticipant
// (Role='Speaker') + SpeakerProfile chain. Distinct from
// getEventSpeakerRoster (a lightweight name-only lookup used by
// Session Manager's "add speaker to session" dropdown) — this covers
// every field Speaker Center manages: name, email, company, job
// title, country, profile picture, and bio.
// ---------------------------------------------------------------------

export async function getSpeakersForEventFull(eventId) {
  const { rows } = await pool.query(
    `SELECT p."PersonId", p."FirstName", p."LastName", p."FullName", p."Email",
            p."Company", p."JobTitle", p."Country",
            p."ProfilePictureUrl", p."ProfilePictureThumbnailUrl",
            sp."SpeakerProfileId", sp."ShortBio", sp."SortOrder",
            sp."SpeakerInformationFormLink", sp."LinkedInUrl", sp."TwitterUrl",
            sp."InstagramUrl", sp."FacebookUrl",
            (
              SELECT COALESCE(
                json_agg(
                  json_build_object(
                    'id', s."SessionId",
                    'title', s."Title",
                    'startTime', s."StartTime",
                    'endTime', s."EndTime",
                    'location', s."Location"
                  ) ORDER BY s."StartTime", s."Title"
                ) FILTER (WHERE s."SessionId" IS NOT NULL),
                '[]'::json
              )
              FROM "SessionSpeakers" ss
              JOIN "Sessions" s ON s."SessionId" = ss."SessionId"
              WHERE ss."SpeakerProfileId" = sp."SpeakerProfileId"
                AND s."EventId" = $1
                AND s."IsDeleted" = false
            ) AS "AgendaSessions"
     FROM "SpeakerProfile" sp
     JOIN "EventParticipant" ep ON ep."EventParticipantId" = sp."EventParticipantId"
     JOIN "Person" p ON p."PersonId" = ep."PersonId"
     WHERE ep."EventId" = $1
       AND ep."Role" = 'Speaker'
       AND COALESCE(sp."IsDeleted", false) = false
     ORDER BY sp."SortOrder" ASC, p."FullName" ASC`,
    [eventId]
  );
  return rows;
}

export async function getSpeakerByProfileId(speakerProfileId) {
  const { rows } = await pool.query(
    `SELECT p.*, sp."SpeakerProfileId", sp."ShortBio", sp."SortOrder",
            sp."SpeakerInformationFormLink", sp."LinkedInUrl", sp."TwitterUrl",
            sp."InstagramUrl", sp."FacebookUrl",
            ep."EventId", ep."EventParticipantId"
     FROM "SpeakerProfile" sp
     JOIN "EventParticipant" ep ON ep."EventParticipantId" = sp."EventParticipantId"
     JOIN "Person" p ON p."PersonId" = ep."PersonId"
     WHERE sp."SpeakerProfileId" = $1`,
    [speakerProfileId]
  );
  return rows[0] || null;
}

export async function createSpeaker(eventId, payload, options = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const normalizedEmail = payload.email.toUpperCase();

    // Reuse an existing Person if this email is already in the
    // system (e.g. they're also an attendee, or speaking at a
    // different event) — Person.Email has a real UNIQUE constraint,
    // so silently trying to INSERT a duplicate would crash rather
    // than do the sensible thing.
    const { rows: existingRows } = await client.query(
      'SELECT "PersonId", "PasswordHash" FROM "Person" WHERE "NormalizedEmail" = $1',
      [normalizedEmail]
    );

    let personId;
    let passwordHash;
    if (existingRows.length > 0) {
      personId = existingRows[0].PersonId;
      passwordHash = existingRows[0].PasswordHash;
      await client.query(
        `UPDATE "Person" SET "FirstName" = $2, "LastName" = $3, "Company" = $4,
           "JobTitle" = $5, "Country" = $6,
           "ProfilePictureUrl" = COALESCE($7, "ProfilePictureUrl"),
           "UpdatedAt" = (now() AT TIME ZONE 'utc')
         WHERE "PersonId" = $1`,
        [personId, payload.firstName, payload.lastName, payload.company || null, payload.jobTitle || null, payload.country || null, payload.profilePictureUrl || null]
      );
    } else {
      const { rows: personRows } = await client.query(
        `INSERT INTO "Person" ("Email", "NormalizedEmail", "PasswordHash", "FirstName", "LastName", "Company", "JobTitle", "Country", "ProfilePictureUrl")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING "PersonId", "PasswordHash"`,
        [
          payload.email, normalizedEmail, 'not-a-real-hash-speaker-center-created',
          payload.firstName, payload.lastName, payload.company || null,
          payload.jobTitle || null, payload.country || null, payload.profilePictureUrl || null,
        ]
      );
      personId = personRows[0].PersonId;
      passwordHash = personRows[0].PasswordHash;
    }

    // A Person can only be a Speaker once per event — check before
    // inserting EventParticipant, since re-adding the same email to
    // the same event should update their existing entry, not create
    // a duplicate participant row.
    const { rows: existingParticipantRows } = await client.query(
      `SELECT ep."EventParticipantId", sp."SpeakerProfileId"
       FROM "EventParticipant" ep
       LEFT JOIN "SpeakerProfile" sp ON sp."EventParticipantId" = ep."EventParticipantId"
       WHERE ep."EventId" = $1 AND ep."PersonId" = $2 AND ep."Role" = 'Speaker'`,
      [eventId, personId]
    );

    let speakerProfileId;
    if (existingParticipantRows.length > 0 && existingParticipantRows[0].SpeakerProfileId) {
      speakerProfileId = existingParticipantRows[0].SpeakerProfileId;
      await client.query(
        `UPDATE "SpeakerProfile"
         SET "ShortBio" = $2, "SpeakerInformationFormLink" = $3,
             "LinkedInUrl" = $4, "TwitterUrl" = $5, "InstagramUrl" = $6,
             "FacebookUrl" = $7, "UpdatedAt" = (now() AT TIME ZONE 'utc')
         WHERE "SpeakerProfileId" = $1`,
        [
          speakerProfileId, payload.bio || null,
          payload.speakerInformationFormLink || null, payload.linkedInUrl || null,
          payload.twitterUrl || null, payload.instagramUrl || null,
          payload.facebookUrl || null,
        ]
      );
    } else {
      let participantId;
      if (existingParticipantRows.length > 0) {
        participantId = existingParticipantRows[0].EventParticipantId;
      } else {
        const regCode = `SPK-${Date.now()}`;
        const { rows: participantRows } = await client.query(
          `INSERT INTO "EventParticipant" ("EventId", "PersonId", "Role", "RegistrationCode")
           VALUES ($1,$2,'Speaker',$3) RETURNING "EventParticipantId"`,
          [eventId, personId, regCode]
        );
        participantId = participantRows[0].EventParticipantId;
      }

      const { rows: maxSortRows } = await client.query(
        `SELECT COALESCE(MAX(sp."SortOrder"), -1) + 1 AS next_sort
         FROM "SpeakerProfile" sp
         JOIN "EventParticipant" ep ON ep."EventParticipantId" = sp."EventParticipantId"
         WHERE ep."EventId" = $1`,
        [eventId]
      );

      const { rows: speakerProfileRows } = await client.query(
        `INSERT INTO "SpeakerProfile" (
           "EventParticipantId", "ShortBio", "SortOrder",
           "SpeakerInformationFormLink", "LinkedInUrl", "TwitterUrl",
           "InstagramUrl", "FacebookUrl"
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING "SpeakerProfileId"`,
        [
          participantId, payload.bio || null, maxSortRows[0].next_sort,
          payload.speakerInformationFormLink || null,
          payload.linkedInUrl || null,
          payload.twitterUrl || null,
          payload.instagramUrl || null,
          payload.facebookUrl || null,
        ]
      );
      speakerProfileId = speakerProfileRows[0].SpeakerProfileId;
    }

    await client.query('COMMIT');
    if (!options.skipInvite) {
      // Fire-and-forget — see the matching comment in createSponsor above.
      // This is the call that made "Import Speakers" slow: it used to run
      // once per row inside the import loop, blocking on a real Gmail send
      // each time.
      sendPortalInviteIfNeeded({
        personId, email: payload.email,
        fullName: `${payload.firstName} ${payload.lastName}`.trim(),
        passwordHash, eventId,
      }).catch(() => {});
    }
    return getSpeakerByProfileId(speakerProfileId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateSpeaker(speakerProfileId, payload) {
  const existing = await getSpeakerByProfileId(speakerProfileId);
  if (!existing) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE "Person" SET "FirstName" = $2, "LastName" = $3, "Company" = $4,
         "JobTitle" = $5, "Country" = $6,
         "ProfilePictureUrl" = COALESCE($7, "ProfilePictureUrl"),
         "UpdatedAt" = (now() AT TIME ZONE 'utc')
       WHERE "PersonId" = $1`,
      [
        existing.PersonId, payload.firstName ?? existing.FirstName, payload.lastName ?? existing.LastName,
        payload.company ?? existing.Company, payload.jobTitle ?? existing.JobTitle,
        payload.country ?? existing.Country, payload.profilePictureUrl || null,
      ]
    );

    await client.query(
      `UPDATE "SpeakerProfile"
       SET "ShortBio" = $2, "SpeakerInformationFormLink" = $3,
           "LinkedInUrl" = $4, "TwitterUrl" = $5, "InstagramUrl" = $6,
           "FacebookUrl" = $7, "UpdatedAt" = (now() AT TIME ZONE 'utc')
       WHERE "SpeakerProfileId" = $1`,
      [
        speakerProfileId,
        payload.bio ?? existing.ShortBio,
        payload.speakerInformationFormLink ?? existing.SpeakerInformationFormLink,
        payload.linkedInUrl ?? existing.LinkedInUrl,
        payload.twitterUrl ?? existing.TwitterUrl,
        payload.instagramUrl ?? existing.InstagramUrl,
        payload.facebookUrl ?? existing.FacebookUrl,
      ]
    );

    await client.query('COMMIT');
    return getSpeakerByProfileId(speakerProfileId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function setSpeakerAgendaSessions(eventId, speakerProfileId, sessionIds) {
  const uniqueIds = [...new Set((Array.isArray(sessionIds) ? sessionIds : []).filter(Boolean))];
  const speaker = await getSpeakerByProfileId(speakerProfileId);
  if (!speaker || speaker.EventId !== eventId) return null;

  const { rows: validSessions } = await pool.query(
    `SELECT "SessionId" FROM "Sessions"
     WHERE "EventId" = $1 AND "SessionId" = ANY($2::uuid[]) AND "IsDeleted" = false`,
    [eventId, uniqueIds]
  );
  const validIds = new Set(validSessions.map((r) => r.SessionId));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM "SessionSpeakers" WHERE "SpeakerProfileId" = $1', [speakerProfileId]);
    for (const sessionId of uniqueIds) {
      if (!validIds.has(sessionId)) continue;
      await client.query(
        `INSERT INTO "SessionSpeakers" ("SessionId", "SpeakerProfileId", "Role", "SortOrder")
         VALUES ($1,$2,'Speaker',
           COALESCE((SELECT MAX("SortOrder") + 1 FROM "SessionSpeakers" WHERE "SessionId" = $1), 0)
         )`,
        [sessionId, speakerProfileId]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getSpeakerByProfileId(speakerProfileId);
}

export async function deleteSpeaker(speakerProfileId) {
  // Deletes the SpeakerProfile and the EventParticipant row (removing
  // them from this event's speaker list), but deliberately leaves the
  // underlying Person alone — they may still be an attendee, sponsor
  // contact, or speaker at a different event, and deleting Person
  // would be a much bigger, unrelated action.
  const existing = await getSpeakerByProfileId(speakerProfileId);
  if (!existing) return false;

  await pool.query('DELETE FROM "SpeakerProfile" WHERE "SpeakerProfileId" = $1', [speakerProfileId]);
  await pool.query('DELETE FROM "EventParticipant" WHERE "EventParticipantId" = $1', [existing.EventParticipantId]);
  return true;
}

// ---------------------------------------------------------------------
// Exhibitor Manager: full CRUD over ExhibitorProfile, linked through
// EventParticipant(Role='Exhibitor') the same way Speaker Center is
// linked through EventParticipant(Role='Speaker') — a Person row is
// still required by the schema (EventParticipant.PersonId is
// NOT NULL), created/reused from the primary contact email, but
// unlike speakers, the actual exhibitor details (company, logo,
// contacts, etc.) live entirely on ExhibitorProfile, not Person.
// ---------------------------------------------------------------------

export async function getExhibitorsForEvent(eventId) {
  const { rows } = await pool.query(
    `SELECT ep."EventParticipantId", xp.*
     FROM "ExhibitorProfile" xp
     JOIN "EventParticipant" ep ON ep."EventParticipantId" = xp."EventParticipantId"
     WHERE ep."EventId" = $1
     ORDER BY xp."SortOrder" ASC, xp."CompanyName" ASC`,
    [eventId]
  );
  return rows;
}

export async function getExhibitorById(exhibitorProfileId) {
  const { rows } = await pool.query(
    `SELECT ep."EventId", ep."EventParticipantId", xp.*
     FROM "ExhibitorProfile" xp
     JOIN "EventParticipant" ep ON ep."EventParticipantId" = xp."EventParticipantId"
     WHERE xp."ExhibitorProfileId" = $1`,
    [exhibitorProfileId]
  );
  return rows[0] || null;
}

export async function getExhibitorCategories(exhibitorProfileId) {
  const { rows } = await pool.query(
    'SELECT * FROM "ExhibitorCategories" WHERE "ExhibitorProfileId" = $1 ORDER BY "SortOrder" ASC',
    [exhibitorProfileId]
  );
  return rows;
}

export async function getExhibitorDocuments(exhibitorProfileId) {
  const { rows } = await pool.query(
    'SELECT * FROM "EventDocuments" WHERE "ExhibitorProfileId" = $1 AND "IsDeleted" = false ORDER BY "SortOrder" ASC',
    [exhibitorProfileId]
  );
  return rows;
}

async function findOrCreatePersonForContact(client, email, contactName) {
  const normalizedEmail = email.toUpperCase();
  const { rows: existingRows } = await client.query(
    'SELECT "PersonId", "PasswordHash" FROM "Person" WHERE "NormalizedEmail" = $1',
    [normalizedEmail]
  );
  if (existingRows.length > 0) {
    return { personId: existingRows[0].PersonId, passwordHash: existingRows[0].PasswordHash };
  }

  const nameParts = (contactName || 'Exhibitor Contact').trim().split(/\s+/);
  const firstName = nameParts[0] || 'Exhibitor';
  const lastName = nameParts.slice(1).join(' ') || 'Contact';

  const { rows } = await client.query(
    `INSERT INTO "Person" ("Email", "NormalizedEmail", "PasswordHash", "FirstName", "LastName")
     VALUES ($1,$2,$3,$4,$5) RETURNING "PersonId", "PasswordHash"`,
    [email, normalizedEmail, 'not-a-real-hash-exhibitor-manager-created', firstName, lastName]
  );
  return { personId: rows[0].PersonId, passwordHash: rows[0].PasswordHash };
}

const EXHIBITOR_FIELD_MAP = {
  company: 'CompanyName', description: 'Description', logoUrl: 'LogoUrl',
  boothNumber: 'BoothNumber', slogan: 'Slogan', address: 'Address',
  website: 'WebsiteUrl', videoUrl: 'VideoUrl', photoUrl: 'PhotoUrl', videoThumbnailUrl: 'VideoThumbnailUrl',
  contactEmail: 'ContactEmail', contactName: 'ContactName', contactPhone: 'ContactPhone',
  secondaryContactEmail: 'SecondaryContactEmail', secondaryContactName: 'SecondaryContactName',
  secondaryContactPhone: 'SecondaryContactPhone',
};

export async function createExhibitor(eventId, payload, options = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { personId, passwordHash } = await findOrCreatePersonForContact(client, payload.contactEmail, payload.contactName);

    const regCode = `EXH-${Date.now()}`;
    const { rows: participantRows } = await client.query(
      `INSERT INTO "EventParticipant" ("EventId", "PersonId", "Role", "RegistrationCode")
       VALUES ($1,$2,'Exhibitor',$3) RETURNING "EventParticipantId"`,
      [eventId, personId, regCode]
    );
    const participantId = participantRows[0].EventParticipantId;

    const entries = Object.entries(payload).filter(([k]) => EXHIBITOR_FIELD_MAP[k] && payload[k] !== undefined);
    const columns = ['EventParticipantId', ...entries.map(([k]) => EXHIBITOR_FIELD_MAP[k])];
    const values = [participantId, ...entries.map(([, v]) => (v === '' ? null : v))];
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const { rows: profileRows } = await client.query(
      `INSERT INTO "ExhibitorProfile" (${columns.map((c) => `"${c}"`).join(', ')})
       VALUES (${placeholders.join(', ')}) RETURNING "ExhibitorProfileId"`,
      values
    );
    const exhibitorProfileId = profileRows[0].ExhibitorProfileId;

    if (Array.isArray(payload.categories)) {
      for (let i = 0; i < payload.categories.length; i++) {
        const name = payload.categories[i]?.trim();
        if (!name) continue;
        await client.query(
          `INSERT INTO "ExhibitorCategories" ("ExhibitorProfileId", "Name", "SortOrder") VALUES ($1,$2,$3)`,
          [exhibitorProfileId, name, i]
        );
      }
    }

    await client.query('COMMIT');
    if (!options.skipInvite) {
      // Fire-and-forget — see the matching comment in createSponsor above.
      sendPortalInviteIfNeeded({
        personId, email: payload.contactEmail, fullName: payload.contactName,
        passwordHash, eventId,
      }).catch(() => {});
    }
    return getExhibitorById(exhibitorProfileId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateExhibitor(exhibitorProfileId, payload) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const entries = Object.entries(payload).filter(([k]) => EXHIBITOR_FIELD_MAP[k] && payload[k] !== undefined);
    if (entries.length > 0) {
      const setClauses = entries.map(([k], i) => `"${EXHIBITOR_FIELD_MAP[k]}" = $${i + 2}`);
      const values = entries.map(([, v]) => (v === '' ? null : v));
      await client.query(
        `UPDATE "ExhibitorProfile" SET ${setClauses.join(', ')}, "UpdatedAt" = (now() AT TIME ZONE 'utc')
         WHERE "ExhibitorProfileId" = $1`,
        [exhibitorProfileId, ...values]
      );
    }

    if (Array.isArray(payload.categories)) {
      await client.query('DELETE FROM "ExhibitorCategories" WHERE "ExhibitorProfileId" = $1', [exhibitorProfileId]);
      for (let i = 0; i < payload.categories.length; i++) {
        const name = payload.categories[i]?.trim();
        if (!name) continue;
        await client.query(
          `INSERT INTO "ExhibitorCategories" ("ExhibitorProfileId", "Name", "SortOrder") VALUES ($1,$2,$3)`,
          [exhibitorProfileId, name, i]
        );
      }
    }

    await client.query('COMMIT');
    return getExhibitorById(exhibitorProfileId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteExhibitor(exhibitorProfileId) {
  const existing = await getExhibitorById(exhibitorProfileId);
  if (!existing) return false;

  // Same reasoning as Speaker Center's delete: removes ExhibitorProfile
  // and the EventParticipant row (leaving this event's exhibitor
  // list), but leaves the underlying Person alone since it may still
  // be referenced elsewhere.
  await pool.query('DELETE FROM "ExhibitorProfile" WHERE "ExhibitorProfileId" = $1', [exhibitorProfileId]);
  await pool.query('DELETE FROM "EventParticipant" WHERE "EventParticipantId" = $1', [existing.EventParticipantId]);
  return true;
}

// ---------------------------------------------------------------------
// Documents page: splits EventDocuments into two lists — event-wide
// docs (SessionId IS NULL, uploaded directly here) and session docs
// (SessionId IS NOT NULL, uploaded via Session Manager but shown here
// read-only for visibility), matching the reference's two-section
// layout.
// ---------------------------------------------------------------------

export async function getEventDocuments(eventId) {
  const { rows } = await pool.query(
    `SELECT * FROM "EventDocuments"
     WHERE "EventId" = $1 AND "SessionId" IS NULL AND "ExhibitorProfileId" IS NULL AND "IsDeleted" = false
     ORDER BY "SortOrder" ASC`,
    [eventId]
  );
  return rows;
}

export async function getSessionLinkedDocuments(eventId) {
  const { rows } = await pool.query(
    `SELECT d.*, s."Title" AS "SessionTitle"
     FROM "EventDocuments" d
     JOIN "Sessions" s ON s."SessionId" = d."SessionId"
     WHERE d."EventId" = $1 AND d."IsDeleted" = false
     ORDER BY d."CreatedAt" DESC`,
    [eventId]
  );
  return rows;
}

export async function createEventDocument(eventId, uploadedByPersonId, payload) {
  const { rows } = await pool.query(
    `INSERT INTO "EventDocuments" ("EventId", "Title", "FileUrl", "FileType", "FileSizeKB", "UploadedByPersonId")
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [eventId, payload.title, payload.fileUrl, payload.fileType || null, payload.fileSizeKb || null, uploadedByPersonId]
  );
  return rows[0];
}

export async function deleteEventDocument(documentId) {
  // Soft delete, consistent with Sessions/other tables in this
  // schema — real files stay on disk, just hidden from lists.
  const { rowCount } = await pool.query(
    `UPDATE "EventDocuments" SET "IsDeleted" = true, "DeletedAt" = (now() AT TIME ZONE 'utc') WHERE "DocumentId" = $1`,
    [documentId]
  );
  return rowCount > 0;
}

export async function reorderEventDocuments(eventId, orderedDocumentIds) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < orderedDocumentIds.length; i++) {
      await client.query(
        `UPDATE "EventDocuments" SET "SortOrder" = $1 WHERE "DocumentId" = $2 AND "EventId" = $3`,
        [i, orderedDocumentIds[i], eventId]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------
// Video Hosting: EventVideos with real per-event storage quota usage.
// ---------------------------------------------------------------------

export async function getEventVideos(eventId) {
  const { rows } = await pool.query(
    'SELECT * FROM "EventVideos" WHERE "EventId" = $1 ORDER BY "CreatedAt" DESC',
    [eventId]
  );
  return rows;
}

export async function getVideoStorageUsage(eventId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM("FileSizeKB"), 0)::bigint AS "UsedKB",
            (SELECT "VideoStorageQuotaKB" FROM "Event" WHERE "EventId" = $1) AS "QuotaKB"
     FROM "EventVideos" WHERE "EventId" = $1`,
    [eventId]
  );
  return rows[0];
}

export async function createEventVideo(eventId, uploadedByPersonId, payload) {
  const usage = await getVideoStorageUsage(eventId);
  const wouldUseKB = Number(usage.UsedKB) + payload.fileSizeKb;
  if (wouldUseKB > usage.QuotaKB) {
    const error = new Error('This upload would exceed your available video storage.');
    error.code = 'STORAGE_QUOTA_EXCEEDED';
    throw error;
  }

  const { rows } = await pool.query(
    `INSERT INTO "EventVideos" ("EventId", "Title", "FileUrl", "FileSizeKB", "UploadedByPersonId")
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [eventId, payload.title, payload.fileUrl, payload.fileSizeKb, uploadedByPersonId]
  );
  return rows[0];
}

export async function deleteEventVideo(eventVideoId) {
  const { rowCount } = await pool.query('DELETE FROM "EventVideos" WHERE "EventVideoId" = $1', [eventVideoId]);
  return rowCount > 0;
}

// ---------------------------------------------------------------------
// Attendee Video Access: per-ticket-type video access toggles,
// anchored on the real TicketTypes table.
// ---------------------------------------------------------------------

export async function getTicketTypesWithVideoAccess(eventId) {
  const { rows } = await pool.query(
    `SELECT tt.*, COALESCE(tva."HasVideoAccess", false) AS "HasVideoAccess"
     FROM "TicketTypes" tt
     LEFT JOIN "TicketTypeVideoAccess" tva ON tva."TicketTypeId" = tt."TicketTypeId"
     WHERE tt."EventId" = $1 AND tt."IsActive" = true
     ORDER BY tt."SortOrder" ASC`,
    [eventId]
  );
  return rows;
}

export async function setTicketTypeVideoAccess(ticketTypeId, hasAccess) {
  const { rows } = await pool.query(
    `INSERT INTO "TicketTypeVideoAccess" ("TicketTypeId", "HasVideoAccess")
     VALUES ($1, $2)
     ON CONFLICT ("TicketTypeId") DO UPDATE SET "HasVideoAccess" = $2, "UpdatedAt" = (now() AT TIME ZONE 'utc')
     RETURNING *`,
    [ticketTypeId, hasAccess]
  );
  return rows[0];
}

export async function getAttendeeVideoAccessEnabled(eventId) {
  const { rows } = await pool.query('SELECT "AttendeeVideoAccessEnabled" FROM "Event" WHERE "EventId" = $1', [eventId]);
  return rows[0]?.AttendeeVideoAccessEnabled || false;
}

export async function setAttendeeVideoAccessEnabled(eventId, enabled) {
  const { rows } = await pool.query(
    `UPDATE "Event" SET "AttendeeVideoAccessEnabled" = $2 WHERE "EventId" = $1 RETURNING "AttendeeVideoAccessEnabled"`,
    [eventId, enabled]
  );
  return rows[0]?.AttendeeVideoAccessEnabled || false;
}

// Speaking sessions per speaker, for the public Speakers page's
// "Speaking at" link — joins the real SessionSpeakers table (already
// used by Session Manager's speaker assignment) against Sessions.
export async function getSessionsForSpeaker(speakerProfileId) {
  const { rows } = await pool.query(
    `SELECT s."SessionId", s."Title", s."StartTime"
     FROM "SessionSpeakers" ss
     JOIN "Sessions" s ON s."SessionId" = ss."SessionId"
     WHERE ss."SpeakerProfileId" = $1 AND s."IsDeleted" = false
     ORDER BY s."StartTime" ASC`,
    [speakerProfileId]
  );
  return rows;
}
