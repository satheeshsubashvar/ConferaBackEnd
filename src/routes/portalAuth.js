import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { findAttendeeByEmail, findOrganizerByEmailForEvent, getEventById } from '../data/store.js';
import { signToken } from '../middleware/auth.js';

// Separate from /api/auth (Admin organizer login, which is restricted
// to organizers only). Portal login is open to every role that has a
// stake in this event: Attendee, Speaker, Sponsor, Exhibitor (via
// EventParticipant), and Organizer (via OrganizationUsers, so an
// organizer can also sign into the Portal — e.g. to preview it —
// without that being their only way in; /api/auth remains their
// normal path and is organizer-only).

const router = Router();

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

export default router;
