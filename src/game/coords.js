/**
 * Coordinate and size helpers for map/grid. No Discord, no game state.
 * Used by movement, setup, interact, and index.
 */

export function normalizeCoord(coord) {
  return String(coord || '').toLowerCase();
}

export function parseCoord(coord) {
  const s = String(coord || '').toLowerCase();
  const letter = s.match(/[a-z]+/)?.[0] || '';
  const num = parseInt(s.match(/\d+/)?.[0] || '0', 10);
  const col = letter
    ? [...letter].reduce((acc, c) => acc * 26 + (c.charCodeAt(0) - 96), 0) - 1
    : -1;
  const row = num - 1;
  return { col, row };
}

export function colRowToCoord(col, row) {
  if (col < 0 || row < 0) return '';
  let letter = '';
  let c = col;
  while (c >= 0) {
    letter = String.fromCharCode(65 + (c % 26)) + letter;
    c = Math.floor(c / 26) - 1;
  }
  return letter.toLowerCase() + (row + 1);
}

export function edgeKey(a, b) {
  return [String(a).toLowerCase(), String(b).toLowerCase()].sort().join('|');
}

export function toLowerSet(arr = []) {
  return new Set((arr || []).map((s) => normalizeCoord(s)));
}

export function parseSizeString(size) {
  const [colsRaw, rowsRaw] = String(size || '1x1')
    .toLowerCase()
    .split('x')
    .map((n) => parseInt(n, 10) || 1);
  return { cols: colsRaw || 1, rows: rowsRaw || 1 };
}

export function sizeToString(cols, rows) {
  return `${Math.max(1, cols)}x${Math.max(1, rows)}`;
}

export function rotateSizeString(size) {
  const { cols, rows } = parseSizeString(size);
  if (cols === rows) return sizeToString(cols, rows);
  return sizeToString(rows, cols);
}

export function shiftCoord(coord, dx, dy) {
  const { col, row } = parseCoord(coord);
  return normalizeCoord(colRowToCoord(col + dx, row + dy));
}

/** Get all cells a unit occupies when its top-left is at topLeftCoord. size: "1x1"|"1x2"|"2x2"|"2x3". */
export function getFootprintCells(topLeftCoord, size) {
  const { col, row } = parseCoord(topLeftCoord);
  if (col < 0 || row < 0) return [topLeftCoord];
  const [cols, rows] = (size || '1x1').split('x').map(Number) || [1, 1];
  const cells = [];
  for (let r = 0; r < (rows || 1); r++) {
    for (let c = 0; c < (cols || 1); c++) {
      cells.push(colRowToCoord(col + c, row + r));
    }
  }
  return cells;
}
