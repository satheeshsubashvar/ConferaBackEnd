import { Router } from 'express';
import multer from 'multer';
import {
  getEventById,
  getSpeakersForEventFull,
  getSpeakerByProfileId,
  createSpeaker,
  updateSpeaker,
  deleteSpeaker,
  setSpeakerAgendaSessions,
} from '../data/store.js';
import { serializeSpeakerCenterEntry } from '../data/serializers.js';
import { requireAuth } from '../middleware/auth.js';

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

function validateCreatePayload(body) {
  if (!body?.firstName || !body.firstName.trim()) return 'Please enter speaker name';
  if (!body?.email || !body.email.trim()) return 'Please enter email address';
  const emailPattern = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
  if (!emailPattern.test(body.email.trim())) return 'Please enter a valid email address';
  if (!body?.company || !body.company.trim()) return 'Please enter affiliation';
  if (!body?.bio || !body.bio.trim()) return 'Please enter biography';
  if (!body?.country || !body.country.trim()) return 'Please enter the country';
  return null;
}

function validateUpdatePayload(body) {
  if (!body?.firstName || !body.firstName.trim()) return 'Please enter speaker name';
  if (!body?.company || !body.company.trim()) return 'Please enter affiliation';
  if (!body?.bio || !body.bio.trim()) return 'Please enter biography';
  if (!body?.country || !body.country.trim()) return 'Please enter the country';
  return null;
}

