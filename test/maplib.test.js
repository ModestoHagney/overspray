import test from 'node:test';
import assert from 'node:assert/strict';
import { parseZone } from '../next/maplib.js';

const zone = (zones, extra = {}) => JSON.stringify({ format: 'overspray-zone', car: 'supercars-mustang', league: 'test', zones, ...extra });
const box = [[10, 10], [110, 10], [110, 60], [10, 60]];

test('an exclusion zone file reads into its outlines', () => {
  const z = parseZone(zone([box, box.map(([x, y]) => [x + 500, y])]));
  assert.equal(z.car, 'supercars-mustang');
  assert.equal(z.league, 'test');
  assert.equal(z.zones.length, 2);
  assert.deepEqual(z.zones[1][0], [510, 10]);
});

test('anything else is turned away', () => {
  assert.throws(() => parseZone('{"format":"overspray-map","zones":[]}'), /not an exclusion zone/);
  assert.throws(() => parseZone(zone([[[0, 0], [1, 1]]])), /closed outline/);
  assert.throws(() => parseZone(zone([[[0, 0], [1, 'x'], [2, 2]]])), /closed outline/);
  assert.throws(() => parseZone(zone([[[0, 0], [1e9, 0], [2, 2]]])), /closed outline/);
  assert.throws(() => parseZone(zone(Array(501).fill(box))), /too many zones/);
  assert.throws(() => parseZone('not json'));
});
