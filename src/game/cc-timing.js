/**
 * CC timing (F5): when can a Command Card be played from hand?
 * Uses game state to derive play context and cc-effects timing field.
 */
import { getCcEffect, getDcKeywords, getDcEffects } from '../data-loader.js';
import { getPlayerId, getDcList, getDcMessageIds, getDcAttachments, getCcHand, opponentPlayerNum } from './player-helpers.js';
import { countGameSpaces } from './board-helpers.js';
import { ADAPTIVE_SKILLS_ABILITY_ID } from './adaptive-skills-helpers.js';

/**
 * Derive current CC play context from game state.
 * @param {object} game - Game state
 * @param {number} playerNum - 1 or 2
 * @returns {{ startOfRound: boolean, duringActivation: boolean, endOfRound: boolean, duringAttack: boolean, isAttacker: boolean, isDefender: boolean, duringRound: boolean }}
 */
export function getCcPlayContext(game, playerNum) {
  const playerId = getPlayerId(game, playerNum);
  // Start of Round: use the authoritative startOfRoundWhoseTurn flag (set when SoR
  // window opens, cleared when both players finish). The old heuristic using
  // roundActivationButtonShown was unreliable — it stayed false during early activation.
  const inSorWindow = !!game.startOfRoundWhoseTurn;
  const startOfRound = !!(
    game.currentRound &&
    inSorWindow
  );
  // duringActivation/duringRound must exclude the SoR window — currentActivationTurnPlayerId
  // is set before SoR ends, so without this guard activation-timing cards leak into SoR.
  const duringActivation =
    !inSorWindow &&
    game.currentActivationTurnPlayerId === playerId &&
    !game.endOfRoundWhoseTurn;
  const endOfRound = game.endOfRoundWhoseTurn === playerId;
  const combat = game.combat || game.pendingCombat;
  const duringAttack = !!combat;
  const isAttacker =
    duringAttack && combat.attackerPlayerNum === playerNum;
  const isDefender =
    duringAttack && combat.defenderPlayerNum === playerNum;
  // duringRound: true whenever a round is active (activation phase, not SoR/EoR)
  // Allows reaction cards like Opportunistic to be played outside the owner's activation
  const duringRound = !!(
    !inSorWindow &&
    game.currentRound &&
    game.currentActivationTurnPlayerId &&
    !game.endOfRoundWhoseTurn
  );

  // Combat details for timing validation
  const combatHit = combat?.hit ?? null;
  const defenderRerolled = (combat?.defenderRerolledIndices?.length ?? 0) > 0;
  const recentDefeat = !!(game?.lastDefeatInfo); // set after a figure is defeated

  return {
    startOfRound,
    duringActivation,
    endOfRound,
    duringAttack,
    isAttacker,
    isDefender,
    duringRound,
    combatHit,
    defenderRerolled,
    recentDefeat,
    combat,
  };
}

/** Timings that are played from the DC (Special Action button), not from Hand. */
const SPECIAL_ACTION_TIMING = new Set([
  'specialaction',
  'doubleactionspecial',
]);

/**
 * True if this CC can be played from hand right now (game state + timing).
 * specialAction cards are played from the DC button, so we return false for them here.
 * @param {object} game - Game state
 * @param {number} playerNum - 1 or 2
 * @param {string} cardName - CC name
 * @param {object} [getEffect] - Optional getCcEffect (default from data-loader)
 * @returns {boolean}
 */
