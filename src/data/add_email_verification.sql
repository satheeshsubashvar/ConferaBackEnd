-- Adds self-serve organizer signup with email verification.
--
-- Idempotent (IF NOT EXISTS everywhere) and safe to re-run on every
-- backend startup, same pattern as the other add_*.sql migrations
-- wired into initDatabase().

ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "EmailVerifiedAt" timestamp NULL;
ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "EmailVerificationToken" varchar(128) NULL;
ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "EmailVerificationExpiresAt" timestamp NULL;

CREATE INDEX IF NOT EXISTS "idx_person_email_verification_token"
  ON "Person" ("EmailVerificationToken");

-- Backward compatibility: every Person row that existed before this
-- migration (seeded demo accounts, attendees imported by organizers,
-- etc.) was able to log in without ever going through email
-- verification. Grandfather those in as verified so this feature
-- doesn't lock anyone out retroactively.
--
-- This is safe to run on every startup: a row created by the new
-- self-serve /api/auth/register endpoint always has
-- EmailVerificationToken set (non-null) until the person actually
-- verifies, so it's excluded here — this UPDATE only ever touches
-- rows that never went through the verification flow at all.
UPDATE "Person"
SET "EmailVerifiedAt" = now()
WHERE "EmailVerifiedAt" IS NULL
  AND "EmailVerificationToken" IS NULL;
