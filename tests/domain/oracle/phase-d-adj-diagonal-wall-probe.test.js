/**
 * Phase-D probe: diagonal-intersection adjacency carve-out.
 *
 * PROBE-PD-ADJ-005: Spaces on opposite sides of a diagonal intersection of
 *   walls, doors, or blocking terrain are not adjacent. (CRR ADJACENT)
 *
 * Implementation: Adjacency is a precomputed graph on `map-spaces.json`
 *   built by `scripts/generate-map-spaces.js:buildMapSpaces`. For a
 *   diagonal A↔B with intermediates C (shares row with A, col with B)
 *   and D (shares col with A, row with B), the graph treats B as a
 *   diagonal neighbour of A iff AT LEAST ONE of the two orthogonal
 *   right-angle paths (A→C→B or A→D→B) is open — i.e. neither its
 *   two edges is in the impassable/movement-blocking edge set AND the
 *   intermediate space is not itself blocking terrain. When BOTH paths
 *   are blocked (walls/doors/blocking-terrain form a diagonal X through
 *   the shared corner), B is excluded from A's adjacency list.
 *   Behavioral pin: lothal-wastes has a verified "both-paths-blocked"
 *   diagonal (i7↔j8, walls at i7|i8 AND j7|j8) and a verified
 *   "one-path-open" diagonal (n4↔m5, walls on C-path only, D-path via
 *   n5 open). The generated graph excludes the first and preserves the
 *   second — proving the rule applies only when BOTH paths are cut.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const GEN_SRC = readFileSync(resolve(ROOT, 'scripts/generate-map-spaces.js'), 'utf8');
const MAP_SPACES = JSON.parse(readFileSync(resolve(ROOT, 'data/map-spaces.json'), 'utf8'));

describe('PROBE-PD-ADJ-005: diagonal adjacency blocked only when BOTH right-angle paths cut', () => {
  it('005a: source — generator names the CRR rule verbatim in its header doc', () => {
    assert.match(GEN_SRC,
      /Spaces on either side of the diagonal intersection of walls, doors,\s*\n\s*\*\s*and\/or blocking terrain are not adjacent\./,
      'generator header must quote CRR ADJACENT diagonal-intersection rule — CRR-ADJ-005');
  });

  it('005b: source — both-paths-open predicate: diagonal open iff pathC OR pathD', () => {
    assert.match(GEN_SRC,
      /if \(pathC \|\| pathD\) \{\s*\n\s*neighbors\.push\(nk\);/,
      'diagonal must be added iff at least one right-angle path is open — CRR-ADJ-005');
  });

  it('005c: source — each right-angle path requires: edge open + intermediate not blocking + exit edge open', () => {
    assert.match(GEN_SRC,
      /pathC = !cBlocking && !impSet\.has\(acEdge\) && !impSet\.has\(cbEdge\);/,
      'pathC must AND: C not blocking, A↔C edge open, C↔B edge open — CRR-ADJ-005');
    assert.match(GEN_SRC,
      /pathD = !dBlocking && !impSet\.has\(adEdge\) && !impSet\.has\(dbEdge\);/,
      'pathD must AND: D not blocking, A↔D edge open, D↔B edge open — CRR-ADJ-005');
  });

  it('005d: source — blocking terrain space has empty adjacency list', () => {
    assert.match(GEN_SRC,
      /if \(blockingSet\.has\(k\)\) \{\s*\n\s*adjacency\[k\] = \[\];/,
      'blocking terrain must produce empty adjacency — CRR-ADJ-005 (blocking-terrain rider)');
  });

  it('005e: data — lothal-wastes i7↔j8 diagonal is excluded (walls on i7|i8 AND j7|j8)', () => {
    const lw = MAP_SPACES.maps['lothal-wastes'];
    assert.ok(lw, 'lothal-wastes must be in map-spaces.json');
    const hasEdge = (a, b) => (lw.impassableEdges || []).some(e => e.includes(a) && e.includes(b));
    assert.equal(hasEdge('i7', 'i8'), true, 'fixture requires i7|i8 wall — CRR-ADJ-005');
    assert.equal(hasEdge('j7', 'j8'), true, 'fixture requires j7|j8 wall — CRR-ADJ-005');
    assert.ok(!lw.adjacency['i7'].includes('j8'),
      'i7 must NOT list j8 as adjacent (both right-angle paths blocked) — CRR-ADJ-005');
    assert.ok(!lw.adjacency['j8'].includes('i7'),
      'j8 must NOT list i7 as adjacent (symmetric) — CRR-ADJ-005');
  });

  it('005f: data — lothal-wastes n4↔m5 diagonal is preserved (only C-path walled; D-path open)', () => {
    const lw = MAP_SPACES.maps['lothal-wastes'];
    const hasEdge = (a, b) => (lw.impassableEdges || []).some(e => e.includes(a) && e.includes(b));
    assert.equal(hasEdge('n4', 'm4'), true, 'fixture: n4|m4 walled (C-path)');
    assert.equal(hasEdge('m4', 'm5'), true, 'fixture: m4|m5 walled (C-path)');
    assert.equal(hasEdge('n4', 'n5'), false, 'fixture: n4|n5 open (D-path)');
    assert.equal(hasEdge('m5', 'n5'), false, 'fixture: m5|n5 open (D-path)');
    assert.ok(lw.adjacency['n4'].includes('m5'),
      'n4 must list m5 as adjacent when at least one right-angle path is open — CRR-ADJ-005');
    assert.ok(lw.adjacency['m5'].includes('n4'),
      'm5 must list n4 as adjacent (symmetric) — CRR-ADJ-005');
  });

  it('005g: behavior — a pure-JS replica of the diagonal predicate matches CRR semantics', () => {
    const diagAdjacent = (cBlocking, acOpen, cbOpen, dBlocking, adOpen, dbOpen) => {
      const pathC = !cBlocking && acOpen && cbOpen;
      const pathD = !dBlocking && adOpen && dbOpen;
      return pathC || pathD;
    };
    assert.equal(diagAdjacent(false, true, true, false, true, true), true,
      'no walls → adjacent');
    assert.equal(diagAdjacent(false, false, true, false, true, false), false,
      'one wall on each path (X-intersection) → NOT adjacent — CRR-ADJ-005');
    assert.equal(diagAdjacent(false, true, false, false, true, true), true,
      'one path blocked, other open → adjacent (rule requires BOTH blocked)');
    assert.equal(diagAdjacent(true, true, true, false, true, true), true,
      'intermediate C blocking but D-path open → adjacent');
    assert.equal(diagAdjacent(true, true, true, true, true, true), false,
      'both intermediates are blocking terrain → NOT adjacent');
  });
});
