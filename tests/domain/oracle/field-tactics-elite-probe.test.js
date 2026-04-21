/**
 * PROBE-FIELD-TACTICS-ELITE: Death Trooper (Elite) **Field Tactics**.
 *
 * Card text: "After your activation, you may immediately activate a
 *  friendly TROOPER or LEADER group with cost 6 or less. That group
 *  loses Field Tactics this round."
 *
 * Phase 2 high-risk probe grind (2026-04-21). Atom was structural-only
 * with eligibility logic inlined at src/handlers/activation.js. Pure
 * helpers extracted to src/game/field-tactics-helpers.js; both Elite
 * and Regular variants share the helpers.
 *
 * NOTE: the bot's current implementation grants a free interrupt
 *  attack rather than a full activation. That deviation from card text
 *  is pre-existing and outside this probe's scope — the probe only
 *  documents target-eligibility and round-once-per-group enforcement.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isFieldTacticsDc,
  fieldTacticsRoundKey,
  fieldTacticsOrigin,
  enumerateFieldTacticsTargets,
  FIELD_TACTICS_DC_NAMES,
  FIELD_TACTICS_RANGE,
  FIELD_TACTICS_MAX_COST,
  FIELD_TACTICS_REQUIRED_KEYWORDS,
} from '../../../src/game/field-tactics-helpers.js';

const MAP_ID = 'anchorhead-cantina-bar';

function dcEffects({ cost = 2, kws = ['LEADER'] } = {}) {
  return {
    'Imperial Officer (Regular)': { cost, keywords: kws },
    'Jet Trooper (Regular)': { cost: 4, keywords: ['TROOPER', 'VEHICLE', 'MOBILE'] },
    'Darth Vader': { cost: 18, keywords: ['FORCE USER', 'LEADER', 'BRAWLER'] },
    '0-0-0': { cost: 4, keywords: ['DROID'] },
    'Death Trooper (Elite)': { cost: 4, keywords: ['TROOPER', 'GUARDIAN'] },
  };
}

function buildGame({ positions = {}, map = MAP_ID } = {}) {
  return {
    gameId: 'gft',
    figurePositions: { 1: positions, 2: {} },
    selectedMap: { id: map },
  };
}

const META = Object.freeze({
  dcName: 'Death Trooper (Elite)',
  playerNum: 1,
  displayName: 'Death Trooper (Elite) [DG 1]',
});

describe('PROBE-FIELD-TACTICS-ELITE-001: trigger DC gate', () => {
  it('both Death Trooper variants pass the gate', () => {
    assert.equal(isFieldTacticsDc('Death Trooper (Elite)'), true);
    assert.equal(isFieldTacticsDc('Death Trooper (Regular)'), true);
  });
  it('other DCs do not pass the gate', () => {
    assert.equal(isFieldTacticsDc('Stormtrooper'), false);
    assert.equal(isFieldTacticsDc(null), false);
    assert.equal(isFieldTacticsDc(undefined), false);
  });
  it('exported name set is exactly the two variants', () => {
    assert.deepStrictEqual([...FIELD_TACTICS_DC_NAMES], [
      'Death Trooper (Elite)',
      'Death Trooper (Regular)',
    ]);
  });
});

describe('PROBE-FIELD-TACTICS-ELITE-002: round-once guard key', () => {
  it('key is dcMsgId-scoped (two DGs each get their own)', () => {
    assert.equal(fieldTacticsRoundKey('msg-A'), 'fieldTactics_msg-A');
    assert.notEqual(fieldTacticsRoundKey('msg-A'), fieldTacticsRoundKey('msg-B'));
  });
});

describe('PROBE-FIELD-TACTICS-ELITE-003: origin anchor is any live figure from the group', () => {
  it('picks the first figure from the DG', () => {
    const game = buildGame({
      positions: {
        'Death Trooper (Elite)-1-0': 'a1',
        'Death Trooper (Elite)-1-1': 'b1',
      },
    });
    const o = fieldTacticsOrigin(game, META);
    assert.ok(o);
    assert.equal(o.prefix, 'Death Trooper (Elite)-1-');
    assert.equal(o.originPos, 'a1');
  });

  it('returns null when no DG figures remain', () => {
    const game = buildGame({ positions: {} });
    assert.equal(fieldTacticsOrigin(game, META), null);
  });

  it('honors DG index extracted from displayName', () => {
    const meta2 = { ...META, displayName: 'Death Trooper (Elite) [DG 2]' };
    const game = buildGame({
      positions: {
        'Death Trooper (Elite)-1-0': 'a1',
        'Death Trooper (Elite)-2-0': 'c1',
      },
    });
    const o = fieldTacticsOrigin(game, meta2);
    assert.equal(o.prefix, 'Death Trooper (Elite)-2-');
    assert.equal(o.originPos, 'c1');
  });
});

describe('PROBE-FIELD-TACTICS-ELITE-004: target enumeration (keyword + cost + range)', () => {
  it('includes a friendly TROOPER within range', () => {
    const game = buildGame({
      positions: {
        'Death Trooper (Elite)-1-0': 'a1',
        'Jet Trooper (Regular)-1-0': 'b1',
      },
    });
    const out = enumerateFieldTacticsTargets(game, META, dcEffects());
    assert.deepStrictEqual(out, ['Jet Trooper (Regular)-1-0']);
  });

  it('includes a friendly LEADER within range', () => {
    const game = buildGame({
      positions: {
        'Death Trooper (Elite)-1-0': 'a1',
        'Imperial Officer (Regular)-1-0': 'b1',
      },
    });
    const out = enumerateFieldTacticsTargets(game, META, dcEffects());
    assert.deepStrictEqual(out, ['Imperial Officer (Regular)-1-0']);
  });

  it('excludes own DG', () => {
    const game = buildGame({
      positions: {
        'Death Trooper (Elite)-1-0': 'a1',
        'Death Trooper (Elite)-1-1': 'b1',
      },
    });
    const out = enumerateFieldTacticsTargets(game, META, dcEffects());
    assert.deepStrictEqual(out, []);
  });

  it('excludes targets without TROOPER or LEADER keyword (0-0-0 DROID)', () => {
    const game = buildGame({
      positions: {
        'Death Trooper (Elite)-1-0': 'a1',
        '0-0-0-1-0': 'b1',
      },
    });
    const out = enumerateFieldTacticsTargets(game, META, dcEffects());
    assert.deepStrictEqual(out, []);
  });

  it('excludes targets whose DC cost exceeds 6 (Darth Vader)', () => {
    const game = buildGame({
      positions: {
        'Death Trooper (Elite)-1-0': 'a1',
        'Darth Vader-1-0': 'b1',
      },
    });
    const out = enumerateFieldTacticsTargets(game, META, dcEffects());
    assert.deepStrictEqual(out, []);
  });

  it('includes a target at exactly 2 spaces, excludes at 3+', () => {
    const game = buildGame({
      positions: {
        'Death Trooper (Elite)-1-0': 'a1',
        'Jet Trooper (Regular)-1-0': 'c1',
      },
    });
    const atTwo = enumerateFieldTacticsTargets(game, META, dcEffects());
    assert.deepStrictEqual(atTwo, ['Jet Trooper (Regular)-1-0']);

    const game3 = buildGame({
      positions: {
        'Death Trooper (Elite)-1-0': 'a1',
        'Jet Trooper (Regular)-1-0': 'd1',
      },
    });
    const atThree = enumerateFieldTacticsTargets(game3, META, dcEffects());
    assert.deepStrictEqual(atThree, []);
  });

  it('missing DC effect entry for target → excluded (fail-safe)', () => {
    const game = buildGame({
      positions: {
        'Death Trooper (Elite)-1-0': 'a1',
        'Nonexistent-1-0': 'b1',
      },
    });
    const out = enumerateFieldTacticsTargets(game, META, dcEffects());
    assert.deepStrictEqual(out, []);
  });

  it('no own-group figures in play → empty targets', () => {
    const game = buildGame({
      positions: {
        'Jet Trooper (Regular)-1-0': 'b1',
      },
    });
    const out = enumerateFieldTacticsTargets(game, META, dcEffects());
    assert.deepStrictEqual(out, []);
  });

  it('enemy figures are never eligible (wrong player bucket)', () => {
    const game = {
      gameId: 'gft2',
      figurePositions: {
        1: { 'Death Trooper (Elite)-1-0': 'a1' },
        2: { 'Jet Trooper (Regular)-2-0': 'b1' },
      },
      selectedMap: { id: MAP_ID },
    };
    const out = enumerateFieldTacticsTargets(game, META, dcEffects());
    assert.deepStrictEqual(out, []);
  });
});

describe('PROBE-FIELD-TACTICS-ELITE-005: public constants match card text', () => {
  it('range = 2', () => {
    assert.equal(FIELD_TACTICS_RANGE, 2);
  });
  it('max cost = 6', () => {
    assert.equal(FIELD_TACTICS_MAX_COST, 6);
  });
  it('required keywords = [TROOPER, LEADER]', () => {
    assert.deepStrictEqual([...FIELD_TACTICS_REQUIRED_KEYWORDS], ['TROOPER', 'LEADER']);
  });
});

describe('PROBE-FIELD-TACTICS-ELITE-006: library entry wired', () => {
  it('field_tactics_death_trooper_elite entry exists and is wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'));
    const entry = lib.abilities?.field_tactics_death_trooper_elite;
    assert.ok(entry, 'field_tactics_death_trooper_elite must exist');
    assert.equal(entry.wiredStatus, 'wired');
    assert.equal(entry.label, 'Field Tactics');
    assert.equal(entry.trigger, 'end-of-activation');
  });
});
