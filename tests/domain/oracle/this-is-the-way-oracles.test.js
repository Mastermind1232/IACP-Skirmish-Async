/**
 * Oracle tests for The Armorer's "This is the Way" passive aura.
 *
 * Rule: "When another friendly figure resolves an attack, if the defender
 * was defeated, that figure gains 1 Block Token."
 *
 * Tests cover:
 *   - Metadata: ability library entry + DC specialAbilityIds wiring
 *   - Structural: defeat-handler.js calls checkThisIsTheWay
 *   - Behavioral: checkThisIsTheWay function grants/skips correctly
 *   - Coexistence: This is the Way + Hunt Dissent fire independently
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDcEffects, getAbilityLibrary } from '../../../src/data-loader.js';
import { checkThisIsTheWay } from '../../../src/engine/win-conditions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
function readSrc(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

const dcEffects = getDcEffects();
const abilityLib = getAbilityLibrary();

// ══════════════════════════════════════════════════════════════════════════════
// ORACLE-TITW-001: Metadata — ability library + DC wiring
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-TITW-001: This is the Way metadata', () => {
  it('001a: this_is_the_way_armorer exists in ability-library', () => {
    const entry = abilityLib?.abilities?.['this_is_the_way_armorer'];
    assert.ok(entry, 'ability-library.json must contain this_is_the_way_armorer');
  });

  it('001b: this_is_the_way_armorer has wiredStatus "wired"', () => {
    const entry = abilityLib.abilities['this_is_the_way_armorer'];
    assert.strictEqual(entry.wiredStatus, 'wired');
  });

  it('001c: this_is_the_way_armorer has category "passive"', () => {
    const entry = abilityLib.abilities['this_is_the_way_armorer'];
    assert.strictEqual(entry.category, 'passive',
      'This is the Way is a passive aura, not a button — must be category "passive"');
  });

  it('001d: The Armorer has this_is_the_way_armorer in specialAbilityIds', () => {
    const eff = dcEffects['The Armorer'];
    assert.ok(eff, 'The Armorer must exist in dc-effects.json');
    const sIds = eff.specialAbilityIds || [];
    assert.ok(sIds.includes('this_is_the_way_armorer'),
      `The Armorer.specialAbilityIds must include "this_is_the_way_armorer". Got: [${sIds}]`);
  });

  it('001e: The Armorer still has survival_is_strength_armorer', () => {
    const sIds = dcEffects['The Armorer'].specialAbilityIds || [];
    assert.ok(sIds.includes('survival_is_strength_armorer'),
      'survival_is_strength_armorer must not be displaced');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ORACLE-TITW-002: Structural — defeat-handler wiring
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-TITW-002: Structural wiring', () => {
  it('002a: defeat-handler.js destructures checkThisIsTheWay from deps', () => {
    const src = readSrc('src/engine/defeat-handler.js');
    assert.ok(src.includes('checkThisIsTheWay'),
      'defeat-handler.js must reference checkThisIsTheWay');
  });

  it('002b: defeat-handler.js calls checkThisIsTheWay with attackerFigureKey guard', () => {
    const src = readSrc('src/engine/defeat-handler.js');
    assert.ok(src.includes('attackerFigureKey && checkThisIsTheWay'),
      'checkThisIsTheWay must be guarded by attackerFigureKey presence');
  });

  it('002c: headless-deps.js imports and wires checkThisIsTheWay', () => {
    const src = readSrc('src/headless/headless-deps.js');
    assert.ok(src.includes('checkThisIsTheWay as _realCheckThisIsTheWay'),
      'headless-deps.js must import checkThisIsTheWay');
    assert.ok(src.includes('_realCheckThisIsTheWay'),
      'headless-deps.js must call the real implementation');
  });

  it('002d: headless-deps.js passes checkThisIsTheWay into processFigureDefeat deps', () => {
    const src = readSrc('src/headless/headless-deps.js');
    // Find the processFigureDefeat wiring block
    const pfIdx = src.indexOf('_realProcessFigureDefeat(game, opts, {');
    assert.ok(pfIdx > 0, 'processFigureDefeat wiring block found');
    const block = src.slice(pfIdx, pfIdx + 500);
    assert.ok(block.includes('checkThisIsTheWay'),
      'processFigureDefeat deps must include checkThisIsTheWay');
  });

  it('002e: context-factory.js includes checkThisIsTheWay in COMBAT_DEPS', () => {
    const src = readSrc('src/context-factory.js');
    assert.ok(src.includes("'checkThisIsTheWay'"),
      'COMBAT_DEPS must include checkThisIsTheWay');
  });

  it('002f: win-conditions.js exports checkThisIsTheWay', () => {
    const src = readSrc('src/engine/win-conditions.js');
    assert.ok(src.includes('export async function checkThisIsTheWay'),
      'checkThisIsTheWay must be exported from win-conditions.js');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ORACLE-TITW-003: Behavioral — grants Block Token to friendly attacker
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-TITW-003: Behavioral — grants Block Token on friendly defeat', () => {
  function buildTestGame(armorerAlive = true) {
    const game = {
      figurePositions: {
        1: {
          'Greedo-0-0': 'a1',
          ...(armorerAlive ? { 'The Armorer-0-0': 'b1' } : {}),
        },
        2: {},
      },
      figurePowerTokens: {},
    };
    return game;
  }

  function buildDeps(overrides = {}) {
    const logs = [];
    return {
      getDcEffects: () => dcEffects,
      dcNameFromFigureKey: (fk) => fk.replace(/-\d+-\d+$/, ''),
      grantPowerTokens: (game, figKey, tokenType, count) => {
        game.figurePowerTokens[figKey] = game.figurePowerTokens[figKey] || [];
        for (let i = 0; i < count; i++) game.figurePowerTokens[figKey].push(tokenType);
        return count;
      },
      logGameAction: async (_game, _client, msg) => { logs.push(msg); },
      _logs: logs,
      ...overrides,
    };
  }

  it('003a: Friendly Greedo defeats hostile → gains 1 Block Token', async () => {
    const game = buildTestGame();
    const deps = buildDeps();
    await checkThisIsTheWay(game, 1, 'Greedo-0-0', null, deps);
    const tokens = game.figurePowerTokens['Greedo-0-0'] || [];
    assert.strictEqual(tokens.filter(t => t === 'Block').length, 1,
      'Greedo should gain exactly 1 Block Token');
    assert.ok(deps._logs.some(l => l.includes('This is the Way') && l.includes('Greedo')),
      'Log should mention This is the Way and Greedo');
  });

  it('003b: The Armorer herself defeats hostile → NO Block Token (self-exclusion)', async () => {
    const game = buildTestGame();
    const deps = buildDeps();
    await checkThisIsTheWay(game, 1, 'The Armorer-0-0', null, deps);
    const tokens = game.figurePowerTokens['The Armorer-0-0'] || [];
    assert.strictEqual(tokens.length, 0,
      'The Armorer should NOT gain a Block Token from her own kills');
    assert.strictEqual(deps._logs.length, 0, 'No log should be emitted');
  });

  it('003c: No trigger when The Armorer is not on the board', async () => {
    const game = buildTestGame(false); // Armorer dead
    const deps = buildDeps();
    await checkThisIsTheWay(game, 1, 'Greedo-0-0', null, deps);
    const tokens = game.figurePowerTokens['Greedo-0-0'] || [];
    assert.strictEqual(tokens.length, 0,
      'No Block Token when The Armorer is not alive');
  });

  it('003d: No trigger when attackerFigureKey is null', async () => {
    const game = buildTestGame();
    const deps = buildDeps();
    await checkThisIsTheWay(game, 1, null, null, deps);
    assert.strictEqual(deps._logs.length, 0, 'No trigger on null attacker');
  });

  it('003e: No trigger when Armorer is on the OPPONENT team', async () => {
    const game = {
      figurePositions: {
        1: { 'Greedo-0-0': 'a1' },
        2: { 'The Armorer-0-0': 'b1' },
      },
      figurePowerTokens: {},
    };
    const deps = buildDeps();
    // Attacker is player 1's Greedo, but Armorer is on player 2
    await checkThisIsTheWay(game, 1, 'Greedo-0-0', null, deps);
    const tokens = game.figurePowerTokens['Greedo-0-0'] || [];
    assert.strictEqual(tokens.length, 0,
      'No Block Token when The Armorer is on the opponent team');
  });

  it('003f: Multiple defeats in same combat each grant independently', async () => {
    const game = buildTestGame();
    const deps = buildDeps();
    // Simulate two separate defeat calls (e.g., Blast kills two figures)
    await checkThisIsTheWay(game, 1, 'Greedo-0-0', null, deps);
    await checkThisIsTheWay(game, 1, 'Greedo-0-0', null, deps);
    const tokens = game.figurePowerTokens['Greedo-0-0'] || [];
    assert.strictEqual(tokens.filter(t => t === 'Block').length, 2,
      'Each defeat grants a separate Block Token');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ORACLE-TITW-004: Coexistence — This is the Way + Hunt Dissent
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-TITW-004: Coexistence with Hunt Dissent', () => {
  it('004a: defeat-handler calls checkThisIsTheWay (Hunt Dissent removed from defeat path)', () => {
    // Hunt Dissent's defeat-trigger wiring was removed 2026-05-09 —
    // canonical Hunt Dissent fires when the OPPONENT plays a Command
    // card, not on figure defeat. This is the Way remains in the
    // defeat path; Hunt Dissent will re-land as a CC-play hook in a
    // follow-up slice. Test now asserts only the surviving path.
    const src = readSrc('src/engine/defeat-handler.js');
    const titwIdx = src.indexOf('checkThisIsTheWay(game');
    assert.ok(titwIdx > 0, 'checkThisIsTheWay call must exist');
    assert.ok(src.includes('attackerFigureKey && checkThisIsTheWay'),
      'This is the Way guarded by attackerFigureKey');
    // Hunt Dissent must NOT be invoked from the defeat path.
    assert.ok(!src.includes('checkHuntDissent(game'),
      'checkHuntDissent must not fire on defeat — wrong trigger window');
  });

  it('004b: Hunt Dissent grants to Kallus, This is the Way grants to attacker — different recipients', () => {
    const src = readSrc('src/engine/win-conditions.js');
    // Hunt Dissent: grantPowerTokens(game, kallusFk, ...)
    // This is the Way: grantPowerTokens(game, attackerFigureKey, ...)
    const huntFn = src.slice(
      src.indexOf('export async function checkHuntDissent'),
      src.indexOf('export async function checkThisIsTheWay')
    );
    const titwFn = src.slice(
      src.indexOf('export async function checkThisIsTheWay'),
      src.indexOf('export async function decrementActivationIfGroupDefeated')
    );
    assert.ok(huntFn.includes('grantPowerTokens(game, kallusFk'),
      'Hunt Dissent grants to Kallus figure');
    assert.ok(titwFn.includes('grantPowerTokens(game, attackerFigureKey'),
      'This is the Way grants to the attacker figure');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ORACLE-TITW-005: defeat-pipeline structural — checkThisIsTheWay in step list
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-TITW-005: defeat-handler step list includes This is the Way', () => {
  it('005a: defeat-handler.js header comment mentions This is the Way', () => {
    const src = readSrc('src/engine/defeat-handler.js');
    assert.ok(src.includes('This is the Way'),
      'defeat-handler.js header should mention This is the Way');
  });

  it('005b: headless-deps.js passes checkThisIsTheWay to all combat dep bags', () => {
    const src = readSrc('src/headless/headless-deps.js');
    // Count occurrences — should match checkHuntDissent count
    const huntCount = (src.match(/combatDeps\.checkHuntDissent/g) || []).length;
    const titwCount = (src.match(/combatDeps\.checkThisIsTheWay/g) || []).length;
    assert.ok(titwCount > 0, 'checkThisIsTheWay must appear in combatDeps assignments');
    assert.strictEqual(titwCount, huntCount,
      `checkThisIsTheWay combatDeps count (${titwCount}) must match checkHuntDissent count (${huntCount})`);
  });
});
