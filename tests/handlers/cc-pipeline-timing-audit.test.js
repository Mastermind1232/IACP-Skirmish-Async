/**
 * CC Pipeline Timing Audit — alexanbv directive 2026-07-03.
 *
 * Verifies that every CC timing trigger category:
 *   1. Is gated correctly by isCcPlayableNow (or deliberately blocked from hand).
 *   2. Routes through playCcFull and exits ok.
 *   3. Is subject to Signal Jammer cancellation.
 *
 * Additionally audits:
 *   4. Counter-stack cancel rules (Negation / Comm Disruption).
 *   5. Counter-window state machine (open / push / resolve).
 *   6. That every CC play site in the codebase uses playCcFull (static source check).
 *
 * Pipeline tests use skipExecute:true — effect resolution is not exercised here,
 * only the commit + counter-window path. The opponent hand is empty so the
 * counter window auto-resolves without Discord (fetchGameChannel returns null
 * when client is null, which triggers immediate resolution). No network I/O.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isCcPlayableNow } from '../../src/game/cc-timing.js';
import {
  playCcFull,
  canCancelCc,
  availableCounters,
  resolveCounterStack,
  openCounterWindow,
  pushCounter,
  resolveAndCloseWindow,
  topAvailableCounters,
  counterResponder,
  topCard,
} from '../../src/handlers/cc-pipeline.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readSrc = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

function baseGame(overrides = {}) {
  return {
    gameId: 'audit',
    player1Id: 'P1',
    player2Id: 'P2',
    player1CcHand: [],
    player2CcHand: [],
    player1CcDiscard: [],
    player2CcDiscard: [],
    currentRound: 1,
    ...overrides,
  };
}

function noopCtx() {
  const logs = [];
  return {
    logs,
    logGameAction: async (_g, _c, msg) => { logs.push(msg); return null; },
    saveGames: () => {},
  };
}

/** Run playCcFull with skipExecute (no Discord, counter window auto-resolves). */
async function runPipeline(game, playerNum, cardName, extraOpts = {}) {
  const ctx = noopCtx();
  const result = await playCcFull(
    game, game.gameId, playerNum, null, cardName,
    { skipExecute: true, ...extraOpts },
    ctx, null,
  );
  return { result, ctx };
}

// ── Part I: isCcPlayableNow timing gate ────────────────────────────────────
//
// Each describe block covers one timing category from the spec. Tests verify
// the gate opens in the correct game-state window and is closed in others.

describe('Timing gate — start_of_round (Adrenaline, Deploy the Garrison)', () => {
  it('opens during the SoR window (startOfRoundWhoseTurn truthy)', () => {
    const g = baseGame({ startOfRoundWhoseTurn: true });
    assert.equal(isCcPlayableNow(g, 1, 'Adrenaline'), true);
    assert.equal(isCcPlayableNow(g, 1, 'Deploy the Garrison'), true);
  });
  it('blocked during activation — currentActivationTurnPlayerId set, no SoR flag', () => {
    const g = baseGame({ currentActivationTurnPlayerId: 'P1' });
    assert.equal(isCcPlayableNow(g, 1, 'Adrenaline'), false);
  });
  it('blocked during end-of-round window', () => {
    const g = baseGame({ endOfRoundWhoseTurn: 'P1' });
    assert.equal(isCcPlayableNow(g, 1, 'Adrenaline'), false);
  });
  it('blocked when currentRound is 0 (no active round)', () => {
    const g = baseGame({ currentRound: 0, startOfRoundWhoseTurn: true });
    assert.equal(isCcPlayableNow(g, 1, 'Adrenaline'), false);
  });
});

describe('Timing gate — start_of_activation (Deadly Precision)', () => {
  // timing: 'startOfActivation' maps to case 'startofactivation' → ctx.duringActivation
  it('opens during own activation', () => {
    const g = baseGame({ currentActivationTurnPlayerId: 'P1' });
    assert.equal(isCcPlayableNow(g, 1, 'Deadly Precision'), true);
  });
  it('blocked when it is opponent activation', () => {
    const g = baseGame({ currentActivationTurnPlayerId: 'P2' });
    assert.equal(isCcPlayableNow(g, 1, 'Deadly Precision'), false);
  });
  it('blocked during SoR even though currentActivationTurnPlayerId is set', () => {
    const g = baseGame({ startOfRoundWhoseTurn: true, currentActivationTurnPlayerId: 'P1' });
    assert.equal(isCcPlayableNow(g, 1, 'Deadly Precision'), false);
  });
});

describe('Timing gate — end_of_activation (Blaze of Glory)', () => {
  // timing: 'afterActivationResolves' → case 'afteractivationresolves' → ctx.duringActivation
  it('opens during own activation (post-activation play window)', () => {
    const g = baseGame({ currentActivationTurnPlayerId: 'P1' });
    assert.equal(isCcPlayableNow(g, 1, 'Blaze of Glory'), true);
  });
  it('blocked outside activation', () => {
    const g = baseGame();
    assert.equal(isCcPlayableNow(g, 1, 'Blaze of Glory'), false);
  });
  it('blocked during SoR', () => {
    const g = baseGame({ startOfRoundWhoseTurn: true });
    assert.equal(isCcPlayableNow(g, 1, 'Blaze of Glory'), false);
  });
});

