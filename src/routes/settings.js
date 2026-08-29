import { Router } from 'express';
import { getEventById, getEventAdminSettings, updateEventAdminSettings } from '../data/store.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

async function assertOwnedEvent(req, res) {
  const event = await getEventById(req.params.eventId);
  if (!event || event.OrganizationId !== req.user.organizationId) { res.status(404).json({ error: 'Event not found.' }); return null; }
  return event;
}

router.get('/', async (req,res,next) => { try { if (!await assertOwnedEvent(req,res)) return; res.json(await getEventAdminSettings(req.params.eventId)); } catch(e){ next(e); } });
router.patch('/', async (req,res,next) => { try { if (!await assertOwnedEvent(req,res)) return; res.json(await updateEventAdminSettings(req.params.eventId, req.body || {})); } catch(e){ next(e); } });

export default router;
