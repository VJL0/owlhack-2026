import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { connectionConfig } from '../database/connection.mjs';
import { datasets } from '../database/datasets.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
// Read immutable bytes once: validate and COPY the same bytes, never rewrite CSVs.
const sources = await Promise.all(datasets.map(async (dataset) => {
  const bytes = await readFile(new URL(`../../../${dataset.file}`, import.meta.url));
  if (hash(bytes) !== dataset.sha256) throw new Error(`Source hash mismatch: ${dataset.file}`);
  return { ...dataset, bytes };
}));
if (process.argv.includes('--validate-only')) {
  console.log('Both CSV hashes match the reviewed source files. No database writes.');
  process.exit(0);
}
const verifyOnly = process.argv.includes('--verify-only');
const client = new pg.Client({ ...connectionConfig(process.env.TIGER_ADMIN_URL), statement_timeout: 120_000, query_timeout: 130_000, application_name: 'reef-atlas-import' });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query('SELECT pg_advisory_xact_lock(49612, 1)');
  const sql = await readFile(new URL('../database/001_reef_data.sql', import.meta.url), 'utf8');
  if (!verifyOnly) {
    await client.query('CREATE SCHEMA IF NOT EXISTS reef_data');
    await client.query('REVOKE ALL ON SCHEMA reef_data FROM PUBLIC');
    await client.query('CREATE TABLE IF NOT EXISTS reef_data.schema_migrations (version integer PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied = await client.query('SELECT sha256 FROM reef_data.schema_migrations WHERE version = 1');
    if (applied.rowCount && applied.rows[0].sha256 !== hash(sql)) throw new Error('Applied migration checksum differs; use a new migration');
    if (!applied.rowCount) {
      await client.query(sql);
      await client.query('INSERT INTO reef_data.schema_migrations(version,sha256) VALUES (1,$1)', [hash(sql)]);
    }
  }
  for (const source of sources) {
    // Fixed allowlist names, never user input.
    const table = `reef_data.${source.table}`;
    const view = `reef_data.${source.view}`;
    const stage = `stage_${source.table}`;
    const facts = source.columns.split(',').filter((column) => column !== 'latitude' && column !== 'longitude').join(',');
    // Staging mirrors the view (the CSV shape); source_row numbers records in file order.
    await client.query(`CREATE TEMP TABLE ${stage} ON COMMIT DROP AS SELECT * FROM ${view} WITH NO DATA`);
    await client.query(`ALTER TABLE ${stage} ALTER COLUMN source_row SET NOT NULL`);
    await client.query(`ALTER TABLE ${stage} ALTER COLUMN source_row ADD GENERATED ALWAYS AS IDENTITY`);
    await pipeline(Readable.from([source.bytes]), client.query(copyFrom(`COPY ${stage} (${source.columns}) FROM STDIN WITH (FORMAT CSV, HEADER MATCH)`)));
    const staged = await client.query(`SELECT count(*)::integer AS n FROM ${stage}`);
    if (staged.rows[0].n !== source.rows) throw new Error(`Row count mismatch: ${source.file}`);
    const existing = await client.query('SELECT sha256, row_count FROM reef_data.imports WHERE file_name=$1', [source.file]);
    if (!existing.rowCount) {
      if (verifyOnly) throw new Error(`Dataset is not imported: ${source.file}`);
      const count = await client.query(`SELECT count(*)::integer AS n FROM ${table}`);
      if (count.rows[0].n !== 0) throw new Error(`Refusing to overwrite an unmanaged table: ${source.table}`);
      await client.query(`INSERT INTO reef_data.reefs (reef_id, latitude, longitude) SELECT DISTINCT reef_id, latitude, longitude FROM ${stage} ON CONFLICT (reef_id) DO NOTHING`);
      await client.query(`INSERT INTO ${table} (source_row,${facts}) SELECT source_row,${facts} FROM ${stage}`);
      await client.query('INSERT INTO reef_data.imports(file_name,sha256,row_count) VALUES ($1,$2,$3)', [source.file, source.sha256, source.rows]);
    } else if (existing.rows[0].sha256 !== source.sha256 || existing.rows[0].row_count !== source.rows) {
      throw new Error(`Import manifest mismatch: ${source.file}`);
    }
    // One location per reef across both files; a conflict would be silently hidden by the join.
    const conflicts = await client.query(`SELECT EXISTS (SELECT FROM ${stage} s JOIN reef_data.reefs r USING (reef_id) WHERE (s.latitude, s.longitude) IS DISTINCT FROM (r.latitude, r.longitude)) AS conflict`);
    if (conflicts.rows[0].conflict) throw new Error(`Reef coordinates differ between files: ${source.file}`);
    // Bidirectional multiset comparison catches changed values, missing rows AND duplicates.
    const diff = await client.query(`SELECT EXISTS ((SELECT * FROM ${view} EXCEPT ALL SELECT * FROM ${stage}) UNION ALL (SELECT * FROM ${stage} EXCEPT ALL SELECT * FROM ${view})) AS differs`);
    if (diff.rows[0].differs) throw new Error(`Database contents differ from CSV: ${source.file}`);
    if (!verifyOnly) await client.query(`ANALYZE ${table}`);
    console.log(`${source.file}: ${source.rows} rows verified, SHA-256 ${source.sha256}`);
  }
  if (!verifyOnly) await client.query('ANALYZE reef_data.reefs');
  await client.query('COMMIT');
  console.log(verifyOnly ? 'Database contents verified.' : 'Import committed. Reruns verify without duplicating data.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  // Avoid emitting URLs, credentials, SQL or source values in operational logs.
  // PostgreSQL error fields below name schema objects only, never row values.
  const where = [error.table, error.column, error.constraint].filter(Boolean).join('/');
  console.error(`Import failed (${error.code ?? error.name}${where ? ` at ${where}` : ''}). Transaction rolled back.`);
  if (!error.code) console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