describe('Timing gate — end_of_round (Against the Odds)', () => {
  // timing: 'endOfRound' → case 'endofround' → ctx.endOfRound (endOfRoundWhoseTurn === playerId)
  it('opens when endOfRoundWhoseTurn matches this player', () => {
    const g = baseGame({ endOfRoundWhoseTurn: 'P1' });
    assert.equal(isCcPlayableNow(g, 1, 'Against the Odds'), true);
  });
  it("blocked when endOfRoundWhoseTurn is the opponent's ID", () => {
    const g = baseGame({ endOfRoundWhoseTurn: 'P2' });
    assert.equal(isCcPlayableNow(g, 1, 'Against the Odds'), false);
  });
  it('blocked during activation', () => {
    const g = baseGame({ currentActivationTurnPlayerId: 'P1' });
    assert.equal(isCcPlayableNow(g, 1, 'Against the Odds'), false);
  });
});

describe('Timing gate — during_activation (Advance Warning, Stimulants)', () => {
  it('opens during own activation', () => {
    const g = baseGame({ currentActivationTurnPlayerId: 'P1' });
    assert.equal(isCcPlayableNow(g, 1, 'Advance Warning'), true);
    assert.equal(isCcPlayableNow(g, 1, 'Stimulants'), true);
  });
  it("blocked during opponent's activation", () => {
    const g = baseGame({ currentActivationTurnPlayerId: 'P2' });
    assert.equal(isCcPlayableNow(g, 1, 'Advance Warning'), false);
  });
  it('blocked during SoR (SoR flag suppresses activation window)', () => {
    const g = baseGame({ startOfRoundWhoseTurn: true, currentActivationTurnPlayerId: 'P1' });
    assert.equal(isCcPlayableNow(g, 1, 'Advance Warning'), false);
  });
  it('blocked during EoR', () => {
    const g = baseGame({ endOfRoundWhoseTurn: 'P1' });
    assert.equal(isCcPlayableNow(g, 1, 'Advance Warning'), false);
  });
});

describe('Timing gate — special_action (Smoke Grenade) — always blocked from hand', () => {
  // specialAction is in SPECIAL_ACTION_TIMING; isCcPlayableNow returns false before
  // the switch, because special-action CCs are played via the DC Special Action button.
  it('blocked in SoR window', () => {
    const g = baseGame({ startOfRoundWhoseTurn: true });
    assert.equal(isCcPlayableNow(g, 1, 'Smoke Grenade'), false);
  });
  it('blocked during activation', () => {
    const g = baseGame({ currentActivationTurnPlayerId: 'P1' });
    assert.equal(isCcPlayableNow(g, 1, 'Smoke Grenade'), false);
  });
  it('blocked during attack', () => {
    const g = baseGame({ pendingCombat: { attackerPlayerNum: 1, defenderPlayerNum: 2 } });
    assert.equal(isCcPlayableNow(g, 1, 'Smoke Grenade'), false);
  });
});

describe('Timing gate — attack:on_declare (Marksman)', () => {
  // timing: 'beforeDeclaringRangedAttack' → case 'beforedeclaringrangedattack' → ctx.duringActivation
  // In practice called via combat hook with skipTimingCheck, but gate checks here.
  it('opens during own activation (pre-attack declaration window)', () => {
    const g = baseGame({ currentActivationTurnPlayerId: 'P1' });
    assert.equal(isCcPlayableNow(g, 1, 'Marksman'), true);
  });
  it('blocked outside activation', () => {
    const g = baseGame({ startOfRoundWhoseTurn: true });
    assert.equal(isCcPlayableNow(g, 1, 'Marksman'), false);
  });
});

describe('Timing gate — attack:modifiers (Assassinate, duringAttack)', () => {
  it('opens with pendingCombat active', () => {
    const g = baseGame({ pendingCombat: { attackerPlayerNum: 1, defenderPlayerNum: 2 } });
    assert.equal(isCcPlayableNow(g, 1, 'Assassinate'), true);
  });
  it('also opens with combat (not pendingCombat)', () => {
    const g = baseGame({ combat: { attackerPlayerNum: 1, defenderPlayerNum: 2 } });
    assert.equal(isCcPlayableNow(g, 1, 'Assassinate'), true);
  });
  it('blocked during activation (no combat)', () => {
    const g = baseGame({ currentActivationTurnPlayerId: 'P1' });
    assert.equal(isCcPlayableNow(g, 1, 'Assassinate'), false);
  });
});

describe('Timing gate — attack:rerolls (Tough Luck) — always blocked from hand', () => {
  // timing: 'afterOpponentReroll' → case 'afteropponentreroll' → returns false
  // Tough Luck has a dedicated gate hook in combat.js (tlgate_*), not the hand dropdown.
  it('blocked even with pendingCombat active', () => {
    const g = baseGame({ pendingCombat: { attackerPlayerNum: 2, defenderPlayerNum: 1 } });
    assert.equal(isCcPlayableNow(g, 1, 'Tough Luck'), false);
  });
  it('blocked during activation', () => {
    const g = baseGame({ currentActivationTurnPlayerId: 'P1' });
    assert.equal(isCcPlayableNow(g, 1, 'Tough Luck'), false);
  });
  it('blocked in SoR', () => {
    const g = baseGame({ startOfRoundWhoseTurn: true });
    assert.equal(isCcPlayableNow(g, 1, 'Tough Luck'), false);
  });
});