export function isCcPlayableNow(game, playerNum, cardName, getEffect = getCcEffect) {
  // Shadow Ops: opponent cannot play Command cards this round
  if (game?.shadowOpsBlockedPlayer === playerNum) return false;
  // Critical Hit (Mak): target cannot play Command cards this round
  if (game?.criticalHitBlockedPlayer === playerNum) return false;
  // Comms Jammer (ISB Infiltrator Elite): opponent cannot play CCs during this activation
  if (game?.commsJammerActivePlayerNum && game.commsJammerActivePlayerNum !== playerNum) return false;
  const effect = getEffect(cardName);
  if (!effect || !effect.timing) return false;
  const timing = String(effect.timing).toLowerCase().trim();
  if (SPECIAL_ACTION_TIMING.has(timing)) return false;

  // Per-phase named CC limits (G37/C21, C25)
  if (cardName === 'Jundland Terror' && game?.jundlandTerrorPlayedThisEor) return false;
  if (cardName === 'Reinforcements' && game?.reinforcementsPlayedThisSor) return false;

  // C1: Assassinate mutual-exclude — no other CCs during this attack
  const _cbt = game?.pendingCombat || game?.combat;
  if (_cbt?.ccLockedOut && timing === 'duringattack') return false;

  const ctx = getCcPlayContext(game, playerNum);

  switch (timing) {
    case 'startofround':
    case 'startofstatusphase':
      return ctx.startOfRound;
    case 'duringactivation':
      return ctx.duringActivation;
    case 'startofactivation':
    case 'endofactivation':
      return ctx.duringActivation;
    case 'endofround':
      return ctx.endOfRound;
    case 'duringattack':
      return ctx.duringAttack;
    case 'whiledefending':
      return ctx.duringAttack && ctx.isDefender;
    case 'whenattackdeclaredonyou':
      return ctx.duringAttack && ctx.isDefender;
    case 'beforeyoudeclareattack':
      // Played during your activation, before picking an attack target
      return ctx.duringActivation;
    case 'whenyoudeclareattack':
      // Played after attack is declared (combat/pendingCombat exists)
      return ctx.duringAttack && ctx.isAttacker;
    case 'afterattack':
    case 'afterattackdice':
      return ctx.duringAttack;
    case 'afteryouresolveattackthatdidnotmissduetoaccuracy':
      // Reduce to Rubble: playable ONLY when the attack has resolved AND
      // did not miss. combatHit can be null (attack not yet resolved),
      // false (missed), or true (hit). Only the explicit-true case
      // qualifies — was previously `!== false` which incorrectly allowed
      // play before the attack resolved (combatHit still null).
      return ctx.duringAttack && ctx.isAttacker && ctx.combatHit === true;
    case 'afterattacktargetingyouresolved':
      return ctx.duringAttack && ctx.isDefender;
    case 'whenyouhavesuffereddamageequaltoyourhealth':
      // Preservation Protocol: playable during your activation (only when at 0 health)
      return ctx.duringActivation;
    case 'whenhostilefigureentersspacewithin3spaces':
      // Disengage: playable during your activation (play when hostile entered)
      return ctx.duringActivation;
    case 'whenhostilefigureentersadjacentspace':
      // Self-Defense, Slippery Target, Dirty Trick: playable during your activation (play when hostile entered adjacent)
      return ctx.duringActivation;
    case 'whenfriendlyfigurewithin2spacessuffers3plusdamage':
      // Extra Protection: playable during your activation (play when friendly within 2 suffered 3+ Damage)
      return ctx.duringActivation;
    case 'whenfriendlyfigurewithin3spaceswouldbedefeated':
      // Final Stand: playable during your activation (play when friendly at 0 health)
      return ctx.duringActivation;
    case 'whenyouendmovementinspaceswithotherfigures':
      // Crush: playable during your activation (play when you end movement in space with figures)
      return ctx.duringActivation;
    case 'whenhostilefigureinyourlineofsightattacking':
      // Force Illusion: playable while defending (play when hostile in LOS is attacking)
      return ctx.duringAttack && ctx.isDefender;
    case 'whenyoudeclarelightsaberthrow':
      // Hunt Them Down: playable during your activation (play when declaring Lightsaber Throw)
      return ctx.duringActivation;
    case 'afterdamage':
      // Disorient: playable during your activation (play after hostile with BENEFICIAL suffered damage)
      return ctx.duringActivation;
    case 'whenattackdeclaredtargetingfriendlysmallfigurecost10orlesswithin3spaces':
      // Get Behind Me!: playable during your activation (play when attack declared on friendly small figure cost ≤10 within 3)
      return ctx.duringActivation;
    case 'afteractivationresolves':
      // Blaze of Glory: playable after an activation resolves (play when activation just ended)
      return ctx.duringActivation;
    case 'afterspecial':
      // To the Limit: playable after you resolve a Special Action during your activation
      return ctx.duringActivation;
    case 'whenattackdeclaredonadjacentfriendly':
      // Bodyguard: playable when attack declared on adjacent friendly (play when attack declared on adjacent friendly)
      return ctx.duringActivation;
    case 'whileadjacentfriendlyfiguredefending':
      // Guardian Stance: playable while defending when adjacent friendly is defender (honor: play when you are defending with adjacent friendly)
      return ctx.duringAttack && ctx.isDefender;
    case 'atstartofactivationofhostilefigureinyourlineofsight':
      // No Cheating: playable at start of hostile activation in your LOS (honor: play when hostile in LOS starts activation)
      return ctx.duringActivation;
    case 'whenoneofyourfiguresdefeated':
      // Of No Importance: playable when your figure is defeated (validated via recentDefeat flag)
      return (ctx.duringActivation || ctx.duringRound) && ctx.recentDefeat;
    case 'afteryouresolvegroupsactivation':
      // Change of Plans: playable after you resolve a group's activation ()
      return ctx.duringActivation;
    case 'usewhenyouusegambit':
      // Cheat to Win: playable when you use Gambit (play when Gambit used)
      return ctx.duringActivation;
    case 'beforedeclaringrangedattack':
      // Marksman: playable before declaring a Ranged attack (play when about to declare ranged attack)
      return ctx.duringActivation;
    case 'afteryouresolveattacktargetingfigure':
      // Field Promotion, Shoot the Messenger: playable after you resolve an attack (attacker only)
      return ctx.duringAttack && ctx.isAttacker;
    case 'whenhostilefigurewithin3spacesdefeated':
      // Paid in Beskar: play when you defeat a hostile within 3 spaces ()
      return ctx.duringActivation;
    case 'whenhostilefiguredefeatednotyouractivation':
      // Lord of the Sith: playable during your activation (play when hostile defeated not during your activation)
      return ctx.duringActivation;
    case 'afteruniquehostiledefeated':
      // Celebration: playable during your activation (play after a unique hostile is defeated)
      return ctx.duringActivation;
    case 'whileattackingbeforedefenderrerolls':
      // Rapid Recalibration: play while attacking, before defender rerolls
      return ctx.duringAttack && ctx.isAttacker;
    case 'afterhostilefiguresuffersdamage':
      // Opportunistic: playable whenever a hostile suffers damage — during your activation
      // OR during the opponent's activation (honor-based). If played outside your activation,
      // the gained MP must be spent immediately (enforced via game flag).
      return ctx.duringActivation || ctx.duringRound;
    case 'afterspecialorinteract':
      // All in a Day's Work: playable after you resolve a Special Action or Interact during your activation
      return ctx.duringActivation;
    case 'afteryouresolvecloseandpersonal':
      // Stay Down: playable after you resolve Close and Personal during your activation
      return ctx.duringActivation;
    case 'afteryouresolveinterrogate':
      // Espionage Mastery: playable after you resolve Interrogate during your activation
      return ctx.duringActivation;
    case 'atstartofhostilefigureactivation':
      // Still Faster Than You: playable during your activation (play when hostile starts activation)
      return ctx.duringActivation;
    case 'usewhenyouusedualbladedfury':
      // Wreak Vengeance: playable during your activation when using Dual-Bladed Fury
      return ctx.duringActivation;
    case 'usewhenyouuseemperor':
      // Unlimited Power: playable during your activation when using the Emperor ability
      return ctx.duringActivation;
    case 'whenanotherfriendlytrooperdeclaresattacktargetinginyourlineofsight':
      // Concentrated Fire: playable while attacking (play when your TROOPER declares attack)
      return ctx.duringAttack && ctx.isAttacker;
    case 'whencommandcarddiscardedfromhandordeck':
      // Windfall: playable during your activation (play when a CC is discarded)
      return ctx.duringActivation;
    case 'whencommandcardplayed':
      // Negation & Comm Disruption: purely reactive — never show in the proactive "Play CC"
      // dropdown. Both cards have dedicated prompt flows (negation_play_ / comm_disruption_play_)
      // that fire when the trigger occurs. Returning false here keeps them out of the hand dropdown.
      return false;
    case 'whenenemyfigureactivates':
      // Overcharged Weapons: playable during your activation (play when hostile activates)
      return ctx.duringActivation;
    case 'whenfigurewithin3spacesdefending':
      // Protect the Old Ways: playable during an attack (play when figure within 3 defends)
      return ctx.duringAttack;
    case 'whenfriendlyrebelforceuserwithin4spacesrollsdice':
      // There Is No Try: playable during an attack (play when REBEL FORCE USER rolls dice)
      return ctx.duringAttack;
    case 'whenhostilefigureexitsadjacentspace':
      // Parting Blow: playable during your activation (play when hostile exits adjacent space)
      return ctx.duringActivation;
    case 'whenyoudeclareattacktargetinghostilewithhighestfigurecost':
      // Primary Target: playable while attacking (as attacker, targeting highest-cost hostile)
      return ctx.duringAttack && ctx.isAttacker;
    case 'whenyoudeclareclosequarters':
      // Master Operative: playable while attacking (when declaring Close Quarters)
      return ctx.duringAttack && ctx.isAttacker;
    case 'whenyoudeclareindiscriminatefire':
      // Trandoshan Terror: playable while attacking (when declaring Indiscriminate Fire)
      return ctx.duringAttack && ctx.isAttacker;
    case 'whenyouperformrapidfire':
      // Guild Programming: playable while attacking (when performing Rapid Fire)
      return ctx.duringAttack && ctx.isAttacker;
    case 'other':
      // Disarm, Dying Lunge: playable during your activation (play at actual trigger)
      return ctx.duringActivation;
    default:
      return false;
  }
}

