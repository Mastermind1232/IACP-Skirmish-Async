/**
 * PROBE-ATTACHED-DIO: Iden Versio's **Attached** (Dio).
 *
 * Card text: "When Iden Versio exits Dio's space during movement, Dio
 *  may interrupt to move up to 1 space."
 *
 * Phase 2 high-risk probe grind (2026-04-21): atom was structural-only
 * with no library fields and handler-only wiring. Extracted pure helpers
 * (detectAttachedTrigger, applyDioFollow) into src/game/attached-dio-helpers.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectAttachedTrigger, applyDioFollow } from '../../../src/game/attached-dio-helpers.js';
import { isForcedStepByStep } from '../../../src/game/forced-step-movement.js';

const MAP_ID = 'unit-test-grid';

function buildGame({ idenPos = 'a1', dioPos = null } = {}) {
  const p1 = { 'Iden Versio-1-0': idenPos };
  if (dioPos) p1['Dio-1-0'] = dioPos;
  return {
    gameId: 'gadio',
    figurePositions: { 1: p1, 2: {} },
    selectedMap: { id: MAP_ID },
  };
}

describe('PROBE-ATTACHED-DIO-001: trigger requires Iden to leave Dio\'s space', () => {
  it('Iden moves from a1→b1 with Dio on a1 → triggers', () => {
    const game = buildGame({ idenPos: 'b1', dioPos: 'a1' });
    const t = detectAttachedTrigger(game, 1, 'Iden Versio', 'a1', 'b1', ['a1', 'b1']);
    assert.ok(t, 'should trigger');
    assert.equal(t.dioFigureKey, 'Dio-1-0');
    assert.equal(t.dioPos, 'a1');
  });

  it('Iden starts and ends on same space → no trigger', () => {
    const game = buildGame({ idenPos: 'a1', dioPos: 'a1' });
    const t = detectAttachedTrigger(game, 1, 'Iden Versio', 'a1', 'a1', ['a1']);
    assert.equal(t, null);
  });

  it('no startCoord (figure being placed) → no trigger', () => {
    const game = buildGame({ idenPos: 'a1', dioPos: 'a1' });
    assert.equal(detectAttachedTrigger(game, 1, 'Iden Versio', null, 'a1', null), null);
    assert.equal(detectAttachedTrigger(game, 1, 'Iden Versio', undefined, 'a1', null), null);
  });

  it('Dio NOT on Iden\'s starting space → no trigger', () => {
    const game = buildGame({ idenPos: 'b1', dioPos: 'c1' });
    const t = detectAttachedTrigger(game, 1, 'Iden Versio', 'a1', 'b1', ['a1', 'b1']);
    assert.equal(t, null);
  });

  it('moving figure is not Iden → no trigger', () => {
    const game = buildGame({ idenPos: 'b1', dioPos: 'a1' });
    const t = detectAttachedTrigger(game, 1, 'Rebel Trooper', 'a1', 'b1', ['a1', 'b1']);
    assert.equal(t, null);
  });
});

describe('PROBE-ATTACHED-DIO-002: default follow space = path[1] when path present', () => {
  it('path ["a1","b1"] → defaultFollowSpace = "b1"', () => {
    const game = buildGame({ idenPos: 'b1', dioPos: 'a1' });
    const t = detectAttachedTrigger(game, 1, 'Iden Versio', 'a1', 'b1', ['a1', 'b1']);
    assert.equal(t.defaultFollowSpace, 'b1');
  });

  it('multi-step path uses the first step past start', () => {
    const game = buildGame({ idenPos: 'c1', dioPos: 'a1' });
    const t = detectAttachedTrigger(game, 1, 'Iden Versio', 'a1', 'c1', ['a1', 'b1', 'c1']);
    assert.equal(t.defaultFollowSpace, 'b1');
  });

  it('no path → falls back to first adjacency', () => {
    const game = buildGame({ idenPos: 'b1', dioPos: 'a1' });
    const t = detectAttachedTrigger(game, 1, 'Iden Versio', 'a1', 'b1', null);
    assert.ok(t.adjacencies.length > 0, 'a1 should have adjacencies');
    assert.equal(t.defaultFollowSpace, t.adjacencies[0]);
  });
});

describe('PROBE-ATTACHED-DIO-003: no Dio figure → no trigger', () => {
  it('Iden moves but no Dio present', () => {
    const game = buildGame({ idenPos: 'b1', dioPos: null });
    const t = detectAttachedTrigger(game, 1, 'Iden Versio', 'a1', 'b1', ['a1', 'b1']);
    assert.equal(t, null);
  });
});

describe('PROBE-ATTACHED-DIO-004: applyDioFollow mutates game state', () => {
  it('moves Dio to chosen space and returns { from, to }', () => {
    const game = buildGame({ idenPos: 'b1', dioPos: 'a1' });
    const { from, to } = applyDioFollow(game, 'Dio-1-0', 1, 'b1');
    assert.equal(from, 'a1');
    assert.equal(to, 'b1');
    assert.equal(game.figurePositions[1]['Dio-1-0'], 'b1');
  });

  it('handles missing player entry by auto-creating', () => {
    const game = { figurePositions: {} };
    const { from, to } = applyDioFollow(game, 'Dio-1-0', 1, 'a1');
    assert.equal(from, null);
    assert.equal(to, 'a1');
    assert.equal(game.figurePositions[1]['Dio-1-0'], 'a1');
  });
});

describe('PROBE-ATTACHED-DIO-006: Iden is forced step-by-step (alexanbv 2026-06-21)', () => {
  it('Iden Versio is registered as forced step-by-step', () => {
    assert.equal(isForcedStepByStep('Iden Versio'), true);
  });
  it('ordinary figures are NOT forced step-by-step', () => {
    assert.equal(isForcedStepByStep('Rebel Trooper'), false);
    assert.equal(isForcedStepByStep('Dio'), false);
  });
});

describe('PROBE-ATTACHED-DIO-007: Dio chains follow across consecutive Iden steps', () => {
  // Ruling: "Iden moves 1 space, Dio then moves 1 space; if Dio moves to Iden's
  // space, then when Iden moves again Dio can move 1 more space, etc." Because
  // Iden is forced step-by-step, the trigger fires after EACH single-space step.
  it('step 1 fires trigger → Dio follows → step 2 fires trigger again (chain)', () => {
    const game = buildGame({ idenPos: 'a1', dioPos: 'a1' });
    // Step 1: Iden a1 → b1 (one space). Dio is on a1 (Iden's start).
    game.figurePositions[1]['Iden Versio-1-0'] = 'b1';
    const t1 = detectAttachedTrigger(game, 1, 'Iden Versio', 'a1', 'b1', ['a1', 'b1']);
    assert.ok(t1, 'step 1 must offer Dio a follow');
    assert.equal(t1.defaultFollowSpace, 'b1', 'default follow = Iden\'s new space (so Dio can chain)');
    // Dio follows into Iden's new space (b1) — now sharing again.
    applyDioFollow(game, 'Dio-1-0', 1, 'b1');
    assert.equal(game.figurePositions[1]['Dio-1-0'], 'b1');

    // Step 2: Iden b1 → c1 (next single step). Dio is now on b1 (Iden's new start).
    game.figurePositions[1]['Iden Versio-1-0'] = 'c1';
    const t2 = detectAttachedTrigger(game, 1, 'Iden Versio', 'b1', 'c1', ['b1', 'c1']);
    assert.ok(t2, 'step 2 must offer Dio a follow AGAIN (chain re-arms each step)');
    assert.equal(t2.defaultFollowSpace, 'c1');
  });

  it('Dio following is OPTIONAL — if Dio stays, the next step does not re-trigger', () => {
    const game = buildGame({ idenPos: 'a1', dioPos: 'a1' });
    // Step 1: Iden a1 → b1. Dio offered a follow but STAYS on a1.
    game.figurePositions[1]['Iden Versio-1-0'] = 'b1';
    const t1 = detectAttachedTrigger(game, 1, 'Iden Versio', 'a1', 'b1', ['a1', 'b1']);
    assert.ok(t1);
    // Dio declines (stays on a1).
    // Step 2: Iden b1 → c1. Dio is on a1, NOT on Iden's new start (b1) → no trigger.
    game.figurePositions[1]['Iden Versio-1-0'] = 'c1';
    const t2 = detectAttachedTrigger(game, 1, 'Iden Versio', 'b1', 'c1', ['b1', 'c1']);
    assert.equal(t2, null, 'Dio that stayed behind cannot follow on later steps (it is no longer on Iden\'s space)');
  });
});

describe('PROBE-ATTACHED-DIO-005: library entry wired', () => {
  it('attached_dio entry exists with expected label', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'));
    const entry = lib.abilities?.attached_dio;
    assert.ok(entry, 'attached_dio must exist');
    assert.equal(entry.wiredStatus, 'wired');
    assert.equal(entry.label, 'Attached');
  });
});
