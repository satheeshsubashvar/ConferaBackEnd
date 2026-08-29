import { Router } from 'express';
import { pool } from '../data/db.js';
import { getEventById } from '../data/store.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

async function assertOwnedEvent(req, res) {
  const event = await getEventById(req.params.eventId);
  if (!event || String(event.OrganizationId) !== String(req.user.organizationId)) {
    res.status(404).json({ error: 'Event not found.' });
    return null;
  }
  return event;
}

function cleanModuleKey(value) {
  return String(value || '').trim().toLowerCase();
}

router.get('/:moduleKey', async (req, res, next) => {
  try {
    if (!await assertOwnedEvent(req, res)) return;
    const moduleKey = cleanModuleKey(req.params.moduleKey);
    if (!moduleKey) return res.status(400).json({ error: 'Module key is required.' });

    const { rows } = await pool.query(
      `SELECT "EmsModuleRecordId" AS "id", "EventId" AS "eventId",
              "ModuleKey" AS "moduleKey", "Data" AS "data",
              "CreatedAt" AS "createdAt", "UpdatedAt" AS "updatedAt"
       FROM "EmsModuleRecords"
       WHERE "EventId"=$1 AND "ModuleKey"=$2 AND "IsDeleted"=false
       ORDER BY "CreatedAt" DESC`,
      [req.params.eventId, moduleKey]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/:moduleKey', async (req, res, next) => {
  try {
    if (!await assertOwnedEvent(req, res)) return;
    const moduleKey = cleanModuleKey(req.params.moduleKey);
    const data = req.body?.data;
    if (!moduleKey || !data || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(400).json({ error: 'A valid module key and data object are required.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO "EmsModuleRecords" ("EventId","ModuleKey","Data")
       VALUES ($1,$2,$3::jsonb)
       RETURNING "EmsModuleRecordId" AS "id", "EventId" AS "eventId",
                 "ModuleKey" AS "moduleKey", "Data" AS "data",
                 "CreatedAt" AS "createdAt", "UpdatedAt" AS "updatedAt"`,
      [req.params.eventId, moduleKey, JSON.stringify(data)]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.patch('/:moduleKey/:recordId', async (req, res, next) => {
  try {
    if (!await assertOwnedEvent(req, res)) return;
    const moduleKey = cleanModuleKey(req.params.moduleKey);
    const data = req.body?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(400).json({ error: 'A valid data object is required.' });
    }

    const { rows } = await pool.query(
      `UPDATE "EmsModuleRecords"
       SET "Data"=$1::jsonb, "UpdatedAt"=CURRENT_TIMESTAMP
       WHERE "EmsModuleRecordId"=$2 AND "EventId"=$3 AND "ModuleKey"=$4 AND "IsDeleted"=false
       RETURNING "EmsModuleRecordId" AS "id", "EventId" AS "eventId",
                 "ModuleKey" AS "moduleKey", "Data" AS "data",
                 "CreatedAt" AS "createdAt", "UpdatedAt" AS "updatedAt"`,
      [JSON.stringify(data), req.params.recordId, req.params.eventId, moduleKey]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Record not found.' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:moduleKey/:recordId', async (req, res, next) => {
  try {
    if (!await assertOwnedEvent(req, res)) return;
    const moduleKey = cleanModuleKey(req.params.moduleKey);
    const { rowCount } = await pool.query(
      `UPDATE "EmsModuleRecords"
       SET "IsDeleted"=true, "UpdatedAt"=CURRENT_TIMESTAMP
       WHERE "EmsModuleRecordId"=$1 AND "EventId"=$2 AND "ModuleKey"=$3 AND "IsDeleted"=false`,
      [req.params.recordId, req.params.eventId, moduleKey]
    );
    if (!rowCount) return res.status(404).json({ error: 'Record not found.' });
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
