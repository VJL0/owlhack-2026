import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { connectionConfig } from '../database/connection.mjs';
import { exportCsv, sha256 } from '../database/csv-export.mjs';
import { datasets, migrations } from '../database/datasets.mjs';

// Imports the supplied CSVs into Tiger Cloud once, then proves the database still
// holds them: every run rebuilds each CSV from its view and compares the SHA-256
// with the pinned hash of the reviewed file. After a file is deleted from the
// repository, verification needs only the database.
//
//   --validate-only   check the local CSV files against the pinned hashes (no database)
//   --verify-only     read-only: rebuild every CSV from Tiger and compare hashes
//   --export <dir>    also write the rebuilt CSVs to <dir>
//   --dry-run         run the whole import and verification, then roll back

const args = process.argv.slice(2);
const validateOnly = args.includes('--validate-only');
const verifyOnly = args.includes('--verify-only');
const dryRun = args.includes('--dry-run');
const exportDir = args.includes('--export') ? args[args.indexOf('--export') + 1] : null;
if (args.includes('--export') && !exportDir) throw new Error('--export needs a directory');

const root = new URL('../../../', import.meta.url);
const exists = (url) => access(url).then(() => true, () => false);
// Read immutable bytes once: validate and COPY the same bytes, never rewrite CSVs.
const sources = await Promise.all(datasets.map(async (dataset) => {
  const url = new URL(dataset.file, root);
  if (!(await exists(url))) return { ...dataset, bytes: null };
  const bytes = await readFile(url);
  if (sha256(bytes) !== dataset.sha256) throw new Error(`Source hash mismatch: ${dataset.file}`);
  return { ...dataset, bytes };
}));
if (validateOnly) {
  for (const s of sources) console.log(`${s.file}: ${s.bytes ? 'matches the pinned SHA-256' : 'not present (lives in Tiger; use --export to restore)'}`);
  process.exit(0);
}

