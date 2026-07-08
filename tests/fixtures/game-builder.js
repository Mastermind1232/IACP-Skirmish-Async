/**
 * Fluent game builder for headless integration tests.
 *
 * Usage:
 *   const { game, harness, deps } = createTestGame()
 *     .withMap('mos-eisley-outskirts')
 *     .withPlayer1Army([{ dcName: 'Stormtrooper', count: 1 }])
 *     .withPlayer2Army([{ dcName: 'Rebel Saboteur', count: 1 }])
 *     .deployed()
 *     .inRound(1)
 *     .build();
 */

import { createHarness } from '../../src/headless/game-harness.js';
import { buildHeadlessDeps } from '../../src/headless/headless-deps.js';
import { initializeDcState, initializeFigurePositions } from '../../src/headless/init-dc-state.js';
import { getDcStats, getDeploymentZones, getMapData, getMissionCardsData, getMapTokensData } from '../../src/data-loader.js';
import { PHASES, ROUND_PHASES } from '../../src/game/phase.js';
import { isFigurelessDc } from '../../src/game/dc-helpers.js';

let gameIdCounter = 1;

export function createTestGame() {
  return new GameBuilder();
}

class GameBuilder {
  constructor() {
    this._mapId = 'unit-test-grid'; // synthetic open 26x26 grid; use .withMap() for a real map
    this._p1Army = [];
    this._p2Army = [];
    this._deployed = false;
    this._round = 0;
    this._gameId = String(gameIdCounter++).padStart(5, '0');
    this._p1Id = 'player1';
    this._p2Id = 'player2';
    this._p1CcDeck = [];
    this._p2CcDeck = [];
    this._p1CcHand = [];
    this._p2CcHand = [];
    this._missionVariant = null;
    this._lightweight = false;
  }

  lightweight() { this._lightweight = true; return this; }
  withMap(mapId) { this._mapId = mapId; return this; }
  withGameId(id) { this._gameId = id; return this; }
  withPlayer1Id(id) { this._p1Id = id; return this; }
  withPlayer2Id(id) { this._p2Id = id; return this; }

  withPlayer1Army(army) { this._p1Army = army; return this; }
  withPlayer2Army(army) { this._p2Army = army; return this; }

  withMissionVariant(variant) { this._missionVariant = variant; return this; }
  withPlayer1CcHand(cards) { this._p1CcHand = cards; return this; }
  withPlayer2CcHand(cards) { this._p2CcHand = cards; return this; }
  withPlayer1CcDeck(cards) { this._p1CcDeck = cards; return this; }
  withPlayer2CcDeck(cards) { this._p2CcDeck = cards; return this; }

  deployed() { this._deployed = true; return this; }
  inRound(n) { this._round = n; this._deployed = true; return this; }

  build() {
    const game = this._buildGame();
    const dcMessageMeta = new Map();
    const dcExhaustedState = new Map();
    const dcHealthState = new Map();

    // Initialize DC state
    initializeDcState(game, dcMessageMeta, dcExhaustedState, dcHealthState);

    // Build deps and harness
    const deps = buildHeadlessDeps({
      dcMessageMeta,
      dcExhaustedState,
      dcHealthState,
      lightweight: this._lightweight,
    });

    // If deployed, initialize figure positions
    if (this._deployed) {
      const deploymentZones = getDeploymentZones();
      const mapSpaces = getMapData(this._mapId);
      initializeFigurePositions(game, dcMessageMeta, { deploymentZones, mapSpaces });
    }

    // Set up activations
    if (this._round > 0) {
      this._setupActivations(game, dcMessageMeta);
    }

    const harness = createHarness(game, { deps, dcMessageMeta, dcExhaustedState, dcHealthState, lightweight: this._lightweight });

    return { game: harness.getGame(), harness, deps, dcMessageMeta, dcExhaustedState, dcHealthState };
  }

  _buildDcList(army) {
    const dcList = [];
    const counts = {};
    for (const entry of army) {
      const dcName = entry.dcName || entry;
      const count = entry.count || 1;
      for (let dg = 0; dg < count; dg++) {
        counts[dcName] = (counts[dcName] || 0) + 1;
        const dgIndex = counts[dcName];
        const stats = getDcStats(dcName);
        const displayName = count > 1 ? `${dcName} [Group ${dgIndex}]` : dcName;
        const figureCount = stats?.figures ?? 1;
        const maxHp = stats?.health ?? 1;
        const healthState = [];
        for (let f = 0; f < figureCount; f++) {
          healthState.push([maxHp, maxHp]);
        }
        dcList.push({
          dcName,
          displayName,
          healthState,
          dgIndex,
          cost: stats?.cost ?? 0,
        });
      }
    }
    return dcList;
  }

