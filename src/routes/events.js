import { Router } from 'express';
import {
  getEventsForOrg,
  getEventById,
  createEvent,
  updateEvent,
  getSponsorsForEvent,
  getSessionsForEvent,
  getSpeakersForEvent,
  getAttendeesForEvent,
  getAdminNavTree,
  getBrandingForEvent,
  upsertBrandingForEvent,
  getEventTypes,
  getWebsiteTheme,
  upsertWebsiteTheme,
  getResourceItemsForEvent,
  createCustomResourceItem,
  updateResourceItem,
  deleteResourceItem,
  reorderResourceItems,
} from '../data/store.js';
import {
  serializeEvent,
  serializeSponsor,
  serializeAdminNavNode,
  serializeEventType,
  serializeWebsiteTheme,
  serializeResourceItem,
} from '../data/serializers.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// GET /api/events - list events for the logged-in user's organization,
// split into current (Published/Draft, end date in future) and past.
router.get('/', async (req, res, next) => {
  try {
    const events = await getEventsForOrg(req.user.organizationId);
    const todayStr = new Date().toISOString().slice(0, 10);

    // Fetch branding + real rollup counts for each event so dashboard
    // stat cards (Total Speakers/Sponsors/Attendees) reflect actual
    // data instead of always reading as 0 — the list endpoint
    // previously never computed counts at all, unlike the single-
    // event endpoint below, which is why every dashboard number was
    // silently stuck at its `?? 0` fallback.
    const serialized = await Promise.all(
      events.map(async (e) => {
        const [branding, sponsors, sessions, speakers, attendees] = await Promise.all([
          getBrandingForEvent(e.EventId),
          getSponsorsForEvent(e.EventId),
          getSessionsForEvent(e.EventId),
          getSpeakersForEvent(e.EventId),
          getAttendeesForEvent(e.EventId),
        ]);
        return {
          ...serializeEvent(e, branding),
          counts: {
            sponsors: sponsors.length,
            sessions: sessions.length,
            speakers: speakers.length,
            attendees: attendees.length,
          },
        };
      })
    );

    const current = serialized.filter((e) => !e.endDate || e.endDate >= todayStr);
    const past = serialized.filter((e) => e.endDate && e.endDate < todayStr);

    res.json({ current, past });
  } catch (err) {
    next(err);
  }
});

// GET /api/events/nav - Admin sidebar structure, read from AdminNavItems
router.get('/nav', async (req, res, next) => {
  try {
    const tree = await getAdminNavTree();
    res.json(tree.map(serializeAdminNavNode));
  } catch (err) {
    next(err);
  }
});

// GET /api/events/event-types - lookup list for the event-type dropdown
router.get('/event-types', async (req, res, next) => {
  try {
    const types = await getEventTypes();
    res.json(types.map(serializeEventType));
  } catch (err) {
    next(err);
  }
});

