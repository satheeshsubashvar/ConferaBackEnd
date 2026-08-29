import { Router } from 'express';
import {
  getEventById,
  getEventAdminSettings,
  getSessionsForEvent,
  getSessionById,
  createSession,
  updateSession,
  deleteSession,
  duplicateSession,
  swapSessions,
  getTracksForEvent,
  getSessionFormats,
  getSessionSpeakers,
  getEventSpeakerRoster,
  addSessionSpeaker,
  updateSessionSpeakerRole,
  removeSessionSpeaker,
  getSessionDocuments,
  getEventDocumentRoster,
  createSessionDocument,
  attachExistingDocument,
  removeSessionDocument,
  getSessionPolls,
  createSessionPoll,
  deleteSessionPoll,
  getSessionStreams,
  upsertSessionStream,
  getSessionSponsors,
  addSessionSponsor,
  removeSessionSponsor,
  getEventSessionTags,
  getSessionTagAssignments,
  setSessionTags,
  getSessionAuthors,
  addSessionAuthor,
  removeSessionAuthor,
} from '../data/store.js';
import {
  serializeSession,
  serializeTrack,
  serializeSessionFormat,
  serializeSessionSpeaker,
  serializeSpeakerRosterEntry,
  serializeSessionDocument,
  serializeSessionPoll,
  serializeSessionStream,
  serializeSessionSponsor,
  serializeSessionTag,
  serializeSessionAuthor,
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

// GET /api/events/:eventId/sessions
router.get('/', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const sessions = await getSessionsForEvent(req.params.eventId);
    res.json(sessions.map(serializeSession));
  } catch (err) {
    next(err);
  }
});

// GET /api/events/:eventId/sessions/tracks - lookup list for the Track dropdown
router.get('/tracks', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const tracks = await getTracksForEvent(req.params.eventId);
    res.json(tracks.map(serializeTrack));
  } catch (err) {
    next(err);
  }
});

// GET /api/events/:eventId/sessions/formats - lookup list for the Format dropdown
router.get('/formats', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const formats = await getSessionFormats();
    res.json(formats.map(serializeSessionFormat));
  } catch (err) {
    next(err);
  }
});

// GET /api/events/:eventId/sessions/tags-catalog - all tags available for this event
router.get('/tags-catalog', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const tags = await getEventSessionTags(req.params.eventId);
    res.json(tags.map(serializeSessionTag));
  } catch (err) {
    next(err);
  }
});

