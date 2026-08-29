-- =====================================================================
-- Adds columns needed for two Confera Admin pages that don't map
-- cleanly onto the existing schema shape:
--
-- 1. Web App Speaker Page (Images 3-4 reference): banner pattern
--    picker (Gradient/Polygon/Waves/Splatter/StarField/Brick) and
--    speaker card layout picker (FullWidth/Basic/Gradient/PhotoFocused).
--    WebsiteThemes (migration 015) is the right table for this — it's
--    per-event visual settings — but has no columns for either
--    picker. Adding them here rather than repurposing PrimaryColor/
--    CustomCss, which would make the data ambiguous.
--
-- 2. Customize Resources (Images 1-2 reference): the Portal Resources
--    submenu needs to distinguish built-in items (Session Q&A,
--    Recordings, Floormap — can be enabled/disabled but never
--    deleted) from organizer-added custom items (can be added,
--    edited, deleted; capped at 5). PortalNavItems already has
--    IsVisible (enable/disable) and SortOrder (drag-reorder) — only
--    IsBuiltIn is missing.
-- =====================================================================

ALTER TABLE "WebsiteThemes"
  ADD COLUMN IF NOT EXISTS "SpeakerPageBannerPattern" character varying(50) NOT NULL DEFAULT 'Gradient',
  ADD COLUMN IF NOT EXISTS "SpeakerCardStyle" character varying(50) NOT NULL DEFAULT 'FullWidth',
  ADD COLUMN IF NOT EXISTS "SpeakerGridColumns" integer NOT NULL DEFAULT 4;

ALTER TABLE "PortalNavItems"
  ADD COLUMN IF NOT EXISTS "IsBuiltIn" boolean NOT NULL DEFAULT true;

-- Backfill: the resource items created by seed.js under the
-- "resources" parent were all built-in (Session Q&A, Recordings,
-- Floormap, Logistics, Instagram, Documents, Polls, Surveys, Twitter,
-- Confera Guides) — this migration runs after they may already exist,
-- so the DEFAULT true above already covers them correctly. No
-- backfill UPDATE needed since nothing is custom yet at this point.
