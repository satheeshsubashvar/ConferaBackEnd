import { Router } from 'express';
import multer from 'multer';
import {
  getEventById, getSponsorsForEvent, getSponsorById, getSponsorTiers,
  createSponsor, updateSponsor, deleteSponsor,
} from '../data/store.js';
import { requireAuth } from '../middleware/auth.js';
import { buildExcelHtml, extractRows, rowsToObjects, getCell, parseBoolCell } from '../utils/excelImportExport.js';

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

function serializeSponsorCenter(row) {
  return {
    id: row.SponsorProfileId,
    eventId: row.EventId,
    companyName: row.CompanyName || '',
    description: row.Description || '',
    logoUrl: row.LogoUrl || '',
    bannerUrl: row.BannerUrl || '',
    websiteUrl: row.WebsiteUrl || '',
    contactEmail: row.ContactEmail || '',
    contactName: row.ContactName || '',
    contactPhone: row.ContactPhone || '',
    videoUrl: row.VideoUrl || '',
    videoThumbnailUrl: row.VideoThumbnailUrl || '',
    videoEmbedCode: row.VideoEmbedCode || '',
    linkedInUrl: row.LinkedInUrl || '',
    twitterHandle: row.TwitterHandle || '',
    tierId: row.TierId || null,
    tierName: row.TierName || '',
    isPublished: !!row.IsPublished,
    sortOrder: row.SortOrder || 0,
    leadsCaptured: row.LeadsCaptured || 0,
    impressions: row.Impressions || 0,
    clicks: row.Clicks || 0,
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt,
  };
}

function validate(payload, isCreate) {
  if (!payload?.companyName?.trim()) return 'Please enter sponsor/company name.';
  if (isCreate && !payload?.contactEmail?.trim()) return 'Please enter contact email.';
  if (payload.contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.contactEmail.trim())) {
    return 'Please enter a valid contact email.';
  }
  return null;
}

router.get('/', async (req, res, next) => {
  try {
    if (!await assertOwnedEvent(req, res)) return;
    const rows = await getSponsorsForEvent(req.params.eventId);
    res.json(rows.map(serializeSponsorCenter));
  } catch (err) { next(err); }
});

const SPONSOR_HEADERS = [
  'Company Name', 'Description', 'Logo URL', 'Banner URL', 'Website URL',
  'Contact Email', 'Contact Name', 'Contact Phone', 'Video URL',
  'Video Thumbnail URL', 'LinkedIn URL', 'Twitter Handle', 'Tier Name',
  'Published (Yes/No)',
];

// GET /api/events/:eventId/sponsor-center/template
router.get('/template', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    res.type('application/vnd.ms-excel');
    res.set('Content-Disposition', 'attachment; filename="sponsor-import-template.xls"');
    res.send(buildExcelHtml({
      headers: SPONSOR_HEADERS,
      template: true,
      placeholders: [
        'Company Name', 'Description', 'Logo URL', 'Banner URL', 'Website URL',
        'Contact Email', 'Contact Name', 'Contact Phone', 'Video URL',
        'Video Thumbnail URL', 'LinkedIn URL', 'Twitter Handle',
        '(must match an existing tier name — leave blank for none)', 'Yes',
      ],
    }));
  } catch (err) { next(err); }
});

// GET /api/events/:eventId/sponsor-center/export
router.get('/export', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const sponsors = (await getSponsorsForEvent(req.params.eventId)).map(serializeSponsorCenter);
    const rows = sponsors.map((s) => [
      s.companyName, s.description, s.logoUrl, s.bannerUrl, s.websiteUrl,
      s.contactEmail, s.contactName, s.contactPhone, s.videoUrl,
      s.videoThumbnailUrl, s.linkedInUrl, s.twitterHandle, s.tierName,
      s.isPublished ? 'Yes' : 'No',
    ]);
    res.type('application/vnd.ms-excel');
    res.set('Content-Disposition', `attachment; filename="sponsors-${event.EventCode || 'event'}.xls"`);
    res.send(buildExcelHtml({ headers: SPONSOR_HEADERS, rows }));
  } catch (err) { next(err); }
});

