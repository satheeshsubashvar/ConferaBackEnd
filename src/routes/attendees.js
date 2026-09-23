import { Router } from 'express';
import { pool } from '../data/db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendPortalInviteIfNeeded } from '../utils/portalInvite.js';

const router = Router({ mergeParams: true });
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

router.post('/import', async (req,res,next)=>{
  const client = await pool.connect();
  try {
    await assertEvent(req);
    const attendees = Array.isArray(req.body?.attendees) ? req.body.attendees : [];
    if (!attendees.length) return res.status(400).json({error:'No attendees supplied.'});
    await client.query('BEGIN');
    const created=[];
    const invites=[];
    for (const a of attendees) {
      const email=String(a.email||'').trim().toLowerCase();
      if (!email) continue;
      const firstName=String(a.firstName||'').trim() || 'Attendee';
      const lastName=String(a.lastName||'').trim() || 'Guest';
      const fullName=`${firstName} ${lastName}`.trim();
      const normalized=email.toUpperCase();
      let person=await client.query('SELECT "PersonId","PasswordHash" FROM "Person" WHERE "NormalizedEmail"=$1 LIMIT 1',[normalized]);
      let personId, passwordHash;
      if(person.rowCount) { personId=person.rows[0].PersonId; passwordHash=person.rows[0].PasswordHash; }
      else {
        const r=await client.query('INSERT INTO "Person" ("Email","NormalizedEmail","PasswordHash","FirstName","LastName","FullName","Company") VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING "PersonId","PasswordHash"',[email,normalized,'not-a-real-hash-import',firstName,lastName,fullName,a.company||null]);
        personId=r.rows[0].PersonId; passwordHash=r.rows[0].PasswordHash;
      }
      const exists=await client.query('SELECT "EventParticipantId" FROM "EventParticipant" WHERE "EventId"=$1 AND "PersonId"=$2 AND "IsDeleted"=false LIMIT 1',[req.params.eventId,personId]);
      if(exists.rowCount) continue;
      const r=await client.query(`INSERT INTO "EventParticipant" ("EventId","PersonId","Role","Company","JobTitle","RegistrationCode","Status") VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING "EventParticipantId"`,[req.params.eventId,personId,a.role||'Attendee',a.company||null,a.jobTitle||null,`ATT-${Date.now()}-${created.length+1}`,a.status||'Confirmed']);
      created.push(r.rows[0].EventParticipantId);
      invites.push({personId,email,fullName,passwordHash});
    }
    await client.query('COMMIT');
    // Fire after commit, and NOT awaited — this is what made bulk imports
    // slow. With real SMTP now configured, each invite is a genuine
    // network round-trip to Gmail (hundreds of ms to a few seconds); an
    // import of 30+ rows was taking 30+ seconds because every row's email
    // was sent one at a time before the response could go out. Since
    // sendPortalInviteIfNeeded never throws (see its own try/catch), there's
    // nothing to lose by letting all of these run in the background while
    // the response returns immediately.
    invites.forEach((invite) => {
      sendPortalInviteIfNeeded({ ...invite, eventId: req.params.eventId }).catch(() => {});
    });
    res.status(201).json({created:created.length});
  } catch(e){ await client.query('ROLLBACK').catch(()=>{}); next(e); } finally { client.release(); }
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
