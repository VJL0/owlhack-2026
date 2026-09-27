import test from 'node:test';
import assert from 'node:assert/strict';
import { pythonFloat } from './csv-export.mjs';

test('floats are written the way Python repr (and so pandas) wrote the supplied CSVs', () => {
  const cases = [[5, '5.0'], [0, '0.0'], [-0, '-0.0'], [2.8000000000000003, '2.8000000000000003'], [0.2777763726622009, '0.2777763726622009'],
    [-19.1483, '-19.1483'], [146.8703, '146.8703'], [0.0001, '0.0001'], [0.00005, '5e-05'], [1.5e-7, '1.5e-07'], [1e16, '1e+16'], [123456789012345.6, '123456789012345.6']];
  for (const [value, text] of cases) assert.equal(pythonFloat(value), text, String(value));
  assert.throws(() => pythonFloat(Number.NaN));
});
