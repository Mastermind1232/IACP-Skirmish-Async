/**
 * Strategy learning module — Dueling Neural Network (Brain Phase 3).
 * Hidden layer captures feature interactions. Separate value/advantage heads.
 * Target network + gradient clipping for stable learning.
 * Q(s,a) = V(s) + (A(s,a) - mean(A(s,*)))
 */
import { parseCoord } from '../../src/game/coords.js';
import { getDcEffects, getMapTokensData, getCcEffect } from '../../src/data-loader.js';
import { parseSurgeEffect } from '../../src/game/combat.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';

// ── Constants ───────────────────────────────────────────────────────────────

const GAMMA = 0.95;          // Discount factor
const ALPHA = 0.002;         // Learning rate (smaller for neural stability)
const HIDDEN_SIZE = 32;      // Hidden layer width
const DELTA_CLAMP = 1.0;     // Clips TD error magnitude
const TARGET_UPDATE_INTERVAL = 500; // Sync target net every N updates
const WEIGHT_DECAY = 0.000002;      // L2 regularization — reduced 50x from 0.0001 (was crushing strategic weights)
const WEIGHT_CLAMP_EMERGENCY = 50.0; // Hard safety net — should never trigger with decay active

const REPLAY_BUFFER_SIZE = 10000;   // Max transitions in ring buffer
const REPLAY_BATCH_SIZE = 32;       // Transitions per mini-batch
const REPLAY_UPDATES_PER_GAME = 4;  // Mini-batch updates after each game
const REPLAY_MIN_SIZE = 256;        // Min buffer fill before replay starts
const REPLAY_ALPHA = 0.001;         // Half of online ALPHA — guards against stale data

// ── Within-Group Scorer (Phase 5) ───────────────────────────────────────────
const ALPHA_WG = 0.01;           // Learning rate for within-group scorers (5x main)
const WG_WEIGHT_CLAMP = 5.0;    // Max absolute weight value
const WG_EPSILON_START = 0.10;   // Within-group exploration rate (start)
const WG_EPSILON_MIN = 0.02;     // Within-group exploration rate (floor)
const WG_EPSILON_DECAY = 3000;   // Games to decay within-group epsilon

const ATTACK_FEATURE_NAMES = [
  'targetHpRatio', 'targetDistNorm', 'targetIsolated',
  'targetThreat', 'killPotential', 'bias',
];

const MOVE_FEATURE_NAMES = [
  'distToNearestEnemy', 'threatAtDest', 'objectiveProximity',
  'allySupport', 'mpEfficiency', 'bias',
];

const SURGE_FEATURE_NAMES = ['damageValue', 'isAccuracy', 'isRecover', 'bias'];

const CC_FEATURE_NAMES = ['ccCost', 'isAttachment', 'inCombat', 'bias'];

function getGroupCategory(absType) {
  if (absType === 'attack_close' || absType === 'attack_ranged') return 'attack';
  if (absType === 'move_toward' || absType === 'move_away' || absType === 'move_lateral') return 'move';
  if (absType === 'surge_damage' || absType === 'surge_special' || absType === 'spend_surge') return 'surge';
  if (absType === 'play_cc') return 'cc';
  return null;
}

function getWgEpsilon(totalGames) {
  return Math.max(WG_EPSILON_MIN, WG_EPSILON_START * Math.exp(-totalGames / WG_EPSILON_DECAY));
}

const REWARD_WEIGHTS = {
  vp: 10.0,               // VP gained (primary win condition)
  dmg: 0.5,               // Enemy HP removed
  hp: -0.5,               // Own HP lost (negative = penalty)
  dist: 0.1,              // Distance reduction to enemies
  terminal: 50.0,         // Win/loss bonus at game end
  step: -0.02,            // Per-action cost — pushes toward faster game completion
};

const NUM_FEATURES = 36;

const FEATURE_NAMES = [
  // Original 16 (indices 0-15 preserved for weight compatibility)
  'vpAdv', 'myHpRatio', 'oppHpRatio', 'hpAdv',
  'myFigsRatio', 'figsAdv', 'closeness', 'nearestEnemy',
  'roundProgress', 'activationsRatio', 'inCombat', 'inMovement',
  'attackPower', 'bias',
  'enemyThreat', 'objectivePotential',
  // Batch 2: per-DC health (indices 16-17)
  'myLowestFigHp', 'oppLowestFigHp',
  // Batch 2: typed power tokens (indices 18-21, replaces lumped count)
  'myOffensiveTokens', 'myDefensiveTokens',
  'oppOffensiveTokens', 'oppDefensiveTokens',
  // Batch 2: CC hand (indices 22-25)
  'myCcHandSize', 'oppCcHandSize',
  'myAvgCcCost', 'oppAvgCcCost',
  // Batch 2: activation order (indices 26-28)
  'myExhaustedRatio', 'oppExhaustedRatio',
  'activationCountAdv',
  // Batch 2: conditions — total + stun separated (indices 29-32)
  'myConditions', 'oppConditions',
  'myStunnedRatio', 'oppStunnedRatio',
  // Batch 2: initiative + VP urgency (indices 33-35)
  'hasInitiative',
  'vpUrgency', 'oppVpUrgency',
];

const ABSTRACT_TYPES = [
  // Original 15 (indices 0-14 preserved for network weight compatibility)
  'attack_close', 'attack_ranged', 'move_toward', 'move_away', 'move_lateral',
  'move_done', 'start_move', 'activate', 'end_activation', 'pass',
  'ability', 'spend_surge', 'skip_surges', 'reroll', 'other',
  // A2 splits — dedicated types for high-frequency tactical decisions
  'play_cc', 'react_use', 'react_skip', 'surge_damage', 'surge_special',
  'token_offense', 'token_defense',
  // A3 — interact (mission objectives, terminals, doors)
  'interact',
];

const NUM_ACTIONS = ABSTRACT_TYPES.length;

