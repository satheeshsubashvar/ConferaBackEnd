import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import {
  findUserByEmail,
  getOrganizationForPerson,
  getLoginPageSettings,
  updateLoginPageSettings,
  registerOrganizer,
  findPersonByVerificationToken,
  markEmailVerified,
  setEmailVerificationToken,
} from '../data/store.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { sendVerificationEmail } from '../utils/mail.js';

const router = Router();

const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function newVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

// The email in the verification link has to point back at *this*
// Admin app (not the API) so clicking it lands on a page that can
// call POST /verify-email. The Admin frontend is whatever Origin the
// signup request came from; ADMIN_APP_URL is a fallback for contexts
// where that header isn't present (e.g. a manual resend job).
function adminAppUrl(req) {
  return (req.headers.origin || process.env.ADMIN_APP_URL || 'http://localhost:5173').replace(/\/$/, '');
}

// Public: the login screen must be able to load its design before authentication.
router.get('/login-banner-settings', async (req, res, next) => {
  try { res.json(await getLoginPageSettings()); } catch (err) { next(err); }
});

router.patch('/login-banner-settings', requireAuth, async (req, res, next) => {
  try {
    res.json(await updateLoginPageSettings(req.body || {}));
  } catch (err) { next(err); }
});

// POST /api/auth/register — "Create Organizer Account". Creates a
// brand-new Organization owned by a brand-new Person, and emails (or,
// with no provider configured, logs + returns) a verification link.
// The account can't log in until that link is used — see /login below.
router.post('/register', async (req, res, next) => {
  try {
    const body = req.body || {};
    const email = String(body.email || '').trim();
    const password = String(body.password || '');
    const firstName = String(body.firstName || '').trim();
    const lastName = String(body.lastName || '').trim();
    const organizationName = String(body.organizationName || '').trim();

    if (!firstName) return res.status(400).json({ error: 'Please enter your first name.' });
    if (!lastName) return res.status(400).json({ error: 'Please enter your last name.' });
    if (!email || !EMAIL_PATTERN.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
    if (!organizationName) return res.status(400).json({ error: 'Please enter your organization name.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const passwordHash = bcrypt.hashSync(password, 10);
    const verificationToken = newVerificationToken();
    const verificationExpiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);

    const { personId } = await registerOrganizer({
      email,
      passwordHash,
      firstName,
      lastName,
      organizationName,
      verificationToken,
      verificationExpiresAt,
    });

    const verifyUrl = `${adminAppUrl(req)}/verify-email?token=${verificationToken}`;
    await sendVerificationEmail({ to: email, name: `${firstName} ${lastName}`.trim(), verifyUrl });

    return res.status(201).json({
      personId,
      email,
      // No real email provider is wired up yet (see utils/mail.js) —
      // the link is returned here so the frontend can show it
      // directly instead of leaving the person stuck with nothing to
      // click. Once a provider is configured this field can be
      // dropped from the response.
      devVerifyUrl: verifyUrl,
    });
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ error: err.message });
    next(err);
  }
});

// POST /api/auth/verify-email — called by the Admin frontend's
// /verify-email page after the person clicks the link in their email.
router.post('/verify-email', async (req, res, next) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Missing verification token.' });

    const person = await findPersonByVerificationToken(token);
    if (!person) return res.status(400).json({ error: 'This verification link is invalid or has already been used.' });

    if (person.EmailVerificationExpiresAt && new Date(person.EmailVerificationExpiresAt) < new Date()) {
      return res.status(400).json({ error: 'This verification link has expired. Request a new one from the login page.' });
    }

    await markEmailVerified(person.PersonId);
    return res.json({ verified: true, email: person.Email });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/resend-verification — for a person who signed up but
// lost or expired their link. Always responds the same way whether or
// not the email exists / is already verified, so this can't be used
// to probe which emails have accounts.
router.post('/resend-verification', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim();
    if (!email) return res.status(400).json({ error: 'Please enter your email address.' });

    const person = await findUserByEmail(email);
    const generic = { message: "If that email has a pending signup, we've sent a new verification link." };

    if (!person || person.EmailVerifiedAt) return res.json(generic);

    const verificationToken = newVerificationToken();
    const verificationExpiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
    await setEmailVerificationToken(person.PersonId, verificationToken, verificationExpiresAt);

    const verifyUrl = `${adminAppUrl(req)}/verify-email?token=${verificationToken}`;
    await sendVerificationEmail({ to: person.Email, name: person.FullName, verifyUrl });

    return res.json({ ...generic, devVerifyUrl: verifyUrl });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const person = await findUserByEmail(email);

    if (!person || !bcrypt.compareSync(password, person.PasswordHash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const organizationId = await getOrganizationForPerson(person.PersonId);

    if (!organizationId) {
      // A Person with no OrganizationUsers row isn't an organizer —
      // they may be a Portal attendee only. Admin login requires org
      // membership.
      return res.status(403).json({ error: 'This account has no organizer access.' });
    }

    if (!person.EmailVerifiedAt) {
      return res.status(403).json({
        error: 'Please verify your email before signing in. Check your inbox for the verification link.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    const token = signToken({
      sub: person.PersonId,
      email: person.Email,
      organizationId,
    });

    return res.json({
      token,
      user: {
        id: person.PersonId,
        name: person.FullName,
        email: person.Email,
        organizationId,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
