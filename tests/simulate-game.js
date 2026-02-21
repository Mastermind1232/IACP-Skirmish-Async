/**
 * Headless game simulation — exercises the full game loop without Discord.
 * Validates state integrity at each step, surfaces bugs, and documents the game flow.
 *
 * Run: node tests/simulate-game.js
 */

import {
  getMapRegistry,
  getDeploymentZones,
  getMapSpaces,
  getDcEffects,
  getDcKeywords,
  getDiceData,
  getMissionCardsData,
  getMissionRules,
  getMapTokensData,
  getCcEffectsData,
  getCcEffect,
  getAbilityLibrary,
  getFigureSize,
  isCcAttachment,
  isDcUnique,
} from '../src/data-loader.js';

import {
  rollAttackDice,
  rollDefenseDice,
  getAttackerSurgeAbilities,
  parseSurgeEffect,
  computeCombatResult,
} from '../src/game/combat.js';

import {
  getBoardStateForMovement,
  getMovementProfile,
  computeMovementCache,
  getSpacesAtCost,
  getMovementTarget,
  getReachableSpaces,
  getOccupiedSpacesForMovement,
} from '../src/game/movement.js';

import {
  normalizeCoord,
  parseCoord,
  getFootprintCells,
  toLowerSet,
} from '../src/game/coords.js';

import {
  isCcPlayableNow,
  isCcPlayLegalByRestriction,
} from '../src/game/cc-timing.js';

import { validateDeckLegal, DC_POINTS_LEGAL, CC_CARDS_LEGAL } from '../src/game/validation.js';

const LOG_VERBOSE = process.argv.includes('--verbose');
const MAX_ROUNDS = 8;
const WIN_VP = 40;

let findings = [];
let warnings = [];

function log(msg) { console.log(msg); }
function verbose(msg) { if (LOG_VERBOSE) console.log(`  [v] ${msg}`); }
function finding(severity, msg) { findings.push({ severity, msg }); console.log(`  ⚠ [${severity}] ${msg}`); }
function warn(msg) { warnings.push(msg); console.log(`  ⚡ ${msg}`); }

// ─── DC Stats (mirrors index.js getDcStats) ─────────────────────────────────

const FIGURELESS_DCS = new Set(['balance of the force', 'driven by hatred', 'extra armor']);

function getDcStats(dcName) {
  const effects = getDcEffects();
  const lower = dcName?.toLowerCase?.() || '';
  const ciKey = Object.keys(effects).find((k) => k.toLowerCase() === lower);
  const eff =
    effects[dcName] ||
    (ciKey ? effects[ciKey] : null) ||
    (typeof dcName === 'string' && !dcName.startsWith('[') ? effects[`[${dcName}]`] : null);
  if (eff) {
    return {
      health: eff.health ?? null,
      figures: FIGURELESS_DCS.has(lower) ? 0 : (eff.figures ?? 1),
      speed: eff.speed ?? null,
      cost: eff.cost ?? null,
      attack: eff.attack ?? null,
      defense: eff.defense ?? null,
      specials: eff.specials || [],
      specialCosts: eff.specialCosts || [],
    };
  }
  return { health: null, figures: 1, speed: 4, cost: 0, attack: null, defense: null, specials: [], specialCosts: [] };
}

// ─── Sample Squads ───────────────────────────────────────────────────────────

const P1_DC_LIST = [
  'Luke Skywalker',
  'Rebel Trooper (Elite)',
  'Rebel Trooper (Regular)',
  'Echo Base Trooper (Elite)',
];

const P1_CC_LIST = [
  'Take Initiative', 'Son of Skywalker', 'Smuggled Supplies',
  'Recovery', 'Planning', 'Deadeye', 'Focus',
  'Rally', 'Positioning Advantage', 'Brace Yourself',
  'Wild Attack', 'Stimulants', 'Hit and Run',
  'Celebration', 'Dangerous Bargains',
];

