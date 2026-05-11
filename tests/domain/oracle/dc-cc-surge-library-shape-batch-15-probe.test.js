/**
 * Oracle batch-15: surge library-shape probe.
 * Pins the library contract for every pending `surge` atom — all 48
 * simple atomic surge abilities (+N hits, accuracy, cleave, pierce,
 * stun, hide, recover, and named surge packages like Bleed / Fell Swoop).
 *
 * Contract: each ability-library entry exists under the atom's `abilityKey`,
 *   type='surge', `surgeCost` is a positive integer, `label` is a non-empty
 *   string, and both label and surgeCost match the expected values.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB_PATH = resolve(__dirname, '../../../data/ability-library.json');
const lib = JSON.parse(readFileSync(LIB_PATH, 'utf8'));

// [ledger-id, abilityKey, expected surgeCost, expected label]
const BATCH = [
  ['SURGE-1-HIT',                  '+1 hit',                1, '+1 Damage'],
  ['SURGE-1-HIT-PIERCE-1',         '+1 hit, pierce 1',      1, '+1 Damage, Pierce 1'],
  ['SURGE-1-HIT-STUN',             '+1 hit, stun',          1, '+1 Damage, Stun'],
  ['SURGE-2-HITS',                 '+2 hits',               1, '+2 Damage'],
  ['SURGE-3-DAMAGE',               '+3 damage',             1, '+3 Damage'],
  ['SURGE-ACCURACY-1',             'accuracy 1',            1, '+1 Accuracy'],
  ['SURGE-ACCURACY-2',             'accuracy 2',            1, '+2 Accuracy'],
  ['SURGE-ACCURACY-2-PIERCE-1',    'accuracy 2, pierce 1',  1, '+2 Accuracy, Pierce 1'],
  ['SURGE-ACCURACY-2-SURGE-1',     'accuracy 2, surge 1',   1, '+2 Accuracy, +1 Surge'],
  ['SURGE-ACCURACY-3',             'accuracy 3',            1, '+3 Accuracy'],
  ['SURGE-AGITATE',                'agitate',               1, 'Agitate'],
  ['SURGE-BARGAIN',                'bargain',               1, 'Bargain'],
  ['SURGE-BLAST-1',                'blast 1',               1, 'Blast 1'],
  ['SURGE-BLAST-2',                'blast 2',               1, 'Blast 2'],
  ['SURGE-BLEED',                  'bleed',                 1, 'Bleed'],
  ['SURGE-CLEAVE-1',               'cleave 1',              1, 'Cleave 1'],
  ['SURGE-CLEAVE-2',               'cleave 2',              1, 'Cleave 2'],
  ['SURGE-CONCUSSIVE-BOLT',        'concussive_bolt',       1, 'Concussive Bolt'],
  ['SURGE-CRITICAL-HIT',           'critical_hit',          1, 'Critical Hit'],
  ['SURGE-DAMAGE-1',               'damage 1',              1, '+1 Damage'],
  ['SURGE-DAMAGE-2',               'damage 2',              1, '+2 Damage'],
  ['SURGE-DAMAGE-2-HIDE',          'damage 2, hide',        1, '+2 Damage, Hide'],
  ['SURGE-DAMAGE-3',               'damage 3',              1, '+3 Damage'],
  ['SURGE-DAMAGE-4',               'damage 4',              2, '+4 Damage'],
  ['SURGE-DEADLY-SPIN',            'deadly_spin',           1, 'Deadly Spin'],
  ['SURGE-FELL-SWOOP',             'fell_swoop',            1, 'Fell Swoop'],
  ['SURGE-FIGHTING-KNIFE',         'fighting_knife',        1, 'Fighting Knife'],
  ['SURGE-FOCUS',                  'focus',                 1, 'Focus'],
  ['SURGE-HARASS',                 'harass',                1, 'Harass'],
  ['SURGE-HIDE',                   'hide',                  1, 'Hide'],
  ['SURGE-INTERROGATE',            'interrogate',           1, 'Interrogate'],
  ['SURGE-MASTERY',                'mastery',               1, 'Mastery'],
  ['SURGE-PIERCE-1',               'pierce 1',              1, 'Pierce 1'],
  ['SURGE-PIERCE-1-WEAKEN',        'pierce 1, weaken',      1, 'Pierce 1, Weaken'],
  ['SURGE-PIERCE-2',               'pierce 2',              1, 'Pierce 2'],
  ['SURGE-PIERCE-3',               'pierce 3',              1, 'Pierce 3'],
  ['SURGE-RECOVER-1',              'recover 1',             1, 'Recover 1'],
  ['SURGE-RECOVER-2',              'recover 2',             1, 'Recover 2'],
  ['SURGE-RECOVER-3',              'recover 3',             1, 'Recover 3'],
  ['SURGE-SHOCKING-PALM',          'shocking_palm',         1, 'Shocking Palm'],
  ['SURGE-SHRAPNEL',               'shrapnel',              1, 'Shrapnel'],
  ['SURGE-SPREAD-THE-PAIN',        'spread_the_pain',       1, 'Spread the Pain'],
  ['SURGE-SQUAD-COMMAND',          'squad_command',         1, 'Squad Command'],
  ['SURGE-STALK-PREY',             'stalk_prey',            1, 'Stalk Prey'],
  ['SURGE-STUN',                   'stun',                  1, 'Stun'],
  ['SURGE-STUN-NET',               'stun_net',              1, 'Stun Net'],
  ['SURGE-SUPPRESSION',            'suppression',           1, 'Suppression'],
  ['SURGE-WEAKEN',                 'weaken',                1, 'Weaken'],
];

describe('DC-CC batch-15: surge library-shape contracts (48 atoms)', () => {
  for (const [id, key, cost, label] of BATCH) {
    it(`${id} — surge ${key} library entry shape`, () => {
      const e = lib.abilities?.[key];
      assert.ok(e, `ability-library entry missing for ${key}`);
      assert.equal(e.type, 'surge', `${key} type should be surge`);
      assert.equal(typeof e.label, 'string');
      assert.ok(e.label.length > 0, `${key} label is empty`);
      assert.equal(e.label, label, `${key} label mismatch`);
      assert.equal(typeof e.surgeCost, 'number');
      assert.ok(Number.isInteger(e.surgeCost) && e.surgeCost >= 1 && e.surgeCost <= 2,
        `${key} surgeCost should be integer 1 or 2, got ${e.surgeCost}`);
      assert.equal(e.surgeCost, cost, `${key} surgeCost mismatch`);
    });
  }
});