// Expected damage per attack die (from dice.json face averages)
const EXPECTED_DMG_PER_DIE = { red: 2.17, blue: 1.17, green: 1.33, yellow: 0.67 };

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Box-Muller transform for standard normal random numbers. */
function randn() {
  let u, v;
  do { u = Math.random(); } while (u === 0);
  v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function coordDistance(a, b) {
  const pa = parseCoord(a);
  const pb = parseCoord(b);
  return Math.abs(pa.col - pb.col) + Math.abs(pa.row - pb.row);
}

function getHpTotals(dcHealthState, dcMessageMeta, playerNum) {
  let current = 0, max = 0;
  for (const [msgId, healthArr] of dcHealthState) {
    const meta = dcMessageMeta.get(msgId);
    if (!meta || meta.playerNum !== playerNum) continue;
    for (const [cur, mx] of healthArr) {
      current += cur;
      max += mx;
    }
  }
  return { current, max };
}

function lookupFigureHp(figureKey, playerNum, dcHealthState, dcMessageMeta) {
  if (!figureKey || !dcHealthState || !dcMessageMeta) return null;
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  const parts = figureKey.split('-');
  const figureIndex = parseInt(parts[parts.length - 1], 10) || 0;
  for (const [msgId, healthArr] of dcHealthState) {
    const meta = dcMessageMeta.get(msgId);
    if (!meta || meta.playerNum !== playerNum) continue;
    if (meta.dcName !== dcName && meta.dcName?.toLowerCase() !== dcName.toLowerCase()) continue;
    if (healthArr && healthArr[figureIndex]) {
      return { current: healthArr[figureIndex][0], max: healthArr[figureIndex][1] };
    }
  }
  return null;
}

function getAttackerPosition(action, game, dcMessageMeta) {
  const msgId = action.params?.msgId;
  const actingPN = action.actingPlayer;
  if (!msgId || !game.dcActionsData?.[msgId]) return null;
  const meta = dcMessageMeta?.get(msgId);
  if (!meta) return null;
  const actionsData = game.dcActionsData[msgId];
  const figureIndex = actionsData.selectedFigure ?? 0;
  const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
  const dgIndex = dgMatch ? dgMatch[1] : '1';
  const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
  return game.figurePositions?.[actingPN]?.[figureKey] || null;
}

function extractAttackFeatures(action, game, dcHealthState, dcMessageMeta) {
  const features = new Float64Array(6);
  features[5] = 1.0; // bias
  const targetFk = action.params?.targetFigureKey;
  if (!targetFk) return features;
  const actingPN = action.actingPlayer;
  const oppNum = actingPN === 1 ? 2 : 1;

  // [0] targetHpRatio — how wounded the target is (lower = more wounded)
  const hp = lookupFigureHp(targetFk, oppNum, dcHealthState, dcMessageMeta);
  if (hp && hp.max > 0) features[0] = hp.current / hp.max;

  // [1] targetDistNorm — distance from THIS attacker to target (not nearest ally)
  const targetPos = game.figurePositions?.[oppNum]?.[targetFk];
  const attackerPos = getAttackerPosition(action, game, dcMessageMeta);
  if (targetPos && attackerPos) {
    const dist = coordDistance(attackerPos, targetPos);
    features[1] = 1 - Math.min(dist, 10) / 10;
  }

  // [2] targetIsolated — fewer adjacent enemy allies = more isolated
  if (targetPos) {
    const oppFigs = Object.entries(game.figurePositions?.[oppNum] || {});
    let adjacentAllies = 0;
    for (const [fk, pos] of oppFigs) {
      if (fk === targetFk) continue;
      if (coordDistance(pos, targetPos) <= 2) adjacentAllies++;
    }
    features[2] = 1 - Math.min(adjacentAllies, 3) / 3;
  }

  // [3] targetThreat — how dangerous the target DC is
  let dcEffects;
  try { dcEffects = getDcEffects(); } catch { dcEffects = null; }
  if (dcEffects) {
    const targetDcName = targetFk.replace(/-\d+-\d+$/, '');
    features[3] = Math.min(1, getExpectedDamage(dcEffects, targetDcName) / 8);
  }

  // [4] killPotential — can THIS attacker finish it off?
  if (hp && dcEffects) {
    const myDcName = action.params?.dcName;
    const myExpDmg = myDcName ? getExpectedDamage(dcEffects, myDcName) : 0;
    features[4] = hp.current <= myExpDmg ? 1.0 : 0.0;
  }

  return features;
}

/**
 * Extract per-space features for move scoring (Phase 5 Slice 2).
 * Precomputes shared data (enemy positions, objectives) once, then scores each coord.
 */
function extractMoveFeatures(action, game, playerNum) {
  const features = new Float64Array(6);
  features[5] = 1.0; // bias

  const coord = action.params?.coord;
  if (!coord || action.params?.done) return features;

  const oppNum = playerNum === 1 ? 2 : 1;
  const oppFigs = Object.entries(game.figurePositions?.[oppNum] || {});
  const myFigs = Object.values(game.figurePositions?.[playerNum] || {});

  // [0] distToNearestEnemy — closer to enemy = higher (aggression)
  let minEnemyDist = 10;
  for (const [, pos] of oppFigs) {
    const d = coordDistance(coord, pos);
    if (d < minEnemyDist) minEnemyDist = d;
  }
  features[0] = 1 - Math.min(minEnemyDist, 10) / 10;

  // [1] threatAtDest — sum of expected damage from enemies that can attack this coord
  let dcEffects;
  try { dcEffects = getDcEffects(); } catch { dcEffects = null; }
  if (dcEffects && oppFigs.length > 0) {
    let threat = 0;
    for (const [fk, pos] of oppFigs) {
      const dcName = fk.replace(/-\d+-\d+$/, '');
      const range = getAttackRange(dcEffects, dcName);
      const dist = coordDistance(pos, coord);
      if (dist <= range) {
        threat += getExpectedDamage(dcEffects, dcName);
      }
    }
    features[1] = Math.min(1, threat / 10);
  }

  // [2] objectiveProximity — distance to nearest objective (terminals + mission tokens)
  let mapTokens;
  try { mapTokens = getMapTokensData(); } catch { mapTokens = null; }
  const mapId = game.selectedMap?.id;
  if (mapTokens && mapId && mapTokens[mapId]) {
    const mapData = mapTokens[mapId];
    const objCoords = [];
    if (Array.isArray(mapData.terminals)) objCoords.push(...mapData.terminals);
    const variant = game.selectedMission?.variant;
    const missionKey = variant ? `mission${variant.toUpperCase()}` : null;
    if (missionKey && mapData[missionKey]?.positions) {
      for (const coords of Object.values(mapData[missionKey].positions)) {
        if (Array.isArray(coords)) objCoords.push(...coords);
      }
    }
    if (objCoords.length > 0) {
      let minObjDist = 10;
      for (const oc of objCoords) {
        try {
          const d = coordDistance(coord, oc);
          if (d < minObjDist) minObjDist = d;
        } catch { /* skip invalid */ }
      }
      features[2] = 1 - Math.min(minObjDist, 10) / 10;
    }
  }

  // [3] allySupport — friendly figures within 3 spaces of destination
  let nearbyAllies = 0;
  for (const pos of myFigs) {
    if (coordDistance(coord, pos) <= 3) nearbyAllies++;
  }
  features[3] = Math.min(nearbyAllies, 4) / 4;

  // [4] mpEfficiency — movement cost relative to total MP (lower cost = higher efficiency)
  const moveKey = action.params?.moveKey;
  const moveState = moveKey ? game.moveInProgress?.[moveKey] : null;
  const totalMp = moveState?.totalMp || moveState?.mpRemaining || 4;
  const cost = action.params?.cost || 1;
  features[4] = 1 - Math.min(cost, totalMp) / totalMp;

  return features;
}

/**
 * Extract per-surge features for surge scoring (Phase 5 Slice 3).
 * Scores each surge option by its combat value.
 */
function extractSurgeFeatures(action) {
  const features = new Float64Array(4);
  features[3] = 1.0; // bias

  const surgeKey = action.params?.surgeKey;
  if (!surgeKey) return features;

  const parsed = parseSurgeEffect(surgeKey);

  // [0] damageValue — total offensive output (damage + pierce + blast + cleave), normalized
  const totalDmg = (parsed.damage || 0) + (parsed.pierce || 0) + (parsed.blast || 0) + (parsed.cleave || 0);
  features[0] = Math.min(totalDmg, 8) / 8;

  // [1] isAccuracy — does this surge add accuracy (needed for ranged attacks)
  features[1] = (parsed.accuracy || 0) > 0 ? 1.0 : 0.0;

  // [2] isRecover — does this surge recover health
  features[2] = (parsed.recover || 0) > 0 ? 1.0 : 0.0;

  return features;
}

/**
 * Extract per-CC features for command card scoring (Phase 5 Slice 4).
 * Scores each playable CC by cost, type, and game context.
 */
function extractCcFeatures(action, game) {
  const features = new Float64Array(4);
  features[3] = 1.0; // bias

  const cardName = action.params?.cardName;
  if (!cardName) return features;

  const ccData = getCcEffect(cardName);

  // [0] ccCost — higher cost CCs tend to be more impactful, normalized to 0-1
  features[0] = ccData ? Math.min(ccData.cost || 0, 4) / 4 : 0;

  // [1] isAttachment — attachments have persistent value vs one-shot effects
  features[1] = ccData?.attachment ? 1.0 : 0.0;

  // [2] inCombat — is there an active combat? Combat-timed CCs are more valuable then
  features[2] = game.pendingCombat ? 1.0 : 0.0;

  return features;
}

function getAvgDistToEnemy(game, playerNum) {
  const oppNum = playerNum === 1 ? 2 : 1;
  const myFigs = Object.values(game.figurePositions?.[playerNum] || {});
  const oppFigs = Object.values(game.figurePositions?.[oppNum] || {});
  if (myFigs.length === 0 || oppFigs.length === 0) return 8;
  let totalDist = 0;
  for (const myPos of myFigs) {
    let minD = Infinity;
    for (const oppPos of oppFigs) {
      const d = coordDistance(myPos, oppPos);
      if (d < minD) minD = d;
    }
    totalDist += minD;
  }
  return totalDist / myFigs.length;
}

function getMinDistToEnemy(game, playerNum) {
  const oppNum = playerNum === 1 ? 2 : 1;
  const myFigs = Object.values(game.figurePositions?.[playerNum] || {});
  const oppFigs = Object.values(game.figurePositions?.[oppNum] || {});
  if (myFigs.length === 0 || oppFigs.length === 0) return 10;
  let globalMin = Infinity;
  for (const myPos of myFigs) {
    for (const oppPos of oppFigs) {
      const d = coordDistance(myPos, oppPos);
      if (d < globalMin) globalMin = d;
    }
  }
  return globalMin;
}

function getArmyAttackPower(game, playerNum) {
  const figs = game.figurePositions?.[playerNum] || {};
  const figKeys = Object.keys(figs);
  if (figKeys.length === 0) return 0;
  let totalDmg = 0;
  let dcEffects;
  try { dcEffects = getDcEffects(); } catch { return 0; }
  for (const figKey of figKeys) {
    const dcName = figKey.replace(/-\d+-\d+$/, '');
    const lower = dcName.toLowerCase();
    const ciKey = Object.keys(dcEffects).find(k => k.toLowerCase() === lower);
    const eff = dcEffects[dcName] || (ciKey ? dcEffects[ciKey] : null);
    if (eff?.attack?.dice) {
      for (const die of eff.attack.dice) {
        totalDmg += EXPECTED_DMG_PER_DIE[die] || 0;
      }
    }
  }
  return Math.min(1, totalDmg / 15);
}

function getExpectedDamage(dcEffects, dcName) {
  const lower = dcName.toLowerCase();
  const ciKey = Object.keys(dcEffects).find(k => k.toLowerCase() === lower);
  const eff = dcEffects[dcName] || (ciKey ? dcEffects[ciKey] : null);
  if (!eff?.attack?.dice) return 0;
  let dmg = 0;
  for (const die of eff.attack.dice) {
    dmg += EXPECTED_DMG_PER_DIE[die] || 0;
  }
  return dmg;
}

function getAttackRange(dcEffects, dcName) {
  const lower = dcName.toLowerCase();
  const ciKey = Object.keys(dcEffects).find(k => k.toLowerCase() === lower);
  const eff = dcEffects[dcName] || (ciKey ? dcEffects[ciKey] : null);
  if (!eff?.attack) return 1; // default melee
  return eff.attack.range || 1;
}

// ── New Feature Helpers ─────────────────────────────────────────────────────

/**
 * enemyThreat — Approximate incoming danger to the currently acting figure.
 * Counts enemy figures within their attack range of the active figure,
 * weighted by expected damage. Normalizes to [0, 1].
 */
function getEnemyThreat(game, playerNum, dcMessageMeta) {
  const oppNum = playerNum === 1 ? 2 : 1;
  let activeFigPos = null;

  // Try to find the currently activated figure from dcActionsData
  if (game.dcActionsData && dcMessageMeta) {
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta?.playerNum === playerNum && game.dcActionsData?.[msgId]) {
        const actionsData = game.dcActionsData[msgId];
        const figureIndex = actionsData.selectedFigure ?? 0;
        const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
        const dgIndex = dgMatch ? dgMatch[1] : '1';
        const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
        activeFigPos = game.figurePositions?.[playerNum]?.[figureKey];
        if (activeFigPos) break;
      }
    }
  }

  // Fallback: check moveInProgress for a moving figure
  if (!activeFigPos && game.moveInProgress) {
    for (const moveState of Object.values(game.moveInProgress)) {
      if (moveState?.currentPosition) {
        activeFigPos = moveState.currentPosition;
        break;
      }
    }
  }

  // No active figure found — return 0
  if (!activeFigPos) return 0;

  let dcEffects;
  try { dcEffects = getDcEffects(); } catch { return 0; }

  const oppFigs = game.figurePositions?.[oppNum] || {};
  let threat = 0;

  for (const [figKey, pos] of Object.entries(oppFigs)) {
    const dcName = figKey.replace(/-\d+-\d+$/, '');
    const attackRange = getAttackRange(dcEffects, dcName);
    const dist = coordDistance(pos, activeFigPos);
    if (dist <= attackRange) {
      threat += getExpectedDamage(dcEffects, dcName);
    }
  }

  return Math.min(1, threat / 15);
}

/**
 * objectivePotential — How close the closest friendly figure is to any
 * map objective (terminals + mission tokens). Inversely normalized like closeness.
 */
function getObjectivePotential(game, playerNum) {
  let mapTokens;
  try { mapTokens = getMapTokensData(); } catch { return 0; }

  const mapId = game.selectedMap?.id;
  if (!mapId || !mapTokens?.[mapId]) return 0;

  const mapData = mapTokens[mapId];
  const objectiveCoords = [];

  // Add terminal positions
  if (Array.isArray(mapData.terminals)) {
    for (const coord of mapData.terminals) {
      objectiveCoords.push(coord);
    }
  }

  // Add mission variant positions
  const variant = game.selectedMission?.variant;
  const missionKey = variant ? `mission${variant.toUpperCase()}` : null;
  if (missionKey && mapData[missionKey]?.positions) {
    for (const coords of Object.values(mapData[missionKey].positions)) {
      if (Array.isArray(coords)) {
        for (const coord of coords) {
          objectiveCoords.push(coord);
        }
      }
    }
  }

  if (objectiveCoords.length === 0) return 0;

  const myFigs = Object.values(game.figurePositions?.[playerNum] || {});
  if (myFigs.length === 0) return 0;

  let globalMinDist = Infinity;
  for (const figPos of myFigs) {
    for (const objCoord of objectiveCoords) {
      try {
        const d = coordDistance(figPos, objCoord);
        if (d < globalMinDist) globalMinDist = d;
      } catch { /* skip invalid coords */ }
    }
  }

  if (!isFinite(globalMinDist)) return 0;
  return 1 - Math.min(globalMinDist, 10) / 10;
}

