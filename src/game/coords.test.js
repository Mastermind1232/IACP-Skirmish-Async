/**
 * Tests for src/game/coords.js. Run: node --test src/game/coords.test.js
 */
import test from 'node:test';
import assert from 'node:assert';
import {
  normalizeCoord,
  parseCoord,
  colRowToCoord,
  edgeKey,
  toLowerSet,
  parseSizeString,
  sizeToString,
  rotateSizeString,
  shiftCoord,
  getFootprintCells,
} from './coords.js';

test('normalizeCoord', () => {
  assert.strictEqual(normalizeCoord('A1'), 'a1');
  assert.strictEqual(normalizeCoord('B2'), 'b2');
  assert.strictEqual(normalizeCoord(null), '');
  assert.strictEqual(normalizeCoord(''), '');
});

test('parseCoord', () => {
  assert.deepStrictEqual(parseCoord('a1'), { col: 0, row: 0 });
  assert.deepStrictEqual(parseCoord('A1'), { col: 0, row: 0 });
  assert.deepStrictEqual(parseCoord('b2'), { col: 1, row: 1 });
  assert.deepStrictEqual(parseCoord('z1'), { col: 25, row: 0 });
  assert.deepStrictEqual(parseCoord('aa1'), { col: 26, row: 0 });
  assert.deepStrictEqual(parseCoord(''), { col: -1, row: -1 });
  assert.deepStrictEqual(parseCoord('x99'), { col: 23, row: 98 });
});

test('colRowToCoord', () => {
  assert.strictEqual(colRowToCoord(0, 0), 'a1');
  assert.strictEqual(colRowToCoord(1, 1), 'b2');
  assert.strictEqual(colRowToCoord(25, 0), 'z1');
  assert.strictEqual(colRowToCoord(26, 0), 'aa1');
  assert.strictEqual(colRowToCoord(-1, 0), '');
  assert.strictEqual(colRowToCoord(0, -1), '');
});

test('edgeKey', () => {
  assert.strictEqual(edgeKey('a1', 'b1'), 'a1|b1');
  assert.strictEqual(edgeKey('b1', 'a1'), 'a1|b1');
  assert.strictEqual(edgeKey('A1', 'B1'), 'a1|b1');
});

test('toLowerSet', () => {
  const s = toLowerSet(['A1', 'b2', 'C3']);
  assert.ok(s.has('a1'));
  assert.ok(s.has('b2'));
  assert.ok(s.has('c3'));
  assert.strictEqual(s.size, 3);
  assert.deepStrictEqual(toLowerSet([]), new Set());
  assert.deepStrictEqual(toLowerSet(null), new Set());
});

test('parseSizeString', () => {
  assert.deepStrictEqual(parseSizeString('1x1'), { cols: 1, rows: 1 });
  assert.deepStrictEqual(parseSizeString('2x2'), { cols: 2, rows: 2 });
  assert.deepStrictEqual(parseSizeString('1x2'), { cols: 1, rows: 2 });
  assert.deepStrictEqual(parseSizeString('2x3'), { cols: 2, rows: 3 });
  assert.deepStrictEqual(parseSizeString(''), { cols: 1, rows: 1 });
  assert.deepStrictEqual(parseSizeString(null), { cols: 1, rows: 1 });
});

test('sizeToString', () => {
  assert.strictEqual(sizeToString(1, 1), '1x1');
  assert.strictEqual(sizeToString(2, 2), '2x2');
  assert.strictEqual(sizeToString(0, 0), '1x1');
});

test('rotateSizeString', () => {
  assert.strictEqual(rotateSizeString('1x1'), '1x1');
  assert.strictEqual(rotateSizeString('1x2'), '2x1');
  assert.strictEqual(rotateSizeString('2x1'), '1x2');
  assert.strictEqual(rotateSizeString('2x2'), '2x2');
});

test('shiftCoord', () => {
  assert.strictEqual(shiftCoord('a1', 1, 0), 'b1');
  assert.strictEqual(shiftCoord('a1', 0, 1), 'a2');
  assert.strictEqual(shiftCoord('b2', -1, -1), 'a1');
  assert.strictEqual(shiftCoord('a1', 0, 0), 'a1');
});

test('getFootprintCells', () => {
  assert.deepStrictEqual(getFootprintCells('a1', '1x1'), ['a1']);
  assert.deepStrictEqual(getFootprintCells('a1', '2x2'), ['a1', 'b1', 'a2', 'b2']);
  assert.deepStrictEqual(getFootprintCells('a1', '1x2'), ['a1', 'a2']);
  assert.deepStrictEqual(getFootprintCells('b2', '1x1'), ['b2']);
  assert.deepStrictEqual(getFootprintCells('invalid', '1x1'), ['invalid']);
});
