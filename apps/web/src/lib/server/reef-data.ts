import 'server-only';
import { tigerPool } from './tiger';
import { datasets } from '../../../database/datasets.mjs';
import { parseFilters } from '../../../database/filters.mjs';

export async function getReefData(filters: ReturnType<typeof parseFilters>) {
  const source = datasets[filters.dataset === 'risk' ? 0 : 1];
  const values: number[] = [];
  const predicates: string[] = [];
  if (filters.year !== null) { values.push(filters.year); predicates.push(`year = $${values.length}`); }
  if (filters.reef !== null) { values.push(filters.reef); predicates.push(`reef_id = $${values.length}`); }
  const where = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
  const table = `reef_data.${source.view}`; // Only fixed dataset names can reach SQL.
  // DATE as ISO text: node-postgres would otherwise build a local-midnight Date.
  const columns = source.columns.split(',').map((column) => column === 'window_start' || column === 'window_end' ? `${column}::text AS ${column}` : column).join(',');
  const pool = tigerPool();
  const [records, counts, manifest] = await Promise.all([
    pool.query(`SELECT source_row, ${columns} FROM ${table} ${where} ORDER BY year, reef_id, source_row LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, filters.pageSize, (filters.page - 1) * filters.pageSize]),
    pool.query(`SELECT count(*)::integer AS total, count(DISTINCT reef_id)::integer AS reefs FROM ${table} ${where}`, values),
    pool.query('SELECT file_name, sha256, row_count, imported_at FROM reef_data.imports WHERE file_name = $1', [source.file]),
  ]);
  if (!manifest.rowCount) throw new Error('Dataset import not complete');
  return {
    ...filters,
    ...counts.rows[0] as { total: number; reefs: number },
    columns: source.columns.split(','),
    rows: records.rows as Record<string, string | number | boolean | null>[],
    source: manifest.rows[0] as { file_name: string; sha256: string; row_count: number; imported_at: Date },
  };
}
