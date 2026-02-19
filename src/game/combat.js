/**
 * Combat logic: dice rolls, surge abilities, result computation. No Discord.
 */
import { getDiceData, getDcEffects } from '../data-loader.js';

export function rollAttackDice(diceColors) {
  let acc = 0, dmg = 0, surge = 0;
  for (const color of diceColors || []) {
    const faces = getDiceData().attack?.[color.toLowerCase()];
    if (!faces?.length) continue;
    const face = faces[Math.floor(Math.random() * faces.length)];
    acc += face.acc ?? 0;
    dmg += face.dmg ?? 0;
    surge += face.surge ?? 0;
  }
  return { acc, dmg, surge };
}

export function rollDefenseDice(defenseType) {
  const faces = getDiceData().defense?.[(defenseType || 'white').toLowerCase()];
  if (!faces?.length) return { block: 0, evade: 0 };
  const face = faces[Math.floor(Math.random() * faces.length)];
  return { block: face.block ?? 0, evade: face.evade ?? 0 };
}

/** Display labels for surge abilities (subset; raw key used if missing). */
export const SURGE_LABELS = {
  'damage 1': '+1 Hit', 'damage 2': '+2 Hits', 'damage 3': '+3 Hits',
  'pierce 1': 'Pierce 1', 'pierce 2': 'Pierce 2', 'pierce 3': 'Pierce 3',
  'accuracy 1': '+1 Accuracy', 'accuracy 2': '+2 Accuracy', 'accuracy 3': '+3 Accuracy',
  'stun': 'Stun', 'weaken': 'Weaken', 'bleed': 'Bleed', 'hide': 'Hide', 'focus': 'Focus',
  'blast 1': 'Blast 1', 'blast 2': 'Blast 2', 'recover 1': 'Recover 1', 'recover 2': 'Recover 2', 'recover 3': 'Recover 3',
  'cleave 1': 'Cleave 1', 'cleave 2': 'Cleave 2',
  '+1 hit': '+1 Hit', '+2 hits': '+2 Hits', '+1 hit, stun': '+1 Hit, Stun', '+1 hit, pierce 1': '+1 Hit, Pierce 1',
  'accuracy 2, surge 1': '+2 Accuracy, +1 Surge', 'damage 2, hide': '+2 Hits, Hide',
};

/** Get attacker's surge abilities from dc-effects + combat.bonusSurgeAbilities (CCs like Spinning Kick). */
export function getAttackerSurgeAbilities(combat) {
  const card = getDcEffects()[combat.attackerDcName] || getDcEffects()[combat.attackerDcName?.replace(/\s*\[.*\]\s*$/, '')];
  const base = card?.surgeAbilities || [];
  const bonus = combat?.bonusSurgeAbilities || [];
  return [...base, ...bonus];
}

/** Parse a surge ability key into modifiers. F6: blast, recover, cleave. */
export function parseSurgeEffect(key) {
  const out = { damage: 0, pierce: 0, accuracy: 0, conditions: [], blast: 0, recover: 0, cleave: 0 };
  const parts = String(key || '').toLowerCase().trim().split(/\s*,\s*/);
  for (const p of parts) {
    const dmg = p.match(/^damage\s+(\d+)$/); if (dmg) { out.damage += parseInt(dmg[1], 10); continue; }
    const hit = p.match(/^\+(\d+)\s+hit(s?)$/); if (hit) { out.damage += parseInt(hit[1], 10); continue; }
    const pierce = p.match(/^pierce\s+(\d+)$/); if (pierce) { out.pierce += parseInt(pierce[1], 10); continue; }
    const acc = p.match(/^accuracy\s+(\d+)$/); if (acc) { out.accuracy += parseInt(acc[1], 10); continue; }
    const blast = p.match(/^blast\s+(\d+)$/); if (blast) { out.blast += parseInt(blast[1], 10); continue; }
    const recover = p.match(/^recover\s+(\d+)$/); if (recover) { out.recover += parseInt(recover[1], 10); continue; }
    const cleave = p.match(/^cleave\s+(\d+)$/); if (cleave) { out.cleave += parseInt(cleave[1], 10); continue; }
    if (p === 'stun') out.conditions.push('Stun');
    else if (p === 'weaken') out.conditions.push('Weaken');
    else if (p === 'bleed') out.conditions.push('Bleed');
    else if (p === 'hide') out.conditions.push('Hide');
    else if (p === 'focus') out.conditions.push('Focus');
  }
  return out;
}

/**
 * Pure combat result from rolls and surge. No Discord, no game state.
 * @param {object} combat - { attackRoll, defenseRoll, surgeDamage, surgePierce, surgeAccuracy, surgeConditions }
 * @returns {{ hit: boolean, damage: number, effectiveBlock: number, resultText: string }}
 */
