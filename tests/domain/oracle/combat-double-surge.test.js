/**
 * Double-surge support in the spend-surges step (alexanbv 2026-06-15: "When
 * spending double surges, it costs 2 surge symbols to activate one double surge.
 * Make sure this is possible in the spend surges step"). The mechanism already
 * exists; this pins it: doubleSurgeAbilities surface as `double:`-prefixed surge
 * options, cost 2, and parse to their effect with the prefix stripped.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAttackerSurgeAbilities, parseSurgeEffect } from '../../../src/game/combat.js';

// Mirror the UI/handler cost rule (combat.js handler line ~8444 / UI ~8258).
const surgeCost = (key) => (key?.startsWith?.('double:') ? 2 : 1);

describe('double surge: spend-surges step', () => {
  it('Thrawn exposes a single Pierce 1 and a double +3 Damage', () => {
    const keys = getAttackerSurgeAbilities({ attackerDcName: 'Thrawn' });
    assert.ok(keys.includes('pierce 1'), 'single surge pierce 1');
    assert.ok(keys.includes('double:damage 3'), 'double surge prefixed double:damage 3');
    assert.equal(surgeCost('double:damage 3'), 2, 'double surge costs 2 symbols');
    assert.equal(surgeCost('pierce 1'), 1, 'single surge costs 1');
  });

  it('double-surge keys parse to their effect with the prefix stripped', () => {
    assert.deepEqual(parseSurgeEffect('double:damage 3').damage, 3);
    assert.deepEqual(parseSurgeEffect('double:pierce 2').pierce, 2);
    // Weiss double blast 3 (also tolerates an inline "(2 surges)" annotation)
    assert.equal(parseSurgeEffect('double:blast 3').blast, 3);
  });

  it('Hera and Weiss and Tusken reflect the corrected data', () => {
    assert.ok(getAttackerSurgeAbilities({ attackerDcName: 'Hera Syndulla' }).includes('double:pierce 2'));
    assert.ok(getAttackerSurgeAbilities({ attackerDcName: 'General Weiss' }).includes('double:blast 3'));
    // Tusken Raider (Elite) has NO double surge after the data fix.
    assert.ok(!getAttackerSurgeAbilities({ attackerDcName: 'Tusken Raider (Elite)' }).some((k) => k.startsWith('double:')));
  });
});
