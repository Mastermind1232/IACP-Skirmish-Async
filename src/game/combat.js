/**
 * Combat logic: dice rolls, surge abilities, result computation. No Discord.
 *
 * Dice-stream hooks (D6 parity): when `setDiceStream(s)` is called, every roll
 * pops a face index from `s.pools[role][color]` instead of using Math.random().
 * When `setDiceRecorder(r)` is called, each roll appends to `r.pools` and
 * `r.log`. `clearDiceHooks()` reverts to normal (Math.random) mode. Both hooks
 * default to null and have zero effect on the production code path.
 */
import { getDiceData, getDcEffects } from '../data-loader.js';

import { getDcEffect } from './dc-helpers.js';
let _diceStream = null;
let _diceRecorder = null;

/** Install a dice stream; subsequent rolls pop indices from it. Pass null to clear. */
export function setDiceStream(stream) { _diceStream = stream; }
/** Install a recorder; subsequent rolls append to its pools + log. Pass null to clear. */
export function setDiceRecorder(recorder) { _diceRecorder = recorder; }
/** Revert to normal Math.random mode. */
export function clearDiceHooks() { _diceStream = null; _diceRecorder = null; }
/** Inspect current hooks (for tests / debugging). */
export function getDiceHooks() { return { stream: _diceStream, recorder: _diceRecorder }; }

function _drawIndex(role, color, facesLen) {
  if (_diceStream) {
    const pool = _diceStream.pools?.[role]?.[color];
    if (!pool || pool.length === 0) {
      throw new Error(`DiceStreamExhausted: ${role}/${color}`);
    }
    return pool.shift();
  }
  return Math.floor(Math.random() * facesLen);
}

function _record(role, color, faceIdx, face) {
  if (!_diceRecorder) return;
  _diceRecorder.pools = _diceRecorder.pools || { attack: {}, defense: {} };
  const bucket = _diceRecorder.pools[role];
  bucket[color] = bucket[color] || [];
  bucket[color].push(faceIdx);
  _diceRecorder.log = _diceRecorder.log || [];
  _diceRecorder.log.push({
    seq: _diceRecorder.log.length, role, color, faceIdx, face,
  });
}

export function rollAttackDice(diceColors) {
  const dice = [];
  let acc = 0, dmg = 0, surge = 0;
  for (const color of diceColors || []) {
    const normColor = color.toLowerCase();
    const faces = getDiceData().attack?.[normColor];
    if (!faces?.length) continue;
    const idx = _drawIndex('attack', normColor, faces.length);
    const face = faces[idx];
    const result = { color, acc: face.acc ?? 0, dmg: face.dmg ?? 0, surge: face.surge ?? 0, faceIdx: idx };
    _record('attack', normColor, idx, { acc: result.acc, dmg: result.dmg, surge: result.surge });
    dice.push(result);
    acc += result.acc;
    dmg += result.dmg;
    surge += result.surge;
  }
  return { acc, dmg, surge, dice };
}

export function rollDefenseDice(defenseType) {
  const color = defenseType || 'white';
  const normColor = color.toLowerCase();
  const faces = getDiceData().defense?.[normColor];
  if (!faces?.length) return { color, block: 0, evade: 0, dodge: false, faceIdx: -1 };
  const idx = _drawIndex('defense', normColor, faces.length);
  const face = faces[idx];
  const result = { color, block: face.block ?? 0, evade: face.evade ?? 0, dodge: !!face.dodge, faceIdx: idx };
  _record('defense', normColor, idx, { block: result.block, evade: result.evade, dodge: result.dodge });
  return result;
}

/** Roll a single attack die by color. Returns individual face result. */
export function rollSingleAttackDie(color) {
  const normColor = color.toLowerCase();
  const faces = getDiceData().attack?.[normColor];
  if (!faces?.length) return { color, acc: 0, dmg: 0, surge: 0, faceIdx: -1 };
  const idx = _drawIndex('attack', normColor, faces.length);
  const face = faces[idx];
  const result = { color, acc: face.acc ?? 0, dmg: face.dmg ?? 0, surge: face.surge ?? 0, faceIdx: idx };
  _record('attack', normColor, idx, { acc: result.acc, dmg: result.dmg, surge: result.surge });
  return result;
}

