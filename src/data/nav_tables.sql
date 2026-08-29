-- =====================================================================
-- Confera Admin/Portal navigation menus — additive to the 32-migration
-- schema. Nothing in the original 72-table schema or the 32 migrations
-- models "sidebar navigation structure", so these are new tables, not
-- a duplicate of anything that already exists.
-- =====================================================================

CREATE TABLE IF NOT EXISTS "AdminNavItems" (
    "AdminNavItemId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "ParentId" uuid REFERENCES "AdminNavItems"("AdminNavItemId") ON DELETE CASCADE,
    "Key" character varying(100) NOT NULL UNIQUE,
    "Label" character varying(200) NOT NULL,
    "Icon" character varying(50),
    "SortOrder" integer NOT NULL DEFAULT 0,
    "IsSection" boolean NOT NULL DEFAULT false,
    "Badge" character varying(20),
    "IsActive" boolean NOT NULL DEFAULT true,
    "CreatedAt" timestamp without time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "IX_AdminNavItems_ParentId" ON "AdminNavItems" ("ParentId");

CREATE TABLE IF NOT EXISTS "PortalNavItems" (
    "PortalNavItemId" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "EventId" uuid NOT NULL REFERENCES "Event"("EventId") ON DELETE CASCADE,
    "ParentId" uuid REFERENCES "PortalNavItems"("PortalNavItemId") ON DELETE CASCADE,
    "Key" character varying(100) NOT NULL,
    "Label" character varying(200) NOT NULL,
    "Icon" character varying(50),
    "Route" character varying(200),
    "SortOrder" integer NOT NULL DEFAULT 0,
    "BadgeCount" integer,
    "IsVisible" boolean NOT NULL DEFAULT true,
    "CreatedAt" timestamp without time zone NOT NULL DEFAULT now(),
    UNIQUE ("EventId", "Key")
);

CREATE INDEX IF NOT EXISTS "IX_PortalNavItems_EventId" ON "PortalNavItems" ("EventId");
CREATE INDEX IF NOT EXISTS "IX_PortalNavItems_ParentId" ON "PortalNavItems" ("ParentId");