// GET /api/events/:id - single event with rollup counts
router.get('/:id', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.OrganizationId !== req.user.organizationId) {
      return res.status(404).json({ error: 'Event not found.' });
    }

    const [branding, sponsors, sessions, speakers, attendees] = await Promise.all([
      getBrandingForEvent(event.EventId),
      getSponsorsForEvent(event.EventId),
      getSessionsForEvent(event.EventId),
      getSpeakersForEvent(event.EventId),
      getAttendeesForEvent(event.EventId),
    ]);

    res.json({
      ...serializeEvent(event, branding),
      counts: {
        sponsors: sponsors.length,
        sessions: sessions.length,
        speakers: speakers.length,
        attendees: attendees.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/events - create a new event (Draft by default)
router.post('/', async (req, res, next) => {
  try {
    const event = await createEvent(req.user.organizationId, req.user.sub, req.body || {});
    res.status(201).json(serializeEvent(event));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/events/:id - update event fields (used by Basic Information form, publish toggle, etc.)
router.patch('/:id', async (req, res, next) => {
  try {
    const existing = await getEventById(req.params.id);
    if (!existing || existing.OrganizationId !== req.user.organizationId) {
      return res.status(404).json({ error: 'Event not found.' });
    }

    const updated = await updateEvent(req.params.id, req.body || {});
    const branding = await getBrandingForEvent(req.params.id);
    res.json(serializeEvent(updated, branding));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/events/:id/branding - dedicated branding update (logo, hero image, colors, tagline)
// Writes to AppBrandings (tagline/colors/logo) and Event.BannerImageUrl (hero image),
// since the real schema splits these across two tables.
router.patch('/:id/branding', async (req, res, next) => {
  try {
    const existing = await getEventById(req.params.id);
    if (!existing || existing.OrganizationId !== req.user.organizationId) {
      return res.status(404).json({ error: 'Event not found.' });
    }

    const { logoUrl, heroImageUrl, brandColorFrom, brandColorTo, tagline } = req.body || {};

    const branding = await upsertBrandingForEvent(req.params.id, existing.Title, {
      ...(logoUrl !== undefined && { logoUrl }),
      ...(brandColorFrom !== undefined && { brandColorFrom }),
      ...(brandColorTo !== undefined && { brandColorTo }),
      ...(tagline !== undefined && { tagline }),
    });

    let updatedEvent = existing;
    if (heroImageUrl !== undefined) {
      updatedEvent = await updateEvent(req.params.id, { heroImageUrl });
    }

    res.json(serializeEvent(updatedEvent, branding));
  } catch (err) {
    next(err);
  }
});

// POST /api/events/:id/publish - convenience endpoint to flip status
router.post('/:id/publish', async (req, res, next) => {
  try {
    const existing = await getEventById(req.params.id);
    if (!existing || existing.OrganizationId !== req.user.organizationId) {
      return res.status(404).json({ error: 'Event not found.' });
    }

    const updated = await updateEvent(req.params.id, { status: 'Published' });
    const branding = await getBrandingForEvent(req.params.id);
    res.json(serializeEvent(updated, branding));
  } catch (err) {
    next(err);
  }
});

// GET /api/events/:id/sponsors
router.get('/:id/sponsors', async (req, res, next) => {
  try {
    const existing = await getEventById(req.params.id);
    if (!existing || existing.OrganizationId !== req.user.organizationId) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const sponsors = await getSponsorsForEvent(req.params.id);
    res.json(sponsors.map(serializeSponsor));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Web App Speaker Page: banner pattern + speaker card style
// ---------------------------------------------------------------------

// GET /api/events/:id/speaker-page
router.get('/:id/speaker-page', async (req, res, next) => {
  try {
    const existing = await getEventById(req.params.id);
    if (!existing || existing.OrganizationId !== req.user.organizationId) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const theme = await getWebsiteTheme(req.params.id);
    res.json(serializeWebsiteTheme(theme) || { speakerPageBannerPattern: 'Gradient', speakerCardStyle: 'FullWidth', speakerGridColumns: 4 });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/events/:id/speaker-page
router.patch('/:id/speaker-page', async (req, res, next) => {
  try {
    const existing = await getEventById(req.params.id);
    if (!existing || existing.OrganizationId !== req.user.organizationId) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const { speakerPageBannerPattern, speakerCardStyle, speakerGridColumns } = req.body || {};
    const updated = await upsertWebsiteTheme(req.params.id, existing.Title, {
      ...(speakerPageBannerPattern !== undefined && { speakerPageBannerPattern }),
      ...(speakerCardStyle !== undefined && { speakerCardStyle }),
      ...(speakerGridColumns !== undefined && { speakerGridColumns: Number(speakerGridColumns) || 4 }),
    });
    res.json(serializeWebsiteTheme(updated));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Customize Resources: manage the Portal Resources submenu
// ---------------------------------------------------------------------

// GET /api/events/:id/resources
router.get('/:id/resources', async (req, res, next) => {
  try {
    const existing = await getEventById(req.params.id);
    if (!existing || existing.OrganizationId !== req.user.organizationId) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const items = await getResourceItemsForEvent(req.params.id);
    res.json(items.map(serializeResourceItem));
  } catch (err) {
    next(err);
  }
});

// POST /api/events/:id/resources - add a custom resource (max 5)
router.post('/:id/resources', async (req, res, next) => {
  try {
    const existing = await getEventById(req.params.id);
    if (!existing || existing.OrganizationId !== req.user.organizationId) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const { label, icon, route } = req.body || {};
    if (!label) {
      return res.status(400).json({ error: 'Label is required.' });
    }
    const created = await createCustomResourceItem(req.params.id, { label, icon, route });
    res.status(201).json(serializeResourceItem(created));
  } catch (err) {
    if (err.message.includes('Maximum 5')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// PATCH /api/events/:id/resources/reorder - drag-to-reorder, body: { orderedItemIds: [...] }
// Registered BEFORE /:id/resources/:itemId — otherwise Express would
// match "reorder" as an :itemId value on the more specific route below.
router.patch('/:id/resources/reorder', async (req, res, next) => {
  try {
    const existing = await getEventById(req.params.id);
    if (!existing || existing.OrganizationId !== req.user.organizationId) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const { orderedItemIds } = req.body || {};
    if (!Array.isArray(orderedItemIds)) {
      return res.status(400).json({ error: 'orderedItemIds must be an array.' });
    }
    await reorderResourceItems(req.params.id, orderedItemIds);
    const items = await getResourceItemsForEvent(req.params.id);
    res.json(items.map(serializeResourceItem));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/events/:id/resources/:itemId - toggle visibility, edit label/icon/route
router.patch('/:id/resources/:itemId', async (req, res, next) => {
  try {
    const existing = await getEventById(req.params.id);
    if (!existing || existing.OrganizationId !== req.user.organizationId) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const { label, icon, route, isVisible } = req.body || {};
    const updated = await updateResourceItem(req.params.itemId, {
      ...(label !== undefined && { label }),
      ...(icon !== undefined && { icon }),
      ...(route !== undefined && { route }),
      ...(isVisible !== undefined && { isVisible }),
    });
    if (!updated) {
      return res.status(404).json({ error: 'Resource item not found.' });
    }
    res.json(serializeResourceItem(updated));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/events/:id/resources/:itemId - only custom items can be deleted
router.delete('/:id/resources/:itemId', async (req, res, next) => {
  try {
    const existing = await getEventById(req.params.id);
    if (!existing || existing.OrganizationId !== req.user.organizationId) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const result = await deleteResourceItem(req.params.itemId);
    if (!result.deleted) {
      if (result.reason === 'built_in') {
        return res.status(400).json({ error: 'Built-in resources cannot be deleted — disable them instead.' });
      }
      return res.status(404).json({ error: 'Resource item not found.' });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