// POST /api/events/:eventId/sponsor-center/import — bulk-add sponsors.
// "Tier Name" is matched case-insensitively against the event's
// existing sponsor tiers (Settings → Sponsor Tiers); an unrecognized
// or blank tier name just leaves the sponsor untiered rather than
// failing the row, since tiers have no stable, user-facing ID to type.
router.post('/import', importUpload.single('file'), async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    if (!req.file) return res.status(400).json({ error: 'Please select an Excel/CSV file.' });

    const objects = rowsToObjects(extractRows(req.file.buffer));
    if (!objects.length) return res.status(400).json({ error: 'The import file contains no sponsor rows.' });

    const tiers = await getSponsorTiers();
    const tierByName = new Map(tiers.map((t) => [String(t.Name).trim().toLowerCase(), t.TierId]));

    const results = [];
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      const tierName = getCell(o, 'tier name').trim();
      const payload = {
        companyName: getCell(o, 'company name'),
        description: getCell(o, 'description'),
        logoUrl: getCell(o, 'logo url'),
        bannerUrl: getCell(o, 'banner url'),
        websiteUrl: getCell(o, 'website url'),
        contactEmail: getCell(o, 'contact email'),
        contactName: getCell(o, 'contact name'),
        contactPhone: getCell(o, 'contact phone'),
        videoUrl: getCell(o, 'video url'),
        videoThumbnailUrl: getCell(o, 'video thumbnail url'),
        linkedInUrl: getCell(o, 'linkedin url'),
        twitterHandle: getCell(o, 'twitter handle'),
        tierId: tierName ? tierByName.get(tierName.toLowerCase()) || null : null,
        isPublished: parseBoolCell(getCell(o, 'published')) ?? true,
      };

      const validationError = validate(payload, true);
      if (validationError) {
        results.push({ row: i + 2, status: 'Failed', error: validationError });
        continue;
      }
      try {
        const created = await createSponsor(req.params.eventId, payload);
        results.push({ row: i + 2, status: 'Imported', sponsorProfileId: created.SponsorProfileId });
      } catch (err) {
        results.push({ row: i + 2, status: 'Failed', error: err.message });
      }
    }

    res.json({
      imported: results.filter((r) => r.status === 'Imported').length,
      failed: results.filter((r) => r.status === 'Failed').length,
      results,
    });
  } catch (err) { next(err); }
});

router.get('/tiers', async (req, res, next) => {
  try {
    if (!await assertOwnedEvent(req, res)) return;
    const rows = await getSponsorTiers();
    res.json(rows.map((r) => ({ id: r.TierId, name: r.Name, sortOrder: r.SortOrder })));
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const error = validate(req.body, true);
    if (error) return res.status(400).json({ error });
    const row = await createSponsor(req.params.eventId, req.body);
    res.status(201).json(serializeSponsorCenter(row));
  } catch (err) { next(err); }
});

router.patch('/:sponsorId', async (req, res, next) => {
  try {
    if (!await assertOwnedEvent(req, res)) return;
    const existing = await getSponsorById(req.params.sponsorId);
    if (!existing || existing.EventId !== req.params.eventId) {
      return res.status(404).json({ error: 'Sponsor not found.' });
    }
    const error = validate(req.body, false);
    if (error) return res.status(400).json({ error });
    const row = await updateSponsor(req.params.sponsorId, req.body);
    res.json(serializeSponsorCenter(row));
  } catch (err) { next(err); }
});

router.delete('/:sponsorId', async (req, res, next) => {
  try {
    if (!await assertOwnedEvent(req, res)) return;
    const existing = await getSponsorById(req.params.sponsorId);
    if (!existing || existing.EventId !== req.params.eventId) {
      return res.status(404).json({ error: 'Sponsor not found.' });
    }
    await deleteSponsor(req.params.sponsorId);
    res.status(204).end();
  } catch (err) { next(err); }
});

export default router;
