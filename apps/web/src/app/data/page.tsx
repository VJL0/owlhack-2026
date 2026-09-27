import Link from 'next/link';
import { getReefData } from '@/lib/server/reef-data';
import { InvalidFilter, parseFilters } from '../../../database/filters.mjs';
import { datasetBySlug } from '../../../database/datasets.mjs';
import styles from './page.module.css';

export const runtime = 'nodejs';
export const metadata = { title: 'Reef datasets | Reef Sentinel' };

// Import order follows foreign keys; tabs follow the story.
const TAB_ORDER = ['risk', 'stress', 'history', 'forecast', 'validation'];

const NOTES: Record<string, string> = {
  risk: 'Probability is the supplied model output (0–1), not an observed bleaching percentage. beyond_training_dhw flags extrapolation beyond the training range.',
  stress: 'Each row is a source record. Multiple records for a reef/year are retained. Missing measurements appear as —.',
  history: 'Annual peak degree heating weeks per reef. peak_dhw_source says whether the supplied value is observed or estimated. The supplied history has no rows for 2003.',
  forecast: 'Model forecast of annual peak degree heating weeks, with the 10th–90th percentile range and the probability of passing 4 and 8 °C-weeks. Model output, not observations. beyond_history_dhw flags forecasts beyond the reef’s own history.',
  validation: 'Back-test of the forecast models and simple baselines by years ahead (horizon): mean absolute error in °C-weeks, rank correlation across reefs, and AUC and Brier score for passing 4 and 8 °C-weeks.',
};

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
  const source = datasetBySlug(filters.dataset)!;
  const years = source.years ? Array.from({ length: source.years[1] - source.years[0] + 1 }, (_, i) => source.years![0] + i) : [];
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
        <p>Annual peak heat stress for 1985–2025 and a model forecast for 2027–2031, bleaching risk for 2021–2025 and reef surveys for 2013–2020, served from Tiger Cloud. These global datasets are independent of the Florida demonstration.</p></header>
      <div className={styles.tabs}>
        {TAB_ORDER.map((slug) => datasetBySlug(slug)!).map((d) => <Link key={d.slug} href={`/data?dataset=${d.slug}`} aria-current={d.slug === filters.dataset ? 'page' : undefined}>{d.label}</Link>)}
      </div>
      <form className={styles.filters} action="/data">
        <input type="hidden" name="dataset" value={filters.dataset} />
        {source.years && <label>Year<select name="year" defaultValue={filters.year ?? ''} key={`${filters.dataset}-${filters.year}`}>
          <option value="">All years</option>
          {years.map((y) => <option key={y}>{y}</option>)}
        </select></label>}
        {source.reefs && <label>Reef ID<input name="reef" type="number" min="1" max="2147483647" placeholder="All reefs" defaultValue={filters.reef ?? ''} key={filters.reef} /></label>}
        {(source.years || source.reefs) && <button type="submit">Apply filters</button>}
      </form>
      {message && <p role="alert" className={styles.notice}>{message} <Link href={link(1)}>Retry</Link></p>}
      {result && <>
        <p className={styles.summary}>{result.total.toLocaleString()} records{result.reefs !== null && <> · {result.reefs.toLocaleString()} reefs</>} · Page {filters.page} of {Math.max(1, Math.ceil(result.total / filters.pageSize))}</p>
        <p className={styles.note}>{NOTES[filters.dataset]} Values and labels are displayed as supplied.</p>
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Scrollable reef records">
          <table><caption>{source.label} records</caption><thead><tr>{result.columns.map((col) => <th key={col} scope="col">{col.replaceAll('_', ' ')}</th>)}</tr></thead>
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
