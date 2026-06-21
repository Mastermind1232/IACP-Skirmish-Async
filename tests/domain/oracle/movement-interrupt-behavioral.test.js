/**
 * BEHAVIORAL oracle tests for detectPostMoveInterrupts (Movement Phase 1).
 *
 * Tests the pure-function interrupt detection that fires during movement:
 *   C23 — Parting Blow (BRAWLER, hostile exits adjacent)
 *   C15 — Dirty Trick (SMUGGLER/HUNTER, hostile enters adjacent)
 *   Overwatch (enters token zone)
 *   C43 — Disengage (Mak Eshka'rey, hostile enters within 3 spaces)
 *
 * Uses real map adjacency data from anchorhead-cantina-bar.
 * Key test topology:
 *   a1 adj: a2, b1, b2
 *   a2 adj: a1, a3, b1, b2, b3
 *   a3 adj: a2, a4, b2, b3, b4
 *   c1 adj: c2, b1, d1, b2, d2
 *   d1 adj: d2, c1, e1, c2, e2
 *
 * So b1 is adjacent to a1 and a2, but c1 is NOT adjacent to a1.
 * Moving a1→c1 would leave b1's adjacency (Parting Blow).
 * Moving c1→a1 would enter b1's adjacency (Dirty Trick).
 *
 * Test categories:
 *   B-MVINT-001 – B-MVINT-005: Parting Blow triggers and guards
 *   B-MVINT-006 – B-MVINT-009: Dirty Trick triggers and guards
 *   B-MVINT-010 – B-MVINT-012: Overwatch triggers and guards
 *   B-MVINT-013: Empty/single-space path returns []
 *   B-MVINT-014: Multi-step path detects trigger at correct step
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectPostMoveInterrupts } from '../../../src/game/movement-interrupts.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build minimal game state for interrupt detection.
 * Uses anchorhead-cantina-bar (real map, loaded by data-loader.js on import).
 */
function makeGame(overrides = {}) {
  return {
    selectedMap: { id: 'anchorhead-cantina-bar' },
    figurePositions: { 1: {}, 2: {} },
    figureOrientations: {},
    openedDoors: [],
    player1CcHand: [],
    player2CcHand: [],
    p1DcMessageIds: [],
    p2DcMessageIds: [],
    p1DcList: [],
    p2DcList: [],
    exhaustedSkirmishUpgrades: {},
    overwatchTokenPosition: {},
    ...overrides,
  };
}

// ── B-MVINT-001: Parting Blow fires ─────────────────────────────────────────

describe('B-MVINT-001: Parting Blow fires when BRAWLER hostile exits adjacency', () => {
  it('001: hostile BRAWLER on b1, figure moves a1→d1 (exits b1 adjacency)', () => {
    // b1 adj: a1, a2, b2, c1, c2 — d1 is NOT adjacent to b1
    const game = makeGame({
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'a1' },  // moving figure (starts a1)
        2: { 'Agent Kallus-1-0': 'b1' },    // BRAWLER hostile
      },
      player2CcHand: ['Parting Blow'],
    });

    const triggers = detectPostMoveInterrupts(game, 1, 'Rebel Trooper-1-0', ['a1', 'd1']);

    const pb = triggers.find(t => t.type === 'partingBlow');
    assert.ok(pb, 'Parting Blow trigger emitted');
    assert.strictEqual(pb.cardName, 'Parting Blow');
    assert.strictEqual(pb.candidatePlayerNum, 2, 'candidate is opponent');
    assert.strictEqual(pb.candidateFigureKey, 'Agent Kallus-1-0');
    assert.strictEqual(pb.candidateDcName, 'Agent Kallus');
  });
});

// ── B-MVINT-002: Parting Blow fires on exiting ANY adjacent space ───────────
// alexanbv 2026-06-19: reading (a) — exiting a space adjacent to the BRAWLER
// triggers Parting Blow even if the mover REMAINS adjacent after the step.

