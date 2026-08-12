/**
 * Name-only card lookups are a bug class, not a style preference.
 *
 * alexanbv 2026-08-12:
 *
 *   "nearly ALL abilities in this game are figure-specific, that is, an
 *    individual figure, one member of the group uses them. Very few things are
 *    collective. Any name-only lookups are immediately suspect and will likely
 *    lead to errors. Furthermore, even among group abilities, there may be
 *    multiple groups with the same name for non-unique groups"
 *
 * The failure shape: scan dcMessageMeta for `meta.dcName === someName` and take
 * the first hit. With two groups of the same card in an army that silently
 * resolves to the WRONG group's card, and whatever the ability does lands on the
 * wrong figures. It never throws.
 *
 * The correct lookup already exists: findDcMessageIdForFigure in
 * engine/game-readers.js parses the group index out of a figureKey and matches
 * it against each card's [Group N] tag. Where a figureKey is in scope, use it.
 *
 * This test does not claim every entry below is a live bug — several are
 * name TESTS on a unique figure rather than lookups. It exists so the set
 * cannot GROW while the backlog is worked through, and so each remaining one
 * carries a reason.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../../src/', import.meta.url).pathname;

function sourceFiles(dir = SRC, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (name.endsWith('.js') && !name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

/**
 * Known remaining name-only comparisons, each with why it has not been changed.
 * Removing one is always welcome. ADDING one is what this test is here to stop.
 */
const KNOWN = new Map([
  ['src/engine/game-readers.js', 'the CORRECT lookup — matches dcName AND the group index'],
  ['src/handlers/movement.js', 'Salacious B. Crumb name test on the mover\'s own meta, not a lookup; unique figure'],
  ['src/game/soa-orchestrator.js', 'self-exclusion guards ("skip my own activation"); suspect for non-uniques, untraced'],
  ['src/game/conditions.js', 'findIndex over dcList by name — suspect, untraced'],
  ['src/handlers/hunt-dissent.js', 'Kallus lookup — suspect, untraced'],
  ['src/handlers/post-deploy.js', 'two remaining (~809, ~899) on non-MP paths — untraced'],
  ['src/handlers/setup.js', 'pending-deployment lookup during setup — untraced'],
]);

const PATTERN = /(?:meta\??\.dcName === |\.dcName === dcName|\.dcName === mf\.dcName|\.dcName === ability\.dcName)/;

describe('name-only card lookups', () => {
  test('no NEW file introduces one', () => {
    const offenders = [];
    for (const file of sourceFiles()) {
      const rel = file.slice(file.indexOf('/src/') + 1);
      const src = readFileSync(file, 'utf8');
      const hit = src.split('\n').some((line) => {
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*')) return false;
        return PATTERN.test(line);
      });
      if (hit && !KNOWN.has(rel)) offenders.push(rel);
    }
    assert.deepStrictEqual(offenders, [],
      'these resolve a card by NAME. With two groups of the same card that picks the wrong one. '
      + 'Use findDcMessageIdForFigure(gameId, playerNum, figureKey, dcMessageMeta) where a figureKey is in scope, '
      + 'or add an entry to KNOWN with the reason it is safe.');
  });

  test('the MP-granting post-deploy paths are all group-aware', () => {
    // These were the confirmed live instances: Smooth Landing and Strike Team
    // grant to a figure the PLAYER chose, and that figure is frequently a
    // non-unique trooper.
    const src = readFileSync(join(SRC, 'handlers/post-deploy.js'), 'utf8');
    for (const bad of [
      'meta.dcName === mf.dcName',
      'meta.dcName === ability.dcName',
      'if (meta.dcName === dcName && meta.playerNum === playerNum) { msgId = mid; break; }',
      'const cassianMid = findMid(cassianName)',
    ]) {
      assert.ok(!src.includes(bad), `post-deploy must not resolve a grantee by name: ${bad}`);
    }
    assert.match(src, /findDcMessageIdForFigure\(/, 'uses the group-aware lookup');
  });

  test('the correct lookup really does distinguish groups', async () => {
    const { findDcMessageIdForFigure } = await import('../../src/engine/game-readers.js');
    const meta = new Map([
      ['m1', { gameId: 'g', playerNum: 1, dcName: 'Stormtrooper', displayName: 'Stormtrooper [Group 1]' }],
      ['m2', { gameId: 'g', playerNum: 1, dcName: 'Stormtrooper', displayName: 'Stormtrooper [Group 2]' }],
    ]);
    assert.equal(findDcMessageIdForFigure('g', 1, 'Stormtrooper-2-0', meta), 'm2');
    assert.equal(findDcMessageIdForFigure('g', 1, 'Stormtrooper-1-3', meta), 'm1');
  });
});
