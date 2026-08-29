import { Router } from 'express';
import {
  getEventById, getSponsorsForEvent, getSponsorById, getSponsorTiers,
  createSponsor, updateSponsor, deleteSponsor,
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