describe('Timing gate — attack:after_resolves (Escalating Hostility)', () => {
  // timing: 'afterAttack' → case 'afterattack' → special-cased: isAttacker && combatHit === true
  it('opens as attacker after a hit (hit=true)', () => {
    const g = baseGame({ pendingCombat: { attackerPlayerNum: 1, defenderPlayerNum: 2, hit: true } });
    assert.equal(isCcPlayableNow(g, 1, 'Escalating Hostility'), true);
  });
  it('blocked as defender (even with hit=true)', () => {
    const g = baseGame({ pendingCombat: { attackerPlayerNum: 2, defenderPlayerNum: 1, hit: true } });
    assert.equal(isCcPlayableNow(g, 1, 'Escalating Hostility'), false);
  });
  it('blocked as attacker when attack missed (hit=false)', () => {
    const g = baseGame({ pendingCombat: { attackerPlayerNum: 1, defenderPlayerNum: 2, hit: false } });
    assert.equal(isCcPlayableNow(g, 1, 'Escalating Hostility'), false);
  });
  it('blocked when hit not yet resolved (hit=undefined/null)', () => {
    const g = baseGame({ pendingCombat: { attackerPlayerNum: 1, defenderPlayerNum: 2 } });
    assert.equal(isCcPlayableNow(g, 1, 'Escalating Hostility'), false);
  });
  it('Collateral Damage (afterAttack, non-Escalating) opens after any attack resolves', () => {
    const g = baseGame({ pendingCombat: { attackerPlayerNum: 1, defenderPlayerNum: 2, hit: false } });
    assert.equal(isCcPlayableNow(g, 1, 'Collateral Damage'), true);
  });
});

describe('Timing gate — when_defeated (Celebration)', () => {
  // timing: 'afterUniqueHostileDefeated' → case 'afteruniquehostiledefeated' → ctx.duringActivation
  // Gate-driven: must be triggered by actual defeat event; defeat-cc-prompts uses skipTimingCheck.
  it('gate returns true during activation', () => {
    const g = baseGame({ currentActivationTurnPlayerId: 'P1' });
    assert.equal(isCcPlayableNow(g, 1, 'Celebration'), true);
  });
  it('blocked in SoR', () => {
    const g = baseGame({ startOfRoundWhoseTurn: true });
    assert.equal(isCcPlayableNow(g, 1, 'Celebration'), false);
  });
});

describe('Timing gate — when_suffers_damage_equal_to_health (Dying Lunge)', () => {
  // timing: 'other' → case 'other' → ctx.duringActivation
  it('gate returns true during activation', () => {
    const g = baseGame({ currentActivationTurnPlayerId: 'P1' });
    assert.equal(isCcPlayableNow(g, 1, 'Dying Lunge'), true);
  });
  it('blocked in SoR', () => {
    const g = baseGame({ startOfRoundWhoseTurn: true });
    assert.equal(isCcPlayableNow(g, 1, 'Dying Lunge'), false);
  });
  it('blocked when no activation or SoR window', () => {
    assert.equal(isCcPlayableNow(baseGame(), 1, 'Dying Lunge'), false);
  });
});

describe('Timing gate — when_suffers_damage (Extra Protection)', () => {
  // timing: 'whenFriendlyFigureWithin2SpacesSuffers3PlusDamage' → maps to ctx.duringActivation
  it('opens during own activation', () => {
    const g = baseGame({ currentActivationTurnPlayerId: 'P1' });
    assert.equal(isCcPlayableNow(g, 1, 'Extra Protection'), true);
  });
  it('blocked in SoR', () => {
    const g = baseGame({ startOfRoundWhoseTurn: true });
    assert.equal(isCcPlayableNow(g, 1, 'Extra Protection'), false);
  });
});

describe('Timing gate — when_opponent_plays_cc (Negation, Comm Disruption) — always false from hand', () => {
  // timing: 'whenCommandCardPlayed' → case 'whencommandcardplayed' → returns false
  // Counter cards are offered via the dedicated counter-window buttons, never from hand.
  it('Negation: blocked in all contexts', () => {
    assert.equal(isCcPlayableNow(baseGame({ startOfRoundWhoseTurn: true }), 1, 'Negation'), false);
    assert.equal(isCcPlayableNow(baseGame({ currentActivationTurnPlayerId: 'P1' }), 1, 'Negation'), false);
    assert.equal(isCcPlayableNow(baseGame({ pendingCombat: { attackerPlayerNum: 1 } }), 1, 'Negation'), false);
  });
  it('Comm Disruption: blocked in all contexts', () => {
    assert.equal(isCcPlayableNow(baseGame({ currentActivationTurnPlayerId: 'P1' }), 1, 'Comm Disruption'), false);
    assert.equal(isCcPlayableNow(baseGame({ startOfRoundWhoseTurn: true }), 1, 'Comm Disruption'), false);
  });
});

// ── Part II: playCcFull pipeline routing ──────────────────────────────────
//
// Every test verifies: result.ok=true, card removed from hand (or not in hand
// for allowNotInHand), counter window resolved without cancellation.
// skipValidation=true is used uniformly — figure-restriction gating is tested
// separately (cc-timing unit tests). The counter window auto-resolves because
// the opponent hand is always empty and no hand channel is configured.

