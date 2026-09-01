/**
 * Shared "turn a die to any side" picker.
 *
 * Several cards let a player set a rolled die to a face of their choice rather
 * than reroll it. A reroll is random; setting a face is deterministic, so the
 * two are not interchangeable — Rapid Recalibration was resolving as a reroll
 * and came out strictly weaker than printed (alexanbv 2026-08-31: "rapid recall
 * is a picker", "a dice picker face is needed. This is used by many other
 * abilities including Zeb, Ezra, Yoda CC, etc.").
 *
 * There Is No Try already had this flow, hardcoded to defense dice inside the
 * Yoda reaction handler. These helpers are the pool-agnostic core of it, so
 * attack-die cards do not need a near-copy.
 *
 * Selectable faces always come from the single canonical source
 * (`data/dice.json` via `getDistinctDieFaces`) so "set to any side" lists the
 * die's REAL faces and never an invented one — alexanbv 2026-06-21, when There
 * Is No Try was switched onto that source.
 *
 * Everything here is pure: no discord.js, no game mutation in place. Handlers
 * build buttons from `faceOptionsFor` + `formatFaceLabel` + `encodeFace`, then
 * apply the result with `applyFaceToDie` and recompute with `totalsFor`.
 */

import { getDistinctDieFaces } from '../data-loader.js';

/** Pools that can be picked over. Matches the keys in data/dice.json. */
export const DIE_POOLS = ['attack', 'defense'];

/**
 * The distinct faces of one die, as pickable options.
 * @param {'attack'|'defense'} pool
 * @param {string} color die colour (red/yellow/green/blue, white/black)
 * @returns {Array<object>} distinct faces, in the order dice.json lists them
 */
export function faceOptionsFor(pool, color) {
  if (!DIE_POOLS.includes(pool)) return [];
  return getDistinctDieFaces(pool, color) || [];
}

/**
 * Short button label for a face. Attack faces read as damage/surge/accuracy;
 * defense faces as block/evade, with Dodge called out.
 * Kept under Discord's 80-character button-label cap by the caller.
 */
export function formatFaceLabel(pool, face) {
  if (!face) return '?';
  if (pool === 'attack') {
    const parts = [];
    if (face.dmg) parts.push(`${face.dmg} Damage`);
    if (face.surge) parts.push(`${face.surge} Surge`);
    if (face.acc) parts.push(`${face.acc} Acc`);
    return parts.length ? parts.join(' / ') : 'Blank';
  }
  return `${face.block ?? 0}B/${face.evade ?? 0}E${face.dodge ? '/Dodge' : ''}`;
}

/**
 * Encode a face into customId-safe segments (no underscores, all numeric)
 * so it survives a round trip through a Discord button id.
 * @returns {string} e.g. "0_2_1" for attack (acc_dmg_surge)
 */
export function encodeFace(pool, face) {
  if (pool === 'attack') {
    return `${face.acc ?? 0}_${face.dmg ?? 0}_${face.surge ?? 0}`;
  }
  return `${face.block ?? 0}_${face.evade ?? 0}_${face.dodge ? 1 : 0}`;
}

/**
 * Inverse of `encodeFace`. Takes the already-split customId segments.
 * @param {'attack'|'defense'} pool
 * @param {string[]} parts three numeric segments
 */
export function decodeFace(pool, parts) {
  const n = (i) => parseInt(parts[i], 10) || 0;
  if (pool === 'attack') return { acc: n(0), dmg: n(1), surge: n(2) };
  return { block: n(0), evade: n(1), dodge: n(2) === 1 };
}

/**
 * Apply a chosen face to one die, returning a NEW die object.
 *
 * The die keeps its colour. `faceIdx` is dropped because the die is no longer
 * showing a rolled face, and leaving a stale index would let anything that
 * re-derives results from the index silently undo the pick.
 *
 * Defense only: a Dodge face is folded into +2 Block / +1 Evade rather than
 * left as a dodge flag, matching what There Is No Try has always done — a
 * dodge cancels the whole attack, and the card converts it instead.
 */
export function applyFaceToDie(pool, die, face) {
  const base = { ...(die || {}) };
  delete base.faceIdx;
  if (pool === 'attack') {
    return { ...base, acc: face.acc ?? 0, dmg: face.dmg ?? 0, surge: face.surge ?? 0 };
  }
  if (face.dodge) {
    return { ...base, block: (face.block ?? 0) + 2, evade: (face.evade ?? 0) + 1, dodge: false };
  }
  return { ...base, block: face.block ?? 0, evade: face.evade ?? 0, dodge: false };
}

/**
 * Re-total a pool after a face was set. Returns the shape the combat object
 * stores for that pool's roll.
 */
export function totalsFor(pool, dice) {
  const list = Array.isArray(dice) ? dice : [];
  if (pool === 'attack') {
    return list.reduce(
      (a, d) => ({
        acc: a.acc + (d?.acc ?? 0),
        dmg: a.dmg + (d?.dmg ?? 0),
        surge: a.surge + (d?.surge ?? 0),
      }),
      { acc: 0, dmg: 0, surge: 0 },
    );
  }
  return list.reduce(
    (a, d) => ({
      block: a.block + (d?.block ?? 0),
      evade: a.evade + (d?.evade ?? 0),
      dodge: a.dodge + (d?.dodge ? 1 : 0),
    }),
    { block: 0, evade: 0, dodge: 0 },
  );
}

/** Human-readable summary of a pool's totals, for the confirmation message. */
export function formatTotals(pool, totals) {
  if (pool === 'attack') {
    return `${totals.dmg} damage, ${totals.surge} surge, ${totals.acc} accuracy`;
  }
  return `${totals.block} block, ${totals.evade} evade`;
}
