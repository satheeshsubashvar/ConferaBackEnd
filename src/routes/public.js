import { Router } from 'express';
import path from 'path';
import jwt from 'jsonwebtoken';
import { pool } from '../data/db.js';
import {
  getEventById,
  getSponsorsForEvent,
  getSessionsForEvent,
  getTracksForEvent,
  getSessionSpeakers,
  getSpeakersForEvent,
  getPublishedEvents,
  getPortalNavTree,
  getBrandingForEvent,
  getWebPageSettings,
  getExhibitorsForEvent,
  getSessionsForSpeaker,
  getWebsiteTheme,
  getSessionPolls,
  getSessionQAForEvent,
  getAttendeesForEvent,
  getEventAdminSettings,
} from '../data/store.js';
import { serializeSponsor, serializePortalNavNode, serializePublicSpeaker, serializeSession, serializeTrack, serializeSessionPoll } from '../data/serializers.js';
import { requireAuth } from '../middleware/auth.js';
import { upload, buildUploadUrl, UPLOADS_DIR } from '../middleware/upload.js';

// These routes are intentionally unauthenticated: Confera Portal is
// attendee-facing and attendees don't hold an Admin login. Only
// Published events are exposed here, and only the fields relevant to
// a public event page (branding, schedule, sponsors) — never internal
// fields like OrganizationId, OwnerId, or attendee PII.

const router = Router();