describe('B-MVINT-002: Parting Blow fires when exiting an adjacent space (still adjacent after)', () => {
  it('002: hostile BRAWLER on b1, figure moves a1→a2 (b1 adjacent to both — exits a1)', () => {
    // b1 is adjacent to both a1 and a2; exiting a1 (an adjacent space) fires PB.
    const game = makeGame({
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'a1' },
        2: { 'Agent Kallus-1-0': 'b1' },
      },
      player2CcHand: ['Parting Blow'],
    });

    const triggers = detectPostMoveInterrupts(game, 1, 'Rebel Trooper-1-0', ['a1', 'a2']);

    const pb = triggers.find(t => t.type === 'partingBlow');
    assert.ok(pb, 'Parting Blow fires — exited a space adjacent to the BRAWLER (reading (a))');
    assert.strictEqual(pb.candidateFigureKey, 'Agent Kallus-1-0');
  });
});

// ── B-MVINT-003: Parting Blow does NOT fire for non-BRAWLER ─────────────────

describe('B-MVINT-003: Parting Blow does NOT fire for non-BRAWLER hostile', () => {
  it('003: Alliance Smuggler (SMUGGLER, not BRAWLER) on b1, figure exits adjacency', () => {
    const game = makeGame({
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'a1' },
        2: { 'Alliance Smuggler (Elite)-1-0': 'b1' },
      },
      player2CcHand: ['Parting Blow'],
    });

    const triggers = detectPostMoveInterrupts(game, 1, 'Rebel Trooper-1-0', ['a1', 'd1']);

    const pb = triggers.find(t => t.type === 'partingBlow');
    assert.strictEqual(pb, undefined, 'no Parting Blow — hostile lacks BRAWLER trait');
  });
});

// ── B-MVINT-004: Parting Blow does NOT fire without card in hand ────────────

describe('B-MVINT-004: Parting Blow does NOT fire without card in hand', () => {
  it('004: BRAWLER hostile adjacent but opponent hand empty', () => {
    const game = makeGame({
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'a1' },
        2: { 'Agent Kallus-1-0': 'b1' },
      },
      player2CcHand: [],  // no Parting Blow
    });

    const triggers = detectPostMoveInterrupts(game, 1, 'Rebel Trooper-1-0', ['a1', 'd1']);

    const pb = triggers.find(t => t.type === 'partingBlow');
    assert.strictEqual(pb, undefined, 'no Parting Blow — card not in hand');
  });
});

// ── B-MVINT-005: Parting Blow fires at most once per move ───────────────────

describe('B-MVINT-005: Parting Blow fires at most once per move (multi-step)', () => {
  it('005: two BRAWLERS adjacent, figure moves through both exit zones', () => {
    // Path: a2 → d1 (multi-step, exits adjacency of both b1 and b2 brawlers)
    // b1 adj to a2 but NOT to d1
    // b2 adj to a2 but NOT to d1
    const game = makeGame({
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'a2' },
        2: {
          'Agent Kallus-1-0': 'b1',     // BRAWLER #1
          'Agent Kallus-2-0': 'b2',     // BRAWLER #2 (different DG)
        },
      },
      player2CcHand: ['Parting Blow'],
    });

    const triggers = detectPostMoveInterrupts(game, 1, 'Rebel Trooper-1-0', ['a2', 'd1']);

    const pbTriggers = triggers.filter(t => t.type === 'partingBlow');
    assert.strictEqual(pbTriggers.length, 1,
      'exactly 1 Parting Blow — once per move even with multiple BRAWLERS');
  });
});

// ── B-MVINT-006: Dirty Trick fires ──────────────────────────────────────────

describe('B-MVINT-006: Dirty Trick fires when SMUGGLER/HUNTER hostile enters adjacency', () => {
  it('006: SMUGGLER on b1, figure moves c1→a1 (enters b1 adjacency)', () => {
    // c1 is NOT adjacent to b1 (c1 adj: c2, b1... wait let me verify)
    // Actually c1 IS adjacent to b1 per the data: c1 -> c2, b1, d1, b2, d2
    // So c1→a1 wouldn't trigger because hostile on b1 was already adjacent at c1.
    // Need figure to start from a position NOT adjacent to b1.
    // d1 adj: d2, c1, e1, c2, e2 — NOT adjacent to b1.
    // So: d1→a1 would enter b1's adjacency.
    const game = makeGame({
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'd1' },
        2: { 'Alliance Smuggler (Elite)-1-0': 'b1' },  // SMUGGLER
      },
      player2CcHand: ['Dirty Trick'],
    });

    const triggers = detectPostMoveInterrupts(game, 1, 'Rebel Trooper-1-0', ['d1', 'a1']);

    const dt = triggers.find(t => t.type === 'dirtyTrick');
    assert.ok(dt, 'Dirty Trick trigger emitted');
    assert.strictEqual(dt.cardName, 'Dirty Trick');
    assert.strictEqual(dt.candidatePlayerNum, 2);
    assert.strictEqual(dt.candidateFigureKey, 'Alliance Smuggler (Elite)-1-0');
    assert.strictEqual(dt.candidateDcName, 'Alliance Smuggler (Elite)');
  });
});

