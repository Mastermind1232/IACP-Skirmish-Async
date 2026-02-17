/**
 * CC timing (F5): when can a Command Card be played from hand?
 * Uses game state to derive play context and cc-effects timing field.
 */
import { getCcEffect, getDcKeywords } from '../data-loader.js';

/**
 * Derive current CC play context from game state.
 * @param {object} game - Game state
 * @param {number} playerNum - 1 or 2
 * @returns {{ startOfRound: boolean, duringActivation: boolean, endOfRound: boolean, duringAttack: boolean, isAttacker: boolean, isDefender: boolean }}
 */
export function getCcPlayContext(game, playerNum) {
  const playerId = playerNum === 1 ? game.player1Id : game.player2Id;
  const startOfRound = !!(
    game.currentRound &&
    game.roundActivationMessageId &&
    !game.roundActivationButtonShown
  );
  const duringActivation =
    game.currentActivationTurnPlayerId === playerId &&
    !game.endOfRoundWhoseTurn;
  const endOfRound = game.endOfRoundWhoseTurn === playerId;
  const combat = game.combat || game.pendingCombat;
  const duringAttack = !!combat;
  const isAttacker =
    duringAttack && combat.attackerPlayerNum === playerNum;
  const isDefender =
    duringAttack && combat.defenderPlayerNum === playerNum;

  return {
    startOfRound,
    duringActivation,
    endOfRound,
    duringAttack,
    isAttacker,
    isDefender,
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
  const effect = getEffect(cardName);
  if (!effect || !effect.timing) return false;
  const timing = String(effect.timing).toLowerCase().trim();
  if (SPECIAL_ACTION_TIMING.has(timing)) return false;

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
    case 'whenyoudeclareattack':
      return ctx.duringActivation;
    case 'afterattack':
    case 'afterattackdice':
      return ctx.duringAttack;
    case 'afteryouresolveattackthatdidnotmissduetoaccuracy':
      // Reduce to Rubble: playable during/after attack (honor: only when attack did not miss due to accuracy)
      return ctx.duringAttack;
    case 'afterattacktargetingyouresolved':
      return ctx.duringAttack && ctx.isDefender;
    case 'whenyouhavesuffereddamageequaltoyourhealth':
      // Preservation Protocol: playable during your activation (honor system: only when at 0 health)
      return ctx.duringActivation;
    case 'whenhostilefigureentersspacewithin3spaces':
      // Disengage: playable during your activation (honor system: play when hostile entered)
      return ctx.duringActivation;
    case 'whenhostilefigureentersadjacentspace':
      // Self-Defense, Slippery Target, Dirty Trick: playable during your activation (honor system: play when hostile entered adjacent)
      return ctx.duringActivation;
    case 'whenfriendlyfigurewithin2spacessuffers3plusdamage':
      // Extra Protection: playable during your activation (honor system: play when friendly within 2 suffered 3+ Damage)
      return ctx.duringActivation;
    case 'whenfriendlyfigurewithin3spaceswouldbedefeated':
      // Final Stand: playable during your activation (honor system: play when friendly at 0 health)
      return ctx.duringActivation;
    case 'whenyouendmovementinspaceswithotherfigures':
      // Crush: playable during your activation (honor system: play when you end movement in space with figures)
      return ctx.duringActivation;
    case 'whenhostilefigureinyourlineofsightattacking':
      // Force Illusion: playable while defending (honor system: play when hostile in LOS is attacking)
      return ctx.duringAttack && ctx.isDefender;
    case 'whenyoudeclarelightsaberthrow':
      // Hunt Them Down: playable during your activation (honor system: play when declaring Lightsaber Throw)
      return ctx.duringActivation;
    case 'afterdamage':
      // Disorient: playable during your activation (honor system: play after hostile with BENEFICIAL suffered damage)
      return ctx.duringActivation;
    case 'whenattackdeclaredtargetingfriendlysmallfigurecost10orlesswithin3spaces':
      // Get Behind Me!: playable during your activation (honor system: play when attack declared on friendly small figure cost ≤10 within 3)
      return ctx.duringActivation;
    case 'afteractivationresolves':
      // Blaze of Glory: playable after an activation resolves (honor system: play when activation just ended)
      return ctx.duringActivation;
    case 'whenattackdeclaredonadjacentfriendly':
      // Bodyguard: playable when attack declared on adjacent friendly (honor system: play when attack declared on adjacent friendly)
      return ctx.duringActivation;
    case 'afteryouresolvegroupsactivation':
      // Change of Plans: playable after you resolve a group's activation (honor system)
      return ctx.duringActivation;
    case 'usewhenyouusegambit':
      // Cheat to Win: playable when you use Gambit (honor system: play when Gambit used)
      return ctx.duringActivation;
    case 'beforedeclaringrangedattack':
      // Marksman: playable before declaring a Ranged attack (honor system: play when about to declare ranged attack)
      return ctx.duringActivation;
    case 'other':
      // Disarm, Dying Lunge: playable during your activation (honor system: play at actual trigger)
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

/**
 * Check if a CC is legal to play by playableBy (figure/trait) in current context.
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

  const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
  const keywords = getDcKeywords();
  const p = playableBy.toLowerCase();

  for (const dc of dcList) {
    const dcName = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
    if (!dcName) continue;
    const dcBase = String(dcName)
      .replace(/\s*\[(?:DG|Group) \d+\]$/i, '')
      .replace(/\s*\((?:Elite|Regular)\)\s*$/i, '')
      .trim();
    const disp = (typeof dc === 'object' ? dc.displayName : dcName) || dcBase;
    const d = dcBase.toLowerCase();
    const dispLower = String(disp).toLowerCase();
    if (d.includes(p) || p.includes(d) || dispLower.includes(p) || p.includes(dispLower))
      return { legal: true };
    const kw = keywords[dcName] || keywords[dcBase];
    if (Array.isArray(kw) && kw.some((k) => String(k).toLowerCase() === p)) return { legal: true };
  }
  return { legal: false, reason: `No figure matches "playable by: ${playableBy}" in your army.` };
}
