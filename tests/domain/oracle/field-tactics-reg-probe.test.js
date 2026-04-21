/**
 * PROBE-FIELD-TACTICS-REG: Death Trooper (Regular) **Field Tactics**.
 *
 * Same card text as Elite. Regular shares the field-tactics-helpers
 * implementation; this probe verifies the Regular variant is gated by
 * the same DC-name predicate, that the library entry is wired, and
 * that multi-group DC bookkeeping keeps round-guards independent per
 * group (two Reg DGs = two trigger windows per round).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isFieldTacticsDc,
  fieldTacticsRoundKey,
  fieldTacticsOrigin,
  enumerateFieldTacticsTargets,
} from '../../../src/game/field-tactics-helpers.js';

const MAP_ID = 'anchorhead-cantina-bar';

function dcEffects() {
  return {
    'Imperial Officer (Regular)': { cost: 2, keywords: ['LEADER'] },
    'Death Trooper (Regular)': { cost: 3, keywords: ['TROOPER', 'GUARDIAN'] },
  };
}

const REG_META = Object.freeze({
  dcName: 'Death Trooper (Regular)',
  playerNum: 1,
  displayName: 'Death Trooper (Regular) [DG 1]',
});

const REG_META_DG2 = Object.freeze({
  dcName: 'Death Trooper (Regular)',
  playerNum: 1,
  displayName: 'Death Trooper (Regular) [DG 2]',
});

function buildGame(positions) {
  return {
    gameId: 'gftr',
    figurePositions: { 1: positions, 2: {} },
    selectedMap: { id: MAP_ID },
  };
}

describe('PROBE-FIELD-TACTICS-REG-001: Regular variant passes the DC gate', () => {
  it('isFieldTacticsDc("Death Trooper (Regular)") === true', () => {
    assert.equal(isFieldTacticsDc('Death Trooper (Regular)'), true);
  });
});

describe('PROBE-FIELD-TACTICS-REG-002: DG-index-aware origin for Regular', () => {
  it('DG 1 origin reads from prefix "Death Trooper (Regular)-1-"', () => {
    const game = buildGame({
      'Death Trooper (Regular)-1-0': 'a1',
      'Death Trooper (Regular)-1-1': 'b1',
      'Death Trooper (Regular)-2-0': 'c1',
    });
    const o = fieldTacticsOrigin(game, REG_META);
    assert.equal(o.prefix, 'Death Trooper (Regular)-1-');
    assert.equal(o.originPos, 'a1');
  });

  it('DG 2 origin reads from prefix "Death Trooper (Regular)-2-"', () => {
    const game = buildGame({
      'Death Trooper (Regular)-1-0': 'a1',
      'Death Trooper (Regular)-2-0': 'c1',
    });
    const o = fieldTacticsOrigin(game, REG_META_DG2);
    assert.equal(o.prefix, 'Death Trooper (Regular)-2-');
    assert.equal(o.originPos, 'c1');
  });
});

describe('PROBE-FIELD-TACTICS-REG-003: round-guard keys per-group, not per-DC', () => {
  it('two Reg DGs each get their own round-guard key', () => {
    const keyA = fieldTacticsRoundKey('msg-reg-dg1');
    const keyB = fieldTacticsRoundKey('msg-reg-dg2');
    assert.notEqual(keyA, keyB);

    const used = { [keyA]: true };
    // DG1 blocked, DG2 still eligible:
    assert.equal(!!used[keyA], true);
    assert.equal(!!used[keyB], false);
  });
});

describe('PROBE-FIELD-TACTICS-REG-004: Reg cannot target its own DG but can target the other Reg DG', () => {
  it('Reg DG1 with Reg DG2 adjacent → Reg DG2 is eligible (cost 3, TROOPER, range 1)', () => {
    const game = buildGame({
      'Death Trooper (Regular)-1-0': 'a1',
      'Death Trooper (Regular)-2-0': 'b1',
    });
    const out = enumerateFieldTacticsTargets(game, REG_META, dcEffects());
    assert.deepStrictEqual(out, ['Death Trooper (Regular)-2-0']);
  });

  it('Reg DG1 with only Reg DG1 figures → no targets (self-group excluded)', () => {
    const game = buildGame({
      'Death Trooper (Regular)-1-0': 'a1',
      'Death Trooper (Regular)-1-1': 'b1',
    });
    const out = enumerateFieldTacticsTargets(game, REG_META, dcEffects());
    assert.deepStrictEqual(out, []);
  });
});

describe('PROBE-FIELD-TACTICS-REG-005: library entry wired', () => {
  it('field_tactics_death_trooper_reg entry exists and is wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'));
    const entry = lib.abilities?.field_tactics_death_trooper_reg;
    assert.ok(entry, 'field_tactics_death_trooper_reg must exist');
    assert.equal(entry.wiredStatus, 'wired');
    assert.equal(entry.label, 'Field Tactics');
    assert.equal(entry.trigger, 'end-of-activation');
  });

  it('dc-effects.json wires specialAbilityIds to field_tactics_death_trooper_reg', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'));
    const reg = effects.cards?.['Death Trooper (Regular)'];
    assert.ok(reg, 'Death Trooper (Regular) must exist in dc-effects');
    assert.ok(
      (reg.specialAbilityIds || []).includes('field_tactics_death_trooper_reg'),
      'Regular must reference field_tactics_death_trooper_reg in specialAbilityIds'
    );
  });
});
