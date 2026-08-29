import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { pool } from '../src/data/db.js';

// Runs reset_seed_data.sql — DESTRUCTIVE (deletes this app's demo
// rows: the seeded Organization, Event, sponsors, attendee, and both
// nav trees, matched by email address / event code). Requires typed
// confirmation since it's a DELETE against a real database, not
// something that should run silently as part of routine setup.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer);
  }));
}

async function main() {
  const dbName = process.env.PGDATABASE || 'Confera';
  console.log(`This will DELETE Confera Admin/Portal's seeded demo data from "${dbName}".`);
  console.log('Only rows for the seeded demo event (matched by slug/event code) and');
  console.log('known seed emails are removed — nothing else in your schema is touched.');
  console.log('');

  const answer = await ask(`Type the database name ("${dbName}") to confirm: `);
  if (answer.trim() !== dbName) {
    console.log('Confirmation did not match. Aborted, nothing was deleted.');
    process.exitCode = 1;
    await pool.end();
    return;
  }

  const sqlPath = path.join(__dirname, '..', 'src', 'data', 'reset_seed_data.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Deleting...');
  await pool.query(sql);
  console.log('Done. Run `npm run dev` to reseed on next boot.');

  await pool.end();
}

main().catch(async (err) => {
  console.error('Reset failed:', err.message);
  process.exitCode = 1;
  await pool.end();
});