// ── Per-DC / Per-Figure Feature Helpers ──────────────────────────────────────

/**
 * Lowest surviving figure HP ratio for a player (0 = near death, 1 = full health).
 * Tells the AI which side has a vulnerable figure.
 */
function getLowestFigHpRatio(dcHealthState, dcMessageMeta, playerNum) {
  let lowest = 1;
  let found = false;
  for (const [msgId, healthArr] of dcHealthState) {
    const meta = dcMessageMeta.get(msgId);
    if (!meta || meta.playerNum !== playerNum) continue;
    for (const [cur, mx] of healthArr) {
      if (mx <= 0 || cur <= 0) continue; // dead or invalid
      found = true;
      const ratio = cur / mx;
      if (ratio < lowest) lowest = ratio;
    }
  }
  return found ? lowest : 1;
}

/**
 * Power token counts by type for a player.
 * Returns { offensive, defensive } normalized to /4 each.
 * Offensive = Hit + Surge tokens, Defensive = Block + Evade tokens.
 */
function getPowerTokensByType(game, playerNum) {
  const tokens = game.figurePowerTokens;
  if (!tokens) return { offensive: 0, defensive: 0 };
  const myFigKeys = Object.keys(game.figurePositions?.[playerNum] || {});
  let off = 0, def = 0;
  for (const fk of myFigKeys) {
    const ft = tokens[fk];
    if (!Array.isArray(ft)) continue;
    for (const t of ft) {
      const tl = String(t).toLowerCase();
      if (tl === 'hit' || tl === 'surge') off++;
      else if (tl === 'block' || tl === 'evade') def++;
    }
  }
  return { offensive: Math.min(off, 4) / 4, defensive: Math.min(def, 4) / 4 };
}

/**
 * CC hand size for a player, normalized (starting hand 3, max ~6).
 */
function getCcHandSizeNorm(game, playerNum) {
  const hand = playerNum === 1 ? game.player1CcHand : game.player2CcHand;
  if (!Array.isArray(hand)) return 0;
  return Math.min(hand.length, 6) / 6;
}

/**
 * Fraction of DCs exhausted (activated) this round.
 * 1 = all activated, 0 = none activated.
 */
function getExhaustedRatio(game, playerNum) {
  const activated = playerNum === 1 ? game.p1ActivatedDcIndices : game.p2ActivatedDcIndices;
  const total = playerNum === 1 ? game.p1ActivationsTotal : game.p2ActivationsTotal;
  if (!total || total <= 0) return 0;
  const numActivated = Array.isArray(activated) ? activated.length : 0;
  return Math.min(numActivated / total, 1);
}

/**
 * Condition counts for a player's figures.
 * Returns { total, stunned } — total conditions normalized /8,
 * stunned figures as fraction of alive figures.
 * Stun is separated because it blocks ALL actions (most impactful condition).
 */
function getConditionCounts(game, playerNum) {
  const conditions = game.figureConditions;
  const myFigKeys = Object.keys(game.figurePositions?.[playerNum] || {});
  if (!conditions || myFigKeys.length === 0) return { total: 0, stunned: 0 };
  let total = 0, stunned = 0;
  for (const fk of myFigKeys) {
    const fc = conditions[fk];
    if (!Array.isArray(fc)) continue;
    total += fc.length;
    if (fc.some(c => String(c).toLowerCase() === 'stun')) stunned++;
  }
  return {
    total: Math.min(total, 8) / 8,
    stunned: stunned / myFigKeys.length,
  };
}

/**
 * Average CC cost in a player's hand, normalized.
 * Higher avg cost = more powerful but harder to play.
 */
function getAvgCcCost(game, playerNum) {
  const hand = playerNum === 1 ? game.player1CcHand : game.player2CcHand;
  if (!Array.isArray(hand) || hand.length === 0) return 0;
  let totalCost = 0;
  for (const cardName of hand) {
    try {
      const effect = getCcEffect(cardName);
      totalCost += typeof effect?.cost === 'number' ? effect.cost : 0;
    } catch { /* unknown card */ }
  }
  return Math.min(totalCost / hand.length, 3) / 3; // Normalize: avg cost 0-3 → 0-1
}

// ── Feature Extraction ──────────────────────────────────────────────────────

export function extractFeatures(game, playerNum, dcHealthState, dcMessageMeta) {
  const oppNum = playerNum === 1 ? 2 : 1;
  const myVP = (playerNum === 1 ? game.player1VP : game.player2VP)?.total || 0;
  const oppVP = (oppNum === 1 ? game.player1VP : game.player2VP)?.total || 0;
  const myHp = getHpTotals(dcHealthState, dcMessageMeta, playerNum);
  const oppHp = getHpTotals(dcHealthState, dcMessageMeta, oppNum);
  const myFigs = Object.keys(game.figurePositions?.[playerNum] || {}).length;
  const oppFigs = Object.keys(game.figurePositions?.[oppNum] || {}).length;
  const avgDist = getAvgDistToEnemy(game, playerNum);
  const minDist = getMinDistToEnemy(game, playerNum);
  const round = game.currentRound || game.round || 1;
  const myActs = playerNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
  const oppActs = oppNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);

  const myHpRatio = myHp.max > 0 ? myHp.current / myHp.max : 0;
  const oppHpRatio = oppHp.max > 0 ? oppHp.current / oppHp.max : 0;
  const totalFigs = myFigs + oppFigs;
  const totalActs = myActs + oppActs;

  // Typed power tokens
  const myTokens = getPowerTokensByType(game, playerNum);
  const oppTokens = getPowerTokensByType(game, oppNum);

  // Conditions with Stun separated
  const myCond = getConditionCounts(game, playerNum);
  const oppCond = getConditionCounts(game, oppNum);

  return [
    /* 0  vpAdv             */ (myVP - oppVP) / 40,
    /* 1  myHpRatio         */ myHpRatio,
    /* 2  oppHpRatio        */ oppHpRatio,
    /* 3  hpAdv             */ myHpRatio - oppHpRatio,
    /* 4  myFigsRatio       */ totalFigs > 0 ? myFigs / totalFigs : 0.5,
    /* 5  figsAdv           */ totalFigs > 0 ? (myFigs - oppFigs) / totalFigs : 0,
    /* 6  closeness         */ 1 - Math.min(avgDist, 10) / 10,
    /* 7  nearestEnemy      */ 1 - Math.min(minDist, 10) / 10,
    /* 8  roundProgress     */ Math.min(round, 5) / 5,
    /* 9  activationsRatio  */ totalActs > 0 ? myActs / totalActs : 0.5,
    /* 10 inCombat          */ game.pendingCombat ? 1 : 0,
    /* 11 inMovement        */ game.moveInProgress && Object.keys(game.moveInProgress).length > 0 ? 1 : 0,
    /* 12 attackPower       */ getArmyAttackPower(game, playerNum),
    /* 13 bias              */ 1.0,
    /* 14 enemyThreat       */ getEnemyThreat(game, playerNum, dcMessageMeta),
    /* 15 objectivePotential */ getObjectivePotential(game, playerNum),
    // Per-DC health (16-17)
    /* 16 myLowestFigHp     */ getLowestFigHpRatio(dcHealthState, dcMessageMeta, playerNum),
    /* 17 oppLowestFigHp    */ getLowestFigHpRatio(dcHealthState, dcMessageMeta, oppNum),
    // Typed power tokens (18-21)
    /* 18 myOffensiveTokens */ myTokens.offensive,
    /* 19 myDefensiveTokens */ myTokens.defensive,
    /* 20 oppOffensiveTokens*/ oppTokens.offensive,
    /* 21 oppDefensiveTokens*/ oppTokens.defensive,
    // CC hand (22-25)
    /* 22 myCcHandSize      */ getCcHandSizeNorm(game, playerNum),
    /* 23 oppCcHandSize     */ getCcHandSizeNorm(game, oppNum),
    /* 24 myAvgCcCost       */ getAvgCcCost(game, playerNum),
    /* 25 oppAvgCcCost      */ getAvgCcCost(game, oppNum),
    // Activation order (26-28)
    /* 26 myExhaustedRatio  */ getExhaustedRatio(game, playerNum),
    /* 27 oppExhaustedRatio */ getExhaustedRatio(game, oppNum),
    /* 28 activationCountAdv*/ totalActs > 0 ? (myActs - oppActs) / Math.max(totalActs, 1) : 0,
    // Conditions — total + stun (29-32)
    /* 29 myConditions      */ myCond.total,
    /* 30 oppConditions     */ oppCond.total,
    /* 31 myStunnedRatio    */ myCond.stunned,
    /* 32 oppStunnedRatio   */ oppCond.stunned,
    // Initiative + VP urgency (33-35)
    /* 33 hasInitiative     */ game.initiativePlayerNum === playerNum ? 1 : 0,
    /* 34 vpUrgency         */ 1 - Math.min(myVP, 40) / 40,
    /* 35 oppVpUrgency      */ 1 - Math.min(oppVP, 40) / 40,
  ];
}

// ── Network Initialization ──────────────────────────────────────────────────

/** Initialize dueling network with He/Xavier init. */
export function initializeNetwork() {
  // W1: [HIDDEN_SIZE][NUM_FEATURES] — He init
  const heStd = Math.sqrt(2 / NUM_FEATURES);
  const W1 = [];
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    const row = [];
    for (let i = 0; i < NUM_FEATURES; i++) {
      row.push(randn() * heStd);
    }
    W1.push(row);
  }
  const b1 = new Array(HIDDEN_SIZE).fill(0);

  // Wv: [HIDDEN_SIZE] — Xavier init
  const xavierV = Math.sqrt(2 / (HIDDEN_SIZE + 1));
  const Wv = [];
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    Wv.push(randn() * xavierV);
  }
  const bv = 0;

  // Wa: [NUM_ACTIONS][HIDDEN_SIZE] — Xavier init
  const xavierA = Math.sqrt(2 / (HIDDEN_SIZE + NUM_ACTIONS));
  const Wa = [];
  for (let k = 0; k < NUM_ACTIONS; k++) {
    const row = [];
    for (let j = 0; j < HIDDEN_SIZE; j++) {
      row.push(randn() * xavierA);
    }
    Wa.push(row);
  }
  const ba = new Array(NUM_ACTIONS).fill(0);

  return { W1, b1, Wv, bv, Wa, ba };
}

