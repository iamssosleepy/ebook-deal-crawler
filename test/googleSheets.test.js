import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRowsMatch } from '../src/integrations/googleSheets.js';

test('accepts Google date serials as equivalent to ISO date strings', () => {
  const expected = [[
    'Kobo', '', '', '', '', '', '', 99, '', '',
    '2026-08-27', '2026-08-28'
  ]];
  const actual = [[
    'Kobo', '', '', '', '', '', '', 99, '', '',
    46261, 46262
  ]];

  assert.doesNotThrow(() => assertRowsMatch(expected, actual));
});

test('still rejects a genuinely different date', () => {
  const expected = [['', '', '', '', '', '', '', '', '', '', '2026-08-27']];
  const actual = [['', '', '', '', '', '', '', '', '', '', 46262]];

  assert.throws(() => assertRowsMatch(expected, actual), /row 1, column 11/);
});