describe('playCcFull — pipeline routing: one CC per timing category', () => {
  it('start_of_round: Adrenaline (cost 2) — commit, triggers, window resolve', async () => {
    const g = baseGame({ player1CcHand: ['Adrenaline'], startOfRoundWhoseTurn: true });
    const { result } = await runPipeline(g, 1, 'Adrenaline', { skipValidation: true });
    assert.equal(result.ok, true, 'pipeline ok');
    assert.ok(!result.cancelled, 'not cancelled (no opponent counters)');
    assert.ok(!g.player1CcHand.includes('Adrenaline'), 'card removed from hand');
    assert.ok(g.player1CcDiscard.includes('Adrenaline'), 'card in discard');
  });

  it('start_of_activation: Deadly Precision (cost 0) — maps to duringActivation gate', async () => {
    const g = baseGame({ player1CcHand: ['Deadly Precision'], currentActivationTurnPlayerId: 'P1' });
    const { result } = await runPipeline(g, 1, 'Deadly Precision', { skipValidation: true });
    assert.equal(result.ok, true);
    assert.ok(!g.player1CcHand.includes('Deadly Precision'));
    assert.ok(g.player1CcDiscard.includes('Deadly Precision'));
  });

  it('end_of_activation: Blaze of Glory (cost 2) — afterActivationResolves → duringActivation', async () => {
    const g = baseGame({ player1CcHand: ['Blaze of Glory'], currentActivationTurnPlayerId: 'P1' });
    const { result } = await runPipeline(g, 1, 'Blaze of Glory', { skipValidation: true });
    assert.equal(result.ok, true);
    assert.ok(!g.player1CcHand.includes('Blaze of Glory'));
  });

  it('end_of_round: Against the Odds (cost 0) — no Negation in opp hand, window auto-resolves', async () => {
    const g = baseGame({ player1CcHand: ['Against the Odds'], endOfRoundWhoseTurn: 'P1' });
    const { result } = await runPipeline(g, 1, 'Against the Odds', { skipValidation: true });
    assert.equal(result.ok, true);
    assert.ok(!result.cancelled);
    assert.ok(g.player1CcDiscard.includes('Against the Odds'));
  });

  it('during_activation: Advance Warning (cost 0)', async () => {
    const g = baseGame({ player1CcHand: ['Advance Warning'], currentActivationTurnPlayerId: 'P1' });
    const { result } = await runPipeline(g, 1, 'Advance Warning', { skipValidation: true });
    assert.equal(result.ok, true);
    assert.ok(!g.player1CcHand.includes('Advance Warning'));
    assert.ok(g.player1CcDiscard.includes('Advance Warning'));
  });

  it('special_action: Smoke Grenade (cost 1) — DC path (allowNotInHand + skipValidation)', async () => {
    // DC play: card already removed before playCcFull; use allowNotInHand to skip commit.
    const g = baseGame({ player1CcHand: [] });
    const { result } = await runPipeline(g, 1, 'Smoke Grenade', { allowNotInHand: true, skipValidation: true });
    assert.equal(result.ok, true);
    assert.ok(!result.cancelled);
    // With allowNotInHand, commit is skipped (card was pre-removed); no discard assertion.
  });

  it('attack:on_declare: Marksman (cost 1) — skipTimingCheck (combat hook path)', async () => {
    const g = baseGame({
      player1CcHand: ['Marksman'],
      pendingCombat: { attackerPlayerNum: 1, defenderPlayerNum: 2, attackerFigureKey: 'A-1-0', target: { figureKey: 'D-2-0' } },
    });
    const { result } = await runPipeline(g, 1, 'Marksman', { skipValidation: true, skipTimingCheck: true });
    assert.equal(result.ok, true);
    assert.ok(!g.player1CcHand.includes('Marksman'));
  });

  it('attack:modifiers: Assassinate (cost 3, duringAttack) — pendingCombat present', async () => {
    const g = baseGame({
      player1CcHand: ['Assassinate'],
      pendingCombat: { attackerPlayerNum: 1, defenderPlayerNum: 2, attackerFigureKey: 'A-1-0', target: { figureKey: 'D-2-0' } },
    });
    const { result } = await runPipeline(g, 1, 'Assassinate', { skipValidation: true });
    assert.equal(result.ok, true);
    assert.ok(!g.player1CcHand.includes('Assassinate'));
  });

  it('attack:rerolls: Tough Luck (cost 1) — gate hook path (skipTimingCheck)', async () => {
    const g = baseGame({
      player1CcHand: ['Tough Luck'],
      pendingCombat: { attackerPlayerNum: 2, defenderPlayerNum: 1 },
    });
    const { result } = await runPipeline(g, 1, 'Tough Luck', { skipTimingCheck: true });
    assert.equal(result.ok, true);
    assert.ok(!g.player1CcHand.includes('Tough Luck'));
    assert.ok(g.player1CcDiscard.includes('Tough Luck'));
  });

  it('attack:after_resolves: Escalating Hostility (cost 1) — afterAttack + hit=true', async () => {
    const g = baseGame({
      player1CcHand: ['Escalating Hostility'],
      pendingCombat: { attackerPlayerNum: 1, defenderPlayerNum: 2, hit: true },
    });
    const { result } = await runPipeline(g, 1, 'Escalating Hostility', { skipValidation: true });
    assert.equal(result.ok, true);
    assert.ok(!g.player1CcHand.includes('Escalating Hostility'));
  });

  it('when_defeated: Celebration (cost 0) — skipTimingCheck (defeat hook path)', async () => {
    const g = baseGame({ player1CcHand: ['Celebration'] });
    const { result } = await runPipeline(g, 1, 'Celebration', { skipTimingCheck: true });
    assert.equal(result.ok, true);
    assert.ok(!result.cancelled);
    assert.ok(!g.player1CcHand.includes('Celebration'));
    assert.ok(g.player1CcDiscard.includes('Celebration'));
  });

  it('when_suffers_damage_equal_to_health: Dying Lunge (cost 2) — skipTimingCheck', async () => {
    const g = baseGame({
      player1CcHand: ['Dying Lunge'],
      pendingCombat: { attackerPlayerNum: 2, defenderPlayerNum: 1, attackerFigureKey: 'A-2-0', target: { figureKey: 'D-1-0' } },
    });
    const { result } = await runPipeline(g, 1, 'Dying Lunge', { skipTimingCheck: true });
    assert.equal(result.ok, true);
    assert.ok(!g.player1CcHand.includes('Dying Lunge'));
  });

  it('when_suffers_damage: Extra Protection (cost 1) — skipTimingCheck (interrupt hook path)', async () => {
    const g = baseGame({ player1CcHand: ['Extra Protection'] });
    const { result } = await runPipeline(g, 1, 'Extra Protection', { skipTimingCheck: true });
    assert.equal(result.ok, true);
    assert.ok(!g.player1CcHand.includes('Extra Protection'));
  });

  it('Final Stand (cost 2) — whenFriendlyFigureWithin3SpacesWouldBeDefeated, skipTimingCheck', async () => {
    const g = baseGame({ player1CcHand: ['Final Stand'] });
    const { result } = await runPipeline(g, 1, 'Final Stand', { skipTimingCheck: true });
    assert.equal(result.ok, true);
    assert.ok(!g.player1CcHand.includes('Final Stand'));
  });

  it('when_gains_condition: Capitalize (cost 1, duringAttack) — attack context', async () => {
    const g = baseGame({
      player1CcHand: ['Capitalize'],
      pendingCombat: { attackerPlayerNum: 1, defenderPlayerNum: 2 },
    });
    const { result } = await runPipeline(g, 1, 'Capitalize', { skipValidation: true });
    assert.equal(result.ok, true);
    assert.ok(!g.player1CcHand.includes('Capitalize'));
  });

  it('when_opponent_plays_cc: Negation fails normal play (dedicated counter flow required)', async () => {
    // isCcPlayableNow returns false for whenCommandCardPlayed; normal play must reject.
    const g = baseGame({ player1CcHand: ['Negation'], currentActivationTurnPlayerId: 'P1' });
    const ctx = noopCtx();
    const result = await playCcFull(g, 'audit', 1, null, 'Negation', {}, ctx, null);
    assert.equal(result.ok, false, 'Negation must fail without skipValidation/skipTimingCheck');
    assert.match(result.reason, /timing|can.t be played/i);
  });
});