/** Deep-copy all 6 parameter arrays of a network. */
function deepCopyNetwork(network) {
  return {
    W1: network.W1.map(row => [...row]),
    b1: [...network.b1],
    Wv: [...network.Wv],
    bv: network.bv,
    Wa: network.Wa.map(row => [...row]),
    ba: [...network.ba],
  };
}

// ── Forward Pass ────────────────────────────────────────────────────────────

/**
 * Dueling forward pass.
 * Returns { Q: [NUM_ACTIONS], V, A: [NUM_ACTIONS], h_pre: [HIDDEN_SIZE], h: [HIDDEN_SIZE] }
 */
function forwardPass(network, features) {
  const { W1, b1, Wv, bv, Wa, ba } = network;

  // Shared hidden layer: h_pre = W1 * features + b1, h = ReLU(h_pre)
  const h_pre = new Array(HIDDEN_SIZE);
  const h = new Array(HIDDEN_SIZE);
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    let sum = b1[j];
    for (let i = 0; i < NUM_FEATURES; i++) {
      sum += W1[j][i] * (features[i] || 0);
    }
    h_pre[j] = sum;
    h[j] = sum > 0 ? sum : 0; // ReLU
  }

  // Value head: V = Wv · h + bv
  let V = bv;
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    V += Wv[j] * h[j];
  }

  // Advantage head: A[k] = Wa[k] · h + ba[k]
  const nActions = Wa.length; // Use actual network size
  const A = new Array(nActions);
  let meanA = 0;
  for (let k = 0; k < nActions; k++) {
    let sum = ba[k];
    for (let j = 0; j < HIDDEN_SIZE; j++) {
      sum += Wa[k][j] * h[j];
    }
    A[k] = sum;
    meanA += sum;
  }
  meanA /= nActions;

  // Combine: Q[k] = V + A[k] - mean(A)
  const Q = new Array(nActions);
  for (let k = 0; k < nActions; k++) {
    Q[k] = V + A[k] - meanA;
  }

  return { Q, V, A, h_pre, h };
}

// ── NaN Safety ──────────────────────────────────────────────────────────────

function sanitizeParam(value) {
  return isFinite(value) ? value : 0;
}

function sanitizeNetwork(network, stats) {
  let resets = 0;
  const nHidden = network.b1.length;
  const nActions = network.Wa.length;

  for (let j = 0; j < nHidden; j++) {
    for (let i = 0; i < network.W1[j].length; i++) {
      if (!isFinite(network.W1[j][i])) { network.W1[j][i] = 0; resets++; }
    }
    if (!isFinite(network.b1[j])) { network.b1[j] = 0; resets++; }
    if (!isFinite(network.Wv[j])) { network.Wv[j] = 0; resets++; }
  }
  if (!isFinite(network.bv)) { network.bv = 0; resets++; }

  for (let k = 0; k < nActions; k++) {
    for (let j = 0; j < network.Wa[k].length; j++) {
      if (!isFinite(network.Wa[k][j])) { network.Wa[k][j] = 0; resets++; }
    }
    if (!isFinite(network.ba[k])) { network.ba[k] = 0; resets++; }
  }

  if (resets > 0 && stats) {
    stats.nanResets = (stats.nanResets || 0) + resets;
  }
  return resets;
}

// ── Backpropagation ─────────────────────────────────────────────────────────

/**
 * Manual backprop through dueling architecture with SGD + L2 weight decay.
 * Weight decay gently pulls weights toward zero (prevents explosion without hard caps).
 * Emergency clamp at ±50 as a safety net that should never trigger with decay active.
 */
function backpropUpdate(network, actionIdx, delta, alpha, h_pre, h, features) {
  const { W1, b1, Wv, Wa, ba } = network;
  const nActions = Wa.length; // Use actual network size, not constant
  const dAChosen = delta * ((nActions - 1) / nActions);
  const dAOther = delta * (-1 / nActions);
  const decay = 1 - WEIGHT_DECAY;
  const clamp = WEIGHT_CLAMP_EMERGENCY;

  // Advantage head gradients + decay
  for (let m = 0; m < nActions; m++) {
    const dA = (m === actionIdx) ? dAChosen : dAOther;
    for (let j = 0; j < HIDDEN_SIZE; j++) {
      Wa[m][j] = Math.max(-clamp, Math.min(clamp, Wa[m][j] * decay + alpha * dA * h[j]));
    }
    ba[m] += alpha * dA; // No decay on biases (standard practice)
  }

  // Value head gradients + decay
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    Wv[j] = Math.max(-clamp, Math.min(clamp, Wv[j] * decay + alpha * delta * h[j]));
  }
  network.bv += alpha * delta;

  // Hidden layer gradients (sum V + A head contributions, gate through ReLU)
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    let grad_h = delta * Wv[j];
    for (let m = 0; m < nActions; m++) {
      const dA = (m === actionIdx) ? dAChosen : dAOther;
      grad_h += dA * Wa[m][j];
    }
    const grad_pre = h_pre[j] > 0 ? grad_h : 0; // ReLU gate

    // Input layer gradients + decay
    for (let i = 0; i < NUM_FEATURES; i++) {
      W1[j][i] = Math.max(-clamp, Math.min(clamp, W1[j][i] * decay + alpha * grad_pre * (features[i] || 0)));
    }
    b1[j] += alpha * grad_pre;
  }
}

// ── Masked Q ────────────────────────────────────────────────────────────────

/**
 * Compute max Q over only legal action indices.
 * Returns 0 for terminal states (null/empty nextActionIdxs).
 */
function getMaskedBestQ(network, features, nextActionIdxs) {
  if (!nextActionIdxs || nextActionIdxs.length === 0) return 0;
  const { Q } = forwardPass(network, features);
  let maxQ = -Infinity;
  for (const idx of nextActionIdxs) {
    if (idx >= 0 && idx < Q.length && Q[idx] > maxQ) {
      maxQ = Q[idx];
    }
  }
  return maxQ === -Infinity ? 0 : maxQ;
}

// ── Training Update (Neural) ────────────────────────────────────────────────

function updateTraceNeural(learnings, trace) {
  if (!learnings.network) learnings.network = initializeNetwork();
  if (!learnings.targetNetwork) learnings.targetNetwork = deepCopyNetwork(learnings.network);
  if (!learnings.trainingStats) {
    learnings.trainingStats = {
      totalUpdates: 0, avgAbsDelta: 0, featureNames: FEATURE_NAMES,
      hiddenSize: HIDDEN_SIZE, lastTargetSync: 0, targetSyncs: 0,
      nanResets: 0, tdErrorHistory: [],
    };
  }

  const network = learnings.network;
  const targetNetwork = learnings.targetNetwork;
  const stats = learnings.trainingStats;
  let deltaSum = 0;
  let count = 0;

  // Backward sweep through trace
  for (let i = trace.length - 1; i >= 0; i--) {
    const entry = trace[i];
    if (!entry.features) continue;

    const { features, actionIdx, reward, nextFeatures, nextActionIdxs, done } = entry;

    // Forward pass on online network
    const { Q, h_pre, h } = forwardPass(network, features);

    // Compute TD target
    let target;
    if (done || !nextFeatures) {
      target = reward;
    } else {
      const maxQNext = getMaskedBestQ(targetNetwork, nextFeatures, nextActionIdxs);
      target = reward + GAMMA * maxQNext;
    }

    // Clip TD error
    const rawDelta = target - Q[actionIdx];
    const delta = Math.max(-DELTA_CLAMP, Math.min(DELTA_CLAMP, rawDelta));

    // Backprop update
    backpropUpdate(network, actionIdx, delta, ALPHA, h_pre, h, features);

    // NaN safety
    sanitizeNetwork(network, stats);

    // Within-group scorer update (Phase 5)
    if (entry.wgFeatures && entry.wgType && learnings.withinGroupWeights) {
      const wgW = learnings.withinGroupWeights[entry.wgType];
      if (wgW) {
        for (let fi = 0; fi < wgW.length; fi++) {
          wgW[fi] += ALPHA_WG * delta * (entry.wgFeatures[fi] || 0);
          wgW[fi] = Math.max(-WG_WEIGHT_CLAMP, Math.min(WG_WEIGHT_CLAMP, wgW[fi]));
          if (!isFinite(wgW[fi])) wgW[fi] = 0;
        }
      }
    }

    deltaSum += Math.abs(rawDelta);
    count++;
    stats.totalUpdates++;

    // TD error history (sample every 100 updates)
    if (stats.totalUpdates % 100 === 0) {
      const meanAbsTD = count > 0 ? deltaSum / count : 0;
      if (!stats.tdErrorHistory) stats.tdErrorHistory = [];
      stats.tdErrorHistory.push({ updates: stats.totalUpdates, meanAbsTD });
      if (stats.tdErrorHistory.length > 500) stats.tdErrorHistory.shift();
    }

    // Target network sync
    if (stats.totalUpdates > 0 && stats.totalUpdates % TARGET_UPDATE_INTERVAL === 0) {
      learnings.targetNetwork = deepCopyNetwork(network);
      stats.lastTargetSync = stats.totalUpdates;
      stats.targetSyncs = (stats.targetSyncs || 0) + 1;
    }

    // Store transition in replay buffer
    if (learnings.replayBuffer) {
      const buf = learnings.replayBuffer;
      const transition = {
        features: features.slice(),
        actionIdx,
        reward,
        nextFeatures: nextFeatures ? nextFeatures.slice() : null,
        nextActionIdxs: nextActionIdxs ? nextActionIdxs.slice() : null,
        done: !!done,
      };
      if (buf.transitions.length < REPLAY_BUFFER_SIZE) {
        buf.transitions.push(transition);
      } else {
        buf.transitions[buf.writeIdx] = transition;
      }
      buf.writeIdx = (buf.writeIdx + 1) % REPLAY_BUFFER_SIZE;
      buf.count++;
    }
  }

  if (count > 0) {
    const prevAvg = stats.avgAbsDelta || 0;
    stats.avgAbsDelta = prevAvg * 0.95 + (deltaSum / count) * 0.05;
  }
}

// ── Experience Replay ────────────────────────────────────────────────────

