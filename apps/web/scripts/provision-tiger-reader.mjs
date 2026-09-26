import { writeFile, access } from 'node:fs/promises';
import { randomBytes, pbkdf2Sync, createHmac, createHash } from 'node:crypto';
import pg from 'pg';
import { connectionConfig } from '../database/connection.mjs';

// Create once. Refuse to overwrite an existing role or runtime credentials.
// SCRAM verifier keeps the plaintext password out of PostgreSQL statement logs.
const output = process.env.TIGER_READER_ENV_FILE ?? new URL('../.env.tiger-reader', import.meta.url);
try { await access(output); throw new Error('Reader credentials already exist'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const password = randomBytes(32).toString('base64url');
const salt = randomBytes(16);
const salted = pbkdf2Sync(password, salt, 4096, 32, 'sha256');
const clientKey = createHmac('sha256', salted).update('Client Key').digest();
const stored = createHash('sha256').update(clientKey).digest('base64');
const server = createHmac('sha256', salted).update('Server Key').digest('base64');
const verifier = `SCRAM-SHA-256$4096:${salt.toString('base64')}$${stored}:${server}`;
const client = new pg.Client(connectionConfig(process.env.TIGER_ADMIN_URL));
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '5s'");
  // Grants come only from the reef_data_read group role created by the migration.
  await client.query(`CREATE ROLE reef_atlas_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20 IN ROLE reef_data_read PASSWORD ${pg.escapeLiteral(verifier)}`);
  // Tiger Cloud's immutable read-only mode (what `tiger db create role --read-only` sets);
  // unlike default_transaction_read_only, a session cannot switch it off.
  await client.query('ALTER ROLE reef_atlas_reader SET tsdb_admin.read_only_role = true');
  await client.query("ALTER ROLE reef_atlas_reader SET statement_timeout = '10s'");
  await client.query("ALTER ROLE reef_atlas_reader SET idle_in_transaction_session_timeout = '15s'");
  const url = new URL(process.env.TIGER_ADMIN_URL);
  url.username = 'reef_atlas_reader'; url.password = password; url.search = '';
  const lines = [`TIGER_DATABASE_URL=${url}`, 'TIGER_POOL_MAX=5'];
  if (process.env.TIGER_CA_CERT_PATH) lines.push(`TIGER_CA_CERT_PATH=${JSON.stringify(process.env.TIGER_CA_CERT_PATH)}`);
  await writeFile(output, `${lines.join('\n')}\n`, { mode: 0o600, flag: 'wx' });
  await client.query('COMMIT');
  console.log(`Reader created; credentials saved to ${output instanceof URL ? '.env.tiger-reader' : output} (mode 0600). Merge into .env.local or the deployment secret file.`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`Reader provisioning failed (${error.code ?? error.name}). Check role/file state before retrying.`);
  process.exitCode = 1;
} finally { await client.end(); }
