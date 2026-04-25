#!/usr/bin/env node
/**
 * dump-combat-fuzz.js — JS-side combat fuzz corpus for D6.8b JS↔Python parity.
 *
 * Generates N randomized combat cases exercising the Slice 1 dice hooks
 * (`setDiceRecorder` + `getDiceHooks`) during real `rollAttackDice` +
 * `rollDefenseDice` calls, then feeds the rolled faces into
 * `computeCombatResult` with randomized surge/bonus modifiers. Each line of
 * output captures: dice inputs, recorded face indices (for DiceStream replay),
 * raw attack/defense totals, the combat modifier context, and the final
 * `{hit, damage, effectiveBlock, resultText}` produced by the JS engine.
 *
 * The Python side (`python.parity.oracles.combat.test_js_python_combat_fuzz`)
 * reconstructs a `DiceStream` from the recorded indices, re-rolls through the
 * Python dice module, re-computes via `compute_combat_result`, and asserts
 * byte-identical parity.
 *
 * Explicit live-hook assertion: for every case we check
 * `getDiceHooks().recorder !== null` AFTER installing the recorder and BEFORE
 * any roll — this is Slice 4's user-required proof that the Slice 1 dice
 * hooks are actually exercised in parity mode (not merely present on disk).
 *
 * Usage:
 *   node tests/headless/dump-combat-fuzz.js --count 200 --seed 42 > corpus.jsonl
 */
import assert from 'node:assert/strict';
import {
  setDiceRecorder,
  clearDiceHooks,
  getDiceHooks,
  rollAttackDice,
  rollDefenseDice,
  computeCombatResult,
} from '../../src/game/combat.js';

