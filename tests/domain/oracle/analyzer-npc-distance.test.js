/**
 * Analyzer helper — nearest-enemy distance must include live NPCs.
 *
 * Prior to commit 403a0d4 follow-up, the training analyzer enumerated only
 * `figurePositions[oppNum]` when computing distToEnemy for `_abilityPlays`
 * and `round1DistStart/End`. That misreported Atollon (+Krykna) and
 * Corellian (+Thugs) maps, where the live `abilityGateSuppresses` correctly
 * unions non-defeated NPCs. These tests pin the analyzer union so reports
 * match the live gate's nearest-enemy view.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { distToNearestEnemy } from '../../headless/analyzer-helpers.js';

function game({ enemyFig = null, krykna = [], thugs = [] } = {}) {
  return {
    figurePositions: {
      1: { 'Actor-1-0': 'a1' },
      2: enemyFig ? { 'Enemy-1-0': enemyFig } : {},
    },
    npcKrykna: krykna,
    npcThugs: thugs,
  };
}

describe('distToNearestEnemy — analyzer union', () => {
  it('falls back to NPC Krykna when no opponent DC figures exist', () => {
    const g = game({ krykna: [{ coord: 'a4', defeated: false }] });
    assert.equal(distToNearestEnemy('a1', g, 1), 3);
  });

  it('falls back to NPC Thugs when no opponent DC figures exist', () => {
    const g = game({ thugs: [{ coord: 'c1', defeated: false }] });
    assert.equal(distToNearestEnemy('a1', g, 1), 2);
  });

  it('picks NPC when it is closer than the opponent DC figure', () => {
    const g = game({
      enemyFig: 'j10',
      krykna: [{ coord: 'a3', defeated: false }],
    });
    // DC-only would report |a1→j10| = 9+9 = 18; NPC-union picks |a1→a3| = 2.
    assert.equal(distToNearestEnemy('a1', g, 1), 2);
  });

  it('ignores defeated NPCs', () => {
    const g = game({
      enemyFig: 'j10',
      krykna: [{ coord: 'a3', defeated: true }],
      thugs: [{ coord: 'b2', defeated: true }],
    });
    assert.equal(distToNearestEnemy('a1', g, 1), 18);
  });

  it('returns null when no enemies exist', () => {
    assert.equal(distToNearestEnemy('a1', game(), 1), null);
  });

  it('returns null when actor coord is missing', () => {
    const g = game({ enemyFig: 'b2' });
    assert.equal(distToNearestEnemy(null, g, 1), null);
    assert.equal(distToNearestEnemy(undefined, g, 1), null);
  });

  it('unions both NPC pools simultaneously (nearest wins)', () => {
    const g = game({
      enemyFig: 'j10',
      krykna: [{ coord: 'e5', defeated: false }],
      thugs: [{ coord: 'a2', defeated: false }],
    });
    assert.equal(distToNearestEnemy('a1', g, 1), 1);
  });
});
