/**
 * Loadout-card passives, handler injection, and combat-bridge postAttack probes.
 *
 * Closes the last `uncovered` row of the CRR heat map by pinning three distinct
 * contracts for the Imperial Loadout card family (`data/loadout-cards.json`):
 *
 *   Layer 1 — data integrity:
 *     Exactly one loadout card has a `passive`, and it is Electrostaff → Reach.
 *     Any future loadout passive trips this test and forces the author to wire
 *     engine/handler parity before merge.
 *
 *   Layer 2 — handler injection:
 *     `src/handlers/combat.js:1203-1208` pushes `loadoutCard.surgeKeys` onto
 *     `pendingCombat.bonusSurgeAbilities` and stores `loadoutCard.postAttack`
 *     on `pendingCombat.loadoutPostAttack`. A narrow shadow replicates these
 *     exact lines against the real `getLoadoutCards()` + `getConfig()` data
 *     paths, and the assertions fire per card.
 *
 *   Layer 3 — combat-bridge postAttack:
 *     `src/engine/combat-bridge.js:1454-1503` dispatches three hooks:
 *       electro_pulse   → each other figure adjacent to the target takes 1 damage
 *       quick_strike    → defender takes 1 damage if they rerolled/modified
 *       flurry_of_blows → free 1-green melee attack queued (+1 Hit)
 *     Each probe invokes the real `resolveCombatAfterRolls` pipeline and
 *     asserts the documented side effects.
 *
 *   Deferred (out of scope for this lane):
 *     - Form cards (Clawdite Streetrat/Scout) — separate family, separate row.
 *     - Imperial Loadout picker UI flow — setup-time, already handler-gated.
 *     - Engine-side Reach parity for Electrostaff — baselined by scenario 13
 *       in tests/certification/_crr-baselines.js.
 *
 * PROBE-LOADOUT-01: data-integrity oracle (passives beyond Reach → empty)
 * PROBE-LOADOUT-02: Electrostaff injection (quick_strike + [damage 1, pierce 2])
 * PROBE-LOADOUT-03: Electrohammer injection (electro_pulse + [damage 2, pierce 2])
 * PROBE-LOADOUT-04: Electrobatons injection (flurry_of_blows + [damage 1, pierce 2, deadly])
 * PROBE-LOADOUT-05: electro_pulse — adjacent figures each take 1 damage
 * PROBE-LOADOUT-06: quick_strike on defender-modified dice
 * PROBE-LOADOUT-07: flurry_of_blows queues free melee override
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTestGame } from '../../fixtures/game-builder.js';
import { getLoadoutCards } from '../../../src/data-loader.js';
import { getConfig } from '../../../src/game/figure-config.js';

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1 — Data-integrity oracle
// ─────────────────────────────────────────────────────────────────────────────

describe('PROBE-LOADOUT-01: data-integrity — passives beyond Reach is empty', () => {
  it('exactly one loadout card exposes a `passive`, and it is Electrostaff → Reach', () => {
    const cards = getLoadoutCards();
    const namesWithPassive = Object.entries(cards)
      .filter(([, c]) => c && typeof c.passive === 'string' && c.passive.length > 0)
      .map(([name, c]) => ({ name, passive: c.passive }));

    assert.strictEqual(namesWithPassive.length, 1,
      `Heat-map row assumes exactly one loadout passive today. Found ${namesWithPassive.length}: ${JSON.stringify(namesWithPassive)}. ` +
      `Any new loadout passive must come with engine-side wiring AND a new parity-scoreboard scenario in _crr-baselines.js.`);
    assert.strictEqual(namesWithPassive[0].name, 'Electrostaff',
      `The only loadout passive must remain on Electrostaff. Got: ${namesWithPassive[0].name}`);
    assert.strictEqual(namesWithPassive[0].passive, 'Reach',
      `Electrostaff's passive must remain 'Reach'. Got: ${namesWithPassive[0].passive}. ` +
      `Scenario 13 in _crr-baselines.js scores the engine gap on this specific keyword.`);
  });

  it('every loadout card carries a surgeKeys array and a postAttack hook', () => {
    // Pins the shape the handler injection layer depends on. If any future
    // card drops surgeKeys or postAttack, the injection probes below stop
    // being meaningful — this test catches that upstream.
    const cards = getLoadoutCards();
    const missing = [];
    for (const [name, c] of Object.entries(cards)) {
      if (!Array.isArray(c?.surgeKeys)) missing.push(`${name}: surgeKeys not an array`);
      if (typeof c?.postAttack !== 'string' || !c.postAttack) missing.push(`${name}: postAttack missing`);
    }
    assert.strictEqual(missing.length, 0,
      `All loadout cards must carry surgeKeys (array) + postAttack (string). Problems: ${missing.join('; ')}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 2 — Handler-injection shadow probes
// ─────────────────────────────────────────────────────────────────────────────
//
// The real handler lines we are shadowing (src/handlers/combat.js:1203-1208):
//
//   const _loadoutChoice = getConfig(game, attackerFigureKey)?.loadout;
//   if (_loadoutChoice) {
//     const _loadoutCard = getLoadoutCards()[_loadoutChoice];
//     if (_loadoutCard?.surgeKeys) game.pendingCombat.bonusSurgeAbilities.push(..._loadoutCard.surgeKeys);
//     if (_loadoutCard?.postAttack) game.pendingCombat.loadoutPostAttack = _loadoutCard.postAttack;
//   }
//
// The shadow below is a verbatim re-execution against the real data loader.
// It reads `getConfig(game, fk)` and `getLoadoutCards()` — no hardcoded
// copies of card contents. So if the card data changes shape, the shadow's
// output changes, and the probes' assertions fire.

function injectLoadoutIntoPendingCombat(game, attackerFigureKey) {
  const pendingCombat = {
    bonusSurgeAbilities: [],
    loadoutPostAttack: undefined,
  };
  const loadoutChoice = getConfig(game, attackerFigureKey)?.loadout;
  if (loadoutChoice) {
    const loadoutCard = getLoadoutCards()[loadoutChoice];
    if (loadoutCard?.surgeKeys) pendingCombat.bonusSurgeAbilities.push(...loadoutCard.surgeKeys);
    if (loadoutCard?.postAttack) pendingCombat.loadoutPostAttack = loadoutCard.postAttack;
  }
  return pendingCombat;
}

function buildLoadoutInjectionFixture(loadoutName) {
  const built = createTestGame()
    .withPlayer1Army([{ dcName: 'Purge Trooper (Elite)' }])
    .withPlayer2Army([{ dcName: 'Greedo' }])
    .inRound(1)
    .build();
  const attackerFigureKey = 'Purge Trooper (Elite)-1-0';
  built.game.figureConfig = {
    [attackerFigureKey]: { loadout: loadoutName },
  };
  return { ...built, attackerFigureKey };
}

describe('PROBE-LOADOUT-02: Electrostaff injection into pendingCombat', () => {
  it('surgeKeys=[damage 1, pierce 2] and loadoutPostAttack=quick_strike', () => {
    const { game, attackerFigureKey } = buildLoadoutInjectionFixture('Electrostaff');
    const pc = injectLoadoutIntoPendingCombat(game, attackerFigureKey);
    assert.deepStrictEqual(pc.bonusSurgeAbilities, ['damage 1', 'pierce 2'],
      `Electrostaff injection lost its surgeKeys. Got: ${JSON.stringify(pc.bonusSurgeAbilities)}`);
    assert.strictEqual(pc.loadoutPostAttack, 'quick_strike',
      `Electrostaff injection lost its postAttack hook. Got: ${pc.loadoutPostAttack}`);
  });
});

describe('PROBE-LOADOUT-03: Electrohammer injection into pendingCombat', () => {
  it('surgeKeys=[damage 2, pierce 2] and loadoutPostAttack=electro_pulse', () => {
    const { game, attackerFigureKey } = buildLoadoutInjectionFixture('Electrohammer');
    const pc = injectLoadoutIntoPendingCombat(game, attackerFigureKey);
    assert.deepStrictEqual(pc.bonusSurgeAbilities, ['damage 2', 'pierce 2'],
      `Electrohammer injection lost its surgeKeys. Got: ${JSON.stringify(pc.bonusSurgeAbilities)}`);
    assert.strictEqual(pc.loadoutPostAttack, 'electro_pulse',
      `Electrohammer injection lost its postAttack hook. Got: ${pc.loadoutPostAttack}`);
  });
});

describe('PROBE-LOADOUT-04: Electrobatons injection into pendingCombat', () => {
  it('surgeKeys=[damage 1, pierce 2, deadly] and loadoutPostAttack=flurry_of_blows', () => {
    const { game, attackerFigureKey } = buildLoadoutInjectionFixture('Electrobatons');
    const pc = injectLoadoutIntoPendingCombat(game, attackerFigureKey);
    assert.deepStrictEqual(pc.bonusSurgeAbilities, ['damage 1', 'pierce 2', 'deadly'],
      `Electrobatons injection lost its surgeKeys. Got: ${JSON.stringify(pc.bonusSurgeAbilities)}`);
    assert.strictEqual(pc.loadoutPostAttack, 'flurry_of_blows',
      `Electrobatons injection lost its postAttack hook. Got: ${pc.loadoutPostAttack}`);
  });
});

describe('PROBE-LOADOUT-02/03/04 handler source pin', () => {
  it('src/handlers/combat.js still contains the loadout injection block that the shadow mirrors', () => {
    // Catches the case where combat.js is refactored to stop reading
    // loadoutCard.surgeKeys / loadoutCard.postAttack. If the lines move,
    // update the shadow AND this pin in the same commit.
    const src = fs.readFileSync(
      new URL('../../../src/handlers/combat.js', import.meta.url),
      'utf8'
    );
    assert.match(src, /_loadoutCard\?\.surgeKeys/,
      'combat.js no longer reads loadoutCard.surgeKeys — handler-injection shadow is stale.');
    assert.match(src, /_loadoutCard\?\.postAttack/,
      'combat.js no longer reads loadoutCard.postAttack — handler-injection shadow is stale.');
    assert.match(src, /pendingCombat\.bonusSurgeAbilities\.push\(\.\.\._loadoutCard\.surgeKeys\)/,
      'combat.js no longer pushes loadout surgeKeys onto pendingCombat.bonusSurgeAbilities.');
    assert.match(src, /pendingCombat\.loadoutPostAttack = _loadoutCard\.postAttack/,
      'combat.js no longer stores loadoutCard.postAttack on pendingCombat.loadoutPostAttack.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 3 — Combat-bridge postAttack side-effect probes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal pendingCombat for resolveCombatAfterRolls with loadout-specific
 * extras. Mirrors tests/domain/oracle/combat-handler-oracles.test.js:buildCombat
 * but takes attackerDcName/defenderDcName directly so we can use Stormtroopers
 * (Elite) → Stormtroopers (Elite) for the multi-figure adjacency test.
 */
