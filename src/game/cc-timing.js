/**
 * CC timing (F5): when can a Command Card be played from hand?
 * Uses game state to derive play context and cc-effects timing field.
 */
import { getCcEffect, getDcKeywords, getDcEffects, getFigureSize, isDcUnique } from '../data-loader.js';
import { getDcBaseName, dcNameFromFigureKey } from './dc-helpers.js';
import { getPlayerId, getDcList, getDcMessageIds, getDcAttachments, getCcHand, ccDiscardKey, ccHandKey, opponentPlayerNum } from './player-helpers.js';
import { isDcDepleted, depleteDc } from './card-state-helpers.js';

/** The msgId of an UN-DEPLETED [A New Hope] in the player's army, or null. */
function _aNewHopeMsgId(game, playerNum) {
  const list = getDcList(game, playerNum) || [];
  const mids = getDcMessageIds(game, playerNum) || [];
  for (let i = 0; i < list.length; i++) {
    const n = typeof list[i] === 'object' ? (list[i].dcName || list[i].displayName) : list[i];
    if ((n === '[A New Hope]' || n === 'A New Hope') && mids[i] && !isDcDepleted(game, mids[i])) return mids[i];
  }
  return null;
}
/** True iff the player has an UN-DEPLETED [A New Hope] (its deplete lets a figure
 * play a CC whose name-restriction matches another DC in your army). */
