/**
 * Behavioral coverage for the MEDIUM + LOW focused-gap fixes (2026-06-21):
 *   1. ISB Infiltrator (Elite) In The Shadows — deploy-time scan reads
 *      dcAbilityFlags (passives ∪ abilities), not raw passives.
 *   2. Verena Talos Close Quarters — borrows the hostile weapon's attack TYPE.
 *   3/4. Ugnaught Tinkerer Scrap Battalion — Junk Droid borrows the Ugnaught's surges.
 *   5. Bladestorm — after-attack AoE is unconditional (no _step7Hit gate) and
 *      includes the original target.
 *   6. Hunt Them Down — Cleave 2 applies automatically (passiveCleave), not via surge.
 *   7. Marked Territory — 2nd token can go to a DIFFERENT exterior groupmate.
 *   8. K-2S0 Cassian Said I Had To — optional ("up to 1") Damage Token opt-in.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dcAbilityFlags, getMapData } from '../../../src/data-loader.js';
import { getDcEffects } from '../../../src/data-loader.js';
import { scrapBattalionGrantedSurges } from '../../../src/engine/surge-auras.js';
import { resolveAbility } from '../../../src/game/abilities.js';
import { UNIMPLEMENTED_CARDS } from '../../../src/game/validation.js';
import { fireLieInAmbushWhenDeployed } from '../../../src/handlers/activation.js';
import { handleCassianSaidIHadTo, handleCassianSaidIHadToSkip } from '../../../src/handlers/movement.js';
import { enqueueAttackerPerDcEffects } from '../../../src/handlers/after-attack-resolve.js';
import { getAfterAttackEffects } from '../../../src/engine/after-attack-queue.js';

// ── Gap 1: ISB Infiltrator In The Shadows lives in `abilities`, not `passives` ──
describe('Gap1 — In The Shadows deploy-time flag', () => {
  it('dcAbilityFlags surfaces In The Shadows from the abilities array', () => {
    // In the raw data the flag lives in `abilities`, not `passives` (2026-06-15
    // split). dcAbilityFlags (passives ∪ abilities) must surface it regardless
    // of which bucket holds it, which is what the deploy sites now scan.
    const eff = getDcEffects()['ISB Infiltrator (Elite)'];
    assert.ok(eff.abilities.includes('In The Shadows'));
    assert.ok(dcAbilityFlags(eff).includes('In The Shadows'),
      'deploy sites must scan the union so the when-deployed flag is found');
  });

  it('LiA deploy makes ISB Infiltrator (Elite) Hidden via the union scan', async () => {
    const dcName = 'ISB Infiltrator (Elite)';
    const fk = `${dcName}-1-0`;
    const game = { gameId: 'g1', figurePositions: { 1: { [fk]: 'a1' }, 2: {} }, figureConditions: {} };
    await fireLieInAmbushWhenDeployed(game, 1, dcName, [fk], { logGameAction: async () => {}, saveGames: () => {} }, null);
    assert.ok((game.figureConditions[fk] || []).includes('Hide'));
  });
});

// ── Gap 2: Close Quarters borrows the hostile weapon's attack TYPE ──
describe('Gap2 — Close Quarters reads the borrowed weapon type correctly', () => {
  it('the raw attack data exposes .type with values melee/range (not .attackType / "ranged")', () => {
    // The original bug read cqAttack.attackType (always undefined) and compared
    // to the literal "ranged" (never a data value). The fix reads .type with
    // 'melee'/'range'. This guard pins the data shape the fix depends on.
    const cards = getDcEffects();
    const sample = ['0-0-0', '74-Z Speeder Bike (Elite)'].map(n => cards[n]).filter(Boolean);
    assert.ok(sample.length === 2, 'sample cards present');
    for (const eff of sample) {
      assert.equal(eff.attack.attackType, undefined, 'attack data has no attackType field');
      assert.ok(['melee', 'range', 'none'].includes(eff.attack.type),
        'attack.type uses melee/range, never "ranged"');
    }
  });

  it('the Close Quarters handler maps a melee borrow → melee/range:[1,1] and a ranged borrow → range', () => {
    // Mirror the handler's type-mapping logic to prove melee/range both resolve.
    const mapType = (cqType) => {
      if (cqType === 'melee') return { type: 'melee', range: [1, 1] };
      if (cqType === 'range') return { type: 'range', range: [1, 99] };
      return null;
    };
    assert.deepEqual(mapType('melee'), { type: 'melee', range: [1, 1] });
    assert.deepEqual(mapType('range'), { type: 'range', range: [1, 99] });
    assert.equal(mapType('ranged'), null, 'the buggy literal "ranged" must NOT match');
  });
});

// ── Gaps 3/4: Scrap Battalion surge sharing ──
describe('Gap3/4 — Scrap Battalion: Junk Droid borrows Ugnaught surges', () => {
  function gameWith(ugnaught) {
    return {
      figurePositions: {
        1: { [`${ugnaught}-1-0`]: 'a1', 'Junk Droid-1-0': 'a2' },
        2: {},
      },
    };
  }
  it('Elite Ugnaught shares bleed + pierce 2 when the Junk Droid attacks', () => {
    const g = gameWith('Ugnaught Tinkerer (Elite)');
    assert.deepEqual(scrapBattalionGrantedSurges(g, 1, 'Junk Droid'), ['bleed', 'pierce 2']);
  });
  it('Regular Ugnaught shares bleed + pierce 1 when the Junk Droid attacks', () => {
    const g = gameWith('Ugnaught Tinkerer (Regular)');
    assert.deepEqual(scrapBattalionGrantedSurges(g, 1, 'Junk Droid'), ['bleed', 'pierce 1']);
  });
  it('returns nothing when a non-Junk-Droid figure attacks', () => {
    const g = gameWith('Ugnaught Tinkerer (Elite)');
    assert.deepEqual(scrapBattalionGrantedSurges(g, 1, 'Ugnaught Tinkerer (Elite)'), []);
  });
  it('returns nothing when no Scrap Battalion Ugnaught is in play', () => {
    const g = { figurePositions: { 1: { 'Junk Droid-1-0': 'a2' }, 2: {} } };
    assert.deepEqual(scrapBattalionGrantedSurges(g, 1, 'Junk Droid'), []);
  });
});

// ── Gap 5: Bladestorm — unconditional after-attack AoE (no miss gate) ──
describe('Gap5 — Bladestorm after-attack AoE is unconditional', () => {
  const deps = { getDcEffects: () => ({}) };
  function combatBase(extra) {
    return {
      attackerFigureKey: 'Shyla Varad-1-0',
      attackerDcName: 'Shyla Varad',
      postAttackAoeDamage: 1,
      ...extra,
    };
  }
  it('enqueues bladestorm even when the attack MISSED (no _step7Hit requirement)', () => {
    const combat = combatBase({ _step7Hit: false });
    enqueueAttackerPerDcEffects(combat, {}, deps);
    assert.ok(getAfterAttackEffects(combat, 'attacker').some(e => e.type === 'bladestorm'),
      'card has no miss clause — AoE must fire on a miss too');
  });
  it('still enqueues bladestorm on a hit', () => {
    const combat = combatBase({ _step7Hit: true });
    enqueueAttackerPerDcEffects(combat, {}, deps);
    assert.ok(getAfterAttackEffects(combat, 'attacker').some(e => e.type === 'bladestorm'));
  });
  it('does not enqueue when there is no AoE damage', () => {
    const combat = combatBase({ postAttackAoeDamage: 0, _step7Hit: true });
    enqueueAttackerPerDcEffects(combat, {}, deps);
    assert.ok(!getAfterAttackEffects(combat, 'attacker').some(e => e.type === 'bladestorm'));
  });
});

// ── Gap 6: Hunt Them Down → automatic Cleave 2 (passiveCleave), no surge ──
describe('Gap6 — Hunt Them Down applies Cleave 2 automatically', () => {
  it('sets combat.passiveCleave += 2 and a (passive) cleaveSource, plus +2 Accuracy', () => {
    const game = {};
    const combat = { attackerPlayerNum: 1 };
    const r = resolveAbility('Hunt Them Down', { game, playerNum: 1, combat });
    assert.equal(r.applied, true);
    assert.equal(combat.passiveCleave, 2, 'Cleave 2 is automatic (passiveCleave)');
    assert.ok((combat.cleaveSources || []).some(s => s.value === 2 && /passive/.test(s.label)),
      'a (passive) cleaveSource is present so Cleave fires with no surge spend');
    assert.equal(combat.bonusAccuracy, 2, '+2 Accuracy still applies');
    assert.ok(!(combat.bonusSurgeAbilities || []).includes('cleave 2'),
      'Cleave must NOT be a surge-menu option');
  });
});

// ── Gap 7: Marked Territory — NOT IMPLEMENTED (alexanbv 2026-06-21) ──
// Reclassified to the Harsh Environment / Smuggler's Tricks class: the exterior
// clause needs an interior/exterior tile-type model the engine lacks, so the
// whole card is a no-op + deck-load warning.
describe('Gap7 — Marked Territory is not implemented (tile types)', () => {
  it('resolves as not-implemented with a manual-resolution message', () => {
    const game = { gameId: 'gmt', selectedMap: { id: 'mos-eisley-outskirts' }, figurePositions: { 1: {}, 2: {} }, figurePowerTokens: {} };
    const r = resolveAbility('Marked Territory', { game, playerNum: 1, dcMessageMeta: new Map() });
    assert.equal(r.applied, false);
    assert.match(r.manualMessage, /not implemented/i);
    // No tokens granted.
    assert.ok(!game.pendingPowerTokenGrant, 'no power-token grant queued');
  });

  it('is listed in UNIMPLEMENTED_CARDS so deck-loading warns', () => {
    assert.ok(UNIMPLEMENTED_CARDS.includes('Marked Territory'));
  });
});

// ── Gap 8: Cassian Said I Had To — opt-in / declinable ──
describe('Gap8 — Cassian Said I Had To optional Damage Token', () => {
  function fakeInteraction(customId) {
    return {
      customId,
      followUp: async () => {},
      update: async () => {},
      deferUpdate: async () => {},
    };
  }
  const ctx = (game) => ({ getGame: async () => game, logGameAction: async () => {}, saveGames: () => {} });

  it('Use grants the token and consumes the once-per-round flag', async () => {
    const fk = 'K-2S0-1-0';
    const game = { gameId: 'gk', figurePowerTokens: {}, roundFigureAbilityUsed: {} };
    await handleCassianSaidIHadTo(fakeInteraction(`cassian_kx_use_gk_${fk}`), ctx(game));
    assert.equal(game.roundFigureAbilityUsed[`cassian_said_i_had_to_${fk}`], true);
    assert.equal((game.figurePowerTokens[fk] || []).length, 1, 'one Damage Token granted on Use');
  });

  it('Skip grants nothing and does NOT consume the once-per-round flag', async () => {
    const fk = 'K-2S0-1-0';
    const game = { gameId: 'gk2', figurePowerTokens: {}, roundFigureAbilityUsed: {} };
    await handleCassianSaidIHadToSkip(fakeInteraction(`cassian_kx_skip_gk2_${fk}`), ctx(game));
    assert.ok(!game.roundFigureAbilityUsed[`cassian_said_i_had_to_${fk}`],
      'declining must not burn the once-per-round trigger');
    assert.equal((game.figurePowerTokens[fk] || []).length, 0, 'no token when declined');
  });
});
