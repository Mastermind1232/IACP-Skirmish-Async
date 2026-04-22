/**
 * PROBE-SQUAD-TRAINING: family +1 attacker reroll gated on adjacent
 * friendly TROOPER.
 *
 * Covers four atoms:
 *   - squad_training_shoretrooper_elite (Shoretrooper Elite)
 *   - squad_training_shoretrooper_reg   (LATENT — orphan; no DC)
 *   - squad_training_stormtrooper_elite (Stormtrooper Elite)
 *   - squad_training_stormtrooper_reg   (Stormtrooper Regular)
 *
 * Pure helpers extracted from src/handlers/combat.js:2777. Helper
 * scope is the id-set membership + reroll bump. Spatial
 * adjacency-and-TROOPER check remains in the handler.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasSquadTrainingAbility,
  applySquadTrainingReroll,
  SQUAD_TRAINING_ABILITY_IDS,
  SQUAD_TRAINING_REROLL,
} from '../../../src/game/squad-training-helpers.js';

const EXPECTED_IDS = [
  'squad_training_shoretrooper_elite',
  'squad_training_shoretrooper_reg',
  'squad_training_stormtrooper_elite',
  'squad_training_stormtrooper_reg',
];

const WIRED_DCS = [
  ['squad_training_shoretrooper_elite', 'Shoretrooper (Elite)'],
  ['squad_training_stormtrooper_elite', 'Stormtrooper (Elite)'],
  ['squad_training_stormtrooper_reg', 'Stormtrooper (Regular)'],
];

describe('PROBE-SQUAD-TRAINING-001: constants', () => {
  it('frozen id set covers all 4 members', () => {
    assert.deepStrictEqual([...SQUAD_TRAINING_ABILITY_IDS].sort(), [...EXPECTED_IDS].sort());
    assert.ok(Object.isFrozen(SQUAD_TRAINING_ABILITY_IDS));
  });
  it('reroll = 1', () => {
    assert.equal(SQUAD_TRAINING_REROLL, 1);
  });
});

describe('PROBE-SQUAD-TRAINING-002: hasSquadTrainingAbility', () => {
  for (const id of EXPECTED_IDS) {
    it(`${id} → true`, () => {
      assert.equal(hasSquadTrainingAbility([id]), true);
    });
  }
  it('unrelated → false', () => {
    assert.equal(hasSquadTrainingAbility(['focus']), false);
    assert.equal(hasSquadTrainingAbility([]), false);
  });
  it('non-array → false', () => {
    assert.equal(hasSquadTrainingAbility(null), false);
    assert.equal(hasSquadTrainingAbility('squad_training_stormtrooper_reg'), false);
  });
});

describe('PROBE-SQUAD-TRAINING-003: applySquadTrainingReroll', () => {
  it('zero existing → 1', () => {
    assert.equal(applySquadTrainingReroll(0), 1);
  });
  it('stacks on existing', () => {
    assert.equal(applySquadTrainingReroll(2), 3);
  });
  it('null / undefined → treated as 0', () => {
    assert.equal(applySquadTrainingReroll(null), 1);
    assert.equal(applySquadTrainingReroll(), 1);
  });
});

describe('PROBE-SQUAD-TRAINING-004: library + dc-effects wiring', () => {
  for (const id of EXPECTED_IDS) {
    it(`${id} library entry wired`, async () => {
      const { readFile } = await import('node:fs/promises');
      const lib = JSON.parse(
        await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
      );
      const e = lib.abilities?.[id];
      assert.ok(e, `${id} library entry must exist`);
      assert.equal(e.wiredStatus, 'wired');
      assert.match(e.label || '', /Squad Training/i);
    });
  }
  for (const [id, dcName] of WIRED_DCS) {
    it(`${dcName} references ${id}`, async () => {
      const { readFile } = await import('node:fs/promises');
      const effects = JSON.parse(
        await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
      );
      const dc = effects.cards?.[dcName];
      assert.ok(dc, `${dcName} DC must exist`);
      assert.ok((dc.specialAbilityIds || []).includes(id));
    });
  }
});

describe('LATENT-SQUAD-TRAINING: shoretrooper_reg orphan', () => {
  it('LATENT: no DC references squad_training_shoretrooper_reg', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    let referenced = false;
    for (const dc of Object.values(effects.cards || {})) {
      if ((dc.specialAbilityIds || []).includes('squad_training_shoretrooper_reg')) {
        referenced = true;
        break;
      }
    }
    // Tripwire: if/when Shoretrooper (Regular) DC is added and wires this slug,
    // the orphan is closed and this assertion should be flipped.
    assert.equal(referenced, false, 'shoretrooper_reg is still orphaned');
  });
});