function buildLoadoutCombat(game, dcMessageMeta, opts) {
  const attackerPN = opts.attackerPlayerNum || 1;
  const defenderPN = attackerPN === 1 ? 2 : 1;

  let attackerMsgId, attackerMeta, defenderMsgId, defenderMeta;
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== game.gameId) continue;
    if (meta.playerNum === attackerPN && meta.dcName === opts.attackerDcName && !attackerMsgId) {
      attackerMsgId = msgId; attackerMeta = meta;
    }
    if (meta.playerNum === defenderPN && meta.dcName === opts.defenderDcName && !defenderMsgId) {
      defenderMsgId = msgId; defenderMeta = meta;
    }
  }

  const attackerFigKey = opts.attackerFigureKey;
  const defenderFigKey = opts.defenderFigureKey;
  const defenderFigIndex = opts.defenderFigureIndex || 0;

  return {
    gameId: game.gameId,
    attackerPlayerNum: attackerPN,
    defenderPlayerNum: defenderPN,
    attackerMsgId,
    attackerDcName: attackerMeta.dcName,
    defenderDcName: defenderMeta.dcName,
    attackerDisplayName: attackerMeta.displayName || attackerMeta.dcName,
    attackerFigureIndex: 0,
    attackerFigureKey: attackerFigKey,
    attackerConds: [],
    defenderConds: [],
    target: {
      msgId: defenderMsgId,
      figureKey: defenderFigKey,
      figureIndex: defenderFigIndex,
      label: defenderMeta.displayName || defenderMeta.dcName,
    },
    targetStats: { defense: ['black'], cost: 5, figures: 3 },
    attackInfo: { dice: ['blue', 'green'], type: opts.isRanged ? 'range' : 'melee' },
    isRanged: !!opts.isRanged,
    distanceToTarget: opts.distanceToTarget || 1,
    combatThreadId: 'oracle-loadout-thread',
    combatDeclareMsgId: 'oracle-loadout-declare',
    combatPreMsgId: 'oracle-loadout-pre',
    attackRoll: opts.attackRoll,
    defenseRoll: opts.defenseRoll,
    surgeConditions: [],
    bonusConditions: [],
    surgeDamage: 0,
    surgePierce: 0,
    surgeAccuracy: 0,
    bonusSurgeAbilities: [],
    bonusHits: 0,
    bonusPierce: 0,
    bonusAccuracy: 0,
    bonusBlock: 0,
    bonusEvade: 0,
    p1Ready: true,
    p2Ready: true,
    attackTargetMsgId: 'oracle-loadout-target',
    ...(opts.extra || {}),
  };
}