// ── Part III: Signal Jammer — cancels CCs across all timing categories ─────

describe('Signal Jammer — cancels CCs from any timing category', () => {
  const withJammer = { signalJammerActive: { playerNum: 2 } }; // P2 fired jammer vs P1

  it('cancels a start_of_round CC (Adrenaline)', async () => {
    const g = baseGame({ player1CcHand: ['Adrenaline'], startOfRoundWhoseTurn: true, ...withJammer });
    const { result } = await runPipeline(g, 1, 'Adrenaline', { skipValidation: true });
    assert.equal(result.ok, true);
    assert.equal(result.cancelled, 'signal_jammer');
    assert.ok(!g.signalJammerActive, 'jammer consumed');
    assert.ok(!g.player1CcHand.includes('Adrenaline'), 'card removed from hand on cancel');
    assert.ok(g.player2CcDiscard.includes('Signal Jammer'), 'Signal Jammer to P2 discard');
    assert.ok(g.player1CcDiscard.includes('Adrenaline'), 'cancelled card to P1 discard');
  });

  it('cancels a during_activation CC (Advance Warning)', async () => {
    const g = baseGame({ player1CcHand: ['Advance Warning'], currentActivationTurnPlayerId: 'P1', ...withJammer });
    const { result } = await runPipeline(g, 1, 'Advance Warning', { skipValidation: true });
    assert.equal(result.cancelled, 'signal_jammer');
    assert.ok(!g.signalJammerActive);
  });

  it('cancels an end_of_round CC (Against the Odds)', async () => {
    const g = baseGame({ player1CcHand: ['Against the Odds'], endOfRoundWhoseTurn: 'P1', ...withJammer });
    const { result } = await runPipeline(g, 1, 'Against the Odds', { skipValidation: true });
    assert.equal(result.cancelled, 'signal_jammer');
  });

  it('cancels an attack-phase CC (Assassinate)', async () => {
    const g = baseGame({
      player1CcHand: ['Assassinate'],
      pendingCombat: { attackerPlayerNum: 1, defenderPlayerNum: 2 },
      ...withJammer,
    });
    const { result } = await runPipeline(g, 1, 'Assassinate', { skipValidation: true });
    assert.equal(result.cancelled, 'signal_jammer');
  });

  it('cancels a gate-driven CC (Tough Luck via skipTimingCheck)', async () => {
    const g = baseGame({
      player1CcHand: ['Tough Luck'],
      pendingCombat: { attackerPlayerNum: 2, defenderPlayerNum: 1 },
      ...withJammer,
    });
    const { result } = await runPipeline(g, 1, 'Tough Luck', { skipTimingCheck: true });
    assert.equal(result.cancelled, 'signal_jammer');
  });

  it('cancels even when Jammer belongs to the playing player (own jammer — any CC rule)', async () => {
    // Per alexanbv 2026-07-03: no own-player exemption — ANY next CC is cancelled.
    const g = baseGame({
      player1CcHand: ['Advance Warning'],
      currentActivationTurnPlayerId: 'P1',
      signalJammerActive: { playerNum: 1 },
    });
    const { result } = await runPipeline(g, 1, 'Advance Warning', { skipValidation: true });
    assert.equal(result.cancelled, 'signal_jammer', 'own jammer cancels own CC');
    assert.equal(result.ok, true);
  });

  it('cancels Signal Jammer itself (no name exemption — any CC rule)', async () => {
    // Per alexanbv 2026-07-03: Signal Jammer is not exempt from another active Jammer.
    const g = baseGame({ player1CcHand: ['Signal Jammer'], ...withJammer });
    const { result } = await runPipeline(g, 1, 'Signal Jammer', { skipValidation: true });
    assert.equal(result.cancelled, 'signal_jammer', 'Signal Jammer cancels Signal Jammer');
    assert.equal(result.ok, true);
  });
});

