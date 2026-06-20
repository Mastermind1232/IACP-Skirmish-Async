// Generic reroll method — the single reroll primitive every reroll ability calls
// (alexanbv 2026-06-15: "each ability should call a reroll function with certain
// inputs: which die can be selected, whether the color can be swapped, how many
// dice, etc."). The rerolls gate posts a button per available reroll ability;
// clicking one calls this with that ability's params. No per-ability reroll
// re-implementation; the combined reroll lock (no die rerolled twice by anybody;
// Zeb / Rapid Recalibration exempt via specialTurn) lives here.
//
// PURE over injected roll + recalc helpers (rollSingleAttackDie /
// rollSingleDefenseDie / recalcAttackTotals / recalcDefenseTotals), so it is
// unit-tested without Discord/game wiring.

import { dieId, canRerollDie, markDieRerolled } from './combat-reroll-lock.js';

/** Dice array + totals field for a pool. */
function poolFields(pool) {
  return pool === 'attack'
    ? { dice: 'attackDiceResults', totals: 'attackRoll' }
    : { dice: 'defenseDiceResults', totals: 'defenseRoll' };
}

/**
 * The indices in `pool` a reroll ability may currently select: pass the
 * ability's eligibility predicate; the lock removes already-rerolled dice
 * (unless specialTurn). Used by the UI layer to render the die picker.
 * @param {object} combat
 * @param {object} p  { pool, eligible?:(die,idx)=>boolean, specialTurn?:boolean }
 * @returns {number[]}
 */
export function selectableDieIndices(combat, { pool, eligible, specialTurn = false } = {}) {
  const dice = combat[poolFields(pool).dice];
  if (!Array.isArray(dice)) return [];
  const out = [];
  for (let i = 0; i < dice.length; i++) {
    if (eligible && !eligible(dice[i], i)) continue;
    if (!canRerollDie(combat, dieId(pool, i), { specialTurn })) continue;
    out.push(i);
  }
  return out;
}

/**
 * Reroll ONE die. Respects the combined lock (skips if already rerolled, unless
 * specialTurn). Optional color swap (Saska) rolls the new die in `newColor`.
 * Replaces the die in its pool, locks it (unless specialTurn), recalculates the
 * pool totals onto combat.attackRoll / combat.defenseRoll.
 * @param {object} combat
 * @param {object} deps  { rollSingleAttackDie, rollSingleDefenseDie, recalcAttackTotals, recalcDefenseTotals }
 * @param {object} p     { pool:'attack'|'defense', index:number, newColor?:string, specialTurn?:boolean }
 * @returns {{ok:true,newDie:object,totals:object}|{ok:false,reason:string}}
 */
export function rerollDie(combat, deps, { pool, index, newColor, specialTurn = false } = {}) {
  if (pool !== 'attack' && pool !== 'defense') return { ok: false, reason: 'bad-pool' };
  const id = dieId(pool, index);
  if (!canRerollDie(combat, id, { specialTurn })) return { ok: false, reason: 'locked' };
  const { dice: diceField, totals: totalsField } = poolFields(pool);
  const dice = combat[diceField];
  if (!Array.isArray(dice) || !dice[index]) return { ok: false, reason: 'no-die' };
  const color = newColor || dice[index].color;
  const rollOne = pool === 'attack' ? deps.rollSingleAttackDie : deps.rollSingleDefenseDie;
  const recalc = pool === 'attack' ? deps.recalcAttackTotals : deps.recalcDefenseTotals;
  if (typeof rollOne !== 'function' || typeof recalc !== 'function') return { ok: false, reason: 'no-deps' };
  const oldDie = dice[index];
  const newDie = rollOne(color);
  dice[index] = newDie;
  if (!specialTurn) markDieRerolled(combat, id);
  const totals = recalc(dice);
  combat[totalsField] = totals;
  // Record the most recent reroll so the gate can offer Tough Luck on it
  // (attack die → defender may react; defense die → attacker). alexanbv 2026-06-17.
  // prevSymbols/newSymbols: the WHOLE-die symbol counts before/after, so the gate
  // can offer the Double or Nothing reaction ("if the rerolled result has the same
  // number of symbols, you may double or cancel"). alexanbv 2026-06-20.
  const _symOf = pool === 'attack'
    ? (d) => (d ? (d.dmg || 0) + (d.surge || 0) + (d.acc || 0) : 0)
    : (d) => (d ? (d.block || 0) + (d.evade || 0) + (d.dodge ? (typeof d.dodge === 'number' ? d.dodge : 1) : 0) : 0);
  combat._lastRerolledDie = { pool, index, prevSymbols: _symOf(oldDie), newSymbols: _symOf(newDie) };
  // A color-swap reroll is Lando's Gambit (or Saska): record a DURABLE marker of
  // the swapped die so Cheat to Win ("change THAT die's result to another result
  // on that die") can identify and constrain to the Gambit die's color even after
  // the transient _lastRerolledDie is cleared when the rerolls window drains.
  if (newColor) combat._lastGambitDie = { pool, index, color };
  return { ok: true, newDie, totals };
}
