import nodemailer from 'nodemailer';

// Sends real email via SMTP when backend/.env has SMTP_HOST, SMTP_USER
// and SMTP_PASS set (see .env.example for a Gmail app-password
// walkthrough) — falls back to logging the message to the server
// console otherwise, or if sending fails for any reason (bad
// credentials, network hiccup, whatever). A broken outbound email
// should never be the reason someone can't sign up, reset a password,
// or find out they've been added to an event — every caller also
// hands the link back through its own API response (devVerifyUrl /
// devResetUrl) so the relevant flow works end-to-end even with no
// provider configured at all.

let cachedTransporter = null;
let cachedTransporterKey = '';

function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;

  const port = Number(SMTP_PORT) || 587;
  const key = `${SMTP_HOST}:${port}:${SMTP_USER}`;
  if (cachedTransporter && cachedTransporterKey === key) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    // Port 465 is implicit TLS from the first byte; everything else
    // (587, 25, ...) starts plaintext and upgrades via STARTTLS —
    // nodemailer needs to be told which, it can't detect it.
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  cachedTransporterKey = key;
  return cachedTransporter;
}

function emailShell(title, bodyHtml) {
  return `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f4f7;padding:32px 0;margin:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px;max-width:90%;">
        <tr><td>
          <p style="font-weight:700;font-style:italic;font-size:20px;color:#4c1d95;margin:0 0 24px;">Confera</p>
          <h1 style="font-size:18px;margin:0 0 12px;color:#111827;">${title}</h1>
          ${bodyHtml}
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
}

function ctaButton(url, label) {
  return `<p style="margin:24px 0;"><a href="${url}" style="background:#7c3aed;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;display:inline-block;font-size:14px;">${label}</a></p>
    <p style="font-size:12px;color:#6b7280;word-break:break-all;">${url}</p>`;
}

async function sendMail({ to, subject, html, devLabel }) {
  const transporter = getTransporter();

  if (!transporter) {
    console.log(
      [
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '  [mail:dev] No SMTP configured (see backend/.env.example) —',
        `  this would be a real email to ${to}:`,
        '',
        `  Subject: ${subject}`,
        `  ${devLabel || ''}`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
      ].join('\n')
    );
    return { delivered: false, dev: true };
  }

  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || `"Confera" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
    return { delivered: true };
  } catch (err) {
    console.error('[mail] Send failed, falling back to console log:', err.message);
    console.log(`  [mail:dev-fallback] ${subject} -> ${to}\n  ${devLabel || ''}`);
    return { delivered: false, dev: true, error: err.message };
  }
}

// Used by /api/auth/register and /resend-verification (organizer signup).
export async function sendVerificationEmail({ to, name, verifyUrl }) {
  return sendMail({
    to,
    subject: 'Verify your email for Confera',
    devLabel: `Link: ${verifyUrl}`,
    html: emailShell(
      'Verify your email',
      `<p style="color:#374151;font-size:14px;">Hi ${name || 'there'}, welcome to Confera. Confirm your email to finish setting up your organizer account.</p>
       ${ctaButton(verifyUrl, 'Verify email')}`
    ),
  });
}

// Used by the Portal's self-service "Forgot your password?" flow (see
// routes/portalAuth.js).
export async function sendPasswordResetEmail({ to, name, resetUrl }) {
  return sendMail({
    to,
    subject: 'Reset your Confera password',
    devLabel: `Link: ${resetUrl}`,
    html: emailShell(
      'Reset your password',
      `<p style="color:#374151;font-size:14px;">Hi ${name || 'there'}, click below to set a new password for your Confera account.</p>
       ${ctaButton(resetUrl, 'Set new password')}
       <p style="font-size:12px;color:#9ca3af;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>`
    ),
  });
}

// Used by utils/portalInvite.js — sent proactively the moment someone
// is added as an Attendee/Speaker/Sponsor/Exhibitor (one at a time or
// via an Excel import), since they'd otherwise have no way to know a
// Portal account for them even exists.
export async function sendPortalInviteEmail({ to, name, eventName, resetUrl }) {
  return sendMail({
    to,
    subject: `You've been added to ${eventName} on Confera`,
    devLabel: `Link: ${resetUrl}`,
    html: emailShell(
      `You're in for ${eventName}`,
      `<p style="color:#374151;font-size:14px;">Hi ${name || 'there'}, you've been added to <strong>${eventName}</strong> on Confera. Set your password to sign in to the event Portal.</p>
       ${ctaButton(resetUrl, 'Set your password')}
       <p style="font-size:12px;color:#9ca3af;">This link expires in 7 days.</p>`
    ),
  });
}