export function replayUpdate(learnings) {
  const buf = learnings.replayBuffer;
  if (!buf || buf.transitions.length < REPLAY_MIN_SIZE) return;

  const network = learnings.network;
  const targetNetwork = learnings.targetNetwork;
  const stats = learnings.trainingStats;
  if (!network || !targetNetwork) return;

  const bufLen = buf.transitions.length;

  for (let batch = 0; batch < REPLAY_UPDATES_PER_GAME; batch++) {
    let deltaSum = 0;
    for (let b = 0; b < REPLAY_BATCH_SIZE; b++) {
      const idx = Math.floor(Math.random() * bufLen);
      const t = buf.transitions[idx];
      if (!t || !t.features) continue;

      const { features, actionIdx, reward, nextFeatures, nextActionIdxs, done } = t;
      const { Q, h_pre, h } = forwardPass(network, features);

      let target;
      if (done || !nextFeatures) {
        target = reward;
      } else {
        const maxQNext = getMaskedBestQ(targetNetwork, nextFeatures, nextActionIdxs);
        target = reward + GAMMA * maxQNext;
      }

      const rawDelta = target - Q[actionIdx];
      const delta = Math.max(-DELTA_CLAMP, Math.min(DELTA_CLAMP, rawDelta));
      backpropUpdate(network, actionIdx, delta, REPLAY_ALPHA, h_pre, h, features);
      sanitizeNetwork(network, stats);

      deltaSum += Math.abs(rawDelta);
      stats.totalUpdates++;

      if (stats.totalUpdates > 0 && stats.totalUpdates % TARGET_UPDATE_INTERVAL === 0) {
        learnings.targetNetwork = deepCopyNetwork(network);
        stats.lastTargetSync = stats.totalUpdates;
        stats.targetSyncs = (stats.targetSyncs || 0) + 1;
      }
    }
    const batchAvg = deltaSum / REPLAY_BATCH_SIZE;
    stats.avgAbsDelta = (stats.avgAbsDelta || 0) * 0.95 + batchAvg * 0.05;
  }
}

// ── Action Abstraction ──────────────────────────────────────────────────────

/**
 * Classify a surge key as damage-increasing or utility/special.
 * Damage: +damage, pierce, blast, cleave, and named damage specials.
 * Special: accuracy, recover, conditions, tokens, and everything else.
 */
function classifySurge(surgeKey) {
  if (!surgeKey) return 'spend_surge'; // fallback for missing key
  const k = String(surgeKey).replace(/^double:/, '').replace(/\s*\([^)]*\)/g, '').toLowerCase().trim();
  // Direct damage effects
  if (/^damage\s+\d+$/.test(k) || /^\+\d+\s+hits?$/.test(k)) return 'surge_damage';
  if (/^pierce\s+\d+$/.test(k)) return 'surge_damage';
  if (/^blast\s+\d+$/.test(k)) return 'surge_damage';
  if (/^cleave\s+\d+$/.test(k)) return 'surge_damage';
  if (k === 'critical_hit' || k === 'deadly_spin' || k === 'shrapnel' || k === 'deadly') return 'surge_damage';
  // Multi-part combos containing damage/pierce/blast/cleave
  if (/damage|pierce|blast|cleave/.test(k)) return 'surge_damage';
  // Everything else: accuracy, recover, conditions, tokens, specials
  return 'surge_special';
}

export function abstractActionType(action, game) {
  const t = action.type;
  // Mandatory flow actions
  if (t === 'phase_gate_ready' || t === 'end_start_of_round' ||
      t === 'end_end_of_round' || t === 'end_activation_phase') return 'gate';
  if (t === 'combat_ready' || t === 'combat_roll') return 'combat_flow';
  // Strategic combat actions
  if (t === 'combat_resolve' || t === 'combat_skip_surges') return 'skip_surges';
  if (t?.startsWith('combat_reroll')) return 'reroll';
  if (t?.startsWith('combat_surge')) return classifySurge(action.params?.surgeKey);
  // DC specials
  if (t === 'dc_special') return 'ability';
  // CC play (dedicated type — hand management decision)
  if (t === 'play_cc') return 'play_cc';
  // Attacks
  if (t === 'attack_target') {
    if (action.params?.targetFigureKey && game) {
      const oppNum = action.actingPlayer === 1 ? 2 : 1;
      const tPos = game.figurePositions?.[oppNum]?.[action.params.targetFigureKey];
      const myFigs = game.figurePositions?.[action.actingPlayer] || {};
      if (tPos) {
        let minD = Infinity;
        for (const pos of Object.values(myFigs)) {
          const d = coordDistance(pos, tPos);
          if (d < minD) minD = d;
        }
        return minD <= 2 ? 'attack_close' : 'attack_ranged';
      }
    }
    return 'attack_close';
  }
  // Movement
  if (t === 'move_pick_space') {
    if (action.params?.done) return 'move_done';
    if (action.params?.coord && game) {
      const pn = action.actingPlayer;
      const oppNum = pn === 1 ? 2 : 1;
      const oppFigs = Object.values(game.figurePositions?.[oppNum] || {});
      if (oppFigs.length > 0) {
        const moveKey = action.params.moveKey;
        const moveState = game.moveInProgress?.[moveKey];
        const curPos = moveState?.currentPosition || moveState?.startCoord;
        if (curPos) {
          const curDist = Math.min(...oppFigs.map(p => coordDistance(curPos, p)));
          const newDist = Math.min(...oppFigs.map(p => coordDistance(action.params.coord, p)));
          if (newDist < curDist) return 'move_toward';
          if (newDist > curDist) return 'move_away';
          return 'move_lateral';
        }
      }
    }
    return 'move_toward';
  }
  if (t === 'move_figure') return 'start_move';
  // Activation
  if (t === 'activate_dc') return 'activate';
  if (t === 'dc_end_activation') return 'end_activation';
  if (t === 'pass_activation_turn') return 'pass';
  // Interact (mission objectives, terminals, doors)
  if (t === 'interact') return 'interact';
  // Reactive counterplay — use vs skip (learned binary decision)
  if (t === 'negation_play' || t === 'celebration_play' || t === 'cover_fire_block') return 'react_use';
  if (t === 'negation_let_resolve' || t === 'celebration_pass' || t === 'cover_fire_skip') return 'react_skip';
  // Strain choice — discard CCs (react_use) vs take all damage (react_skip)
  if (t === 'strain_choice_discard') return 'react_use';
  if (t === 'strain_choice_alldmg') return 'react_skip';
  // Interrupt use/skip decisions (reuse react_use/react_skip from A2)
  if (t === 'still_faster_use' || t === 'hunter_protocol_trigger' || t === 'last_resort_use') return 'react_use';
  if (t === 'still_faster_skip' || t === 'hunter_protocol_skip' || t === 'last_resort_skip') return 'react_skip';
  if (t === 'still_faster_dc_pick') return 'ability';
  // Combat-reaction defensive abilities — use vs skip (learned binary decision)
  if (t === 'strike_me_down_yes' || t === 'slow_on_draw_yes' || t === 'force_exhaustion_yes' ||
      t === 'tough_luck_remove' || t === 'power_converter_approve' ||
      t === 'illicit_arms_pick' || t === 'there_is_no_try_die') return 'react_use';
  if (t === 'strike_me_down_no' || t === 'slow_on_draw_no' || t === 'force_exhaustion_no' ||
      t === 'tough_luck_skip' || t === 'power_converter_skip' ||
      t === 'illicit_arms_skip' || t === 'there_is_no_try_skip') return 'react_skip';
  // Multi-step sub-actions for defensive abilities (stay in ability bucket)
  if (t === 'there_is_no_try_face' || t === 'illicit_arms_use' ||
      t === 'power_converter_die' || t === 'power_converter_color') return 'ability';
  // Power token choice — offensive vs defensive (learned)
  if (t === 'power_token_choice') {
    const tt = action.params?.tokenType;
    return (tt === 'hit' || tt === 'surge') ? 'token_offense' : 'token_defense';
  }
  // Force Vision pick (Kanan Jarrus) — choosing which group activates next
  if (t === 'force_vision_pick') return 'ability';
  // Remaining pending sub-state actions (DC-specific, stay in ability bucket)
  if (t === 'dc_ability_choice' || t === 'pounce_space' ||
      t === 'missile_salvo_die' || t === 'missile_salvo_done' ||
      t === 'spread_pain_cond') return 'ability';
  // Fallback
  return 'other';
}

// ── Snapshots & Rewards ─────────────────────────────────────────────────────

export function captureSnapshot(game, playerNum, dcHealthState, dcMessageMeta) {
  const oppNum = playerNum === 1 ? 2 : 1;
  const myHp = getHpTotals(dcHealthState, dcMessageMeta, playerNum);
  const oppHp = getHpTotals(dcHealthState, dcMessageMeta, oppNum);
  return {
    myVP: (playerNum === 1 ? game.player1VP : game.player2VP)?.total || 0,
    oppVP: (oppNum === 1 ? game.player1VP : game.player2VP)?.total || 0,
    myHpCurrent: myHp.current,
    myHpMax: myHp.max,
    oppHpCurrent: oppHp.current,
    oppHpMax: oppHp.max,
    avgDist: getAvgDistToEnemy(game, playerNum),
    myFigs: Object.keys(game.figurePositions?.[playerNum] || {}).length,
    oppFigs: Object.keys(game.figurePositions?.[oppNum] || {}).length,
  };
}

export function computeReward(before, after, isTerminal, didWin) {
  const w = REWARD_WEIGHTS;
  const deltaVP = (after.myVP - before.myVP) - (after.oppVP - before.oppVP);
  const oppDmgBefore = before.oppHpMax - before.oppHpCurrent;
  const oppDmgAfter = after.oppHpMax - after.oppHpCurrent;
  const deltaEnemyDmg = oppDmgAfter - oppDmgBefore;
  const deltaMyHP = after.myHpCurrent - before.myHpCurrent;
  const deltaDist = before.avgDist - after.avgDist;

  let reward = w.vp * deltaVP + w.dmg * deltaEnemyDmg + w.hp * deltaMyHP + w.dist * deltaDist + (w.step || 0);
  if (isTerminal) {
    reward += didWin ? w.terminal : -w.terminal;
  }
  return reward;
}

// ── Action Selection ────────────────────────────────────────────────────────

function getEpsilon(totalGames) {
  return Math.max(0.05, 0.3 * Math.exp(-totalGames / 5000));
}

