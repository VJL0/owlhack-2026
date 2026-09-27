import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { documents, floridaDatasets, loadDocument, loadFlorida, readDocumentText, readFloridaDataset } from '../database/atlas.mjs';
import { connectionConfig } from '../database/connection.mjs';
import { sha256 } from '../database/csv-export.mjs';

// Loads the Reef Atlas app data (the Florida bundle and the flagship documents)
// into Tiger and proves it: inside the same transaction every dataset is read back
// through database/atlas.mjs, the exact code the app serves it with, and must be
// byte-identical to the JSON it was loaded from. SHA-256 values go to
// reef_data.atlas_imports, so later verification needs only the database.
//
//   --from <dir>    build output to load (default: data/build/atlas at the repo root)
//   --dry-run       load and verify, then roll back
//   --verify-only   read-only: read every dataset back and compare with atlas_imports
//   --export <dir>  with --verify-only: also write what Tiger holds to <dir>, laid out
//                   like the build output (never overwrites a file)

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const verifyOnly = args.includes('--verify-only');
const dryRun = args.includes('--dry-run');
const exportDir = args.includes('--export') ? args[args.indexOf('--export') + 1] : null;
if (args.includes('--export') && (!exportDir || !verifyOnly)) throw new Error('--export <dir> needs --verify-only');
const from = path.resolve(args.includes('--from') ? args[args.indexOf('--from') + 1] : path.join(here, '../../../data/build/atlas'));

const client = new pg.Client({ ...connectionConfig(process.env.TIGER_ADMIN_URL), statement_timeout: 120_000, query_timeout: 130_000, application_name: 'reef-atlas-import' });
// The read functions issue queries in parallel for the app's pool; one client runs them in turn.
let queue = Promise.resolve();
const q = (text, params) => {
  const result = queue.then(() => client.query(text, params));
  queue = result.catch(() => {});
  return result.then((r) => r.rows);
};
const expected = [...floridaDatasets.map((name) => `florida/${name}`), ...Object.keys(documents)];

async function readBack(dataset) {
  if (dataset.startsWith('florida/')) return JSON.stringify(await readFloridaDataset(q, dataset.slice('florida/'.length)));
  const text = await readDocumentText(q, dataset);
  if (text === null) throw new Error(`Document is not loaded: ${dataset}`);
  return text;
}

try {
  await client.connect();
  if (verifyOnly) {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const manifest = new Map((await q('SELECT dataset, sha256 FROM reef_data.atlas_imports')).map((r) => [r.dataset, r.sha256]));
    for (const dataset of expected) {
      if (!manifest.has(dataset)) throw new Error(`Dataset is not loaded: ${dataset}`);
      const text = await readBack(dataset);
      const hash = sha256(text);
      if (hash !== manifest.get(dataset)) throw new Error(`Read-back differs from the load: ${dataset}`);
      if (exportDir) {
        const file = path.resolve(exportDir, dataset.startsWith('florida/') ? `${dataset.slice('florida/'.length)}.json` : documents[dataset]);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, text, { flag: 'wx' });
      }
      console.log(`${dataset.padEnd(22)} ${hash}`);
    }
    await client.query('COMMIT');
    console.log('Atlas data verified.');
  } else {
    // Parse every input before touching the database.
    const florida = {};
    const texts = {};
    for (const name of floridaDatasets) {
      const text = await readFile(path.join(from, `${name}.json`), 'utf8');
      florida[name] = JSON.parse(text);
      texts[`florida/${name}`] = text;
    }
    for (const [docId, file] of Object.entries(documents)) texts[docId] = await readFile(path.join(from, file), 'utf8');

    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query('SELECT pg_advisory_xact_lock(49612, 2)');
    const migrated = await q('SELECT 1 FROM reef_data.schema_migrations WHERE version = 3');
    if (!migrated.length) throw new Error('Migration 003 is not applied; run pnpm db:import first');
    await loadFlorida(client, florida);
    for (const docId of Object.keys(documents)) await loadDocument(client, docId, texts[docId]);
    // Florida is compared as compact JSON; documents keep their exact text.
    const want = Object.fromEntries(expected.map((d) => [d, d.startsWith('florida/') ? JSON.stringify(florida[d.slice('florida/'.length)]) : texts[d]]));
    // Record the manifest first: the Florida meta read-back takes its date from it.
    for (const dataset of expected) {
      await client.query(
        `INSERT INTO reef_data.atlas_imports (dataset, sha256, built_on) VALUES ($1, $2, $3)
         ON CONFLICT (dataset) DO UPDATE SET sha256 = EXCLUDED.sha256, built_on = EXCLUDED.built_on, imported_at = now()`,
        [dataset, sha256(want[dataset]), dataset.startsWith('florida/') ? florida.meta.generated : null],
      );
    }
    for (const dataset of expected) {
      const got = await readBack(dataset);
      if (got !== want[dataset]) throw new Error(`Read-back differs from the input: ${dataset}`);
      console.log(`${dataset.padEnd(22)} ${sha256(got)}${got === texts[dataset] ? ' (identical to the input file)' : ' (same content; input file had other formatting)'}`);
    }
    for (const table of ['florida_sites', 'florida_thermal', 'storms', 'storm_fixes', 'storm_site_passes', 'lionfish_records', 'lionfish_site_distances', 'florida_simulated_activity', 'florida_sources', 'atlas_documents']) {
      await client.query(`ANALYZE reef_data.${table}`);
    }
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    console.log(dryRun ? 'Dry run passed. Rolled back; nothing was written.' : `Atlas data loaded from ${path.relative(process.cwd(), from) || '.'} and verified.`);
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  // PostgreSQL error fields name schema objects only, never row values or credentials.
  const where = [error.table, error.column, error.constraint].filter(Boolean).join('/');
  console.error(`Atlas import failed (${error.code ?? error.name}${where ? ` at ${where}` : ''}). Transaction rolled back.`);
  if (!error.code) console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