  _buildGame() {
    const p1DcList = this._buildDcList(this._p1Army);
    const p2DcList = this._buildDcList(this._p2Army);

    const game = {
      gameId: this._gameId,
      player1Id: this._p1Id,
      player2Id: this._p2Id,
      selectedMap: { id: this._mapId },
      selectedMission: this._buildMission(),
      round: this._round || 1,
      currentRound: this._round || 1,
      ended: false,

      // Squads
      player1Squad: { dcList: p1DcList.map(d => ({ dcName: d.dcName, displayName: d.displayName })) },
      player2Squad: { dcList: p2DcList.map(d => ({ dcName: d.dcName, displayName: d.displayName })) },
      p1DcList,
      p2DcList,

      // VP
      player1VP: { total: 0, kills: 0, objectives: 0 },
      player2VP: { total: 0, kills: 0, objectives: 0 },

      // Figure positions
      figurePositions: { 1: {}, 2: {} },

      // CC state — if a deck is provided and we're starting in-round,
      // shuffle and draw the standard 3-card starting hand automatically
      // (mirrors setup-bridge.js drawStartingHand logic).
      ...this._buildCcState(),

      // Initiative
      initiativePlayerId: this._p1Id,

      // Deployment zones
      deploymentZoneChosen: 'red',
      player1DeploymentZone: 'red',
      player2DeploymentZone: 'blue',

      // Damage tracking
      totalDamageReceived: { 1: 0, 2: 0 },

      // Undo
      undoStack: [],

      // Channel IDs (headless: fake IDs so fetchGameChannel returns a usable channel)
      generalId: `fake-general-${this._gameId}`,
    };

    // Set phase based on build config
    if (this._round > 0) {
      game.phase = PHASES.ROUND_ACTIVE;
      game.roundPhase = ROUND_PHASES.ACTIVATION;
      game.currentActivationTurnPlayerId = this._p1Id;
    } else if (this._deployed) {
      game.phase = PHASES.ROUND_ACTIVE;
      game.roundPhase = ROUND_PHASES.START_OF_ROUND;
    } else {
      game.phase = PHASES.LOBBY;
    }

    // Mission NPC initialization (mirrors dc-play-area.js NPC init)
    if (this._missionVariant && this._deployed) {
      const mapTokens = getMapTokensData();
      if (this._mapId === 'chopper-base-atollon' && this._missionVariant === 'a') {
        const positions = Object.values(mapTokens[this._mapId]?.missionA?.positions || {}).flat().filter(Boolean);
        if (positions.length > 0) game.npcKrykna = positions.map((coord, i) => ({ id: `krykna-${i + 1}`, coord: String(coord).toLowerCase(), hp: 8, maxHp: 8, defeated: false }));
      }
      if (this._mapId === 'corellian-underground' && this._missionVariant === 'a') {
        const positions = Object.values(mapTokens[this._mapId]?.missionA?.positions || {}).flat().filter(Boolean);
        if (positions.length > 0) game.npcThugs = positions.map((coord, i) => ({ id: `thug-${i + 1}`, coord: String(coord).toLowerCase(), hp: 4, maxHp: 4, defeated: false }));
      }
    }

    return game;
  }

  _buildCcState() {
    const buildForPlayer = (deck, hand) => {
      // If explicit hand was provided, use it as-is
      if (hand.length > 0) return { deck: [...deck], hand: [...hand] };
      // If deck provided and we're skipping to in-round, draw starting hand
      if (deck.length > 0 && this._round >= 1) {
        const shuffled = [...deck];
        // Fisher-Yates shuffle
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const drawn = shuffled.splice(0, 3);
        return { deck: shuffled, hand: drawn };
      }
      return { deck: [...deck], hand: [] };
    };

    const p1 = buildForPlayer(this._p1CcDeck, this._p1CcHand);
    const p2 = buildForPlayer(this._p2CcDeck, this._p2CcHand);

    return {
      player1CcHand: p1.hand,
      player2CcHand: p2.hand,
      player1CcDeck: p1.deck,
      player2CcDeck: p2.deck,
      player1CcDiscard: [],
      player2CcDiscard: [],
      player1CcDrawn: true,
      player2CcDrawn: true,
    };
  }

  _buildMission() {
    if (!this._missionVariant) return null;
    const missionCards = getMissionCardsData();
    const mapMissions = missionCards?.[this._mapId];
    const missionData = mapMissions?.[this._missionVariant];
    if (missionData) {
      return {
        variant: this._missionVariant,
        name: missionData.name,
        fullName: missionData.name,
        tokenLabel: missionData.tokenLabel || '',
        interactLabel: missionData.interactLabel || '',
        mechanics: missionData.mechanics || {},
        rules: missionData.rules || {},
      };
    }
    return { variant: this._missionVariant };
  }

  _setupActivations(game, dcMessageMeta) {
    // Count non-figureless DCs for each player
    let p1Acts = 0, p2Acts = 0;
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.gameId !== game.gameId) continue;
      if (isFigurelessDc(meta.dcName)) continue;
      if (meta.playerNum === 1) p1Acts++;
      else p2Acts++;
    }

    game.p1ActivationsRemaining = p1Acts;
    game.p2ActivationsRemaining = p2Acts;
    game.p1ActivationsTotal = p1Acts;
    game.p2ActivationsTotal = p2Acts;
    game.p1ActivatedDcIndices = [];
    game.p2ActivatedDcIndices = [];

    // Initialize dcActionsData — each DC starts with 0 actions (not activated yet)
    game.dcActionsData = {};
  }
}
