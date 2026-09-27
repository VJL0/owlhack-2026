import { datasetBySlug } from './datasets.mjs';

export class InvalidFilter extends Error {}
const PAGE_SIZE = 50;

export function parseFilters(params) {
  const allowed = new Set(['dataset', 'year', 'reef', 'page']);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) throw new InvalidFilter('Unknown or repeated filter');
  }
  const dataset = params.get('dataset') ?? 'risk';
  const source = datasetBySlug(dataset);
  if (!source) throw new InvalidFilter('Unknown dataset');
  const integer = (key, min, max) => {
    const raw = params.get(key);
    if (raw === null || raw === '') return null;
    if (!/^\d+$/.test(raw)) throw new InvalidFilter(`Invalid ${key}`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new InvalidFilter(`Invalid ${key}`);
    return value;
  };
  return {
    dataset,
    // Datasets without a year or reef column accept no such filter.
    year: source.years ? integer('year', ...source.years) : integer('year', 1, 0),
    reef: source.reefs ? integer('reef', 1, 2147483647) : integer('reef', 1, 0),
    page: integer('page', 1, Math.ceil(source.rows / PAGE_SIZE)) ?? 1,
    pageSize: PAGE_SIZE,
  };
}