/**
 * Filter hand to only cards playable right now.
 * @param {object} game - Game state
 * @param {number} playerNum - 1 or 2
 * @param {string[]} hand - CC names in hand
 * @returns {string[]}
 */
export function getPlayableCcFromHand(game, playerNum, hand) {
  return (hand || []).filter((card) => isCcPlayableNow(game, playerNum, card));
}

/** Known affiliation values (lowercase) in dc-effects.json. */
const AFFILIATIONS = new Set(['imperial', 'rebel', 'scum', 'mercenary']);

/**
 * Check if a single playableBy alternative matches a DC's traits.
 * @param {string} alt - Lowercase alternative (e.g., "imperial force user", "brawler", "luke skywalker")
 * @param {string} dcBaseLower - Lowercase base DC name
 * @param {string} dispLower - Lowercase display name
 * @param {string} affiliationLower - Lowercase affiliation from dc-effects.json
 * @param {string[]} kwLower - Lowercase keywords array
 * @returns {boolean}
 */
function alternativeMatchesDc(alt, dcBaseLower, dispLower, affiliationLower, kwLower) {
  // Name match (existing logic)
  if (dcBaseLower.includes(alt) || alt.includes(dcBaseLower) || dispLower.includes(alt) || alt.includes(dispLower))
    return true;

  // Synonym expansions: "large creature" means MASSIVE + CREATURE
  const COMPOUND_SYNONYMS = {
    'large creature': ['massive', 'creature'],
  };
  if (COMPOUND_SYNONYMS[alt]) {
    return COMPOUND_SYNONYMS[alt].every(kw => kwLower.includes(kw));
  }

  // State-qualifier stripping: "readied vehicle" → check "vehicle" keyword
  // (the "readied" part is a game-state check handled separately)
  const STATE_QUALIFIERS = ['readied', 'exhausted', 'focused', 'hidden', 'stunned', 'weakened', 'bleeding'];
  let strippedAlt = alt;
  for (const q of STATE_QUALIFIERS) {
    if (strippedAlt.startsWith(q + ' ')) {
      strippedAlt = strippedAlt.slice(q.length + 1).trim();
      break;
    }
  }

  // Decompose alternative into affiliation part and keyword parts
  const words = strippedAlt.split(/\s+/);
  let reqAffiliation = null;
  const reqKeywordWords = [];
  for (const w of words) {
    if (AFFILIATIONS.has(w) && !reqAffiliation) reqAffiliation = w;
    else reqKeywordWords.push(w);
  }
  const reqKeyword = reqKeywordWords.join(' '); // e.g. "force user" from ["force","user"]
  // Check affiliation requirement
  if (reqAffiliation && affiliationLower !== reqAffiliation && affiliationLower !== 'any') return false;
  // Check keyword requirement
  if (reqKeyword && !kwLower.includes(reqKeyword)) return false;
  // Must have matched at least one requirement
  return !!(reqAffiliation || reqKeyword);
}