// ── PROBE-LOADOUT-05: Electro-pulse adjacency damage ──────────────────────────
//
// CRR (Electrohammer): "After you resolve an attack, each other figure
// adjacent to the target space suffers 1 Damage."
//
// Per destruct's 2026-05-06 ruling: "each other figure" excludes the
// SOURCE (the PT carrying the Electrohammer), NOT the target. The target
// itself is at distance 0 from its own space — it's "adjacent to" the
// target space and qualifies for splash. Worked example destruct gave:
// "Electro-pulse + AT-DP target — target itself takes 1 splash damage;
// PT does NOT."
//
// So: every figure within 1 space of the target space (incl. distance 0)
// takes 1 damage EXCEPT the source. The target receives both combat damage
// AND the 1 splash. Non-adjacent figures are untouched.

describe('PROBE-LOADOUT-05: electro_pulse — each other figure adjacent to target takes 1 damage', () => {
  it('source PT excluded; target takes combat + 1 splash; adjacent figures take 1 splash; non-adjacent untouched', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper (Elite)' }])
      .inRound(1)
      .build();

    // Positions on mos-eisley-outskirts row 3 (fully open):
    //   P1 attacker at c3 (SOURCE — excluded from splash)
    //   P1 fig at a3 (non-adjacent)               → unchanged
    //   P1 fig at g3 (non-adjacent)               → unchanged
    //   P2 target at d3                           → 2 combat + 1 splash = 3 dmg
    //   P2 fig at e3 (adjacent to target d3)      → 1 Electro-pulse damage
    //   P2 fig at h3 (non-adjacent)               → unchanged
    game.figurePositions = {
      1: {
        'Stormtrooper (Elite)-1-0': 'c3',
        'Stormtrooper (Elite)-1-1': 'a3',
        'Stormtrooper (Elite)-1-2': 'g3',
      },
      2: {
        'Stormtrooper (Elite)-1-0': 'd3',
        'Stormtrooper (Elite)-1-1': 'e3',
        'Stormtrooper (Elite)-1-2': 'h3',
      },
    };

    const combat = buildLoadoutCombat(game, dcMessageMeta, {
      attackerDcName: 'Stormtrooper (Elite)',
      defenderDcName: 'Stormtrooper (Elite)',
      attackerFigureKey: 'Stormtrooper (Elite)-1-0',
      defenderFigureKey: 'Stormtrooper (Elite)-1-0',
      defenderFigureIndex: 0,
      attackRoll: { acc: 4, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      extra: { loadoutPostAttack: 'electro_pulse' },
    });

    const p1MsgId = combat.attackerMsgId;
    const p2MsgId = combat.target.msgId;
    const p1HpBefore = (dcHealthState.get(p1MsgId) || []).map(([cur]) => cur);
    const p2HpBefore = (dcHealthState.get(p2MsgId) || []).map(([cur]) => cur);

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    const p1HpAfter = (dcHealthState.get(p1MsgId) || []).map(([cur]) => cur);
    const p2HpAfter = (dcHealthState.get(p2MsgId) || []).map(([cur]) => cur);

    // Attacker (P1 fig 0 at c3) is the SOURCE — excluded from splash per
    // destruct's 2026-05-06 ruling on "each other figure."
    assert.strictEqual(p1HpAfter[0], p1HpBefore[0],
      `P1 attacker at c3 is the SOURCE (PT carrying Electrohammer) — must NOT take Electro-pulse. ` +
      `Before: ${p1HpBefore[0]}, after: ${p1HpAfter[0]}`);
    // P1 figs at a3 and g3 are not adjacent — untouched.
    assert.strictEqual(p1HpAfter[1], p1HpBefore[1],
      `P1 fig at a3 (non-adjacent) must NOT take Electro-pulse damage. ` +
      `Before: ${p1HpBefore[1]}, after: ${p1HpAfter[1]}`);
    assert.strictEqual(p1HpAfter[2], p1HpBefore[2],
      `P1 fig at g3 (non-adjacent) must NOT take Electro-pulse damage. ` +
      `Before: ${p1HpBefore[2]}, after: ${p1HpAfter[2]}`);
    // P2 target at d3: combat damage (2 = 3 dmg - 1 block) PLUS 1 splash
    // because the target is at distance 0 from the target space and "each
    // other figure adjacent to the target space" includes it (excludes the
    // SOURCE, not the target). Total = 3 HP lost.
    assert.strictEqual(p2HpAfter[0], p2HpBefore[0] - 3,
      `P2 target at d3 must take 2 combat + 1 Electro-pulse splash = 3 HP. ` +
      `Before: ${p2HpBefore[0]}, after: ${p2HpAfter[0]}`);
    // P2 fig 1 at e3 is adjacent to target → 1 Electro-pulse damage.
    assert.strictEqual(p2HpAfter[1], p2HpBefore[1] - 1,
      `P2 fig at e3 (adjacent to target) must lose 1 HP from Electro-pulse. ` +
      `Before: ${p2HpBefore[1]}, after: ${p2HpAfter[1]}`);
    // P2 fig 2 at h3 is not adjacent — untouched.
    assert.strictEqual(p2HpAfter[2], p2HpBefore[2],
      `P2 fig at h3 (non-adjacent) must NOT take Electro-pulse damage. ` +
      `Before: ${p2HpBefore[2]}, after: ${p2HpAfter[2]}`);
  });
});

