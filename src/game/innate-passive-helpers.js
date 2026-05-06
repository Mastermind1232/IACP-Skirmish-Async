/**
 * Parse innate (printed-on-card) passive bonuses from a DC's passives strings
 * and apply them to combat as modifiers.
 *
 * Per destruct's 2026-05-06 ruling: passives like "Block 1", "+1 Evade",
 * "+1 Damage", "+1 Surge" are PRINTED on the figure's card and apply on
 * every attack/defense. They are MODIFIERS (not on the die) — meaning
 * Overwhelming Impact's "ignore non-die bonuses" correctly drops the
 * passive +Block / +Evade. Routing them through `combat.bonusHits`,
 * `combat.bonusBlock`, `combat.bonusEvade`, `combat.bonusSurge` plugs
 * into the existing OI gate at src/game/combat.js:322-324 which reads
 * `bonusBlock` (and `cunningBonus`) as the "ignored" pool.
 *
 * Strings handled (case-insensitive, trimmed): "+N Damage", "Damage N",
 * "+N Hit", "+N Hits", "+N Surge", "+N Block", "Block N", "+N Evade",
 * "Evade N". Multi-bonus strings like "+1 Hit, +1 Accuracy, +1 Block"
 * are split on commas and each part parsed independently.
 *
 * Out of scope (per destruct's specific list 2026-05-06): +Accuracy and
 * Pierce — these are tracked separately and have other wiring paths.
 */

/**
 * Parse one passive token into structured deltas.
 * Returns an object like { damage, surge, block, evade, accuracy, pierce, blast }
 * where each key is the additive bonus this token contributes.
 *
 * Scope-expanded 2026-05-06 per destruct: now covers +Accuracy, Pierce,
 * and Blast in addition to the original +dmg/+surge/+block/+evade.
 */
function parseToken(token) {
  const out = { damage: 0, surge: 0, block: 0, evade: 0, accuracy: 0, pierce: 0, blast: 0 };
  if (!token || typeof token !== 'string') return out;
  const t = token.trim().toLowerCase();
  if (!t) return out;
  // "+N word" or "word N" — match either order
  let m = t.match(/^\+?(\d+)\s*(damage|hit|hits|surge|block|evade|accuracy|pierce|blast|cleave)$/);
  if (!m) {
    m = t.match(/^(damage|hit|hits|surge|block|evade|accuracy|pierce|blast|cleave)\s*(\d+)$/);
    if (m) m = [m[0], m[2], m[1]];
  }
  if (!m) return out;
  const n = parseInt(m[1], 10) || 0;
  const word = m[2];
  if (word === 'damage' || word === 'hit' || word === 'hits') out.damage += n;
  else if (word === 'surge') out.surge += n;
  else if (word === 'block') out.block += n;
  else if (word === 'evade') out.evade += n;
  else if (word === 'accuracy') out.accuracy += n;
  else if (word === 'pierce') out.pierce += n;
  else if (word === 'blast') out.blast += n;
  // 'cleave' kept in regex for future-proofing; unused fields stay 0.
  return out;
}

/**
 * Parse a passives array from a DC effect into a single combined delta.
 * Splits multi-bonus strings on commas first.
 *
 * @param {string[]} passives
 * @returns {{ damage: number, surge: number, block: number, evade: number }}
 */
export function parseInnatePassives(passives) {
  const total = { damage: 0, surge: 0, block: 0, evade: 0, accuracy: 0, pierce: 0, blast: 0 };
  if (!Array.isArray(passives)) return total;
  for (const raw of passives) {
    if (!raw || typeof raw !== 'string') continue;
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    for (const p of parts) {
      const tok = parseToken(p);
      total.damage += tok.damage;
      total.surge += tok.surge;
      total.block += tok.block;
      total.evade += tok.evade;
      total.accuracy += tok.accuracy;
      total.pierce += tok.pierce;
      total.blast += tok.blast;
    }
  }
  return total;
}

/**
 * Apply the attacker's innate +Damage / +Surge passives to combat.
 * Mutates `combat.bonusHits` and `combat.bonusSurge`.
 */
export function applyInnateAttackerPassives(combat, dcEffect) {
  if (!combat || !dcEffect) return;
  const { damage, surge, accuracy, pierce, blast } = parseInnatePassives(dcEffect.passives);
  if (damage > 0) combat.bonusHits = (combat.bonusHits || 0) + damage;
  if (surge > 0) combat.bonusSurge = (combat.bonusSurge || 0) + surge;
  if (accuracy > 0) combat.bonusAccuracy = (combat.bonusAccuracy || 0) + accuracy;
  if (pierce > 0) combat.bonusPierce = (combat.bonusPierce || 0) + pierce;
  if (blast > 0) combat.bonusBlast = (combat.bonusBlast || 0) + blast;
}

/**
 * Apply the defender's innate +Block / +Evade passives to combat.
 * Mutates `combat.bonusBlock` and `combat.bonusEvade`. Both fields are
 * dropped by Overwhelming Impact's `ignoreDefenseResultsNotOnDice` gate
 * in computeCombatResult — that's the correct CRR semantic.
 */
export function applyInnateDefenderPassives(combat, dcEffect) {
  if (!combat || !dcEffect) return;
  const { block, evade } = parseInnatePassives(dcEffect.passives);
  if (block > 0) combat.bonusBlock = (combat.bonusBlock || 0) + block;
  if (evade > 0) combat.bonusEvade = (combat.bonusEvade || 0) + evade;
}
