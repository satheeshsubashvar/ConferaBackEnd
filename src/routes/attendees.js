import { Router } from 'express';
import multer from 'multer';
import { pool } from '../data/db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendPortalInviteIfNeeded } from '../utils/portalInvite.js';
import { buildExcelHtml, extractRows, rowsToObjects, getCell } from '../utils/excelImportExport.js';

const router = Router({ mergeParams: true });
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const ATTENDEE_HEADERS = ['First Name', 'Last Name', 'Email', 'Company', 'Job Title', 'Role', 'Status'];
router.use(requireAuth);

async function assertEvent(req) {
  const r = await pool.query('SELECT "EventId","OrganizationId" FROM "Event" WHERE "EventId"=$1 AND "IsDeleted"=false',[req.params.eventId]);
  if (!r.rowCount || String(r.rows[0].OrganizationId)!==String(req.user.organizationId)) {
    const e=new Error('Event not found.'); e.status=404; throw e;
  }
}
router.post('/', async (req,res,next)=>{
  const client=await pool.connect();
  try {
    await assertEvent(req);
    const b=req.body||{};
    const email=String(b.email||'').trim().toLowerCase();
    const firstName=String(b.firstName||'').trim();
    const lastName=String(b.lastName||'').trim();
    if(!email||!firstName||!lastName) return res.status(400).json({error:'First name, last name and email are required.'});
    await client.query('BEGIN');
    const normalized=email.toUpperCase();
    let person=await client.query('SELECT * FROM "Person" WHERE "NormalizedEmail"=$1 LIMIT 1',[normalized]);
    let personRow;
    if(person.rowCount) {
      personRow=person.rows[0];
      const updated=await client.query(`UPDATE "Person" SET "FirstName"=$2,"LastName"=$3,"FullName"=$4,"Company"=$5,"JobTitle"=$6,"ProfilePictureUrl"=COALESCE($7,"ProfilePictureUrl") WHERE "PersonId"=$1 RETURNING *`,[personRow.PersonId,firstName,lastName,`${firstName} ${lastName}`.trim(),b.company||null,b.jobTitle||null,b.profilePictureUrl||null]);
      personRow=updated.rows[0];
    } else {
      const r=await client.query(`INSERT INTO "Person" ("Email","NormalizedEmail","PasswordHash","FirstName","LastName","FullName","Company","JobTitle","ProfilePictureUrl") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[email,normalized,'not-a-real-hash-admin',firstName,lastName,`${firstName} ${lastName}`.trim(),b.company||null,b.jobTitle||null,b.profilePictureUrl||null]);
      personRow=r.rows[0];
    }
    const exists=await client.query('SELECT "EventParticipantId" FROM "EventParticipant" WHERE "EventId"=$1 AND "PersonId"=$2 AND "IsDeleted"=false LIMIT 1',[req.params.eventId,personRow.PersonId]);
    if(exists.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({error:'This person is already an attendee for this event.'}); }
    const ep=await client.query(`INSERT INTO "EventParticipant" ("EventId","PersonId","Role","Company","JobTitle","RegistrationCode","Status") VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[req.params.eventId,personRow.PersonId,b.role||'Attendee',b.company||null,b.jobTitle||null,`ATT-${Date.now()}`,b.status||'Confirmed']);
    await client.query('COMMIT');
    // Fire-and-forget — a real Gmail send is a network round-trip with no
    // reason to make the caller wait on it, and this never throws (see its
    // own try/catch).
    sendPortalInviteIfNeeded({
      personId: personRow.PersonId, email: personRow.Email, fullName: personRow.FullName,
      passwordHash: personRow.PasswordHash, eventId: req.params.eventId,
    }).catch(() => {});
    res.status(201).json({EventParticipantId:ep.rows[0].EventParticipantId,PersonId:personRow.PersonId,Role:ep.rows[0].Role,Status:ep.rows[0].Status,Company:ep.rows[0].Company,JobTitle:ep.rows[0].JobTitle,FullName:personRow.FullName,FirstName:personRow.FirstName,LastName:personRow.LastName,Email:personRow.Email,ProfilePictureUrl:personRow.ProfilePictureUrl,IsActive:ep.rows[0].IsActive});
  } catch(e){await client.query('ROLLBACK').catch(()=>{});next(e)} finally{client.release()}
});

router.get('/',async(req,res,next)=>{try{await assertEvent(req);const r=await pool.query(`SELECT ep."EventParticipantId",ep."Role",ep."Status",ep."Company",ep."JobTitle",ep."RegistrationCode",ep."CheckedInAt",ep."CheckedInBy",ep."CheckInMethod",ep."IsActive",ep."CreatedAt",p."PersonId",p."FirstName",p."LastName",p."FullName",p."Email",p."PhoneNumber",p."ProfilePictureUrl" FROM "EventParticipant" ep JOIN "Person" p ON p."PersonId"=ep."PersonId" WHERE ep."EventId"=$1 AND ep."IsDeleted"=false ORDER BY ep."CreatedAt" DESC`,[req.params.eventId]);res.json(r.rows)}catch(e){next(e)}});

// GET /api/events/:eventId/attendees/template — a real Excel-compatible
// .xls (see utils/excelImportExport.js) so re-uploading it via /import
// below always works, unlike the old plain-.csv template this page used
// to hand out, which broke the moment someone opened it in real Excel
// and saved over it, or uploaded an actual .xlsx list instead.
router.get('/template', async (req, res, next) => {
  try {
    await assertEvent(req);
    res.type('application/vnd.ms-excel');
    res.set('Content-Disposition', 'attachment; filename="attendees-import-template.xls"');
    res.send(buildExcelHtml({
      headers: ATTENDEE_HEADERS,
      template: true,
      placeholders: ['John', 'Doe', 'john@example.com', 'Example Ltd', 'Manager', 'Attendee', 'Confirmed'],
    }));
  } catch (err) { next(err); }
});

// GET /api/events/:eventId/attendees/export
router.get('/export', async (req, res, next) => {
  try {
    await assertEvent(req);
    const r = await pool.query(
      `SELECT ep."Role",ep."Status",ep."Company",ep."JobTitle",p."FirstName",p."LastName",p."Email" FROM "EventParticipant" ep JOIN "Person" p ON p."PersonId"=ep."PersonId" WHERE ep."EventId"=$1 AND ep."IsDeleted"=false ORDER BY ep."CreatedAt" DESC`,
      [req.params.eventId]
    );
    const rows = r.rows.map((x) => [x.FirstName, x.LastName, x.Email, x.Company, x.JobTitle, x.Role, x.Status]);
    res.type('application/vnd.ms-excel');
    res.set('Content-Disposition', `attachment; filename="attendees-${req.params.eventId}.xls"`);
    res.send(buildExcelHtml({ headers: ATTENDEE_HEADERS, rows }));
  } catch (err) { next(err); }
});

// POST /api/events/:eventId/attendees/import — bulk-add attendees from
// a real uploaded file (the template above, a re-saved-in-Excel copy
// of it, or a plain CSV/TSV) instead of the old approach of the
// frontend hand-parsing CSV text client-side and posting JSON — that
// never understood real .xlsx files (binary bytes fed through a CSV
// parser produced garbage rows, which then failed the INSERT and 500'd
// the *entire* import, taking already-imported rows down with it since
// they all shared one transaction). Each row now gets its own
// mini-transaction and its own try/catch, matching Exhibitor/Sponsor
// import: one bad row is reported and skipped, the rest of the batch
// still goes through.
router.post('/import', importUpload.single('file'), async (req, res, next) => {
  try {
    await assertEvent(req);
    if (!req.file) return res.status(400).json({ error: 'Please select an Excel/CSV file.' });

    const objects = rowsToObjects(extractRows(req.file.buffer));
    if (!objects.length) return res.status(400).json({ error: 'The import file contains no attendee rows.' });

    const results = [];
    const invites = [];
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      const email = getCell(o, 'email').trim().toLowerCase();
      if (!email) { results.push({ row: i + 2, status: 'Failed', error: 'Missing email address.' }); continue; }

      const firstName = getCell(o, 'first name') || 'Attendee';
      const lastName = getCell(o, 'last name') || 'Guest';
      const fullName = `${firstName} ${lastName}`.trim();
      const company = getCell(o, 'company') || null;
      const jobTitle = getCell(o, 'job title') || null;
      const role = getCell(o, 'role') || 'Attendee';
      const status = getCell(o, 'status') || 'Confirmed';

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const normalized = email.toUpperCase();
        const person = await client.query('SELECT "PersonId","PasswordHash" FROM "Person" WHERE "NormalizedEmail"=$1 LIMIT 1', [normalized]);
        let personId, passwordHash;
        if (person.rowCount) {
          personId = person.rows[0].PersonId; passwordHash = person.rows[0].PasswordHash;
        } else {
          const r = await client.query('INSERT INTO "Person" ("Email","NormalizedEmail","PasswordHash","FirstName","LastName","FullName","Company") VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING "PersonId","PasswordHash"', [email, normalized, 'not-a-real-hash-import', firstName, lastName, fullName, company]);
          personId = r.rows[0].PersonId; passwordHash = r.rows[0].PasswordHash;
        }
        const exists = await client.query('SELECT "EventParticipantId" FROM "EventParticipant" WHERE "EventId"=$1 AND "PersonId"=$2 AND "IsDeleted"=false LIMIT 1', [req.params.eventId, personId]);
        if (exists.rowCount) {
          await client.query('ROLLBACK');
          results.push({ row: i + 2, status: 'Failed', error: 'This person is already an attendee for this event.' });
          continue;
        }
        const epRes = await client.query(`INSERT INTO "EventParticipant" ("EventId","PersonId","Role","Company","JobTitle","RegistrationCode","Status") VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING "EventParticipantId"`, [req.params.eventId, personId, role, company, jobTitle, `ATT-${Date.now()}-${i + 1}`, status]);
        await client.query('COMMIT');
        results.push({ row: i + 2, status: 'Imported', eventParticipantId: epRes.rows[0].EventParticipantId });
        invites.push({ personId, email, fullName, passwordHash });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        results.push({ row: i + 2, status: 'Failed', error: err.message });
      } finally {
        client.release();
      }
    }

    // Fire after all rows are committed, and NOT awaited — see
    // routes/exhibitors.js / sponsorCenter.js for the same pattern.
    // sendPortalInviteIfNeeded never throws (its own try/catch), so
    // there's nothing to lose by letting these run in the background.
    invites.forEach((invite) => {
      sendPortalInviteIfNeeded({ ...invite, eventId: req.params.eventId }).catch(() => {});
    });

    res.status(201).json({
      imported: results.filter((r) => r.status === 'Imported').length,
      failed: results.filter((r) => r.status === 'Failed').length,
      results,
    });
  } catch (err) { next(err); }
});