// ── Part IV: Counter-stack cancel rules ────────────────────────────────────

describe('canCancelCc — per-rule assertions', () => {
  it('Negation cancels exactly cost-0 CCs', () => {
    assert.equal(canCancelCc('Negation', 0), true, 'cost 0 → yes');
    assert.equal(canCancelCc('Negation', 1), false, 'cost 1 → no');
    assert.equal(canCancelCc('Negation', 2), false, 'cost 2 → no');
    assert.equal(canCancelCc('Negation', 3), false, 'cost 3 → no');
  });

  it('Comm Disruption requires ≥1 SPY and cost ≤ SPY count', () => {
    assert.equal(canCancelCc('Comm Disruption', 0, 0), false, '0 SPY → cannot cancel anything');
    assert.equal(canCancelCc('Comm Disruption', 1, 0), false, '0 SPY, cost 1 → no');
    assert.equal(canCancelCc('Comm Disruption', 1, 1), true, '1 SPY, cost 1 → yes');
    assert.equal(canCancelCc('Comm Disruption', 2, 1), false, '1 SPY, cost 2 → no');
    assert.equal(canCancelCc('Comm Disruption', 2, 2), true, '2 SPY, cost 2 → yes');
    assert.equal(canCancelCc('Comm Disruption', 3, 2), false, '2 SPY, cost 3 → no');
  });

  it('Comm Disruption (2 SPY) can cancel Negation (cost 1)', () => {
    assert.equal(canCancelCc('Comm Disruption', 1, 2), true);
  });
});

describe('availableCounters — offered options for a given cost + SPY count', () => {
  it('cost-0, 0 SPY → [Negation] only', () => {
    assert.deepEqual(availableCounters(0, 0), ['Negation']);
  });
  it('cost-1, 0 SPY → [] (Negation can\'t cancel cost-1, Comms needs SPY)', () => {
    assert.deepEqual(availableCounters(1, 0), []);
  });
  it('cost-0, 1 SPY → [Negation, Comm Disruption] (both legal)', () => {
    assert.deepEqual(availableCounters(0, 1), ['Negation', 'Comm Disruption']);
  });
  it('cost-1, 1 SPY → [Comm Disruption] only', () => {
    assert.deepEqual(availableCounters(1, 1), ['Comm Disruption']);
  });
  it('cost-2, 0 SPY → [] (no legal counter)', () => {
    assert.deepEqual(availableCounters(2, 0), []);
  });
  it('cost-2, 2 SPY → [Comm Disruption] only', () => {
    assert.deepEqual(availableCounters(2, 2), ['Comm Disruption']);
  });
});

