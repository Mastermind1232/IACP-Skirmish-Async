/**
 * Keyword-anchor "which figure plays this CC" picker (alexanbv 2026-06-21).
 *
 * Designer rule: whenever an ability could affect/select among multiple figures
 * it must ask WHICH one. Just Business ("friendly Scum within 3 of YOU gain
 * Professional") — "you" is the LEADER who plays it. With 2+ eligible LEADER
 * figures on the board the player must choose which one anchors the range; with
 * one it auto-anchors.
 *
 * The card is a SCUM Leader card (alexanbv 2026-08-24: "Just business needs to
 * be a scum leader" — its band reads "[Scum] Leader"). This file previously used
 * any LEADER at all, which passed only because our data had dropped the Scum
 * half of the restriction.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getKeywordAnchorPlayerOptions } from '../../../src/game/unique-figure-ccs.js';
import { getDcEffects } from '../../../src/data-loader.js';

// Real SCUM LEADER deployment figures for a fake board — Just Business is a
// Scum Leader card, so a Rebel or Imperial Leader is not eligible to anchor it.
function leaderDcNames(n) {
  const eff = getDcEffects();
  return Object.entries(eff)
    .filter(([name, e]) =>
      !name.startsWith('[') && // exclude upgrades/attachments
      e.affiliation === 'Scum' &&
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
