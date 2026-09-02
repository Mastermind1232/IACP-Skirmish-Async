/**
 * `oncePer` is enforced generically now, not per-branch.
 *
 * 17 library entries declare it. Until 2026-09-02 exactly TWO were enforced —
 * Shield Gauntlets and Wrist Cord — each by a hardcoded check inside its own
 * branch using its own flag name. The other fifteen declared a limit that
 * nothing read, so Electrified Knuckledusters, Smash, Parting Gift, Demolish,
 * Jetpack Rocket and Wrist Flamethrower were all simply repeatable: click as
 * many times as you like.
 *
 * alexanbv 2026-09-02: "You need to fix the once per issue and unify."
 *
 * The mark happens only on `applied === true`. Two-phase abilities return
 * `requiresChoice` first and resolve on a later call, so marking any earlier
 * would burn the use on the prompt instead of the effect.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAbility } from '../../../src/game/abilities.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const lib = JSON.parse(readFileSync(resolve(root, 'data/ability-library.json'), 'utf8')).abilities;
const src = readFileSync(resolve(root, 'src/game/abilities.js'), 'utf8');

const declaring = Object.entries(lib).filter(([, v]) => v && typeof v === 'object' && v.oncePer);

describe('the declaration itself', () => {
  test('every oncePer value is one the code understands', () => {
    // A typo here would silently disable the limit rather than fail loudly,
    // which is the exact failure mode this whole fix is about.
    const bad = declaring.filter(([, v]) => !['round', 'activation', 'attack'].includes(v.oncePer));
    assert.deepEqual(bad.map(([k]) => k), []);
  });

  test('all 17 are still declared', () => {
    assert.equal(declaring.length, 17);
    const scopes = declaring.reduce((a, [, v]) => ({ ...a, [v.oncePer]: (a[v.oncePer] || 0) + 1 }), {});
    assert.deepEqual(scopes, { activation: 9, round: 7, attack: 1 });
  });
});

describe('the bespoke guards are gone, so there is one mechanism', () => {
  test("Shield Gauntlets' own flag is removed", () => {
    assert.ok(!/shieldGauntletsUsed/.test(src));
  });

  test('all four bespoke guards are removed', () => {
    // There were FOUR, not two: Wrist Cord (pushLandingEffect), Shield
    // Gauntlets (spendMpForBlockToken), Jetpack Rocket (rollOneDieTarget) and
    // Wrist Flamethrower (areaEffect). Each gated only its own branch, and
    // three of them gated 'round' ONLY — which is exactly why the
    // activation-scoped abilities routed through those same branches
    // (Electrified Knuckledusters, Smash, Demolish) were repeatable.
    for (const marker of ['_ptwrSelfFk', 'shieldGauntletsUsed', '_hwrUsedKey']) {
      assert.ok(!src.includes(marker), marker + ' survives');
    }
    assert.equal((src.match(/entry\.oncePer/g) || []).length, 0,
      'no branch reads entry.oncePer any more');
  });

  test('the wrapper is the only place that reads the flag', () => {
    // One read, in _oncePerKey. Any branch reading it again is a second
    // mechanism, which is what this whole change removed.
    const reads = src.match(/\.oncePer\b/g) || [];
    assert.equal(reads.length, 1, `oncePer is read in ${reads.length} places`);
  });

  test('resolveAbility wraps an inner implementation', () => {
    assert.match(src, /function _resolveAbilityInner\(abilityId, context\) \{/);
    assert.match(src, /const result = _resolveAbilityInner\(abilityId, context\);/);
    assert.match(src, /if \(limit && result\?\.applied === true\) _oncePerMark\(context, limit\);/,
      'marking on anything but applied:true would burn the use on a prompt');
  });
});

describe('activation scope, end to end (Shield Gauntlets)', () => {
  // spendMpForBlockToken is the simplest real fixture: 1 MP in, 1 Block out.
  // MP lives in game.movementBank[msgId].perFig[i].remaining (game-helpers.js:63),
  // NOT on dcActionsData — a per-figure bank, never a shared group pool.
  const build = (mp) => ({
    gameId: 'g1',
    figurePositions: { 1: { 'Super Commando (Elite)-1-0': 'a1' } },
    figurePowerTokens: {},
    movementBank: { m1: { perFig: { 0: { remaining: mp, total: mp } } } },
    dcActionsData: { m1: { selectedFigure: 0 } },
    dcMessageMeta: new Map([['m1', { gameId: 'g1', playerNum: 1, dcName: 'Super Commando (Elite)' }]]),
  });
  const ctx = (game) => ({
    game, playerNum: 1, msgId: 'm1',
    meta: { dcName: 'Super Commando (Elite)', displayName: 'Super Commando (Elite)', playerNum: 1 },
  });

  test('the first use applies, the second is refused', () => {
    const game = build(5);
    const first = resolveAbility('shield_gauntlets', ctx(game));
    assert.equal(first.applied, true, `first use should apply: ${first.manualMessage || ''}`);
    const second = resolveAbility('shield_gauntlets', ctx(game));
    assert.equal(second.applied, false);
    assert.match(second.manualMessage, /already used this activation/);
  });

  test('the refusal does NOT charge the cost again', () => {
    const game = build(5);
    resolveAbility('shield_gauntlets', ctx(game));
    const mpAfterFirst = game.movementBank.m1.perFig[0].remaining;
    resolveAbility('shield_gauntlets', ctx(game));
    assert.equal(game.movementBank.m1.perFig[0].remaining, mpAfterFirst, 'a refused use must be free');
    assert.equal((game.figurePowerTokens['Super Commando (Elite)-1-0'] || []).length, 1,
      'and must not grant a second token');
  });

  test('a different FIGURE of the same group has its own use', () => {
    const game = build(5);
    resolveAbility('shield_gauntlets', ctx(game));
    game.dcActionsData.m1.selectedFigure = 1;
    game.movementBank.m1.perFig[1] = { remaining: 5, total: 5 };
    const other = resolveAbility('shield_gauntlets', ctx(game));
    assert.equal(other.applied, true, 'the limit is per figure, not per group');
  });

  test('the next activation clears it', () => {
    const game = build(5);
    resolveAbility('shield_gauntlets', ctx(game));
    // activation-setup.js reassigns dcActionsData[msgId] wholesale.
    game.dcActionsData.m1 = { selectedFigure: 0 };
    game.movementBank.m1.perFig[0] = { remaining: 5, total: 5 };
    assert.equal(resolveAbility('shield_gauntlets', ctx(game)).applied, true);
  });
});

describe('round scope uses the container that actually resets', () => {
  test('it writes to roundFigureAbilityUsed', () => {
    assert.match(src, /game\.roundFigureAbilityUsed\[k\.key\] = true;/);
  });

  test('that container is cleared at round start', () => {
    const st = readFileSync(resolve(root, 'src/game/activation-state.js'), 'utf8');
    assert.match(st, /'roundFigureAbilityUsed'/, 'it is a ROUND_OBJECT_FLAG');
  });

  test('activation scope rides dcActionsData, which is rebuilt per activation', () => {
    const setup = readFileSync(resolve(root, 'src/engine/activation-setup.js'), 'utf8');
    assert.match(setup, /game\.dcActionsData\[msgId\] = \{/, 'reassigned wholesale, so nested flags die with it');
  });
});

describe('Professional is read from the innate list, not the prose', () => {
  // Fallout from correcting Ko-Tun's Dead Precise text: her only mention of the
  // word was an incidental "stacks with Professional" aside, and removing it
  // took her reroll with it. Four other cards never mentioned it at all.
  test('every card printing Professional gets the reroll', async () => {
    const { getInnateRerollAbilities } = await import('../../../src/game/combat.js');
    for (const n of ['Ko-Tun Feralo', 'Cara Dune', 'Dewback Rider',
                     'Scout Trooper (Elite)', 'Super Commando (Elite)', 'Mara Jade']) {
      const atk = getInnateRerollAbilities(n).filter((a) => a.pool === 'attack');
      assert.deepEqual(atk.map((a) => a.id), ['professional'], `${n} lost its Professional reroll`);
    }
  });

  test('and a card without it still gets nothing', () => {
    // Guards against the lookup matching everything.
    return import('../../../src/game/combat.js').then(({ getInnateRerollAbilities }) => {
      assert.deepEqual(getInnateRerollAbilities('Jyn Erso').filter((a) => a.pool === 'attack'), []);
    });
  });
});
