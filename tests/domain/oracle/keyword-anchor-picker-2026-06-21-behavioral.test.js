/**
 * Keyword-anchor "which figure plays this CC" picker (alexanbv 2026-06-21).
 *
 * Designer rule: whenever an ability could affect/select among multiple figures
 * it must ask WHICH one. Just Business ("friendly Scum within 3 of YOU gain
 * Professional") is playableBy LEADER — "you" is the LEADER who plays it. With
 * 2+ LEADER figures on the board the player must choose which one anchors the
 * range; with one it auto-anchors.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getKeywordAnchorPlayerOptions } from '../../../src/game/unique-figure-ccs.js';
import { getDcEffects } from '../../../src/data-loader.js';

// Two real LEADER deployment figures for a fake board.
function leaderDcNames(n) {
  const eff = getDcEffects();
  return Object.entries(eff)
    .filter(([name, e]) =>
      !name.startsWith('[') && // exclude upgrades/attachments
      (e.keywords || []).map((k) => String(k).toLowerCase()).includes('leader'))
    .map(([name]) => name)
    .slice(0, n);
}

describe('Just Business keyword-anchor picker', () => {
  it('offers one option per LEADER figure when 2+ are on the board', () => {
    const [a, b] = leaderDcNames(2);
    assert.ok(a && b, 'two distinct LEADER deployment cards exist in data');
    const game = {
      figurePositions: { 1: { [`${a}-1-0`]: 'a1', [`${b}-1-0`]: 'b2', 'Stormtrooper-1-0': 'c3' }, 2: {} },
    };
    const opts = getKeywordAnchorPlayerOptions(game, 1, 'Just Business');
    assert.equal(opts.length, 2, 'both LEADER figures are offered as anchor choices');
    assert.ok(opts.every((o) => o.kind === 'anchor' && o.consume === 'none'),
      'keyword-anchor picks consume nothing');
    const offered = new Set(opts.map((o) => o.figureKey));
    assert.ok(offered.has(`${a}-1-0`) && offered.has(`${b}-1-0`));
    assert.ok(!offered.has('Stormtrooper-1-0'), 'non-LEADER figures are not offered');
  });

  it('auto-anchors (single option) when exactly one LEADER is on the board', () => {
    const [a] = leaderDcNames(1);
    const game = { figurePositions: { 1: { [`${a}-1-0`]: 'a1', 'Stormtrooper-1-0': 'c3' }, 2: {} } };
    const opts = getKeywordAnchorPlayerOptions(game, 1, 'Just Business');
    assert.equal(opts.length, 1);
    assert.equal(opts[0].figureKey, `${a}-1-0`);
  });

  it('returns nothing for a non-anchored / non-keyword-anchored CC', () => {
    const [a, b] = leaderDcNames(2);
    const game = { figurePositions: { 1: { [`${a}-1-0`]: 'a1', [`${b}-1-0`]: 'b2' }, 2: {} } };
    assert.equal(getKeywordAnchorPlayerOptions(game, 1, 'Take Cover').length, 0);
    assert.equal(getKeywordAnchorPlayerOptions(game, 1, 'Some Unknown Card').length, 0);
  });
});
