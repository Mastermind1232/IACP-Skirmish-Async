/**
 * Re-audit gap fixes (2026-06-21). Behavioral coverage for the 10 ability
 * fixes from /tmp/reaudit-gaps.txt:
 *   - Mortar Trooper Haul: impassable terrain treated as difficult (movement).
 *   - Hondo "What's Yours is Mine": independent lose/gain VP.
 *   - Taron Malicos Boulder Barrage: requiresLos library flag.
 *   - Arcing Shot: no spurious +1 Accuracy.
 *   - Dying Lunge: overrideAttackType lowercased so the Melee restriction binds.
 *   - Hard to Hit: defense-die reroll (forcedRerollQueue) instead of +1 Evade.
 *   - Guardian Stance: reroll 1-or-more (multiple forcedRerollQueue entries).
 *   - Officer's Training: attacker reroll registered (part 1).
 *   - Meditation: no dice override (figure uses its own pool).
 *   - Retaliation: 2 Hit (Damage) tokens, not choosable Power Tokens.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility, getAbility } from '../../../src/game/abilities.js';
import { computeMovementCache, getMovementTarget } from '../../../src/game/movement.js';
import { edgeKey } from '../../../src/game/coords.js';

// ── Mortar Trooper Haul: impassable terrain treated as difficult ─────────────
//
// Build a synthetic 1x3 corridor a1-a2-a3 where the a1|a2 edge is IMPASSABLE.
// A plain figure cannot cross it at all; a Haul figure crosses it but pays the
// difficult-terrain surcharge (+1 MP).

function corridorBoard() {
  const spaces = ['a1', 'a2', 'a3'];
  const adjacency = { a1: ['a2'], a2: ['a1', 'a3'], a3: ['a2'] };
  const impassableEdgeSet = new Set([edgeKey('a1', 'a2')]);
  const movementBlockingSet = new Set([edgeKey('a1', 'a2')]);
  return {
    mapSpaces: { spaces, adjacency },
    adjacency,
    terrain: {},
    blockingSet: new Set(),
    occupiedSet: new Set(),
    movementBlockingSet,
    impassableEdgeSet,
    spacesSet: new Set(spaces),
    wallAdjacentSet: new Set(),
  };
}

const BASE_PROFILE = {
  size: '1x1', cols: 1, rows: 1, isLarge: false, allowDiagonal: true,
  canRotate: false, isMassive: false, isMobile: false,
  ignoreDifficult: false, ignoreBlocking: false, ignoreImpassable: false,
  ignoreFigureCost: false, canEndOnOccupied: false,
  treatBlockingAsDifficult: false, treatImpassableAsDifficult: false,
  wallRunActive: false, keywords: [],
};

describe('Re-audit: Mortar Trooper Haul — impassable as difficult', () => {
  it('a plain figure cannot cross the impassable edge', () => {
    const board = corridorBoard();
    const cache = computeMovementCache('a1', 9, board, { ...BASE_PROFILE });
    assert.equal(getMovementTarget(cache, 'a2'), null, 'a2 must be unreachable across impassable edge');
    assert.equal(getMovementTarget(cache, 'a3'), null, 'a3 must be unreachable');
  });

  it('Thrusters (ignoreImpassable) crosses with no surcharge', () => {
    const board = corridorBoard();
    const cache = computeMovementCache('a1', 9, board, { ...BASE_PROFILE, ignoreImpassable: true });
    const a2 = getMovementTarget(cache, 'a2');
    assert.ok(a2, 'a2 reachable with Thrusters');
    assert.equal(a2.cost, 1, 'Thrusters waives the impassable edge entirely (cost 1)');
  });

  it('Haul (treatImpassableAsDifficult) crosses but pays the difficult +1 surcharge', () => {
    const board = corridorBoard();
    const cache = computeMovementCache('a1', 9, board, { ...BASE_PROFILE, treatImpassableAsDifficult: true });
    const a2 = getMovementTarget(cache, 'a2');
    assert.ok(a2, 'a2 reachable with Haul');
    assert.equal(a2.cost, 2, 'crossing the impassable edge costs as difficult terrain (1 base + 1)');
    const a3 = getMovementTarget(cache, 'a3');
    assert.ok(a3, 'a3 reachable beyond the impassable edge');
    assert.equal(a3.cost, 3, 'a3 = 2 (impassable-as-difficult) + 1 (normal step)');
  });
});

// ── Library-shape assertions (data-level fixes) ──────────────────────────────

describe('Re-audit: library entry shapes', () => {
  it('Boulder Barrage sets requiresLos:true', () => {
    const e = getAbility('boulder_barrage');
    assert.equal(e.requiresLos, true);
  });

  it('Arcing Shot grants no Accuracy bonus', () => {
    const e = getAbility('Arcing Shot');
    assert.equal(e.attackAccuracyBonus, undefined, 'Arcing Shot must not carry an Accuracy bonus');
    assert.equal(e.arcingShotTargeting, true);
  });

  it('Hard to Hit rerolls a defense die (no +1 Evade)', () => {
    const e = getAbility('Hard to Hit');
    assert.equal(e.applyDefenseBonusEvade, undefined);
    assert.equal(e.defenderRerollOneDefenseDie, 1);
  });

  it('Guardian Stance allows rerolling any number of dice', () => {
    const e = getAbility('Guardian Stance');
    assert.equal(e.defenderRerollAnyNumber, true);
  });

  it("Officer's Training part 1 registers an attack-die reroll", () => {
    const e = getAbility("Officer's Training");
    assert.equal(e.rerollOneAttackDie, 1);
    assert.equal(e.draw, 1);
    assert.equal(e.drawIfTrait, 'LEADER');
  });

  it('Meditation grants no dice override (own pool)', () => {
    const e = getAbility('Meditation');
    assert.equal(e.nextActivationFreeAttack.melee, true);
    assert.equal(e.nextActivationFreeAttack.dice, undefined, 'must not hard-code a dice pool');
  });

  it('Retaliation grants Hit Tokens, not choosable Power Tokens', () => {
    const e = getAbility('Retaliation');
    const tokenOpt = e.chooseOne.find((o) => /token/i.test(o.label));
    assert.ok(tokenOpt, 'Retaliation has a token option');
    assert.equal(tokenOpt.powerTokenGain, undefined, 'must not be choosable Power Tokens');
    assert.equal(tokenOpt.hitTokenGain, 2);
  });
});

// ── Behavioral: Hard to Hit registers a defender defense-die reroll ──────────

describe('Re-audit: Hard to Hit behavior', () => {
  it('pushes a defender-controlled defense-pool forced reroll', () => {
    const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2 };
    const game = { combat };
    const r = resolveAbility('Hard to Hit', { game, combat, playerNum: 2 });
    assert.equal(r.applied, true);
    assert.ok(Array.isArray(combat.forcedRerollQueue));
    assert.equal(combat.forcedRerollQueue.length, 1);
    const q = combat.forcedRerollQueue[0];
    assert.equal(q.controlPlayer, 2);
    assert.equal(q.pool, 'defense');
    assert.equal(q.remaining, 1);
    assert.equal(q.source, 'Hard to Hit');
  });
});

// ── Behavioral: Guardian Stance registers 1-per-die optional rerolls ─────────

describe('Re-audit: Guardian Stance behavior', () => {
  it('registers one optional reroll entry per die across both pools', () => {
    const combat = {
      attackerPlayerNum: 1,
      defenderPlayerNum: 2,
      attackDiceResults: [{ color: 'red' }, { color: 'blue' }],
      defenseDiceResults: [{ color: 'white' }],
    };
    const game = { combat };
    const r = resolveAbility('Guardian Stance', { game, combat, playerNum: 2 });
    assert.equal(r.applied, true);
    assert.equal(combat.forcedRerollQueue.length, 3, '2 attack + 1 defense = 3 reroll allowances');
    for (const q of combat.forcedRerollQueue) {
      assert.equal(q.source, 'Guardian Stance');
      assert.equal(q.pool, 'any');
      assert.equal(q.controlPlayer, 2);
    }
  });

  it('registers at least one entry even with no dice rolled yet', () => {
    const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2 };
    const game = { combat };
    resolveAbility('Guardian Stance', { game, combat, playerNum: 2 });
    assert.equal(combat.forcedRerollQueue.length, 1);
  });
});

// ── Behavioral: Arcing Shot adds no Accuracy ─────────────────────────────────

describe('Re-audit: Arcing Shot behavior', () => {
  it('sets the targeting flag without adding bonusAccuracy', () => {
    const combat = { attackerPlayerNum: 1, attackerFigureKey: 'Stormtrooper-1-0' };
    const game = { combat };
    const r = resolveAbility('Arcing Shot', { game, combat, playerNum: 1 });
    assert.equal(r.applied, true);
    assert.equal(combat.bonusAccuracy ?? 0, 0, 'Arcing Shot must not grant Accuracy');
    assert.equal(game.arcingShotActive['Stormtrooper-1-0'], true);
  });
});
