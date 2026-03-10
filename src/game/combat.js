/**
 * Combat logic: dice rolls, surge abilities, result computation. No Discord.
 */
import { getDiceData, getDcEffects } from '../data-loader.js';

export function rollAttackDice(diceColors) {
  const dice = [];
  let acc = 0, dmg = 0, surge = 0;
  for (const color of diceColors || []) {
    const faces = getDiceData().attack?.[color.toLowerCase()];
    if (!faces?.length) continue;
    const face = faces[Math.floor(Math.random() * faces.length)];
    const result = { color, acc: face.acc ?? 0, dmg: face.dmg ?? 0, surge: face.surge ?? 0 };
    dice.push(result);
    acc += result.acc;
    dmg += result.dmg;
    surge += result.surge;
  }
  return { acc, dmg, surge, dice };
}

export function rollDefenseDice(defenseType) {
  const color = defenseType || 'white';
  const faces = getDiceData().defense?.[color.toLowerCase()];
  if (!faces?.length) return { color, block: 0, evade: 0, dodge: false };
  const face = faces[Math.floor(Math.random() * faces.length)];
  return { color, block: face.block ?? 0, evade: face.evade ?? 0, dodge: !!face.dodge };
}

/** Roll a single attack die by color. Returns individual face result. */
export function rollSingleAttackDie(color) {
  const faces = getDiceData().attack?.[color.toLowerCase()];
  if (!faces?.length) return { color, acc: 0, dmg: 0, surge: 0 };
  const face = faces[Math.floor(Math.random() * faces.length)];
  return { color, acc: face.acc ?? 0, dmg: face.dmg ?? 0, surge: face.surge ?? 0 };
}

/** Roll a single defense die by color. Returns individual face result. */
export function rollSingleDefenseDie(color) {
  const faces = getDiceData().defense?.[(color || 'white').toLowerCase()];
  if (!faces?.length) return { color, block: 0, evade: 0, dodge: false };
  const face = faces[Math.floor(Math.random() * faces.length)];
  return { color, block: face.block ?? 0, evade: face.evade ?? 0, dodge: !!face.dodge };
}

/** Recalculate attack totals from individual dice results. */
export function recalcAttackTotals(dice) {
  let acc = 0, dmg = 0, surge = 0;
  for (const d of dice) { acc += d.acc ?? 0; dmg += d.dmg ?? 0; surge += d.surge ?? 0; }
  return { acc, dmg, surge };
}

/** Recalculate defense totals from individual dice results. */
export function recalcDefenseTotals(dice) {
  let block = 0, evade = 0, dodge = false;
  for (const d of dice) { block += d.block ?? 0; evade += d.evade ?? 0; if (d.dodge) dodge = true; }
  return { block, evade, dodge };
}

/**
 * Determine innate reroll counts from DC ability text.
 * Parses common patterns: "you may reroll N attack/defense di(c)e"
 */
export function getInnateRerolls(dcName) {
  const card = getDcEffects()[dcName] || getDcEffects()[dcName?.replace(/\s*\[.*\]\s*$/, '')];
  const text = (card?.abilityText || '').toLowerCase();
  let attackReroll = 0, defenseReroll = 0;
  const atkMatch = text.match(/while attacking.*?reroll\s+(?:up to\s+)?(\d+)\s+attack\s+di/);
  if (atkMatch) attackReroll = parseInt(atkMatch[1], 10) || 1;
  else if (/professional/i.test(text)) attackReroll = 1;
  const defMatch = text.match(/while defending.*?reroll\s+(?:up to\s+)?(\d+)\s+defense?\s+di/);
  if (defMatch) defenseReroll = parseInt(defMatch[1], 10) || 1;
  return { attackReroll, defenseReroll };
}

