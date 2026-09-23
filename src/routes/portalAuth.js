import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import {
  findAttendeeByEmail,
  findOrganizerByEmailForEvent,
  getEventById,
  findUserByEmail,
  setPasswordResetToken,
  findPersonByPasswordResetToken,
  resetPersonPassword,
  findEventsForEmail,
  registerPortalParticipant,
} from '../data/store.js';
import { signToken } from '../middleware/auth.js';
import { sendPasswordResetEmail } from '../utils/mail.js';

// Separate from /api/auth (Admin organizer login, which is restricted
// to organizers only). Portal login is open to every role that has a
// stake in this event: Attendee, Speaker, Sponsor, Exhibitor (via
// EventParticipant), and Organizer (via OrganizationUsers, so an
// organizer can also sign into the Portal — e.g. to preview it —
// without that being their only way in; /api/auth remains their
// normal path and is organizer-only).

const router = Router();

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

function newResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

// The reset link has to point back at *this* Portal app (not the API)
// so clicking it lands on a page that can call POST /reset-password.
// The Portal frontend is whatever Origin the request came from;
// PORTAL_APP_URL is a fallback for contexts where that header isn't
// present.
function portalAppUrl(req) {
  return (req.headers.origin || process.env.PORTAL_APP_URL || 'http://localhost:5174').replace(/\/$/, '');
}

// POST /api/portal-auth/find-events — the bare, event-agnostic /login
// screen (reached from the Landing Page's "Portal" links, which have
// no event context at all) asks for an email first and calls this to
// find out which event(s) it should actually show, instead of always
// showing whichever one VITE_DEFAULT_EVENT_ID happened to be pointed
// at. Doesn't require the password yet — that's still checked by
// /login once the person picks (or is auto-routed to) their event.
router.post('/find-events', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim();
    if (!email) return res.status(400).json({ error: 'Please enter your email address.' });

    const events = await findEventsForEmail(email);
    return res.json({ events });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password, eventId } = req.body || {};

    if (!email || !password || !eventId) {
      return res.status(400).json({ error: 'Email, password, and eventId are required.' });
    }

    let person = await findAttendeeByEmail(email, eventId);
    let role = person?.ParticipantRole || null;
    let participantId = person?.EventParticipantId || null;

    if (!person) {
      // Not a participant of this event — check whether they're the
      // organizer/owner of it instead.
      person = await findOrganizerByEmailForEvent(email, eventId);
      role = person ? 'Organizer' : null;
      participantId = null;
    }

    if (!person || !bcrypt.compareSync(password, person.PasswordHash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = signToken({
      sub: person.PersonId,
      email: person.Email,
      eventId,
      participantId,
      role,
    });

    const event = await getEventById(eventId);

    return res.json({
      token,
      attendee: {
        id: person.PersonId,
        name: person.FullName,
        email: person.Email,
        eventId,
        eventName: event?.Title || null,
        role,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/portal-auth/register — the Portal's own "Sign up here" flow
// (SignUpPage.jsx), reached from a specific event's /login/<eventId>
// screen. Unlike everyone else in the Portal (added by an organizer,
// one at a time or via an Excel import — see routes/attendees.js,
// store.js createSpeaker/createSponsor/createExhibitor), this person
// picks their own password right here, so there's no placeholder hash
// and no invite email involved; see store.js registerPortalParticipant
// for how each role is actually created. Only works for Published
// events — an organizer previewing a Draft event has no reason to let
// strangers self-register into it yet.
router.post('/register', async (req, res, next) => {
  try {
    const b = req.body || {};
    const eventId = String(b.eventId || '').trim();
    const role = String(b.role || '').trim();
    const email = String(b.email || '').trim();
    const password = String(b.password || '');
    const firstName = String(b.firstName || '').trim();
    const lastName = String(b.lastName || '').trim();
    const company = b.company ? String(b.company).trim() : null;
    const jobTitle = b.jobTitle ? String(b.jobTitle).trim() : null;

    const VALID_ROLES = ['Attendee', 'Speaker', 'Sponsor', 'Exhibitor'];
    if (!eventId) return res.status(400).json({ error: 'Missing event.' });
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Please choose how you want to register.' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (!firstName || !lastName) {
      return res.status(400).json({ error: 'First and last name are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const event = await getEventById(eventId);
    if (!event || event.Status !== 'Published') {
      return res.status(404).json({ error: 'This event is not open for registration.' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    let result;
    try {
      result = await registerPortalParticipant({
        eventId, role, email, passwordHash, firstName, lastName, company, jobTitle,
      });
    } catch (err) {
      if (err.status === 409) return res.status(409).json({ error: err.message });
      throw err;
    }

    const token = signToken({
      sub: result.personId,
      email,
      eventId,
      participantId: null,
      role: result.role,
    });

    return res.status(201).json({
      token,
      attendee: {
        id: result.personId,
        name: `${firstName} ${lastName}`.trim(),
        email,
        eventId,
        eventName: event.Title || null,
        role: result.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/portal-auth/forgot-password — this is the only way a
// participant added by an organizer (manually, or via any of the
// Excel imports) ever gets a real, working password: their account
// was created with a placeholder PasswordHash that never matches any
// input (see store.js createSpeaker/createSponsor/etc). Always
// responds the same way whether or not the email has an account, so
// this can't be used to probe which emails are registered.
router.post('/forgot-password', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim();
    const eventId = req.body?.eventId ? String(req.body.eventId) : '';
    const generic = { message: "If that email has a Confera account, we've sent a link to set a password." };

    if (!email) return res.status(400).json({ error: 'Please enter your email address.' });

    const person = await findUserByEmail(email);
    if (!person) return res.json(generic);

    const token = newResetToken();
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);
    await setPasswordResetToken(person.PersonId, token, expiresAt);

    const resetUrl = `${portalAppUrl(req)}/reset-password?token=${token}${eventId ? `&eventId=${eventId}` : ''}`;
    await sendPasswordResetEmail({ to: person.Email, name: person.FullName, resetUrl });

    return res.json({
      ...generic,
      // Same dev-mode fallback as /api/auth/register's devVerifyUrl —
      // no real email provider is configured yet, so the link is
      // returned directly rather than leaving the person stuck with
      // nothing to click. Drop this once a provider is wired up.
      devResetUrl: resetUrl,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/portal-auth/reset-password — called by ResetPasswordPage
// after the person opens the link (real email or the dev fallback
// above). Works whether this is truly a "reset" or the person's very
// first real password.
router.post('/reset-password', async (req, res, next) => {
  try {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');

    if (!token) return res.status(400).json({ error: 'Missing reset token.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const person = await findPersonByPasswordResetToken(token);
    if (!person) return res.status(400).json({ error: 'This reset link is invalid or has already been used.' });

    if (person.PasswordResetExpiresAt && new Date(person.PasswordResetExpiresAt) < new Date()) {
      return res.status(400).json({ error: 'This reset link has expired. Request a new one from the login page.' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    await resetPersonPassword(person.PersonId, passwordHash);

    return res.json({ reset: true, email: person.Email });
  } catch (err) {
    next(err);
  }
});

export default router;
