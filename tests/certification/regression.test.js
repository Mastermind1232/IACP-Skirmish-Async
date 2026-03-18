/**
 * Certification Regression Suite
 *
 * Wraps the full-catalog certification and random-game stability
 * into node:test assertions. Any regression shows up as a test failure.
 *
 * Run: node --test tests/certification/regression.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { certifyAllCcs } from './cc-checks.js';
import { certifyAllDcs } from './dc-checks.js';
import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcStats, getMapSpaces } from '../../src/data-loader.js';
import { getBoardStateForMovement, getMovementProfile, computeMovementCache } from '../../src/game/movement.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';

const dcData = JSON.parse(readFileSync('data/dc-effects.json', 'utf-8'));
const ccData = JSON.parse(readFileSync('data/cc-effects.json', 'utf-8'));

// ── Full Catalog Certification ──────────────────────────────────────────────

describe('Full Catalog Certification Regression', () => {
  let dcResults, ccResults;

  it('certifies all DCs to L4', async () => {
    dcResults = await certifyAllDcs();
    const dcCards = dcData.cards || dcData;
    const dcTotal = Object.keys(dcCards).length;
    assert.strictEqual(dcResults.length, dcTotal, `DC count mismatch: got ${dcResults.length}, expected ${dcTotal}`);
    const failures = dcResults.filter(r => !r.certified);
    if (failures.length > 0) {
      const detail = failures.slice(0, 10).map(f => `  ${f.name}: ${f.failReasons.join('; ')}`).join('\n');
      assert.fail(`${failures.length} DCs failed L4 certification:\n${detail}`);
    }
  });

  it('certifies all CCs to L4', async () => {
    ccResults = await certifyAllCcs();
    const ccTotal = Object.keys(ccData.cards).length;
    assert.strictEqual(ccResults.length, ccTotal, `CC count mismatch: got ${ccResults.length}, expected ${ccTotal}`);
    const failures = ccResults.filter(r => !r.certified);
    if (failures.length > 0) {
      const detail = failures.slice(0, 10).map(f => `  ${f.name}: ${f.failReasons.join('; ')}`).join('\n');
      assert.fail(`${failures.length} CCs failed L4 certification:\n${detail}`);
    }
  });

  it('has zero unresolved legal actions', async () => {
    if (!dcResults) dcResults = await certifyAllDcs();
    if (!ccResults) ccResults = await certifyAllCcs();
    const all = [...dcResults, ...ccResults];
    const unresolved = all.filter(r =>
      r.checks?.L3_legal_positive?.pass && !r.certified && r.executionPath !== 'fallback'
    );
    assert.strictEqual(unresolved.length, 0, `Unresolved legal actions: ${unresolved.map(r => r.name).join(', ')}`);
  });

  it('has zero fallback-only violations', async () => {
    if (!dcResults) dcResults = await certifyAllDcs();
    if (!ccResults) ccResults = await certifyAllCcs();
    const all = [...dcResults, ...ccResults];
    const violations = all.filter(r => r.executionPath === 'fallback' && !r.fallbackReason);
    assert.strictEqual(violations.length, 0, `Fallback violations: ${violations.map(r => r.name).join(', ')}`);
  });
});

// ── Random Game Stability ───────────────────────────────────────────────────

const DIVERSE_ARMIES = [
  // Mixed factions, varied keywords
  {
    name: 'Imperial vs Rebel (classic)',
    p1: [{ dcName: 'Darth Vader' }, { dcName: 'Stormtrooper (Regular)' }],
    p2: [{ dcName: 'Luke Skywalker' }, { dcName: 'Rebel Trooper (Regular)' }],
  },
  {
    name: 'Scum vs Imperial (hunters)',
    p1: [{ dcName: 'Boba Fett' }, { dcName: 'IG-88' }],
    p2: [{ dcName: 'Director Krennic' }, { dcName: 'Imperial Officer (Elite)' }],
  },
  {
    name: 'Creatures vs Droids',
    p1: [{ dcName: 'Rancor' }, { dcName: 'Nexu' }],
    p2: [{ dcName: 'IG-88' }, { dcName: 'BT-1' }],
  },
  {
    name: 'Force Users duel',
    p1: [{ dcName: 'Luke Skywalker' }, { dcName: 'Ahsoka Tano' }],
    p2: [{ dcName: 'Darth Vader' }, { dcName: 'Emperor Palpatine' }],
  },
  {
    name: 'Trooper swarm vs elite',
    p1: [{ dcName: 'Stormtrooper (Regular)', count: 3 }],
    p2: [{ dcName: 'Han Solo' }],
  },
  {
    name: 'Vehicle + support',
    p1: [{ dcName: 'AT-DP' }, { dcName: 'Imperial Officer (Elite)' }],
    p2: [{ dcName: 'Rebel Saboteur (Elite)' }, { dcName: 'Gideon Argus' }],
  },
  {
    name: 'Wookiees vs Empire',
    p1: [{ dcName: 'Gaarkhan' }, { dcName: 'Wookiee Warriors (Regular)' }],
    p2: [{ dcName: 'Royal Guard (Elite)' }, { dcName: 'Stormtrooper (Elite)' }],
  },
  {
    name: 'S12 Bo-Katan matchup',
    p1: [{ dcName: 'Bo-Katan Kryze' }, { dcName: 'The Mandalorian' }],
    p2: [{ dcName: 'Boba Fett' }, { dcName: 'Bossk' }],
  },
];

describe('Random Game Stability (diverse armies)', () => {
  const MAX_ITERATIONS = 300;

  for (const army of DIVERSE_ARMIES) {
    it(`completes without crash: ${army.name}`, async () => {
      // Verify all DCs exist in data before building
      const dcCards = dcData.cards || dcData;
      const allDcNames = [...army.p1, ...army.p2].map(a => a.dcName);
      for (const name of allDcNames) {
        if (!dcCards[name]) {
          // Skip this army config if a DC doesn't exist in data
          return;
        }
      }

      const { game, harness, deps, dcMessageMeta, dcExhaustedState, dcHealthState } = createTestGame()
        .withPlayer1Army(army.p1)
        .withPlayer2Army(army.p2)
        .inRound(1)
        .build();

      const actionDeps = {
        dcMessageMeta, dcExhaustedState, dcHealthState, getDcStats, getMapSpaces,
        computeMovementCache, getBoardStateForMovement, getMovementProfile,
        getPlayableCcFromHand,
      };

      let iterations = 0;
      let consecutiveEmpty = 0;
      let crashed = false;
      let crashMsg = '';

      for (let i = 0; i < MAX_ITERATIONS; i++) {
        iterations = i + 1;
        const g = harness.getGame();
        if (g.ended) break;

        const p1Actions = getAvailableActions(g, 1, actionDeps);
        const p2Actions = getAvailableActions(g, 2, actionDeps);
        const allActions = [
          ...p1Actions.map(a => ({ ...a, actingPlayer: 1 })),
          ...p2Actions.map(a => ({ ...a, actingPlayer: 2 })),
        ];

        if (allActions.length === 0) {
          consecutiveEmpty++;
          if (consecutiveEmpty > 10) {
            // Break deadlock
            const p2Figs = Object.keys(g.figurePositions?.[2] || {});
            const p1Figs = Object.keys(g.figurePositions?.[1] || {});
            if (p2Figs.length > 0) {
              await deps.applyNpcDamageToFigure(g, 2, p2Figs[0], 999, 'Deadlock breaker');
            } else if (p1Figs.length > 0) {
              await deps.applyNpcDamageToFigure(g, 1, p1Figs[0], 999, 'Deadlock breaker');
            } else break;
            consecutiveEmpty = 0;
          }
          continue;
        }
        consecutiveEmpty = 0;

        // Deterministic selection: pick first action (avoids Math.random in tests)
        // Rotate through actions to get coverage
        const action = allActions[i % allActions.length];
        const userId = action.actingPlayer === 1 ? g.player1Id : g.player2Id;

        try {
          await harness.submitAction(action.customId, userId);
        } catch (err) {
          // Soft errors are OK (invalid state transitions), hard crashes are not
          if (err.message?.includes('Cannot read') || err.message?.includes('is not a function') || err.message?.includes('is not defined')) {
            crashed = true;
            crashMsg = `${action.customId}: ${err.message}`;
            break;
          }
        }
      }

      assert.ok(!crashed, `Game crashed: ${crashMsg}`);
      assert.ok(iterations > 1, `Ran ${iterations} iterations for "${army.name}"`);
    });
  }
});

// ── CC Full Catalog Coverage (all 293 via resolveAbility) ───────────────────

describe('CC Full Catalog: every CC has valid ability wiring', async () => {
  const { getAbility } = await import('../../src/game/abilities.js');

  for (const cardName of Object.keys(ccData.cards)) {
    it(`${cardName} has resolvable ability entry`, () => {
      const effect = ccData.cards[cardName];
      assert.ok(effect, `${cardName} missing from cc-effects.json`);
      assert.ok(typeof effect.cost === 'number', `${cardName} missing cost`);
      assert.ok(effect.timing, `${cardName} missing timing`);
      assert.ok(effect.effect, `${cardName} missing effect text`);

      // If abilityId is specified, verify it resolves
      if (effect.abilityId) {
        const entry = getAbility(effect.abilityId);
        assert.ok(entry, `${cardName}: abilityId "${effect.abilityId}" not found in ability library`);
      }
    });
  }
});

// ── DC Full Catalog Coverage (all 240 have valid data) ──────────────────────

describe('DC Full Catalog: every DC has valid data structure', () => {
  const dcCards = dcData.cards || dcData;
  for (const dcName of Object.keys(dcCards)) {
    it(`${dcName} has valid structure`, () => {
      const dc = dcCards[dcName];
      assert.ok(dc, `${dcName} missing from dc-effects.json`);

      // Companions, attachments, and skirmish upgrades have different structures
      const isFigureDc = !dcName.startsWith('[') && !dc.companion;
      if (isFigureDc) {
        assert.ok(typeof dc.cost === 'number', `${dcName} missing cost`);
        if (dc.attack) {
          assert.ok(Array.isArray(dc.attack.dice), `${dcName} attack missing dice array`);
        }
        if (dc.defense) {
          assert.ok(Array.isArray(dc.defense), `${dcName} defense is not an array`);
        }
      }
      // All DCs should at least have an object with some fields
      assert.ok(typeof dc === 'object', `${dcName} is not an object`);
    });
  }
});
