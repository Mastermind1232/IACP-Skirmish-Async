/**
 * Oracle: Ewok Warrior (Elite) "Sling Barrage" end-to-end.
 *
 * Card text: "Special Action (Sling Barrage): Perform a Ranged attack using
 * your printed attack pool. During this attack, you may reroll up to 1 attack
 * die for each other figure in your group with line of sight to the defender."
 *
 * Covers DC-CC ledger atom:
 *   - DC-SPEC-SLING-BARRAGE (promoted from gap → covered)
 *
 * Four assertions pin the wiring across all three layers:
 *   1. Library entry carries the structured `slingBarrageReroll: true` flag.
 *   2. Ewok Warrior (Elite) DC references the slug via specialAbilityIds.
 *   3. resolveAbility sets the three state flags (freeAttackBonusPending,
 *      pendingOverrideAttackDice with ranged type, pendingSlingBarrage) so
 *      the next attack is free, ranged, and gets the dynamic reroll bonus.
 *   4. activation-state's per-activation cleanup list includes
 *      pendingSlingBarrage so the flag cannot leak across activations.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAbilityLibrary, getDcEffects } from '../../../src/data-loader.js';
import { resolveAbility } from '../../../src/game/abilities.js';
import { _registerDcMessageMeta } from '../../../src/game/activation-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

describe('DC-CC: Ewok Warrior (Elite) — Sling Barrage wiring', () => {
  it('library entry declares slingBarrageReroll: true', () => {
    const lib = getAbilityLibrary();
    const entry = lib.abilities?.sling_barrage_ewok_elite;
    assert.ok(entry, 'sling_barrage_ewok_elite missing from library');
    assert.equal(entry.type, 'dcSpecial');
    assert.equal(entry.slingBarrageReroll, true);
  });

  it('dc-effects: Ewok Warrior (Elite) references sling_barrage_ewok_elite', () => {
    const eff = getDcEffects()?.['Ewok Warrior (Elite)'];
    assert.ok(eff, 'Ewok Warrior (Elite) missing');
    assert.ok(Array.isArray(eff.specialAbilityIds));
    assert.ok(eff.specialAbilityIds.includes('sling_barrage_ewok_elite'));
  });

  it('resolveAbility sets pendingSlingBarrage + free ranged attack for the msgId', () => {
    // Register a stub dcMessageMeta so figureKeyForActivation can resolve
    // msgId M1 → "Ewok Warrior (Elite)-1-0" (per IACP rule 2026-05-09:
    // freeAttackBonusPending is figureKey-keyed, not msgId-keyed).
    const stubMeta = new Map([['M1', { dcName: 'Ewok Warrior (Elite)', displayName: 'Ewok Warrior (Elite) [DG 1]', playerNum: 1 }]]);
    _registerDcMessageMeta(stubMeta);
    const game = {};
    const result = resolveAbility('sling_barrage_ewok_elite', { game, msgId: 'M1' });
    assert.equal(result.applied, true);
    // Per alexanbv 2026-05-13: pendingSlingBarrage is figureKey-keyed.
    assert.equal(game.pendingSlingBarrage?.['Ewok Warrior (Elite)-1-0'], true);
    assert.equal(game.freeAttackBonusPending?.['Ewok Warrior (Elite)-1-0']?.from, 'Sling Barrage');
    assert.equal(game.pendingOverrideAttackDice?.M1?.type, 'ranged');
    assert.ok(/Sling Barrage/.test(result.logMessage));
  });

  it('activation-state cleanup includes pendingSlingBarrage (no cross-activation leak)', () => {
    const src = readFileSync(resolve(ROOT, 'src/game/activation-state.js'), 'utf8');
    assert.ok(
      /['"]pendingSlingBarrage['"]/.test(src),
      'pendingSlingBarrage must appear in activation-state cleanup lists',
    );
  });
});