// Lightweight public analytics collector. It intentionally accepts only
// non-sensitive analytics fields; no attendee PII is required.
router.post('/events/:eventId/analytics', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.eventId);
    if (!event || event.Status !== 'Published') return res.status(404).json({ error: 'Event not found.' });
    const body = req.body || {};
    const allowedTypes = new Set(['page_view','session_view','speaker_view','sponsor_view']);
    const eventType = allowedTypes.has(body.eventType) ? body.eventType : 'page_view';
    const device = /Mobi|Android|iPhone|iPad/i.test(req.get('user-agent') || '') ? 'Mobile' : 'Desktop';
    await pool.query(`INSERT INTO "EventAnalyticsEvents"
      ("EventId","EventType","PageKey","SessionId","SpeakerId","VisitorId","Path","Referrer","UserAgent","DeviceType","Country","City")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
      req.params.eventId, eventType, body.pageKey || null, body.sessionId || null, body.speakerId || null,
      body.visitorId ? String(body.visitorId).slice(0,120) : null,
      body.path ? String(body.path).slice(0,500) : null,
      req.get('referer') ? String(req.get('referer')).slice(0,1000) : null,
      req.get('user-agent') ? String(req.get('user-agent')).slice(0,1000) : null,
      device, body.country ? String(body.country).slice(0,120) : null, body.city ? String(body.city).slice(0,120) : null,
    ]);
    res.status(204).end();
  } catch (err) { next(err); }
});


// Parses "YYYY-MM-DD HH:MM:SS" (the raw string db.js now returns for
// timestamp-without-timezone columns) and formats the time portion
// directly from the string — no Date object, no timezone conversion,
// so this always reflects exactly what was entered regardless of
// what timezone the server process happens to run in.
function formatWallClockTime(rawValue) {
  if (!rawValue) return null;
  const match = String(rawValue).match(/(\d{2}):(\d{2}):\d{2}/);
  if (!match) return null;
  const hours24 = Number(match[1]);
  const minutes = match[2];
  const hours12 = hours24 % 12 || 12;
  const ampm = hours24 < 12 ? 'AM' : 'PM';
  return `${hours12}:${minutes} ${ampm}`;
}

async function toPublicEvent(event) {
  const branding = await getBrandingForEvent(event.EventId);
  return {
    id: event.EventId,
    name: event.Title,
    shortCode: event.EventCode,
    // db.js returns timestamp-without-timezone columns as raw
    // strings like "2026-10-01 00:00:00" (see the comment there for
    // why) — slicing the first 10 chars gives the calendar date with
    // no timezone conversion involved. This previously checked
    // `instanceof Date` and called toISOString(), which broke the
    // moment the parser changed: the string branch was untested and
    // passed the full unsliced timestamp straight through.
    startDate: event.StartDate ? String(event.StartDate).slice(0, 10) : null,
    endDate: event.EndDate ? String(event.EndDate).slice(0, 10) : null,
    timezone: event.TimeZone || 'UTC',
    startTime: formatWallClockTime(event.StartDate),
    endTime: formatWallClockTime(event.EndDate),
    venueName: event.VenueName,
    venueAddress: event.VenueAddress,
    city: event.VenueCity,
    country: event.VenueCountry,
    website: event.WebsiteUrl,
    description: event.Description,
    tagline: branding?.TagLine || '',
    branding: {
      logoUrl: branding?.LogoUrl || event.LogoUrl || '',
      heroImageUrl: event.BannerImageUrl || '',
      colorFrom: branding?.PrimaryColor || '#7c3aed',
      colorTo: branding?.SecondaryColor || '#4c1d95',
    },
  };
}

// GET /api/public/events/:id - published event details for the portal
router.get('/events/:id', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published') {
      return res.status(404).json({ error: 'Event not found.' });
    }
    res.json(await toPublicEvent(event));
  } catch (err) {
    next(err);
  }
});

// GET /api/public/events/:id/sponsors
router.get('/events/:id/sponsors', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published') {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const sponsors = await getSponsorsForEvent(req.params.id);
    res.json(sponsors.map(serializeSponsor));
  } catch (err) {
    next(err);
  }
});

// POST /api/public/events/:id/sponsors/:sponsorId/visit - records a booth
// visit in BoothVisits (the real table this schema already has for sponsor
// view counts) each time an attendee opens a sponsor's profile in the
// Portal, so "views" on the Sponsors page reflects real visits.
router.post('/events/:id/sponsors/:sponsorId/visit', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published') return res.status(404).json({ error: 'Event not found.' });
    const sponsor = await pool.query('SELECT "SponsorProfileId" FROM "SponsorProfile" WHERE "SponsorProfileId" = $1 AND "IsDeleted" = false', [req.params.sponsorId]);
    if (!sponsor.rowCount) return res.status(404).json({ error: 'Sponsor not found.' });
    let visitorParticipantId = null;
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'confera-dev-secret-change-in-production');
        visitorParticipantId = decoded.participantId || null;
      } catch { /* not logged in / expired token: track as anonymous visit */ }
    }
    await pool.query(
      `INSERT INTO "BoothVisits" ("EventId","SponsorProfileId","VisitorParticipantId","Source") VALUES ($1,$2,$3,'Portal')`,
      [req.params.id, req.params.sponsorId, visitorParticipantId]
    );
    const count = await pool.query('SELECT COUNT(*)::int AS "Count" FROM "BoothVisits" WHERE "SponsorProfileId" = $1', [req.params.sponsorId]);
    res.json({ views: count.rows[0]?.Count || 0 });
  } catch (err) {
    next(err);
  }
});

// GET /api/public/events/:id/sessions
router.get('/events/:id/sessions', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published') {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const [sessions, tracks, qaRows] = await Promise.all([
      getSessionsForEvent(req.params.id),
      getTracksForEvent(req.params.id),
      getSessionQAForEvent(req.params.id),
    ]);
    const trackMap = new Map(tracks.map((track) => [track.TrackId, serializeTrack(track)]));
    const qaCountMap = new Map();
    for (const q of qaRows) qaCountMap.set(String(q.SessionId), (qaCountMap.get(String(q.SessionId)) || 0) + 1);
    const enriched = await Promise.all(
      sessions.map(async (session) => {
        const speakers = await getSessionSpeakers(session.SessionId);
        const serialized = serializeSession(session);
        return {
          ...serialized,
          track: session.TrackId ? (trackMap.get(session.TrackId) || null) : null,
          qaCount: qaCountMap.get(String(session.SessionId)) || 0,
          speakers: speakers.map((speaker) => ({
            id: speaker.SpeakerProfileId,
            name: speaker.FullName || [speaker.FirstName, speaker.LastName].filter(Boolean).join(' '),
            firstName: speaker.FirstName || '',
            lastName: speaker.LastName || '',
            company: speaker.Company || '',
            jobTitle: speaker.JobTitle || '',
            bio: speaker.ShortBio || '',
            photoUrl: speaker.ProfilePictureUrl || '',
            photoThumbnailUrl: speaker.ProfilePictureThumbnailUrl || '',
            isKeynote: !!speaker.IsKeynote,
          })),
        };
      })
    );
    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

// POST /api/public/events/:eventId/sessions/:sessionId/qa - attendee asks a question
router.post('/events/:eventId/sessions/:sessionId/qa', requireAuth, async (req, res, next) => {
  try {
    const event = await getEventById(req.params.eventId);
    if (!event || event.Status !== 'Published' || String(req.user.eventId) !== String(req.params.eventId)) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const session = await pool.query('SELECT "SessionId" FROM "Sessions" WHERE "SessionId"=$1 AND "EventId"=$2 AND "IsDeleted"=false', [req.params.sessionId, req.params.eventId]);
    if (!session.rowCount) return res.status(404).json({ error: 'Session not found.' });
    const question = String(req.body?.question || '').trim();
    if (!question) return res.status(400).json({ error: 'Question is required.' });
    if (question.length > 400) return res.status(400).json({ error: 'Question must be 400 characters or fewer.' });
    const isAnonymous = !!req.body?.isAnonymous;
    const r = await pool.query(`
      INSERT INTO "SessionQA" ("SessionId","AskedByPersonId","QuestionText","IsAnonymous","IsAnswered","IsApproved","IsPinned","Status")
      VALUES ($1,$2,$3,$4,false,true,false,'Approved')
      RETURNING "QuestionId","SessionId","QuestionText","IsAnonymous","IsAnswered","IsApproved","IsPinned","Status","UpvoteCount","CreatedAt"`,
      [req.params.sessionId, req.user.sub, question, isAnonymous]
    );
    const row = r.rows[0];
    res.status(201).json({ id: row.QuestionId, sessionId: row.SessionId, question: row.QuestionText, askedBy: isAnonymous ? 'Anonymous' : (req.user.name || 'You'), isAnonymous: row.IsAnonymous, isAnswered: row.IsAnswered, answerText: '', upvoteCount: row.UpvoteCount || 0, isApproved: row.IsApproved, isPinned: row.IsPinned, status: row.Status, createdAt: row.CreatedAt });
  } catch (err) { next(err); }
});

// GET /api/public/events/:eventId/sessions/:sessionId/qa
router.get('/events/:eventId/sessions/:sessionId/qa', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.eventId);
    if (!event || event.Status !== 'Published') return res.status(404).json({ error: 'Event not found.' });
    const rows = await getSessionQAForEvent(req.params.eventId);
    const result = rows.filter((q) => String(q.SessionId) === String(req.params.sessionId));
    res.json(result.map((row) => ({
      id: row.QuestionId,
      sessionId: row.SessionId,
      question: row.QuestionText || '',
      askedBy: row.IsAnonymous ? 'Anonymous' : (row.AskedFullName || [row.AskedFirstName, row.AskedLastName].filter(Boolean).join(' ')),
      isAnonymous: !!row.IsAnonymous,
      isAnswered: !!row.IsAnswered,
      answerText: row.AnswerText || '',
      upvoteCount: row.UpvoteCount || 0,
      isApproved: !!row.IsApproved,
      isPinned: !!row.IsPinned,
      status: row.Status || '',
      createdAt: row.CreatedAt,
    })));
  } catch (err) { next(err); }
});

// POST /api/public/events/:eventId/sessions/:sessionId/qa/:questionId/vote
// Upvotes ("likes") a question. Simple increment — there's no per-person
// vote-tracking table yet, so the frontend guards against repeat clicks
// by disabling the button once voted in that session.
router.post('/events/:eventId/sessions/:sessionId/qa/:questionId/vote', requireAuth, async (req, res, next) => {
  try {
    const event = await getEventById(req.params.eventId);
    if (!event || event.Status !== 'Published') return res.status(404).json({ error: 'Event not found.' });
    const r = await pool.query(
      `UPDATE "SessionQA" SET "UpvoteCount" = COALESCE("UpvoteCount",0) + 1
       WHERE "QuestionId" = $1 AND "SessionId" = $2 AND "IsDeleted" = false
       RETURNING "QuestionId","UpvoteCount"`,
      [req.params.questionId, req.params.sessionId]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Question not found.' });
    res.json({ id: r.rows[0].QuestionId, upvoteCount: r.rows[0].UpvoteCount });
  } catch (err) { next(err); }
});

// GET /api/public/events/:eventId/sessions/:sessionId/polls
router.get('/events/:eventId/sessions/:sessionId/polls', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.eventId);
    if (!event || event.Status !== 'Published') return res.status(404).json({ error: 'Event not found.' });
    const polls = await getSessionPolls(req.params.sessionId);
    res.json(polls.map(serializeSessionPoll));
  } catch (err) { next(err); }
});


// ---------------------------------------------------------------------------
// Portal Documents — same EventDocuments data used by Admin -> Documents.
// ---------------------------------------------------------------------------
router.get('/events/:id/documents', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published') return res.status(404).json({ error: 'Event not found.' });

    const [eventDocs, sessionDocs] = await Promise.all([
      pool.query(`
        SELECT d."DocumentId", d."EventId", d."SessionId", d."Title", d."FileUrl",
               d."FileType", d."FileSizeKB", d."DownloadCount", d."SortOrder",
               NULL::text AS "SessionTitle"
          FROM "EventDocuments" d
         WHERE d."EventId"=$1 AND d."SessionId" IS NULL
           AND d."ExhibitorProfileId" IS NULL AND d."IsDeleted"=false
         ORDER BY d."SortOrder", d."Title"`, [req.params.id]),
      pool.query(`
        SELECT d."DocumentId", d."EventId", d."SessionId", d."Title", d."FileUrl",
               d."FileType", d."FileSizeKB", d."DownloadCount", d."SortOrder",
               s."Title" AS "SessionTitle"
          FROM "EventDocuments" d
          JOIN "Sessions" s ON s."SessionId"=d."SessionId"
         WHERE d."EventId"=$1 AND d."IsDeleted"=false
         ORDER BY d."SortOrder", s."StartTime", d."Title"`, [req.params.id]),
    ]);

    const serialize = (row) => ({
      id: row.DocumentId,
      eventId: row.EventId,
      sessionId: row.SessionId || null,
      title: row.Title || 'Document',
      fileUrl: row.FileUrl || '',
      fileType: row.FileType || '',
      fileSizeKb: Number(row.FileSizeKB || 0),
      downloadCount: Number(row.DownloadCount || 0),
      sessionTitle: row.SessionTitle || null,
    });

    res.json({
      eventDocuments: eventDocs.rows.map(serialize),
      sessionDocuments: sessionDocs.rows.map(serialize),
    });
  } catch (err) { next(err); }
});

router.get('/events/:id/documents/:documentId/download', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published') return res.status(404).json({ error: 'Event not found.' });

    const doc = await pool.query(`
      SELECT "DocumentId","Title","FileUrl"
        FROM "EventDocuments"
       WHERE "EventId"=$1 AND "DocumentId"=$2 AND "IsDeleted"=false
       LIMIT 1`, [req.params.id, req.params.documentId]);
    if (!doc.rowCount) return res.status(404).json({ error: 'Document not found.' });

    await pool.query(`
      UPDATE "EventDocuments"
         SET "DownloadCount"=COALESCE("DownloadCount",0)+1
       WHERE "DocumentId"=$1`, [req.params.documentId]);

    const fileUrl = String(doc.rows[0].FileUrl || '');
    const uploadMarker = '/uploads/';
    const markerIndex = fileUrl.indexOf(uploadMarker);
    if (markerIndex >= 0) {
      const filename = path.basename(fileUrl.slice(markerIndex + uploadMarker.length));
      const extension = path.extname(filename);
      const safeTitle = String(doc.rows[0].Title || 'document').replace(/[^a-z0-9._-]+/gi, '-');
      return res.download(path.join(UPLOADS_DIR, filename), `${safeTitle}${extension}`);
    }

    // Cloud/CDN documents are already browser-addressable; preserve the
    // configured storage URL rather than assuming local disk storage.
    return res.redirect(fileUrl);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Portal Polls — reads/writes the same LivePolls + PollOptions tables as Admin.
// ---------------------------------------------------------------------------
router.get('/events/:id/polls', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published') return res.status(404).json({ error: 'Event not found.' });

    const r = await pool.query(`
      SELECT p."PollId",p."EventId",p."SessionId",p."Question",p."Description",
             p."PollType",p."IsAnonymous",p."IsActive",p."AllowMultipleAnswers",
             p."ShowResults",p."ResultsVisibility",p."StartsAt",p."EndsAt",
             p."CreatedAt",s."Title" AS "SessionTitle",
             COALESCE((
               SELECT json_agg(json_build_object(
                 'optionId',o."OptionId",
                 'optionText',o."OptionText",
                 'responseCount',COALESCE(o."ResponseCount",0)
               ) ORDER BY o."SortOrder")
               FROM "PollOptions" o WHERE o."PollId"=p."PollId"
             ),'[]') AS "Options"
        FROM "LivePolls" p
        LEFT JOIN "Sessions" s ON s."SessionId"=p."SessionId"
       WHERE p."EventId"=$1 AND p."IsDeleted"=false
       ORDER BY p."CreatedAt" DESC`, [req.params.id]);

    res.json(r.rows.map((row) => ({
      id: row.PollId,
      eventId: row.EventId,
      sessionId: row.SessionId || null,
      sessionTitle: row.SessionTitle || null,
      question: row.Question || '',
      description: row.Description || '',
      pollType: row.PollType || 'SingleChoice',
      isAnonymous: !!row.IsAnonymous,
      isActive: !!row.IsActive,
      allowMultipleAnswers: !!row.AllowMultipleAnswers,
      showResults: row.ShowResults !== false,
      resultsVisibility: row.ResultsVisibility || 'AfterVote',
      startsAt: row.StartsAt,
      endsAt: row.EndsAt,
      createdAt: row.CreatedAt,
      options: Array.isArray(row.Options) ? row.Options : [],
      totalResponses: (Array.isArray(row.Options) ? row.Options : []).reduce((sum, o) => sum + Number(o.responseCount || 0), 0),
    })));
  } catch (err) { next(err); }
});

router.post('/events/:id/polls', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published' || String(req.user.eventId || '') !== String(req.params.id)) {
      return res.status(404).json({ error: 'Event not found.' });
    }

    const b = req.body || {};
    const question = String(b.question || '').trim();
    const options = Array.isArray(b.options) ? b.options.map((x) => String(x || '').trim()).filter(Boolean) : [];
    if (!question) return res.status(400).json({ error: 'Question is required.' });
    if (options.length < 2) return res.status(400).json({ error: 'At least two poll options are required.' });

    await client.query('BEGIN');
    const poll = await client.query(`
      INSERT INTO "LivePolls"
        ("EventId","SessionId","CreatedByPersonId","Question","Description","PollType",
         "IsAnonymous","IsActive","AllowMultipleAnswers","ShowResults","ResultsVisibility","StartsAt","EndsAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *`,
      [
        req.params.id, b.sessionId || null, req.user.sub, question,
        String(b.description || '').trim() || null,
        b.pollType || 'SingleChoice', !!b.isAnonymous,
        b.isActive !== false, !!b.allowMultipleAnswers,
        b.showResults !== false, b.resultsVisibility || 'AfterVote',
        b.startsAt || null, b.endsAt || null,
      ]);
    for (let i = 0; i < options.length; i++) {
      await client.query(`
        INSERT INTO "PollOptions" ("PollId","OptionText","OptionValue","SortOrder")
        VALUES ($1,$2,$3,$4)`,
        [poll.rows[0].PollId, options[i], options[i], i]);
    }
    await client.query('COMMIT');
    res.status(201).json(poll.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Portal Surveys — same SurveyTemplates/Questions data used by Admin.
// ---------------------------------------------------------------------------
router.get('/events/:id/surveys', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published') return res.status(404).json({ error: 'Event not found.' });

    const r = await pool.query(`
      SELECT s."SurveyTemplateId",s."EventId",s."SessionId",s."Title",s."Description",
             s."SurveyType",s."IsAnonymous",s."IsActive",s."OpensAt",s."ClosesAt",s."CreatedAt",
             se."Title" AS "SessionTitle",se."StartTime",se."EndTime",
             COALESCE((SELECT count(*) FROM "SurveyQuestions" q WHERE q."SurveyTemplateId"=s."SurveyTemplateId"),0)::int AS "QuestionCount",
             COALESCE((SELECT count(*) FROM "PortalSurveyResponses" pr WHERE pr."SurveyTemplateId"=s."SurveyTemplateId"),0)::int AS "ResponseCount"
        FROM "SurveyTemplates" s
        LEFT JOIN "Sessions" se ON se."SessionId"=s."SessionId"
       WHERE s."EventId"=$1
       ORDER BY CASE WHEN s."SurveyType"='PostSession' THEN 0 ELSE 1 END,
                COALESCE(se."StartTime",s."CreatedAt"), s."CreatedAt" DESC`, [req.params.id]);

    res.json(r.rows.map((row) => ({
      id: row.SurveyTemplateId,
      eventId: row.EventId,
      sessionId: row.SessionId || null,
      title: row.Title || 'Survey',
      description: row.Description || '',
      surveyType: row.SurveyType || 'Custom',
      isAnonymous: !!row.IsAnonymous,
      isActive: row.IsActive !== false,
      opensAt: row.OpensAt,
      closesAt: row.ClosesAt,
      createdAt: row.CreatedAt,
      sessionTitle: row.SessionTitle || null,
      startTime: row.StartTime,
      endTime: row.EndTime,
      questionCount: Number(row.QuestionCount || 0),
      responseCount: Number(row.ResponseCount || 0),
    })));
  } catch (err) { next(err); }
});