const client = new pg.Client({ ...connectionConfig(process.env.TIGER_ADMIN_URL), statement_timeout: 120_000, query_timeout: 130_000, application_name: 'reef-atlas-import' });
try {
  await client.connect();
  if (verifyOnly) {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  } else {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query('SELECT pg_advisory_xact_lock(49612, 1)');
    await client.query('CREATE SCHEMA IF NOT EXISTS reef_data');
    await client.query('REVOKE ALL ON SCHEMA reef_data FROM PUBLIC');
    await client.query('CREATE TABLE IF NOT EXISTS reef_data.schema_migrations (version integer PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  }
  for (const migration of migrations) {
    const sql = await readFile(new URL(`../database/${migration.file}`, import.meta.url), 'utf8');
    const applied = await client.query('SELECT sha256 FROM reef_data.schema_migrations WHERE version = $1', [migration.version]);
    if (applied.rowCount && applied.rows[0].sha256 !== sha256(sql)) throw new Error(`Applied migration ${migration.file} changed; add a new migration instead`);
    if (applied.rowCount) continue;
    if (verifyOnly) throw new Error(`Migration ${migration.file} is not applied`);
    await client.query(sql);
    await client.query('INSERT INTO reef_data.schema_migrations(version,sha256) VALUES ($1,$2)', [migration.version, sha256(sql)]);
    console.log(`Applied ${migration.file}`);
  }
  for (const source of sources) {
    // Fixed allowlist names, never user input.
    const table = `reef_data.${source.table}`;
    const view = `reef_data.${source.view}`;
    const existing = await client.query('SELECT sha256, row_count FROM reef_data.imports WHERE file_name=$1', [source.file]);
    if (existing.rowCount && (existing.rows[0].sha256 !== source.sha256 || existing.rows[0].row_count !== source.rows)) throw new Error(`Import manifest mismatch: ${source.file}`);
    if (!existing.rowCount) {
      if (verifyOnly) throw new Error(`Dataset is not imported: ${source.file}`);
      if (!source.bytes) throw new Error(`Dataset is not imported and ${source.file} is missing`);
      const stage = `stage_${source.table}`;
      const coordinates = source.columns.startsWith('reef_id,latitude,longitude,');
      const facts = source.columns.split(',').filter((column) => column !== 'latitude' && column !== 'longitude').join(',');
      // Staging mirrors the view (the CSV shape); source_row numbers records in file order.
      await client.query(`CREATE TEMP TABLE ${stage} ON COMMIT DROP AS SELECT * FROM ${view} WITH NO DATA`);
      await client.query(`ALTER TABLE ${stage} ALTER COLUMN source_row SET NOT NULL`);
      await client.query(`ALTER TABLE ${stage} ALTER COLUMN source_row ADD GENERATED ALWAYS AS IDENTITY`);
      await pipeline(Readable.from([source.bytes]), client.query(copyFrom(`COPY ${stage} (${source.columns}) FROM STDIN WITH (FORMAT CSV, HEADER MATCH)`)));
      const staged = await client.query(`SELECT count(*)::integer AS n FROM ${stage}`);
      if (staged.rows[0].n !== source.rows) throw new Error(`Row count mismatch: ${source.file}`);
      const count = await client.query(`SELECT count(*)::integer AS n FROM ${table}`);
      if (count.rows[0].n !== 0) throw new Error(`Refusing to overwrite an unmanaged table: ${source.table}`);
      if (coordinates) {
        await client.query(`INSERT INTO reef_data.reefs (reef_id, latitude, longitude) SELECT DISTINCT reef_id, latitude, longitude FROM ${stage} ON CONFLICT (reef_id) DO NOTHING`);
        // One location per reef across all files; a conflict would be silently hidden by the join.
        const conflicts = await client.query(`SELECT EXISTS (SELECT FROM ${stage} s JOIN reef_data.reefs r USING (reef_id) WHERE (s.latitude, s.longitude) IS DISTINCT FROM (r.latitude, r.longitude)) AS conflict`);
        if (conflicts.rows[0].conflict) throw new Error(`Reef coordinates differ between files: ${source.file}`);
      }
      await client.query(`INSERT INTO ${table} (source_row,${facts}) SELECT source_row,${facts} FROM ${stage}`);
      await client.query('INSERT INTO reef_data.imports(file_name,sha256,row_count) VALUES ($1,$2,$3)', [source.file, source.sha256, source.rows]);
      // Bidirectional multiset comparison catches changed values, missing rows AND duplicates.
      const diff = await client.query(`SELECT EXISTS ((SELECT * FROM ${view} EXCEPT ALL SELECT * FROM ${stage}) UNION ALL (SELECT * FROM ${stage} EXCEPT ALL SELECT * FROM ${view})) AS differs`);
      if (diff.rows[0].differs) throw new Error(`Database contents differ from CSV: ${source.file}`);
      await client.query(`ANALYZE ${table}`);
      await client.query('ANALYZE reef_data.reefs');
    }
    // The strongest check: the database reproduces the reviewed file byte for byte.
    const rebuilt = await exportCsv(client, source);
    if (rebuilt.rows !== source.rows || sha256(rebuilt.bytes) !== source.sha256) throw new Error(`Rebuilt CSV differs from the reviewed file: ${source.file}`);
    if (exportDir) {
      await mkdir(exportDir, { recursive: true });
      await writeFile(path.resolve(exportDir, source.file), rebuilt.bytes, { flag: 'wx' });
    }
    console.log(`${source.file}: ${source.rows} rows; rebuilt from Tiger with SHA-256 ${source.sha256}${existing.rowCount ? '' : ' (imported now)'}`);
  }
  await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
  console.log(verifyOnly ? 'Database contents verified.' : dryRun ? 'Dry run passed. Rolled back; nothing was written.' : 'Import committed. Reruns verify without duplicating data.');
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
