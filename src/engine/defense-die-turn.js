// Defense-pool die-turn (alexanbv 2026-06-16): turn one DEFENSE die to a chosen
// face and recompute the defense roll. Mirrors the attack-pool die-turn
// (_makeDieTurnResolver) but for block/evade/dodge. Used by There Is No Try
// (Yoda) at the rerolls stage, which additionally converts a Dodge on the turned
// die to 2 Blocks + 1 Evade.
//
// The recompute is pure so it can be unit-tested; the interactive picker (combat.js
// _makeDefenseDieTurnResolver) calls it after the player chooses die + face.

/**
 * Turn defense die `dieIdx` to `newFace` ({block, evade, dodge}), then recompute
 * combat.defenseRoll from ALL defense dice. When `dodgeConversion` is set (Yoda),
 * a Dodge on the TURNED die counts as 2 Blocks + 1 Evade instead of a dodge
 * (other dice keep their dodge). Mutates combat in place; returns the new
 * defenseRoll.
 */
export function applyDefenseDieTurn(combat, dieIdx, newFace, dodgeConversion = false) {
  const dice = combat?.defenseDiceResults;
  if (!Array.isArray(dice) || !dice[dieIdx] || !newFace) return combat?.defenseRoll;
  dice[dieIdx] = {
    ...dice[dieIdx],
    block: newFace.block || 0,
    evade: newFace.evade || 0,
    dodge: !!newFace.dodge,
    // Mark the turned die so the recompute applies Yoda's Dodge conversion to it only.
    _dodgeToBlocksEvade: !!dodgeConversion,
  };
  let block = 0;
  let evade = 0;
  let dodge = false;
  for (const d of dice) {
    if (d?._dodgeToBlocksEvade && d.dodge) {
      block += 2;
      evade += 1; // Dodge → 2 Blocks + 1 Evade (no dodge contributed)
    } else {
      block += d?.block || 0;
      evade += d?.evade || 0;
      if (d?.dodge) dodge = true;
    }
  }
  combat.defenseRoll = { block, evade, dodge };
  return combat.defenseRoll;
}

/**
 * Remove a defense die's RESULTS (Heightened Reflexes: "choose 1 defense die and
 * remove its results from the defense results"). Zeroes the chosen die's
 * block/evade/dodge and recomputes combat.defenseRoll from all defense dice.
 * Mutates combat in place; returns the new defenseRoll.
 */
export function applyDefenseDieRemoval(combat, dieIdx) {
  const dice = combat?.defenseDiceResults;
  if (!Array.isArray(dice) || !dice[dieIdx]) return combat?.defenseRoll;
  dice[dieIdx] = { ...dice[dieIdx], block: 0, evade: 0, dodge: false, _removed: true };
  let block = 0;
  let evade = 0;
  let dodge = false;
  for (const d of dice) {
    if (d?._dodgeToBlocksEvade && d.dodge) { block += 2; evade += 1; }
    else { block += d?.block || 0; evade += d?.evade || 0; if (d?.dodge) dodge = true; }
  }
  combat.defenseRoll = { block, evade, dodge };
  return combat.defenseRoll;
}

/**
 * Remove an ATTACK die's RESULTS (Feint: "choose 1 attack die and remove its
 * results from the attack results"). Zeroes the chosen die's dmg/surge/acc and
 * recomputes combat.attackRoll from all attack dice. Mutates combat in place;
 * returns the new attackRoll. Mirrors applyDefenseDieRemoval for the attack pool.
 */
export function applyAttackDieRemoval(combat, dieIdx) {
  const dice = combat?.attackDiceResults;
  if (!Array.isArray(dice) || !dice[dieIdx]) return combat?.attackRoll;
  dice[dieIdx] = { ...dice[dieIdx], dmg: 0, surge: 0, acc: 0, _removed: true };
  let acc = 0;
  let dmg = 0;
  let surge = 0;
  for (const d of dice) { acc += d?.acc || 0; dmg += d?.dmg || 0; surge += d?.surge || 0; }
  combat.attackRoll = { acc, dmg, surge };
  return combat.attackRoll;
}
