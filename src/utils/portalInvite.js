import crypto from 'crypto';
import { pool } from '../data/db.js';
import { sendPortalInviteEmail } from './mail.js';

// Called right after a Person is added to an event as an Attendee,
// Speaker, Sponsor or Exhibitor — one at a time, or via any of the
// Excel imports (see store.js createSpeaker/createSponsor/
// createExhibitor and routes/attendees.js). Without this, the only
// way any of them could ever get a working Portal password was to
// happen to click "Forgot your password?" on an account they had no
// reason to know existed (see add_password_reset.sql for the full
// story). This sends that same set-password link proactively, right
// when they're added, instead of waiting for them to guess.
//
// Deliberately standalone from store.js (rather than importing its
// setPasswordResetToken/getEventById) to avoid a circular import —
// store.js's create* functions are exactly what call this.
//
// Never throws: a failed invite email should never break the admin's
// create/import action. Worst case, the person just falls back to
// "Forgot your password?" like before this existed.
export async function sendPortalInviteIfNeeded({ personId, email, fullName, passwordHash, eventId }) {
  try {
    // Already has a real password — they're a known Confera user
    // (an organizer, or added to a different event before). Portal
    // passwords are per-person, not per-event, so they can already
    // sign in with what they have, just at this event's own
    // /login/<eventId> — no new invite needed.
    if (!passwordHash || !passwordHash.startsWith('not-a-real-hash')) return;

    const token = crypto.randomBytes(32).toString('hex');
    // Longer-lived than the self-service "forgot password" reset (1
    // hour): nobody prompted this person to act on it right away the
    // way clicking "forgot password" does, so it needs to survive
    // sitting unread in an inbox for a while.
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      `UPDATE "Person" SET "PasswordResetToken" = $2, "PasswordResetExpiresAt" = $3 WHERE "PersonId" = $1`,
      [personId, token, expiresAt]
    );

    const { rows } = await pool.query('SELECT "Title" FROM "Event" WHERE "EventId" = $1', [eventId]);
    const eventName = rows[0]?.Title || 'your event';

    const portalUrl = (process.env.PORTAL_APP_URL || 'http://localhost:5174').replace(/\/$/, '');
    const resetUrl = `${portalUrl}/reset-password?token=${token}&eventId=${eventId}`;

    await sendPortalInviteEmail({ to: email, name: fullName, eventName, resetUrl });
  } catch (err) {
    console.error('Failed to send Portal invite email:', err);
  }
}
