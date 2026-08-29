ALTER TABLE "Categories" ADD COLUMN IF NOT EXISTS "Color" varchar(20) DEFAULT '#7c3aed';
UPDATE "Categories" SET "Color"='#7c3aed' WHERE "Color" IS NULL OR "Color"='';
