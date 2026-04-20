/**
 * Phase-D probe: CRR ATK-038 — "The resolving player rolls the attack dice
 * and can use any of the figure's abilities; the figure using this ability
 * does not count as having performed an attack; when performing such an
 * attack, the resolver may spend one of that figure's power tokens."
 *
 * Substrate: Murne Rin's `false_orders` attack-phase pipeline in
 *   `handleFalseOrdersAtkPick` (src/handlers/combat.js).
 *
 * Implementation chain (invariant pin):
 *   1. Attack dice come from the CONTROLLED figure's stats
 *      (`controlledStats?.attack`), not the resolver's attackers; this is
 *      the attackInfo that seeds pendingCombat.attackInfo.
 *   2. Controlled figure's passives are applied via
 *      applyDcPassivesToCombat(pendingCombat, controlledStats?.passives,
 *      targetStats?.passives) — so surge/Cleave/Blast keywords of the
 *      CONTROLLED figure (not Murne Rin's) drive resolution.
 *   3. pendingCombat.attackerMsgId is the False-Orders trigger msgId (Murne
 *      Rin's dcMessage), NOT the controlled figure's activation msgId.
 *      `attackPerformedThisActivation` is keyed per-msgId, so flagging Murne
 *      Rin's msgId does not mark the controlled figure's own activation as
 *      having attacked — pinning "the figure using this ability does not
 *      count as having performed an attack" (scoped to the controlled
 *      figure's later-own-activation budget).
 *   4. pendingCombat.attackerFigureKey = controlledFigureKey, so power-token
 *      spending draws from the CONTROLLED figure's tokens; the surge-spend
 *      and token-spend handlers resolve their player-gate via
 *      `combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum`,
 *      so the RESOLVER decides which controlled-figure token to spend.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const COMBAT_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat.js'), 'utf8');

describe('PROBE-PD-ATK-038: False Orders consequences — resolver rolls controlled dice, uses controlled abilities, spends controlled tokens', () => {
  it('038a: source — pendingCombat.attackInfo seeded from CONTROLLED figure\'s stats (resolver rolls the controlled figure\'s dice)', () => {
    assert.match(COMBAT_SRC,
      /const controlledStats = getDcStats\(controlledName\);\s*\n\s*const attackInfo = controlledStats\?\.attack \|\| \{ dice: \['red'\], range: \[1, 3\] \};/,
      'attackInfo must be taken from controlledStats, not the resolver\'s own attacker — CRR-ATK-038');
  });

  it('038b: source — controlled figure\'s passives are applied to pendingCombat (resolver can use any of the figure\'s abilities)', () => {
    assert.match(COMBAT_SRC,
      /applyDcPassivesToCombat\(game\.pendingCombat, controlledStats\?\.passives \|\| \[\], targetStats\?\.passives \|\| \[\]\);/,
      'CONTROLLED figure\'s passives must seed pendingCombat (resolver uses figure\'s keywords/surges) — CRR-ATK-038');
  });

  it('038c: source — pendingCombat.attackerFigureKey is the controlled figure (power tokens live on this figure)', () => {
    assert.match(COMBAT_SRC,
      /attackerFigureKey:\s*controlledFigureKey,/,
      'attackerFigureKey must be the controlled figure, so power-token spend targets its tokens — CRR-ATK-038');
  });

  it('038d: source — pendingCombat.attackerMsgId is the False-Orders trigger msgId (NOT the controlled figure\'s activation msgId)', () => {
    // In handleFalseOrdersAtkPick, msgId comes from the false_orders_atk_
    // button, which encodes Murne Rin's dcMessage msgId (not the controlled
    // figure's activation). The pendingCombat is built with attackerMsgId:
    // msgId. attackPerformedThisActivation is keyed per-msgId in
    // combat-bridge.js, so the controlled figure's own-activation record is
    // never touched by this attack.
    assert.match(COMBAT_SRC,
      /const m = interaction\.customId\.match\(\/\^false_orders_atk_\(\[\^_\]\+\)_\(\[\^_\]\+\)_\(\\d\+\)\$\/\);[\s\S]*?const \[, gameId, msgId, targetIdxStr\] = m;/,
      'false_orders_atk_ button carries gameId + msgId — CRR-ATK-038');
    assert.match(COMBAT_SRC,
      /attackerMsgId:\s*msgId,[\s\S]*?attackerFigureKey:\s*controlledFigureKey,/,
      'pendingCombat.attackerMsgId must be the False-Orders trigger msgId, decoupling the controlled figure\'s own activation from the attack-performed flag — CRR-ATK-038');
  });

  it('038e: source — power-token spend (attacker branch) is gated on the controller, not the figure\'s natural side', () => {
    // Token-phase "attacker" resolver:
    assert.match(COMBAT_SRC,
      /const atkPlayerNum = combat\.falseOrdersControllerPlayerNum \?\? combat\.attackerPlayerNum;\s*\n\s*const playerNum = isAttacker \? atkPlayerNum : opponentPlayerNum\(combat\.attackerPlayerNum\);/,
      'attacker-side token spend must gate on controller (falseOrdersControllerPlayerNum) — "resolver may spend one of that figure\'s power tokens" — CRR-ATK-038');
  });

  it('038f: source — surge spending is gated on the controller (resolver picks surge abilities from the controlled figure\'s pool)', () => {
    assert.match(COMBAT_SRC,
      /const effectiveAttackerForSurge = combat\.falseOrdersControllerPlayerNum \?\? attackerPlayerNum;\s*\n\s*if \(!await requirePlayer\(interaction, game, interaction\.user\.id, effectiveAttackerForSurge, canActAsPlayer, 'Only the attacker may spend surge\.'\)\) return;/,
      'surge-spend must gate on controller, so resolver picks surge abilities — CRR-ATK-038');
  });
});