/** Roll a single defense die by color. Returns individual face result. */
export function rollSingleDefenseDie(color) {
  const normColor = (color || 'white').toLowerCase();
  const faces = getDiceData().defense?.[normColor];
  if (!faces?.length) return { color, block: 0, evade: 0, dodge: false, faceIdx: -1 };
  const idx = _drawIndex('defense', normColor, faces.length);
  const face = faces[idx];
  const result = { color, block: face.block ?? 0, evade: face.evade ?? 0, dodge: !!face.dodge, faceIdx: idx };
  _record('defense', normColor, idx, { block: result.block, evade: result.evade, dodge: result.dodge });
  return result;
}

/** Recalculate attack totals from individual dice results. */
export function recalcAttackTotals(dice) {
  let acc = 0, dmg = 0, surge = 0;
  for (const d of dice) { acc += d.acc ?? 0; dmg += d.dmg ?? 0; surge += d.surge ?? 0; }
  return { acc, dmg, surge };
}

/** Recalculate defense totals from individual dice results. */
export function recalcDefenseTotals(dice) {
  // Per destruct 2026-05-08: Dodge is COUNTED (some abilities apply
  // +1 Dodge), not binary. Aggregate per-die dodge booleans into a
  // numeric total so additions/subtractions stack correctly.
  let block = 0, evade = 0, dodge = 0;
  for (const d of dice) {
    block += d.block ?? 0;
    evade += d.evade ?? 0;
    // Dodge is a COUNT. A die normally carries a boolean dodge (counts 1), but a
    // die whose results were DOUBLED (Shrewd Scoundrel) carries a numeric dodge
    // (e.g. 2) — count it as its value (alexanbv 2026-06-16).
    if (d.dodge) dodge += (typeof d.dodge === 'number' ? d.dodge : 1);
  }
  return { block, evade, dodge };
}

/**
 * Determine innate reroll abilities from DC ability text.
 *
 * Per alexanbv 2026-05-13: reroll abilities are NEVER pooled into an
 * anonymous count. Each ability surfaces as its own bucket button with
 * the ability's name. This helper returns an array of ability
 * descriptors that the attack-roll detection block then registers
 * into `combat.rerollAbilities`.
 *
 * Returned shape:
 *   [{ id, label, pool, remainingUses }]
 *     - id: stable kebab-case identifier (per attack)
 *     - label: button text (e.g. "Use Professional")
 *     - pool: 'attack' | 'defense' | 'any'
 *     - remainingUses: number of times this ability can be invoked
 *       during the attack (1 by default; Elite Sniper / Sling
 *       Barrage have variable counts handled at register time).
 *
 * Only unconditional "While attacking/defending, you may reroll N"
 * patterns are surfaced here; conditional passives (Cower, Sniper
 * range-gate, Squad Training adjacency, Coordinated Hunt LoS) are
 * detected in handleCombatRoll's per-passive block and register
 * their own descriptors when the condition is met.
 *
 * @param {string} dcName
 * @returns {Array<{id:string,label:string,pool:string,remainingUses:number}>}
 */