const P2_DC_LIST = [
  'Darth Vader',
  'Stormtrooper (Elite)',
  'Stormtrooper (Regular)',
  'Royal Guard Champion',
];

const P2_CC_LIST = [
  'Take Initiative', 'Force Lightning', 'Urgency',
  'Recovery', 'Planning', 'Deadeye', 'Focus',
  'Rally', 'Positioning Advantage', 'Brace Yourself',
  'Wild Attack', 'Stimulants', 'Hit and Run',
  'Celebration', 'Negation',
];

// ─── Game State Builder ──────────────────────────────────────────────────────

function createGame() {
  const mapId = 'mos-eisley-outskirts';
  const variant = 'b';
  const missions = getMissionCardsData()[mapId];
  const missionData = missions[variant];

  return {
    gameId: 'sim-001',
    version: 1,
    player1Id: 'p1-sim',
    player2Id: 'p2-sim',
    selectedMap: { id: mapId, name: 'Mos Eisley Outskirts' },
    mapSelected: true,
    selectedMission: {
      variant,
      name: missionData.name,
      fullName: `Mos Eisley Outskirts — ${missionData.name}`,
      tokenLabel: missionData.tokenLabel || '',
      interactLabel: missionData.interactLabel || '',
      mechanics: missionData.mechanics || {},
    },
    deploymentZoneChosen: 'red',
    initiativePlayerId: 'p1-sim',
    initiativeDetermined: true,
    currentRound: 1,
    player1VP: { total: 0, kills: 0, objectives: 0 },
    player2VP: { total: 0, kills: 0, objectives: 0 },
    player1CcDeck: [],
    player2CcDeck: [],
    player1CcHand: [],
    player2CcHand: [],
    player1CcDiscard: [],
    player2CcDiscard: [],
    p1DcList: [],
    p2DcList: [],
    p1DcMessageIds: [],
    p2DcMessageIds: [],
    figurePositions: { 1: {}, 2: {} },
    figureOrientations: {},
    figureConditions: {},
    figureContraband: {},
    movementBank: {},
    moveInProgress: {},
    launchPanelState: {},
    openedDoors: [],
    p1ActivationsTotal: 0,
    p2ActivationsTotal: 0,
    p1ActivationsRemaining: 0,
    p2ActivationsRemaining: 0,
    p1ActivatedDcIndices: [],
    p2ActivatedDcIndices: [],
    dcActionsData: {},
    undoStack: [],
    ended: false,
    noCommandDrawThisRound: false,
    p1LaunchPanelFlippedThisRound: false,
    p2LaunchPanelFlippedThisRound: false,
  };
}

// ─── DC Health State (simulates dcHealthState Map) ───────────────────────────

const simDcHealthState = new Map();
const simDcMessageMeta = new Map();

function setupDcList(game, playerNum, dcNames) {
  const dcList = [];
  const msgIds = [];
  for (let i = 0; i < dcNames.length; i++) {
    const dcName = dcNames[i];
    const stats = getDcStats(dcName);
    const figures = stats.figures ?? 1;
    const health = stats.health ?? 5;
    const healthState = [];
    for (let f = 0; f < Math.max(1, figures); f++) {
      healthState.push([health, health]);
    }
    const msgId = `msg-p${playerNum}-dc${i}`;
    dcList.push({
      dcName,
      displayName: dcName,
      cost: stats.cost ?? 0,
      healthState: healthState.map((h) => [...h]),
    });
    msgIds.push(msgId);
    simDcMessageMeta.set(msgId, { gameId: game.gameId, playerNum, dcName, displayName: dcName });
    simDcHealthState.set(msgId, healthState);
  }
  if (playerNum === 1) {
    game.p1DcList = dcList;
    game.p1DcMessageIds = msgIds;
  } else {
    game.p2DcList = dcList;
    game.p2DcMessageIds = msgIds;
  }
}

