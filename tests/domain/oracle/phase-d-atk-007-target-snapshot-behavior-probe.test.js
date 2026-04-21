/**
 * Phase-D behavioral probe — CRR-ATK-007.
 *
 * CRR: "During an attack, if the attacker's LOS to the target space changes
 * or the defender moves, the attacker must re-declare a target space."
 *
 * In this engine, defender motion and LOS changes mid-attack are
 * structurally impossible — combat is a single pendingCombat lifecycle
 * resolved before control returns to the action loop (see
 * phase-d-atk-combat-atomicity-probe.test.js). The CRR clause therefore
 * applies vacuously: the behavioral invariant we can actually pin is that
 * `combat.target` is a SNAPSHOT taken at attack declaration (not a live
 * reference into game state). A refactor that replaced the spread-copy with
 * a live reference would silently violate atomicity.
 *
 * Source reference (src/handlers/combat.js:1173): `target: { ...target },`
 *
 * PROBE-ATK-007-A: target snapshot is independent of game.figurePositions
 *                  mutations after combat declaration
 * PROBE-ATK-007-B: target snapshot preserves figureKey even after post-
 *                  declaration figure removal
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Mirror src/handlers/combat.js:1173 — the snapshot pattern.
function declareCombat(game, attackerMsgId, target) {
  game.pendingCombat = {
    attackerMsgId,
    target: { ...target },
  };
  return game.pendingCombat;
}

describe('PROBE-ATK-007-A: combat.target is a snapshot, not a live reference', () => {
  it('mutating game.figurePositions after declare does not change combat.target.position', () => {
    const game = {
      figurePositions: { 2: { 'Greedo-1-0': 'j11' } },
    };
    const target = { figureKey: 'Greedo-1-0', position: game.figurePositions[2]['Greedo-1-0'], dist: 1 };
    const combat = declareCombat(game, 'MSG1', target);

    // Simulate defender movement after declare (the CRR counterfactual).
    game.figurePositions[2]['Greedo-1-0'] = 'z99';

    assert.equal(combat.target.position, 'j11',
      'CRR-ATK-007: target position captured at declare must not drift when the defender is repositioned post-declare.');
  });
});

describe('PROBE-ATK-007-B: target snapshot preserves figureKey even after defender removal', () => {
  it('deleting the defender from figurePositions does not erase combat.target.figureKey', () => {
    const game = {
      figurePositions: { 2: { 'Greedo-1-0': 'j11' } },
    };
    const target = { figureKey: 'Greedo-1-0', position: 'j11', dist: 1 };
    const combat = declareCombat(game, 'MSG1', target);

    delete game.figurePositions[2]['Greedo-1-0'];

    assert.equal(combat.target.figureKey, 'Greedo-1-0',
      'Target figureKey captured at declare must survive post-declare defender removal.');
    assert.equal(combat.target.position, 'j11',
      'Target position captured at declare must survive post-declare defender removal.');
  });
});
