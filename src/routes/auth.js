import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { findUserByEmail, getOrganizationForPerson, getLoginPageSettings, updateLoginPageSettings } from '../data/store.js';
import { requireAuth, signToken } from '../middleware/auth.js';

const router = Router();

// Public: the login screen must be able to load its design before authentication.
router.get('/login-banner-settings', async (req, res, next) => {
  try { res.json(await getLoginPageSettings()); } catch (err) { next(err); }
});

router.patch('/login-banner-settings', requireAuth, async (req, res, next) => {
  try {
    res.json(await updateLoginPageSettings(req.body || {}));
  } catch (err) { next(err); }
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