// ─── Deploy Figures ──────────────────────────────────────────────────────────

function deployFigures(game) {
  const mapId = game.selectedMap.id;
  const zones = getDeploymentZones()[mapId];
  if (!zones) { finding('HIGH', `No deployment zones for map ${mapId}`); return; }

  const p1Zone = zones[game.deploymentZoneChosen] || [];
  const p2Zone = zones[game.deploymentZoneChosen === 'red' ? 'blue' : 'red'] || [];

  let p1Idx = 0;
  let p2Idx = 0;

  for (const [pn, dcList, zone, getIdx] of [
    [1, game.p1DcList, p1Zone, () => p1Idx++],
    [2, game.p2DcList, p2Zone, () => p2Idx++],
  ]) {
    for (let di = 0; di < dcList.length; di++) {
      const dc = dcList[di];
      const stats = getDcStats(dc.dcName);
      const figures = stats.figures ?? 1;
      for (let fi = 0; fi < figures; fi++) {
        const idx = getIdx();
        if (idx >= zone.length) {
          warn(`P${pn} ran out of deployment zone spaces for ${dc.dcName} fig ${fi}`);
          continue;
        }
        const coord = zone[idx];
        const figureKey = `${dc.dcName}-1-${fi}`;
        game.figurePositions[pn][figureKey] = coord;
        game.figureOrientations[figureKey] = getFigureSize(dc.dcName);
        verbose(`P${pn} deployed ${figureKey} at ${coord}`);
      }
    }
  }

  game.p1ActivationsTotal = game.p1DcList.filter((dc) => (getDcStats(dc.dcName).figures ?? 1) > 0).length;
  game.p2ActivationsTotal = game.p2DcList.filter((dc) => (getDcStats(dc.dcName).figures ?? 1) > 0).length;
}

// ─── Shuffle & Draw CC ───────────────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function setupCcDecks(game) {
  game.player1CcDeck = shuffle(P1_CC_LIST);
  game.player2CcDeck = shuffle(P2_CC_LIST);
  game.player1CcHand = game.player1CcDeck.splice(0, 3);
  game.player2CcHand = game.player2CcDeck.splice(0, 3);
  log(`  P1 starting hand: [${game.player1CcHand.join(', ')}] (${game.player1CcDeck.length} in deck)`);
  log(`  P2 starting hand: [${game.player2CcHand.join(', ')}] (${game.player2CcDeck.length} in deck)`);
}

// ─── Round: Draw CCs ─────────────────────────────────────────────────────────

function drawStartOfRound(game) {
  const p1DrawCount = 1; // base 1, no terminal control simulated
  const p2DrawCount = 1;
  const p1Drawn = [];
  const p2Drawn = [];
  for (let i = 0; i < p1DrawCount && game.player1CcDeck.length > 0; i++) {
    p1Drawn.push(game.player1CcDeck.shift());
  }
  for (let i = 0; i < p2DrawCount && game.player2CcDeck.length > 0; i++) {
    p2Drawn.push(game.player2CcDeck.shift());
  }
  game.player1CcHand.push(...p1Drawn);
  game.player2CcHand.push(...p2Drawn);

  const p1DeckEmpty = game.player1CcDeck.length === 0;
  const p2DeckEmpty = game.player2CcDeck.length === 0;
  log(`  P1 drew [${p1Drawn.join(', ') || 'nothing'}] → hand: ${game.player1CcHand.length}, deck: ${game.player1CcDeck.length}${p1DeckEmpty ? ' ⚠ DECK EMPTY' : ''}`);
  log(`  P2 drew [${p2Drawn.join(', ') || 'nothing'}] → hand: ${game.player2CcHand.length}, deck: ${game.player2CcDeck.length}${p2DeckEmpty ? ' ⚠ DECK EMPTY' : ''}`);
}

// ─── Combat Simulation ───────────────────────────────────────────────────────