function normalizeUrl(value) {
  const v = (value || '').trim();
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

function speakerPayload(body) {
  return {
    firstName: (body.firstName || '').trim(),
    lastName: (body.lastName || '').trim(),
    email: body.email?.trim().toLowerCase(),
    company: (body.company || '').trim(),
    jobTitle: (body.jobTitle || '').trim(),
    country: (body.country || '').trim(),
    bio: (body.bio || '').trim(),
    profilePictureUrl: body.profilePictureUrl || null,
    speakerInformationFormLink: normalizeUrl(body.speakerInformationFormLink),
    linkedInUrl: normalizeUrl(body.linkedInUrl),
    twitterUrl: normalizeUrl(body.twitterUrl),
    instagramUrl: normalizeUrl(body.instagramUrl),
    facebookUrl: normalizeUrl(body.facebookUrl),
  };
}

function excelCell(value) {
  const text = value == null ? '' : String(value);
  return `<td>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</td>`;
}

function buildExcelHtml(rows, template) {
  const headers = [
    'First Name', 'Last Name', 'Email', 'Affiliation', 'Position', 'Country',
    'Biography', 'Speaker Picture URL', 'Speaker Information Form Link',
    'LinkedIn URL', 'Twitter/X URL', 'Instagram URL', 'Facebook URL',
    'Agenda Session IDs',
  ];
  const body = template
    ? `<tr>${headers.map(excelCell).join('')}</tr>`
    : rows.map((r) => {
        const sessions = Array.isArray(r.AgendaSessions)
          ? r.AgendaSessions.map((s) => s.id).join(';')
          : '';
        return `<tr>${[
          r.FirstName, r.LastName, r.Email, r.Company, r.JobTitle, r.Country,
          r.ShortBio, r.ProfilePictureUrl, r.SpeakerInformationFormLink,
          r.LinkedInUrl, r.TwitterUrl, r.InstagramUrl, r.FacebookUrl, sessions,
        ].map(excelCell).join('')}</tr>`;
      }).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>
    <table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody></table>
  </body></html>`;
}

function parseDelimited(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  return lines.map((line) => {
    const cells = [];
    let current = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { current += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === delimiter && !quoted) {
        cells.push(current.trim()); current = '';
      } else current += ch;
    }
    cells.push(current.trim());
    return cells;
  });
}

function parseHtmlTable(text) {
  return [...text.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((c) =>
      c[1].replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
    )
  );
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  return rows.slice(1).map((cells) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = cells[i] || ''; });
    return o;
  });
}

// GET /api/events/:eventId/speaker-center
router.get('/', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const speakers = await getSpeakersForEventFull(req.params.eventId);
    res.json(speakers.map(serializeSpeakerCenterEntry));
  } catch (err) {
    next(err);
  }
});

// Download an Excel-compatible .xls template.
router.get('/template', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    res.type('application/vnd.ms-excel');
    res.set('Content-Disposition', 'attachment; filename="speaker-import-template.xls"');
    res.send(buildExcelHtml([], true));
  } catch (err) {
    next(err);
  }
});

// Export the current speaker list as an Excel-compatible .xls file.
router.get('/export', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const speakers = await getSpeakersForEventFull(req.params.eventId);
    res.type('application/vnd.ms-excel');
    res.set('Content-Disposition', `attachment; filename="speakers-${event.EventCode || 'event'}.xls"`);
    res.send(buildExcelHtml(speakers, false));
  } catch (err) {
    next(err);
  }
});

// Import .xls files produced by this app, or CSV/TSV files saved from Excel.
router.post('/import', importUpload.single('file'), async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    if (!req.file) return res.status(400).json({ error: 'Please select an Excel/CSV file.' });

    const text = req.file.buffer.toString('utf8');
    const rows = /<table/i.test(text) ? parseHtmlTable(text) : parseDelimited(text);
    const objects = rowsToObjects(rows);
    if (!objects.length) return res.status(400).json({ error: 'The import file contains no speaker rows.' });

    const get = (o, ...names) => names.map((n) => o[n]).find((v) => v) || '';
    const results = [];

    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      const payload = {
        firstName: get(o, 'first name'),
        lastName: get(o, 'last name'),
        email: get(o, 'email'),
        company: get(o, 'affiliation', 'company'),
        jobTitle: get(o, 'position', 'job title'),
        country: get(o, 'country'),
        bio: get(o, 'biography', 'bio'),
        profilePictureUrl: get(o, 'speaker picture url', 'profile picture url'),
        speakerInformationFormLink: get(o, 'speaker information form link'),
        linkedInUrl: get(o, 'linkedin url'),
        twitterUrl: get(o, 'twitter x url', 'twitter url'),
        instagramUrl: get(o, 'instagram url'),
        facebookUrl: get(o, 'facebook url'),
      };
      const validationError = validateCreatePayload(payload);
      if (validationError) {
        results.push({ row: i + 2, status: 'Failed', error: validationError });
        continue;
      }
      try {
        const created = await createSpeaker(req.params.eventId, speakerPayload(payload));
        const sessionIds = get(o, 'agenda session ids').split(';').map((v) => v.trim()).filter(Boolean);
        if (sessionIds.length) await setSpeakerAgendaSessions(req.params.eventId, created.SpeakerProfileId, sessionIds);
        results.push({ row: i + 2, status: 'Imported', speakerProfileId: created.SpeakerProfileId });
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

router.post('/', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const validationError = validateCreatePayload(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    const created = await createSpeaker(req.params.eventId, speakerPayload(req.body));
    if (Array.isArray(req.body.agendaSessionIds)) {
      await setSpeakerAgendaSessions(req.params.eventId, created.SpeakerProfileId, req.body.agendaSessionIds);
    }
    res.status(201).json(serializeSpeakerCenterEntry(await getSpeakerByProfileId(created.SpeakerProfileId)));
  } catch (err) {
    next(err);
  }
});

router.patch('/:speakerProfileId', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const existing = await getSpeakerByProfileId(req.params.speakerProfileId);
    if (!existing || existing.EventId !== req.params.eventId) return res.status(404).json({ error: 'Speaker not found.' });
    const validationError = validateUpdatePayload(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    const updated = await updateSpeaker(
      req.params.speakerProfileId,
      speakerPayload({ ...req.body, email: existing.Email })
    );
    if (Array.isArray(req.body.agendaSessionIds)) {
      await setSpeakerAgendaSessions(req.params.eventId, req.params.speakerProfileId, req.body.agendaSessionIds);
    }
    res.json(serializeSpeakerCenterEntry(await getSpeakerByProfileId(updated.SpeakerProfileId)));
  } catch (err) {
    next(err);
  }
});

router.delete('/:speakerProfileId', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const existing = await getSpeakerByProfileId(req.params.speakerProfileId);
    if (!existing || existing.EventId !== req.params.eventId) return res.status(404).json({ error: 'Speaker not found.' });

    await deleteSpeaker(req.params.speakerProfileId);
    res.status(204).end();
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ error: 'This speaker is assigned to one or more sessions and cannot be deleted.' });
    }
    next(err);
  }
});

export default router;
