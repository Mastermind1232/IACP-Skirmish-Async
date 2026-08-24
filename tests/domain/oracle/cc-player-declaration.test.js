/**
 * Universal "which figure is playing this Command card" declaration.
 *
 * alexanbv 2026-08-24:
 *   "For any CC that is played by a figure, the first thing that must be
 *    determined is which figure is playing it. Any CC with a restriction box is
 *    a CC played by a figure. Futhermore, the player playing the CC must declare
 *    which figure is playing the CC before opponent decides whether or not to
 *    negate or comms."
 *   "Only figures who can legally play the card should be offered. This step
 *    should check legality and any changes to legality including Mara, a new
 *    hope, taron, dark saber, companion, small, large, etc etc"
 *
 * Before this, only unique-figure cards and one keyword card (Just Business)
 * ever determined a figure; 92 hand-played restricted cards determined nothing
 * and their effects fell back on "whoever is activating".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCcPlayerOptions, figureIsCompanion, fallenMasterWaivesFactionFor } from '../../../src/game/unique-figure-ccs.js';
import { figureMatchesCcRestriction } from '../../../src/game/cc-timing.js';

function army(names) {
  const dcs = names.map((n) => ({ dcName: n }));
  return {
    gameId: 'g',
    p1DcList: dcs,
    p1DcMessageIds: dcs.map((_, i) => `m${i}`),
    figurePositions: { 1: Object.fromEntries(dcs.map((d, i) => [`${d.dcName}-${i + 1}-0`, 'e19'])) },
  };
}
const names = (g, card) => getCcPlayerOptions(g, 1, card).map((o) => o.dcName);

describe('only figures that could legally play the card are offered', () => {
  it('an affiliation-restricted card offers only that affiliation', () => {
    // Opportunistic is SCUM. This is the case that used to hand its movement
    // points to whichever figure happened to be activating.
    const g = army(['Gamorrean Guard (Elite)', 'Rebel Trooper (Regular)']);
    assert.deepEqual(names(g, 'Opportunistic'), ['Gamorrean Guard (Elite)']);
  });

  it('a card with no restriction box has nothing to declare', () => {
    assert.deepEqual(names(army(['Gamorrean Guard (Elite)']), 'Brace Yourself'), []);
  });
});

describe('abilities that change legality are honoured', () => {
  it("Taron's Fallen Master waives the faction symbol for FORCE USERs", () => {
    // Combat Resupply is IMPERIAL; Cal Kestis is a Rebel FORCE USER.
    const g = army(['Taron Malicos', 'Cal Kestis']);
    assert.deepEqual(names(g, 'Combat Resupply').sort(), ['Cal Kestis', 'Taron Malicos']);
  });

  it('but NOT for a companion — The Child is a FORCE USER companion', () => {
    // alexanbv: "it needs to check companion. For example, the child."
    const g = army(['Taron Malicos', 'The Child']);
    assert.equal(figureIsCompanion('The Child-2-0'), true, 'The Child must be known as a companion');
    assert.equal(fallenMasterWaivesFactionFor(g, 1, 'The Child-2-0'), false);
    assert.deepEqual(names(g, 'Combat Resupply'), ['Taron Malicos']);
  });

  it('and only the faction symbol — other restrictions still apply', () => {
    // alexanbv: "Tarons ability just lets non-companion force user ignore faction
    // symbol in the restriction box, other restrictions still apply."
    const g = army(['Taron Malicos', 'Cal Kestis', 'Rebel Trooper (Regular)']);
    // Both Force Users get the IMPERIAL waiver but neither is a TROOPER, and the
    // Rebel Trooper is a TROOPER but gets no waiver.
    assert.deepEqual(figureMatchesCcRestriction(g, 'Cal Kestis', 'Cal Kestis', 'IMPERIAL TROOPER', { hasDarksaber: true }), false);
    assert.deepEqual(figureMatchesCcRestriction(g, 'Rebel Trooper (Regular)', 'Rebel Trooper (Regular)', 'IMPERIAL TROOPER'), false);
  });
});

describe('the per-figure gate understands affiliation at all', () => {
  // It did not. The affiliation test lived only in the ARMY-level gate, which is
  // fine while nothing asks per figure and wrong the moment something does.
  it('a Scum figure satisfies a SCUM restriction', () => {
    const g = army(['Gamorrean Guard (Elite)']);
    assert.equal(figureMatchesCcRestriction(g, 'Gamorrean Guard (Elite)', 'Gamorrean Guard (Elite)', 'SCUM'), true);
  });

  it('a Rebel figure does not', () => {
    const g = army(['Rebel Trooper (Regular)']);
    assert.equal(figureMatchesCcRestriction(g, 'Rebel Trooper (Regular)', 'Rebel Trooper (Regular)', 'SCUM'), false);
  });

  it('a faction-plus-trait restriction needs both halves', () => {
    const g = army(['Cal Kestis']);
    assert.equal(figureMatchesCcRestriction(g, 'Cal Kestis', 'Cal Kestis', 'REBEL FORCE USER'), true);
    assert.equal(figureMatchesCcRestriction(g, 'Cal Kestis', 'Cal Kestis', 'REBEL TROOPER'), false);
  });
});
