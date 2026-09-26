export class InvalidFilter extends Error {}
export function parseFilters(params) {
  const allowed = new Set(['dataset', 'year', 'reef', 'page']);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) throw new InvalidFilter('Unknown or repeated filter');
  }
  const dataset = params.get('dataset') ?? 'risk';
  if (dataset !== 'risk' && dataset !== 'stress') throw new InvalidFilter('Dataset must be risk or stress');
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
    year: integer('year', dataset === 'risk' ? 2021 : 2013, dataset === 'risk' ? 2025 : 2020),
    reef: integer('reef', 1, 2147483647),
    page: integer('page', 1, 1000) ?? 1,
    pageSize: 50,
  };
}
