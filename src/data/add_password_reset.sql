-- Adds self-serve "forgot / set password" for any Person account.
--
-- Why this exists: a Portal participant added by an organizer — via
-- Attendees, Speaker Center, Sponsor Manager, Exhibitor Manager, or any
-- of their Excel imports — gets a Person row with a placeholder,
-- non-working PasswordHash (see store.js createSpeaker/createSponsor/
-- findOrCreateSponsorContact/etc, e.g. 'not-a-real-hash-speaker-center-
-- created'). Nothing ever sets a real password for them, so "forgot
-- password" on the Portal login screen is their ONLY path to a working
-- one, not just a recovery option for someone who already had one.
--
-- Idempotent (IF NOT EXISTS everywhere) and safe to re-run on every
-- backend startup, same pattern as the other add_*.sql migrations
-- wired into initDatabase().

ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "PasswordResetToken" varchar(128) NULL;
ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "PasswordResetExpiresAt" timestamp NULL;

CREATE INDEX IF NOT EXISTS "idx_person_password_reset_token"
  ON "Person" ("PasswordResetToken");
