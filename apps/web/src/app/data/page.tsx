import Link from 'next/link';
import { getReefData } from '@/lib/server/reef-data';
import { InvalidFilter, parseFilters } from '../../../database/filters.mjs';
import styles from './page.module.css';

export const runtime = 'nodejs';
export const metadata = { title: 'Reef datasets | Reef Sentinel' };

export default async function DataPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else if (value !== undefined) params.set(key, value);
  }
  let result: Awaited<ReturnType<typeof getReefData>> | null = null;
  let message = '';
  let filters: ReturnType<typeof parseFilters>;
  try { filters = parseFilters(params); }
  catch (error) {
    filters = parseFilters(new URLSearchParams());
    message = error instanceof InvalidFilter ? error.message : 'Invalid filters';
  }
  if (!message) {
    try { result = await getReefData(filters); }
    catch { message = 'The dataset connection is unavailable. Please try again shortly.'; }
  }
  const risk = filters.dataset === 'risk';
  const link = (page: number) => {
    const p = new URLSearchParams({ dataset: filters.dataset, page: String(page) });
    if (filters.year !== null) p.set('year', String(filters.year));
    if (filters.reef !== null) p.set('reef', String(filters.reef));
    return `/data?${p}`;
  };
  return (
    <main className={styles.page}>
      <nav><Link href="/">← Reef Sentinel</Link><span>Reef data archive</span></nav>
      <header><p className={styles.eyebrow}>Explore the source records</p><h1>Reefs, measured over time.</h1>
        <p>Annual bleaching risk for 2021–2025 and historical reef stress for 2013–2020. These global datasets are independent of the Florida demonstration.</p></header>
      <div className={styles.tabs}>
        <Link href="/data?dataset=risk" aria-current={risk ? 'page' : undefined}>Bleaching risk · 2021–2025</Link>
        <Link href="/data?dataset=stress" aria-current={!risk ? 'page' : undefined}>Reef stress · 2013–2020</Link>
      </div>
      <form className={styles.filters} action="/data">
        <input type="hidden" name="dataset" value={filters.dataset} />
        <label>Year<select name="year" defaultValue={filters.year ?? ''} key={`${filters.dataset}-${filters.year}`}>
          <option value="">All years</option>
          {Array.from({ length: risk ? 5 : 8 }, (_, i) => (risk ? 2021 : 2013) + i).map((y) => <option key={y}>{y}</option>)}
        </select></label>
        <label>Reef ID<input name="reef" type="number" min="1" max="2147483647" placeholder="All reefs" defaultValue={filters.reef ?? ''} key={filters.reef} /></label>
        <button type="submit">Apply filters</button>
      </form>
      {message && <p role="alert" className={styles.notice}>{message} <Link href={link(1)}>Retry</Link></p>}
      {result && <>
        <p className={styles.summary}>{result.total.toLocaleString()} records · {result.reefs.toLocaleString()} reefs · Page {filters.page} of {Math.max(1, Math.ceil(result.total / filters.pageSize))}</p>
        <p className={styles.note}>{risk ? 'Probability is the supplied model output (0–1), not an observed bleaching percentage. beyond_training_dhw flags extrapolation beyond the training range.' : 'Each row is a source record. Multiple records for a reef/year are retained. Missing measurements appear as —.'} Values and risk labels are displayed as supplied.</p>
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Scrollable reef records">
          <table><caption>{risk ? 'Bleaching risk records' : 'Historical reef stress records'}</caption><thead><tr>{result.columns.map((col) => <th key={col} scope="col">{col.replaceAll('_', ' ')}</th>)}</tr></thead>
            <tbody>{result.rows.map((row) => <tr key={String(row.source_row)}>{result.columns.map((col) => <td key={col}>{row[col] === null ? '—' : String(row[col])}</td>)}</tr>)}</tbody>
          </table>
          {!result.rows.length && <p>No records match these filters.</p>}
        </div>
        <nav aria-label="Pagination">{filters.page > 1 ? <Link href={link(filters.page - 1)}>← Previous</Link> : <span />}{filters.page * filters.pageSize < result.total && <Link href={link(filters.page + 1)}>Next →</Link>}</nav>
        <footer><strong>Source: {result.source.file_name}</strong><br />{result.source.row_count.toLocaleString()} imported records · Served from TigerData<br /><span>SHA-256: {result.source.sha256}</span></footer>
      </>}
    </main>
  );
}