function simulateAttack(game, attackerPn, attackerFigKey, defenderPn, defenderFigKey) {
  const attackerDcName = attackerFigKey.replace(/-\d+-\d+$/, '');
  const defenderDcName = defenderFigKey.replace(/-\d+-\d+$/, '');
  const aStats = getDcStats(attackerDcName);
  const dStats = getDcStats(defenderDcName);

  const attackDice = aStats.attack?.dice || ['blue'];
  const defenseDice = dStats.defense || 'white';

  const attackRoll = rollAttackDice(attackDice);
  const defenseRoll = rollDefenseDice(defenseDice);

  const combat = {
    attackerDcName,
    attackRoll,
    defenseRoll,
    surgeDamage: 0,
    surgePierce: 0,
    surgeAccuracy: 0,
    surgeConditions: [],
    surgeBlast: 0,
    surgeRecover: 0,
    surgeCleave: 0,
    bonusSurgeAbilities: [],
    bonusPierce: 0,
  };

  // Spend surges: player CHOOSES which (if any) to use. Each ability only once per attack.
  const surgeAbilities = getAttackerSurgeAbilities(combat);
  let surgeRemaining = attackRoll.surge;
  const usedAbilities = new Set();
  if (surgeRemaining > 0 && surgeAbilities.length > 0) {
    const shuffled = [...surgeAbilities].sort(() => Math.random() - 0.5);
    for (const ability of shuffled) {
      if (surgeRemaining <= 0) break;
      if (usedAbilities.has(ability)) continue;
      if (Math.random() < 0.3) continue; // 30% chance to skip (player might save or not want it)
      const parsed = parseSurgeEffect(ability);
      if (!parsed) continue;
      const cost = parsed.surgeCost ?? 1;
      if (cost > surgeRemaining) continue;
      surgeRemaining -= cost;
      usedAbilities.add(ability);
      combat.surgeDamage += parsed.damage || 0;
      combat.surgePierce += parsed.pierce || 0;
      combat.surgeAccuracy += parsed.accuracy || 0;
      if (parsed.conditions) combat.surgeConditions.push(...parsed.conditions);
      if (parsed.blast) combat.surgeBlast += parsed.blast;
      if (parsed.recover) combat.surgeRecover += parsed.recover;
      if (parsed.cleave) combat.surgeCleave += parsed.cleave;
    }
  }

  const result = computeCombatResult(combat);

  verbose(`  ${attackerFigKey} attacks ${defenderFigKey}: roll(acc:${attackRoll.acc} dmg:${attackRoll.dmg} surge:${attackRoll.surge}) vs (block:${defenseRoll.block} evade:${defenseRoll.evade}) → ${result.hit ? `HIT ${result.damage} dmg` : 'MISS'}`);

  if (result.hit && result.damage > 0) {
    return applyDamage(game, defenderPn, defenderFigKey, result.damage, attackerPn);
  }
  return { defeated: false };
}

function applyDamage(game, defenderPn, figureKey, damage, attackerPn) {
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  const dcList = defenderPn === 1 ? game.p1DcList : game.p2DcList;
  const msgIds = defenderPn === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;

  const dcIdx = dcList.findIndex((dc) => dc.dcName === dcName);
  if (dcIdx < 0) return { defeated: false };

  const figMatch = figureKey.match(/-(\d+)-(\d+)$/);
  const figIdx = figMatch ? parseInt(figMatch[2], 10) : 0;

  const healthState = dcList[dcIdx].healthState || [];
  if (!healthState[figIdx]) return { defeated: false };

  const [cur, max] = healthState[figIdx];
  const newCur = Math.max(0, (cur ?? max ?? 0) - damage);
  healthState[figIdx] = [newCur, max];

  if (newCur <= 0) {
    delete game.figurePositions[defenderPn][figureKey];
    const cost = dcList[dcIdx].cost || 0;
    const vpKey = attackerPn === 1 ? 'player1VP' : 'player2VP';
    game[vpKey].total += cost;
    game[vpKey].kills += cost;
    verbose(`  💀 ${figureKey} DEFEATED! P${attackerPn} gains ${cost} VP (total: ${game[vpKey].total})`);
    return { defeated: true, vpGained: cost };
  }
  verbose(`  ${figureKey} took ${damage} dmg → ${newCur}/${max} HP`);
  return { defeated: false };
}

