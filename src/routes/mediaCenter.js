import { Router } from 'express';
import {
  getEventById,
  getEventDocuments,
  getSessionLinkedDocuments,
  createEventDocument,
  deleteEventDocument,
  reorderEventDocuments,
  getEventVideos,
  getVideoStorageUsage,
  createEventVideo,
  deleteEventVideo,
  getTicketTypesWithVideoAccess,
  setTicketTypeVideoAccess,
  getAttendeeVideoAccessEnabled,
  setAttendeeVideoAccessEnabled,
} from '../data/store.js';
import {
  serializeEventDocument,
  serializeEventVideo,
  serializeTicketTypeVideoAccess,
} from '../data/serializers.js';
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

// ---------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------

// GET /api/events/:eventId/documents - both lists together
router.get('/documents', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const [eventDocs, sessionDocs] = await Promise.all([
      getEventDocuments(req.params.eventId),
      getSessionLinkedDocuments(req.params.eventId),
    ]);
    res.json({
      eventDocuments: eventDocs.map(serializeEventDocument),
      sessionDocuments: sessionDocs.map(serializeEventDocument),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/events/:eventId/documents - upload an event-wide document
router.post('/documents', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const { title, fileUrl, fileType, fileSizeKb } = req.body || {};
    if (!title || !fileUrl) {
      return res.status(400).json({ error: 'title and fileUrl are required.' });
    }
    const created = await createEventDocument(req.params.eventId, req.user.sub, { title, fileUrl, fileType, fileSizeKb });
    res.status(201).json(serializeEventDocument(created));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/events/:eventId/documents/reorder - registered before
// /:documentId for the same reason as every other reorder route in
// this app: a static path must come before a dynamic one.
router.patch('/documents/reorder', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const { orderedDocumentIds } = req.body || {};
    if (!Array.isArray(orderedDocumentIds)) {
      return res.status(400).json({ error: 'orderedDocumentIds must be an array.' });
    }
    await reorderEventDocuments(req.params.eventId, orderedDocumentIds);
    const docs = await getEventDocuments(req.params.eventId);
    res.json(docs.map(serializeEventDocument));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/events/:eventId/documents/:documentId
router.delete('/documents/:documentId', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    await deleteEventDocument(req.params.documentId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Video Hosting
// ---------------------------------------------------------------------

// GET /api/events/:eventId/videos
router.get('/videos', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const [videos, usage] = await Promise.all([
      getEventVideos(req.params.eventId),
      getVideoStorageUsage(req.params.eventId),
    ]);
    res.json({
      videos: videos.map(serializeEventVideo),
      usedKb: Number(usage.UsedKB),
      quotaKb: usage.QuotaKB,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/events/:eventId/videos
router.post('/videos', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const { title, fileUrl, fileSizeKb } = req.body || {};
    if (!title || !fileUrl || !fileSizeKb) {
      return res.status(400).json({ error: 'title, fileUrl, and fileSizeKb are required.' });
    }
    const created = await createEventVideo(req.params.eventId, req.user.sub, { title, fileUrl, fileSizeKb });
    res.status(201).json(serializeEventVideo(created));
  } catch (err) {
    if (err.code === 'STORAGE_QUOTA_EXCEEDED') {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// DELETE /api/events/:eventId/videos/:eventVideoId
router.delete('/videos/:eventVideoId', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    await deleteEventVideo(req.params.eventVideoId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Attendee Video Access
// ---------------------------------------------------------------------

// GET /api/events/:eventId/video-access
router.get('/video-access', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const [ticketTypes, enabled] = await Promise.all([
      getTicketTypesWithVideoAccess(req.params.eventId),
      getAttendeeVideoAccessEnabled(req.params.eventId),
    ]);
    res.json({
      enabled,
      ticketTypes: ticketTypes.map(serializeTicketTypeVideoAccess),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/events/:eventId/video-access/enable
router.patch('/video-access/enable', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const { enabled } = req.body || {};
    const result = await setAttendeeVideoAccessEnabled(req.params.eventId, Boolean(enabled));
    res.json({ enabled: result });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/events/:eventId/video-access/:ticketTypeId
router.patch('/video-access/:ticketTypeId', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const { hasVideoAccess } = req.body || {};
    const updated = await setTicketTypeVideoAccess(req.params.ticketTypeId, Boolean(hasVideoAccess));
    res.json({ ticketTypeId: updated.TicketTypeId, hasVideoAccess: updated.HasVideoAccess });
  } catch (err) {
    next(err);
  }
});

export default router;
