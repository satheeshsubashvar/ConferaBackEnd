import { Router } from 'express';
import multer from 'multer';
import {
  getEventById,
  getExhibitorsForEvent,
  getExhibitorById,
  getExhibitorCategories,
  createExhibitor,
  updateExhibitor,
  deleteExhibitor,
} from '../data/store.js';
import { serializeExhibitor, serializeExhibitorCategory } from '../data/serializers.js';
import { requireAuth } from '../middleware/auth.js';
import { buildExcelHtml, extractRows, rowsToObjects, getCell } from '../utils/excelImportExport.js';

const router = Router({ mergeParams: true });
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(requireAuth);

async function assertOwnedEvent(req, res) {
  const event = await getEventById(req.params.eventId);
  if (!event || event.OrganizationId !== req.user.organizationId) {
    res.status(404).json({ error: 'Event not found.' });
    return null;
  }
  return event;
}

const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

function validateCreatePayload(body) {
  if (!body?.company || !body.company.trim()) return 'Please enter company';
  if (!body?.description || !body.description.trim()) return 'Please enter company description';
  if (!body?.contactEmail || !body.contactEmail.trim()) return 'Please enter email address';
  if (!EMAIL_PATTERN.test(body.contactEmail.trim())) return 'Please enter a valid email address';
  if (!body?.contactName || !body.contactName.trim()) return 'Please enter contact name';
  return null;
}

function validateUpdatePayload(body) {
  if (!body?.company || !body.company.trim()) return 'Please enter company';
  if (!body?.description || !body.description.trim()) return 'Please enter company description';
  if (!body?.contactName || !body.contactName.trim()) return 'Please enter contact name';
  return null;
}

async function attachCategories(exhibitor) {
  const categories = await getExhibitorCategories(exhibitor.id);
  return { ...exhibitor, categories: categories.map(serializeExhibitorCategory).map((c) => c.name) };
}

const EXHIBITOR_HEADERS = [
  'Company', 'Description', 'Logo URL', 'Booth Number', 'Slogan', 'Address',
  'Website', 'Photo URL', 'Video Thumbnail URL', 'Video URL', 'Contact Email',
  'Contact Name', 'Contact Phone', 'Secondary Contact Email',
  'Secondary Contact Name', 'Secondary Contact Phone', 'Categories',
];

// GET /api/events/:eventId/exhibitors/template — an Excel-compatible
// .xls with just the headers (plus one placeholder row) so an
// organizer can fill it in and re-upload via /import below.
router.get('/template', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    res.type('application/vnd.ms-excel');
    res.set('Content-Disposition', 'attachment; filename="exhibitor-import-template.xls"');
    res.send(buildExcelHtml({ headers: EXHIBITOR_HEADERS, template: true }));
  } catch (err) {
    next(err);
  }
});

// GET /api/events/:eventId/exhibitors/export — the current exhibitor
// list in the same format the template uses, so it can be edited and
// re-imported.
router.get('/export', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const exhibitors = await getExhibitorsForEvent(req.params.eventId);
    const serialized = await Promise.all(exhibitors.map((x) => attachCategories(serializeExhibitor(x))));
    const rows = serialized.map((x) => [
      x.company, x.description, x.logoUrl, x.boothNumber, x.slogan, x.address,
      x.website, x.photoUrl, x.videoThumbnailUrl, x.videoUrl, x.contactEmail,
      x.contactName, x.contactPhone, x.secondaryContactEmail,
      x.secondaryContactName, x.secondaryContactPhone, (x.categories || []).join('; '),
    ]);
    res.type('application/vnd.ms-excel');
    res.set('Content-Disposition', `attachment; filename="exhibitors-${event.EventCode || 'event'}.xls"`);
    res.send(buildExcelHtml({ headers: EXHIBITOR_HEADERS, rows }));
  } catch (err) {
    next(err);
  }
});