// ─── Movement Simulation ─────────────────────────────────────────────────────

function simulateMovement(game, playerNum, figureKey, mp) {
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  const mapId = game.selectedMap.id;
  const startCoord = game.figurePositions[playerNum]?.[figureKey];
  if (!startCoord) return;

  try {
    const board = getBoardStateForMovement(game, figureKey);
    const profile = getMovementProfile(dcName, figureKey, game);
    const cache = computeMovementCache(startCoord, mp, board, profile);
    const reachable = getSpacesAtCost(cache, mp);
    if (reachable.length > 0) {
      const dest = reachable[Math.floor(Math.random() * reachable.length)];
      const destCoord = typeof dest === 'string' ? dest : dest.topLeft || dest.coord;
      game.figurePositions[playerNum][figureKey] = destCoord;
      verbose(`  ${figureKey} moved ${startCoord} → ${destCoord} (${mp} MP)`);
    } else {
      for (let tryMp = mp - 1; tryMp >= 1; tryMp--) {
        const tryReachable = getSpacesAtCost(cache, tryMp);
        if (tryReachable.length > 0) {
          const dest = tryReachable[Math.floor(Math.random() * tryReachable.length)];
          const destCoord = typeof dest === 'string' ? dest : dest.topLeft || dest.coord;
          game.figurePositions[playerNum][figureKey] = destCoord;
          verbose(`  ${figureKey} moved ${startCoord} → ${destCoord} (${tryMp} MP, wanted ${mp})`);
          break;
        }
      }
    }
  } catch (e) {
    finding('HIGH', `Movement error for ${figureKey}: ${e.message}`);
  }
}

// ─── CC Play Simulation ──────────────────────────────────────────────────────

function tryPlayCC(game, playerNum) {
  const hand = playerNum === 1 ? game.player1CcHand : game.player2CcHand;
  if (hand.length === 0) return null;

  for (let i = 0; i < hand.length; i++) {
    const card = hand[i];
    try {
      const playable = isCcPlayableNow(game, playerNum, card, getCcEffect);
      if (!playable) continue;
      const { legal } = isCcPlayLegalByRestriction(game, playerNum, card, getCcEffect);
      if (!legal) continue;

      hand.splice(i, 1);
      const discardKey = playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
      game[discardKey] = game[discardKey] || [];

      if (isCcAttachment(card)) {
        verbose(`  P${playerNum} played CC ${card} (attachment — skipping resolve)`);
      } else {
        game[discardKey].push(card);
        verbose(`  P${playerNum} played CC ${card} → discard`);
      }
      return card;
    } catch (e) {
      finding('MEDIUM', `CC playability check error for "${card}": ${e.message}`);
    }
  }
  return null;
}

// ─── Activation Simulation ───────────────────────────────────────────────────

