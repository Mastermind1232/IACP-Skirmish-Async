/**
 * MASSIVE and line of sight — the exemption is keyed on the ENDS of the trace.
 *
 * alexanbv 2026-08-18:
 *
 *   "For massive figures the rule is that figures do not block los to or from
 *    massive figures. So massive figures do block LoS just as any other figure,
 *    except when the attacker or target is a massive figure, in which case no
 *    figures, including other massive figures, block LoS"
 *
 * So there are exactly two exemptions, and both are about who is SHOOTING or
 * being SHOT AT:
 *
 *   attacker is MASSIVE -> no figure blocks its trace
 *   target   is MASSIVE -> no figure blocks the trace to it
 *
 * There is NO exemption for a massive figure standing in the middle. An AT-ST
 * between two Stormtroopers blocks exactly like a Stormtrooper would.
 *
 * The engine had a third, invented exemption: every builder of a figure-blocking
 * set skipped any MASSIVE figure outright, so shots passed straight through an
 * AT-ST. It survived because the rule is implemented FOUR separate times and the
 * headless tests that covered it were pinned to coordinates that do not exist on
 * the map, so they asserted nothing. Both halves of that are guarded here.
 *
 * This is a source-level test on purpose: the defect was duplication, not logic.
 * Behaviour is covered by G65 / LOS-PARITY / LOS-19b in
 * tests/headless/combat-resolution.test.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url).pathname, 'utf8');

/** Every SHIPPED place that builds a figure-blocking set for a LOS trace. */
const LOS_BLOCKING_BUILDERS = [
  'src/game/effective-los.js',
  'src/handlers/dc-play-area.js',
  'src/engine/available-actions.js',
];

/**
 * Local-only harnesses that hold a fourth copy of the rule. These are
 * .gitignored on purpose (see the block in .gitignore), so they exist on a
 * working copy and NOT in a fresh clone — checked when present, skipped when
 * not.
 *
 * This file used to list measure-los-parity.js alongside the shipped builders,
 * which made `npm test` pass on a machine that happened to have it and fail with
 * ENOENT anywhere else. Found 2026-08-31 by running the suite in a clean
 * worktree; it had been that way since the guard was written on 2026-08-18, and
 * every "all green" I reported in between was green only on this working copy.
 */
const LOCAL_LOS_BUILDERS = [
  'tests/headless/measure-los-parity.js',
];

/**
 * The blocker-side skip, as every copy spelled it. Matching the exact shape
 * rather than the bare word keeps the LARGE/MASSIVE size guards used by push
 * and small-only abilities out of scope — those are a different rule.
 */
const BLOCKER_SIDE_SKIP = /keywords[^\n]*===\s*'MASSIVE'\)\)\s*continue;/;

describe('MASSIVE does not exempt the figure in the middle', () => {
  for (const file of [...LOS_BLOCKING_BUILDERS, ...LOCAL_LOS_BUILDERS]) {
    test(`${file} does not skip MASSIVE blockers`, (t) => {
      let src;
      try {
        src = read(file);
      } catch (err) {
        if (err.code === 'ENOENT' && LOCAL_LOS_BUILDERS.includes(file)) {
          t.skip(`${file} is gitignored and absent here — nothing to check`);
          return;
        }
        throw err;
      }
      const offending = src.split('\n')
        .map((line, i) => [i + 1, line])
        .filter(([, line]) => BLOCKER_SIDE_SKIP.test(line) && !line.trim().startsWith('//'));
      assert.deepStrictEqual(offending, [],
        `${file}: a MASSIVE figure is being skipped while building the figure-blocking set. `
        + 'The exemption is keyed on the attacker or the target being massive, never on the '
        + 'blocker. Skipping it here lets every shot pass through an AT-ST.');
    });
  }
});

describe('both real exemptions survive', () => {
  // Guarding the deletion in the other direction: someone "fixing" the above by
  // stripping all MASSIVE handling would break shooting from and at an AT-ST.
  test('effective-los.js keeps the attacker-side and target-side exemptions', () => {
    const src = read('src/game/effective-los.js');
    assert.match(src, /fromKws\.includes\('MASSIVE'\)/, 'massive ATTACKER ignores figure blocking');
    assert.match(src, /const toMassive = /, 'massive TARGET is seen through other figures');
    assert.match(src, /if \(toMassive\) \{\s*\n\s*blocking = null;/, 'massive target clears the blocking set');
  });

  test('dc-play-area.js keeps both exemptions in the attack-target picker', () => {
    const src = read('src/handlers/dc-play-area.js');
    assert.match(src, /attackerKws\.includes\('MASSIVE'\)/, 'massive ATTACKER ignores figure blocking');
    assert.match(src, /targetEff\?\.keywords[^\n]*'MASSIVE'/, 'massive TARGET clears the blocking set');
  });

  test('available-actions.js keeps both exemptions in the engine', () => {
    const src = read('src/engine/available-actions.js');
    assert.match(src, /_attackerKws\.includes\('MASSIVE'\)/, 'massive ATTACKER ignores figure blocking');
    assert.match(src, /losBlockingCoords = null; \/\/ MASSIVE targets/, 'massive TARGET clears the blocking set');
  });
});

describe('the headless fixtures that cover this point at real spaces', () => {
  // The rule went wrong undetected because the tests guarding it were pinned to
  // coordinates that do not exist on mos-eisley-outskirts, so every assertion
  // downstream measured nothing. Any coordinate in that file must be a real
  // space on the map it names.
  test('every coordinate in combat-resolution.test.js exists on its map', async () => {
    const { getMapData } = await import('../../src/data-loader.js');
    const src = read('tests/headless/combat-resolution.test.js');

    const mapIds = [...new Set([...src.matchAll(/mapId:\s*'([^']+)'/g)].map((m) => m[1]))];
    assert.ok(mapIds.length > 0, 'expected the fixtures to name at least one map');

    const valid = new Set();
    for (const id of mapIds) {
      for (const s of (getMapData(id)?.spaces || [])) valid.add(String(s).toLowerCase());
    }

    // Only coordinates actually assigned to a figure — template literals like
    // `t${17 + i}` are computed and are not checked here. Matched per LINE
    // rather than by one regex over the whole assignment: figure keys are
    // themselves indexed (`figurePositions[1][p1Figs[0]]`), and a bracket-
    // balancing pattern silently skipped exactly those lines.
    const pinned = src.split('\n')
      .filter((line) => line.includes('figurePositions[') && line.includes('='))
      .flatMap((line) => [...line.matchAll(/'([a-z]+\d+)'/g)].map((m) => m[1].toLowerCase()));
    assert.ok(pinned.length >= 10, `expected the pinned fixtures, got ${pinned.length}`);

    const offMap = [...new Set(pinned.filter((c) => !valid.has(c)))];
    assert.deepStrictEqual(offMap, [],
      `these coordinates do not exist on ${mapIds.join(' / ')}, so every assertion downstream `
      + 'of them is vacuous. Re-pin them to real spaces.');
  });
});