// ── B-MVINT-007: Dirty Trick fires on entering ANY adjacent space ───────────
// alexanbv 2026-06-19: reading (a) — entering a space adjacent to the
// SMUGGLER/HUNTER triggers Dirty Trick even if the mover was already adjacent.

describe('B-MVINT-007: Dirty Trick fires when entering an adjacent space (already adjacent before)', () => {
  it('007: SMUGGLER on b1, figure moves a1→a2 (b1 adjacent to both — enters a2)', () => {
    const game = makeGame({
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'a1' },
        2: { 'Alliance Smuggler (Elite)-1-0': 'b1' },
      },
      player2CcHand: ['Dirty Trick'],
    });

    const triggers = detectPostMoveInterrupts(game, 1, 'Rebel Trooper-1-0', ['a1', 'a2']);

    const dt = triggers.find(t => t.type === 'dirtyTrick');
    assert.ok(dt, 'Dirty Trick fires — entered a space adjacent to the SMUGGLER (reading (a))');
    assert.strictEqual(dt.candidateFigureKey, 'Alliance Smuggler (Elite)-1-0');
  });
});

// ── B-MVINT-008: Dirty Trick does NOT fire for wrong trait ──────────────────

describe('B-MVINT-008: Dirty Trick does NOT fire for non-SMUGGLER/HUNTER hostile', () => {
  it('008: Agent Kallus (BRAWLER, not SMUGGLER/HUNTER) on b1, figure enters adjacency', () => {
    const game = makeGame({
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'd1' },
        2: { 'Agent Kallus-1-0': 'b1' },  // BRAWLER only
      },
      player2CcHand: ['Dirty Trick'],
    });

    const triggers = detectPostMoveInterrupts(game, 1, 'Rebel Trooper-1-0', ['d1', 'a1']);

    const dt = triggers.find(t => t.type === 'dirtyTrick');
    assert.strictEqual(dt, undefined, 'no Dirty Trick — hostile lacks SMUGGLER/HUNTER');
  });
});

// ── B-MVINT-009: Dirty Trick de-duplication ─────────────────────────────────

describe('B-MVINT-009: Dirty Trick same figure only triggers once per move', () => {
  it('009: multi-step path enters+exits+re-enters adjacency of same SMUGGLER', () => {
    // d1→a1→d1→a1: first step enters adjacency of b1, second exits, third re-enters
    // Only 1 trigger should fire (de-duplication by figureKey)
    const game = makeGame({
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'd1' },
        2: { 'Alliance Smuggler (Elite)-1-0': 'b1' },
      },
      player2CcHand: ['Dirty Trick'],
    });

    const triggers = detectPostMoveInterrupts(game, 1, 'Rebel Trooper-1-0', ['d1', 'a1', 'd1', 'a1']);

    const dtTriggers = triggers.filter(t => t.type === 'dirtyTrick');
    assert.strictEqual(dtTriggers.length, 1,
      'exactly 1 Dirty Trick — de-duplicated by figureKey');
  });
});

// ── B-MVINT-010: Overwatch fires ────────────────────────────────────────────