function simulateActivation(game, playerNum, dcIndex) {
  const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
  const dc = dcList[dcIndex];
  if (!dc) return;

  const stats = getDcStats(dc.dcName);
  const figures = stats.figures ?? 1;
  const speed = stats.speed ?? 4;

  log(`  P${playerNum} activates ${dc.dcName}`);

  for (let fi = 0; fi < figures; fi++) {
    const figureKey = `${dc.dcName}-1-${fi}`;
    if (!game.figurePositions[playerNum]?.[figureKey]) {
      verbose(`  ${figureKey} is defeated, skipping`);
      continue;
    }

    const mech = game.selectedMission?.mechanics;
    let effectiveSpeed = speed;
    if (mech?.type === 'carry' && mech.speedPenalty && game.figureContraband?.[figureKey]) {
      effectiveSpeed = Math.max(0, speed + mech.speedPenalty);
    }

    // Action 1: Move
    simulateMovement(game, playerNum, figureKey, Math.min(effectiveSpeed, 3));

    // Action 2: Attack if enemy adjacent (simplified — pick closest enemy)
    const enemyPn = playerNum === 1 ? 2 : 1;
    const enemyFigs = Object.keys(game.figurePositions[enemyPn] || {});
    if (enemyFigs.length > 0) {
      const target = enemyFigs[Math.floor(Math.random() * enemyFigs.length)];
      const { defeated } = simulateAttack(game, playerNum, figureKey, enemyPn, target);
      if (defeated) {
        checkWinCondition(game);
        if (game.ended) return;
      }
    }
  }

  // Try to play a CC during activation
  tryPlayCC(game, playerNum);
}

// ─── Win Condition ───────────────────────────────────────────────────────────

function checkWinCondition(game) {
  if (game.ended) return;

  if (game.player1VP.total >= WIN_VP) {
    game.ended = true;
    game.winnerId = game.player1Id;
    log(`  🏆 P1 WINS with ${game.player1VP.total} VP!`);
    return;
  }
  if (game.player2VP.total >= WIN_VP) {
    game.ended = true;
    game.winnerId = game.player2Id;
    log(`  🏆 P2 WINS with ${game.player2VP.total} VP!`);
    return;
  }

  const p1Alive = Object.keys(game.figurePositions[1] || {}).length;
  const p2Alive = Object.keys(game.figurePositions[2] || {}).length;
  if (p1Alive === 0) {
    game.ended = true;
    game.winnerId = game.player2Id;
    log(`  🏆 P2 WINS by elimination! (${game.player2VP.total} VP)`);
    return;
  }
  if (p2Alive === 0) {
    game.ended = true;
    game.winnerId = game.player1Id;
    log(`  🏆 P1 WINS by elimination! (${game.player1VP.total} VP)`);
    return;
  }
}

// ─── State Integrity Checks ──────────────────────────────────────────────────

function validateState(game, label) {
  // VP should never be negative
  if (game.player1VP.total < 0) finding('HIGH', `${label}: P1 VP is negative (${game.player1VP.total})`);
  if (game.player2VP.total < 0) finding('HIGH', `${label}: P2 VP is negative (${game.player2VP.total})`);

  // VP kills + objectives should equal total
  const p1Check = game.player1VP.kills + game.player1VP.objectives;
  const p2Check = game.player2VP.kills + game.player2VP.objectives;
  if (p1Check !== game.player1VP.total) finding('MEDIUM', `${label}: P1 VP mismatch (kills:${game.player1VP.kills} + obj:${game.player1VP.objectives} != total:${game.player1VP.total})`);
  if (p2Check !== game.player2VP.total) finding('MEDIUM', `${label}: P2 VP mismatch`);

  // Hand + deck + discard should sum to original deck size
  const p1Total = (game.player1CcHand?.length || 0) + (game.player1CcDeck?.length || 0) + (game.player1CcDiscard?.length || 0);
  const p2Total = (game.player2CcHand?.length || 0) + (game.player2CcDeck?.length || 0) + (game.player2CcDiscard?.length || 0);
  if (p1Total !== P1_CC_LIST.length) finding('HIGH', `${label}: P1 CC count drift! hand(${game.player1CcHand.length}) + deck(${game.player1CcDeck.length}) + discard(${game.player1CcDiscard.length}) = ${p1Total}, expected ${P1_CC_LIST.length}`);
  if (p2Total !== P2_CC_LIST.length) finding('HIGH', `${label}: P2 CC count drift! total=${p2Total}, expected ${P2_CC_LIST.length}`);

  // No duplicate figure positions
  for (const pn of [1, 2]) {
    const positions = Object.values(game.figurePositions[pn] || {});
    const unique = new Set(positions.map(normalizeCoord));
    if (unique.size !== positions.length) {
      finding('HIGH', `${label}: P${pn} has overlapping figure positions!`);
    }
  }

  // Health should never be below 0
  for (const pn of [1, 2]) {
    const dcList = pn === 1 ? game.p1DcList : game.p2DcList;
    for (const dc of dcList) {
      for (const [cur, max] of dc.healthState || []) {
        if (cur != null && cur < 0) finding('HIGH', `${label}: ${dc.dcName} health below 0 (${cur}/${max})`);
        if (cur != null && max != null && cur > max) finding('MEDIUM', `${label}: ${dc.dcName} health above max (${cur}/${max})`);
      }
    }
  }
}

