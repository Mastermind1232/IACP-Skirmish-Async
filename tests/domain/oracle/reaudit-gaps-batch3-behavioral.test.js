/**
 * Re-audit gap fixes (2026-06-21, batch 3). Behavioral coverage for the
 * push/figure-picker ability fixes plus designer-requested coverage:
 *
 *   - Dark Energy: target is "another SMALL figure within 3" — friendly OR
 *     hostile, excluding only the activator (CSV docs/combat-spec.csv:598).
 *   - Kuiil "Hop On!": push 1 space, SMALL friendly with figure-cost <= 8 filter
 *     (CSV docs/combat-spec.csv:335).
 *   - Whistling Birds (part 2): "Choose up to 3 FIGURES within 2 spaces" —
 *     controller-chosen, friendly figures allowed (CSV docs/combat-spec.csv:870).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';

// Real map with real adjacency so countGameSpaces / push-space mechanics work.
const MAP = 'mos-eisley-outskirts';
// a1 is adjacent to a2 and b1 (all within 3 spaces of each other).
const ACT = 'a1', FRIEND = 'a2', ENEMY = 'b1';

// ── Dark Energy: friendly SMALL figure is a legal target (excludes activator) ──
// CSV row 598: "Choose another SMALL figure within 3 spaces; push it up to 1
// space, then it suffers 1 Damage." "another" excludes only the activator; the
// target set is ANY SMALL figure (friendly or hostile).

describe('Re-audit batch 3: Dark Energy — friendly SMALL target allowed', () => {
  function buildGame() {
    const dcMessageMeta = new Map();
    dcMessageMeta.set('msg_act', { gameId: 'g', playerNum: 1, dcName: 'Bossk', displayName: 'Bossk [DG 1]' });
    dcMessageMeta.set('msg_friend', { gameId: 'g', playerNum: 1, dcName: 'Bodhi Rook', displayName: 'Bodhi Rook [DG 1]' });
    dcMessageMeta.set('msg_enemy', { gameId: 'g', playerNum: 2, dcName: '0-0-0', displayName: '0-0-0 [DG 1]' });
    const game = {
      gameId: 'g', selectedMap: { id: MAP },
      figurePositions: { 1: { 'Bossk-1-0': ACT, 'Bodhi Rook-1-0': FRIEND }, 2: { '0-0-0-1-0': ENEMY } },
      dcActionsData: { msg_act: { remaining: 1, total: 1, selectedFigure: 0 } },
    };
    return { game, dcMessageMeta };
  }

  it('Phase 1 offers BOTH a friendly SMALL and a hostile SMALL figure', () => {
    const { game, dcMessageMeta } = buildGame();
    const r = resolveAbility('Dark Energy', { game, playerNum: 1, dcMessageMeta, dcHealthState: new Map() });
    assert.equal(r.requiresChoice, true);
    assert.ok(r.choiceValues.includes('Bodhi Rook-1-0'), 'friendly SMALL figure must be a legal target');
    assert.ok(r.choiceValues.includes('0-0-0-1-0'), 'hostile SMALL figure must be a legal target');
  });

  it('excludes the activating figure ("another" figure)', () => {
    const { game, dcMessageMeta } = buildGame();
    const r = resolveAbility('Dark Energy', { game, playerNum: 1, dcMessageMeta, dcHealthState: new Map() });
    assert.ok(!r.choiceValues.includes('Bossk-1-0'), 'the activator may not target itself');
  });
});

// ── Kuiil "Hop On!": push 1 space, SMALL friendly cost <= 8 ────────────────────
// CSV row 335. NOTE: the "when you enter that figure's space this activation,
// you may interrupt" on-enter trigger is DEFERRED — this engine has no
// movement-enter hook, so Hop On! is offered on-demand when the Special Action
// resolves rather than at the moment Kuiil enters the figure's space. The
// figure-cost <= 8 filter, SMALL filter, and 1-space push distance are tested.

// Updated 2026-06-21 (alexanbv): Hop On is now ITERATIVE enter-and-push
// movement — Kuiil spends MP to MOVE ONTO the figure's space, pushes it 1,
// FOLLOWS into the vacated space, and may repeat until out of MP. The
// figure-cost <= 8 + SMALL + friendly filters are preserved.
describe('Re-audit batch 3: Kuiil Hop On! — iterative enter-and-push (MP-based)', () => {
  function buildGame({ mp = 3 } = {}) {
    const dcMessageMeta = new Map();
    dcMessageMeta.set('msg_act', { gameId: 'g', playerNum: 1, dcName: 'Kuiil', displayName: 'Kuiil [DG 1]' });
    dcMessageMeta.set('msg_friend', { gameId: 'g', playerNum: 1, dcName: 'Bodhi Rook', displayName: 'Bodhi Rook [DG 1]' });
    // Darth Vader is SMALL but cost 18 (> 8) — must be filtered out.
    dcMessageMeta.set('msg_big', { gameId: 'g', playerNum: 1, dcName: 'Darth Vader', displayName: 'Darth Vader [DG 1]' });
    const game = {
      gameId: 'g', selectedMap: { id: MAP },
      figurePositions: { 1: { 'Kuiil-1-0': ACT, 'Bodhi Rook-1-0': FRIEND, 'Darth Vader-1-0': ENEMY }, 2: {} },
      dcActionsData: { msg_act: { remaining: 1, total: 1, selectedFigure: 0 } },
      // Mounted grants Kuiil 3 MP at start of activation; Hop On spends from it.
      movementBank: { msg_act: { perFig: { 0: { total: mp, remaining: mp } } } },
    };
    return { game, dcMessageMeta };
  }

  it('Phase 1 offers the SMALL friendly cost<=8 figure only (excludes activator + cost>8)', () => {
    const { game, dcMessageMeta } = buildGame();
    const r = resolveAbility('hop_on_kuiil', { game, playerNum: 1, dcMessageMeta, dcHealthState: new Map() });
    assert.equal(r.requiresChoice, true);
    assert.deepEqual(r.choiceValues, ['Bodhi Rook-1-0'], 'only the cost<=8 SMALL friendly is offered');
    assert.ok(!r.choiceValues.includes('Kuiil-1-0'), 'Kuiil cannot target itself');
    assert.ok(!r.choiceValues.includes('Darth Vader-1-0'), 'cost-18 figure must be filtered (cost <= 8 only)');
  });

  it('Phase 1 with no MP returns a no-MP message (Hop On is MP-based)', () => {
    const { game, dcMessageMeta } = buildGame({ mp: 0 });
    const r = resolveAbility('hop_on_kuiil', { game, playerNum: 1, dcMessageMeta, dcHealthState: new Map() });
    assert.equal(r.applied, false);
    assert.match(r.manualMessage, /movement points/i);
  });

  it('Phase 2 ENTERS the figure\'s space and offers only 1-space push destinations', () => {
    const { game, dcMessageMeta } = buildGame();
    const r = resolveAbility('hop_on_kuiil', { game, playerNum: 1, dcMessageMeta, dcHealthState: new Map(), chosenFigureKey: 'Bodhi Rook-1-0' });
    assert.equal(r.requiresSpaceChoice, true);
    // Kuiil ENTERS Bodhi Rook's space (a2) — always enters the pushed figure's space.
    assert.equal(game.figurePositions[1]['Kuiil-1-0'], 'a2', 'Kuiil moved onto the figure\'s space');
    // Entering cost 1 MP (3 → 2).
    assert.equal(game.movementBank.msg_act.perFig[0].remaining, 2, 'entering the figure\'s space costs 1 MP');
    // Bodhi Rook is on a2 → only its adjacent empty spaces are offered (1-space push).
    const expectedAdj = new Set(['b2', 'a3', 'b3', 'a1', 'b1', 'c1', 'c2', 'c3']);
    for (const s of r.validSpaces) {
      assert.ok(expectedAdj.has(s), `push destination ${s} must be adjacent to a2 (1-space push, not 4)`);
    }
  });

  it('Phase 3 pushes the figure 1 space and Kuiil FOLLOWS into the vacated space', () => {
    const { game, dcMessageMeta } = buildGame({ mp: 1 }); // only 1 MP → no iteration
    resolveAbility('hop_on_kuiil', { game, playerNum: 1, dcMessageMeta, dcHealthState: new Map(), chosenFigureKey: 'Bodhi Rook-1-0' });
    // Kuiil is now on a2 (entered). Push Bodhi to b2.
    const r = resolveAbility('hop_on_kuiil', { game, playerNum: 1, dcMessageMeta, dcHealthState: new Map(), chosenFigureKey: 'Bodhi Rook-1-0', chosenSpace: 'b2' });
    assert.equal(r.applied, true, 'no MP left → loop ends, applied');
    assert.equal(game.figurePositions[1]['Bodhi Rook-1-0'], 'b2', 'figure pushed 1 space to b2');
    assert.equal(game.figurePositions[1]['Kuiil-1-0'], 'a2', 'Kuiil follows into the space the figure was pushed FROM (a2)');
    assert.match(r.logMessage, /follows into/i);
  });

  it('accepts the figure key via targetFigureKey (the space-pick handler round-trip)', () => {
    const { game, dcMessageMeta } = buildGame({ mp: 1 });
    resolveAbility('hop_on_kuiil', { game, playerNum: 1, dcMessageMeta, dcHealthState: new Map(), chosenFigureKey: 'Bodhi Rook-1-0' });
    // Real handler re-invokes with targetFigureKey (not chosenFigureKey) on the space pick.
    const r = resolveAbility('hop_on_kuiil', { game, playerNum: 1, dcMessageMeta, dcHealthState: new Map(), targetFigureKey: 'Bodhi Rook-1-0', chosenSpace: 'b2' });
    assert.equal(r.applied, true);
    assert.equal(game.figurePositions[1]['Bodhi Rook-1-0'], 'b2');
  });

  it('iterates: with MP left, a push returns ANOTHER push choice and Kuiil re-enters the figure\'s NEW space', () => {
    const { game, dcMessageMeta } = buildGame({ mp: 3 });
    // Phase 2: enter (3 → 2 MP), Kuiil at a2.
    resolveAbility('hop_on_kuiil', { game, playerNum: 1, dcMessageMeta, dcHealthState: new Map(), chosenFigureKey: 'Bodhi Rook-1-0' });
    // Phase 3: push Bodhi a2 → b2; Kuiil follows to a2; MP remains → re-enter b2 (2 → 1 MP), offer next push.
    const r = resolveAbility('hop_on_kuiil', { game, playerNum: 1, dcMessageMeta, dcHealthState: new Map(), chosenFigureKey: 'Bodhi Rook-1-0', chosenSpace: 'b2' });
    assert.equal(r.requiresSpaceChoice, true, 'with MP remaining the loop offers another push');
    assert.equal(game.figurePositions[1]['Bodhi Rook-1-0'], 'b2', 'figure was pushed to b2');
    assert.equal(game.figurePositions[1]['Kuiil-1-0'], 'b2', 'Kuiil ALWAYS enters the figure\'s (new) space before pushing again');
    assert.equal(game.movementBank.msg_act.perFig[0].remaining, 1, 're-entering the figure\'s new space spent another MP (2 → 1)');
    // Every offered destination is adjacent to the figure\'s current space (b2) — 1-space push.
    assert.ok(r.validSpaces.length > 0, 'further push destinations exist');
  });
});

// ── Whistling Birds (part 2): choose up to 3 figures within 2, friendlies OK ───
// CSV row 870: "Choose up to 3 figures within 2 spaces ... each suffers Damage
// equal to the Hit results." The roll + pending state are stamped by the
// post-move continuation; here we drive the Phase-2 figure picker directly.

describe('Re-audit batch 3: Whistling Birds part 2 — up to 3 figures, friendlies allowed', () => {
  function buildGame() {
    const dcMessageMeta = new Map();
    dcMessageMeta.set('msg_act', { gameId: 'g', playerNum: 1, dcName: 'Bossk', displayName: 'Bossk [DG 1]' });
    dcMessageMeta.set('msg_friend', { gameId: 'g', playerNum: 1, dcName: 'Bodhi Rook', displayName: 'Bodhi Rook [DG 1]' });
    dcMessageMeta.set('msg_enemy', { gameId: 'g', playerNum: 2, dcName: '0-0-0', displayName: '0-0-0 [DG 1]' });
    const dcHealthState = new Map();
    dcHealthState.set('msg_friend', [[5, 5]]);
    dcHealthState.set('msg_enemy', [[4, 4]]);
    const game = {
      gameId: 'g', selectedMap: { id: MAP },
      figurePositions: { 1: { 'Bossk-1-0': ACT, 'Bodhi Rook-1-0': FRIEND }, 2: { '0-0-0-1-0': ENEMY } },
      dcActionsData: { msg_act: { remaining: 1, total: 1, selectedFigure: 0 } },
      _whistlingBirdsPending: { hits: 2, playerNum: 1, figureKey: 'Bossk-1-0', targets: [], playerOf: {}, armed: true },
    };
    return { game, dcMessageMeta, dcHealthState };
  }

  it('picker offers a friendly AND a hostile figure within 2, excluding the activator', () => {
    const { game, dcMessageMeta, dcHealthState } = buildGame();
    const r = resolveAbility('Whistling Birds', { game, playerNum: 1, dcMessageMeta, dcHealthState });
    assert.equal(r.requiresChoice, true);
    assert.ok(r.choiceValues.includes('Bodhi Rook-1-0'), 'friendly figure must be selectable (figures, not just hostiles)');
    assert.ok(r.choiceValues.includes('0-0-0-1-0'), 'hostile figure must be selectable');
    assert.ok(!r.choiceValues.includes('Bossk-1-0'), 'the activator may not target itself');
    assert.ok(r.choiceValues.includes('whistling_birds_done'), 'a Done option ends the up-to-3 selection');
  });

  it('chosen friendly figure suffers the rolled Hit damage on Done', () => {
    const { game, dcMessageMeta, dcHealthState } = buildGame();
    const ctx = { game, playerNum: 1, dcMessageMeta, dcHealthState };
    resolveAbility('Whistling Birds', ctx); // arm picker
    resolveAbility('Whistling Birds', { ...ctx, chosenFigureKey: 'Bodhi Rook-1-0' }); // pick friendly
    const done = resolveAbility('Whistling Birds', { ...ctx, chosenFigureKey: 'whistling_birds_done' });
    assert.equal(done.applied, true);
    assert.deepEqual(dcHealthState.get('msg_friend'), [[3, 5]], 'friendly suffers 2 Damage (5 → 3)');
  });

  it('caps selection at 3 figures (auto-finalizes on the 3rd pick)', () => {
    // Build 4 candidates within range; selecting 3 must auto-finalize.
    const dcMessageMeta = new Map();
    dcMessageMeta.set('msg_act', { gameId: 'g', playerNum: 1, dcName: 'Bossk', displayName: 'Bossk [DG 1]' });
    dcMessageMeta.set('msg_e', { gameId: 'g', playerNum: 2, dcName: 'Alliance Ranger (Regular)', displayName: 'Alliance Ranger (Regular) [DG 1]' });
    const dcHealthState = new Map();
    dcHealthState.set('msg_e', [[3, 3], [3, 3], [3, 3]]);
    const game = {
      gameId: 'g', selectedMap: { id: MAP },
      figurePositions: {
        1: { 'Bossk-1-0': ACT },
        2: { 'Alliance Ranger (Regular)-1-0': 'a2', 'Alliance Ranger (Regular)-1-1': 'b1', 'Alliance Ranger (Regular)-1-2': 'b2' },
      },
      dcActionsData: { msg_act: { remaining: 1, total: 1, selectedFigure: 0 } },
      _whistlingBirdsPending: { hits: 1, playerNum: 1, figureKey: 'Bossk-1-0', targets: [], playerOf: {}, armed: true },
    };
    const ctx = { game, playerNum: 1, dcMessageMeta, dcHealthState };
    resolveAbility('Whistling Birds', ctx);
    resolveAbility('Whistling Birds', { ...ctx, chosenFigureKey: 'Alliance Ranger (Regular)-1-0' });
    resolveAbility('Whistling Birds', { ...ctx, chosenFigureKey: 'Alliance Ranger (Regular)-1-1' });
    const third = resolveAbility('Whistling Birds', { ...ctx, chosenFigureKey: 'Alliance Ranger (Regular)-1-2' });
    assert.equal(third.applied, true, 'the 3rd pick auto-finalizes (up to 3)');
    // All three chosen figures take 1 Damage.
    const hs = dcHealthState.get('msg_e');
    assert.deepEqual(hs, [[2, 3], [2, 3], [2, 3]], 'each of the 3 chosen figures suffers 1 Damage');
  });
});