export function getInnateRerollAbilities(dcName) {
  const card = getDcEffect(dcName);
  const text = (card?.abilityText || '').toLowerCase();
  const abilities = [];
  // Use whitelisted ability names where possible so the button label
  // matches the printed card. Falls back to generic "While Attacking
  // Reroll" / "While Defending Reroll" for cards whose ability is
  // unnamed in the text.
  // Targeting Computer / Professional are NAMED reroll abilities whose
  // printed text ("Targeting Computer: While attacking, you may reroll 1
  // attack die.") ALSO matches the generic atkMatch regex. Detect the
  // named ability FIRST and make all three branches mutually exclusive so
  // the same abilityText yields exactly ONE attack-die reroll entry (not
  // two). Without this, a single named ability double-counts.
  const atkMatch = text.match(/while attacking,\s*(?:you may\s+)?reroll\s+(?:up to\s+)?(\d+)\s+attack\s+di/);
  if (/targeting computer/i.test(text)) {
    abilities.push({ id: 'targeting-computer', label: 'Use Targeting Computer', pool: 'attack', remainingUses: 1 });
  } else if (/professional/i.test(text)) {
    abilities.push({ id: 'professional', label: 'Use Professional', pool: 'attack', remainingUses: 1 });
  } else if (atkMatch) {
    const n = parseInt(atkMatch[1], 10) || 1;
    abilities.push({
      id: 'while-attacking-reroll',
      label: n === 1 ? 'Reroll 1 Attack Die' : `Reroll up to ${n} Attack Dice`,
      pool: 'attack',
      remainingUses: n,
    });
  }
  const defMatch = text.match(/while defending,\s*(?:you may\s+)?reroll\s+(?:up to\s+)?(\d+)\s+defense?\s+di/);
  if (defMatch) {
    const n = parseInt(defMatch[1], 10) || 1;
    abilities.push({
      id: 'while-defending-reroll',
      label: n === 1 ? 'Reroll 1 Defense Die' : `Reroll up to ${n} Defense Dice`,
      pool: 'defense',
      remainingUses: n,
    });
  }
  return abilities;
}

/**
 * Legacy shim — back-compat for callers still expecting integer
 * counts. Will be removed once all consumers migrate to
 * getInnateRerollAbilities + the rerollAbilities registry.
 *
 * @deprecated 2026-05-13
 */
export function getInnateRerolls(dcName) {
  const abilities = getInnateRerollAbilities(dcName);
  let attackReroll = 0, defenseReroll = 0;
  for (const ab of abilities) {
    if (ab.pool === 'attack') attackReroll += ab.remainingUses;
    else if (ab.pool === 'defense') defenseReroll += ab.remainingUses;
  }
  return { attackReroll, defenseReroll };
}

/** Display labels for surge abilities (subset; raw key used if missing). */
export const SURGE_LABELS = {
  'damage 1': '+1 Damage', 'damage 2': '+2 Damage', 'damage 3': '+3 Damage',
  'pierce 1': 'Pierce 1', 'pierce 2': 'Pierce 2', 'pierce 3': 'Pierce 3',
  'accuracy 1': '+1 Accuracy', 'accuracy 2': '+2 Accuracy', 'accuracy 3': '+3 Accuracy',
  'stun': 'Stun', 'weaken': 'Weaken', 'bleed': 'Bleed', 'hide': 'Hide', 'focus': 'Focus',
  'blast 1': 'Blast 1', 'blast 2': 'Blast 2', 'recover 1': 'Recover 1', 'recover 2': 'Recover 2', 'recover 3': 'Recover 3',
  'cleave 1': 'Cleave 1', 'cleave 2': 'Cleave 2', 'cleave X': 'Cleave X', 'recover X': 'Recover X',
  '+1 hit': '+1 Damage', '+2 hits': '+2 Damage', '+1 hit, stun': '+1 Damage, Stun', '+1 hit, pierce 1': '+1 Damage, Pierce 1',
  'accuracy 2, surge 1': '+2 Accuracy, +1 Surge', 'damage 2, hide': '+2 Damage, Hide',
  'damage 2, accuracy 1': '+2 Damage, +1 Accuracy', 'pierce 1, hide': 'Pierce 1, Hide',
  'agitate': 'Agitate', 'fell_swoop': 'Fell Swoop', 'mastery': 'Mastery', 'interrogate': 'Interrogate',
  'open_minded': 'Open-Minded (1 MP or Power Token)',
  'utinni_vp_1': 'Utinni! (+1 VP)',
  'kd_redraw': 'Re-draw Knowledge and Defense (from discard)',
  'tn_redraw': 'Re-draw Targeting Network (from discard)',
  'autofire_chain': 'Chain Attack (within 3)',
  'military_efficiency': 'Military Efficiency',
  'deadly': 'Deadly (-1 Dodge)',
  'gain 1': '+1 VP',
  'accuracy 2, pierce 1': '+2 Accuracy, Pierce 1',
  'evade token': 'Gain Evade Token',
  'hit token': 'Gain Damage Token',
  'hit token 2': 'Gain 2 Damage Tokens',
};

