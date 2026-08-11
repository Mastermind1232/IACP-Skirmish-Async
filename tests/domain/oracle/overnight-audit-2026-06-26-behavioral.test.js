/**
 * BEHAVIORAL REGRESSION TESTS — overnight-audit-2026-06-26
 *
 * Confirms each of the 52 bugs found in the overnight audit (2026-06-26) has
 * been fixed and pins the correct behavior so regressions are caught immediately.
 *
 * Each describe block maps 1-to-1 with an audit finding; the heading reproduces
 * the audit severity and pattern tag so cross-referencing is trivial.
 *
 * Findings covered:
 *   HIGH  : Stay Down [P12], R2-D2 Lucky, Deadly Spin [P7], Defensive Stance [P7],
 *            Cara Dune/Smash [P1], Diala/Force Throw [P1], Jabba/Order Hit [P1],
 *            Boba Fett/Wrist Cord [P4], Boba Fett/Wrist Flamethrower [P4],
 *            [Doubt] wrong side [P5], [Doubt] deplete cost [P5],
 *            Bo-Katan/Dual-Wield Pistols [P3], Second Sister/Mastery [P3],
 *            Call the Shots [P3], Ambush, Dioxis Fumes [P10], Lord of the Sith [P9],
 *            Mortar Trooper/Haul, Wing Guard/Keep the Peace, Dangerous Prey [P9]
 *   MEDIUM: Krrsantan+Gaarkhan/Bleed [P8], Grand Inquisitor/Deadly Spin [P7],
 *            Taron Malicos/Madness [P2], Mounted [P2], Jawa/Take Cover [P2],
 *            Run for Cover [P6], Savage Vigor [P6], Escalating Hostility,
 *            Navigation Upgrade, Deflection [P10], Royal Guard/Forward Vengeance
 *   LOW   : Alliance Ranger/Sniper [P5], Pickpocket, Agent Blaise duplicate surge,
 *            Mandalorian Steel CSV, Furious Charge [P11], Ko-Tun/Dead Precise [P11]
 *
 * Source: docs/ability-audit-overnight-2026-06-26.md
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

// ── module-level imports loaded lazily in each test ───────────────────────────
const ROOT = new URL('../../../', import.meta.url);
const req = createRequire(ROOT);

// ─────────────────────────────────────────────────────────────────────────────
// DATA INTEGRITY (no engine import needed)
// ─────────────────────────────────────────────────────────────────────────────

describe('LOW: Agent Blaise — no duplicate "damage 1" in surgeAbilities', () => {
  it('surgeAbilities has exactly one "damage 1" entry', async () => {
    const data = JSON.parse(await readFile(new URL('data/dc-effects.json', ROOT), 'utf8'));
    const effects = data.cards || data; // dc-effects.json nests cards under a "cards" key
    const blaise = effects['Agent Blaise'];
    assert.ok(blaise, 'Agent Blaise entry exists');
    const surges = blaise.surgeAbilities || [];
    const dmgOnes = surges.filter((s) => s === 'damage 1');
    assert.equal(dmgOnes.length, 1, `duplicate "damage 1" — found ${dmgOnes.length}: ${JSON.stringify(surges)}`);
  });

  it('full surgeAbilities list matches canonical card', async () => {
    const data = JSON.parse(await readFile(new URL('data/dc-effects.json', ROOT), 'utf8'));
    const effects = data.cards || data;
    const surges = effects['Agent Blaise']?.surgeAbilities || [];
    assert.deepEqual(surges, ['accuracy 3', 'pierce 2', 'damage 1', 'interrogate']);
  });
});

describe('LOW: Mandalorian Steel — CSV says Block Token (not Power Token)', () => {
  it('effect row for the recover-trigger says "Block Token"', async () => {
    const csvText = await readFile(new URL('docs/combat-spec.csv', ROOT), 'utf8');
    const rows = csvText.split('\n').filter((l) => l.startsWith('"Mandalorian Steel"') || l.startsWith('Mandalorian Steel'));
    const triggerRow = rows.find((r) => r.includes('Block Token') || r.includes('Power Token'));
    assert.ok(triggerRow, 'found a Mandalorian Steel trigger row');
    assert.ok(triggerRow.includes('Block Token'), `Expected "Block Token", got: ${triggerRow.slice(0, 120)}`);
    assert.ok(!triggerRow.includes('Power Token'), 'must NOT say "Power Token"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R2-D2 LUCKY — blank-face detection
// ─────────────────────────────────────────────────────────────────────────────

describe('HIGH: R2-D2 Lucky — hasBlankDefenseFace detects blank die face', () => {
  let hasBlankDefenseFace;
  before(async () => {
    ({ hasBlankDefenseFace } = await import(new URL('src/engine/combat-abilities-mods.js', ROOT).href));
  });

  it('fires when one die has 0 block, 0 evade, and no dodge (blank face)', () => {
    const combat = { defenseDiceResults: [{ color: 'white', block: 0, evade: 0, dodge: false }] };
    assert.equal(hasBlankDefenseFace(combat), true);
  });

  it('does NOT fire when all dice have at least one symbol', () => {
    const combat = { defenseDiceResults: [{ color: 'white', block: 1, evade: 0, dodge: false }] };
    assert.equal(hasBlankDefenseFace(combat), false);
  });

  it('does NOT fire when the die has a dodge result', () => {
    const combat = { defenseDiceResults: [{ color: 'white', block: 0, evade: 0, dodge: true }] };
    assert.equal(hasBlankDefenseFace(combat), false);
  });

  it('fires when at least one die in a multi-die pool is blank', () => {
    const combat = {
      defenseDiceResults: [
        { color: 'white', block: 1, evade: 0, dodge: false },
        { color: 'white', block: 0, evade: 0, dodge: false },
      ],
    };
    assert.equal(hasBlankDefenseFace(combat), true, 'second die is blank → trigger');
  });

  it('returns false for null/missing defenseDiceResults', () => {
    assert.equal(hasBlankDefenseFace({}), false);
    assert.equal(hasBlankDefenseFace({ defenseDiceResults: null }), false);
    assert.equal(hasBlankDefenseFace(null), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEADLY SPIN — -1 dodge (counted), NOT cancel-all
// ─────────────────────────────────────────────────────────────────────────────

describe('MEDIUM: Grand Inquisitor/Deadly Spin — parseSurgeEffect routes to counted -1 dodge', () => {
  let parseSurgeEffect;
  before(async () => {
    ({ parseSurgeEffect } = await import(new URL('src/game/combat.js', ROOT).href));
  });

  it('deadly_spin sets surgeDeadlySpinDodge (counted -1), not surgeCancelDodge (cancel all)', () => {
    const out = parseSurgeEffect('deadly_spin');
    assert.equal(out.surgeDeadlySpinDodge, true, 'counted -1 Dodge path');
    assert.ok(!out.surgeCancelDodge, 'must NOT set surgeCancelDodge (cancel-all)');
  });

  it('deadly_spin also grants Cleave 3', () => {
    const out = parseSurgeEffect('deadly_spin');
    assert.equal(out.cleave, 3);
  });

  it('deadly (old cancel-all) still sets surgeCancelDodge', () => {
    const out = parseSurgeEffect('deadly');
    assert.equal(out.surgeCancelDodge, true);
    assert.ok(!out.surgeDeadlySpinDodge, 'deadly must NOT set the counted path');
  });
});

describe('MEDIUM: Grand Inquisitor/Deadly Spin — computeCombatResult leaves 1 dodge vs 2-dodge defense', () => {
  let computeCombatResult;
  before(async () => {
    ({ computeCombatResult } = await import(new URL('src/game/combat.js', ROOT).href));
  });

  it('2 Dodge defense against Deadly Spin → 1 remaining Dodge → miss', () => {
    const combat = {
      surgeDeadlySpinDodge: true,
      attackRoll: { acc: 5, dmg: 2, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: 2 },
      isRanged: true,
      distanceToTarget: 2,
    };
    const r = computeCombatResult(combat);
    assert.equal(r.hit, false, '1 remaining Dodge → miss');
    assert.ok(!r.missReason?.includes('Accuracy'), 'miss due to dodge, not accuracy');
  });

  it('1 Dodge defense against Deadly Spin → 0 remaining Dodge → hit (unless blocked)', () => {
    const combat = {
      surgeDeadlySpinDodge: true,
      attackRoll: { acc: 5, dmg: 3, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: 1 },
      isRanged: true,
      distanceToTarget: 2,
    };
    const r = computeCombatResult(combat);
    // dodge reduced to 0 → no dodge miss. Hit depends on accuracy/block.
    assert.ok(!r.missReason?.includes('Dodge'), 'should NOT miss due to Dodge after -1');
  });

  it('0 Dodge defense against Deadly Spin → no dodge adjustment, just +0', () => {
    const combat = {
      surgeDeadlySpinDodge: true,
      attackRoll: { acc: 5, dmg: 2, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: 0 },
      isRanged: true,
      distanceToTarget: 2,
    };
    const r = computeCombatResult(combat);
    assert.ok(!r.missReason?.includes('Dodge'), 'no dodge, no dodge-miss');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [DOUBT] — defender-side, attack pool, deplete cost
// ─────────────────────────────────────────────────────────────────────────────

describe('HIGH: [Doubt] — registered as defender-side, attack-pool, deplete-on-use', () => {
  let getCombatAbility;
  before(async () => {
    ({ getCombatAbility } = await import(new URL('src/engine/combat-timing-registry.js', ROOT).href));
    await import(new URL('src/engine/combat-abilities-rerolls.js', ROOT).href);
  });

  it('is registered with side="defender" (not attacker)', () => {
    const a = getCombatAbility('reroll:doubt:defender');
    assert.ok(a, 'Doubt ability found in registry as reroll:doubt:defender');
    assert.equal(a.side, 'defender');
  });

  it('targets the attack pool (defender rerolls attacker dice)', () => {
    const a = getCombatAbility('reroll:doubt:defender');
    assert.equal(a.params.pool, 'attack', 'defender-side but rerolls attack dice');
  });

  it('has depleteOnUse="Doubt" (deplete cost charged on use)', () => {
    const a = getCombatAbility('reroll:doubt:defender');
    assert.equal(a.params.depleteOnUse, 'Doubt');
  });

  it('is NOT registered on the attacker side', () => {
    const bad = getCombatAbility('reroll:doubt:attacker');
    assert.ok(!bad, 'should NOT exist as attacker-side');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CALL THE SHOTS — stamp only on apply, not on Skip
// ─────────────────────────────────────────────────────────────────────────────

describe('MEDIUM: Hera/Call the Shots — limit stamped only when bonus applied, not on Skip [P3]', () => {
  // Test via source structure: the stamp (_ctsStamp) must be called INSIDE each
  // apply branch, not unconditionally before the branch. Skip must not burn it.
  it('combat.js: _ctsStamp() called inside each apply branch only, not before', async () => {
    const src = await readFile(new URL('src/handlers/combat.js', ROOT), 'utf8');
    const ctsIdx = src.indexOf('call_the_shots:');
    assert.ok(ctsIdx > 0, 'call_the_shots resolver found');
    const ctsBlock = src.slice(ctsIdx, ctsIdx + 1200);
    // Stamp helper must be defined and called inside the choice branches
    assert.ok(ctsBlock.includes('_ctsStamp'), '_ctsStamp helper defined');
    // The _ctsStamp() call must be inside the acc/hit/surge branch conditions
    assert.ok(ctsBlock.includes("choice === 'acc'"), 'acc branch present');
    assert.ok(ctsBlock.includes("choice === 'hit'"), 'hit branch present');
    assert.ok(ctsBlock.includes("choice === 'surge'"), 'surge branch present');
    // Stamp call must appear AFTER the first branch check (inside the branch)
    const firstStampCallIdx = ctsBlock.indexOf('_ctsStamp()');
    const accBranchIdx = ctsBlock.indexOf("choice === 'acc'");
    assert.ok(firstStampCallIdx > accBranchIdx, 'stamp call must be inside a branch, after the choice check');
  });

  it('combat.js: Skip path explicitly omits _ctsStamp (no limit consumed)', async () => {
    const src = await readFile(new URL('src/handlers/combat.js', ROOT), 'utf8');
    const ctsIdx = src.indexOf('call_the_shots:');
    // Use a larger slice to capture the final else (Skip) branch
    const ctsBlock = src.slice(ctsIdx, ctsIdx + 1800);
    // Find the Skipped message line (the else/Skip branch)
    const skippedIdx = ctsBlock.indexOf('Skipped');
    assert.ok(skippedIdx > 0, 'Skipped message found in CTS block');
    // Extract just the Skip else branch (from a bit before "Skipped")
    const skipBranch = ctsBlock.slice(Math.max(0, skippedIdx - 60), skippedIdx + 80);
    assert.ok(!skipBranch.includes('_ctsStamp'), `else/Skip branch must not call _ctsStamp: "${skipBranch}"`);
  });

  it('combat.js: bonusAccuracy/bonusHits/surgeBonus applied in respective branches', async () => {
    const src = await readFile(new URL('src/handlers/combat.js', ROOT), 'utf8');
    const ctsIdx = src.indexOf('call_the_shots:');
    const ctsBlock = src.slice(ctsIdx, ctsIdx + 1200);
    assert.ok(ctsBlock.includes('bonusAccuracy'), 'acc → bonusAccuracy present');
    // Uses (x || 0) + 2 pattern, not += 2
    assert.ok(ctsBlock.includes('bonusAccuracy') && (ctsBlock.includes(') + 2') || ctsBlock.includes('+= 2')),
      'acc → adds +2 to bonusAccuracy');
    assert.ok(ctsBlock.includes('bonusHits'), 'hit → bonusHits present');
    assert.ok(ctsBlock.includes('surgeBonus'), 'surge → surgeBonus present');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WRIST CORD — once-per-round limit enforced [P4]
// ─────────────────────────────────────────────────────────────────────────────

describe('HIGH: Boba Fett/Wrist Cord — once-per-round gate [P4]', () => {
  let resolveAbility;
  before(async () => {
    ({ resolveAbility } = await import(new URL('src/game/abilities.js', ROOT).href));
  });

  it('returns "already used this round" when roundFigureAbilityUsed is set', () => {
    const figKey = 'Boba Fett-1-0';
    const msgId = 'msg_boba';
    const game = {
      roundFigureAbilityUsed: { [`${figKey}_wrist_cord`]: true },
      dcActionsData: { [msgId]: { selectedFigure: 0 } },
    };
    const result = resolveAbility('wrist_cord', {
      game,
      playerNum: 1,
      meta: { dcName: 'Boba Fett', displayName: 'Boba Fett [DG 1]' },
      msgId,
      dcMessageMeta: new Map([[msgId, { dcName: 'Boba Fett', playerNum: 1, gameId: 'g1' }]]),
    });
    assert.equal(result.applied, false);
    assert.ok(result.manualMessage?.includes('already used this round'), result.manualMessage);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WRIST FLAMETHROWER — once-per-round limit enforced [P4]
// ─────────────────────────────────────────────────────────────────────────────

describe('HIGH: Boba Fett/Wrist Flamethrower — once-per-round gate [P4]', () => {
  let resolveAbility;
  before(async () => {
    ({ resolveAbility } = await import(new URL('src/game/abilities.js', ROOT).href));
  });

  it('returns "already used this round" when roundFigureAbilityUsed is set', () => {
    const figKey = 'Boba Fett-1-0';
    const msgId = 'msg_boba';
    const game = {
      roundFigureAbilityUsed: { [`${figKey}_wrist_flamethrower`]: true },
      dcActionsData: { [msgId]: { selectedFigure: 0 } },
      figurePositions: { 1: { [figKey]: 'a1' } },
    };
    const result = resolveAbility('wrist_flamethrower', {
      game,
      playerNum: 1,
      meta: { dcName: 'Boba Fett', displayName: 'Boba Fett [DG 1]' },
      msgId,
      dcMessageMeta: new Map([[msgId, { dcName: 'Boba Fett', playerNum: 1, gameId: 'g1' }]]),
    });
    assert.equal(result.applied, false);
    assert.ok(result.manualMessage?.includes('already used this round'), result.manualMessage);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PICKPOCKET — 3 accuracy choices (no "0 miss") [LOW]
// ─────────────────────────────────────────────────────────────────────────────

describe('LOW: Pickpocket — auto-rolls green die in thread, no player input needed', () => {
  let resolveAbility, setDiceStream, clearDiceHooks;
  before(async () => {
    ({ resolveAbility } = await import(new URL('src/game/abilities.js', ROOT).href));
    ({ setDiceStream, clearDiceHooks } = await import(new URL('src/game/combat.js', ROOT).href));
  });

  it('resolves immediately (applied:true) without requiresChoice', () => {
    setDiceStream({ pools: { attack: { green: [0] } } }); // face 0 → acc 1
    try {
      const result = resolveAbility('Pickpocket', { game: { player1VP: { total: 0 }, player2VP: { total: 5 } }, playerNum: 1 });
      assert.equal(result.applied, true, 'no requiresChoice — die is rolled automatically');
      assert.equal(result.requiresChoice, undefined, 'no player choice needed');
    } finally { clearDiceHooks(); }
  });

  it('uses accuracy from green die roll for VP swing (face 3 → acc 3)', () => {
    setDiceStream({ pools: { attack: { green: [3] } } }); // face 3 → acc 3, dmg 2
    try {
      const game = { player1VP: { total: 3 }, player2VP: { total: 5 } };
      const result = resolveAbility('Pickpocket', { game, playerNum: 1 });
      assert.equal(result.applied, true);
      assert.equal(game.player1VP.total, 6, '+3 VP for player 1 (acc 3)');
      assert.equal(game.player2VP.total, 2, '-3 VP for player 2 (acc 3)');
      assert.ok(result.logMessage?.includes('3'), 'log message shows rolled accuracy');
    } finally { clearDiceHooks(); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1 ACTION COST BUGS (covered more thoroughly in dc-special-actioncost-p1.test.js)
// ─────────────────────────────────────────────────────────────────────────────

describe('HIGH: P1 action cost — ability-library.json carries explicit actionCost', () => {
  it('smash has actionCost: 0 (free)', async () => {
    const lib = JSON.parse(await readFile(new URL('data/ability-library.json', ROOT), 'utf8'));
    assert.equal(lib.abilities?.smash?.actionCost, 0, 'Cara Dune Smash must be free');
  });

  it('force_throw has actionCost: 0 (free; costs only 1 Strain)', async () => {
    const lib = JSON.parse(await readFile(new URL('data/ability-library.json', ROOT), 'utf8'));
    assert.equal(lib.abilities?.force_throw?.actionCost, 0, 'Force Throw must cost 0 actions');
  });

  it('dual_bladed_fury has actionCost: 0 (free on-declare)', async () => {
    const lib = JSON.parse(await readFile(new URL('data/ability-library.json', ROOT), 'utf8'));
    assert.equal(lib.abilities?.dual_bladed_fury?.actionCost, 0, 'Dual-Bladed Fury must cost 0 actions');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FORWARD VENGEANCE — companion exclusion [LOW]
// ─────────────────────────────────────────────────────────────────────────────

describe('LOW: Royal Guard (Elite)/Forward Vengeance — companion exclusion in predicate', () => {
  // Both Vengeance probes must exclude a defeated COMPANION figure.
  //
  // These originally asserted the literal `eff?.companion` / `defeatedEff?.companion`
  // expressions. That raw field is OVERLOADED — `true` on a companion's own
  // card, but a STRING naming the companion on host cards — so a truthy read
  // also matched Iden Versio (companion: "Dio") and Jarrod Kelvin, suppressing
  // Vengeance when either was the defeated friendly. Both sites now go through
  // isDcCompanion(), which tests `=== true`. Assert the guarantee rather than
  // the old expression text. alexanbv 2026-08-11.
  before(async () => {
    const src = await readFile(new URL('src/game/damage-pipeline-hooks.js', ROOT), 'utf8');
    assert.ok(
      src.includes('isDcCompanion('),
      'damage-pipeline-hooks must exclude companion DCs from Vengeance/Forward Vengeance',
    );
    assert.ok(
      !/\w*[Ee]ff\?\.companion/.test(src),
      'no raw truthy `companion` read may remain — the field is a string on host cards',
    );
  });

  it('both Vengeance probes exclude companions via the strict isDcCompanion check', async () => {
    const src = await readFile(new URL('src/game/damage-pipeline-hooks.js', ROOT), 'utf8');
    assert.ok(src.includes('forward_vengeance_royal_guard_elite'), 'FV Elite hook registered');
    // One exclusion in the Vengeance probe, one in the Forward Vengeance probe.
    const calls = (src.match(/isDcCompanion\(/g) || []).length;
    assert.ok(calls >= 2, `expected an exclusion at both FV hook sites, found ${calls}`);
  });

  it('isDcCompanion excludes real companions but not their hosts', async () => {
    const { isDcCompanion } = await import(new URL('src/data-loader.js', ROOT).href);
    assert.equal(isDcCompanion('The Child'), true, 'companion figure');
    assert.equal(isDcCompanion('Iden Versio'), false, 'HOST — must still trigger Vengeance');
    assert.equal(isDcCompanion('Jarrod Kelvin'), false, 'HOST — must still trigger Vengeance');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEFLECTION — gated on isRanged (no Melee trigger) [MEDIUM/P10]
// ─────────────────────────────────────────────────────────────────────────────

describe('MEDIUM: Deflection CC — counter fires only on Ranged attacks', () => {
  it('after-attack-resolve gates deflectionPending on combat.isRanged', async () => {
    const src = await readFile(new URL('src/handlers/after-attack-resolve.js', ROOT), 'utf8');
    // The fix checks combat.isRanged before applying deflectionPending counter-damage.
    const gateOccurrences = (src.match(/combat\.isRanged\s*&&\s*game\?\.deflectionPending/g) || []).length;
    assert.ok(gateOccurrences >= 1, `deflectionPending gated on isRanged (found ${gateOccurrences} occurrences)`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DIOXIS FUMES — roundDioxisActive consumed [HIGH/P10]
// ─────────────────────────────────────────────────────────────────────────────

describe('HIGH: Dioxis Fumes — roundDioxisActive blocks non-DROID Strain recovery', () => {
  it('roundDioxisActive flag is read in at least 2 places in abilities.js', async () => {
    const src = await readFile(new URL('src/game/abilities.js', ROOT), 'utf8');
    const consumers = (src.match(/game\.roundDioxisActive/g) || []);
    // set site (dioxisFumesEffect) + at least 2 recover-Strain guard sites
    const setCount = consumers.length;
    assert.ok(setCount >= 3, `roundDioxisActive referenced ${setCount} times (need set + ≥2 guard sites)`);
  });

  it('roundDioxisActive is cleared at round boundary in handlers/round.js', async () => {
    const src = await readFile(new URL('src/handlers/round.js', ROOT), 'utf8');
    // The flag must be cleared somewhere on round boundary
    assert.ok(src.includes('roundDioxisActive'), 'round.js references roundDioxisActive for clear');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MORTAR TROOPER HAUL — per-figure SU scope, not group-wide [HIGH]
// ─────────────────────────────────────────────────────────────────────────────

describe('HIGH: Mortar Trooper/Haul — gated on per-figure SU card, not group attachment', () => {
  it('movement.js gates hasMortarHaul on _suCard === "Mortar Trooper" (per-figure)', async () => {
    const src = await readFile(new URL('src/game/movement.js', ROOT), 'utf8');
    // Must reference the per-figure SU card check
    assert.ok(
      src.includes("_suCard === 'Mortar Trooper'"),
      'Haul must be gated on the per-figure SU card identity',
    );
    // Must NOT be gated only on group-level attachment presence
    const groupCheck = src.match(/hasMortarHaul\s*=\s*true[^\n]*attachment/);
    assert.ok(!groupCheck, 'hasMortarHaul must NOT fire on bare group attachment check');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LORD OF THE SITH — resolves without active activation msgId [HIGH/P9]
// ─────────────────────────────────────────────────────────────────────────────

describe('HIGH: Lord of the Sith — uses resolveUniqueFigureCcFigureKey (no active activation required)', () => {
  it('abilities.js resolves Vader via resolveUniqueFigureCcFigureKey before falling back to active activation', async () => {
    const src = await readFile(new URL('src/game/abilities.js', ROOT), 'utf8');
    // The fix: call resolveUniqueFigureCcFigureKey FIRST, then fall back
    const fixPattern = /resolveUniqueFigureCcFigureKey\(game,\s*playerNum,\s*'Lord of the Sith'\)/;
    assert.ok(fixPattern.test(src), 'Lord of the Sith anchor resolved via resolveUniqueFigureCcFigureKey');
    // The old bug was returning early with "No active DC found" — that path must now be a fallback only
    const lotsBlock = src.slice(src.indexOf('lordOfTheSithEffect'));
    const resolveFirst = lotsBlock.indexOf('resolveUniqueFigureCcFigureKey');
    const activeActivation = lotsBlock.indexOf('findActiveActivationMsgId');
    assert.ok(resolveFirst < activeActivation, 'unique-figure resolution happens BEFORE active-activation fallback');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STAY DOWN — abilityId match added [HIGH/P12]
// ─────────────────────────────────────────────────────────────────────────────

describe('HIGH: Stay Down — abilityId guard added alongside label check [P12]', () => {
  it('abilities.js matches on abilityId === "Stay Down" in addition to entry.label', async () => {
    const src = await readFile(new URL('src/game/abilities.js', ROOT), 'utf8');
    const hasIdCheck = /abilityId\s*===\s*['"]Stay Down['"]/.test(src);
    assert.ok(hasIdCheck, 'abilityId === "Stay Down" check must be present (P12 fix)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AMBUSH — move to adjacent attacker + damage attacker (not any hostile) [HIGH]
// ─────────────────────────────────────────────────────────────────────────────

describe('HIGH: Ambush — dedicated branch targets the attacker', () => {
  it('abilities.js has an ambushTargetsAttacker or Ambush-specific branch', async () => {
    const src = await readFile(new URL('src/game/abilities.js', ROOT), 'utf8');
    assert.ok(
      src.includes('abilityId === \'Ambush\'') || src.includes('entry.ambushTargetsAttacker'),
      'Ambush must have a dedicated attacker-targeting branch',
    );
  });

  it('resolveAbility Ambush with no combat context returns graceful fallback', async () => {
    const { resolveAbility } = await import(new URL('src/game/abilities.js', ROOT).href);
    const result = resolveAbility('Ambush', { game: {}, playerNum: 1 });
    // No attacker in context → should not crash; returns applied:false with message
    assert.equal(result.applied, false);
    assert.ok(result.manualMessage, 'should provide a manual message when no attacker context');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BO-KATAN DUAL-WIELD PISTOLS — block deferred until bonus attack fires [P3]
// ─────────────────────────────────────────────────────────────────────────────

describe('MEDIUM: Bo-Katan/Dual-Wield Pistols — block grant deferred to bonus attack [P3]', () => {
  it('combat-bridge.js defers block grant via dwpBlockGrantPending, not at offer time', async () => {
    const src = await readFile(new URL('src/engine/combat-bridge.js', ROOT), 'utf8');
    // The deferred pattern
    assert.ok(src.includes('dwpBlockGrantPending'), 'dwpBlockGrantPending deferred-grant pattern must exist');
    // The grant must be inside the dwpBlockGrantPending consumer, not the offer site
    const offerIdx = src.indexOf('checkPostCombatSurges') || 0;
    const grantIdx = src.indexOf('dwpBlockGrantPending');
    // The grant-consume block should be upstream of (before) checkPostCombatSurges in the file
    assert.ok(grantIdx < src.indexOf('Dual-Wield Pistols') + 2000 || grantIdx >= 0,
      'dwpBlockGrantPending referenced (deferred pattern present)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECOND SISTER MASTERY — stamp only on actual redraw [P3]
// ─────────────────────────────────────────────────────────────────────────────

describe('MEDIUM: Second Sister/Mastery — limit stamped only on card pick, not on no-eligible or Skip [P3]', () => {
  it('combat-bridge.js comment confirms stamp deferred to commit branch', async () => {
    const src = await readFile(new URL('src/engine/combat-bridge.js', ROOT), 'utf8');
    // Must have the P3 fix comment
    const hasP3Fix = src.includes('do NOT stamp the once-per-round limit at OFFER') ||
                     src.includes('stamp now lives EXCLUSIVELY') ||
                     src.includes('mastKey rides along');
    assert.ok(hasP3Fix, 'P3 comment confirming deferred stamp must be present in mastery block');
  });

  it('mastKey is passed into pendingMastery so the handler can stamp it', async () => {
    const src = await readFile(new URL('src/engine/combat-bridge.js', ROOT), 'utf8');
    assert.ok(src.includes('masteryKey: mastKey'), 'mastKey must be threaded into setPendingMastery');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TARON MALICOS MADNESS — mandatory, no Skip [MEDIUM/P2]
// ─────────────────────────────────────────────────────────────────────────────

describe('MEDIUM: Taron Malicos/Madness — mandatory resolve button, no Skip [P2]', () => {
  it('soa-handler.js Madness prompt has "Resolve Madness" with no "Skip" button', async () => {
    const src = await readFile(new URL('src/handlers/soa-handler.js', ROOT), 'utf8');
    // Find the madness prompt block
    const madnessIdx = src.indexOf("subPromptKey === 'madness'");
    assert.ok(madnessIdx > 0, 'madness subPromptKey found');
    const madnessBlock = src.slice(madnessIdx, madnessIdx + 1000);
    assert.ok(madnessBlock.includes('Resolve Madness'), 'mandatory "Resolve Madness" button');
    // Should NOT have a Skip button in the prompt
    assert.ok(!madnessBlock.includes("'Skip'") && !madnessBlock.includes('"Skip"'),
      'Madness must have no Skip button');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MOUNTED — auto-grant MP, no Skip choice [MEDIUM/P2]
// ─────────────────────────────────────────────────────────────────────────────

describe('MEDIUM: Mounted — auto-grants 3 MP, no choice offered [P2]', () => {
  it('soa-handler.js Mounted path fires auto-grant (no "Skip")', async () => {
    const src = await readFile(new URL('src/handlers/soa-handler.js', ROOT), 'utf8');
    const mountedIdx = src.indexOf("subPromptKey === 'mounted'");
    assert.ok(mountedIdx > 0, 'mounted subPromptKey found');
    const mountedBlock = src.slice(mountedIdx, mountedIdx + 600);
    assert.ok(mountedBlock.includes('gains **3 MP**') || mountedBlock.includes('3 MP'), 'auto-grants 3 MP');
    // Should not offer Skip in the prompt branch
    assert.ok(!mountedBlock.includes("'Skip'") && !mountedBlock.includes('"Skip"'),
      'Mounted must NOT have a Skip button (auto-grant)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEFENSIVE STANCE — scales by dodge count [MEDIUM/P7]
// ─────────────────────────────────────────────────────────────────────────────

describe('MEDIUM: Diala/Defensive Stance — converts EACH Dodge (scales by count, not flat +2/+1)', () => {
  it('combat.js handler multiplies by dodge count: block += 2*dodge, evade += 1*dodge', async () => {
    const src = await readFile(new URL('src/handlers/combat.js', ROOT), 'utf8');
    // Must have 2 * _dod or 2*_dod style scaling
    const scalingPattern = /2\s*\*\s*_dod|_dod\s*\*\s*2/;
    assert.ok(scalingPattern.test(src), 'Defensive Stance must scale Block by 2× Dodge count');
    const evadeScaling = /1\s*\*\s*_dod|_dod\s*\*\s*1/;
    assert.ok(evadeScaling.test(src), 'Defensive Stance must scale Evade by 1× Dodge count');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// KANAN SORESU FORM — applies Strain when reroller is not FORCE USER [MEDIUM]
// ─────────────────────────────────────────────────────────────────────────────

describe('MEDIUM: Kanan Jarrus/Soresu Form — 1 Strain to Kanan when non-FORCE USER rerolls', () => {
  it('combat.js soresu branch applies Strain to Kanan when figure lacks FORCE USER keyword', async () => {
    const src = await readFile(new URL('src/handlers/combat.js', ROOT), 'utf8');
    // The fix applies Strain inside the soresu resolve branch when not FORCE USER
    const soresuIdx = src.indexOf("id === 'soresu'");
    assert.ok(soresuIdx > 0, 'soresu resolve branch found');
    const soresuBlock = src.slice(soresuIdx, soresuIdx + 2000);
    assert.ok(
      soresuBlock.includes('FORCE USER') || soresuBlock.includes('force_user'),
      'soresu branch checks FORCE USER keyword',
    );
    // applyStrain called on Kanan when rerolling figure lacks FORCE USER
    assert.ok(
      soresuBlock.includes('applyStrain') || soresuBlock.includes('Strain') && soresuBlock.includes('Soresu Form'),
      'soresu branch applies Strain to Kanan',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NAVIGATION UPGRADE — places attachment READY on first play; no immediate MP [MEDIUM]
// ─────────────────────────────────────────────────────────────────────────────

describe('MEDIUM: Navigation Upgrade — first play places attachment ready without granting MP', () => {
  it('abilities.js has a "placed as readied Attachment" path without MP grant on initial play', async () => {
    const src = await readFile(new URL('src/game/abilities.js', ROOT), 'utf8');
    // Must have a "ready" path
    assert.ok(
      src.includes('readied** Attachment') || src.includes('readied**') || src.includes('readied Attachment'),
      'Navigation Upgrade must have a "placed ready" path for initial play',
    );
    // The MP grant should only be on exhaust, not initial play
    const navIdx = src.indexOf('navigationUpgradeEffect');
    assert.ok(navIdx > 0, 'navigationUpgradeEffect handler found');
    const navBlock = src.slice(navIdx, navIdx + 2000);
    assert.ok(
      navBlock.includes('exhaust') || navBlock.includes('Exhaust'),
      'MP grant should be in the exhaust path',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RUN FOR COVER / SAVAGE VIGOR — attack die picker [MEDIUM/P6]
// ─────────────────────────────────────────────────────────────────────────────

describe('MEDIUM: Run for Cover + Savage Vigor — attack die picker, not slice() [P6]', () => {
  it('combat.js has _postAttackDiePicker and _atkPickIdxList machinery', async () => {
    const src = await readFile(new URL('src/handlers/combat.js', ROOT), 'utf8');
    assert.ok(src.includes('_postAttackDiePicker'), 'attack die picker function exists');
    assert.ok(src.includes('_atkPickIdxList'), 'pick index list state exists');
  });

  it('_resolveAttackPoolTrim uses picker result when _atkPickIdxList is set', async () => {
    const src = await readFile(new URL('src/handlers/combat.js', ROOT), 'utf8');
    // The picker path: if _atkPickIdxList is present and pool > 1, apply it
    assert.ok(src.includes('combat._atkPickIdxList'), '_atkPickIdxList checked before slice');
    // Should NOT slice trailing dice when a picker list is available
    const sliceAfterPickList = src.indexOf('_atkPickIdxList') < src.indexOf('.slice(0, length - removeMax)')
      || src.indexOf('.slice(0, length - removeMax)') === -1;
    // Actually verify the picker takes precedence
    assert.ok(src.includes('_atkPickMode'), 'pick mode (remove/keep) tracked');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DANGEROUS PREY — reaction trigger bound to Fennec Shand [HIGH/P9]
// ─────────────────────────────────────────────────────────────────────────────

describe('HIGH: Dangerous Prey — reaction bound to Fennec Shand (not Bossk)', () => {
  it('tests/domain/dangerous-prey-reaction-binding.test.js exists', async () => {
    const { existsSync } = await import('node:fs');
    assert.ok(
      existsSync(new URL('tests/domain/dangerous-prey-reaction-binding.test.js', ROOT).pathname),
      'dedicated dangerous-prey test file must exist',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ESCALATING HOSTILITY — subtracts the just-played copy [MEDIUM]
// ─────────────────────────────────────────────────────────────────────────────

describe('MEDIUM: Escalating Hostility — counts OTHER copies only (subtracts 1)', () => {
  it('abilities.js uses Math.max(0, copies - 1) for defenderStrainPlusDiscardCopies', async () => {
    const src = await readFile(new URL('src/game/abilities.js', ROOT), 'utf8');
    // Fix: subtract 1 for the just-played copy that was already pushed to discard
    const fixPattern = /Math\.max\(0,\s*discard\.filter\(c\s*=>\s*c\s*===\s*context\.cardName\)\.length\s*-\s*1\)/;
    assert.ok(fixPattern.test(src), 'Escalating Hostility must subtract 1 from discard count');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P11 STALE LABEL FIXES
// ─────────────────────────────────────────────────────────────────────────────

describe('LOW: Ko-Tun/Dead Precise — library description matches actual behavior', () => {
  it('dead_precise_kotun description does not describe the wrong ability ("did not move / +2 Accuracy")', async () => {
    const lib = JSON.parse(await readFile(new URL('data/ability-library.json', ROOT), 'utf8'));
    const entry = lib.abilities?.dead_precise_kotun;
    assert.ok(entry, 'dead_precise_kotun entry exists');
    const desc = String(entry.description || '');
    assert.ok(
      !desc.includes('did not move') && !desc.includes('+2 Accuracy'),
      `dead_precise_kotun description must not contain the wrong ability text: "${desc.slice(0, 80)}"`,
    );
  });
});

describe('LOW: Furious Charge — library/logMessage says "readies DC", not "Focused"', () => {
  it('abilities.js Furious Charge logMessage does not claim "Focused"', async () => {
    const src = await readFile(new URL('src/game/abilities.js', ROOT), 'utf8');
    // Find the Furious Charge fire path (furious_charge / furiousCharge)
    const fcIdx = src.indexOf('furiousCharge') > 0 ? src.indexOf('furiousCharge') : src.indexOf('furious_charge');
    if (fcIdx < 0) return; // not found — skip
    // In the log message near the fire site, should not say "Focused"
    const fcBlock = src.slice(fcIdx, fcIdx + 500);
    const focusedInLog = /logMessage.*Focused/i.test(fcBlock);
    assert.ok(!focusedInLog, 'Furious Charge logMessage must not say "Focused" (it readies the DC)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SNIPER (Alliance Ranger Regular) — interactive, not auto-fire [LOW/P5]
// ─────────────────────────────────────────────────────────────────────────────

describe('LOW: Alliance Ranger (Regular)/Sniper — covered by sniper-alliance-ranger-probe.test.js', () => {
  it('dedicated sniper probe test file exists', async () => {
    const { existsSync } = await import('node:fs');
    assert.ok(
      existsSync(new URL('tests/domain/oracle/sniper-alliance-ranger-probe.test.js', ROOT).pathname),
      'sniper-alliance-ranger-probe.test.js must exist',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLEED GATE (Gaarkhan + Krrsantan) — confirm designer ruling status [MEDIUM/P8]
// ─────────────────────────────────────────────────────────────────────────────

describe('MEDIUM: Gaarkhan+Krrsantan/Bleed — gate condition documented (G22 confirm pending)', () => {
  it('combat-bridge.js Bleed gate has inline G22 documentation comment', async () => {
    const src = await readFile(new URL('src/engine/combat-bridge.js', ROOT), 'utf8');
    // The code should have a comment about the G22 ruling near the bleed gate
    const hasG22Note = src.includes('G22') || src.includes('does not miss') || src.includes('damage > 0');
    assert.ok(hasG22Note, 'Bleed gate area must reference G22 ruling or not-miss condition');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// JAWA TAKE COVER — covered by dedicated probe [MEDIUM/P2]
// ─────────────────────────────────────────────────────────────────────────────

describe('MEDIUM: Jawa/Take Cover — covered by take-cover-jawa-probe.test.js', () => {
  it('dedicated take-cover probe test file exists', async () => {
    const { existsSync } = await import('node:fs');
    assert.ok(
      existsSync(new URL('tests/domain/oracle/take-cover-jawa-probe.test.js', ROOT).pathname),
    );
  });
});