router.get('/events/:id/surveys/:surveyId', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published') return res.status(404).json({ error: 'Event not found.' });

    const survey = await pool.query(`
      SELECT s.*, se."Title" AS "SessionTitle",se."StartTime",se."EndTime"
        FROM "SurveyTemplates" s
        LEFT JOIN "Sessions" se ON se."SessionId"=s."SessionId"
       WHERE s."EventId"=$1 AND s."SurveyTemplateId"=$2`, [req.params.id, req.params.surveyId]);
    if (!survey.rowCount) return res.status(404).json({ error: 'Survey not found.' });

    const questions = await pool.query(`
      SELECT q."SurveyQuestionId",q."QuestionText",q."QuestionType",q."IsRequired",
             q."SortOrder",q."MinRating",q."MaxRating",
             COALESCE(json_agg(json_build_object(
               'optionId',o."OptionId",'label',o."Label"
             ) ORDER BY o."SortOrder") FILTER (WHERE o."OptionId" IS NOT NULL),'[]') AS "Options"
        FROM "SurveyQuestions" q
        LEFT JOIN "SurveyQuestionOptions" o ON o."SurveyQuestionId"=q."SurveyQuestionId"
       WHERE q."SurveyTemplateId"=$1
       GROUP BY q."SurveyQuestionId"
       ORDER BY q."SortOrder"`, [req.params.surveyId]);

    res.json({
      ...survey.rows[0],
      questions: questions.rows.map((q) => ({
        id: q.SurveyQuestionId,
        questionText: q.QuestionText,
        questionType: q.QuestionType,
        isRequired: !!q.IsRequired,
        minRating: q.MinRating,
        maxRating: q.MaxRating,
        options: Array.isArray(q.Options) ? q.Options : [],
      })),
    });
  } catch (err) { next(err); }
});

