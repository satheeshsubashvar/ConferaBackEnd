import { Router } from 'express';
import {
  getEventById,
  getAllTracksForEvent,
  getTrackById,
  createTrack,
  updateTrack,
  deleteTrack,
  reorderTracks,
} from '../data/store.js';
import { serializeTrack } from '../data/serializers.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router({ mergeParams: true });

router.use(requireAuth);

async function assertOwnedEvent(req, res) {
  const event = await getEventById(req.params.eventId);
  if (!event || event.OrganizationId !== req.user.organizationId) {
    res.status(404).json({ error: 'Event not found.' });
    return null;
  }
  return event;
}

// GET /api/events/:eventId/tracks
router.get('/', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const tracks = await getAllTracksForEvent(req.params.eventId);
    res.json(tracks.map(serializeTrack));
  } catch (err) {
    next(err);
  }
});

// POST /api/events/:eventId/tracks
router.post('/', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;

    const { name } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Track name is required.' });
    }

    const created = await createTrack(req.params.eventId, req.body);
    res.status(201).json(serializeTrack(created));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/events/:eventId/tracks/reorder — registered BEFORE
// /:trackId, same lesson as Resources' reorder route: otherwise
// Express would match "reorder" as a :trackId value.
router.patch('/reorder', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;

    const { orderedTrackIds } = req.body || {};
    if (!Array.isArray(orderedTrackIds)) {
      return res.status(400).json({ error: 'orderedTrackIds must be an array.' });
    }
    await reorderTracks(req.params.eventId, orderedTrackIds);
    const tracks = await getAllTracksForEvent(req.params.eventId);
    res.json(tracks.map(serializeTrack));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/events/:eventId/tracks/:trackId
router.patch('/:trackId', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;

    const existing = await getTrackById(req.params.trackId);
    if (!existing || existing.EventId !== req.params.eventId) {
      return res.status(404).json({ error: 'Track not found.' });
    }

    const updated = await updateTrack(req.params.trackId, req.body || {});
    res.json(serializeTrack(updated));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/events/:eventId/tracks/:trackId
router.delete('/:trackId', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;

    const existing = await getTrackById(req.params.trackId);
    if (!existing || existing.EventId !== req.params.eventId) {
      return res.status(404).json({ error: 'Track not found.' });
    }

    await deleteTrack(req.params.trackId);
    res.status(204).end();
  } catch (err) {
    // Real Postgres FK violation when the track is still assigned to
    // a session (Sessions.TrackId has no ON DELETE CASCADE) — surface
    // that as a clear message instead of a raw 500.
    if (err.code === '23503') {
      return res.status(400).json({ error: 'This track is assigned to one or more sessions and cannot be deleted. Reassign or remove those sessions first.' });
    }
    next(err);
  }
});

export default router;