// ── PROBE-LOADOUT-06: Quick Strike on defender modification ──────────────────

describe('PROBE-LOADOUT-06: quick_strike — defender modified dice → 1 damage', () => {
  it('defenderRerolledOrModified=true on a hit deals 1 Quick Strike damage', async () => {
    // Melee attack from Stormtrooper (Elite) onto Stormtrooper (Elite) target.
    // Attack lands for 2 damage (3 dmg - 1 block). Quick Strike adds 1 more.
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper (Elite)' }])
      .inRound(1)
      .build();

    game.figurePositions = {
      1: { 'Stormtrooper (Elite)-1-0': 'c3' },
      2: { 'Stormtrooper (Elite)-1-0': 'd3' },
    };

    const combat = buildLoadoutCombat(game, dcMessageMeta, {
      attackerDcName: 'Stormtrooper (Elite)',
      defenderDcName: 'Stormtrooper (Elite)',
      attackerFigureKey: 'Stormtrooper (Elite)-1-0',
      defenderFigureKey: 'Stormtrooper (Elite)-1-0',
      attackRoll: { acc: 4, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      extra: {
        loadoutPostAttack: 'quick_strike',
        defenderRerolledOrModified: true,
      },
    });

    const p2MsgId = combat.target.msgId;
    const p2HpBefore = (dcHealthState.get(p2MsgId) || [])[0]?.[0];

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    const p2HpAfter = (dcHealthState.get(p2MsgId) || [])[0]?.[0];
    assert.strictEqual(p2HpAfter, p2HpBefore - 3,
      `Defender must take 2 combat damage + 1 Quick Strike damage (= 3 total). ` +
      `Before: ${p2HpBefore}, after: ${p2HpAfter}`);
  });

  it('defenderRerolledOrModified=false does NOT trigger Quick Strike', async () => {
    // Control scenario: same combat math, but defender did not modify.
    // Expected: only 2 combat damage, no bonus.
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper (Elite)' }])
      .inRound(1)
      .build();

    game.figurePositions = {
      1: { 'Stormtrooper (Elite)-1-0': 'c3' },
      2: { 'Stormtrooper (Elite)-1-0': 'd3' },
    };

    const combat = buildLoadoutCombat(game, dcMessageMeta, {
      attackerDcName: 'Stormtrooper (Elite)',
      defenderDcName: 'Stormtrooper (Elite)',
      attackerFigureKey: 'Stormtrooper (Elite)-1-0',
      defenderFigureKey: 'Stormtrooper (Elite)-1-0',
      attackRoll: { acc: 4, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      extra: {
        loadoutPostAttack: 'quick_strike',
        defenderRerolledOrModified: false,
      },
    });

    const p2MsgId = combat.target.msgId;
    const p2HpBefore = (dcHealthState.get(p2MsgId) || [])[0]?.[0];

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    const p2HpAfter = (dcHealthState.get(p2MsgId) || [])[0]?.[0];
    assert.strictEqual(p2HpAfter, p2HpBefore - 2,
      `Defender must take only 2 combat damage (no Quick Strike). ` +
      `Before: ${p2HpBefore}, after: ${p2HpAfter}`);
  });
});

// ── PROBE-LOADOUT-07: Flurry of Blows free melee queue ────────────────────────

describe('PROBE-LOADOUT-07: flurry_of_blows — free melee override queued on hit', () => {
  it('hit with loadoutPostAttack=flurry_of_blows queues a 1-green melee with +1 Hit', async () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper (Elite)' }])
      .inRound(1)
      .build();

    game.figurePositions = {
      1: { 'Stormtrooper (Elite)-1-0': 'c3' },
      2: { 'Stormtrooper (Elite)-1-0': 'd3' },
    };

    const combat = buildLoadoutCombat(game, dcMessageMeta, {
      attackerDcName: 'Stormtrooper (Elite)',
      defenderDcName: 'Stormtrooper (Elite)',
      attackerFigureKey: 'Stormtrooper (Elite)-1-0',
      defenderFigureKey: 'Stormtrooper (Elite)-1-0',
      attackRoll: { acc: 4, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      extra: { loadoutPostAttack: 'flurry_of_blows' },
    });

    const attackerMsgId = combat.attackerMsgId;

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    // Flurry queues a free melee attack with 1 green die + 1 bonus hit.
    const override = game.pendingOverrideAttackDice?.[attackerMsgId];
    assert.ok(override, `flurry_of_blows must queue pendingOverrideAttackDice for attacker msgId=${attackerMsgId}. ` +
      `Got: ${JSON.stringify(game.pendingOverrideAttackDice)}`);
    assert.deepStrictEqual(override.dice, ['green'],
      `Flurry override must specify dice=['green']. Got: ${JSON.stringify(override.dice)}`);
    assert.strictEqual(override.type, 'melee',
      `Flurry override must specify type='melee'. Got: ${override.type}`);
    assert.strictEqual(override.bonusHits, 1,
      `Flurry override must specify bonusHits=1. Got: ${override.bonusHits}`);
    // Flurry also grants the free-attack window bonus so the attack does not
    // consume an action. Per IACP rule 2026-05-09, freeAttackBonusPending is
    // keyed by attackerFigureKey (per-figure scope, not per-group).
    const _attFk = combat.attackerFigureKey;
    assert.ok(game.freeAttackBonusPending?.[_attFk],
      `flurry_of_blows must set freeAttackBonusPending[${_attFk}] so the follow-up attack is free.`);
    // Once-per-activation lock.
    assert.ok(game.roundFigureAbilityUsed?.[`flurryOfBlows_${attackerMsgId}`],
      `flurry_of_blows must mark roundFigureAbilityUsed[flurryOfBlows_${attackerMsgId}] = true to block repeats.`);
  });

  it('second flurry in the same activation is blocked by roundFigureAbilityUsed', async () => {
    // Resolve an attack where the attacker already has the once-per-activation
    // flag set. The second resolution must not re-queue pendingOverrideAttackDice.
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper (Elite)' }])
      .inRound(1)
      .build();

    game.figurePositions = {
      1: { 'Stormtrooper (Elite)-1-0': 'c3' },
      2: { 'Stormtrooper (Elite)-1-0': 'd3' },
    };

    const combat = buildLoadoutCombat(game, dcMessageMeta, {
      attackerDcName: 'Stormtrooper (Elite)',
      defenderDcName: 'Stormtrooper (Elite)',
      attackerFigureKey: 'Stormtrooper (Elite)-1-0',
      defenderFigureKey: 'Stormtrooper (Elite)-1-0',
      attackRoll: { acc: 4, dmg: 3, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      extra: { loadoutPostAttack: 'flurry_of_blows' },
    });

    const attackerMsgId = combat.attackerMsgId;
    game.roundFigureAbilityUsed = { [`flurryOfBlows_${attackerMsgId}`]: true };

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    // No fresh pendingOverrideAttackDice entry should be created.
    assert.strictEqual(game.pendingOverrideAttackDice?.[attackerMsgId], undefined,
      `flurry_of_blows must not re-queue pendingOverrideAttackDice when the ` +
      `once-per-activation flag is already set. Got: ${JSON.stringify(game.pendingOverrideAttackDice)}`);
  });
});