// ─── Data Integrity Checks ───────────────────────────────────────────────────

function auditData() {
  log('\n═══ DATA INTEGRITY AUDIT ═══\n');

  // Check all DCs in our squads have stats
  for (const dcName of [...P1_DC_LIST, ...P2_DC_LIST]) {
    const stats = getDcStats(dcName);
    if (stats.health == null) finding('HIGH', `DC "${dcName}" has no health stat`);
    if (stats.speed == null) warn(`DC "${dcName}" has no speed stat (defaulting to 4)`);
    if (stats.attack?.dice == null) warn(`DC "${dcName}" has no attack dice`);
    if (stats.defense == null) warn(`DC "${dcName}" has no defense dice`);
    if (stats.cost == null) warn(`DC "${dcName}" has no cost`);
    verbose(`  ${dcName}: HP=${stats.health} SPD=${stats.speed} ATK=${JSON.stringify(stats.attack)} DEF=${stats.defense} FIG=${stats.figures} COST=${stats.cost}`);
  }

  // Check all CCs have effects
  for (const ccName of [...P1_CC_LIST, ...P2_CC_LIST]) {
    const eff = getCcEffect(ccName);
    if (!eff) finding('HIGH', `CC "${ccName}" has no effect data`);
    else if (!eff.timing) finding('MEDIUM', `CC "${ccName}" has no timing`);
    else if (eff.cost == null) warn(`CC "${ccName}" has null cost`);
  }

  // Check mission data for selected map
  const mapId = 'mos-eisley-outskirts';
  const missions = getMissionCardsData()[mapId];
  for (const v of ['a', 'b']) {
    const m = missions?.[v];
    if (!m) { finding('HIGH', `Map ${mapId} missing mission variant ${v}`); continue; }
    if (m.mechanics && m.mechanics.type === 'carry' && !m.interactLabel) {
      finding('MEDIUM', `Map ${mapId} variant ${v} has carry mechanics but no interactLabel`);
    }
    if (m.mechanics && m.mechanics.type === 'flip' && !m.interactLabel) {
      finding('MEDIUM', `Map ${mapId} variant ${v} has flip mechanics but no interactLabel`);
    }
    verbose(`  Mission ${v}: ${m.name} | mechanics: ${JSON.stringify(m.mechanics || {})}`);
  }

  // Check deployment zones exist
  const zones = getDeploymentZones()[mapId];
  if (!zones) finding('HIGH', `No deployment zones for ${mapId}`);
  else {
    if (!zones.red?.length) finding('HIGH', `Map ${mapId} missing red deployment zone`);
    if (!zones.blue?.length) finding('HIGH', `Map ${mapId} missing blue deployment zone`);
    verbose(`  Deployment zones: red=${zones.red?.length} spaces, blue=${zones.blue?.length} spaces`);
  }
}

// ─── Main Simulation ─────────────────────────────────────────────────────────

