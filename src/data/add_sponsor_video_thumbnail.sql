-- Sponsor media enhancement: store a poster/thumbnail for sponsor videos.
ALTER TABLE "SponsorProfile"
  ADD COLUMN IF NOT EXISTS "VideoThumbnailUrl" varchar(1000);