export function pickSmartAction(allActions, game, learnings, playerNum, dcHealthState, dcMessageMeta) {
  pickSmartAction._lastWgFeatures = null;
  pickSmartAction._lastWgType = null;
  if (allActions.length === 0) return null;
  if (allActions.length === 1) return allActions[0];

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // Group actions by abstract type
  const groups = {};
  for (const action of allActions) {
    const abs = abstractActionType(action, game);
    if (!groups[abs]) groups[abs] = [];
    groups[abs].push(action);
  }

  // Mandatory actions — always use heuristic (no strategic choice)
  const mandatoryTypes = ['gate', 'combat_flow'];
  const mandatoryActions = allActions.filter(a => mandatoryTypes.includes(abstractActionType(a, game)));
  if (mandatoryActions.length === allActions.length) return pick(mandatoryActions);
  if (mandatoryActions.length > 0) return pick(mandatoryActions);

  // Strategic actions only from here
  const strategicActions = allActions.filter(a => !mandatoryTypes.includes(abstractActionType(a, game)));
  if (strategicActions.length === 0) return pick(allActions);

  // Epsilon-greedy exploration
  const epsilon = getEpsilon(learnings.meta.totalGames);
  if (Math.random() < epsilon) {
    return heuristicPick(strategicActions, game);
  }

  // Exploitation: compute Q via dueling neural network
  const features = extractFeatures(game, playerNum, dcHealthState, dcMessageMeta);
  const network = learnings.network;
  if (!network) return heuristicPick(strategicActions, game);

  const { Q } = forwardPass(network, features);
  const absTypes = Object.keys(groups).filter(t => !mandatoryTypes.includes(t));
  if (absTypes.length === 0) return heuristicPick(strategicActions, game);

  let bestType = null;
  let bestQ = -Infinity;
  for (const absType of absTypes) {
    const idx = ABSTRACT_TYPES.indexOf(absType);
    if (idx < 0) continue;
    if (Q[idx] > bestQ) {
      bestQ = Q[idx];
      bestType = absType;
    }
  }

  if (bestType === null) return heuristicPick(strategicActions, game);
  const wgResult = pickWithinGroup(groups[bestType], bestType, game,
    learnings.withinGroupWeights, dcHealthState, dcMessageMeta, learnings.meta.totalGames);
  pickSmartAction._lastWgFeatures = wgResult.wgFeatures;
  pickSmartAction._lastWgType = wgResult.wgType;
  return wgResult.action;
}

function dotProductWg(weights, features) {
  let sum = 0;
  for (let i = 0; i < weights.length && i < features.length; i++) {
    sum += weights[i] * features[i];
  }
  return sum;
}

function pickWithinGroup(actions, absType, game, wgWeights, dcHealthState, dcMessageMeta, totalGames) {
  if (actions.length <= 1) return { action: actions[0], wgFeatures: null, wgType: null };
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // Attack scorer (Phase 5 learned)
  if (absType === 'attack_close' || absType === 'attack_ranged') {
    const group = 'attack';
    const weights = wgWeights?.[group];
    if (weights && Math.random() >= getWgEpsilon(totalGames || 0)) {
      let bestScore = -Infinity, bestAction = null, bestFeatures = null;
      for (const a of actions) {
        const f = extractAttackFeatures(a, game, dcHealthState, dcMessageMeta);
        const score = dotProductWg(weights, f);
        if (score > bestScore) { bestScore = score; bestAction = a; bestFeatures = f; }
      }
      return { action: bestAction, wgFeatures: bestFeatures, wgType: group };
    }
    return { action: pick(actions), wgFeatures: null, wgType: null };
  }

  // Move scorer (Phase 5 Slice 2 — learned)
  if (absType === 'move_toward' || absType === 'move_away' || absType === 'move_lateral') {
    const group = 'move';
    const weights = wgWeights?.[group];
    const playerNum = actions[0].actingPlayer;
    // Filter out "done" actions for scoring — they have no coord to evaluate
    const spaceActions = actions.filter(a => a.params?.coord && !a.params?.done);
    if (weights && spaceActions.length > 0 && Math.random() >= getWgEpsilon(totalGames || 0)) {
      let bestScore = -Infinity, bestAction = null, bestFeatures = null;
      for (const a of spaceActions) {
        const f = extractMoveFeatures(a, game, playerNum);
        const score = dotProductWg(weights, f);
        if (score > bestScore) { bestScore = score; bestAction = a; bestFeatures = f; }
      }
      return { action: bestAction, wgFeatures: bestFeatures, wgType: group };
    }
    // Fallback: heuristic (nearest enemy)
    if (spaceActions.length > 0) {
      const oppNum = playerNum === 1 ? 2 : 1;
      const oppFigs = Object.values(game.figurePositions?.[oppNum] || {});
      if (oppFigs.length > 0) {
        const scored = spaceActions.map(a => {
          const dist = Math.min(...oppFigs.map(p => coordDistance(a.params.coord, p)));
          return { action: a, dist };
        });
        scored.sort((a, b) => a.dist - b.dist);
        const best = scored[0].dist;
        const tied = scored.filter(s => s.dist === best);
        return { action: pick(tied).action, wgFeatures: null, wgType: null };
      }
    }
  }

  // Surge scorer (Phase 5 Slice 3 — learned)
  if (absType === 'surge_damage' || absType === 'surge_special' || absType === 'spend_surge') {
    const group = 'surge';
    const weights = wgWeights?.[group];
    if (weights && Math.random() >= getWgEpsilon(totalGames || 0)) {
      let bestScore = -Infinity, bestAction = null, bestFeatures = null;
      for (const a of actions) {
        const f = extractSurgeFeatures(a);
        const score = dotProductWg(weights, f);
        if (score > bestScore) { bestScore = score; bestAction = a; bestFeatures = f; }
      }
      return { action: bestAction, wgFeatures: bestFeatures, wgType: group };
    }
    return { action: pick(actions), wgFeatures: null, wgType: null };
  }

  // CC scorer (Phase 5 Slice 4 — learned)
  if (absType === 'play_cc') {
    const group = 'cc';
    const weights = wgWeights?.[group];
    if (weights && actions.length > 1 && Math.random() >= getWgEpsilon(totalGames || 0)) {
      let bestScore = -Infinity, bestAction = null, bestFeatures = null;
      for (const a of actions) {
        const f = extractCcFeatures(a, game);
        const score = dotProductWg(weights, f);
        if (score > bestScore) { bestScore = score; bestAction = a; bestFeatures = f; }
      }
      return { action: bestAction, wgFeatures: bestFeatures, wgType: group };
    }
    return { action: pick(actions), wgFeatures: null, wgType: null };
  }

  return { action: pick(actions), wgFeatures: null, wgType: null };
}

function heuristicPick(allActions, game) {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const gates = allActions.filter(a => a.type === 'phase_gate_ready');
  if (gates.length > 0) return pick(gates);
  const transitions = allActions.filter(a =>
    a.type === 'end_end_of_round' || a.type === 'end_start_of_round' || a.type === 'end_activation_phase');
  if (transitions.length > 0) return pick(transitions);

  // Reactive counterplay, interrupts & defensive abilities — respond to pending states
  const reactiveTypes = ['negation_play', 'negation_let_resolve',
    'celebration_play', 'celebration_pass',
    'cover_fire_block', 'cover_fire_skip',
    'still_faster_use', 'still_faster_skip', 'still_faster_dc_pick',
    'hunter_protocol_trigger', 'hunter_protocol_skip',
    'last_resort_use', 'last_resort_skip',
    'strike_me_down_yes', 'strike_me_down_no',
    'slow_on_draw_yes', 'slow_on_draw_no',
    'force_exhaustion_yes', 'force_exhaustion_no',
    'illicit_arms_pick', 'illicit_arms_skip', 'illicit_arms_use',
    'tough_luck_remove', 'tough_luck_skip',
    'power_converter_approve', 'power_converter_skip',
    'power_converter_die', 'power_converter_color',
    'there_is_no_try_die', 'there_is_no_try_face', 'there_is_no_try_skip',
    'strain_choice_alldmg', 'strain_choice_discard',
    'force_vision_pick'];
  const reactive = allActions.filter(a => reactiveTypes.includes(a.type));
  if (reactive.length > 0) return pick(reactive);

  // Other pending sub-states
  const pendingTypes = ['dc_ability_choice', 'pounce_space',
    'missile_salvo_die', 'missile_salvo_done',
    'power_token_choice', 'spread_pain_cond'];
  const pending = allActions.filter(a => pendingTypes.includes(a.type));
  if (pending.length > 0) return pick(pending);

  const combat = allActions.filter(a => a.type?.startsWith('combat_'));
  if (combat.length > 0) return pick(combat);

  const attacks = allActions.filter(a => a.type === 'attack_target' && a.params?.targetFigureKey);
  if (attacks.length > 0) return pickWithinGroup(attacks, 'attack_close', game, null, null, null, 0).action;

  // CC play — try before movement/activation
  const ccPlay = allActions.filter(a => a.type === 'play_cc');
  if (ccPlay.length > 0) return pick(ccPlay);

  const specials = allActions.filter(a => a.type === 'dc_special');
  if (specials.length > 0) return pick(specials);

  const moveSpaces = allActions.filter(a => a.type === 'move_pick_space' && !a.params?.done);
  if (moveSpaces.length > 0) return pickWithinGroup(moveSpaces, 'move_toward', game, null, null, null, 0).action;

  const moveStart = allActions.filter(a => a.type === 'move_figure');
  if (moveStart.length > 0) return pick(moveStart);

  const moveFinish = allActions.filter(a => a.type === 'move_pick_space' && a.params?.done);
  if (moveFinish.length > 0) return pick(moveFinish);

  const endAct = allActions.filter(a => a.type === 'dc_end_activation');
  if (endAct.length > 0) return pick(endAct);
  const activate = allActions.filter(a => a.type === 'activate_dc');
  if (activate.length > 0) return pick(activate);

  return pick(allActions);
}

// ── Game Loop Integration ───────────────────────────────────────────────────

/**
 * Compute unique abstract action type indices from a set of game actions.
 * Excludes mandatory (gate, combat_flow) types.
 */
function getAbstractTypeIdxs(actions, game) {
  const idxSet = new Set();
  const mandatoryTypes = ['gate', 'combat_flow'];
  for (const action of actions) {
    const abs = abstractActionType(action, game);
    if (mandatoryTypes.includes(abs)) continue;
    const idx = ABSTRACT_TYPES.indexOf(abs);
    if (idx >= 0) idxSet.add(idx);
  }
  return idxSet.size > 0 ? [...idxSet] : null;
}

