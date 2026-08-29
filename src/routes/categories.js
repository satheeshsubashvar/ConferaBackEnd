import { Router } from 'express';
import {
  getEventById,
  getCategoriesForEvent,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../data/store.js';
import { serializeCategory } from '../data/serializers.js';
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

// GET /api/events/:eventId/categories
router.get('/', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const categories = await getCategoriesForEvent(req.params.eventId);
    res.json(categories.map(serializeCategory));
  } catch (err) {
    next(err);
  }
});

// POST /api/events/:eventId/categories
router.post('/', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;

    const { name, color } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Please enter category name' });
    }

    const created = await createCategory(req.params.eventId, name.trim(), color || '#7c3aed');
    res.status(201).json(serializeCategory(created));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/events/:eventId/categories/:categoryId
router.patch('/:categoryId', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;

    const existing = await getCategoryById(req.params.categoryId);
    if (!existing || existing.EventId !== req.params.eventId) {
      return res.status(404).json({ error: 'Category not found.' });
    }

    const { name, color } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Please enter category name' });
    }

    const updated = await updateCategory(req.params.categoryId, name.trim(), color || '#7c3aed');
    res.json(serializeCategory(updated));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/events/:eventId/categories/:categoryId
router.delete('/:categoryId', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;

    const existing = await getCategoryById(req.params.categoryId);
    if (!existing || existing.EventId !== req.params.eventId) {
      return res.status(404).json({ error: 'Category not found.' });
    }

    await deleteCategory(req.params.categoryId);
    res.status(204).end();
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ error: 'This category is assigned to one or more sessions and cannot be deleted.' });
    }
    next(err);
  }
});

export default router;
