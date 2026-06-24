/**
 * Headless driver for the GATE combat sequence. Runs a full attack through
 * runAttackSequence and auto-advances every interactive ability gate by
 * simulating the "Done" pick (combat_<window>_pick_<gameId>_done) through the
 * generic handleModsPick handler. Ready-sync gates (combat_gate_) auto-drain
 * under game.selfPlay, and mechanic steps (roll/surge/damage) self-run, so
 * auto-passing the ability gates is enough to walk an attack to completion.
 *
 * Use this to flush crashes across the whole step machine (on_declare → roll →
 * rerolls → special → mods → spend_surges → zillo → damage → after_resolve)
 * for many DC matchups without a human clicking buttons.
 */
import { runAttackSequence, handleModsPick, handleCombatSurge } from '../../src/handlers/combat.js';
import { activeSide } from '../../src/engine/combat-ability-gate.js';

// Gate field on `combat` → that window's pick-button customId prefix.
const GATE_FIELDS = [
  ['onDeclareGate', 'combat_ondeclare_pick_'],
  ['rerollsGate', 'combat_rerolls_pick_'],
  ['specialGate', 'combat_special_pick_'],
  ['modsGate', 'combat_mods_pick_'],
  ['zilloGate', 'combat_zillo_pick_'],
  ['afterResolveGate', 'combat_afterresolve_pick_'],
];

function fakeInteraction(customId, client, userId = '') {
  return {
    customId,
    client,
    user: { id: userId },
    deferUpdate: async () => {},
    update: async () => {},
    followUp: async () => {},
    message: { components: [], edit: async () => ({}), delete: async () => ({}) },
  };
}

/** Find the gate currently awaiting a player pick, if any. */
function parkedGate(combat) {
  for (const [field, prefix] of GATE_FIELDS) {
    const g = combat[field];
    if (g && activeSide(g)) return { field, prefix };
  }
  return null;
}

/**
 * Drive an attack through the gate to completion, auto-passing (Done) every
 * ability gate. Returns { steps, finalStep, threw }. Never rejects — captures
 * any thrown error so a battery can report which matchup crashed.
 */
export async function driveGateAttackToEnd(game, combat, deps, thread, { maxPasses = 300 } = {}) {
  game.pendingCombat = combat;
  const client = deps.client;
  let threw = null;
  let passes = 0;
  try {
    await runAttackSequence(thread, game, combat, deps);
    while (passes < maxPasses) {
      const gate = parkedGate(combat);
      if (gate) {
        passes++;
        // Click "Done" AS the player the window is prompted for — handleModsPick
        // now locks each window to its side's player (alexanbv 2026-06-23), so
        // pass that side's user id (mirrors the surge call below).
        const _g = combat[gate.field];
        const _side = activeSide(_g);
        const _atkPn = combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum ?? 1;
        const _defPn = combat.defenderPlayerNum ?? (_atkPn === 1 ? 2 : 1);
        const _sidePn = _side === 'attacker' ? _atkPn : _defPn;
        const _sideId = game[`player${_sidePn}Id`] || '';
        await handleModsPick(fakeInteraction(`${gate.prefix}${game.gameId}_done`, client, _sideId), deps);
        continue;
      }
      // Surge window (spend_surges step) — the attacker spends/declines surges.
      // sendReadyToResolveRolls auto-advances the sequence on "Done".
      if (combat._seqActive && combat._seqStep === 'spend_surges') {
        passes++;
        // Effective attacker = the False Orders controller, else the attacker.
        const atkPn = combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum;
        const atkId = game[`player${atkPn}Id`] || '';
        await handleCombatSurge(fakeInteraction(`combat_surge_${game.gameId}_done`, client, atkId), deps);
        // If still parked at spend_surges, it failed to advance — stop (real stall).
        if (combat._seqStep === 'spend_surges') break;
        continue;
      }
      break;
    }
  } catch (e) {
    threw = e;
  }
  return { passes, finalStep: combat._seqStep, threw, hitGuard: passes >= maxPasses };
}