/**
 * Check if a CC is legal to play by playableBy (figure/trait) in current context.
 * Handles compound restrictions ("IMPERIAL FORCE USER"), alternatives ("X or Y"),
 * and DC ability modifiers (Devout, Fallen Master, Adaptive Skills).
 * Returns { legal: true } or { legal: false, reason: string }.
 * @param {object} game - Game state
 * @param {number} playerNum - 1 or 2
 * @param {string} cardName - CC name
 * @param {object} [getEffect] - Optional getCcEffect
 * @returns {{ legal: boolean, reason?: string }}
 */
export function isCcPlayLegalByRestriction(game, playerNum, cardName, getEffect = getCcEffect) {
  const effect = getEffect(cardName);
  const playableBy = (effect?.playableBy || '').trim();
  if (!playableBy || playableBy.toLowerCase() === 'any figure') return { legal: true };

  const dcList = getDcList(game, playerNum) || [];
  const allKeywords = getDcKeywords(game);
  const dcEffects = getDcEffects() || {};
  const p = playableBy.toLowerCase();

  // Handle special cases first
  if (p === 'any small figure' || p === 'any unique figure' || p === 'unique') return { legal: true };

  // Split on " or " for alternatives (handle quoted names like "\"Iden Versio\" or \"Dio\"")
  const alternatives = playableBy.split(/\s+or\s+/i).map(a => a.trim().replace(/^"|"$/g, '').toLowerCase());

  // Detect army-wide DC ability modifiers
  let hasFallenMaster = false;
  let hasDevout = false;
  let adaptiveSkillsDc = null;
  let armyAffiliation = null;

  for (const dc of dcList) {
    const dcName = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
    if (!dcName) continue;
    const eff = dcEffects[dcName];
    const sIds = eff?.specialAbilityIds || [];
    if (sIds.includes('fallen_master_malicos')) hasFallenMaster = true;
    if (sIds.includes('devout_chirrut')) hasDevout = true;
    if (sIds.includes(ADAPTIVE_SKILLS_ABILITY_ID)) adaptiveSkillsDc = dcName;
    // Track army affiliation (most common non-Any affiliation)
    const aff = (eff?.affiliation || '').toLowerCase();
    if (aff && aff !== 'any' && !armyAffiliation) armyAffiliation = aff;
  }

  for (const dc of dcList) {
    const dcName = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
    if (!dcName) continue;
    const dcBase = String(dcName)
      .replace(/\s*\[(?:DG|Group) \d+\]$/i, '')
      .replace(/\s*\((?:Elite|Regular)\)\s*$/i, '')
      .trim();
    const disp = (typeof dc === 'object' ? dc.displayName : dcName) || dcBase;
    const dcData = dcEffects[dcName] || dcEffects[dcBase];
    const affiliationLower = (dcData?.affiliation || '').toLowerCase();
    const kw = allKeywords[dcName] || allKeywords[dcBase] || [];
    const kwLower = kw.map(k => String(k).toLowerCase());

    // Build effective affiliation for this DC
    let effectiveAffiliation = affiliationLower;
    // Adaptive Skills: Mara Jade's affiliation matches the army's
    if (dcName === adaptiveSkillsDc && armyAffiliation) effectiveAffiliation = armyAffiliation;

    // Build effective keywords for this DC
    const effectiveKw = [...kwLower];
    // Adaptive Skills: inject conditional trait based on army affiliation
    if (dcName === adaptiveSkillsDc && armyAffiliation) {
      const _asMap = { imperial: 'hunter', scum: 'smuggler', rebel: 'guardian' };
      const _asTrait = _asMap[armyAffiliation];
      if (_asTrait && !effectiveKw.includes(_asTrait)) effectiveKw.push(_asTrait);
    }
    // Fallen Master: FORCE USER DCs also count as IMPERIAL for CC restriction purposes
    if (hasFallenMaster && kwLower.includes('force user') && effectiveAffiliation !== 'imperial') {
      // Don't change affiliation, but allow matching IMPERIAL restrictions
    }

    for (const alt of alternatives) {
      if (alternativeMatchesDc(alt, dcBase.toLowerCase(), String(disp).toLowerCase(), effectiveAffiliation, effectiveKw))
        return { legal: true };

      // Fallen Master override: if alt requires IMPERIAL and DC is FORCE USER, allow
      if (hasFallenMaster && kwLower.includes('force user')) {
        // Re-check with IMPERIAL affiliation override
        if (alternativeMatchesDc(alt, dcBase.toLowerCase(), String(disp).toLowerCase(), 'imperial', effectiveKw))
          return { legal: true };
      }
    }
  }

  // Devout (Chirrut): can use Rebel FORCE USER CCs — treat as having a virtual REBEL FORCE USER in army
  if (hasDevout) {
    for (const alt of alternatives) {
      // Check if alt matches FORCE USER (with or without REBEL qualifier)
      const words = alt.split(/\s+/);
      let reqAff = null;
      const kwWords = [];
      for (const w of words) {
        if (AFFILIATIONS.has(w)) reqAff = w;
        else kwWords.push(w);
      }
      const reqKw = kwWords.join(' ');
      // Devout allows playing if: no affiliation req OR rebel affiliation, AND keyword is "force user"
      if (reqKw === 'force user' && (!reqAff || reqAff === 'rebel')) return { legal: true };
    }
  }

  // Fast Learner (Mara Jade): once per round, may play CC whose restriction matches another DC name in army
  if (adaptiveSkillsDc && !game.roundFigureAbilityUsed?.[`${adaptiveSkillsDc}_fast_learner`]) {
    const ccNameLower = (cardName || '').toLowerCase();
    // "Arcing Shot" is excluded from Fast Learner
    if (!ccNameLower.includes('arcing shot')) {
      for (const dc of dcList) {
        const otherName = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
        if (!otherName || otherName === adaptiveSkillsDc) continue; // skip Mara Jade herself
        const otherBase = String(otherName)
          .replace(/\s*\[(?:DG|Group) \d+\]$/i, '')
          .replace(/\s*\((?:Elite|Regular)\)\s*$/i, '')
          .trim();
        const otherDisp = (typeof dc === 'object' ? dc.displayName : otherName) || otherBase;
        for (const alt of alternatives) {
          const altLow = alt.toLowerCase().trim();
          const oBase = otherBase.toLowerCase();
          const oDisp = String(otherDisp).toLowerCase();
          if (oBase.includes(altLow) || altLow.includes(oBase) || oDisp.includes(altLow) || altLow.includes(oDisp)) {
            return { legal: true, fastLearner: true };
          }
        }
      }
    }
  }

  return { legal: false, reason: `No figure matches "playable by: ${playableBy}" in your army.` };
}

