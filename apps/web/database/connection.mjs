import { readFileSync } from 'node:fs';

/** Shared by server runtime and operational scripts. Never import in client code. */
export function connectionConfig(connectionString, env = process.env) {
  if (!connectionString) throw new Error('Tiger database URL is not configured');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Expected a PostgreSQL URL');
  // node-postgres URL SSL parameters override the ssl object. Use one explicit policy.
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith('ssl')) url.searchParams.delete(key);
  }
  const max = Number(env.TIGER_POOL_MAX ?? 5);
  if (!Number.isInteger(max) || max < 1 || max > 20) throw new Error('TIGER_POOL_MAX must be 1–20');
  return {
    connectionString: url.toString(),
    ssl: {
      rejectUnauthorized: true,
      ...(env.TIGER_CA_CERT_PATH ? { ca: readFileSync(env.TIGER_CA_CERT_PATH, 'utf8') } : {}),
    },
    max,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
    query_timeout: 15_000,
    application_name: 'reef-atlas',
  };
}
