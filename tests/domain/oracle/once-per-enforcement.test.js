/**
 * `oncePer` is enforced generically now, not per-branch.
 *
 * 17 library entries declare it. Until 2026-09-02 exactly FOUR were enforced —
 * Shield Gauntlets, Wrist Cord, Jetpack Rocket and Wrist Flamethrower — each by
 * a hardcoded check inside its own branch with its own flag name. Thirteen
 * declared a limit that nothing read.
 *
 * Three of those four guards gated 'round' ONLY, and said so in their own
 * comments. That is why the ACTIVATION-scoped abilities routed through the very
 * same branches were repeatable: Electrified Knuckledusters and Smash through
 * rollOneDieTarget, Demolish through areaEffect. They were not merely ungated,
 * they passed through a gate built to ignore them.
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

describe('CONFIRMATION: every declared limit actually bites', () => {
  // alexanbv 2026-09-02: "Confirm that once per x limitations are now correct."
  // Drives all 17 through the real wrapper rather than asserting on source.
  const DC = 'Super Commando (Elite)';
  const mk = () => ({
    gameId: 'g', currentRound: 1,
    figurePositions: { 1: { [`${DC}-1-0`]: 'a1' }, 2: { 'Stormtrooper-1-0': 'a2' } },
    figurePowerTokens: {},
    movementBank: { m: { perFig: { 0: { remaining: 9, total: 9 } } } },
    dcActionsData: { m: { selectedFigure: 0 } },
    dcMessageMeta: new Map([['m', { gameId: 'g', playerNum: 1, dcName: DC }]]),
    roundFigureAbilityUsed: {},
  });
  const ctx = (game) => ({ game, playerNum: 1, msgId: 'm',
    meta: { dcName: DC, displayName: DC, playerNum: 1 } });

  test('all 16 per-figure limits refuse a second use', () => {
    // The flag is set directly so the LIMIT is isolated from each ability's own
    // fixture needs (map, target, LOS). What is under test is the wrapper.
    const notGated = [];
    for (const [id, v] of declaring) {
      if (v.oncePer === 'attack') continue;
      const game = mk();
      if (v.oncePer === 'round') game.roundFigureAbilityUsed[`${DC}-1-0_${id}`] = true;
      else game.dcActionsData.m.oncePerActivationUsed = { [`0_${id}`]: true };
      const r = resolveAbility(id, ctx(game));
      const refused = r?.applied === false && /already used this (round|activation)/.test(r?.manualMessage || '');
      if (!refused) notGated.push(id);
    }
    assert.deepEqual(notGated, [], 'these still allow a second use');
  });

  test('ee3_carbine is the only one left out, and it is attack-scoped', () => {
    const attackScoped = declaring.filter(([, v]) => v.oncePer === 'attack').map(([k]) => k);
    assert.deepEqual(attackScoped, ['ee3_carbine']);
  });

  test('ACTIVATION scope: a real use marks the flag (Shield Gauntlets)', () => {
    const game = mk();
    assert.equal(resolveAbility('shield_gauntlets', ctx(game)).applied, true);
    assert.equal(game.dcActionsData.m.oncePerActivationUsed['0_shield_gauntlets'], true,
      'the mark lands in the activation-scoped container');
    assert.equal(game.roundFigureAbilityUsed[`${DC}-1-0_shield_gauntlets`], undefined,
      'and NOT in the round-scoped one');
    assert.match(resolveAbility('shield_gauntlets', ctx(game)).manualMessage, /already used this activation/);
  });

  test('ROUND scope: a real use marks the flag (I Am One With The Force)', () => {
    const game = mk();
    assert.equal(resolveAbility('i_am_one_with_the_force', ctx(game)).applied, true);
    assert.equal(game.roundFigureAbilityUsed[`${DC}-1-0_i_am_one_with_the_force`], true,
      'the mark lands in the round-scoped container');
    assert.equal(game.dcActionsData.m.oncePerActivationUsed, undefined,
      'and NOT in the activation-scoped one');
    assert.match(resolveAbility('i_am_one_with_the_force', ctx(game)).manualMessage, /already used this round/);
  });

  test('a round limit survives a new activation, an activation limit does not', () => {
    // The whole point of two containers: one resets sooner than the other.
    const game = mk();
    resolveAbility('i_am_one_with_the_force', ctx(game));
    resolveAbility('shield_gauntlets', ctx(game));
    game.dcActionsData.m = { selectedFigure: 0 }; // next activation
    game.movementBank.m.perFig[0] = { remaining: 9, total: 9 };
    assert.equal(resolveAbility('shield_gauntlets', ctx(game)).applied, true,
      'activation scope clears when the figure activates again');
    assert.match(resolveAbility('i_am_one_with_the_force', ctx(game)).manualMessage, /already used this round/,
      'round scope does NOT');
  });

  test('an ability with no oncePer is never gated', () => {
    // Guards against the wrapper gating everything.
    const game = mk();
    game.roundFigureAbilityUsed[`${DC}-1-0_scheme_jabba`] = true;
    game.dcActionsData.m.oncePerActivationUsed = { '0_scheme_jabba': true };
    const r = resolveAbility('scheme_jabba', ctx(game));
    assert.ok(!/already used this/.test(r?.manualMessage || ''), 'an unlimited ability must ignore the flags');
  });
});