router.post('/events/:id/surveys/:surveyId/responses', requireAuth, async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published' || String(req.user.eventId || '') !== String(req.params.id)) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const survey = await pool.query(`
      SELECT "SurveyTemplateId","IsActive","OpensAt","ClosesAt"
        FROM "SurveyTemplates"
       WHERE "SurveyTemplateId"=$1 AND "EventId"=$2`, [req.params.surveyId, req.params.id]);
    if (!survey.rowCount) return res.status(404).json({ error: 'Survey not found.' });
    if (survey.rows[0].IsActive === false) return res.status(409).json({ error: 'This survey is closed.' });

    const answers = req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
    await pool.query(`
      INSERT INTO "PortalSurveyResponses" ("EventId","SurveyTemplateId","PersonId","Answers")
      VALUES ($1,$2,$3,$4::jsonb)
      ON CONFLICT ("EventId","SurveyTemplateId","PersonId")
      DO UPDATE SET "Answers"=EXCLUDED."Answers","UpdatedAt"=(now() AT TIME ZONE 'utc')`,
      [req.params.id, req.params.surveyId, req.user.sub, JSON.stringify(answers)]);
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Portal My Agenda + Profile.
// ---------------------------------------------------------------------------
router.get('/events/:id/me/agenda', requireAuth, async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published' || String(req.user.eventId || '') !== String(req.params.id)) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const r = await pool.query(`
      SELECT s.*
        FROM "PortalMyAgenda" a
        JOIN "Sessions" s ON s."SessionId"=a."SessionId"
       WHERE a."EventId"=$1 AND a."PersonId"=$2 AND s."IsDeleted"=false
       ORDER BY s."StartTime",s."SortOrder",s."Title"`, [req.params.id, req.user.sub]);
    const tracks = await getTracksForEvent(req.params.id);
    const trackMap = new Map(tracks.map((t) => [t.TrackId, serializeTrack(t)]));
    const sessions = await Promise.all(r.rows.map(async (s) => {
      const speakers = await getSessionSpeakers(s.SessionId);
      const serialized = serializeSession(s);
      return {
        ...serialized,
        track: s.TrackId ? (trackMap.get(s.TrackId) || null) : null,
        speakers: speakers.map((sp) => ({
          id: sp.SpeakerProfileId,
          name: sp.FullName || [sp.FirstName, sp.LastName].filter(Boolean).join(' '),
          company: sp.Company || '',
          jobTitle: sp.JobTitle || '',
          photoUrl: sp.ProfilePictureUrl || '',
        })),
      };
    }));
    res.json(sessions);
  } catch (err) { next(err); }
});

router.post('/events/:id/me/agenda/:sessionId', requireAuth, async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published' || String(req.user.eventId || '') !== String(req.params.id)) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const session = await pool.query(`SELECT "SessionId" FROM "Sessions" WHERE "SessionId"=$1 AND "EventId"=$2 AND "IsDeleted"=false`, [req.params.sessionId, req.params.id]);
    if (!session.rowCount) return res.status(404).json({ error: 'Session not found.' });
    const r = await pool.query(`
      INSERT INTO "PortalMyAgenda" ("EventId","PersonId","SessionId")
      VALUES ($1,$2,$3)
      ON CONFLICT ("EventId","PersonId","SessionId") DO NOTHING
      RETURNING *`, [req.params.id, req.user.sub, req.params.sessionId]);
    res.status(201).json({ ok: true, added: !!r.rowCount });
  } catch (err) { next(err); }
});

router.delete('/events/:id/me/agenda/:sessionId', requireAuth, async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published' || String(req.user.eventId || '') !== String(req.params.id)) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    await pool.query(`DELETE FROM "PortalMyAgenda" WHERE "EventId"=$1 AND "PersonId"=$2 AND "SessionId"=$3`, [req.params.id, req.user.sub, req.params.sessionId]);
    res.status(204).end();
  } catch (err) { next(err); }
});

router.get('/events/:id/me/profile', requireAuth, async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published' || String(req.user.eventId || '') !== String(req.params.id)) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const r = await pool.query(`
      SELECT p."PersonId",p."Email",p."FirstName",p."LastName",p."FullName",
             p."Company",p."JobTitle",p."Country",p."ProfilePictureUrl",p."ProfilePictureThumbnailUrl",
             ep."Role",ep."RegistrationCode",ep."Status"
        FROM "Person" p
        JOIN "EventParticipant" ep ON ep."PersonId"=p."PersonId" AND ep."EventId"=$1
       WHERE p."PersonId"=$2 LIMIT 1`, [req.params.id, req.user.sub]);
    if (!r.rowCount) return res.status(404).json({ error: 'Profile not found.' });
    const p = r.rows[0];
    res.json({
      id: p.PersonId,
      name: p.FullName || [p.FirstName,p.LastName].filter(Boolean).join(' '),
      firstName: p.FirstName || '',
      lastName: p.LastName || '',
      email: p.Email || '',
      company: p.Company || '',
      jobTitle: p.JobTitle || '',
      country: p.Country || '',
      photoUrl: p.ProfilePictureUrl || p.ProfilePictureThumbnailUrl || '',
      role: p.Role || 'Attendee',
      registrationCode: p.RegistrationCode || '',
      status: p.Status || '',
    });
  } catch (err) { next(err); }
});

// GET /api/public/events/:id/speaker-page
router.get('/events/:id/speaker-page', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published') {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const theme = await getWebsiteTheme(req.params.id);
    res.json({
      speakerPageBannerPattern: theme?.SpeakerPageBannerPattern || 'Gradient',
      speakerCardStyle: theme?.SpeakerCardStyle || 'FullWidth',
      speakerGridColumns: Number(theme?.SpeakerGridColumns) || 4,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/public/events/:id/speakers
router.get('/events/:id/speakers', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published') {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const speakers = await getSpeakersForEvent(req.params.id);
    const serialized = await Promise.all(
      speakers.map(async (s) => {
        const sessions = await getSessionsForSpeaker(s.SpeakerProfileId);
        return {
          ...serializePublicSpeaker(s),
          personId: s.PersonId || '',
          sessions: sessions.map((sess) => ({ id: sess.SessionId, title: sess.Title, startTime: sess.StartTime })),
        };
      })
    );
    res.json(serialized);
  } catch (err) {
    next(err);
  }
});

// GET /api/public/events/:id/attendees - attendee-facing directory
// Only public profile fields are returned; internal registration/check-in
// fields are deliberately excluded.
router.get('/events/:id/attendees', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published') {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const rows = await getAttendeesForEvent(req.params.id);
    res.json(rows.map((row) => ({
      id: row.EventParticipantId,
      personId: row.PersonId,
      name: row.FullName || [row.FirstName, row.LastName].filter(Boolean).join(' ') || 'Attendee',
      firstName: row.FirstName || '',
      lastName: row.LastName || '',
      role: row.Role || 'Attendee',
      company: row.Company || '',
      jobTitle: row.JobTitle || '',
      country: row.Country || '',
      email: row.Email || '',
      photoUrl: row.ProfilePictureUrl || row.ProfilePictureThumbnailUrl || '',
    })));
  } catch (err) {
    next(err);
  }
});

// GET /api/public/events/:id/nav - Portal sidebar structure, read
// from PortalNavItems, database-driven (not hardcoded on the client).
// Badge counts for Community/Messages are overridden here with live
// counts from the real engagement tables, rather than the static
// PortalNavItems.BadgeCount seed value.
router.get('/events/:id/nav', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published') {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const tree = await getPortalNavTree(req.params.id);

    // Resolve the current attendee (if any) from the bearer token, so
    // Messages can show *their* unread thread count. Nav is fetched
    // before login too, so auth here is optional, not required.
    let personId = null;
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      try {
        personId = jwt.verify(token, process.env.JWT_SECRET || 'confera-dev-secret-change-in-production').sub;
      } catch { /* not logged in / expired token: leave personId null */ }
    }

    const [communityCount, messagesCount] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS "Count" FROM "DiscussionTopics" WHERE "EventId" = $1 AND "IsDeleted" = false`,
        [req.params.id]
      ),
      personId
        ? pool.query(
            `SELECT COUNT(*)::int AS "Count"
               FROM "PortalMessageThreads" t
               JOIN "PortalMessageParticipants" tp ON tp."ThreadId" = t."ThreadId" AND tp."PersonId" = $2
              WHERE t."EventId" = $1 AND t."IsDeleted" = false`,
            [req.params.id, personId]
          )
        : Promise.resolve({ rows: [{ Count: 0 }] }),
    ]);

    const liveBadges = {
      community: communityCount.rows[0]?.Count || 0,
      messages: messagesCount.rows[0]?.Count || 0,
    };

    function applyLiveBadges(node) {
      return {
        ...node,
        BadgeCount: node.Key in liveBadges ? liveBadges[node.Key] : node.BadgeCount,
        children: (node.children || []).map(applyLiveBadges),
      };
    }

    res.json(tree.map(applyLiveBadges).map(serializePortalNavNode));
  } catch (err) {
    next(err);
  }
});



