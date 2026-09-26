import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionConfig } from './connection.mjs';
import { InvalidFilter, parseFilters } from './filters.mjs';

test('URL cannot weaken explicit TLS verification', () => {
  const config = connectionConfig('postgres://u:p@example.com/db?sslmode=disable&sslrootcert=bad', {});
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(new URL(config.connectionString).search, '');
  assert.equal(config.max, 5);
  assert.ok(config.connectionTimeoutMillis > 0);
});
test('bad configuration fails closed', () => {
  assert.throws(() => connectionConfig(undefined, {}));
  assert.throws(() => connectionConfig('https://example.com', {}));
  for (const value of ['0', '21', '1.2', 'NaN']) assert.throws(() => connectionConfig('postgres://u:p@example.com/db', { TIGER_POOL_MAX: value }));
});
test('filters reject SQL injection, out-of-range values, duplicate and unknown keys', () => {
  for (const query of ['dataset=other', 'reef=1;DROP TABLE x', 'year=2020', 'dataset=stress&year=2025', 'page=0', 'page=1001', 'reef=1&reef=2', 'sort=password', 'reef=1.5', 'reef=2147483648']) {
    assert.throws(() => parseFilters(new URLSearchParams(query)), InvalidFilter, query);
  }
});
test('historical and risk filters keep distinct year ranges', () => {
  assert.deepEqual(parseFilters(new URLSearchParams('dataset=stress&year=2013&reef=4&page=2')), { dataset: 'stress', year: 2013, reef: 4, page: 2, pageSize: 50 });
  assert.equal(parseFilters(new URLSearchParams()).year, null);
});
