import { Router } from 'express';
import {
  getEventById, getWebPageSettings, updateWebPageSettings,
} from '../data/store.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

const PAGE_KEYS = new Set(['agenda', 'speaker', 'sponsor', 'exhibitor']);

async function assertOwnedEvent(req, res) {
  const event = await getEventById(req.params.eventId);
  if (!event || event.OrganizationId !== req.user.organizationId) {
    res.status(404).json({ error: 'Event not found.' });
    return null;
  }
  return event;
}

router.get('/:pageKey', async (req, res, next) => {
  try {
    if (!await assertOwnedEvent(req, res)) return;
    if (!PAGE_KEYS.has(req.params.pageKey)) return res.status(400).json({ error: 'Unknown webpage.' });
    res.json(await getWebPageSettings(req.params.eventId, req.params.pageKey));
  } catch (err) { next(err); }
});

router.patch('/:pageKey', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    if (!PAGE_KEYS.has(req.params.pageKey)) return res.status(400).json({ error: 'Unknown webpage.' });

    const allowed = ['enabled', 'title', 'intro', 'layout', 'showSearch', 'showFilters'];
    const patch = {};
    for (const key of allowed) if (req.body?.[key] !== undefined) patch[key] = req.body[key];
    if (patch.layout && !['cards', 'list', 'compact'].includes(patch.layout)) {
      return res.status(400).json({ error: 'Invalid webpage layout.' });
    }
    if (patch.title !== undefined && String(patch.title).trim().length > 200) {
      return res.status(400).json({ error: 'Page title is too long.' });
    }
    res.json(await updateWebPageSettings(
      req.params.eventId, event.Title, req.params.pageKey, patch
    ));
  } catch (err) { next(err); }
});

export default router;