/** Check if DC keywords match a CC's playableBy (shared logic for all CC timing checks). */
export function ccPlayableByMatches(playableBy, dcName, displayName, hasDarksaberImperial = false, extraKeywords = null, game = null) {
  if (!playableBy) return false;
  if (playableBy.toLowerCase() === 'any figure') return true;
  const dcBase = (dcName || '').replace(/\s*\[(?:DG|Group) \d+\]$/i, '').replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
  const displayBase = (displayName || dcBase).replace(/\s*\[(?:DG|Group) \d+\]$/i, '').replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
  const d = dcBase.toLowerCase();
  const disp = displayBase.toLowerCase();
  const kwMap = getDcKeywords(game);
  const baseKeywords = kwMap[dcName] || kwMap[dcBase];
  const keywords = extraKeywords ? [...(baseKeywords || []), ...extraKeywords] : baseKeywords;
  const alternatives = playableBy.split(/\s+or\s+/i).map((s) => s.trim().toLowerCase());
  for (const p of alternatives) {
    if (d.includes(p) || p.includes(d) || disp.includes(p) || p.includes(disp)) return true;
    if (keywords && Array.isArray(keywords) && keywords.some((k) => String(k).toLowerCase() === p)) return true;
  }
  // The Darksaber: FORCE USER with Darksaber can use IMPERIAL Command cards
  if (hasDarksaberImperial && alternatives.includes('imperial')) return true;
  return false;
}