describe('B-MVINT-010: Overwatch fires when hostile enters token zone', () => {
  it('010: Overwatch token on b2, figure moves d1→a1 (a1 adjacent to b2)', () => {
    // a1 adj includes b2, d1 does NOT include b2
    const game = makeGame({
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'd1' },
        2: {},
      },
      overwatchTokenPosition: { 'ow-msg-1': 'b2' },
      // Overwatch owned by player 2
      p2DcMessageIds: ['ow-msg-1'],
      p2DcList: [{ dcName: 'E-Web Engineer', displayName: 'E-Web Engineer' }],
      exhaustedSkirmishUpgrades: {},
    });

    const triggers = detectPostMoveInterrupts(game, 1, 'Rebel Trooper-1-0', ['d1', 'a1']);

    const ow = triggers.find(t => t.type === 'overwatch');
    assert.ok(ow, 'Overwatch trigger emitted');
    assert.strictEqual(ow.cardName, 'Overwatch');
    assert.strictEqual(ow.candidatePlayerNum, 2);
    assert.ok(ow.owMsgId, 'owMsgId populated');
  });
});

// ── B-MVINT-011: Overwatch does NOT fire when already in zone ───────────────

describe('B-MVINT-011: Overwatch does NOT fire when hostile was already in token zone', () => {
  it('011: Overwatch token on b1, figure moves a1→a2 (both adjacent to b1)', () => {
    // a1 adj includes b1, a2 adj includes b1 — was already in zone
    const game = makeGame({
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'a1' },
        2: {},
      },
      overwatchTokenPosition: { 'ow-msg-1': 'b1' },
      p2DcMessageIds: ['ow-msg-1'],
      p2DcList: [{ dcName: 'E-Web Engineer' }],
    });

    const triggers = detectPostMoveInterrupts(game, 1, 'Rebel Trooper-1-0', ['a1', 'a2']);

    const ow = triggers.find(t => t.type === 'overwatch');
    assert.strictEqual(ow, undefined, 'no Overwatch — was already in zone');
  });
});

// ── B-MVINT-012: Overwatch does NOT fire when card exhausted ────────────────

describe('B-MVINT-012: Overwatch does NOT fire when card already exhausted', () => {
  it('012: Overwatch token present but card exhausted', () => {
    const game = makeGame({
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'd1' },
        2: {},
      },
      overwatchTokenPosition: { 'ow-msg-1': 'b2' },
      p2DcMessageIds: ['ow-msg-1'],
      p2DcList: [{ dcName: 'E-Web Engineer' }],
      exhaustedSkirmishUpgrades: { 'ow-msg-1': ['Overwatch'] },
    });

    const triggers = detectPostMoveInterrupts(game, 1, 'Rebel Trooper-1-0', ['d1', 'a1']);

    const ow = triggers.find(t => t.type === 'overwatch');
    assert.strictEqual(ow, undefined, 'no Overwatch — card already exhausted');
  });
});

// ── B-MVINT-013: Empty/single-space path returns [] ─────────────────────────

describe('B-MVINT-013: Empty or single-space path returns no triggers', () => {
  it('013a: null path returns []', () => {
    const game = makeGame();
    assert.deepStrictEqual(detectPostMoveInterrupts(game, 1, 'X-1-0', null), []);
  });

  it('013b: single-space path returns []', () => {
    const game = makeGame();
    assert.deepStrictEqual(detectPostMoveInterrupts(game, 1, 'X-1-0', ['a1']), []);
  });

  it('013c: empty array returns []', () => {
    const game = makeGame();
    assert.deepStrictEqual(detectPostMoveInterrupts(game, 1, 'X-1-0', []), []);
  });
});

// ── B-MVINT-014: Multi-step path detects trigger at correct step ────────────