// POST /api/events/:eventId/sessions/swap - swaps StartTime/EndTime/
// Location between two sessions. Registered here (before /:sessionId)
// for the same reason tags-catalog is: a static path segment must
// come before a dynamic :sessionId route or Express would try to
// match "swap" as a session ID.
router.post('/swap', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;

    const { sessionAId, sessionBId } = req.body || {};
    if (!sessionAId || !sessionBId) {
      return res.status(400).json({ error: 'sessionAId and sessionBId are required.' });
    }
    if (sessionAId === sessionBId) {
      return res.status(400).json({ error: 'Cannot swap a session with itself.' });
    }

    const a = await getSessionById(sessionAId);
    const b = await getSessionById(sessionBId);
    if (!a || a.EventId !== req.params.eventId || !b || b.EventId !== req.params.eventId) {
      return res.status(404).json({ error: 'One or both sessions were not found in this event.' });
    }

    const result = await swapSessions(sessionAId, sessionBId);
    res.json({
      sessionA: serializeSession(result.sessionA),
      sessionB: serializeSession(result.sessionB),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/events/:eventId/sessions/:sessionId/generate-video-link
// Creates a meeting URL from the configured provider. Custom Video Call
// supports a direct room API or a join URL template. Zoom supports
// Server-to-Server OAuth credentials. Google Meet uses an OAuth refresh token.
router.post('/:sessionId/generate-video-link', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const session = await getSessionById(req.params.sessionId);
    if (!session || session.EventId !== req.params.eventId) return res.status(404).json({ error: 'Session not found.' });
    const settings = await getEventAdminSettings(req.params.eventId);
    const vc = settings.videoConferencing || {};

    if (vc.useCustomVideoCall && vc.customVideoCall?.enabled) {
      const c = vc.customVideoCall;
      let url = '';
      if (c.apiBaseUrl && c.createRoomEndpoint) {
        const endpoint = `${String(c.apiBaseUrl).replace(/\/$/,'')}/${String(c.createRoomEndpoint).replace(/^\//,'')}`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}`, 'X-API-Key': c.apiKey } : {}) },
          body: JSON.stringify({ sessionId: session.SessionId, title: session.Title, startTime: session.StartTime, endTime: session.EndTime, eventId: event.EventId }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) return res.status(502).json({ error: data?.error || 'Custom video API could not create the room.' });
        url = data.joinUrl || data.meetingUrl || data.url || data.roomUrl || '';
      }
      if (!url && c.joinUrlTemplate) url = String(c.joinUrlTemplate).replaceAll('{{sessionId}}', String(session.SessionId)).replaceAll('{{eventId}}', String(event.EventId));
      if (!url) return res.status(400).json({ error: 'Configure a Custom Video Call API endpoint or Join URL Template first.' });
      const updated = await updateSession(session.SessionId, { virtualRoomUrl: url });
      return res.json({ provider: 'custom', meetingUrl: url, session: serializeSession(updated) });
    }

    if (vc.zoom?.enabled) {
      let accessToken = vc.zoom.accessToken || '';
      if (!accessToken && vc.zoom.accountId && vc.zoom.clientId && vc.zoom.clientSecret) {
        const basic = Buffer.from(`${vc.zoom.clientId}:${vc.zoom.clientSecret}`).toString('base64');
        const tokenRes = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(vc.zoom.accountId)}`, { method:'POST', headers:{ Authorization:`Basic ${basic}` } });
        const tokenData = await tokenRes.json().catch(()=>({}));
        if (!tokenRes.ok) return res.status(502).json({ error: tokenData?.reason || tokenData?.message || 'Zoom OAuth token request failed.' });
        accessToken = tokenData.access_token;
      }
      if (!accessToken) return res.status(400).json({ error: 'Configure Zoom Account ID, Client ID and Client Secret, or provide an access token.' });
      const start = String(session.StartTime).replace(' ','T');
      const end = new Date(session.EndTime);
      const begin = new Date(session.StartTime);
      const duration = Math.max(15, Math.round((end-begin)/60000));
      const meetingRes = await fetch('https://api.zoom.us/v2/users/me/meetings', { method:'POST', headers:{ Authorization:`Bearer ${accessToken}`, 'Content-Type':'application/json' }, body:JSON.stringify({ topic:session.Title, type:2, start_time:start, duration, agenda:session.ShortDescription||'' }) });
      const meeting = await meetingRes.json().catch(()=>({}));
      if (!meetingRes.ok) return res.status(502).json({ error: meeting?.message || 'Zoom could not create the meeting.' });
      const url = meeting.join_url;
      const updated = await updateSession(session.SessionId, { virtualRoomUrl: url });
      return res.json({ provider:'zoom', meetingUrl:url, session:serializeSession(updated) });
    }

    if (vc.googleMeet?.enabled) {
      if (!vc.googleMeet.clientId || !vc.googleMeet.clientSecret || !vc.googleMeet.refreshToken) return res.status(400).json({ error:'Configure Google Meet Client ID, Client Secret and OAuth Refresh Token first.' });
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({ client_id:vc.googleMeet.clientId, client_secret:vc.googleMeet.clientSecret, refresh_token:vc.googleMeet.refreshToken, grant_type:'refresh_token' }) });
      const tokenData = await tokenRes.json().catch(()=>({}));
      if (!tokenRes.ok) return res.status(502).json({ error: tokenData?.error_description || tokenData?.error || 'Google OAuth token request failed.' });
      const meetRes = await fetch('https://meet.googleapis.com/v2/spaces', { method:'POST', headers:{ Authorization:`Bearer ${tokenData.access_token}`, 'Content-Type':'application/json' }, body:'{}' });
      const space = await meetRes.json().catch(()=>({}));
      if (!meetRes.ok) return res.status(502).json({ error: space?.error?.message || space?.error || 'Google Meet could not create the meeting space.' });
      const url = space.meetingUri || space.meetingUri || space.meetingCode ? (space.meetingUri || `https://meet.google.com/${space.meetingCode}`) : '';
      if (!url) return res.status(502).json({ error:'Google Meet returned no meeting URL.' });
      const updated = await updateSession(session.SessionId, { virtualRoomUrl: url });
      return res.json({ provider:'google-meet', meetingUrl:url, session:serializeSession(updated) });
    }

    return res.status(400).json({ error:'Enable a configured video conferencing provider in Settings first.' });
  } catch (err) { next(err); }
});

// GET /api/events/:eventId/sessions/:sessionId
router.get('/:sessionId', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const session = await getSessionById(req.params.sessionId);
    if (!session || session.EventId !== req.params.eventId) {
      return res.status(404).json({ error: 'Session not found.' });
    }
    res.json(serializeSession(session));
  } catch (err) {
    next(err);
  }
});