// POST /api/events/:eventId/exhibitors/import — bulk-add exhibitors
// from the template above (or a CSV/TSV saved from Excel). Each row
// goes through the same validation and create path as the "Add
// Exhibitor" form, so a bad row is reported and skipped rather than
// failing the whole batch.
router.post('/import', importUpload.single('file'), async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    if (!req.file) return res.status(400).json({ error: 'Please select an Excel/CSV file.' });

    const objects = rowsToObjects(extractRows(req.file.buffer));
    if (!objects.length) return res.status(400).json({ error: 'The import file contains no exhibitor rows.' });

    const results = [];
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      const payload = {
        company: getCell(o, 'company'),
        description: getCell(o, 'description'),
        logoUrl: getCell(o, 'logo url'),
        boothNumber: getCell(o, 'booth number'),
        slogan: getCell(o, 'slogan'),
        address: getCell(o, 'address'),
        website: getCell(o, 'website'),
        photoUrl: getCell(o, 'photo url'),
        videoThumbnailUrl: getCell(o, 'video thumbnail url'),
        videoUrl: getCell(o, 'video url'),
        contactEmail: getCell(o, 'contact email'),
        contactName: getCell(o, 'contact name'),
        contactPhone: getCell(o, 'contact phone'),
        secondaryContactEmail: getCell(o, 'secondary contact email'),
        secondaryContactName: getCell(o, 'secondary contact name'),
        secondaryContactPhone: getCell(o, 'secondary contact phone'),
      };
      const categories = getCell(o, 'categories').split(';').map((c) => c.trim()).filter(Boolean);

      const validationError = validateCreatePayload(payload);
      if (validationError) {
        results.push({ row: i + 2, status: 'Failed', error: validationError });
        continue;
      }
      try {
        const created = await createExhibitor(req.params.eventId, {
          ...payload,
          contactEmail: payload.contactEmail.trim().toLowerCase(),
          categories,
        });
        results.push({ row: i + 2, status: 'Imported', exhibitorProfileId: created.ExhibitorProfileId });
      } catch (err) {
        results.push({ row: i + 2, status: 'Failed', error: err.message });
      }
    }

    res.json({
      imported: results.filter((r) => r.status === 'Imported').length,
      failed: results.filter((r) => r.status === 'Failed').length,
      results,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/events/:eventId/exhibitors
router.get('/', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const exhibitors = await getExhibitorsForEvent(req.params.eventId);
    const serialized = await Promise.all(exhibitors.map((x) => attachCategories(serializeExhibitor(x))));
    res.json(serialized);
  } catch (err) {
    next(err);
  }
});

// POST /api/events/:eventId/exhibitors
router.post('/', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;

    const validationError = validateCreatePayload(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const created = await createExhibitor(req.params.eventId, {
      company: req.body.company.trim(),
      description: req.body.description.trim(),
      logoUrl: req.body.logoUrl || null,
      boothNumber: (req.body.boothNumber || '').trim(),
      slogan: (req.body.slogan || '').trim(),
      address: (req.body.address || '').trim(),
      website: (req.body.website || '').trim(),
      photoUrl: (req.body.photoUrl || '').trim(),
      videoThumbnailUrl: (req.body.videoThumbnailUrl || '').trim(),
      videoUrl: (req.body.videoUrl || '').trim(),
      contactEmail: req.body.contactEmail.trim().toLowerCase(),
      contactName: req.body.contactName.trim(),
      contactPhone: (req.body.contactPhone || '').trim(),
      secondaryContactEmail: (req.body.secondaryContactEmail || '').trim(),
      secondaryContactName: (req.body.secondaryContactName || '').trim(),
      secondaryContactPhone: (req.body.secondaryContactPhone || '').trim(),
      categories: req.body.categories,
    });
    res.status(201).json(await attachCategories(serializeExhibitor(created)));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/events/:eventId/exhibitors/:exhibitorProfileId
router.patch('/:exhibitorProfileId', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;

    const existing = await getExhibitorById(req.params.exhibitorProfileId);
    if (!existing || existing.EventId !== req.params.eventId) {
      return res.status(404).json({ error: 'Exhibitor not found.' });
    }

    const validationError = validateUpdatePayload(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const updated = await updateExhibitor(req.params.exhibitorProfileId, {
      company: req.body.company.trim(),
      description: req.body.description.trim(),
      logoUrl: req.body.logoUrl || null,
      boothNumber: (req.body.boothNumber || '').trim(),
      slogan: (req.body.slogan || '').trim(),
      address: (req.body.address || '').trim(),
      website: (req.body.website || '').trim(),
      photoUrl: (req.body.photoUrl || '').trim(),
      videoThumbnailUrl: (req.body.videoThumbnailUrl || '').trim(),
      videoUrl: (req.body.videoUrl || '').trim(),
      contactName: req.body.contactName.trim(),
      contactPhone: (req.body.contactPhone || '').trim(),
      secondaryContactEmail: (req.body.secondaryContactEmail || '').trim(),
      secondaryContactName: (req.body.secondaryContactName || '').trim(),
      secondaryContactPhone: (req.body.secondaryContactPhone || '').trim(),
      categories: req.body.categories,
    });
    res.json(await attachCategories(serializeExhibitor(updated)));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/events/:eventId/exhibitors/:exhibitorProfileId
router.delete('/:exhibitorProfileId', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;

    const existing = await getExhibitorById(req.params.exhibitorProfileId);
    if (!existing || existing.EventId !== req.params.eventId) {
      return res.status(404).json({ error: 'Exhibitor not found.' });
    }

    await deleteExhibitor(req.params.exhibitorProfileId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