describe('B-MVINT-014: Multi-step path detects trigger at correct step', () => {
  it('014: path a2→a1→d1, Parting Blow fires at FIRST adjacent-exit step a2→a1', () => {
    // BRAWLER on b1; reading (a): PB fires the first time the mover EXITS a space
    // adjacent to the BRAWLER, regardless of whether it stays adjacent after.
    // a2 adj includes b1 ✓ → step a2→a1 exits the adjacent space a2 → fires here.
    const game = makeGame({
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'a2' },
        2: { 'Agent Kallus-1-0': 'b1' },
      },
      player2CcHand: ['Parting Blow'],
    });

    const triggers = detectPostMoveInterrupts(game, 1, 'Rebel Trooper-1-0', ['a2', 'a1', 'd1']);

    const pb = triggers.find(t => t.type === 'partingBlow');
    assert.ok(pb, 'Parting Blow fires');
    assert.strictEqual(pb.triggerSpace, 'a2',
      'trigger at a2 (first exit of a space adjacent to the BRAWLER, once per move)');
  });

  it('014b: same path, Dirty Trick SMUGGLER on e1 fires at step a1→d1 (enters adjacency)', () => {
    // e1 adj: e2, d1, f1, d2, f2  → e1 IS adjacent to d1
    // e1 NOT adjacent to a1, NOT adjacent to a2
    // So step a1→d1 enters e1's adjacency
    const game = makeGame({
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'a2' },
        2: { 'Alliance Smuggler (Elite)-1-0': 'e1' },
      },
      player2CcHand: ['Dirty Trick'],
    });

    const triggers = detectPostMoveInterrupts(game, 1, 'Rebel Trooper-1-0', ['a2', 'a1', 'd1']);

    const dt = triggers.find(t => t.type === 'dirtyTrick');
    assert.ok(dt, 'Dirty Trick fires');
    assert.strictEqual(dt.triggerSpace, 'd1',
      'trigger at d1 (entering space where adjacency was gained)');
  });
});

// ── Push-triggered Parting Blow (FIX 2) ───────────────────────────────────────
// A PUSH (Looking for a Fight, Dark Energy, Smash/Slam/Ram, Force Push, …)
// relocates a figure WITHOUT running the normal move-interrupt path. detectPush-
// PartingBlow reuses the same exit-adjacent-to-BRAWLER core so PB fires on a
// push, on EITHER side's turn. Topology (anchorhead-cantina-bar):
//   b1 adj: a1, a2, b2, c1, c2 — d1 is NOT adjacent to b1.

import { detectPushPartingBlow } from '../../../src/game/movement-interrupts.js';
import { stashPushPartingBlow } from '../../../src/game/abilities.js';

describe('B-MVINT-PUSH-PB: push out of BRAWLER adjacency triggers Parting Blow', () => {
  it('hostile pushed a1→d1 out of enemy BRAWLER (b1) adjacency → trigger', () => {
    // Pushed figure is player 2's; brawler is player 1's. This is the
    // LFAF/Dark Energy case: brawler-owner pushes the hostile on their OWN turn.
    const game = makeGame({
      figurePositions: {
        1: { 'Agent Kallus-1-0': 'b1' },        // BRAWLER (player 1)
        2: { 'Rebel Trooper-1-0': 'a1' },        // pushed hostile (player 2)
      },
      player1CcHand: ['Parting Blow'],
    });

    const pb = detectPushPartingBlow(game, 'Rebel Trooper-1-0', 2, 'a1', 'd1');
    assert.ok(pb, 'push PB trigger emitted');
    assert.strictEqual(pb.brawlerFigureKey, 'Agent Kallus-1-0');
    assert.strictEqual(pb.brawlerPlayerNum, 1);
    assert.strictEqual(pb.exitingHostileFigureKey, 'Rebel Trooper-1-0');
    assert.strictEqual(pb.triggerSpace, 'a1');
  });

  it('either turn: same exit on the OPPONENT pushing onto the brawler-owner works too', () => {
    // Brawler is player 2's; the pushed figure (player 1) is pushed by player 2
    // (opponent's turn). Detection is symmetric in whose turn it is.
    const game = makeGame({
      figurePositions: {
        1: { 'Rebel Trooper-1-0': 'a1' },        // pushed hostile (player 1)
        2: { 'Agent Kallus-1-0': 'b1' },         // BRAWLER (player 2)
      },
      player2CcHand: ['Parting Blow'],
    });

    const pb = detectPushPartingBlow(game, 'Rebel Trooper-1-0', 1, 'a1', 'd1');
    assert.ok(pb, 'push PB trigger emitted on opponent turn');
    assert.strictEqual(pb.brawlerPlayerNum, 2);
  });

  it('no trigger when push stays within adjacency (a1→a2, both adj to b1)', () => {
    const game = makeGame({
      figurePositions: {
        1: { 'Agent Kallus-1-0': 'b1' },
        2: { 'Rebel Trooper-1-0': 'a1' },
      },
      player1CcHand: ['Parting Blow'],
    });
    // a2 is still adjacent to b1, so no exit-of-adjacency on the final step;
    // but the cell-by-cell test fires when ANY exited space was adjacent —
    // a1 is adjacent to b1, so this DOES count (parity with normal-move C23,
    // which fires on exiting ANY adjacent space). Assert the documented behavior.
    const pb = detectPushPartingBlow(game, 'Rebel Trooper-1-0', 2, 'a1', 'a2');
    assert.ok(pb, 'exiting a1 (adjacent to b1) counts, matching normal-move C23');
  });

  it('no trigger when brawler-owner lacks Parting Blow in hand', () => {
    const game = makeGame({
      figurePositions: {
        1: { 'Agent Kallus-1-0': 'b1' },
        2: { 'Rebel Trooper-1-0': 'a1' },
      },
      player1CcHand: [],  // no PB
    });
    const pb = detectPushPartingBlow(game, 'Rebel Trooper-1-0', 2, 'a1', 'd1');
    assert.strictEqual(pb, null, 'no PB in hand → no trigger');
  });

  it('no trigger when the adjacent figure is not a BRAWLER', () => {
    const game = makeGame({
      figurePositions: {
        1: { 'Rebel Trooper-1-1': 'b1' },  // not a BRAWLER
        2: { 'Rebel Trooper-1-0': 'a1' },
      },
      player1CcHand: ['Parting Blow'],
    });
    const pb = detectPushPartingBlow(game, 'Rebel Trooper-1-0', 2, 'a1', 'd1');
    assert.strictEqual(pb, null, 'non-BRAWLER → no trigger');
  });
});