export function createGameTracer(learnings, playerNum, dcHealthState, dcMessageMeta) {
  const trace = [];
  let lastSnapshot = null;
  let lastFeatures = null;

  return {
    beforeAction(game, playerActions) {
      // Fill in previous entry's nextActionIdxs from current available actions
      if (playerActions && trace.length > 0) {
        const prev = trace[trace.length - 1];
        if (prev.nextActionIdxs === null && !prev.done) {
          prev.nextActionIdxs = getAbstractTypeIdxs(playerActions, game);
        }
      }

      lastSnapshot = captureSnapshot(game, playerNum, dcHealthState, dcMessageMeta);
      lastFeatures = extractFeatures(game, playerNum, dcHealthState, dcMessageMeta);
    },

    afterAction(game, action) {
      if (!lastSnapshot || !lastFeatures) return;
      const absType = abstractActionType(action, game);
      if (absType === 'gate' || absType === 'combat_flow') {
        lastSnapshot = null;
        lastFeatures = null;
        return;
      }
      const afterSnap = captureSnapshot(game, playerNum, dcHealthState, dcMessageMeta);
      const nextFeatures = extractFeatures(game, playerNum, dcHealthState, dcMessageMeta);
      const reward = computeReward(lastSnapshot, afterSnap, false, false);
      const actionIdx = ABSTRACT_TYPES.indexOf(absType);
      const wgFeatures = pickSmartAction._lastWgFeatures || null;
      const wgType = pickSmartAction._lastWgType || null;
      trace.push({
        features: lastFeatures, actionIdx, reward, nextFeatures,
        nextActionIdxs: null, done: false,
        wgFeatures, wgType,
      });
      lastSnapshot = null;
      lastFeatures = null;
    },

    finalize(game, updateMeta = false) {
      const didWin = game.ended && game.winnerId === (playerNum === 1 ? game.player1Id : game.player2Id);
      const didLose = game.ended && game.winnerId && !didWin;
      if (trace.length > 0 && game.ended) {
        const last = trace[trace.length - 1];
        last.reward += didWin ? REWARD_WEIGHTS.terminal : (didLose ? -REWARD_WEIGHTS.terminal : 0);
        last.nextFeatures = null; // Terminal state
        last.nextActionIdxs = null;
        last.done = true;
      }
      updateTraceNeural(learnings, trace);
      if (updateMeta) {
        learnings.meta.totalGames++;
        if (game.ended && game.winnerId) {
          if (game.winnerId === game.player1Id) learnings.meta.p1Wins++;
          else learnings.meta.p2Wins++;
        }
      }
    },

    getTrace() { return trace; },
  };
}

// ── Persistence ─────────────────────────────────────────────────────────────

export function loadLearnings(filePath) {
  try {
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      // Migrate from Phase 1/2 to Phase 3 if needed
      if (!data.network) {
        data.network = initializeNetwork();
        delete data.weights;
        delete data.states;
        data.brainPhase = 3;
      }
      if (!data.trainingStats) {
        data.trainingStats = {
          totalUpdates: 0, avgAbsDelta: 0, featureNames: FEATURE_NAMES,
          hiddenSize: HIDDEN_SIZE, lastTargetSync: 0, targetSyncs: 0,
          nanResets: 0, tdErrorHistory: [],
        };
      }
      // Migrate network from fewer input features to current NUM_FEATURES
      // (e.g., 16 → N when new features are added)
      if (data.network && data.network.W1[0] && data.network.W1[0].length < NUM_FEATURES) {
        const oldFeatures = data.network.W1[0].length;
        const heInit = Math.sqrt(2 / NUM_FEATURES);
        for (let j = 0; j < data.network.W1.length; j++) {
          for (let i = oldFeatures; i < NUM_FEATURES; i++) {
            data.network.W1[j].push(randn() * heInit);
          }
        }
        console.log(`[learnings] Migrated W1 input features: ${oldFeatures} → ${NUM_FEATURES}`);
      }
      // Migrate network from fewer action types to current NUM_ACTIONS
      // (e.g., 15 → 22 when A2 splits were added)
      if (data.network && data.network.Wa.length < NUM_ACTIONS) {
        const oldCount = data.network.Wa.length;
        const xavierA = Math.sqrt(2 / (HIDDEN_SIZE + NUM_ACTIONS));
        for (let k = oldCount; k < NUM_ACTIONS; k++) {
          const row = [];
          for (let j = 0; j < HIDDEN_SIZE; j++) row.push(randn() * xavierA);
          data.network.Wa.push(row);
          data.network.ba.push(0);
        }
      }
      // Ensure Phase 3 stats fields exist
      data.trainingStats.featureNames = FEATURE_NAMES;
      data.trainingStats.hiddenSize = HIDDEN_SIZE;
      if (data.trainingStats.lastTargetSync === undefined) data.trainingStats.lastTargetSync = 0;
      if (data.trainingStats.targetSyncs === undefined) data.trainingStats.targetSyncs = 0;
      if (data.trainingStats.nanResets === undefined) data.trainingStats.nanResets = 0;
      if (!data.trainingStats.tdErrorHistory) data.trainingStats.tdErrorHistory = [];
      data.brainPhase = 3;
      // Target network is always recreated from online network (not persisted)
      data.targetNetwork = deepCopyNetwork(data.network);
      if (!data.dcStats) data.dcStats = {};
      if (!data.affiliationStats) data.affiliationStats = {};
      if (!data.matchups) data.matchups = [];
      if (!data.replayBuffer) data.replayBuffer = { transitions: [], writeIdx: 0, count: 0 };
      if (!data.withinGroupWeights) {
        data.withinGroupWeights = {
          attack: new Array(6).fill(0), move: new Array(6).fill(0),
          surge: new Array(4).fill(0), cc: new Array(4).fill(0),
        };
      }
      data.brainPhase = 5;
      return data;
    }
  } catch { /* start fresh */ }
  const network = initializeNetwork();
  return {
    brainPhase: 5,
    meta: { totalGames: 0, p1Wins: 0, p2Wins: 0, lastUpdated: null, trainingHistory: [] },
    network,
    targetNetwork: deepCopyNetwork(network),
    trainingStats: {
      totalUpdates: 0, avgAbsDelta: 0, featureNames: FEATURE_NAMES,
      hiddenSize: HIDDEN_SIZE, lastTargetSync: 0, targetSyncs: 0,
      nanResets: 0, tdErrorHistory: [],
    },
    dcStats: {},
    affiliationStats: {},
    matchups: [],
    replayBuffer: { transitions: [], writeIdx: 0, count: 0 },
    withinGroupWeights: {
      attack: new Array(6).fill(0), move: new Array(6).fill(0),
      surge: new Array(4).fill(0), cc: new Array(4).fill(0),
    },
  };
}

export function saveLearnings(learnings, filePath) {
  learnings.meta.lastUpdated = new Date().toISOString();
  // Exclude targetNetwork from persistence (in-memory only)
  const toSave = {
    brainPhase: 5,
    meta: learnings.meta,
    network: learnings.network,
    trainingStats: learnings.trainingStats,
    dcStats: learnings.dcStats,
    affiliationStats: learnings.affiliationStats,
    matchups: learnings.matchups,
    withinGroupWeights: learnings.withinGroupWeights,
  };
  writeFileSync(filePath, JSON.stringify(toSave));
}

// ── Replay Buffer Persistence ────────────────────────────────────────────

export function saveReplayBuffer(learnings, filePath) {
  const buf = learnings.replayBuffer;
  if (!buf || buf.transitions.length === 0) return;
  writeFileSync(filePath, JSON.stringify({
    transitions: buf.transitions,
    writeIdx: buf.writeIdx,
    count: buf.count,
  }));
}

export function loadReplayBuffer(learnings, filePath) {
  try {
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      learnings.replayBuffer = {
        transitions: data.transitions || [],
        writeIdx: data.writeIdx || 0,
        count: data.count || 0,
      };
      return;
    }
  } catch { /* start fresh */ }
  learnings.replayBuffer = { transitions: [], writeIdx: 0, count: 0 };
}

// ── Per-DC / Affiliation Tracking ────────────────────────────────────────

export function recordMatchResult(learnings, p1Army, p2Army, winnerLabel, getDcStatsFunc, getDcEffectsFunc) {
  if (!learnings.dcStats) learnings.dcStats = {};
  if (!learnings.affiliationStats) learnings.affiliationStats = {};
  if (!learnings.matchups) learnings.matchups = [];

  function getAffiliation(dcName) {
    try {
      if (getDcEffectsFunc) {
        const effects = getDcEffectsFunc();
        const lower = dcName?.toLowerCase?.() || '';
        const ciKey = Object.keys(effects).find(k => k.toLowerCase() === lower);
        const eff = effects[dcName] || (ciKey ? effects[ciKey] : null);
        if (eff?.affiliation) return eff.affiliation.toLowerCase();
      }
    } catch { /* ignore */ }
    return 'unknown';
  }

  function trackDc(dcName, isWinner) {
    if (!learnings.dcStats[dcName]) {
      learnings.dcStats[dcName] = { wins: 0, losses: 0, games: 0, affiliation: getAffiliation(dcName) };
    }
    const s = learnings.dcStats[dcName];
    s.games++;
    if (isWinner === true) s.wins++;
    else if (isWinner === false) s.losses++;
    if (s.affiliation === 'unknown') s.affiliation = getAffiliation(dcName);
  }

  for (const dc of p1Army) {
    const name = typeof dc === 'object' ? dc.dcName : dc;
    trackDc(name, winnerLabel === 'P1' ? true : winnerLabel === 'P2' ? false : null);
  }
  for (const dc of p2Army) {
    const name = typeof dc === 'object' ? dc.dcName : dc;
    trackDc(name, winnerLabel === 'P2' ? true : winnerLabel === 'P1' ? false : null);
  }

  const p1Affs = new Set(p1Army.map(dc => getAffiliation(typeof dc === 'object' ? dc.dcName : dc)));
  const p2Affs = new Set(p2Army.map(dc => getAffiliation(typeof dc === 'object' ? dc.dcName : dc)));
  for (const aff of p1Affs) {
    if (!learnings.affiliationStats[aff]) learnings.affiliationStats[aff] = { wins: 0, losses: 0, games: 0 };
    learnings.affiliationStats[aff].games++;
    if (winnerLabel === 'P1') learnings.affiliationStats[aff].wins++;
    else if (winnerLabel === 'P2') learnings.affiliationStats[aff].losses++;
  }
  for (const aff of p2Affs) {
    if (!learnings.affiliationStats[aff]) learnings.affiliationStats[aff] = { wins: 0, losses: 0, games: 0 };
    learnings.affiliationStats[aff].games++;
    if (winnerLabel === 'P2') learnings.affiliationStats[aff].wins++;
    else if (winnerLabel === 'P1') learnings.affiliationStats[aff].losses++;
  }

  learnings.matchups.push({
    p1: p1Army.map(dc => typeof dc === 'object' ? dc.dcName : dc),
    p2: p2Army.map(dc => typeof dc === 'object' ? dc.dcName : dc),
    winner: winnerLabel,
    game: learnings.meta.totalGames,
  });
  if (learnings.matchups.length > 200) learnings.matchups = learnings.matchups.slice(-200);
}

// ── Agent-Specific Action Selection (Arena) ─────────────────────────────────

