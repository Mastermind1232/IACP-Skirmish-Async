/**
 * LOS oracle: Destruct's hand-computed answer key for 69 LOS cases on
 * lothal-wastes. Source of truth for the LOS rewrite — every commit
 * touching `hasLineOfSight` must keep this passing.
 *
 * Fixture: tests/fixtures/los-destruct-key.json
 * History:
 *   2026-04-28: initial baseline. Pre-rewrite score 47/69 (68%).
 *
 * Each case has:
 *   - attacker / target: a coord, a "Massive figure in <range>", or
 *     a "Mobile figure in/at <coord>"
 *   - others: comma-separated list of figures and/or "Energy shield in <coord>"
 *   - expected: TRUE/FALSE per IACP CRR (Destruct's hand-computed)
 *
 * The test fails per-case so a partial-fix commit shows exactly which
 * scenarios newly pass / regress.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hasLineOfSight } from '../../../src/game/spatial.js';
import { getMapData } from '../../../src/data-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixture = JSON.parse(readFileSync(
  join(__dirname, '..', '..', 'fixtures', 'los-destruct-key.json'),
  'utf8',
));

// ── Parsing helpers ────────────────────────────────────────────────────────

function parseRange(s) {
  const m = s.match(/^([A-Za-z])(\d+)-([A-Za-z])(\d+)$/);
  if (!m) return null;
  const c1 = m[1].toLowerCase().charCodeAt(0) - 97;
  const r1 = +m[2];
  const c2 = m[3].toLowerCase().charCodeAt(0) - 97;
  const r2 = +m[4];
  const cells = [];
  for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
      cells.push(String.fromCharCode(97 + c) + r);
    }
  }
  return cells;
}

function parseDescriptor(s) {
  if (!s || s.toLowerCase() === 'none') return null;
  s = s.trim();
  const isMassive = /massive/i.test(s);
  const isShield = /energy shield/i.test(s);
  const isMobile = /mobile/i.test(s);
  const range = s.match(/([A-Za-z]\d+-[A-Za-z]\d+)/);
  if (range) {
    return { cells: parseRange(range[1]).map(c => c.toLowerCase()), isMassive, isShield, isMobile };
  }
  const single = s.match(/(?:^|\s)([A-Za-z]\d+)(?:$|\s|\b)/);
  if (single) return { cells: [single[1].toLowerCase()], isMassive, isShield, isMobile };
  return null;
}

function splitOthers(s) {
  if (!s || s.toLowerCase() === 'none') return [];
  const parts = [];
  let work = s;
  while (work.trim()) {
    const m =
      work.match(/^\s*((?:Massive|Mobile)\s+figure\s+(?:in\s+)?[A-Za-z]\d+(?:-[A-Za-z]\d+)?)/i) ||
      work.match(/^\s*(Energy\s+shield\s+(?:in\s+)?[A-Za-z]\d+)/i) ||
      work.match(/^\s*([A-Za-z]\d+)/);
    if (!m) break;
    parts.push(m[1].trim());
    work = work.slice(m[0].length).replace(/^\s*,\s*/, '');
  }
  return parts;
}

// ── Per-case LOS computation ───────────────────────────────────────────────

function computeLosForCase(c, mapSpaces) {
  const att = parseDescriptor(c.attacker);
  const tgt = parseDescriptor(c.target);
  const others = splitOthers(c.others).map(parseDescriptor).filter(Boolean);

  // Energy shields per CRR p.28: block LOS through their cell *and* through
  // their corners. Skip shield blocking entirely if the attacker or target
  // sits on the shield's cell (shield is the attacker / target).
  const shieldCells = new Set();
  for (const o of others) if (o.isShield) for (const c of o.cells) shieldCells.add(c);
  const attCells = new Set(att?.cells || []);
  const tgtCells = new Set(tgt?.cells || []);
  const activeShields = [...shieldCells].filter(c => !attCells.has(c) && !tgtCells.has(c));
  const effectiveMs = activeShields.length > 0
    ? {
        ...mapSpaces,
        blocking: [...(mapSpaces.blocking || []), ...activeShields],
        cornerBlockingTiles: [...(mapSpaces.cornerBlockingTiles || []), ...activeShields],
      }
    : mapSpaces;

  // Figure-blocking set. Per IACP CRR (Destruct, 2026-04-28):
  //   - Massive figures DO block LOS.
  //   - Exception: figures (including other Massives) do NOT block LOS
  //     TO or FROM a Massive figure.
  // So when attacker OR target is Massive, figure blocking is suppressed
  // entirely; otherwise every figure, Massive or not, blocks.
  const attMassive = att?.isMassive;
  const tgtMassive = tgt?.isMassive;
  const blocking = new Set();
  if (!attMassive && !tgtMassive) {
    for (const o of others) {
      if (o.isShield) continue;
      for (const cell of o.cells) blocking.add(cell);
    }
  }
  const figBlocking = blocking;

  if (!att || !tgt) return false;
  for (const ac of att.cells) {
    for (const tc of tgt.cells) {
      if (hasLineOfSight(ac, tc, effectiveMs, figBlocking)) return true;
    }
  }
  return false;
}

// ── Test driver ────────────────────────────────────────────────────────────

describe(`LOS oracle: Destruct key (${fixture.cases.length} cases on ${fixture.map})`, () => {
  const ms = getMapData(fixture.map);
  assert.ok(ms?.adjacency, `${fixture.map} map data must be loaded`);

  for (const c of fixture.cases) {
    const label = `row ${c.row}: ${c.attacker} → ${c.target} | others=${c.others}`;
    it(label, () => {
      const got = computeLosForCase(c, ms);
      assert.strictEqual(got, c.expected,
        `expected LOS=${c.expected ? 'TRUE' : 'FALSE'}, got ${got ? 'TRUE' : 'FALSE'}`);
    });
  }
});
