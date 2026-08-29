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

router.get('/', async (req, res, next) => {
  try {
    if (!await assertOwnedEvent(req, res)) return;
    const eventId = req.params.eventId;
    const start = req.query.start ? new Date(req.query.start) : new Date(Date.now() - 30 * 86400000);
    const end = req.query.end ? new Date(req.query.end) : new Date();
    const startIso = Number.isNaN(start.getTime()) ? new Date(Date.now() - 30 * 86400000) : start;
    const endIso = Number.isNaN(end.getTime()) ? new Date() : end;

    const [summary, daily, sessions, devices, locations] = await Promise.all([
      pool.query(`SELECT
        COUNT(*) FILTER (WHERE "EventType"='page_view')::int AS "pageViews",
        COUNT(DISTINCT "VisitorId") FILTER (WHERE "VisitorId" IS NOT NULL)::int AS "uniqueVisitors",
        COUNT(*) FILTER (WHERE "EventType"='session_view')::int AS "sessionViews",
        COUNT(*) FILTER (WHERE "EventType"='speaker_view')::int AS "speakerViews"
        FROM "EventAnalyticsEvents" WHERE "EventId"=$1 AND "CreatedAt">=$2 AND "CreatedAt"<=$3`, [eventId, startIso, endIso]),
      pool.query(`SELECT date_trunc('day',"CreatedAt")::date AS "day",
        COUNT(*) FILTER (WHERE "EventType"='page_view')::int AS "visits",
        COUNT(DISTINCT "VisitorId") FILTER (WHERE "VisitorId" IS NOT NULL)::int AS "users"
        FROM "EventAnalyticsEvents" WHERE "EventId"=$1 AND "CreatedAt">=$2 AND "CreatedAt"<=$3
        GROUP BY 1 ORDER BY 1`, [eventId, startIso, endIso]),
      pool.query(`SELECT COALESCE(a."SessionId", s."SessionId") AS "sessionId", COALESCE(s."Title",'Unknown session') AS "title",
        COUNT(a."AnalyticsEventId")::int AS "views"
        FROM "EventAnalyticsEvents" a LEFT JOIN "Sessions" s ON s."SessionId"=a."SessionId"
        WHERE a."EventId"=$1 AND a."EventType"='session_view' AND a."CreatedAt">=$2 AND a."CreatedAt"<=$3
        GROUP BY 1,2 ORDER BY "views" DESC LIMIT 20`, [eventId, startIso, endIso]),
      pool.query(`SELECT COALESCE("DeviceType",'Unknown') AS "device", COUNT(*)::int AS "visits"
        FROM "EventAnalyticsEvents" WHERE "EventId"=$1 AND "CreatedAt">=$2 AND "CreatedAt"<=$3
        GROUP BY 1 ORDER BY "visits" DESC`, [eventId, startIso, endIso]),
      pool.query(`SELECT COALESCE("City",'Unknown') AS "city", COUNT(*)::int AS "visits"
        FROM "EventAnalyticsEvents" WHERE "EventId"=$1 AND "CreatedAt">=$2 AND "CreatedAt"<=$3
        GROUP BY 1 ORDER BY "visits" DESC LIMIT 10`, [eventId, startIso, endIso]),
    ]);
    res.json({
      range: { start: startIso.toISOString(), end: endIso.toISOString() },
      updatedAt: new Date().toISOString(),
      summary: summary.rows[0],
      daily: daily.rows,
      sessions: sessions.rows,
      devices: devices.rows,
      locations: locations.rows,
    });
  } catch (err) { next(err); }
});

export default router;