function parseArgs(argv) {
  const args = { count: 200, seed: 42 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--count') args.count = parseInt(argv[++i], 10) || 200;
    else if (argv[i] === '--seed') args.seed = parseInt(argv[++i], 10) || 42;
  }
  return args;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function() {
    t += 0x6D2B79F5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const ATTACK_COLORS = ['red', 'yellow', 'green', 'blue'];
const DEFENSE_COLORS = ['white', 'black'];

function pick(rand, arr) { return arr[Math.floor(rand() * arr.length)]; }
function pickInt(rand, lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }
function pickBool(rand, p = 0.5) { return rand() < p; }

function randomAttackColors(rand) {
  const n = pickInt(rand, 1, 4);
  const out = [];
  for (let i = 0; i < n; i++) out.push(pick(rand, ATTACK_COLORS));
  return out;
}

function buildCase(seq, rand) {
  const diceColors = randomAttackColors(rand);
  const defenseColor = pick(rand, DEFENSE_COLORS);

  // ── Dice phase: record the real JS rolls ────────────────────────────────
  const recorder = { pools: { attack: {}, defense: {} }, log: [] };
  setDiceRecorder(recorder);

  // User-required live-hook check — PROOF that the Slice 1 hook is actually
  // being exercised, not merely present on disk.
  const hooks = getDiceHooks();
  assert.ok(hooks.recorder !== null,
    `seq ${seq}: setDiceRecorder must leave getDiceHooks().recorder non-null`);
  assert.strictEqual(hooks.recorder, recorder,
    `seq ${seq}: getDiceHooks().recorder must be the installed recorder`);

  const attackRoll = rollAttackDice(diceColors);
  const defenseRoll = rollDefenseDice(defenseColor);

  // Snapshot the recorded pools before clearing the hook. Python will replay
  // these exact face indices through its DiceStream.
  const recordedPools = {
    attack: Object.fromEntries(
      Object.entries(recorder.pools.attack).map(([k, v]) => [k, v.slice()])
    ),
    defense: Object.fromEntries(
      Object.entries(recorder.pools.defense).map(([k, v]) => [k, v.slice()])
    ),
  };
  const diceLog = recorder.log.slice();
  setDiceRecorder(null);

  // ── Combat context: randomize modifiers to exercise every pipeline branch ──
  const combat = {
    attackRoll: {
      acc: attackRoll.acc,
      dmg: attackRoll.dmg,
      surge: attackRoll.surge,
    },
    defenseRoll: {
      block: defenseRoll.block,
      evade: defenseRoll.evade,
      dodge: defenseRoll.dodge,
    },
    surgeDamage: pickInt(rand, 0, Math.max(0, attackRoll.surge)),
    surgePierce: pickInt(rand, 0, 2),
    surgeAccuracy: pickInt(rand, 0, 2),
    surgeCancel: pickBool(rand, 0.1) ? pickInt(rand, 1, 2) : 0,
    surgeConditions: pickBool(rand, 0.2) ? ['Stun'] : [],
    bonusConditions: pickBool(rand, 0.2) ? ['Bleed'] : [],
    bonusHits: pickInt(rand, 0, 2),
    bonusPierce: pickInt(rand, 0, 2),
    bonusAccuracy: pickInt(rand, 0, 2),
    bonusBlock: pickInt(rand, 0, 2),
    bonusEvade: pickInt(rand, 0, 1),
    bonusBlast: pickInt(rand, 0, 1),
    bonusDamagePerDefenseDie: pickBool(rand, 0.15) ? 1 : 0,
    defenseDiceCount: 1,
    defenderReducePierce: pickBool(rand, 0.1) ? 1 : 0,
    defenderIgnorePierce: pickBool(rand, 0.05),
    hasCunning: pickBool(rand, 0.15),
    ignoreDefenseResultsNotOnDice: pickBool(rand, 0.1),
    defenderConds: pickBool(rand, 0.15) ? ['Weaken'] : [],
    attackerConds: pickBool(rand, 0.15) ? ['Weaken'] : [],
    defenderAccuracyPenalty: pickBool(rand, 0.1) ? 1 : 0,
    isRanged: pickBool(rand, 0.5),
    distanceToTarget: pickInt(rand, 0, 5),
    maxDamageToDefender: pickBool(rand, 0.1) ? pickInt(rand, 0, 3) : null,
    forceMiss: pickBool(rand, 0.03),
    surgeCancelDodge: pickBool(rand, 0.1),
    wookieeAvengerDefend: pickBool(rand, 0.1),
    attackResultReplaceWithStun: pickBool(rand, 0.05),
    evadeCancelledSurge: 0,
  };
  // Hide adds -2 acc — include sometimes.
  if (pickBool(rand, 0.1)) combat.defenderConds = [...combat.defenderConds, 'Hide'];

  // Clone combat before compute — the function mutates defenseRoll (Wookiee
  // Avenger) and bonusConditions (Set for Stun). We want the pre-compute
  // snapshot in the corpus so Python feeds the same inputs.
  const inputCombat = JSON.parse(JSON.stringify(combat));

  const result = computeCombatResult(combat);

  return {
    seq,
    diceColors,
    defenseColor,
    recordedPools,
    diceLog,
    attackRoll: { acc: attackRoll.acc, dmg: attackRoll.dmg, surge: attackRoll.surge },
    defenseRoll: { block: defenseRoll.block, evade: defenseRoll.evade, dodge: defenseRoll.dodge },
    combat: inputCombat,
    // JS's post-compute combat state (for parity on mutations).
    combatAfter: {
      defenseRoll: combat.defenseRoll,
      bonusConditions: combat.bonusConditions,
    },
    expected: result,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rand = mulberry32(args.seed);

  for (let i = 0; i < args.count; i++) {
    const rec = buildCase(i, rand);
    process.stdout.write(JSON.stringify(rec) + '\n');
  }
  clearDiceHooks();
  // Final sanity: hooks cleared after the run.
  const finalHooks = getDiceHooks();
  assert.strictEqual(finalHooks.stream, null, 'dump script must leave stream cleared');
  assert.strictEqual(finalHooks.recorder, null, 'dump script must leave recorder cleared');
}

main();