// GET /api/public/events/:id/community - Community Board read model used by
// the attendee-facing /community portal page. This intentionally reads the
// same real engagement tables used by the Admin pages.
router.get('/events/:id/community', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    const isPreview = String(req.query.preview || '') === '1';
    if (!event || (event.Status !== 'Published' && !isPreview)) {
      return res.status(404).json({ error: 'Event not found.' });
    }

    const [branding, announcements, meetups, topics, groups, attendeeCount] = await Promise.all([
      getBrandingForEvent(req.params.id),
      pool.query(`
        SELECT "AnnouncementId","Title","Content","Summary","AnnouncementType","PublishedAt","CreatedAt"
        FROM "Announcements"
        WHERE "EventId"=$1 AND "IsDeleted"=false AND "IsPublished"=true
        ORDER BY COALESCE("PublishedAt","CreatedAt") DESC
      `, [req.params.id]),
      pool.query(`
        SELECT m."MeetupId",m."Title",m."Description",m."MeetupType",m."Location",m."VirtualMeetingUrl",m."StartTime",m."EndTime",m."MaxAttendees",m."Status",m."CreatedAt",
               COUNT(ma."PersonId") FILTER (WHERE COALESCE(ma."RSVPStatus",'Going')='Going')::int AS "RsvpCount"
        FROM "Meetups" m
        LEFT JOIN "MeetupAttendees" ma ON ma."MeetupId"=m."MeetupId"
        WHERE m."EventId"=$1 AND m."IsDeleted"=false
        GROUP BY m."MeetupId"
        ORDER BY m."StartTime" NULLS LAST, m."CreatedAt" DESC
      `, [req.params.id]),
      pool.query(`
        SELECT d."TopicId", d."Title", d."Content", d."Category", d."CreatedAt", d."SessionId",
               COALESCE(p."FullName", p."Email", 'Attendee') AS "CreatedByName"
        FROM "DiscussionTopics" d
        LEFT JOIN "Person" p ON p."PersonId"=d."CreatedByPersonId"
        WHERE d."EventId"=$1 AND d."IsDeleted"=false AND COALESCE(d."IsApproved",true)=true
          AND ($2::uuid IS NULL OR d."SessionId" = $2::uuid)
        ORDER BY d."IsPinned" DESC, d."CreatedAt" DESC
      `, [req.params.id, req.query.sessionId || null]),
      pool.query(`
        SELECT "GroupId","Name","Description","GroupType","Privacy","AvatarUrl","CoverImageUrl","CreatedAt"
        FROM "SocialGroups"
        WHERE "EventId"=$1 AND "IsDeleted"=false AND COALESCE("IsActive",true)=true
        ORDER BY "CreatedAt" DESC
      `, [req.params.id]),
      pool.query(`
        SELECT COUNT(*)::int AS "Count"
        FROM "EventParticipant"
        WHERE "EventId"=$1 AND COALESCE("Status",'') NOT IN ('Deleted','Cancelled')
      `, [req.params.id]),
    ]);

    res.json({
      event: {
        id: event.EventId,
        name: event.Title,
        shortCode: event.EventCode,
        startDate: event.StartDate ? String(event.StartDate).slice(0,10) : null,
        endDate: event.EndDate ? String(event.EndDate).slice(0,10) : null,
        venueName: event.VenueName || '',
        branding: {
          logoUrl: branding?.LogoUrl || event.LogoUrl || '',
          heroImageUrl: event.BannerImageUrl || '',
          colorFrom: branding?.PrimaryColor || '#7c3aed',
          colorTo: branding?.SecondaryColor || '#4c1d95',
        },
      },
      announcements: announcements.rows,
      meetups: meetups.rows.map(m => ({
        ...m,
        rsvpCount: Number(m.RsvpCount || 0),
      })),
      discussionTopics: topics.rows,
      socialGroups: groups.rows,
      attendeeCount: attendeeCount.rows[0]?.Count || 0,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/public/events/:id/community/discussion-topics - attendee-facing
// quick topic creation used by the Community Board's "Add new topic" flow,
// and by a session's Community tab (which passes sessionId to scope the
// topic to that session instead of it being event-wide).
// A supplied attendee name is stored in the topic content metadata only when
// no authenticated portal identity exists; the event owner is used as the
// database creator so the real DiscussionTopics table remains the source of truth.
router.post('/events/:id/community/discussion-topics', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published') return res.status(404).json({ error: 'Event not found.' });
    const b = req.body || {};
    const title = String(b.title || '').trim();
    const content = String(b.content || '').trim();
    if (!title) return res.status(400).json({ error: 'Topic title is required.' });

    const creatorId = event.OwnerId || null;
    const r = await pool.query(`
      INSERT INTO "DiscussionTopics"
        ("EventId","SessionId","CreatedByPersonId","Title","Content","Category","IsPinned","IsLocked","IsApproved","Tags")
      VALUES ($1,$2,$3,$4,$5,$6,false,false,true,$7)
      RETURNING *
    `, [req.params.id, b.sessionId || null, creatorId, title, content || null, b.category || null, b.tags || null]);

    res.status(201).json(r.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/public/events/:id/community/meetups - attendee-facing meet-up suggestion.
// The authenticated portal attendee is recorded as the organizer/creator.
router.post('/events/:id/community/meetups', requireAuth, async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published' || String(req.user.eventId || '') !== String(req.params.id)) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const participant = await pool.query(`
      SELECT "EventParticipantId" FROM "EventParticipant"
      WHERE "EventId"=$1 AND "PersonId"=$2 AND COALESCE("Status",'') NOT IN ('Deleted','Cancelled')
      LIMIT 1
    `, [req.params.id, req.user.sub]);
    if (!participant.rowCount) return res.status(403).json({ error: 'You must be registered for this event to suggest a meet-up.' });

    const b = req.body || {};
    const title = String(b.title || '').trim();
    const description = String(b.description || '').trim();
    if (!title || !description || !b.startTime || !b.endTime) return res.status(400).json({ error: 'Title, description, date, and time are required.' });
    if (b.meetupType === 'Meetup' && !String(b.location || '').trim()) return res.status(400).json({ error: 'Location is required for an in-person meet-up.' });
    if (b.meetupType === 'Virtual' && !String(b.hostingMethod || '').trim()) return res.status(400).json({ error: 'Virtual meeting method is required.' });

    const r = await pool.query(`
      INSERT INTO "Meetups" ("EventId","OrganizerPersonId","Title","Description","MeetupType","Location","VirtualMeetingUrl","StartTime","EndTime","MaxAttendees","IsPrivate","Status")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,'Scheduled') RETURNING *
    `, [req.params.id, req.user.sub, title, description, b.meetupType === 'Virtual' ? 'Virtual' : 'In-Person', b.location || null, b.virtualMeetingUrl || null, b.startTime, b.endTime, Number(b.maxAttendees || 10)]);
    res.status(201).json({ ...r.rows[0], rsvpCount: 0, joined: false });
  } catch (err) { next(err); }
});

// POST /api/public/events/:id/community/meetups/:meetupId/rsvp - attendee RSVP/join.
router.post('/events/:id/community/meetups/:meetupId/rsvp', requireAuth, async (req, res, next) => {
  try {
    if (String(req.user.eventId || '') !== String(req.params.id)) return res.status(403).json({ error: 'This meet-up belongs to a different event.' });
    const meetup = await pool.query(`SELECT "MeetupId","MaxAttendees" FROM "Meetups" WHERE "MeetupId"=$1 AND "EventId"=$2 AND "IsDeleted"=false`, [req.params.meetupId, req.params.id]);
    if (!meetup.rowCount) return res.status(404).json({ error: 'Meet-up not found.' });
    const participant = await pool.query(`SELECT "EventParticipantId" FROM "EventParticipant" WHERE "EventId"=$1 AND "PersonId"=$2 AND COALESCE("Status",'') NOT IN ('Deleted','Cancelled') LIMIT 1`, [req.params.id, req.user.sub]);
    if (!participant.rowCount) return res.status(403).json({ error: 'You must be registered for this event to join.' });
    const existing = await pool.query(`SELECT "RSVPStatus" FROM "MeetupAttendees" WHERE "MeetupId"=$1 AND "PersonId"=$2`, [req.params.meetupId, req.user.sub]);
    if (existing.rowCount && existing.rows[0].RSVPStatus === 'Going') {
      await pool.query(`DELETE FROM "MeetupAttendees" WHERE "MeetupId"=$1 AND "PersonId"=$2`, [req.params.meetupId, req.user.sub]);
    } else {
      const current = await pool.query(`SELECT COUNT(*)::int AS "Count" FROM "MeetupAttendees" WHERE "MeetupId"=$1 AND COALESCE("RSVPStatus",'Going')='Going'`, [req.params.meetupId]);
      if (meetup.rows[0].MaxAttendees && Number(current.rows[0].Count) >= Number(meetup.rows[0].MaxAttendees)) return res.status(409).json({ error: 'This meet-up is full.' });
      await pool.query(`INSERT INTO "MeetupAttendees" ("MeetupId","PersonId","RSVPStatus") VALUES ($1,$2,'Going') ON CONFLICT ("MeetupId","PersonId") DO UPDATE SET "RSVPStatus"='Going'`, [req.params.meetupId, req.user.sub]);
    }
    const count = await pool.query(`SELECT COUNT(*)::int AS "Count" FROM "MeetupAttendees" WHERE "MeetupId"=$1 AND COALESCE("RSVPStatus",'Going')='Going'`, [req.params.meetupId]);
    const joined = await pool.query(`SELECT 1 FROM "MeetupAttendees" WHERE "MeetupId"=$1 AND "PersonId"=$2 AND "RSVPStatus"='Going'`, [req.params.meetupId, req.user.sub]);
    res.json({ joined: joined.rowCount > 0, rsvpCount: Number(count.rows[0].Count || 0) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Portal realtime content: session chat, portal resources, feedback, guides.
// ---------------------------------------------------------------------------
router.get('/events/:eventId/sessions/:sessionId/chat', requireAuth, async (req, res, next) => {
  try {
    const event = await getEventById(req.params.eventId);
    if (!event || event.Status !== 'Published' || String(req.user.eventId) !== String(req.params.eventId)) return res.status(404).json({ error: 'Event not found.' });
    const session = await pool.query('SELECT "SessionId" FROM "Sessions" WHERE "SessionId"=$1 AND "EventId"=$2 AND "IsDeleted"=false', [req.params.sessionId, req.params.eventId]);
    if (!session.rowCount) return res.status(404).json({ error: 'Session not found.' });
    const r = await pool.query(`SELECT m."MessageId",m."Body",m."CreatedAt",m."SenderPersonId",p."FullName" AS "SenderName",p."ProfilePictureUrl" AS "SenderPhotoUrl" FROM "SessionChatMessages" m JOIN "Person" p ON p."PersonId"=m."SenderPersonId" WHERE m."EventId"=$1 AND m."SessionId"=$2 AND m."IsDeleted"=false ORDER BY m."CreatedAt" ASC`, [req.params.eventId, req.params.sessionId]);
    res.json(r.rows);
  } catch (err) { next(err); }
});

router.post('/events/:eventId/sessions/:sessionId/chat', requireAuth, async (req, res, next) => {
  try {
    const event = await getEventById(req.params.eventId);
    if (!event || event.Status !== 'Published' || String(req.user.eventId) !== String(req.params.eventId)) return res.status(404).json({ error: 'Event not found.' });
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Message is required.' });
    if (body.length > 1000) return res.status(400).json({ error: 'Message must be 1000 characters or fewer.' });
    const session = await pool.query('SELECT "SessionId","ChatEnabled" FROM "Sessions" WHERE "SessionId"=$1 AND "EventId"=$2 AND "IsDeleted"=false', [req.params.sessionId, req.params.eventId]);
    if (!session.rowCount) return res.status(404).json({ error: 'Session not found.' });
    if (session.rows[0].ChatEnabled === false) return res.status(403).json({ error: 'Chat is disabled for this session.' });
    const r = await pool.query(`INSERT INTO "SessionChatMessages" ("EventId","SessionId","SenderPersonId","Body") VALUES ($1,$2,$3,$4) RETURNING "MessageId","Body","CreatedAt","SenderPersonId"`, [req.params.eventId, req.params.sessionId, req.user.sub, body]);
    res.status(201).json({ ...r.rows[0], SenderName: req.user.name || 'Attendee' });
  } catch (err) { next(err); }
});

router.get('/events/:id/portal-content', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published') return res.status(404).json({ error: 'Event not found.' });
    const settings = await getEventAdminSettings(req.params.id);
    const [maps, guides, leaderboard] = await Promise.all([
      pool.query(`SELECT f.*, COALESCE((SELECT count(*) FROM "FloorMapMarkers" m WHERE m."FloorMapId"=f."FloorMapId" AND m."IsDeleted"=false),0)::int AS "MarkerCount" FROM "FloorMaps" f WHERE f."EventId"=$1 AND f."IsDeleted"=false AND f."IsActive"=true ORDER BY f."SortOrder",f."Name"`, [req.params.id]),
      pool.query(`SELECT "GuideId","Title","Description","ImageUrl","Url","SortOrder" FROM "ConferaGuides" WHERE "IsPublished"=true ORDER BY "SortOrder","Title"`),
      pool.query(`SELECT gp."PersonId",p."FullName" AS "Name",p."Company",p."ProfilePictureUrl" AS "PhotoUrl",gp."Points" FROM "PortalGamificationPoints" gp JOIN "Person" p ON p."PersonId"=gp."PersonId" WHERE gp."EventId"=$1 ORDER BY gp."Points" DESC,p."FullName" LIMIT 100`, [req.params.id]),
    ]);
    res.json({
      logistics: Array.isArray(settings.logistics) ? settings.logistics.filter(x => x?.published !== false) : [],
      socialMediaCenter: settings.socialMediaCenter || { accounts: [] },
      gamification: settings.gamification || {},
      floorMaps: maps.rows,
      guides: guides.rows,
      leaderboard: leaderboard.rows,
    });
  } catch (err) { next(err); }
});

router.post('/events/:id/feedback', requireAuth, async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published' || String(req.user.eventId) !== String(req.params.id)) return res.status(404).json({ error: 'Event not found.' });
    const text = String(req.body?.feedback || '').trim();
    const rating = req.body?.rating == null ? null : Math.max(1, Math.min(5, Number(req.body.rating)));
    if (!text) return res.status(400).json({ error: 'Feedback is required.' });
    const r = await pool.query(`INSERT INTO "PortalFeedback" ("EventId","PersonId","Rating","FeedbackText") VALUES ($1,$2,$3,$4) RETURNING *`, [req.params.id, req.user.sub, Number.isFinite(rating) ? rating : null, text]);
    res.status(201).json(r.rows[0]);
  } catch (err) { next(err); }
});

// GET /api/public/events/:id/web-pages/:pageKey
// Public read model used by the event website pages.
router.get('/events/:id/web-pages/:pageKey', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published') {
      return res.status(404).json({ error: 'Event not found.' });
    }

    const pageKey = req.params.pageKey;
    if (!['agenda', 'speaker', 'sponsor', 'exhibitor'].includes(pageKey)) {
      return res.status(400).json({ error: 'Unknown webpage.' });
    }

    const settings = await getWebPageSettings(req.params.id, pageKey);
    let items = [];
    if (pageKey === 'agenda') items = await getSessionsForEvent(req.params.id);
    if (pageKey === 'speaker') items = (await getSpeakersForEvent(req.params.id)).map(serializePublicSpeaker);
    if (pageKey === 'sponsor') items = (await getSponsorsForEvent(req.params.id)).filter((x) => x.IsPublished && !x.IsDeleted);
    if (pageKey === 'exhibitor') items = (await getExhibitorsForEvent(req.params.id)).filter((x) => x.IsPublished && !x.IsDeleted);

    res.json({ settings, items });
  } catch (err) {
    next(err);
  }
});

// GET /api/public/events - list all published events (for a portal landing/switcher)
router.get('/events', async (req, res, next) => {
  try {
    const published = await getPublishedEvents();
    const serialized = await Promise.all(published.map(toPublicEvent));
    res.json(serialized);
  } catch (err) {
    next(err);
  }
});


// ---------------------------------------------------------------------------
// Portal Messages — database-backed attendee inbox
// ---------------------------------------------------------------------------
router.get('/events/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published' || String(req.user.eventId) !== String(req.params.id)) {
      return res.status(404).json({ error: 'Event not found.' });
    }
    const threads = await pool.query(`
      SELECT t."ThreadId", t."Subject", t."CreatedAt", t."UpdatedAt",
             lm."Body" AS "LastBody", lm."CreatedAt" AS "LastMessageAt",
             sp."PersonId" AS "SenderPersonId", sp."FullName" AS "SenderName",
             sp."Email" AS "SenderEmail", sp."ProfilePictureUrl" AS "SenderPhotoUrl",
             COALESCE((SELECT COUNT(*)::int FROM "PortalMessages" pm2 WHERE pm2."ThreadId"=t."ThreadId" AND pm2."IsDeleted"=false),0) AS "MessageCount"
        FROM "PortalMessageThreads" t
        JOIN "PortalMessageParticipants" tp ON tp."ThreadId"=t."ThreadId" AND tp."PersonId"=$2
        LEFT JOIN LATERAL (
          SELECT pm."Body", pm."CreatedAt", pm."SenderPersonId"
            FROM "PortalMessages" pm
           WHERE pm."ThreadId"=t."ThreadId" AND pm."IsDeleted"=false
           ORDER BY pm."CreatedAt" DESC LIMIT 1
        ) lm ON true
        LEFT JOIN "Person" sp ON sp."PersonId"=lm."SenderPersonId"
       WHERE t."EventId"=$1 AND t."IsDeleted"=false
       ORDER BY COALESCE(lm."CreatedAt",t."UpdatedAt") DESC`, [req.params.id, req.user.sub]);
    res.json(threads.rows);
  } catch (err) { next(err); }
});

router.get('/events/:id/messages/:threadId', requireAuth, async (req, res, next) => {
  try {
    const access = await pool.query(`SELECT 1 FROM "PortalMessageThreads" t JOIN "PortalMessageParticipants" tp ON tp."ThreadId"=t."ThreadId" WHERE t."ThreadId"=$1 AND t."EventId"=$2 AND tp."PersonId"=$3 AND t."IsDeleted"=false`, [req.params.threadId, req.params.id, req.user.sub]);
    if (!access.rowCount) return res.status(404).json({ error: 'Message thread not found.' });
    const r = await pool.query(`
      SELECT pm."MessageId",pm."Body",pm."CreatedAt",pm."SenderPersonId",p."FullName" AS "SenderName",p."Email" AS "SenderEmail",p."ProfilePictureUrl" AS "SenderPhotoUrl"
        FROM "PortalMessages" pm JOIN "Person" p ON p."PersonId"=pm."SenderPersonId"
       WHERE pm."ThreadId"=$1 AND pm."IsDeleted"=false ORDER BY pm."CreatedAt" ASC`, [req.params.threadId]);
    res.json(r.rows);
  } catch (err) { next(err); }
});

router.post('/events/:id/messages', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const event = await getEventById(req.params.id);
    if (!event || String(req.user.eventId) !== String(req.params.id)) return res.status(404).json({ error: 'Event not found.' });
    const b = req.body || {};
    if (!String(b.body || '').trim()) return res.status(400).json({ error: 'Message body is required.' });
    await client.query('BEGIN');
    let threadId = b.threadId || null;
    if (threadId) {
      const access = await client.query(`SELECT 1 FROM "PortalMessageThreads" t JOIN "PortalMessageParticipants" tp ON tp."ThreadId"=t."ThreadId" WHERE t."ThreadId"=$1 AND t."EventId"=$2 AND tp."PersonId"=$3 AND t."IsDeleted"=false`, [threadId, req.params.id, req.user.sub]);
      if (!access.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Message thread not found.' }); }
    } else {
      if (!b.recipientPersonId) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'recipientPersonId is required for a new message.' }); }
      const t = await client.query(`INSERT INTO "PortalMessageThreads" ("EventId","Subject") VALUES ($1,$2) RETURNING "ThreadId"`, [req.params.id, b.subject || 'New message']);
      threadId = t.rows[0].ThreadId;
      await client.query(`INSERT INTO "PortalMessageParticipants" ("ThreadId","PersonId") VALUES ($1,$2),($1,$3)`, [threadId, req.user.sub, b.recipientPersonId]);
    }
    const m = await client.query(`INSERT INTO "PortalMessages" ("ThreadId","SenderPersonId","Body") VALUES ($1,$2,$3) RETURNING *`, [threadId, req.user.sub, String(b.body).trim()]);
    await client.query(`UPDATE "PortalMessageThreads" SET "UpdatedAt"=(now() AT TIME ZONE 'utc') WHERE "ThreadId"=$1`, [threadId]);
    await client.query('COMMIT');
    res.status(201).json({ ...m.rows[0], ThreadId: threadId });
  } catch (err) { await client.query('ROLLBACK'); next(err); } finally { client.release(); }
});

// ---------------------------------------------------------------------------
// Portal Photos — reads the same MediaItems created by Admin -> Engage & Network
// and lets authenticated attendees share photos into that event gallery.
// ---------------------------------------------------------------------------
router.get('/events/:id/photos', async (req, res, next) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event || event.Status !== 'Published') return res.status(404).json({ error: 'Event not found.' });
    const r = await pool.query(`
      SELECT mi.*, p."FullName" AS "UploadedByName", p."ProfilePictureUrl" AS "UploadedByPhotoUrl", g."GalleryName"
        FROM "MediaItems" mi
        LEFT JOIN "Person" p ON p."PersonId"=mi."UploadedByPersonId"
        LEFT JOIN "MediaGalleries" g ON g."GalleryId"=mi."GalleryId"
       WHERE mi."EventId"=$1 AND mi."IsDeleted"=false AND mi."IsPublished"=true AND lower(mi."MediaType") IN ('image','photo')
       ORDER BY mi."CreatedAt" DESC`, [req.params.id]);
    res.json({ items: r.rows, count: r.rowCount });
  } catch (err) { next(err); }
});

router.post('/events/:id/photos', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message });
    const client = await pool.connect();
    try {
      const event = await getEventById(req.params.id);
      if (!event || String(req.user.eventId) !== String(req.params.id)) return res.status(404).json({ error: 'Event not found.' });
      if (!req.file) return res.status(400).json({ error: 'No photo was uploaded.' });
      await client.query('BEGIN');
      let gallery = await client.query(`SELECT "GalleryId" FROM "MediaGalleries" WHERE "EventId"=$1 AND "IsDeleted"=false ORDER BY "SortOrder","CreatedAt" LIMIT 1`, [req.params.id]);
      if (!gallery.rowCount) gallery = await client.query(`INSERT INTO "MediaGalleries" ("EventId","GalleryName","Description","IsActive","SortOrder") VALUES ($1,'Attendee Photos','Photos shared by attendees',true,0) RETURNING "GalleryId"`, [req.params.id]);
      const url = buildUploadUrl(req.file.filename, req);
      const title = String(req.body?.title || req.file.originalname || 'Photo').slice(0,300);
      const item = await client.query(`INSERT INTO "MediaItems" ("GalleryId","EventId","MediaType","Title","FileUrl","ThumbnailUrl","FileSize","MimeType","UploadedByPersonId","IsPublished","SortOrder") VALUES ($1,$2,'Image',$3,$4,$4,$5,$6,$7,true,0) RETURNING *`, [gallery.rows[0].GalleryId, req.params.id, title, url, req.file.size, req.file.mimetype, req.user.sub]);
      await client.query('COMMIT');
      res.status(201).json(item.rows[0]);
    } catch (err) { await client.query('ROLLBACK'); next(err); } finally { client.release(); }
  });
});

export default router;