router.patch('/:id',async(req,res,next)=>{try{
  await assertEvent(req); const b=req.body||{};
  const current=await pool.query(`SELECT ep.*,p."PersonId" FROM "EventParticipant" ep JOIN "Person" p ON p."PersonId"=ep."PersonId" WHERE ep."EventId"=$1 AND ep."EventParticipantId"=$2 AND ep."IsDeleted"=false`,[req.params.eventId,req.params.id]);
  if(!current.rowCount)return res.status(404).json({error:'Attendee not found.'});
  const allowed={status:'Status',company:'Company',jobTitle:'JobTitle',role:'Role',isActive:'IsActive',isProfilePublic:'IsProfilePublic',internalNotes:'InternalNotes'};const sets=[],vals=[req.params.eventId,req.params.id];
  for(const[k,c] of Object.entries(allowed)){if(b[k]!==undefined){sets.push(`"${c}"=$${vals.length+1}`);vals.push(b[k])}}
  sets.push(`"UpdatedAt"=(now() AT TIME ZONE 'utc')`);
  const r=await pool.query(`UPDATE "EventParticipant" SET ${sets.join(',')} WHERE "EventId"=$1 AND "EventParticipantId"=$2 AND "IsDeleted"=false RETURNING *`,vals);
  if(b.profilePictureUrl!==undefined){await pool.query(`UPDATE "Person" SET "ProfilePictureUrl"=$2 WHERE "PersonId"=$1`,[current.rows[0].PersonId,b.profilePictureUrl||null])}
  res.json(r.rows[0]);
}catch(e){next(e)}});
router.post('/:id/checkin',async(req,res,next)=>{try{await assertEvent(req);const r=await pool.query(`INSERT INTO "CheckIns" ("EventId","EventParticipantId","StaffId","Gate","Location","Device","CheckInType","CheckInDirection","Notes") VALUES ($1,$2,$3,$4,$5,$6,$7,'In',$8,$9) RETURNING *`,[req.params.eventId,req.params.id,req.user.sub,req.body?.gate||null,req.body?.location||null,req.body?.device||null,req.body?.checkInType||'Manual',req.body?.notes||null]);await pool.query(`UPDATE "EventParticipant" SET "CheckedInAt"=(now() AT TIME ZONE 'utc'),"CheckedInBy"=$3,"CheckInMethod"=$4,"UpdatedAt"=(now() AT TIME ZONE 'utc') WHERE "EventId"=$1 AND "EventParticipantId"=$2`,[req.params.eventId,req.params.id,req.user.sub,req.body?.checkInType||'Manual']);res.status(201).json(r.rows[0])}catch(e){next(e)}});
router.post('/:id/checkout',async(req,res,next)=>{try{await assertEvent(req);const r=await pool.query(`INSERT INTO "CheckIns" ("EventId","EventParticipantId","StaffId","Gate","Location","Device","CheckInType","CheckInDirection","Notes") VALUES ($1,$2,$3,$4,$5,$6,$7,'Out',$8,$9) RETURNING *`,[req.params.eventId,req.params.id,req.user.sub,req.body?.gate||null,req.body?.location||null,req.body?.device||null,req.body?.checkInType||'Manual',req.body?.notes||null]);res.status(201).json(r.rows[0])}catch(e){next(e)}});
export default router;