/** Get attacker's surge abilities from dc-effects + combat.bonusSurgeAbilities (CCs like Spinning Kick).
 *  Double-surge abilities (cost 2) are tagged with the "double:" prefix. */
export function getAttackerSurgeAbilities(combat) {
  // Tusken Cycler: no abilities (including surge abilities) during this attack.
  // Close and Personal / Lightbow suppress the figure's NATIVE surge abilities
  // but explicitly grant replacement surges (e.g. "using only Surge: +1 Hit,
  // Surge: Pierce 4"), supplied via combat.bonusSurgeAbilities — keep those.
  if (combat.blockSurgeAbilities) return [...(combat?.bonusSurgeAbilities || [])];
  // Reverse Engineer: use the defender's DC surge abilities instead of the attacker's
  const surgeDcName = combat.reverseEngineerActive ? (combat.defenderDcName ?? combat.attackerDcName) : combat.attackerDcName;
  const card = getDcEffect(surgeDcName);
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
  // Zuckuss Stun Net is an "-ed" surge — "after this attack resolves, if it did
  // not miss, the target becomes Stunned" — so it resolves on a NOT-MISS even at
  // 0 damage, unlike the inline "Surge: Stun" keyword (which requires damage).
  // Routed to the not-miss bucket, not the damage-gated conditions list (alexanbv
  // 2026-06-22).
  if (k === 'stun_net') { (out.noMissConditions = out.noMissConditions || []).push('Stun'); return out; }
  if (k === 'harass') { out.surgeHarass = 1; return out; }
  // Shocking Palm (0-0-0): "The attack misses and the defender becomes
  // Stunned." Distinct from "Set for Stun" (CC) which is a HIT that floors
  // damage to 0 — Shocking Palm is a genuine MISS with an unconditional Stun.
  if (k === 'shocking_palm') { out.missAndStun = true; return out; }
  if (k === 'squad_command') { out.surgeSquadCommand = true; return out; }
  if (k === 'stalk_prey') { out.surgeStalkPrey = true; return out; }
  if (k === 'deadly_spin') { out.surgeCancelDodge = true; out.cleave = 3; return out; }
  if (k === 'deadly') { out.surgeCancelDodge = true; return out; }
  // Shrapnel (Drokkatta) — per alexanbv 2026-05-10: card text "Choose one:
  // This attack gains Blast 2, or after this attack resolves, if it did
  // not miss, each figure and object within 2 spaces of the target space
  // suffers 1 Damage." Player picks via combat_passive_shrapnel_blast or
  // _splash after the surge is spent. NO auto-blast on the surge — the
  // pick handler (handleCombatPassive) writes the chosen effect into
  // combat state.
  if (k === 'shrapnel') { out.surgeShrapnel = true; return out; }
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
  // Open-Minded (Del Meeko): special surge — after the attack resolves, gain 1 MP or 1 Power Token.
  if (k === 'open_minded') { out.surgeOpenMinded = true; return out; }
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
  const defenderAccPenalty = combat.defenderAccuracyPenalty || 0;
  const totalAccuracy = roll.acc + surgeA + bonusAcc - hiddenAccPenalty - defenderAccPenalty;
  let hit = true;
  let missReason = '';
  // C4: On the Lam — forced miss when defender moved out of LOS
  if (combat.forceMiss) {
    hit = false;
    missReason = 'On the Lam (target moved out of LOS)';
  }
  // 0-0-0 "Shocking Palm" surge: "The attack misses and the defender
  // becomes Stunned." The attack is a real MISS (0 damage) — not a 0-dmg
  // hit — so on-hit / non-miss triggers see a miss and it logs as a miss.
  // The Stun is applied UNCONDITIONALLY downstream (combat-bridge step-8),
  // independent of damage. (destruct: surge spent → miss + Stun in both
  // fully-blocked and would-have-dealt-damage cases.) NOTE: this is distinct
  // from "Set for Stun" (CC, combat.attackResultReplaceWithStun) which is a
  // HIT that floors damage to 0 and is gated on damage>0.
  if (combat.attackMissAndStun) {
    hit = false;
    missReason = 'Shocking Palm — attack misses';
  }
  // Wookiee Avenger (Skirmish Upgrade): convert Dodge results to Evade
  // results — converts ALL rolled Dodge (numeric).
  if (defRoll.dodge && combat.wookieeAvengerDefend) {
    defRoll.evade = (defRoll.evade || 0) + defRoll.dodge;
    defRoll.dodge = 0;
  }
  // Conclusion (HK-47) and any other "−1 Dodge" effects flow through
  // combat.bonusDodge (negative). Sum dice-rolled + bonus, clamp at 0.
  // Per destruct 2026-05-08: Dodge is counted, not binary.
  if (combat.conclusionDodgeCancel) combat.bonusDodge = (combat.bonusDodge || 0) - 1;
  const _totalDodge = Math.max(0, (defRoll.dodge || 0) + (combat.bonusDodge || 0));
  if (_totalDodge > 0 && !combat.surgeCancelDodge) {
    hit = false;
    missReason = 'Dodge';
  } else if (combat.isRanged && combat.distanceToTarget != null) {
    if (totalAccuracy < combat.distanceToTarget) {
      hit = false;
      missReason = `insufficient accuracy (${totalAccuracy} < ${combat.distanceToTarget} distance)`;
    }
  }
  // Accuracy-sufficient signal (alexanbv 2026-06-22): true when the attack did
  // NOT miss due to insufficient accuracy (i.e. it hit, OR it missed only because
  // of an uncancelled Dodge). Effects like Biv Bodhrik's Suppression are gated on
  // "did not miss due to accuracy", so they still resolve on a Dodge-miss.
  combat._accuracySufficient = !String(missReason).startsWith('insufficient accuracy');
  combat._missReason = missReason;
  // Combat Suit (Skirmish Upgrade): reduce total pierce by N, min 0 (already clamped above)
  const defReducePierce = combat.defenderReducePierce || 0;
  const pierceToUse = combat.defenderIgnorePierce ? 0 : Math.max(0, totalPierce - defReducePierce);
  // Cancel (Kuiil): remove N block results from defender's roll (applied before pierce)
  const surgeCancel = combat.surgeCancel || 0;
  // Cunning: +1 Block per Evade while defending (Han Solo, Jyn Odan, Nexu).
  // destruct 2026-05-06: "Cunning affects all evades regardless of source, not
  // just rolled" — covers rolled evade (defRoll.evade), Distracting (C-3PO
  // adjacency), evade-token spends, innate +Evade, round +Evade. All non-rolled
  // sources fold into combat.bonusEvade upstream (combat-bridge sets roundEvade
  // and Distracting via handlers/combat.js). Clamp at 0 so Harsh Environment's
  // -1 evade can't make Cunning negative.
  //
  // destruct 2026-05-07: Weakened on the defender reduces Evade results by 1.
  // That penalty flows into Cunning's evade total too — a Weakened figure
  // with Cunning credits one fewer block per evade than the raw count.
  const _cunningWeakenPenalty = (combat.defenderConds?.includes('Weaken')
    && !combat.defenderCondEffectsSuppressed) ? 1 : 0;
  const cunningEvadeTotal = Math.max(0, defRoll.evade + (combat.bonusEvade || 0) - _cunningWeakenPenalty);
  const cunningBonus = (combat.hasCunning) ? cunningEvadeTotal : 0;
  // Combat-pipeline rebuild (slice 6.15 + destruct 2026-05-06 ruling):
  // Overwhelming Impact's ignoreDefenseResultsNotOnDice flag drops anything
  // not physically on a defense die. That includes:
  //   - bonusBlock: token spends, innate flat +Block, CC-discard +Block
  //     (Zillo), surge-Block, mission rules (Harsh Environment, Mobile),
  //     Personal Combat Shield, etc.
  //   - cunningBonus: Cunning's "+1 Block per rolled Evade" is a derived
  //     modifier off the rolled evades, NOT a result on the die itself.
  //     Per destruct 2026-05-06: "OI would ignore the additional block
  //     provided by Cunning. That is a modifier."
  // KEPT under OI: rolled-die block (defRoll.block). Brace for Impact and
  // Knowledge and Defense add dice to the pool that get rolled into
  // defRoll.block, so they survive OI as on-die.
  const blockForCalc = combat.ignoreDefenseResultsNotOnDice
    ? defRoll.block
    : (defRoll.block + bonusBlock + cunningBonus);
  const effectiveBlock = Math.max(0, blockForCalc - surgeCancel - pierceToUse);
  // Weakened condition (canonical card text — destruct 2026-05-07):
  // "While attacking, apply -1 Surge to the attack results.
  //  While defending, apply -1 Evade to the defense results."
  // The Surge/Evade penalties are applied UPSTREAM in handlers/combat.js
  // where rawSurge / totalEvade are computed (before evade-cancels-surge).
  // The previous (incorrect) damage/block penalties have been removed.
  const attackerWeakened = combat.attackerConds?.includes('Weaken')
    && !combat.attackerCondEffectsSuppressed;
  const defenderWeakened = combat.defenderConds?.includes('Weaken')
    && !combat.defenderCondEffectsSuppressed;
  const defenseDiceCount = combat.defenseDiceCount ?? 1;
  const perDefDieDamage = (combat.bonusDamagePerDefenseDie || 0) * defenseDiceCount;
  // Hidden on attacker: +1 SURGE to attack results (destruct 2026-05-07
  // correction — earlier audit misread the canonical card icon as Damage,
  // but it's the Surge icon. The Surge bonus is applied UPSTREAM in
  // handlers/combat.js handleCombatSurge alongside Weakened's surge
  // penalty. computeCombatResult only surfaces the flag here.)
  const attackerHidden = !!combat.attackerConds?.includes('Hide');
  // Defender-side flat damage reduction (e.g. Chirrut Imwe's "The Force
  // is With Me" → -1 Damage to the attack results when the defender
  // picks an adjacent hostile to take 1 Damage instead).
  const defenderDamageReduction = combat.defenderDamageReduction || 0;
  let damage = hit ? Math.max(0, roll.dmg + surgeD + bonusHits + perDefDieDamage - effectiveBlock - defenderDamageReduction) : 0;
  if (combat.maxDamageToDefender != null && damage > combat.maxDamageToDefender) damage = combat.maxDamageToDefender;
  // "Set for Stun" (CC): "if the target would suffer 1 or more Damage, reduce
  // the Damage suffered to 0, then the target becomes Stunned." HIT, gated on
  // damage>0 — if the attack was already fully blocked, nothing happens.
  if (combat.attackResultReplaceWithStun && damage > 0) {
    damage = 0;
    if (!(combat.bonusConditions || []).includes('Stun')) {
      combat.bonusConditions = combat.bonusConditions || [];
      combat.bonusConditions.push('Stun');
    }
  }
  // Shocking Palm (0-0-0): queue the Stun UNCONDITIONALLY (hit is already
  // false → damage 0). The step-8 application in combat-bridge.js applies
  // this Stun even on a 0-damage / miss outcome, bypassing the damage>0 gate.
  if (combat.attackMissAndStun) {
    damage = 0;
    if (!(combat.bonusConditions || []).includes('Stun')) {
      combat.bonusConditions = combat.bonusConditions || [];
      combat.bonusConditions.push('Stun');
    }
  }
  const allConds = [...(combat.surgeConditions || []), ...(combat.bonusConditions || [])];
  const conditionsText = allConds.length ? ` (${allConds.join(', ')})` : '';
  const bonusBlast = combat.bonusBlast || 0;
  const totalBlastDisplay = (combat.surgeBlast || 0) + bonusBlast;
  const blastText = totalBlastDisplay ? ` Blast ${totalBlastDisplay}` : '';
  const recoverText = combat.surgeRecover ? ` Recover ${combat.surgeRecover}` : '';
  const cleaveText = combat.surgeCleave ? ` Cleave ${combat.surgeCleave}` : '';

  // Headline: Result: HIT (N damage) | Result: MISS (reason)
  let headline;
  if (!hit) {
    headline = missReason ? `**Result: MISS** — ${missReason}` : '**Result: MISS**';
    if (combat.attackMissAndStun) headline += ' (defender becomes Stunned)';
  } else {
    headline = `**Result: HIT** — ${damage} damage${conditionsText}`;
    if (combat.attackResultReplaceWithStun) headline += ' (Set for Stun: 0 damage, Stunned)';
  }
  // Details on a separate line so the headline reads at a glance.
  let details = `Attack: ${roll.acc} acc, ${roll.dmg} dmg, ${roll.surge} surge | Defense: ${defRoll.block} block, ${defRoll.evade} evade`;
  if (bonusAcc) details += ` | bonus: +${bonusAcc} acc`;
  if (bonusHits || perDefDieDamage) details += ` | bonus: +${(bonusHits || 0) + perDefDieDamage} Hit`;
  if (bonusBlock && !combat.ignoreDefenseResultsNotOnDice) details += ` | bonus: ${bonusBlock > 0 ? '+' : ''}${bonusBlock} Block`;
  if (cunningBonus) details += ` | **Cunning**: +${cunningBonus} Block (from ${cunningEvadeTotal} evade)`;
  if (combat.ignoreDefenseResultsNotOnDice) details += ' | CC: ignore defense not on dice';
  if (evadeCancelled > 0) details += ` | Evade cancelled ${evadeCancelled} surge`;
  if (bonusEvade) details += ` | bonus: ${bonusEvade > 0 ? '+' : ''}${bonusEvade} Evade`;
  if (bonusPierce) details += ` | bonus: +${bonusPierce} pierce`;
  if (bonusBlast) details += ` | bonus: Blast ${bonusBlast}`;
  if ((combat.bonusConditions || []).length) details += ` | CC bonus: ${combat.bonusConditions.join(', ')}`;
  if (surgeCancel) details += ` | **Cancel ${surgeCancel}**: -${surgeCancel} block`;
  if (surgeD || surgeP || surgeA || conditionsText || blastText || recoverText || cleaveText) {
    details += ` | Surge: +${surgeD} dmg, +${surgeP} pierce, +${surgeA} acc${conditionsText}${blastText}${recoverText}${cleaveText}`;
  }
  if (combat.isRanged && combat.distanceToTarget != null) {
    details += ` | Accuracy: ${totalAccuracy} vs ${combat.distanceToTarget} distance`;
  }
  if (attackerWeakened) details += ` | **Weakened** (attacker -1 surge)`;
  if (defenderWeakened) details += ` | **Weakened** (defender -1 evade)`;
  if (defenderHidden) details += ` | **Hidden** (defender -2 accuracy)`;
  if (attackerHidden) details += ` | **Hidden** (attacker +1 surge)`;
  if (defenderAccPenalty) details += ` | **CC** (defender -${defenderAccPenalty} accuracy)`;
  if (defRoll.dodge && combat.surgeCancelDodge) details += ` | **Deadly Spin**: Dodge cancelled`;
  let resultText = `${headline}\n${details}`;

  return { hit, damage, effectiveBlock, resultText };
}
