-- =====================================================================
-- Seeds EventTypes with common categories, matching the dropdown
-- options shown in the Whova reference UI (Association gathering,
-- Conference, Corporate event, Expo, Festival/Fair, Training event,
-- Entertainment/Sport, Other). Safe to run multiple times — only
-- inserts types that don't already exist by name.
-- =====================================================================

INSERT INTO "EventTypes" ("Name", "Description", "IsActive")
SELECT v.name, v.description, true
FROM (VALUES
  ('Conference', 'Multi-session professional conference'),
  ('Corporate event', 'Internal or company-hosted event'),
  ('Association gathering', 'Association, society, or membership-body event'),
  ('Expo', 'Trade show or exhibition-focused event'),
  ('Festival/Fair', 'Public festival or fair'),
  ('Training event', 'Workshop, training, or educational session'),
  ('Entertainment/Sport', 'Entertainment or sporting event'),
  ('Other', 'Any event type not covered above')
) AS v(name, description)
WHERE NOT EXISTS (
  SELECT 1 FROM "EventTypes" et WHERE et."Name" = v.name
);