describe('resolveCounterStack — LIFO unwind', () => {
  it('single-entry stack: card resolves unconditionally', () => {
    const statuses = resolveCounterStack([{ card: 'Adrenaline', cost: 2 }]);
    assert.deepEqual(statuses, ['resolved']);
  });

  it('AW(0) ← Negation: Negation resolves, AW cancelled', () => {
    const stack = [
      { card: 'Advance Warning', cost: 0 },
      { card: 'Negation', cost: 1 },
    ];
    assert.deepEqual(resolveCounterStack(stack), ['cancelled', 'resolved']);
  });

  it('classic 3-entry: EoS(0) ← Negation ← Comm Disruption(2 SPY) → Comms resolves, Neg cancelled, EoS resolves', () => {
    const stack = [
      { card: 'Element of Surprise', cost: 0 },
      { card: 'Negation', cost: 1 },
      { card: 'Comm Disruption', cost: 2, spyCount: 2 },
    ];
    assert.deepEqual(resolveCounterStack(stack), ['resolved', 'cancelled', 'resolved']);
  });

  it('Negation cannot cancel Negation (cost 1 > 0): both Negations resolve, bottom card cancelled', () => {
    // AW(0) ← Negate(1) ← Negate(1)
    // Top Negate resolves. Can it cancel middle Negate (cost 1)? canCancelCc('Negation',1)=false → no.
    // Middle Negate resolves. Can it cancel AW (cost 0)? canCancelCc('Negation',0)=true → yes.
    const stack = [
      { card: 'Against the Odds', cost: 0 },
      { card: 'Negation', cost: 1 },
      { card: 'Negation', cost: 1 },
    ];
    assert.deepEqual(resolveCounterStack(stack), ['cancelled', 'resolved', 'resolved']);
  });

  it('Comm Disruption(1 SPY) cannot cancel Comm Disruption(cost 2): both resolve, bottom cancelled', () => {
    // AW(0) ← CD(2, spy=1) ← CD(2, spy=1)
    // Top CD resolves. Can it cancel middle CD (cost 2)? canCancelCc('CD',2,1)=false → no.
    // Middle CD resolves. Can it cancel AW (cost 0)? canCancelCc('CD',0,1)=true → yes.
    const stack = [
      { card: 'Advance Warning', cost: 0 },
      { card: 'Comm Disruption', cost: 2, spyCount: 1 },
      { card: 'Comm Disruption', cost: 2, spyCount: 1 },
    ];
    assert.deepEqual(resolveCounterStack(stack), ['cancelled', 'resolved', 'resolved']);
  });

  it('Comm Disruption(2 SPY) CAN cancel Comm Disruption(cost 2): top resolves, middle cancelled, bottom resolves', () => {
    // AW(0) ← CD(2,spy=2) ← CD(2,spy=2)
    // Top CD resolves. Can it cancel middle CD (cost 2)? canCancelCc('CD',2,2)=true → yes.
    // Middle CD cancelled → does NOT cancel AW → AW resolves.
    const stack = [
      { card: 'Advance Warning', cost: 0 },
      { card: 'Comm Disruption', cost: 2, spyCount: 2 },
      { card: 'Comm Disruption', cost: 2, spyCount: 2 },
    ];
    assert.deepEqual(resolveCounterStack(stack), ['resolved', 'cancelled', 'resolved']);
  });
});

// ── Part V: Counter-window state machine ──────────────────────────────────

describe('Counter-window state machine (openCounterWindow / pushCounter / resolveAndCloseWindow)', () => {
  it('openCounterWindow initialises the stack with one entry', () => {
    const g = baseGame();
    openCounterWindow(g, { card: 'Adrenaline', cost: 2, playedBy: 1 });
    assert.ok(g.ccCounterWindow, 'window created');
    assert.equal(g.ccCounterWindow.stack.length, 1);
    assert.equal(g.ccCounterWindow.stack[0].card, 'Adrenaline');
  });

  it('counterResponder returns the opponent of the player at top of stack', () => {
    const g = baseGame();
    openCounterWindow(g, { card: 'Adrenaline', cost: 2, playedBy: 1 });
    assert.equal(counterResponder(g), 2);
    // If played by 2, responder is 1
    g.ccCounterWindow.stack[0].playedBy = 2;
    assert.equal(counterResponder(g), 1);
  });

  it('topCard returns the last entry', () => {
    const g = baseGame();
    openCounterWindow(g, { card: 'Advance Warning', cost: 0, playedBy: 1 });
    assert.equal(topCard(g).card, 'Advance Warning');
    g.ccCounterWindow.stack.push({ card: 'Negation', cost: 1, playedBy: 2 });
    assert.equal(topCard(g).card, 'Negation');
  });

  it('topAvailableCounters lists Negation for a cost-0 play (0 SPY responder)', () => {
    const g = baseGame();
    openCounterWindow(g, { card: 'Advance Warning', cost: 0, playedBy: 1 });
    assert.deepEqual(topAvailableCounters(g, 0), ['Negation']);
  });

  it('topAvailableCounters returns [] for a cost-2 play with 0 SPY', () => {
    const g = baseGame();
    openCounterWindow(g, { card: 'Adrenaline', cost: 2, playedBy: 1 });
    assert.deepEqual(topAvailableCounters(g, 0), []);
  });

  it('pushCounter adds a legal counter to the stack', () => {
    const g = baseGame();
    openCounterWindow(g, { card: 'Advance Warning', cost: 0, playedBy: 1 });
    const res = pushCounter(g, { card: 'Negation', cost: 1, playedBy: 2 });
    assert.equal(res.ok, true);
    assert.equal(g.ccCounterWindow.stack.length, 2);
    assert.equal(g.ccCounterWindow.stack[1].card, 'Negation');
  });

  it('pushCounter rejects an illegal counter (Negation vs cost-1 CC)', () => {
    const g = baseGame();
    openCounterWindow(g, { card: 'Adrenaline', cost: 2, playedBy: 1 });
    const res = pushCounter(g, { card: 'Negation', cost: 1, playedBy: 2 });
    assert.equal(res.ok, false);
    assert.match(res.reason, /cannot cancel/i);
    assert.equal(g.ccCounterWindow.stack.length, 1, 'stack unchanged');
  });

  it('pushCounter fails gracefully when no window is open', () => {
    const g = baseGame(); // no ccCounterWindow
    const res = pushCounter(g, { card: 'Negation', cost: 1, playedBy: 2 });
    assert.equal(res.ok, false);
    assert.match(res.reason, /no counter window/i);
  });

  it('resolveAndCloseWindow clears the window and returns annotated stack', () => {
    const g = baseGame();
    openCounterWindow(g, { card: 'Advance Warning', cost: 0, playedBy: 1 });
    pushCounter(g, { card: 'Negation', cost: 1, playedBy: 2 });
    const outcome = resolveAndCloseWindow(g);
    assert.ok(!g.ccCounterWindow, 'window cleared');
    assert.equal(outcome.length, 2);
    assert.equal(outcome[0].status, 'cancelled', 'AW cancelled by Negation');
    assert.equal(outcome[1].status, 'resolved', 'Negation resolved');
  });

  it('resolveAndCloseWindow: card survives when no counter was pushed', () => {
    const g = baseGame();
    openCounterWindow(g, { card: 'Adrenaline', cost: 2, playedBy: 1 });
    const outcome = resolveAndCloseWindow(g);
    assert.ok(!g.ccCounterWindow);
    assert.equal(outcome[0].status, 'resolved');
  });
});