/** Check if activating DC has The Darksaber and is a FORCE USER → can use IMPERIAL CCs. */
export function hasDarksaberImperial(game, playerNum, dcName) {
  const dcBase = (dcName || '').replace(/\s*\[(?:DG|Group) \d+\]$/i, '').replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
  const kwMap = getDcKeywords(game);
  const keywords = kwMap[dcName] || kwMap[dcBase];
  if (!keywords?.some((k) => String(k).toUpperCase() === 'FORCE USER')) return false;
  const atts = getDcAttachments(game, playerNum) || {};
  const msgIds = getDcMessageIds(game, playerNum) || [];
  const dcList = getDcList(game, playerNum) || [];
  for (let i = 0; i < msgIds.length; i++) {
    if (dcList[i]?.dcName !== dcBase && dcList[i]?.dcName !== dcName) continue;
    if ((atts[msgIds[i]] || []).includes('The Darksaber')) return true;
  }
  return false;
}

/** True if this DC can legally play this CC (for Special Action timing). */
export function isCcPlayableByDc(ccName, dcName, displayName, hasDarksaber = false, extraKeywords = null, game = null) {
  const effect = getCcEffect(ccName);
  if (!effect || (effect.timing || '').toLowerCase() !== 'specialaction') return false;
  return ccPlayableByMatches((effect.playableBy || '').trim(), dcName, displayName, hasDarksaber, extraKeywords, game);
}

