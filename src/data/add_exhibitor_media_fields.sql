ALTER TABLE "ExhibitorProfile"
  ADD COLUMN IF NOT EXISTS "PhotoUrl" varchar(1000),
  ADD COLUMN IF NOT EXISTS "VideoThumbnailUrl" varchar(1000);