// POST /api/events/:eventId/sessions
router.post('/', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;

    const { title, startTime, endTime } = req.body || {};
    if (!title || !startTime || !endTime) {
      return res.status(400).json({ error: 'title, startTime, and endTime are required.' });
    }
    if (new Date(endTime) <= new Date(startTime)) {
      return res.status(400).json({ error: 'endTime must be after startTime.' });
    }

    const created = await createSession(req.params.eventId, req.body);
    res.status(201).json(serializeSession(created));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/events/:eventId/sessions/:sessionId
router.patch('/:sessionId', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;

    const existing = await getSessionById(req.params.sessionId);
    if (!existing || existing.EventId !== req.params.eventId) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    const nextStart = req.body?.startTime ?? existing.StartTime;
    const nextEnd = req.body?.endTime ?? existing.EndTime;
    if (new Date(nextEnd) <= new Date(nextStart)) {
      return res.status(400).json({ error: 'endTime must be after startTime.' });
    }

    const updated = await updateSession(req.params.sessionId, req.body || {});
    res.json(serializeSession(updated));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/events/:eventId/sessions/:sessionId (soft delete)
router.delete('/:sessionId', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;

    const existing = await getSessionById(req.params.sessionId);
    if (!existing || existing.EventId !== req.params.eventId) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    await deleteSession(req.params.sessionId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// POST /api/events/:eventId/sessions/:sessionId/duplicate
router.post('/:sessionId/duplicate', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;

    const existing = await getSessionById(req.params.sessionId);
    if (!existing || existing.EventId !== req.params.eventId) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    const duplicated = await duplicateSession(req.params.sessionId);
    res.status(201).json(serializeSession(duplicated));
  } catch (err) {
    next(err);
  }
});


// ---------------------------------------------------------------------
// Session Speakers
// ---------------------------------------------------------------------

// GET /api/events/:eventId/sessions/:sessionId/speakers
router.get('/:sessionId/speakers', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const speakers = await getSessionSpeakers(req.params.sessionId);
    res.json(speakers.map(serializeSessionSpeaker));
  } catch (err) {
    next(err);
  }
});

// GET /api/events/:eventId/sessions/:sessionId/speaker-roster - for "Select Existing Speaker"
router.get('/:sessionId/speaker-roster', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const roster = await getEventSpeakerRoster(req.params.eventId);
    res.json(roster.map(serializeSpeakerRosterEntry));
  } catch (err) {
    next(err);
  }
});

// POST /api/events/:eventId/sessions/:sessionId/speakers
router.post('/:sessionId/speakers', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const { speakerProfileId, role } = req.body || {};
    if (!speakerProfileId) {
      return res.status(400).json({ error: 'speakerProfileId is required.' });
    }
    const created = await addSessionSpeaker(req.params.sessionId, speakerProfileId, role);
    res.status(201).json({ speakerProfileId: created.SpeakerProfileId, role: created.Role, sortOrder: created.SortOrder });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/events/:eventId/sessions/:sessionId/speakers/:speakerProfileId - change role
router.patch('/:sessionId/speakers/:speakerProfileId', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const { role } = req.body || {};
    const updated = await updateSessionSpeakerRole(req.params.sessionId, req.params.speakerProfileId, role);
    if (!updated) return res.status(404).json({ error: 'Speaker not found on this session.' });
    res.json({ speakerProfileId: updated.SpeakerProfileId, role: updated.Role });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/events/:eventId/sessions/:sessionId/speakers/:speakerProfileId
router.delete('/:sessionId/speakers/:speakerProfileId', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    await removeSessionSpeaker(req.params.sessionId, req.params.speakerProfileId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Session Documents
// ---------------------------------------------------------------------

// GET /api/events/:eventId/sessions/:sessionId/documents
router.get('/:sessionId/documents', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const docs = await getSessionDocuments(req.params.sessionId);
    res.json(docs.map(serializeSessionDocument));
  } catch (err) {
    next(err);
  }
});

// GET /api/events/:eventId/sessions/:sessionId/document-roster - "Add existing document"
router.get('/:sessionId/document-roster', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const roster = await getEventDocumentRoster(req.params.eventId);
    res.json(roster.map(serializeSessionDocument));
  } catch (err) {
    next(err);
  }
});

// POST /api/events/:eventId/sessions/:sessionId/documents - upload new
router.post('/:sessionId/documents', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const { title, fileUrl, fileType, fileSizeKb } = req.body || {};
    if (!title || !fileUrl) {
      return res.status(400).json({ error: 'title and fileUrl are required.' });
    }
    const created = await createSessionDocument(req.params.eventId, req.params.sessionId, req.user.sub, { title, fileUrl, fileType, fileSizeKb });
    res.status(201).json(serializeSessionDocument(created));
  } catch (err) {
    next(err);
  }
});

