/**
 * Oracle batch-17: tail library-shape probe — closes the last 6 pending
 * atoms (1 ccEffect, 5 dcPassive) that lacked structured fields to pin.
 * Minimum-viable contract: entry exists, expected type, non-empty label.
 * When the library entry carries wiredStatus, pin it to 'wired' too.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB_PATH = resolve(__dirname, '../../../data/ability-library.json');
const lib = JSON.parse(readFileSync(LIB_PATH, 'utf8'));

// [id, abilityKey, expected type, expected label]
const BATCH = [
  ['CC-CAL-S-BUDDY',               "Cal's Buddy",              'ccEffect',  "Deploy BD-1 to Cal's space or an adjacent space; BD-1 activates at start/end of Cal's activation"],
  ['DC-PASS-ATTACHED-DIO',         'attached_dio',             'dcPassive', 'Attached'],
  // defensive_fire_bokatan REMOVED in the IACP 2026-06-21 update: Bo-Katan lost
  // Defensive Fire. She now has the Beskar Armor keyword (2 Block AFTER deployment)
  // plus Dual-Wield Pistols granting 2 Block BEFORE her bonus ranged attack.
  ['DC-PASS-DROID-KIT-IDEN',       'droid_kit_iden',           'dcPassive', 'Droid Kit (Iden)'],
  ['DC-PASS-INSIGNIFICANT-DIO',    'insignificant_dio',        'dcPassive', 'Insignificant'],
  ['DC-PASS-PULSE-CANNON-IDEN',    'pulse_cannon_iden',        'dcPassive', 'Pulse Cannon (Iden)'],
];

describe('DC-CC batch-17: tail library-shape contracts (5 atoms)', () => {
  for (const [id, key, type, label] of BATCH) {
    it(`${id} — ${type} ${key} library shape`, () => {
      const e = lib.abilities?.[key];
      assert.ok(e, `ability-library entry missing for ${key}`);
      assert.equal(e.type, type, `${key} type should be ${type}`);
      assert.equal(typeof e.label, 'string');
      assert.ok(e.label.length > 0, `${key} label is empty`);
      assert.equal(e.label, label, `${key} label mismatch`);
      if ('wiredStatus' in e) {
        assert.equal(e.wiredStatus, 'wired', `${key} wiredStatus should be wired`);
      }
    });
  }
});
