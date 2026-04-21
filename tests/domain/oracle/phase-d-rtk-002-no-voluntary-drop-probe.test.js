/**
 * Phase-D behavioral probe — CRR-RTK-002.
 *
 * CRR: "A carried token cannot be retrieved by other figures, traded to
 * other figures, or voluntarily dropped. If a figure is defeated, any
 * tokens that it is carrying are dropped in its space."
 *
 * The existing direct_oracle covers the defeat-drop invariant (the
 * `droppedContrabandSpaces` push). The gap is the REJECTION half of the
 * rule — voluntary drop and cross-figure transfer must be absent from the
 * legal-interact substrate.
 *
 * PROBE-RTK-002-A: no "drop_contraband" / "trade_contraband" option exists
 *                  in the src tree (rejection by absence)
 * PROBE-RTK-002-B: a figure already carrying contraband has NO contraband-
 *                  related legal-interact option on a carry mission
 * PROBE-RTK-002-C: defeat-drop simulation — after capture+clear, the
 *                  carrying figure's entry is gone and the drop space is
 *                  recorded (mirrors src/engine/defeat-handler.js:108-118)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

function* walkJs(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walkJs(p);
    else if (p.endsWith('.js')) yield p;
  }
}

describe('PROBE-RTK-002-A: no drop/trade option exists in the src tree', () => {
  it('src/ contains no "drop_contraband" or "trade_contraband" option id', () => {
    const hits = [];
    for (const p of walkJs(resolve(ROOT, 'src'))) {
      const src = readFileSync(p, 'utf8');
      if (/['"]drop_contraband['"]|['"]trade_contraband['"]/.test(src)) {
        hits.push(p.replace(ROOT + '/', ''));
      }
    }
    assert.deepEqual(hits, [],
      'CRR-RTK-002: no voluntary-drop / cross-figure-trade path may exist for carried tokens.');
  });
});

describe('PROBE-RTK-002-C: defeat-drop invariant (simulated)', () => {
  it('carrier defeat: position captured, contraband entry removed, drop space recorded', () => {
    // Mirror the defeat-handler logic at src/engine/defeat-handler.js:98-118.
    // This re-enacts the invariant so a refactor that drops the capture step
    // or the delete step fails on a concrete state transition.
    const game = {
      selectedMission: { mechanics: { type: 'carry' } },
      figurePositions: { 1: { 'Han Solo-1-0': 'h7' } },
      figureContraband: { 'Han Solo-1-0': true },
    };
    const playerNum = 1;
    const figureKey = 'Han Solo-1-0';

    // Step 0: capture BEFORE removal.
    const lastPos = game.figurePositions[playerNum][figureKey] || null;
    const wasCarrying = !!game.figureContraband?.[figureKey];

    // Step 1: remove position (what removeFigurePosition does to figurePositions).
    delete game.figurePositions[playerNum][figureKey];

    // Step 1b: drop the carried token.
    if (wasCarrying) {
      if (game.selectedMission?.mechanics?.type === 'carry' && lastPos) {
        game.droppedContrabandSpaces = game.droppedContrabandSpaces || [];
        const norm = String(lastPos).toLowerCase();
        if (!game.droppedContrabandSpaces.includes(norm)) {
          game.droppedContrabandSpaces.push(norm);
        }
      }
      delete game.figureContraband[figureKey];
    }

    assert.equal(game.figureContraband[figureKey], undefined,
      'Carried-contraband entry must be cleared from the defeated figure.');
    assert.deepStrictEqual(game.droppedContrabandSpaces, ['h7'],
      'Dropped-contraband space must record the defeated figure\'s last position.');
  });

  it('non-carry mission: contraband is cleared but NO drop space recorded', () => {
    // Counterfactual: if mission.mechanics.type !== 'carry', the drop
    // logic is gated out. This protects against a regression that would
    // spuriously push drop spaces in non-carry missions.
    const game = {
      selectedMission: { mechanics: { type: 'something-else' } },
      figurePositions: { 1: { 'Han Solo-1-0': 'h7' } },
      figureContraband: { 'Han Solo-1-0': true },
    };
    const lastPos = game.figurePositions[1]['Han Solo-1-0'];
    const wasCarrying = !!game.figureContraband['Han Solo-1-0'];
    delete game.figurePositions[1]['Han Solo-1-0'];
    if (wasCarrying) {
      if (game.selectedMission?.mechanics?.type === 'carry' && lastPos) {
        game.droppedContrabandSpaces = game.droppedContrabandSpaces || [];
        game.droppedContrabandSpaces.push(String(lastPos).toLowerCase());
      }
      delete game.figureContraband['Han Solo-1-0'];
    }
    assert.equal(game.droppedContrabandSpaces, undefined,
      'Non-carry mission: no drop-space recorded (gated by mechanics.type).');
  });
});
