import { createHash } from 'node:crypto';

// Rebuilds a supplied CSV byte for byte from its source-shaped view, so the
// database alone proves (and can restore) the original file after it is gone.
// The supplied files were written by pandas: CRLF line ends, minimal quoting,
// Python repr floats (shortest round-trip digits, always a decimal point or an
// exponent), True/False booleans, and empty fields for missing values.

const FLOAT8 = 701;
const BOOL = 16;

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Python's repr(float): fixed notation for exponents -4..15, else d.ddde±XX. */
export function pythonFloat(x) {
  if (!Number.isFinite(x)) throw new Error('Non-finite float cannot be written as CSV');
  if (Object.is(x, -0)) return '-0.0';
  if (x === 0) return '0.0';
  const [mantissa, exponent] = x.toExponential().split('e');
  const e = Number(exponent);
  if (e < -4 || e >= 16) return `${mantissa}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
  const fixed = String(x);
  return fixed.includes('.') ? fixed : `${fixed}.0`;
}

const field = (value, type) => {
  if (value === null) return '';
  if (type === FLOAT8) return pythonFloat(value);
  if (type === BOOL) return value ? 'True' : 'False';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** The dataset's CSV exactly as supplied, read back from `reef_data.<view>` in source order. */
export async function exportCsv(client, dataset) {
  const columns = dataset.columns.split(',');
  // DATE as ISO text: node-postgres would otherwise build a local-midnight Date.
  const select = columns.map((column) => (column === 'window_start' || column === 'window_end' ? `${column}::text AS ${column}` : column)).join(',');
  const result = await client.query({ text: `SELECT ${select} FROM reef_data.${dataset.view} ORDER BY source_row`, rowMode: 'array' });
  const types = result.fields.map((f) => f.dataTypeID);
  const lines = [dataset.columns];
  for (const row of result.rows) lines.push(row.map((value, i) => field(value, types[i])).join(','));
  return { bytes: Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8'), rows: result.rows.length };
}
