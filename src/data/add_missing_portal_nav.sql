-- =====================================================================
-- Adds "Feedback to Confera" and "Organizer Tips" to the Portal
-- sidebar for every existing event's PortalNavItems, without a full
-- reseed. Safe to re-run — checks per-event whether the items already
-- exist before inserting.
-- =====================================================================

DO $$
DECLARE
  evt RECORD;
BEGIN
  FOR evt IN SELECT "EventId" FROM "Event" LOOP
    IF NOT EXISTS (
      SELECT 1 FROM "PortalNavItems"
      WHERE "EventId" = evt."EventId" AND "Key" = 'feedback-to-confera'
    ) THEN
      INSERT INTO "PortalNavItems" ("EventId", "Key", "Label", "Icon", "Route", "SortOrder")
      VALUES (evt."EventId", 'feedback-to-confera', 'Feedback to Confera', 'MessageCircle', '/feedback', 10);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM "PortalNavItems"
      WHERE "EventId" = evt."EventId" AND "Key" = 'organizer-tips'
    ) THEN
      INSERT INTO "PortalNavItems" ("EventId", "Key", "Label", "Icon", "Route", "SortOrder")
      VALUES (evt."EventId", 'organizer-tips', 'Organizer Tips', 'Lightbulb', '/organizer-tips', 11);
    END IF;
  END LOOP;

  RAISE NOTICE 'Feedback to Confera / Organizer Tips added to all events'' Portal sidebars.';
END $$;
