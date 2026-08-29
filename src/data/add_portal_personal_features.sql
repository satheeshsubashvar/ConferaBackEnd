-- Portal attendee personal features. These are additive and safe to run
-- against an existing Confera database.
CREATE TABLE IF NOT EXISTS "PortalMyAgenda" (
  "AgendaId" BIGSERIAL PRIMARY KEY,
  "EventId" UUID NOT NULL,
  "PersonId" UUID NOT NULL,
  "SessionId" UUID NOT NULL,
  "CreatedAt" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  CONSTRAINT "UQ_PortalMyAgenda_Event_Person_Session"
    UNIQUE ("EventId","PersonId","SessionId")
);

CREATE INDEX IF NOT EXISTS "IX_PortalMyAgenda_Event_Person"
  ON "PortalMyAgenda" ("EventId","PersonId");

CREATE TABLE IF NOT EXISTS "PortalSurveyResponses" (
  "ResponseId" BIGSERIAL PRIMARY KEY,
  "EventId" UUID NOT NULL,
  "SurveyTemplateId" UUID NOT NULL,
  "PersonId" UUID NOT NULL,
  "Answers" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "CreatedAt" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  "UpdatedAt" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  CONSTRAINT "UQ_PortalSurveyResponse_Event_Survey_Person"
    UNIQUE ("EventId","SurveyTemplateId","PersonId")
);

CREATE INDEX IF NOT EXISTS "IX_PortalSurveyResponses_Event_Survey"
  ON "PortalSurveyResponses" ("EventId","SurveyTemplateId");