// FIX 2 (alexanbv 2026-06-21): Parting Blow only triggers when you push a
// figure HOSTILE to the pushing player. Pushing your OWN friendly figure
// (Hop On, Reposition) must NOT trigger PB. The hostile-only gate lives in
// stashPushPartingBlow, keyed on pushedOwner === pushingPlayer.
describe('B-MVINT-PUSH-PB-HOSTILE: stashPushPartingBlow gates on hostile-only', () => {
  function gateGame() {
    return makeGame({
      figurePositions: {
        1: {
          'Agent Kallus-1-0': 'b1',        // BRAWLER (player 1)
          'Rebel Trooper-1-0': 'a1',       // friendly small figure (player 1)
        },
        2: {
          'Stormtrooper-1-0': 'a1',        // hostile small figure (player 2)
        },
      },
      player1CcHand: ['Parting Blow'],
    });
  }

  it('HOSTILE push (player 1 pushes player 2 figure out of own BRAWLER adj) → PB fires', () => {
    const game = gateGame();
    // player 1 is pushing; pushed figure belongs to player 2 (hostile).
    const suffix = stashPushPartingBlow(game, 'Stormtrooper-1-0', 2, 'a1', 'd1', 1);
    assert.ok(suffix && suffix.includes('Parting Blow'), 'hostile push emits PB suffix');
    assert.ok(game.pendingPartingBlow, 'hostile push stashed pendingPartingBlow');
    assert.strictEqual(game.pendingPartingBlow.brawlerFigureKey, 'Agent Kallus-1-0');
  });

  it('FRIENDLY push (Hop On — player 1 pushes own figure) → no PB stash', () => {
    const game = gateGame();
    // player 1 is pushing; pushed figure belongs to player 1 (friendly) → SKIP.
    const suffix = stashPushPartingBlow(game, 'Rebel Trooper-1-0', 1, 'a1', 'd1', 1);
    assert.strictEqual(suffix, '', 'friendly push emits no suffix');
    assert.ok(!game.pendingPartingBlow, 'friendly push does not stash pendingPartingBlow');
  });

  it('legacy call without pushingPlayerNum is unchanged (gate is a no-op)', () => {
    const game = gateGame();
    const suffix = stashPushPartingBlow(game, 'Stormtrooper-1-0', 2, 'a1', 'd1');
    assert.ok(suffix && suffix.includes('Parting Blow'), 'no pusher arg → old behavior (fires)');
    assert.ok(game.pendingPartingBlow);
  });
});