function runSimulation() {
  log('═══ IMPERIAL ASSAULT HEADLESS GAME SIMULATION ═══\n');

  auditData();

  log('\n═══ GAME SETUP ═══\n');
  const game = createGame();
  setupDcList(game, 1, P1_DC_LIST);
  setupDcList(game, 2, P2_DC_LIST);
  setupCcDecks(game);
  deployFigures(game);
  validateState(game, 'post-deploy');

  log(`\n  P1 figures: ${Object.keys(game.figurePositions[1]).length}`);
  log(`  P2 figures: ${Object.keys(game.figurePositions[2]).length}`);

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (game.ended) break;

    log(`\n═══ ROUND ${round} ═══\n`);
    game.currentRound = round;
    game.p1ActivationsRemaining = game.p1ActivationsTotal;
    game.p2ActivationsRemaining = game.p2ActivationsTotal;
    game.p1ActivatedDcIndices = [];
    game.p2ActivatedDcIndices = [];
    game.p1LaunchPanelFlippedThisRound = false;
    game.p2LaunchPanelFlippedThisRound = false;

    if (round > 1) {
      drawStartOfRound(game);
    }

    // Activation phase: alternate activations
    let p1ActIdx = 0;
    let p2ActIdx = 0;
    const p1DcCount = game.p1DcList.length;
    const p2DcCount = game.p2DcList.length;
    let turn = 1; // initiative player goes first

    while (game.p1ActivationsRemaining > 0 || game.p2ActivationsRemaining > 0) {
      if (game.ended) break;

      const currentPn = turn === 1 ? 1 : 2;
      const remaining = currentPn === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining;

      if (remaining > 0) {
        const actIdx = currentPn === 1 ? p1ActIdx : p2ActIdx;
        const dcCount = currentPn === 1 ? p1DcCount : p2DcCount;
        if (actIdx < dcCount) {
          simulateActivation(game, currentPn, actIdx);
          if (currentPn === 1) { game.p1ActivationsRemaining--; p1ActIdx++; }
          else { game.p2ActivationsRemaining--; p2ActIdx++; }
        } else {
          if (currentPn === 1) game.p1ActivationsRemaining = 0;
          else game.p2ActivationsRemaining = 0;
        }
      }

      turn = turn === 1 ? 2 : 1;
      if (game.p1ActivationsRemaining <= 0 && game.p2ActivationsRemaining <= 0) break;
    }

    // End of round status
    const p1Alive = Object.keys(game.figurePositions[1]).length;
    const p2Alive = Object.keys(game.figurePositions[2]).length;
    log(`\n  End of Round ${round}: P1=${game.player1VP.total}VP (${p1Alive} figs) | P2=${game.player2VP.total}VP (${p2Alive} figs)`);
    log(`  P1 hand: ${game.player1CcHand.length} | deck: ${game.player1CcDeck.length} | discard: ${game.player1CcDiscard.length}`);
    log(`  P2 hand: ${game.player2CcHand.length} | deck: ${game.player2CcDeck.length} | discard: ${game.player2CcDiscard.length}`);

    validateState(game, `end-round-${round}`);
    checkWinCondition(game);
  }

  if (!game.ended) {
    log(`\n  Game reached round limit (${MAX_ROUNDS}) without a winner.`);
    log(`  Final: P1=${game.player1VP.total}VP | P2=${game.player2VP.total}VP`);
    if (game.player1VP.total > game.player2VP.total) log('  P1 wins on VP tiebreak.');
    else if (game.player2VP.total > game.player1VP.total) log('  P2 wins on VP tiebreak.');
    else log('  TIE — no tiebreaker implemented.');
  }

  log('\n═══ SIMULATION COMPLETE ═══\n');
  if (findings.length > 0) {
    log(`FINDINGS (${findings.length}):`);
    for (const f of findings) log(`  [${f.severity}] ${f.msg}`);
  } else {
    log('No findings — all state integrity checks passed.');
  }
  if (warnings.length > 0) {
    log(`\nWARNINGS (${warnings.length}):`);
    for (const w of warnings) log(`  ${w}`);
  }
}

runSimulation();