/** Display labels for surge abilities (subset; raw key used if missing). */
export const SURGE_LABELS = {
  'damage 1': '+1 Hit', 'damage 2': '+2 Hits', 'damage 3': '+3 Hits',
  'pierce 1': 'Pierce 1', 'pierce 2': 'Pierce 2', 'pierce 3': 'Pierce 3',
  'accuracy 1': '+1 Accuracy', 'accuracy 2': '+2 Accuracy', 'accuracy 3': '+3 Accuracy',
  'stun': 'Stun', 'weaken': 'Weaken', 'bleed': 'Bleed', 'hide': 'Hide', 'focus': 'Focus',
  'blast 1': 'Blast 1', 'blast 2': 'Blast 2', 'recover 1': 'Recover 1', 'recover 2': 'Recover 2', 'recover 3': 'Recover 3',
  'cleave 1': 'Cleave 1', 'cleave 2': 'Cleave 2', 'cleave X': 'Cleave X', 'recover X': 'Recover X',
  '+1 hit': '+1 Hit', '+2 hits': '+2 Hits', '+1 hit, stun': '+1 Hit, Stun', '+1 hit, pierce 1': '+1 Hit, Pierce 1',
  'accuracy 2, surge 1': '+2 Accuracy, +1 Surge', 'damage 2, hide': '+2 Hits, Hide',
  'agitate': 'Agitate', 'fell_swoop': 'Fell Swoop', 'mastery': 'Mastery', 'interrogate': 'Interrogate',
  'utinni_vp_1': 'Utinni! (+1 VP)',
  'autofire_chain': 'Chain Attack (within 3)',
  'military_efficiency': 'Military Efficiency',
  'deadly': 'Deadly (-1 Dodge)',
  'gain 1': '+1 VP',
  'accuracy 2, pierce 1': '+2 Accuracy, Pierce 1',
  'evade token': 'Gain Evade Token',
};

/** Get attacker's surge abilities from dc-effects + combat.bonusSurgeAbilities (CCs like Spinning Kick).
 *  Double-surge abilities (cost 2) are tagged with the "double:" prefix. */
export function getAttackerSurgeAbilities(combat) {
  // Tusken Cycler: no abilities (including surge abilities) during this attack
  if (combat.blockSurgeAbilities) return [];
  // Reverse Engineer: use the defender's DC surge abilities instead of the attacker's
  const surgeDcName = combat.reverseEngineerActive ? (combat.defenderDcName ?? combat.attackerDcName) : combat.attackerDcName;
  const card = getDcEffects()[surgeDcName] || getDcEffects()[surgeDcName?.replace(/\s*\[.*\]\s*$/, '')];
  let base = card?.surgeAbilities || [];
  // Skirmish Upgrade attachments may remove base surge keys (e.g. Focused on the Kill removes "recover 3")
  const removeKeys = combat?.removeSurgeKeys;
  if (removeKeys?.length) {
    base = base.filter(k => !removeKeys.includes(k));
  }
  const doubles = (card?.doubleSurgeAbilities || []).map((k) => `double:${k}`);
  const bonus = combat?.bonusSurgeAbilities || [];
  return [...base, ...doubles, ...bonus];
}