// ── Part VI: Source audit — all play sites use playCcFull ─────────────────

describe('Source audit — every CC play site routes through playCcFull', () => {
  it('cc-hand.js: handleCcConfirmPlay and resolveCcPlay use playCcFull, not old helpers', () => {
    const s = readSrc('src/handlers/cc-hand.js');
    assert.match(s, /playCcFull/, 'imports and uses playCcFull');
    assert.doesNotMatch(s, /makeCcPromptOpponentCancel\s*\(/, 'old fn not called');
  });

  it('combat.js: Tough Luck + Marksman + gate picks route through playCcFull', () => {
    assert.match(readSrc('src/handlers/combat.js'), /playCcFull/);
  });

  it('before-defeated-ccs.js: Dying Lunge, Miracle Worker, Preservation Protocol use playCcFull', () => {
    assert.match(readSrc('src/handlers/before-defeated-ccs.js'), /playCcFull/);
  });

  it('final-stand.js: Final Stand uses playCcFull', () => {
    assert.match(readSrc('src/handlers/final-stand.js'), /playCcFull/);
  });

  it('after-attack-resolve.js: handleAarCcPick routes through playCcFull', () => {
    assert.match(readSrc('src/handlers/after-attack-resolve.js'), /playCcFull/);
  });

  it('defeat-cc-prompts.js: when-defeated CC plays route through playCcFull', () => {
    assert.match(readSrc('src/handlers/defeat-cc-prompts.js'), /playCcFull/);
  });

  it('after-attack-fire.js: post-attack CC gate plays route through playCcFull', () => {
    assert.match(readSrc('src/handlers/after-attack-fire.js'), /playCcFull/);
  });

  it('interrupts.js: Extra Protection uses playCcFull', () => {
    assert.match(readSrc('src/handlers/interrupts.js'), /playCcFull/);
  });

  it('dc-play-area.js: DC play path uses fire-and-forget openCcCounterWindow + runCcPlayTriggers (NOT playCcFull — avoids mutex deadlock)', () => {
    const s = readSrc('src/handlers/dc-play-area.js');
    assert.match(s, /openCcCounterWindow/, 'uses openCcCounterWindow directly');
    assert.match(s, /runCcPlayTriggers/, 'fires on-play triggers');
    assert.doesNotMatch(s, /playCcFull/, 'must NOT use playCcFull (deadlock risk with game lock held across counter-window Promise)');
  });

  it('fast-forward.js: fast-forward CC play routes through playCcFull', () => {
    assert.match(readSrc('src/handlers/fast-forward.js'), /playCcFull/);
  });

  it('cc-pipeline.js: _playCounter fires runCcPlayTriggers for counter cards (Negation/Comms)', () => {
    const s = readSrc('src/handlers/cc-pipeline.js');
    // Locate the _playCounter body (between function declaration and closing brace).
    // We check that runCcPlayTriggers appears after the Signal Jammer block within it.
    const fnStart = s.indexOf('async function _playCounter(');
    assert.ok(fnStart >= 0, '_playCounter found');
    const afterFn = s.slice(fnStart);
    assert.match(afterFn, /runCcPlayTriggers/, 'counter card plays fire on-play triggers');
  });

  it('cc-pipeline.js: playCcFull has Signal Jammer (step 1) before triggers (step 5) before window (step 6)', () => {
    const s = readSrc('src/handlers/cc-pipeline.js');
    const fnStart = s.indexOf('export async function playCcFull(');
    assert.ok(fnStart >= 0, 'playCcFull found');
    const jamIdx = s.indexOf('signalJammerActive', fnStart);
    const trigIdx = s.indexOf('runCcPlayTriggers', fnStart);
    const winIdx = s.indexOf('_ccWindowResolve', fnStart);
    assert.ok(jamIdx > fnStart, 'Jammer check found in playCcFull');
    assert.ok(trigIdx > jamIdx, 'triggers fire after Jammer check');
    assert.ok(winIdx > trigIdx, 'counter window opens after triggers');
  });
});
