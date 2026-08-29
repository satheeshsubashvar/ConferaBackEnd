-- =====================================================================
-- Seeds SessionFormats (global lookup, like EventTypes) and one
-- starter Track for the demo event, so Session Manager's format/track
-- dropdowns aren't empty on first load. Safe to run multiple times —
-- only inserts rows that don't already exist by name.
-- =====================================================================

INSERT INTO "SessionFormats" ("Name", "Description", "DefaultDuration", "Icon")
SELECT v.name, v.description, v.duration, v.icon
FROM (VALUES
  ('Keynote', 'Main-stage address to the full audience', 45, 'Mic'),
  ('Panel', 'Multiple speakers in moderated discussion', 60, 'Users'),
  ('Workshop', 'Hands-on, interactive session', 90, 'Wrench'),
  ('Fireside Chat', 'Informal conversation format', 30, 'MessageCircle'),
  ('Breakout', 'Smaller, topic-focused session', 45, 'Split'),
  ('Networking', 'Structured networking time', 30, 'Handshake'),
  ('Lightning Talk', 'Short, rapid-fire presentation', 10, 'Zap')
) AS v(name, description, duration, icon)
WHERE NOT EXISTS (
  SELECT 1 FROM "SessionFormats" sf WHERE sf."Name" = v.name
);

-- One default track per event that doesn't have any yet, so the
-- Session Manager form has something to select without requiring
-- Track Manager to be built first.
INSERT INTO "Tracks" ("EventId", "Name", "Description", "Color", "SortOrder")
SELECT e."EventId", 'General', 'Default track for sessions not yet categorized', '#7c3aed', 0
FROM "Event" e
WHERE NOT EXISTS (
  SELECT 1 FROM "Tracks" t WHERE t."EventId" = e."EventId"
);
