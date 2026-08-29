import pg from 'pg';

const { Pool, types } = pg;

// Postgres OID 1114 = "timestamp without time zone" — used by
// Event.StartDate/EndDate and every other date/datetime column in
// this schema. By default, node-postgres parses these into JS Date
// objects by treating the stored value as local wall-clock time and
// converting to a UTC-based Date internally. Any later formatting
// that reads UTC components back out (toISOString(), getUTCDate(),
// etc.) then reflects the SERVER'S TIMEZONE, not the value actually
// stored — e.g. midnight Oct 1 stored in the database silently
// becomes Sep 30 when the Node process runs in Asia/Calcutta
// (UTC+5:30), since converting "local midnight" to UTC rolls the
// clock backward across the date boundary.
//
// Returning the raw string instead (e.g. "2026-10-01T00:00:00")
// sidesteps this entirely — the value is used as-is, with no
// timezone conversion at any point from database to serializer.
types.setTypeParser(1114, (value) => value);

// Connection is driven entirely by env vars so this can point at a
// local dev Postgres or a production instance without code changes.
// DATABASE_URL takes precedence if set (e.g. for hosted Postgres).
export const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool({
      host: process.env.PGHOST || 'localhost',
      port: Number(process.env.PGPORT) || 5432,
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
      database: process.env.PGDATABASE || 'Confera',
    });

pool.on('error', (err) => {
  console.error('Unexpected Postgres pool error', err);
});