/** CC names in hand that are Special Action and legally playable by this DC. */
export function getPlayableCcSpecialsForDc(game, playerNum, dcName, displayName) {
  const hand = getCcHand(game, playerNum) || [];
  const darksaber = hasDarksaberImperial(game, playerNum, dcName);
  const extraKw = _getProgrammingOverrideKeywords(game, playerNum, dcName);
  return hand.filter((ccName) => isCcPlayableByDc(ccName, dcName, displayName, darksaber, extraKw, game));
}

/** True if this DC can legally play this CC (for Double Action Special timing). */
export function isCcDoubleActionPlayableByDc(ccName, dcName, displayName, hasDarksaber = false, extraKeywords = null, game = null) {
  const effect = getCcEffect(ccName);
  if (!effect || (effect.timing || '').toLowerCase() !== 'doubleactionspecial') return false;
  return ccPlayableByMatches((effect.playableBy || '').trim(), dcName, displayName, hasDarksaber, extraKeywords, game);
}

/** CC names in hand that are Double Action Special and legally playable by this DC. */
export function getPlayableCcDoubleActionsForDc(game, playerNum, dcName, displayName) {
  const hand = getCcHand(game, playerNum) || [];
  const darksaber = hasDarksaberImperial(game, playerNum, dcName);
  const extraKw = _getProgrammingOverrideKeywords(game, playerNum, dcName);
  return hand.filter((ccName) => isCcDoubleActionPlayableByDc(ccName, dcName, displayName, darksaber, extraKw, game));
}