export function computeCombatResult(combat) {
  const roll = combat.attackRoll;
  const defRoll = combat.defenseRoll;
  const surgeD = combat.surgeDamage || 0;
  const surgeP = combat.surgePierce || 0;
  const bonusPierce = combat.bonusPierce || 0;
  const totalPierce = surgeP + bonusPierce;
  const surgeA = combat.surgeAccuracy || 0;
  const bonusAcc = combat.bonusAccuracy || 0;
  const bonusHits = combat.bonusHits || 0;
  const bonusBlock = combat.bonusBlock || 0;
  const bonusEvade = combat.bonusEvade || 0;
  const totalEvade = defRoll.evade + bonusEvade;
  const evadeCancelled = combat.evadeCancelledSurge || 0;
  const totalAccuracy = roll.acc + surgeA + bonusAcc;
  let hit = true;
  let missReason = '';
  if (combat.isRanged && combat.distanceToTarget != null) {
    if (totalAccuracy < combat.distanceToTarget) {
      hit = false;
      missReason = `insufficient accuracy (${totalAccuracy} < ${combat.distanceToTarget} distance)`;
    }
  }
  const pierceToUse = combat.defenderIgnorePierce ? 0 : totalPierce;
  const blockForCalc = combat.ignoreDefenseResultsNotOnDice ? defRoll.block : (defRoll.block + bonusBlock);
  const effectiveBlock = Math.max(0, blockForCalc - pierceToUse);
  const defenseDiceCount = combat.defenseDiceCount ?? 1;
  const perDefDieDamage = (combat.bonusDamagePerDefenseDie || 0) * defenseDiceCount;
  let damage = hit ? Math.max(0, roll.dmg + surgeD + bonusHits + perDefDieDamage - effectiveBlock) : 0;
  if (combat.maxDamageToDefender != null && damage > combat.maxDamageToDefender) damage = combat.maxDamageToDefender;
  const allConds = [...(combat.surgeConditions || []), ...(combat.bonusConditions || [])];
  if (combat.attackResultReplaceWithStun && damage > 0) {
    damage = 0;
    if (!(combat.bonusConditions || []).includes('Stun')) {
      combat.bonusConditions = combat.bonusConditions || [];
      combat.bonusConditions.push('Stun');
    }
  }
  const conditionsText = allConds.length ? ` (${allConds.join(', ')})` : '';
  const bonusBlast = combat.bonusBlast || 0;
  const totalBlastDisplay = (combat.surgeBlast || 0) + bonusBlast;
  const blastText = totalBlastDisplay ? ` Blast ${totalBlastDisplay}` : '';
  const recoverText = combat.surgeRecover ? ` Recover ${combat.surgeRecover}` : '';
  const cleaveText = combat.surgeCleave ? ` Cleave ${combat.surgeCleave}` : '';

  let resultText = `**Result:** Attack: ${roll.acc} acc, ${roll.dmg} dmg, ${roll.surge} surge | Defense: ${defRoll.block} block, ${defRoll.evade} evade`;
  if (bonusAcc) resultText += ` | CC bonus: +${bonusAcc} acc`;
  if (bonusHits || perDefDieDamage) resultText += ` | CC bonus: +${(bonusHits || 0) + perDefDieDamage} Hit`;
  if (bonusBlock && !combat.ignoreDefenseResultsNotOnDice) resultText += ` | CC bonus: +${bonusBlock} Block`;
  if (combat.ignoreDefenseResultsNotOnDice) resultText += ' | CC: ignore defense not on dice';
  if (evadeCancelled > 0) resultText += ` | Evade cancelled ${evadeCancelled} surge`;
  if (bonusEvade) resultText += ` | CC bonus: +${bonusEvade} Evade`;
  if (bonusPierce) resultText += ` | CC bonus: +${bonusPierce} pierce`;
  if (bonusBlast) resultText += ` | CC bonus: Blast ${bonusBlast}`;
  if ((combat.bonusConditions || []).length) resultText += ` | CC bonus: ${combat.bonusConditions.join(', ')}`;
  if (surgeD || surgeP || surgeA || conditionsText || blastText || recoverText || cleaveText) {
    resultText += ` | Surge: +${surgeD} dmg, +${surgeP} pierce, +${surgeA} acc${conditionsText}${blastText}${recoverText}${cleaveText}`;
  }
  if (combat.isRanged && combat.distanceToTarget != null) {
    resultText += ` | Accuracy: ${totalAccuracy} vs ${combat.distanceToTarget} distance`;
  }
  if (!hit) resultText += missReason ? ` → **Miss** (${missReason})` : ' → **Miss**';
  else resultText += ` → **${damage} damage**${conditionsText}`;
  if (combat.attackResultReplaceWithStun) resultText += ' (Set for Stun: 0 damage, Stunned)';

  return { hit, damage, effectiveBlock, resultText };
}