export function pickAgentAction(agent, allActions, game, learnings, playerNum, dcHealthState, dcMessageMeta) {
  pickAgentAction._lastWgFeatures = null;
  pickAgentAction._lastWgType = null;
  if (allActions.length === 0) return null;
  if (allActions.length === 1) return allActions[0];

  const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const groups = {};
  for (const action of allActions) {
    const abs = abstractActionType(action, game);
    if (!groups[abs]) groups[abs] = [];
    groups[abs].push(action);
  }

  const mandatoryTypes = ['gate', 'combat_flow'];
  const mandatoryActions = allActions.filter(a => mandatoryTypes.includes(abstractActionType(a, game)));
  if (mandatoryActions.length === allActions.length) return pickRandom(mandatoryActions);
  if (mandatoryActions.length > 0) return pickRandom(mandatoryActions);

  const strategicActions = allActions.filter(a => !mandatoryTypes.includes(abstractActionType(a, game)));
  if (strategicActions.length === 0) return pickRandom(allActions);

  // Agent-specific epsilon
  const epsilon = agent.strategy.epsilon;
  if (Math.random() < epsilon) {
    return heuristicPick(strategicActions, game);
  }

  // Exploitation: Q via dueling neural network + agent preferences
  const features = extractFeatures(game, playerNum, dcHealthState, dcMessageMeta);
  const network = learnings.network;
  if (!network) return heuristicPick(strategicActions, game);

  const { Q } = forwardPass(network, features);
  const absTypes = Object.keys(groups).filter(t => !mandatoryTypes.includes(t));
  if (absTypes.length === 0) return heuristicPick(strategicActions, game);

  let bestType = null;
  let bestQ = -Infinity;
  for (const absType of absTypes) {
    const idx = ABSTRACT_TYPES.indexOf(absType);
    if (idx < 0) continue;
    const preference = agent.strategy.actionPreferences[absType] ?? 0;
    const effectiveQ = Q[idx] + preference;
    if (effectiveQ > bestQ) {
      bestQ = effectiveQ;
      bestType = absType;
    }
  }

  if (bestType === null) return heuristicPick(strategicActions, game);
  const wgResult = pickWithinGroup(groups[bestType], bestType, game,
    learnings.withinGroupWeights, dcHealthState, dcMessageMeta, learnings.meta.totalGames);
  pickAgentAction._lastWgFeatures = wgResult.wgFeatures;
  pickAgentAction._lastWgType = wgResult.wgType;
  return wgResult.action;
}

/**
 * Compute reward with agent-specific reward multipliers.
 */
export function computeAgentReward(before, after, isTerminal, didWin, rewardMultipliers) {
  const m = rewardMultipliers;
  const deltaVP = (after.myVP - before.myVP) - (after.oppVP - before.oppVP);
  const oppDmgBefore = before.oppHpMax - before.oppHpCurrent;
  const oppDmgAfter = after.oppHpMax - after.oppHpCurrent;
  const deltaEnemyDmg = oppDmgAfter - oppDmgBefore;
  const deltaMyHP = after.myHpCurrent - before.myHpCurrent;
  const deltaDist = before.avgDist - after.avgDist;

  const w = REWARD_WEIGHTS;
  let reward =
    w.vp * deltaVP * (m.vp ?? 1) +
    w.dmg * deltaEnemyDmg * (m.dmg ?? 1) +
    w.hp * deltaMyHP * (m.hp ?? 1) +
    w.dist * deltaDist * (m.dist ?? 1);

  if (isTerminal) {
    const terminalReward = didWin ? w.terminal : -w.terminal;
    reward += terminalReward * (m.terminal ?? 1);
  }
  return reward;
}

/**
 * Create a game tracer that uses agent-specific reward computation.
 */
export function createAgentTracer(learnings, playerNum, dcHealthState, dcMessageMeta, rewardMultipliers) {
  const trace = [];
  let lastSnapshot = null;
  let lastFeatures = null;

  return {
    beforeAction(game, playerActions) {
      // Fill in previous entry's nextActionIdxs from current available actions
      if (playerActions && trace.length > 0) {
        const prev = trace[trace.length - 1];
        if (prev.nextActionIdxs === null && !prev.done) {
          prev.nextActionIdxs = getAbstractTypeIdxs(playerActions, game);
        }
      }

      lastSnapshot = captureSnapshot(game, playerNum, dcHealthState, dcMessageMeta);
      lastFeatures = extractFeatures(game, playerNum, dcHealthState, dcMessageMeta);
    },

    afterAction(game, action) {
      if (!lastSnapshot || !lastFeatures) return;
      const absType = abstractActionType(action, game);
      if (absType === 'gate' || absType === 'combat_flow') {
        lastSnapshot = null;
        lastFeatures = null;
        return;
      }
      const afterSnap = captureSnapshot(game, playerNum, dcHealthState, dcMessageMeta);
      const nextFeatures = extractFeatures(game, playerNum, dcHealthState, dcMessageMeta);
      const reward = computeAgentReward(lastSnapshot, afterSnap, false, false, rewardMultipliers);
      const actionIdx = ABSTRACT_TYPES.indexOf(absType);
      const wgFeatures = pickAgentAction._lastWgFeatures || null;
      const wgType = pickAgentAction._lastWgType || null;
      trace.push({
        features: lastFeatures, actionIdx, reward, nextFeatures,
        nextActionIdxs: null, done: false,
        wgFeatures, wgType,
      });
      lastSnapshot = null;
      lastFeatures = null;
    },

    finalize(game, updateMeta = false) {
      const didWin = game.ended && game.winnerId === (playerNum === 1 ? game.player1Id : game.player2Id);
      const didLose = game.ended && game.winnerId && !didWin;
      if (trace.length > 0 && game.ended) {
        const last = trace[trace.length - 1];
        const termReward = didWin
          ? REWARD_WEIGHTS.terminal * (rewardMultipliers.terminal ?? 1)
          : (didLose ? -REWARD_WEIGHTS.terminal * (rewardMultipliers.terminal ?? 1) : 0);
        last.reward += termReward;
        last.nextFeatures = null;
        last.nextActionIdxs = null;
        last.done = true;
      }
      updateTraceNeural(learnings, trace);
      if (updateMeta) {
        learnings.meta.totalGames++;
        if (game.ended && game.winnerId) {
          if (game.winnerId === game.player1Id) learnings.meta.p1Wins++;
          else learnings.meta.p2Wins++;
        }
      }
    },

    getTrace() { return trace; },
  };
}

// ── Training history ─────────────────────────────────────────────────────────

/**
 * Record a training checkpoint to the persistent training history.
 * Called every N games during training so we can detect plateaus.
 * @param {object} learnings
 * @param {object} checkpoint - { games, completed, total, p1Wins, p2Wins, avgVP, avgAbsDelta, epsilon }
 */
export function recordTrainingCheckpoint(learnings, checkpoint) {
  if (!learnings.meta.trainingHistory) learnings.meta.trainingHistory = [];
  learnings.meta.trainingHistory.push({
    totalGames: learnings.meta.totalGames,
    completionRate: checkpoint.total > 0 ? checkpoint.completed / checkpoint.total : 0,
    completed: checkpoint.completed,
    total: checkpoint.total,
    p1Wins: checkpoint.p1Wins || 0,
    p2Wins: checkpoint.p2Wins || 0,
    avgVP: checkpoint.avgVP || 0,
    avgAbsDelta: checkpoint.avgAbsDelta || 0,
    epsilon: checkpoint.epsilon || 0,
    ts: Date.now(),
  });
  // Keep last 200 checkpoints (10,000 games at 50-game intervals)
  if (learnings.meta.trainingHistory.length > 200) {
    learnings.meta.trainingHistory.shift();
  }
}

// ── Stats ───────────────────────────────────────────────────────────────────

export function getLearningsStats(learnings) {
  const network = learnings.network;
  if (!network) {
    return {
      totalGames: learnings.meta.totalGames,
      p1Wins: learnings.meta.p1Wins,
      p2Wins: learnings.meta.p2Wins,
      weightCount: 0,
      avgAbsWeight: 0,
      weightRange: [0, 0],
      totalUpdates: 0,
      avgAbsDelta: 0,
      epsilon: getEpsilon(learnings.meta.totalGames),
    };
  }

  // Count all parameters
  let weightCount = 0;
  let totalAbsWeight = 0;
  let maxAbsWeight = 0;

  function accum(val) {
    const av = Math.abs(val);
    weightCount++;
    totalAbsWeight += av;
    if (av > maxAbsWeight) maxAbsWeight = av;
  }

  const nHidden = network.b1.length;
  const nActions = network.Wa.length;

  for (let j = 0; j < nHidden; j++) {
    for (let i = 0; i < network.W1[j].length; i++) accum(network.W1[j][i]);
    accum(network.b1[j]);
    accum(network.Wv[j]);
  }
  accum(network.bv);
  for (let k = 0; k < nActions; k++) {
    for (let j = 0; j < network.Wa[k].length; j++) accum(network.Wa[k][j]);
    accum(network.ba[k]);
  }

  // Feature importance: importance[i] = Σ_j |W1[j][i]| × (|Wv[j]| + Σ_k |Wa[k][j]|)
  const featureImportance = [];
  for (let i = 0; i < NUM_FEATURES; i++) {
    let importance = 0;
    for (let j = 0; j < nHidden; j++) {
      let outputMag = Math.abs(network.Wv[j]);
      for (let k = 0; k < nActions; k++) {
        outputMag += Math.abs(network.Wa[k][j]);
      }
      importance += Math.abs(network.W1[j][i]) * outputMag;
    }
    featureImportance.push(importance);
  }

  const ts = learnings.trainingStats || {};

  return {
    totalGames: learnings.meta.totalGames,
    p1Wins: learnings.meta.p1Wins,
    p2Wins: learnings.meta.p2Wins,
    weightCount,
    avgAbsWeight: weightCount > 0 ? totalAbsWeight / weightCount : 0,
    weightRange: [-maxAbsWeight, maxAbsWeight],
    totalUpdates: ts.totalUpdates || 0,
    avgAbsDelta: ts.avgAbsDelta || 0,
    epsilon: getEpsilon(learnings.meta.totalGames),
    nanResets: ts.nanResets || 0,
    lastTargetSync: ts.lastTargetSync || 0,
    targetSyncs: ts.targetSyncs || 0,
    featureImportance,
    replayBufferSize: learnings.replayBuffer ? learnings.replayBuffer.transitions.length : 0,
    replayTotalStored: learnings.replayBuffer ? learnings.replayBuffer.count : 0,
    withinGroupWeights: learnings.withinGroupWeights || null,
  };
}

// ── Compatibility Wrappers ──────────────────────────────────────────────────

/** Compute Q for a single action type (wraps forwardPass). */
export function computeQ(network, actionType, features) {
  if (!network || !network.W1) return 0;
  const idx = ABSTRACT_TYPES.indexOf(actionType);
  if (idx < 0) return 0;
  return forwardPass(network, features).Q[idx];
}

/** Max Q across all action types (fallback). */
function getBestQ(network, features) {
  if (!network || !network.W1) return 0;
  const { Q } = forwardPass(network, features);
  return Math.max(...Q);
}