/** Parse a surge ability key into modifiers. F6: blast, recover, cleave. */
export function parseSurgeEffect(key) {
  const out = { damage: 0, pierce: 0, accuracy: 0, conditions: [], blast: 0, recover: 0, cleave: 0 };
  // Strip double-surge prefix and parenthetical annotations (e.g. "blast 3 (2 surges)" → "blast 3")
  const k = String(key || '').replace(/^double:/, '').replace(/\s*\([^)]*\)/g, '').toLowerCase().trim();
  // Named surge key shortcuts (cannot be parsed as generic patterns)
  if (k === 'stun_net') { out.conditions.push('Stun'); return out; }
  if (k === 'harass') { out.surgeHarass = 1; return out; }
  if (k === 'shocking_palm') { out.replaceWithStun = true; return out; }
  if (k === 'squad_command') { out.surgeSquadCommand = true; return out; }
  if (k === 'stalk_prey') { out.surgeStalkPrey = true; return out; }
  if (k === 'deadly_spin') { out.surgeCancelDodge = true; out.cleave = 3; return out; }
  if (k === 'deadly') { out.surgeCancelDodge = true; return out; }
  if (k === 'shrapnel') { out.blast = 2; return out; }
  if (k === 'critical_hit') { out.pierce = 2; out.surgeCriticalHit = true; return out; }
  if (k === 'suppression') { out.surgeSuppressionStrain = true; return out; }
  // Self-condition surges: attacker gains condition (not applied to target)
  if (k === 'focus') { out.surgeSelfFocus = true; return out; }
  if (k === 'hide') { out.surgeSelfHide = true; return out; }
  // Power token grants: attacker gains tokens to use on later rolls
  if (k === 'hit token') { out.surgeGrantHitToken = 1; return out; }
  if (k === 'hit token 2') { out.surgeGrantHitToken = 2; return out; }
  if (k === 'block token') { out.surgeGrantBlockToken = 1; return out; }
  if (k === 'power token') { out.surgeGrantPowerToken = 1; return out; }
  // Attacker gains an evade (for own next defense)
  if (k === 'evade') { out.surgeGrantEvade = 1; return out; }
  // Attacker gains block on own next defense 
  if (k === 'block 1') { out.surgeAttackerBlock = 1; return out; }
  // Spend 1 surge, gain 1 surge back (net zero, allows chaining into other abilities)
  if (k === 'surge 1') { out.surgeGrantExtraSurge = 1; return out; }
  // Fighting Knife (Verena Talos): post-attack roll 1 red die, hits applied to adjacent hostile
  if (k === 'fighting_knife') { out.surgeFightingKnife = true; return out; }
  // Concussive Bolt (4-LOM): push SMALL target 1 space after non-miss attack
  if (k === 'concussive_bolt') { out.surgeConcussiveBolt = true; return out; }
  // Bargain (Jawa Scavenger Elite): spend 1 VP to roll 1 green die, gain VP per hit
  if (k === 'bargain') { out.surgeBargain = true; return out; }
  // Spread the Pain (Dengar): choose a HARMFUL condition; apply to figure on/adjacent to target post-combat
  if (k === 'spread_the_pain') { out.surgeSpreadThePain = true; return out; }
  // Agitate (Cam Droid): on hit, defender's group must activate next, if able
  if (k === 'agitate') { out.surgeAgitate = true; return out; }
  // Fell Swoop (Davith Elso): after attack, become Hidden, gain 2 MP, free attack. Limit once per round.
  if (k === 'fell_swoop') { out.surgeFellSwoop = true; return out; }
  // Mastery (Second Sister): redraw a FORCE USER CC of cost ≤ 1 from discard. Limit once per round.
  if (k === 'mastery') { out.surgeMastery = true; return out; }
  // Interrogate (Agent Blaise): look at opponent's hand, choose a CC; may discard equal/greater cost CC to force discard.
  if (k === 'interrogate') { out.surgeInterrogate = true; return out; }
  // Military Efficiency (Leia Organa): after resolving attack, shuffle 1 CC from discard into deck
  if (k === 'military_efficiency') { out.surgeMilitaryEfficiency = true; return out; }
  // Cancel N: remove N results from the attacker's roll (defender surge, e.g. Kuiil)
  const cancelMatch = k.match(/^cancel\s+(\d+)$/);
  if (cancelMatch) { out.surgeCancel = parseInt(cancelMatch[1], 10); return out; }
  // Evade token: attacker gains an Evade power token
  if (k === 'evade token') { out.surgeGrantEvade = 1; return out; }
  // Variable cleave/recover (cleave x, recover x): flag as complex since the value depends on context
  if (k === 'cleave x' || k === 'recover x') { out.surgeComplex = k; return out; }
  const parts = k.split(/\s*,\s*/);
  for (const p of parts) {
    const dmg = p.match(/^damage\s+(\d+)$/); if (dmg) { out.damage += parseInt(dmg[1], 10); continue; }
    const hit = p.match(/^\+(\d+)\s+hit(s?)$/); if (hit) { out.damage += parseInt(hit[1], 10); continue; }
    const pierce = p.match(/^pierce\s+(\d+)$/); if (pierce) { out.pierce += parseInt(pierce[1], 10); continue; }
    const acc = p.match(/^accuracy\s+(-?\d+)$/); if (acc) { out.accuracy += parseInt(acc[1], 10); continue; }
    const blast = p.match(/^blast\s+(\d+)$/); if (blast) { out.blast += parseInt(blast[1], 10); continue; }
    const recover = p.match(/^recover\s+(\d+)$/); if (recover) { out.recover += parseInt(recover[1], 10); continue; }
    const cleave = p.match(/^cleave\s+(\d+)$/); if (cleave) { out.cleave += parseInt(cleave[1], 10); continue; }
    if (p === 'stun') out.conditions.push('Stun');
    else if (p === 'weaken') out.conditions.push('Weaken');
    else if (p === 'bleed') out.conditions.push('Bleed');
    // hide/focus in combos: self-effect (attacker gains condition, not target)
    else if (p === 'hide') out.surgeSelfHide = true;
    else if (p === 'focus') out.surgeSelfFocus = true;
    // Token/power grants within a combo — wire each token type
    else if (p === 'block token') out.surgeGrantBlockToken = (out.surgeGrantBlockToken || 0) + 1;
    else if (p === 'hit token') out.surgeGrantHitToken = (out.surgeGrantHitToken || 0) + 1;
    else if (p === 'hit token 2') out.surgeGrantHitToken = (out.surgeGrantHitToken || 0) + 2;
    else if (p === 'evade token') out.surgeGrantEvade = (out.surgeGrantEvade || 0) + 1;
    else if (p === 'power token') out.surgeGrantPowerToken = (out.surgeGrantPowerToken || 0) + 1;
    else if (p === 'surge 1') out.surgeGrantExtraSurge = (out.surgeGrantExtraSurge || 0) + 1;
    else if (p === 'evade') out.surgeGrantEvade = (out.surgeGrantEvade || 0) + 1;
    else if (p === 'block 1') out.surgeAttackerBlock = (out.surgeAttackerBlock || 0) + 1;
    else { const gm = p.match(/^gain\s+(\d+)$/); if (gm) { out.surgeVpGain = (out.surgeVpGain || 0) + parseInt(gm[1], 10); continue; } }
    { const cm = p.match(/^cancel\s+(\d+)$/); if (cm) out.surgeCancel = (out.surgeCancel || 0) + parseInt(cm[1], 10); }
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
  const totalPierce = Math.max(0, surgeP + bonusPierce);
  const surgeA = combat.surgeAccuracy || 0;
  const bonusAcc = combat.bonusAccuracy || 0;
  const bonusHits = combat.bonusHits || 0;
  const bonusBlock = combat.bonusBlock || 0;
  const bonusEvade = combat.bonusEvade || 0;
  const evadeCancelled = combat.evadeCancelledSurge || 0;
  // Hidden on defender: -2 accuracy for the attacker
  const defenderHidden = !!combat.defenderConds?.includes('Hide');
  const hiddenAccPenalty = defenderHidden ? 2 : 0;
  const totalAccuracy = roll.acc + surgeA + bonusAcc - hiddenAccPenalty;
  let hit = true;
  let missReason = '';
  // Wookiee Avenger (Skirmish Upgrade): convert Dodge results to Evade results
  if (defRoll.dodge && combat.wookieeAvengerDefend) {
    defRoll.evade = (defRoll.evade || 0) + 1;
    defRoll.dodge = false;
  }
  if (defRoll.dodge && !combat.surgeCancelDodge) {
    hit = false;
    missReason = 'Dodge';
  } else if (combat.isRanged && combat.distanceToTarget != null) {
    if (totalAccuracy < combat.distanceToTarget) {
      hit = false;
      missReason = `insufficient accuracy (${totalAccuracy} < ${combat.distanceToTarget} distance)`;
    }
  }
  // Combat Suit (Skirmish Upgrade): reduce total pierce by N, min 0 (already clamped above)
  const defReducePierce = combat.defenderReducePierce || 0;
  const pierceToUse = combat.defenderIgnorePierce ? 0 : Math.max(0, totalPierce - defReducePierce);
  // Cancel (Kuiil): remove N block results from defender's roll (applied before pierce)
  const surgeCancel = combat.surgeCancel || 0;
  // Cunning: +1 Block per rolled Evade result while defending (Han Solo, Jyn Odan, Nexu)
  const cunningBonus = (combat.hasCunning) ? defRoll.evade : 0;
  const blockForCalc = combat.ignoreDefenseResultsNotOnDice
    ? (defRoll.block + cunningBonus)
    : (defRoll.block + bonusBlock + cunningBonus);
  let effectiveBlock = Math.max(0, blockForCalc - surgeCancel - pierceToUse);
  // Weakened on defender: -1 from their block result
  const defenderWeakened = combat.defenderConds?.includes('Weaken');
  if (defenderWeakened) {
    effectiveBlock = Math.max(0, effectiveBlock - 1);
  }
  const defenseDiceCount = combat.defenseDiceCount ?? 1;
  const perDefDieDamage = (combat.bonusDamagePerDefenseDie || 0) * defenseDiceCount;
  let damage = hit ? Math.max(0, roll.dmg + surgeD + bonusHits + perDefDieDamage - effectiveBlock) : 0;
  // Weakened on attacker: -1 to their final damage output
  const attackerWeakened = combat.attackerConds?.includes('Weaken');
  if (attackerWeakened && damage > 0) {
    damage = Math.max(0, damage - 1);
  }
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
  if (bonusAcc) resultText += ` | bonus: +${bonusAcc} acc`;
  if (bonusHits || perDefDieDamage) resultText += ` | bonus: +${(bonusHits || 0) + perDefDieDamage} Hit`;
  if (bonusBlock && !combat.ignoreDefenseResultsNotOnDice) resultText += ` | bonus: +${bonusBlock} Block`;
  if (cunningBonus) resultText += ` | **Cunning**: +${cunningBonus} Block (from ${defRoll.evade} evade)`;
  if (combat.ignoreDefenseResultsNotOnDice) resultText += ' | CC: ignore defense not on dice';
  if (evadeCancelled > 0) resultText += ` | Evade cancelled ${evadeCancelled} surge`;
  if (bonusEvade) resultText += ` | bonus: +${bonusEvade} Evade`;
  if (bonusPierce) resultText += ` | bonus: +${bonusPierce} pierce`;
  if (bonusBlast) resultText += ` | bonus: Blast ${bonusBlast}`;
  if ((combat.bonusConditions || []).length) resultText += ` | CC bonus: ${combat.bonusConditions.join(', ')}`;
  if (surgeCancel) resultText += ` | **Cancel ${surgeCancel}**: -${surgeCancel} block`;
  if (surgeD || surgeP || surgeA || conditionsText || blastText || recoverText || cleaveText) {
    resultText += ` | Surge: +${surgeD} dmg, +${surgeP} pierce, +${surgeA} acc${conditionsText}${blastText}${recoverText}${cleaveText}`;
  }
  if (combat.isRanged && combat.distanceToTarget != null) {
    resultText += ` | Accuracy: ${totalAccuracy} vs ${combat.distanceToTarget} distance`;
  }
  if (attackerWeakened) resultText += ` | **Weakened** (attacker -1 dmg)`;
  if (defenderWeakened) resultText += ` | **Weakened** (defender -1 block)`;
  if (defenderHidden) resultText += ` | **Hidden** (defender -2 accuracy)`;
  if (defRoll.dodge && combat.surgeCancelDodge) resultText += ` | **Deadly Spin**: Dodge cancelled`;
  if (!hit) resultText += missReason ? ` → **Miss** (${missReason})` : ' → **Miss**';
  else resultText += ` → **${damage} damage**${conditionsText}`;
  if (combat.attackResultReplaceWithStun) resultText += ' (Set for Stun: 0 damage, Stunned)';

  return { hit, damage, effectiveBlock, resultText };
}
