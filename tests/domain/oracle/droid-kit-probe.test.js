/**
 * PROBE-DROID-KIT: Iden Versio's **Droid Kit**.
 *
 * Card text: "At the start of each of your activations, if Dio is in
 *  your space, gain 1 Power Token of your choice."
 *
 * Phase 2 high-risk probe grind (2026-04-21). Atom was structural-only.
 * Pure helpers extracted to src/game/droid-kit-helpers.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectDroidKitTrigger, DROID_KIT_TOKEN_TYPES } from '../../../src/game/droid-kit-helpers.js';
import { grantPowerTokens } from '../../../src/game/game-helpers.js';

const MAP_ID = 'anchorhead-cantina-bar';

function buildGame({ idenPos = 'a1', dioPos = null } = {}) {
  const p1 = {};
  if (idenPos) p1['Iden Versio-1-0'] = idenPos;
  if (dioPos) p1['Dio-1-0'] = dioPos;
  return {
    gameId: 'gdk',
    figurePositions: { 1: p1, 2: {} },
    figurePowerTokens: {},
    selectedMap: { id: MAP_ID },
  };
}

describe('PROBE-DROID-KIT-001: trigger applies only when Dio shares Iden\'s space', () => {
  it('Iden and Dio both at a1 → applicable', () => {
    const game = buildGame({ idenPos: 'a1', dioPos: 'a1' });
    const r = detectDroidKitTrigger(game, 1, 'Iden Versio-1-0');
    assert.equal(r.applicable, true);
    assert.equal(r.dioFigureKey, 'Dio-1-0');
    assert.equal(r.idenPos, 'a1');
  });

  it('Iden at a1, Dio at b1 → not applicable (same-space check fails)', () => {
    const game = buildGame({ idenPos: 'a1', dioPos: 'b1' });
    const r = detectDroidKitTrigger(game, 1, 'Iden Versio-1-0');
    assert.equal(r.applicable, false);
    assert.equal(r.reason, 'Dio is not in the same space');
  });

  it('case-insensitive coord match (A1 vs a1)', () => {
    const game = buildGame({ idenPos: 'A1', dioPos: 'a1' });
    const r = detectDroidKitTrigger(game, 1, 'Iden Versio-1-0');
    assert.equal(r.applicable, true);
  });
});

describe('PROBE-DROID-KIT-002: reason strings are distinct', () => {
  it('no Dio in play → "Dio is not in play"', () => {
    const game = buildGame({ idenPos: 'a1', dioPos: null });
    const r = detectDroidKitTrigger(game, 1, 'Iden Versio-1-0');
    assert.equal(r.applicable, false);
    assert.equal(r.reason, 'Dio is not in play');
  });

  it('Dio in play but not same space → "Dio is not in the same space"', () => {
    const game = buildGame({ idenPos: 'a1', dioPos: 'c5' });
    const r = detectDroidKitTrigger(game, 1, 'Iden Versio-1-0');
    assert.equal(r.applicable, false);
    assert.equal(r.reason, 'Dio is not in the same space');
  });

  it('Iden has no position → "Iden has no position"', () => {
    const game = buildGame({ idenPos: null, dioPos: 'a1' });
    const r = detectDroidKitTrigger(game, 1, 'Iden Versio-1-0');
    assert.equal(r.applicable, false);
    assert.equal(r.reason, 'Iden has no position');
  });
});

describe('PROBE-DROID-KIT-003: all four token types grantable', () => {
  for (const type of DROID_KIT_TOKEN_TYPES) {
    it(`grantPowerTokens applies 1 ${type} Token to Iden`, () => {
      const game = buildGame({ idenPos: 'a1', dioPos: 'a1' });
      grantPowerTokens(game, 'Iden Versio-1-0', type, 1);
      assert.deepStrictEqual(game.figurePowerTokens['Iden Versio-1-0'], [type]);
    });
  }
  it('token type set is exactly [Damage, Surge, Block, Evade]', () => {
    assert.deepStrictEqual([...DROID_KIT_TOKEN_TYPES], ['Damage', 'Surge', 'Block', 'Evade']);
  });
});

describe('PROBE-DROID-KIT-004: library entry wired', () => {
  it('droid_kit_iden entry exists with expected label', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'));
    const entry = lib.abilities?.droid_kit_iden;
    assert.ok(entry, 'droid_kit_iden must exist');
    assert.equal(entry.type, 'dcPassive');
    // NOTE: this entry has no wiredStatus field because wiring lives in
    // src/engine/activation-setup.js + src/handlers/activation.js,
    // dispatched by DC name rather than library shape. The ledger still
    // covers this atom via handler-code references.
    assert.match(entry.label || '', /Droid Kit/);
  });
});
