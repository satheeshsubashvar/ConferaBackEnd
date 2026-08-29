import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/data/db.js';

// Real migration runner: applies backend/src/data/nav_tables.sql
// (idempotent — uses CREATE TABLE IF NOT EXISTS, safe to re-run) and
// sanity-checks that the base 72-table + 32-migration schema is
// already present before doing so, since this app's tables assume it.
//
// Deliberately does NOT run reset_seed_data.sql — that's destructive
// (deletes rows) and stays an explicit, separate manual step so it's
// never accidentally bundled into routine setup.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REQUIRED_BASE_TABLES = ['Person', 'Organizations', 'OrganizationUsers', 'Event', 'EventParticipant', 'SponsorProfile'];

async function checkBaseSchema() {
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [REQUIRED_BASE_TABLES]
  );
  const found = new Set(rows.map((r) => r.table_name));
  const missing = REQUIRED_BASE_TABLES.filter((t) => !found.has(t));
  return { ok: missing.length === 0, missing };
}

async function applyNavTables() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'nav_tables.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function seedEventTypes() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'seed_event_types.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function applyMissingPortalNav() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'add_missing_portal_nav.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function applySpeakerPageAndResourceColumns() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'add_speaker_page_and_resource_columns.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function seedSessionLookups() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'seed_session_lookups.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function applySessionSponsorsTagsAuthors() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'add_session_sponsors_tags_authors.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function applyNewAdminNavTaxonomy() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'replace_admin_nav_taxonomy.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function applyCategories() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'add_categories.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function applySidebarQuickfixes() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'apply_sidebar_quickfixes.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function applyExhibitorFields() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'add_exhibitor_fields.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function applyEventWebpageSettings() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'add_event_webpage_settings.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function applySponsorVideoThumbnail() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'add_sponsor_video_thumbnail.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function applyCategoryColor() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'add_category_color.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function applyExhibitorMediaFields() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'add_exhibitor_media_fields.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function applySpeakerManagementFields() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'add_speaker_management_fields.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function applyVideoHostingAndAccess() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'add_video_hosting_and_access.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function applyDocumentsVideoNav() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'add_documents_video_nav.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function applyEventAdminSettings() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'add_event_settings.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function applySettingsNav() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'add_settings_nav.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function applyRequestedAdminModules() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'add_requested_admin_modules.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function applyEventAnalytics() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'add_event_analytics.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function applyEngageNetworkNav() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'update_engage_network_nav.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function applyDiscussionTopicSession() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'add_discussion_topic_session.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function applyNestedTaxonomy() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'nest_event_content_taxonomy.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function normalizeAdminNavDuplicates() {
  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'normalize_admin_nav_duplicates.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
}

async function main() {
  console.log(`Connecting to ${process.env.PGDATABASE || 'Confera'}...`);

  const { ok, missing } = await checkBaseSchema();
  if (!ok) {
    console.error('Base schema is missing required tables:', missing.join(', '));
    console.error('Apply the original Confera.sql dump and the 32 migration files first.');
    process.exitCode = 1;
    await pool.end();
    return;
  }
  console.log('Base schema check passed (Person, Organizations, Event, etc. present).');

  console.log('Applying nav_tables.sql (AdminNavItems, PortalNavItems)...');
  await applyNavTables();
  console.log('Migration complete. AdminNavItems and PortalNavItems are ready.');

  console.log('Seeding EventTypes lookup table...');
  await seedEventTypes();
  console.log('EventTypes ready.');

  console.log('Adding Feedback to Confera / Organizer Tips to Portal sidebars...');
  await applyMissingPortalNav();
  console.log('Portal sidebar items ready.');

  console.log('Adding Speaker Page + Resource management columns...');
  await applySpeakerPageAndResourceColumns();
  console.log('Columns ready.');

  console.log('Seeding SessionFormats + default Track...');
  await seedSessionLookups();
  console.log('Session lookups ready.');

  console.log('Adding Session Sponsors/Tags/Authors tables...');
  await applySessionSponsorsTagsAuthors();
  console.log('Session sponsor/tag/author tables ready.');

  console.log('Replacing Admin sidebar with the new 7-section taxonomy...');
  await applyNewAdminNavTaxonomy();
  console.log('Admin sidebar taxonomy ready.');

  console.log('Adding Categories table...');
  await applyCategories();
  console.log('Categories ready.');

  console.log('Applying Dashboard/sidebar quick-fixes batch...');
  await applySidebarQuickfixes();
  console.log('Sidebar quick-fixes ready.');

  console.log('Nesting Event Content into Branding/Agenda/Speaker/Exhibitor/Sponsor Center groups...');
  await applyNestedTaxonomy();
  console.log('Nested taxonomy ready.');

  console.log('Normalizing legacy/duplicate Admin sidebar items...');
  await normalizeAdminNavDuplicates();
  console.log('Admin sidebar items normalized.');

  console.log('Adding Exhibitor Manager fields (Slogan, Address, Secondary Contact, Categories)...');
  await applyExhibitorFields();
  console.log('Exhibitor fields ready.');

  console.log('Adding Event Webpage settings + Session Q&A indexes...');
  await applyEventWebpageSettings();
  console.log('Event Webpage settings and Q&A indexes ready.');

  console.log('Adding Sponsor video thumbnail media field...');
  await applySponsorVideoThumbnail();
  console.log('Sponsor video thumbnail field ready.');

  console.log('Adding Category Manager palette colors...');
  await applyCategoryColor();
  console.log('Category palette colors ready.');

  console.log('Adding Exhibitor photo/video media fields...');
  await applyExhibitorMediaFields();
  console.log('Exhibitor media fields ready.');

  console.log('Adding Speaker Manager social/form-link fields...');
  await applySpeakerManagementFields();
  console.log('Speaker Manager fields ready.');

  console.log('Adding Video Hosting + Attendee Video Access...');
  await applyVideoHostingAndAccess();
  console.log('Video Hosting + Attendee Video Access ready.');

  console.log('Adding Documents/Video Hosting/Attendee Video Access sidebar items...');
  await applyDocumentsVideoNav();
  console.log('Documents/Video sidebar items ready.');

  console.log('Adding Event Admin Settings storage...');
  await applyEventAdminSettings();
  console.log('Event Admin Settings ready.');

  console.log('Adding Settings sidebar menu...');
  await applySettingsNav();

  console.log('Adding requested EMS Admin modules...');
  await applyRequestedAdminModules();
  console.log('Requested EMS modules ready.');

  console.log('Re-normalizing Admin sidebar after requested modules...');
  await normalizeAdminNavDuplicates();
  console.log('Admin sidebar normalization complete.');

  console.log('Adding real-time Event Analytics storage...');
  await applyEventAnalytics();
  console.log('Event Analytics ready.');
  console.log('Settings sidebar ready.');

  console.log('Aligning Engage & Network sidebar with legacy EMS Admin...');
  await applyEngageNetworkNav();
  console.log('Engage & Network sidebar ready.');

  console.log('Adding session-scoped Discussion Topics (SessionId column)...');
  await applyDiscussionTopicSession();
  console.log('Discussion Topics SessionId ready.');
  console.log('');
  console.log('Next: npm run dev — the backend seeds demo data automatically');
  console.log('if the Organizations table is empty.');
  console.log('');
  console.log('If you previously hit a seed error and have partial data, run:');
  console.log('  npm run reset-seed');
  console.log('before starting the backend again.');

  await pool.end();
}

main().catch(async (err) => {
  console.error('Migration failed:', err.message);
  process.exitCode = 1;
  await pool.end();
});