export function aNewHopeAvailable(game, playerNum) {
  return _aNewHopeMsgId(game, playerNum) != null;
}
/** Deplete the player's [A New Hope] (once-per-game). Returns true if depleted. */
export function depleteANewHope(game, playerNum) {
  const mid = _aNewHopeMsgId(game, playerNum);
  if (!mid) return false;
  depleteDc(game, mid);
  return true;
}
import { countGameSpaces } from './board-helpers.js';
import { ADAPTIVE_SKILLS_ABILITY_ID } from './adaptive-skills-helpers.js';
import { getUniqueFigureCcEntry } from './unique-figure-ccs.js';
import { isNamedCcAlreadyPlayed } from './named-cc-tracker.js';

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
export function isCcPlayableNow(game, playerNum, cardName, getEffect = getCcEffect, opts = {}) {
  // Shadow Ops: opponent cannot play Command cards this round
  if (game?.shadowOpsBlockedPlayer === playerNum) return false;
  // Vague and Unconvincing (K-2SO): while K-2SO defends, NEITHER player may play
  // Command cards for the duration of that attack. Derived from the pending combat
  // (no stored flag) so it self-clears when the attack ends and covers both sides.
  {
    const _combat = game?.pendingCombat;
    const _defFk = _combat?.target?.figureKey;
    if (_defFk) {
      const _defName = _combat.defenderDcName || dcNameFromFigureKey(_defFk);
      const _all = getDcEffects() || {};
      const _e = _all[_defName] || _all[String(_defName || '').replace(/\s*\[.*\]\s*$/, '')];
      if ((_e?.specialAbilityIds || []).includes('vague_and_unconvincing_k2s0')) return false;
    }
  }
  // Critical Hit (Mak): target cannot play Command cards this round
  if (game?.criticalHitBlockedPlayer === playerNum) return false;
  // Comms Jammer (ISB Infiltrator Elite): an automatic cancel of the NEXT CC the
  // opponent plays (alexanbv 2026-06-16). The playCC pipeline handles it as a
  // play-time cancel (the card IS played, then cancelled), so it passes
  // ignoreCommsJammer to avoid pre-blocking the button. Legacy callers keep the
  // pre-block behavior (default).
  if (!opts.ignoreCommsJammer && game?.commsJammerActivePlayerNum && game.commsJammerActivePlayerNum !== playerNum) return false;
  const effect = getEffect(cardName);
  if (!effect || !effect.timing) return false;
  const timing = String(effect.timing).toLowerCase().trim();
  if (SPECIAL_ACTION_TIMING.has(timing)) return false;

  // Per-phase named CC limits (G37/C21, C25)
  if (cardName === 'Jundland Terror' && game?.jundlandTerrorPlayedThisEor) return false;
  if (cardName === 'Reinforcements' && game?.reinforcementsPlayedThisSor) return false;
  // Generic "one copy of named CC per timing instance" — destruct
  // 2026-05-07. Generalizes the two ad-hoc flags above to ALL named CCs
  // for tracked timing buckets (sor / eor / status / activation / attack).
  // Aphra Excavation: if she already played this card this SOR, the
  // retrieved copy can't be replayed.
  if (isNamedCcAlreadyPlayed(game, playerNum, cardName, timing)) return false;

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
      // Escalating Hostility: "Use after you resolve an attack that DID NOT MISS"
      // — gate on a confirmed hit (alexanbv 2026-06-19). Other afterAttack CCs
      // (Collateral Damage) may be played after a miss.
      if (cardName === 'Escalating Hostility') return ctx.duringAttack && ctx.isAttacker && ctx.combatHit === true;
      // Glory of the Kill: "the defender was defeated" — only playable (by the
      // attacker) when the just-resolved attack defeated a figure.
      if (cardName === 'Glory of the Kill') return ctx.duringAttack && ctx.isAttacker && ctx.recentDefeat === true;
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
      // Self-Defense, Slippery Target, Dirty Trick: reactive. Playable during
      // your own activation OR during an opponent's move that opened an
      // interrupt window for one of YOUR figures (the move-interrupt loop —
      // alexanbv 2026-06-19, Slippery Target wiring).
      if (ctx.duringActivation) return true;
      {
        const ops = game?.pendingMoveInterrupts?.opportunities;
        if (Array.isArray(ops) && ops.some((o) => o.triggerPlayerNum === playerNum)) return true;
      }
      return false;
    case 'whenfriendlyfigurewithin2spacessuffers3plusdamage':
      // Extra Protection: playable during your activation (play when friendly within 2 suffered 3+ Damage)
      return ctx.duringActivation;
    case 'whenfriendlyfigurewithin3spaceswouldbedefeated':
      // Final Stand: playable during your activation (play when friendly at 0 health)
      return ctx.duringActivation;
    case 'whenyouendmovementinspaceswithotherfigures':
      // Crush: playable during your activation. Per alexanbv ruling, Crush's
      // EFFECT now resolves inside the MASSIVE end-of-move pipeline (before the
      // push, same timing as Stampede) — see _applyCrushBeforePush in
      // handlers/move-x-handler.js. This playability gate keeps it offerable
      // during the controller's activation (the window in which the MASSIVE
      // figure moves).
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
      // All in a Day's Work: playable after you resolve a Special Action or Interact
      // during your activation. The per-activation flag is set when a Special Action
      // is used (dc-play-area.js) or an Interact resolves (interact.js); it is wiped
      // at activation end (ACTIVATION_SCALAR_FLAGS). alexanbv 2026-06-20.
      return ctx.duringActivation && !!game.specialOrInteractResolvedThisActivation;
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
      // Overcharged Weapons: interrupt at the start of a hostile figure's
      // activation (same timing as Jyn "Hair Trigger", per alexanbv). Playable
      // during the opponent's turn whenever a hostile activation has stashed
      // the targeting context for THIS holder (game.pendingOverchargedWeapons),
      // or during the holder's own activation (defensive fallback).
      if (ctx.duringActivation) return true;
      return ctx.duringRound && game?.pendingOverchargedWeapons?.holderPlayerNum === playerNum;
    case 'whenfigurewithin3spacesdefending':
      // Protect the Old Ways: playable during an attack (play when figure within 3 defends)
      return ctx.duringAttack;
    case 'whenfriendlyrebelforceuserwithin4spacesrollsdice':
      // There Is No Try: playable during an attack (play when REBEL FORCE USER rolls dice)
      return ctx.duringAttack;
    case 'whenhostilefigureexitsadjacentspace':
      // Parting Blow: interrupt during the OPPONENT's move when a hostile exits
      // a space adjacent to the holder's BRAWLER (alexanbv: "Parting Blow is
      // played during opponent's move"). Playable when a move-interrupt posting
      // path has stashed the reacting BRAWLER context for THIS holder, or during
      // the holder's own activation (defensive fallback).
      if (ctx.duringActivation) return true;
      if (game?.pendingPartingBlow?.brawlerPlayerNum === playerNum) return true;
      {
        const ops = game?.pendingMoveInterrupts?.opportunities;
        if (Array.isArray(ops) && ops.some((o) => o.type === 'PB' && o.triggerPlayerNum === playerNum)) return true;
      }
      return false;
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
    case 'afteropponentreroll':
      // Tough Luck: purely reactive — never show in the proactive "Play CC"
      // dropdown. It has a dedicated prompt flow (_offerToughLuck → tlgate_*
      // in handlers/combat.js) that fires after the opponent rerolls a die.
      // Returning false here keeps it out of the hand dropdown, exactly like
      // Negation / Comm Disruption (whencommandcardplayed) above.
      return false;
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

/** Parse a figure size into [w,h]. Accepts "WxH" strings or [w,h] arrays. */
function _sizeWH(size) {
  if (Array.isArray(size)) return [Number(size[0]) || 1, Number(size[1]) || 1];
  const m = String(size || '1x1').match(/(\d+)\s*x\s*(\d+)/i);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [1, 1];
}
/**
 * A figure is LARGE iff its footprint is bigger than 1x1 (any dimension > 1);
 * SMALL iff exactly 1x1 (alexanbv 2026-06-16: "Large just means >1x1, not
 * massive. Small means exactly 1x1"). MASSIVE is a SEPARATE keyword and is NOT
 * implied by — nor implies — large.
 */
export function ccFigureIsLarge(dcName) {
  const [w, h] = _sizeWH(getFigureSize(getDcBaseName(dcName)));
  return w > 1 || h > 1;
}

/**
 * Does a SPECIFIC figure satisfy a CC's playableBy restriction? This is the
 * per-figure gate check (alexanbv 2026-06-16): "build a function that checks the
 * attacker's unique name, attack type, traits, faction [, size, unique, massive];
 * any CC that passes ANY ONE of those checks AND is in hand gets a button."
 *
 * Handles every restriction dimension as an alternative ("X or Y"):
 *  - unique name / faction / trait keyword → delegated to ccPlayableByMatches
 *  - size: "small" (=1x1), "large" (=>1x1), "large creature" (>1x1 + CREATURE)
 *  - "unique" / "any unique figure" → the figure's DC is unique
 *  - "non-massive X" → figure lacks the MASSIVE keyword AND matches X
 * Attack-type restrictions live in the card EFFECT (a resolve-time conditional),
 * not in playableBy, so they are not gated here. Returns boolean.
 */
export function figureMatchesCcRestriction(game, dcName, displayName, playableBy, opts = {}) {
  const { hasDarksaber = false, extraKeywords = null } = opts;
  const pb = String(playableBy || '').trim();
  if (!pb || pb.toLowerCase() === 'any figure') return true;
  const base = getDcBaseName(dcName);
  const kwMap = getDcKeywords(game);
  // Variant-tolerant: dc-effects keys carry a (Elite)/(Regular) suffix, but the
  // gate may pass either the suffixed or the base name — try both forms.
  const baseKw = kwMap[dcName] || kwMap[base] || kwMap[`${base} (Elite)`] || kwMap[`${base} (Regular)`] || [];
  const kw = [...baseKw, ...(extraKeywords || [])].map((k) => String(k).toLowerCase());
  const isMassive = kw.includes('massive');
  const alts = pb.split(/\s+or\s+/i)
    .map((a) => a.trim().replace(/^"|"$/g, '').toLowerCase())
    .map((a) => a.replace(/^any\s+/, '').replace(/\s+figure$/, '').trim());
  for (const a of alts) {
    if (a === 'small') { if (!ccFigureIsLarge(dcName)) return true; continue; }
    if (a === 'large') { if (ccFigureIsLarge(dcName)) return true; continue; }
    if (a === 'large creature') { if (ccFigureIsLarge(dcName) && kw.includes('creature')) return true; continue; }
    if (a === 'unique') { if (isDcUnique(base)) return true; continue; }
    if (a.startsWith('non-massive ')) {
      const rest = a.slice('non-massive '.length).trim();
      // Pass the variant-tolerant keywords so the delegate finds the trait even
      // when the gate hands us a base name (no (Elite)/(Regular) suffix).
      if (!isMassive && ccPlayableByMatches(rest, dcName, displayName, hasDarksaber, kw, game)) return true;
      continue;
    }
    // name / faction / trait keyword (ccPlayableByMatches handles its own casing)
    if (ccPlayableByMatches(a, dcName, displayName, hasDarksaber, kw, game)) return true;
  }
  return false;
}

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

  // Size restrictions (alexanbv 2026-06-16): "large" = footprint >1x1 (NOT
  // massive — massive is its own keyword); "small" = exactly 1x1; "large
  // creature" = a >1x1 figure with the CREATURE keyword (e.g. Dewback 1x2,
  // Nexu 2x2 — none of which are massive). Size comes from the figure's
  // footprint, not a keyword.
  if (alt === 'large creature') return ccFigureIsLarge(dcBaseLower) && kwLower.includes('creature');
  if (alt === 'large figure' || alt === 'large') return ccFigureIsLarge(dcBaseLower);
  if (alt === 'small figure' || alt === 'small') return !ccFigureIsLarge(dcBaseLower);

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

  // Build a name → msgId map so we can check per-DC attachments below.
  const _msgIds = getDcMessageIds(game, playerNum) || [];
  const _attachments = (playerNum === 1 ? game.p1DcAttachments : game.p2DcAttachments) || {};
  const _dcIdxByName = new Map();
  for (let _i = 0; _i < dcList.length; _i++) {
    const _n = typeof dcList[_i] === 'object' ? (dcList[_i].dcName || dcList[_i].displayName) : dcList[_i];
    if (_n) _dcIdxByName.set(_n, _i);
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
    // Scavenged Walker: card text "Treat this group's affiliation as SCUM."
    // Only legal on AT-ST or AT-DP. When attached, flip the affiliation
    // for CC playability + other affiliation-keyed rules.
    {
      const _idx = _dcIdxByName.get(dcName) ?? _dcIdxByName.get(dcBase);
      const _mid = _idx != null ? _msgIds[_idx] : null;
      const _atts = _mid ? (_attachments[_mid] || []) : [];
      if (_atts.includes('Scavenged Walker')) {
        effectiveAffiliation = 'scum';
      }
    }

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

  // There is Another (Leia CC): while active this round, you may play a unique CC
  // whose figure-name restriction names ANY FORCE USER — even one not in your
  // army (e.g. Leia plays Son of Skywalker, restricted to Luke, without fielding
  // Luke). A Force-User-only Fast Learner. The named figure need not be present;
  // it only has to be a Force User. Your army must field a Force User (the card
  // is Leia-restricted, so this always holds, but we guard defensively).
  // alexanbv 2026-06-17.
  if (game.thereIsAnotherActive?.[playerNum]) {
    const isForceUserName = (nm) => {
      const e = dcEffects[nm] || dcEffects[String(nm).replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim()];
      return (e?.keywords || []).map((k) => String(k).toLowerCase()).includes('force user');
    };
    const armyHasForceUser = dcList.some((dc) => isForceUserName(typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc));
    if (armyHasForceUser) {
      // The CC's restriction must name a FORCE USER figure (present or not). Only
      // figure-name restrictions match a catalog DC name; trait restrictions
      // (e.g. "FORCE USER") never match a name, so they are unaffected.
      for (const [dcName, eff] of Object.entries(dcEffects)) {
        if (!(eff?.keywords || []).map((k) => String(k).toLowerCase()).includes('force user')) continue;
        const base = String(dcName).replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim().toLowerCase();
        if (!base) continue;
        for (const alt of alternatives) {
          const altLow = alt.trim();
          if (base === altLow || base.includes(altLow) || altLow.includes(base)) return { legal: true, thereIsAnother: true };
        }
      }
    }
  }

  // [A New Hope] (Rebel hero upgrade): "Deplete this card to have a friendly
  // figure play a Command card with a restriction matching the name of ANOTHER
  // Deployment card in your army." So a name-restricted CC is legal if its
  // restriction matches a DC NAME in your own army, provided an un-depleted
  // [A New Hope] is in play. The card is depleted on the play (handleCcConfirmPlay
  // reads the `aNewHope` flag). Only NAME restrictions match a DC name; trait
  // restrictions never do, so they're unaffected. alexanbv 2026-06-19.
  if (aNewHopeAvailable(game, playerNum)) {
    const armyNames = dcList.map((dc) => String((typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc) || '')
      .replace(/^\[|\]$/g, '').replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim().toLowerCase()).filter(Boolean);
    for (const alt of alternatives) {
      const altLow = alt.trim();
      if (altLow && armyNames.some((nm) => nm === altLow || nm.includes(altLow) || altLow.includes(nm))) {
        return { legal: true, aNewHope: true };
      }
    }
  }

  return { legal: false, reason: `No figure matches "playable by: ${playableBy}" in your army.` };
}

/** Check if DC keywords match a CC's playableBy (shared logic for all CC timing checks). */
export function ccPlayableByMatches(playableBy, dcName, displayName, hasDarksaberImperial = false, extraKeywords = null, game = null) {
  if (!playableBy) return false;
  if (playableBy.toLowerCase() === 'any figure') return true;
  const dcBase = getDcBaseName(dcName);
  const displayBase = getDcBaseName(displayName || dcBase);
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
  const dcBase = getDcBaseName(dcName);
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

/**
 * True if this DC is Mara Jade AND Fast Learner is unused AND the CC is
 * a unique-figure CC whose named figure is in the army. Mirrors the in-
 * hand FL bypass in isCcPlayLegalByRestriction so Mara can play unique-
 * figure special-action / 2-action / EoA CCs from her DC menu (e.g.
 * Static Pulse when Iden is defeated).
 */
function _maraFastLearnerSpecialBypass(ccName, dcName, game) {
  if (!game || !dcName) return false;
  const dcEffects = getDcEffects() || {};
  const sIds = dcEffects[dcName]?.specialAbilityIds
    || dcEffects[dcName?.replace(/\s*\[.*\]\s*$/, '')]?.specialAbilityIds
    || [];
  if (!sIds.includes(ADAPTIVE_SKILLS_ABILITY_ID)) return false;
  if (game.roundFigureAbilityUsed?.[`${dcName}_fast_learner`]) return false;
  const entry = getUniqueFigureCcEntry(ccName);
  if (!entry || entry.excludeFromFastLearner) return false;
  const figureNames = (entry.figures || (entry.figure ? [entry.figure] : [])).map((s) => String(s).toLowerCase());
  if (figureNames.length === 0) return false;
  for (const pn of [1, 2]) {
    const dcList = getDcList(game, pn) || [];
    for (const dc of dcList) {
      const dn = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
      const dnBase = String(dn || '').replace(/\s*\[.*\]\s*$/, '').toLowerCase();
      if (figureNames.some((n) => dnBase.includes(n) || n.includes(dnBase))) return true;
    }
  }
  return false;
}

/** True if this DC can legally play this CC (for Special Action timing). */
export function isCcPlayableByDc(ccName, dcName, displayName, hasDarksaber = false, extraKeywords = null, game = null) {
  const effect = getCcEffect(ccName);
  if (!effect || (effect.timing || '').toLowerCase() !== 'specialaction') return false;
  if (ccPlayableByMatches((effect.playableBy || '').trim(), dcName, displayName, hasDarksaber, extraKeywords, game)) return true;
  // Mara Fast Learner bypass: surface unique-figure special-action CCs on
  // Mara's DC menu when FL is unused and the named figure is in army.
  return _maraFastLearnerSpecialBypass(ccName, dcName, game);
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
  if (ccPlayableByMatches((effect.playableBy || '').trim(), dcName, displayName, hasDarksaber, extraKeywords, game)) return true;
  return _maraFastLearnerSpecialBypass(ccName, dcName, game);
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
    if (ccPlayableByMatches((effect.playableBy || '').trim(), dcName, displayName, darksaber, extraKw, game)) return true;
    return _maraFastLearnerSpecialBypass(ccName, dcName, game);
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

/** Get extra keywords from Programming Override for a DC (4-LOM).
 *
 * Per alexanbv 2026-05-10: 4-LOM's Preservation Protocol CC, when
 * played, suppresses Programming Override for the rest of the game.
 * If `game.preservationProtocolUsed[playerNum][figKey]` is set for
 * any 4-LOM figure on this player's side, the trait grant is
 * suppressed.
 */
function _getProgrammingOverrideKeywords(game, playerNum, dcName) {
  const trait = game?.roundProgrammingOverrideTrait?.[playerNum];
  if (!trait) return null;
  const dcBase = getDcBaseName(dcName);
  if (dcBase !== '4-LOM') return null;
  // PP suppression: any 4-LOM figure on this player's side that's had
  // Preservation Protocol played loses Programming Override.
  const ppMap = game?.preservationProtocolUsed?.[playerNum];
  if (ppMap) {
    for (const fk of Object.keys(ppMap)) {
      if (fk.startsWith('4-LOM-') && ppMap[fk]) return null;
    }
  }
  return [trait];
}

/**
 * Validation half of the playCC pipeline (alexanbv 2026-06-16): can THIS figure
 * play THIS card at the current timing instance? Triggerable from a combat-gate
 * button or a player-area "play CC" button (after the player picks a figure).
 * Returns { ok: true } or { ok: false, reason }. The four checks:
 *  1. the card is IN HAND — unless opts.allowNotInHand (Aphra excavation, Ezra,
 *     Data Theft, and other "play a CC not in hand" abilities set this);
 *  2. the figure playing it is a VALID figure for the card (playableBy — unique
 *     name / faction / trait / size / unique), via figureMatchesCcRestriction;
 *  3. the player/figure is NOT restricted from playing CCs (Mak's Critical Hit,
 *     Shadow Ops, Comms Jammer) — handled inside isCcPlayableNow;
 *  4. the card's TIMING matches the current instance (isCcPlayableNow against the
 *     live game context); CCs that aren't timing-restricted still pass there.
 * Execution (running the card's effect + discard) is a separate step.
 */
export function canPlayCC(game, playerNum, figureKey, cardName, opts = {}) {
  const { allowNotInHand = false, getEffect = getCcEffect, ignoreCommsJammer = false } = opts;
  const effect = getEffect(cardName);
  if (!effect) return { ok: false, reason: `Unknown command card "${cardName}".` };
  // 1. in hand (or an exception ability is supplying it)
  if (!allowNotInHand && !(getCcHand(game, playerNum) || []).includes(cardName)) {
    return { ok: false, reason: `${cardName} is not in your hand.` };
  }
  // 2. the chosen figure satisfies the card's playableBy restriction
  const dcName = dcNameFromFigureKey(figureKey || '');
  if (!figureMatchesCcRestriction(game, dcName, dcName, (effect.playableBy || '').trim())) {
    return { ok: false, reason: `${dcName || 'that figure'} can't play ${cardName} (playable by: ${effect.playableBy}).` };
  }
  // 3 + 4. player not blocked from CCs AND timing matches the current instance.
  // Comms Jammer is handled by playCC as a play-time cancel (not a pre-block), so
  // it can be ignored here when called from the playCC pipeline.
  if (!isCcPlayableNow(game, playerNum, cardName, getEffect, { ignoreCommsJammer })) {
    return { ok: false, reason: `${cardName} can't be played right now (timing or a play-restriction).` };
  }
  return { ok: true };
}

/** Dispose a played CC: player discard by default, game box for self-gamebox
 *  cards / forced removeTo, 'none' to leave it (card relocated itself). Returns
 *  the destination. */
function _disposeCC(game, playerNum, cardName, removeTo, getEffect) {
  const dest = removeTo || (ccRemovesToGameBox(cardName, getEffect) ? 'gamebox' : 'discard');
  if (dest === 'gamebox') {
    game.gameBox = game.gameBox || [];
    game.gameBox.push(cardName);
  } else if (dest === 'discard') {
    const dk = ccDiscardKey(playerNum);
    game[dk] = game[dk] || [];
    game[dk].push(cardName);
  }
  return dest;
}

/** Remove the card from the player's hand (no-op if not present / not from hand). */
function _removeFromHand(game, playerNum, cardName) {
  const hand = game[ccHandKey(playerNum)] || [];
  const i = hand.indexOf(cardName);
  if (i >= 0) hand.splice(i, 1);
}

/**
 * True if the PLAYED CARD ITSELF is removed to the GAME BOX instead of the owner's
 * discard pile (alexanbv 2026-06-16: "send the played CC to the player's discard,
 * with the exception of abilities/cards that say gamebox like Aphra, YWNDM").
 * Must match a SELF-reference ("return THIS card to the game box" — YWNDM), NOT a
 * card whose game-box text targets something else: Fool Me Once sends the
 * OPPONENT'S DISCARD PILE to the game box but FMO itself goes to discard. A caller
 * may also force game-box disposal via opts.removeTo (e.g. Aphra-excavated cards).
 */
export function ccRemovesToGameBox(cardName, getEffect = getCcEffect) {
  const eff = getEffect(cardName);
  return /\bthis card\b[^.]*\bgame\s*box\b/i.test(String(eff?.effect || ''));
}

/**
 * Full playCC pipeline (alexanbv 2026-06-16), in order:
 *  1. validate (canPlayCC: in-hand / figure / not-blocked / timing);
 *  2. Comms Jammer — an automatic cancel of the next CC the opponent plays: if
 *     active against this player, the card IS played (removed from hand) but its
 *     effect is cancelled and the jammer consumed;
 *  3. opponent cancel window — negate (if cost 0) or Comm Disruption (if cost ≤
 *     the opponent's friendly SPY count); awaited via the injected
 *     ctx.promptOpponentCancel({ game, playerNum, cardName, cost }) → truthy
 *     { cancelled } skips execution;
 *  4. execute the card's ability via ctx.resolveAbility (injected to avoid an
 *     import cycle with abilities.js);
 *  5. dispose — player DISCARD by default, GAME BOX for self-gamebox cards
 *     (YWNDM) or opts.removeTo:'gamebox' (Aphra-excavated); 'none' leaves it.
 * Async because of the opponent prompt. Returns { ok:false, reason } on a failed
 * check, or { ok:true, result, disposedTo, cancelled? }.
 */
export async function playCC(game, playerNum, figureKey, cardName, opts = {}) {
  const { ctx = {}, allowNotInHand = false, getEffect = getCcEffect, removeTo, skipExecute = false } = opts;
  // 1. validate — comms jammer handled here as a play-time cancel, not a pre-block
  const check = canPlayCC(game, playerNum, figureKey, cardName, { allowNotInHand, getEffect, ignoreCommsJammer: true });
  if (!check.ok) return check;

  const effect = getEffect(cardName);
  const abilityId = effect?.abilityId ?? cardName;
  const cost = typeof effect?.cost === 'number' ? effect.cost : 0;

  // 2. Comms Jammer: the card is played but its effect auto-cancelled; consume it.
  if (game.commsJammerActivePlayerNum && game.commsJammerActivePlayerNum !== playerNum) {
    game.commsJammerActivePlayerNum = null;
    if (!allowNotInHand) _removeFromHand(game, playerNum, cardName);
    const dest = _disposeCC(game, playerNum, cardName, removeTo, getEffect);
    return { ok: true, cancelled: 'comms_jammer', disposedTo: dest };
  }

  // 3. opponent cancel window (negate if cost 0, else Comm Disruption if cost ≤
  // opponent SPY count). Injected so this module stays free of the Discord layer.
  if (typeof ctx.promptOpponentCancel === 'function') {
    const cancel = await ctx.promptOpponentCancel({ game, playerNum, figureKey, cardName, cost });
    if (cancel?.cancelled) {
      if (!allowNotInHand) _removeFromHand(game, playerNum, cardName);
      const dest = _disposeCC(game, playerNum, cardName, removeTo, getEffect);
      return { ok: true, cancelled: cancel.reason || 'opponent', disposedTo: dest };
    }
  }

  // 4. execute the card's ability (skipExecute → caller applies a bespoke combat
  // effect itself, e.g. third-party CCs that act on a chosen non-attacker figure).
  let result = null;
  if (!skipExecute && typeof ctx.resolveAbility === 'function') {
    // Forward the dc meta the resolver needs (else it early-returns "resolve
    // manually"). The caller applies result via applyAbilityResult. (DC-exhaustion
    // state is intentionally NOT forwarded here — CCs are not gated on it, per the
    // CRR-EXH-006 oracle; an exhaust-dependent CC would supply it from its caller.)
    result = await ctx.resolveAbility(abilityId, {
      game, playerNum, cardName, figureKey,
      combat: game.combat || game.pendingCombat,
      dcMessageMeta: ctx.dcMessageMeta, dcHealthState: ctx.dcHealthState,
    });
  }

  // 5. remove from hand + dispose
  if (!allowNotInHand) _removeFromHand(game, playerNum, cardName);
  const dest = _disposeCC(game, playerNum, cardName, removeTo, getEffect);
  return { ok: true, result, disposedTo: dest };
}