/** CC names in hand that are End-of-Activation timing and legally playable by this DC. */
export function getPlayableCcEndOfActivationForDc(game, playerNum, dcName, displayName) {
  const hand = getCcHand(game, playerNum) || [];
  const darksaber = hasDarksaberImperial(game, playerNum, dcName);
  const extraKw = _getProgrammingOverrideKeywords(game, playerNum, dcName);
  return hand.filter((ccName) => {
    const effect = getCcEffect(ccName);
    if (!effect || (effect.timing || '').toLowerCase() !== 'endofactivation') return false;
    return ccPlayableByMatches((effect.playableBy || '').trim(), dcName, displayName, darksaber, extraKw, game);
  });
}

/**
 * Check if there's at least one hostile figure adjacent to a friendly TROOPER or GUARDIAN.
 * Used to gate Provoke's playability notification.
 */
function _hasProvokeTarget(game, playerNum) {
  const dcEffects = getDcEffects() || {};
  const oppNum = opponentPlayerNum(playerNum);
  const friendlyPositions = game.figurePositions?.[playerNum] || {};
  const hostilePositions = game.figurePositions?.[oppNum] || {};
  const hostileEntries = Object.entries(hostilePositions);
  if (!hostileEntries.length) return false;

  // Find all friendly figures with TROOPER or GUARDIAN keyword
  for (const [fk, pos] of Object.entries(friendlyPositions)) {
    if (!pos) continue;
    const dcName = fk.replace(/-\d+-\d+$/, '');
    const eff = dcEffects[dcName] || {};
    const kws = (eff.keywords || []).map(k => String(k).toUpperCase());
    if (!kws.includes('TROOPER') && !kws.includes('GUARDIAN')) continue;
    // Check if any hostile is adjacent (distance 1)
    for (const [, hPos] of hostileEntries) {
      if (!hPos) continue;
      if (countGameSpaces(game, pos, hPos) <= 1) return true;
    }
  }
  return false;
}

/**
 * Get reaction cards from hand that match timing triggers AND pass full legality checks.
 * Replaces the local timing-only filter in combat.js with canonical pipeline:
 * timing trigger match + isCcPlayableNow (game-state blocks) + isCcPlayLegalByRestriction (playableBy).
 * @param {object} game - Game state
 * @param {number} playerNum - 1 or 2
 * @param {string[]} timingTriggers - Mixed-case timing values (e.g. ['whenAttackDeclaredOnYou'])
 * @returns {{ cardName: string, timing: string, playableBy: string, cost: number }[]}
 */
export function getPlayableReactionCardsForTiming(game, playerNum, timingTriggers) {
  const hand = getCcHand(game, playerNum) || [];
  if (!hand.length) return [];
  const triggerSet = new Set(timingTriggers.map(t => String(t).toLowerCase().trim()));
  const results = [];
  const seen = new Set();
  for (const cardName of hand) {
    if (seen.has(cardName)) continue;
    seen.add(cardName);
    const effect = getCcEffect(cardName);
    if (!effect || !effect.timing) continue;
    const timingLower = String(effect.timing).toLowerCase().trim();
    if (!triggerSet.has(timingLower)) continue;
    if (!isCcPlayableNow(game, playerNum, cardName)) continue;
    const { legal } = isCcPlayLegalByRestriction(game, playerNum, cardName);
    if (!legal) continue;
    // Provoke: skip if no hostile adjacent to a friendly TROOPER/GUARDIAN
    if (cardName === 'Provoke' && !_hasProvokeTarget(game, playerNum)) continue;
    results.push({ cardName, timing: effect.timing, playableBy: effect.playableBy || 'Any Figure', cost: effect.cost ?? 0 });
  }
  return results;
}

/** Get extra keywords from Programming Override for a DC (4-LOM). */
function _getProgrammingOverrideKeywords(game, playerNum, dcName) {
  const trait = game?.roundProgrammingOverrideTrait?.[playerNum];
  if (!trait) return null;
  const dcBase = (dcName || '').replace(/\s*\[(?:DG|Group) \d+\]$/i, '').replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
  if (dcBase !== '4-LOM') return null;
  return [trait];
}
