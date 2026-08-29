import { Router } from 'express';
import {
  getEventById, getSessionQAForEvent, getSessionQAById,
  updateSessionQA, deleteSessionQA,
} from '../data/store.js';
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

function serializeQuestion(row) {
  return {
    id: row.QuestionId,
    sessionId: row.SessionId,
    sessionTitle: row.SessionTitle || '',
    startTime: row.StartTime,
    endTime: row.EndTime,
    question: row.QuestionText || '',
    askedBy: row.IsAnonymous ? 'Anonymous' : (row.AskedFullName || `${row.AskedFirstName || ''} ${row.AskedLastName || ''}`.trim()),
    askedByEmail: row.IsAnonymous ? '' : (row.AskedEmail || ''),
    isAnonymous: !!row.IsAnonymous,
    isAnswered: !!row.IsAnswered,
    answerText: row.AnswerText || '',
    answeredBy: row.AnsweredFullName || '',
    upvoteCount: row.UpvoteCount || 0,
    isApproved: !!row.IsApproved,
    isPinned: !!row.IsPinned,
    status: row.Status || (row.IsApproved ? 'Approved' : 'Pending'),
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt,
  };
}

router.get('/', async (req, res, next) => {
  try {
    if (!await assertOwnedEvent(req, res)) return;
    const rows = await getSessionQAForEvent(req.params.eventId);
    res.json(rows.map(serializeQuestion));
  } catch (err) { next(err); }
});

router.patch('/:questionId', async (req, res, next) => {
  try {
    if (!await assertOwnedEvent(req, res)) return;
    const existing = await getSessionQAById(req.params.questionId);
    if (!existing || existing.EventId !== req.params.eventId) {
      return res.status(404).json({ error: 'Question not found.' });
    }

    const body = req.body || {};
    const patch = {};
    if (body.isApproved !== undefined) {
      patch.isApproved = !!body.isApproved;
      patch.status = body.isApproved ? 'Approved' : 'Rejected';
    }
    if (body.status !== undefined) patch.status = body.status;
    if (body.isPinned !== undefined) patch.isPinned = !!body.isPinned;
    if (body.answerText !== undefined) {
      patch.answerText = String(body.answerText || '').trim() || null;
      patch.isAnswered = !!patch.answerText;
      patch.answeredByPersonId = patch.isAnswered ? req.user.sub : null;
    }
    if (body.isAnswered !== undefined) patch.isAnswered = !!body.isAnswered;
    const row = await updateSessionQA(req.params.questionId, patch);
    const fresh = await getSessionQAForEvent(req.params.eventId);
    const result = fresh.find((q) => q.QuestionId === req.params.questionId);
    res.json(serializeQuestion(result || row));
  } catch (err) { next(err); }
});

router.delete('/:questionId', async (req, res, next) => {
  try {
    if (!await assertOwnedEvent(req, res)) return;
    const existing = await getSessionQAById(req.params.questionId);
    if (!existing || existing.EventId !== req.params.eventId) {
      return res.status(404).json({ error: 'Question not found.' });
    }
    await deleteSessionQA(req.params.questionId, req.user.sub);
    res.status(204).end();
  } catch (err) { next(err); }
});

export default router;