// POST /api/events/:eventId/sessions/:sessionId/documents/:documentId/attach - "Add existing document"
router.post('/:sessionId/documents/:documentId/attach', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const updated = await attachExistingDocument(req.params.sessionId, req.params.documentId);
    if (!updated) return res.status(404).json({ error: 'Document not found.' });
    res.json(serializeSessionDocument(updated));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/events/:eventId/sessions/:sessionId/documents/:documentId - detach
router.delete('/:sessionId/documents/:documentId', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    await removeSessionDocument(req.params.documentId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Live Polling
// ---------------------------------------------------------------------

// GET /api/events/:eventId/sessions/:sessionId/polls
router.get('/:sessionId/polls', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const polls = await getSessionPolls(req.params.sessionId);
    res.json(polls.map(serializeSessionPoll));
  } catch (err) {
    next(err);
  }
});

// POST /api/events/:eventId/sessions/:sessionId/polls
router.post('/:sessionId/polls', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const { question } = req.body || {};
    if (!question) {
      return res.status(400).json({ error: 'question is required.' });
    }
    const created = await createSessionPoll(req.params.eventId, req.params.sessionId, req.user.sub, req.body);
    res.status(201).json(serializeSessionPoll(created));
  } catch (err) {
    if (err.message.includes('Limited to 20')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// DELETE /api/events/:eventId/sessions/:sessionId/polls/:pollId
router.delete('/:sessionId/polls/:pollId', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    await deleteSessionPoll(req.params.pollId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Session Streams: Live Stream + Recorded Video
// ---------------------------------------------------------------------

// GET /api/events/:eventId/sessions/:sessionId/streams
router.get('/:sessionId/streams', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const streams = await getSessionStreams(req.params.sessionId);
    res.json(streams.map(serializeSessionStream));
  } catch (err) {
    next(err);
  }
});

// PUT /api/events/:eventId/sessions/:sessionId/streams/:streamType - upsert (Live | Recording)
router.put('/:sessionId/streams/:streamType', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const streamType = req.params.streamType === 'Recording' ? 'Recording' : 'Live';
    const updated = await upsertSessionStream(req.params.sessionId, streamType, req.body || {});
    res.json(serializeSessionStream(updated));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Session Sponsors
// ---------------------------------------------------------------------

// GET /api/events/:eventId/sessions/:sessionId/sponsors
router.get('/:sessionId/sponsors', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const sponsors = await getSessionSponsors(req.params.sessionId);
    res.json(sponsors.map(serializeSessionSponsor));
  } catch (err) {
    next(err);
  }
});

// POST /api/events/:eventId/sessions/:sessionId/sponsors
router.post('/:sessionId/sponsors', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const { sponsorProfileId } = req.body || {};
    if (!sponsorProfileId) {
      return res.status(400).json({ error: 'sponsorProfileId is required.' });
    }
    const created = await addSessionSponsor(req.params.sessionId, sponsorProfileId);
    res.status(201).json({ id: created.SessionSponsorId, sponsorProfileId: created.SponsorProfileId });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/events/:eventId/sessions/:sessionId/sponsors/:sessionSponsorId
router.delete('/:sessionId/sponsors/:sessionSponsorId', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    await removeSessionSponsor(req.params.sessionSponsorId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Session Tags
// ---------------------------------------------------------------------

// GET /api/events/:eventId/sessions/:sessionId/tags
router.get('/:sessionId/tags', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const tags = await getSessionTagAssignments(req.params.sessionId);
    res.json(tags.map(serializeSessionTag));
  } catch (err) {
    next(err);
  }
});

// PUT /api/events/:eventId/sessions/:sessionId/tags - replace the full set, max 4
router.put('/:sessionId/tags', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const { tagIds } = req.body || {};
    if (!Array.isArray(tagIds)) {
      return res.status(400).json({ error: 'tagIds must be an array.' });
    }
    const tags = await setSessionTags(req.params.sessionId, tagIds);
    res.json(tags.map(serializeSessionTag));
  } catch (err) {
    if (err.message.includes('Up to 4')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------
// Session Authors
// ---------------------------------------------------------------------

// GET /api/events/:eventId/sessions/:sessionId/authors
router.get('/:sessionId/authors', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const authors = await getSessionAuthors(req.params.sessionId);
    res.json(authors.map(serializeSessionAuthor));
  } catch (err) {
    next(err);
  }
});

// POST /api/events/:eventId/sessions/:sessionId/authors
router.post('/:sessionId/authors', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    const { firstName, lastName } = req.body || {};
    if (!firstName || !lastName) {
      return res.status(400).json({ error: 'firstName and lastName are required.' });
    }
    const created = await addSessionAuthor(req.params.sessionId, req.body);
    res.status(201).json(serializeSessionAuthor(created));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/events/:eventId/sessions/:sessionId/authors/:authorId
router.delete('/:sessionId/authors/:authorId', async (req, res, next) => {
  try {
    const event = await assertOwnedEvent(req, res);
    if (!event) return;
    await removeSessionAuthor(req.params.authorId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
