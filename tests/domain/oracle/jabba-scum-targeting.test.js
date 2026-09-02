/**
 * Jabba the Hutt — SCUM targeting, and Bully deals Strain.
 *
 * alexanbv 2026-09-02: "Jabba can only target SCUM figures. He can never target
 * imperial figures. Elite is irrelevant." and "bully is STRAIN".
 *
 * Three things were wrong. Bully dealt 3 Damage instead of 3 Strain, and both
 * Incentivize and Order Hit filtered their target list on `elite` — so Jabba
 * could Incentivize an elite IMPERIAL figure, but not a regular Scum one. The
 * filter was exactly backwards from the printed restriction.
 *
 * Bully itself is NOT faction-restricted. The ruling's wording is blanket, but
 * the printed card puts the Scum glyph on Incentivize and Order Hit only:
 * "Bully: A figure of your choice within 3 spaces suffers 3 [Strain]". A
 * Scum-only Bully would also be near-useless, since against a non-Scum opponent
 * its only legal targets would be your own figures.
 *
 * The cause is worth recording: docs/combat-spec.csv contradicted itself. Its
 * `effect` column read "An elite figure of your choice" while the same row's
 * `affects_others` column read "a SCUM figure of your choice". The
 * implementation followed the prose column and the affiliation column was never
 * read. Both columns now agree.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abilitiesForCard } from '../../../src/engine/combat-ability-db.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const read = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const dc = (() => { const d = read('data/dc-effects.json'); return d.cards || d; })();
const lib = read('data/ability-library.json').abilities;

describe('Bully deals Strain, not Damage', () => {
  test('the library entry is 3 Strain and 0 Damage', () => {
    const t = lib.bully_jabba.targetHostileFigure;
    assert.equal(t.strain, 3, 'the printed glyph is the Strain hexagon');
    assert.equal(t.damage, 0, 'and no Damage at all');
    assert.equal(t.range, 3, 'range 3 is unchanged');
  });

  test('the printed card text says Strain, and does NOT restrict the target', () => {
    assert.match(dc['Jabba the Hutt'].abilityText, /\(Bully\): A figure of your choice within 3 spaces suffers 3 Strain\./);
    assert.ok(!/Bully\): A figure of your choice within 3 spaces suffers 3 Damage/.test(dc['Jabba the Hutt'].abilityText));
  });

  test('the spec row agrees, in both its prose and its pipeline', () => {
    const row = (abilitiesForCard('Jabba the Hutt') || []).find((r) => r.ability === 'Bully');
    assert.match(row.effect, /suffers 3 Strain/);
    assert.equal(row.pipelines, 'strain', 'a "damage" pipeline would route it to the wrong track');
  });
});

describe('all three targeted abilities are SCUM-gated, not elite-gated', () => {
  test('no Jabba ability filters on elite any more', () => {
    for (const id of ['bully_jabba', 'incentivize_jabba', 'order_hit_jabba']) {
      assert.ok(!('choiceRequiresElite' in lib[id]), `${id} still gates on elite`);
    }
  });

  test('Incentivize and Order Hit require the Scum affiliation', () => {
    assert.deepEqual(lib.incentivize_jabba.choiceRequiresKeywords, ['Scum']);
    assert.deepEqual(lib.order_hit_jabba.choiceRequiresKeywords, ['Scum']);
  });

  test('but Bully is NOT, because the card prints no glyph on it', () => {
    assert.ok(!('requiresAffiliation' in lib.bully_jabba.targetHostileFigure));
    assert.ok(lib.bully_jabba.targetHostileFigure.allowFriendly, 'it can still hit your own figures');
  });

  test('card text and both CSV columns all say SCUM', () => {
    const text = dc['Jabba the Hutt'].abilityText;
    assert.ok(!/elite figure of your choice/i.test(text), 'no "elite figure" survives on the card');
    assert.equal((text.match(/A SCUM figure of your choice/g) || []).length, 2, 'Incentivize and Order Hit only');

    for (const name of ['Incentivize', 'Order Hit']) {
      const row = (abilitiesForCard('Jabba the Hutt') || []).find((r) => r.ability === name);
      assert.match(row.effect, /SCUM figure of your choice/, `${name} effect column`);
      assert.match(row.affects_others, /SCUM figure of your choice/, `${name} affects_others column`);
      assert.ok(!/elite|MERC/i.test(row.effect + row.affects_others), `${name} still mentions elite/MERC`);
    }
  });
});

describe('the SCUM filter is WIRED, not merely declared', () => {
  // A flag in the data with no reader is how the affiliation column sat unused
  // in the CSV for months. These exercise the real filters.
  const dcNameOf = (fk) => String(fk).replace(/-\d+-\d+$/, '');

  test('Incentivize enumerates Scum figures and rejects an elite Imperial', async () => {
    const { resolveAbility } = await import('../../../src/game/abilities.js');
    // Real cards: one Scum non-elite, one Imperial elite. The old filter kept
    // exactly the wrong one of these two.
    const scumRegular = Object.keys(dc).find((k) => dc[k]?.affiliation === 'Scum' && !dc[k]?.elite && !dc[k]?.attachment);
    const impElite = Object.keys(dc).find((k) => dc[k]?.affiliation === 'Imperial' && dc[k]?.elite && !dc[k]?.attachment);
    assert.ok(scumRegular && impElite, 'fixture needs one of each');

    const game = {
      figurePositions: {
        1: { [`${scumRegular}-1-0`]: 'a1' },
        2: { [`${impElite}-2-0`]: 'a2' },
      },
      dcActionsData: {},
    };
    const res = resolveAbility('incentivize_jabba', {
      game, playerNum: 1, meta: null, msgId: 'm1',
      getDcEffects: () => dc,
    });
    assert.ok(res.requiresChoice, 'a Scum figure is on the board, so a choice is offered');
    assert.deepEqual(res.targetFigureKeys, [`${scumRegular}-1-0`],
      'the non-elite SCUM figure is the ONLY legal target; the elite Imperial is not');
  });

  test('Incentivize offers nothing when only Imperials are on the board', async () => {
    const { resolveAbility } = await import('../../../src/game/abilities.js');
    const impElite = Object.keys(dc).find((k) => dc[k]?.affiliation === 'Imperial' && dc[k]?.elite && !dc[k]?.attachment);
    const game = { figurePositions: { 1: {}, 2: { [`${impElite}-2-0`]: 'a2' } }, dcActionsData: {} };
    const res = resolveAbility('incentivize_jabba', {
      game, playerNum: 1, meta: null, msgId: 'm1', getDcEffects: () => dc,
    });
    assert.equal(res.applied, false);
    assert.match(res.manualMessage, /No SCUM figures/, 'and it says why');
  });

  test('the generic chooser reads choiceRequiresKeywords as an affiliation', () => {
    // Order Hit rides the shared chooseFriendlyToFocus path, whose keyword
    // filter accepts an affiliation match as well as a keyword match. If that
    // ever narrows to keywords only, Order Hit silently loses its restriction.
    const src = readFileSync(resolve(root, 'src/game/abilities.js'), 'utf8');
    assert.match(src, /const aff = \(eff\?\.affiliation \|\| ''\)\.toLowerCase\(\);/);
    assert.match(src, /kw\.includes\(rk\.toLowerCase\(\)\) \|\| aff === rk\.toLowerCase\(\)/);
  });

  test("Bully's spec row keeps its unrestricted wording", () => {
    const row = (abilitiesForCard('Jabba the Hutt') || []).find((r) => r.ability === 'Bully');
    assert.ok(!/SCUM/i.test(row.effect + row.affects_others), 'the glyph is absent from the card, so it stays absent here');
  });
});

describe('ownership: who each ability may target', () => {
  // alexanbv 2026-09-02, closing the question the first pass left open:
  // "bully is unrestricted. The other two are scum only. Incentivize is
  // technically any figure, though it doesnt make sense to focus opponents.
  // Order Hit is only friendly. Bully can target any figure and of course
  // should only be used against opponents."
  //
  // So the three differ on BOTH axes and no two share a rule:
  //   Bully       any affiliation, any owner
  //   Incentivize SCUM only,       any owner
  //   Order Hit   SCUM only,       friendly only
  test('Incentivize reaches a SCUM figure on EITHER side, and no Imperial', async () => {
    const { resolveAbility } = await import('../../../src/game/abilities.js');
    const pick = (p) => Object.keys(dc).find((k) => !k.startsWith('[') && !dc[k]?.attachment && p(dc[k]));
    const mine = pick((v) => v?.affiliation === 'Scum' && !v?.elite);
    const theirs = pick((v) => v?.affiliation === 'Scum' && v?.elite);
    const imp = pick((v) => v?.affiliation === 'Imperial');
    assert.ok(mine && theirs && imp && mine !== theirs, 'fixture needs three distinct cards');

    const game = {
      figurePositions: {
        1: { [`${mine}-1-0`]: 'a1' },
        2: { [`${theirs}-2-0`]: 'a2', [`${imp}-2-1`]: 'a3' },
      },
      dcActionsData: {},
    };
    const res = resolveAbility('incentivize_jabba', {
      game, playerNum: 1, meta: null, msgId: 'm1', getDcEffects: () => dc,
    });
    const keys = res.targetFigureKeys || [];
    assert.ok(keys.includes(`${mine}-1-0`), 'your own SCUM figure');
    assert.ok(keys.includes(`${theirs}-2-0`), "and the opponent's — ownership is NOT a restriction here");
    assert.ok(!keys.includes(`${imp}-2-1`), 'but never an Imperial');
  });

  test('Order Hit is friendly-only, by riding the friendly chooser', () => {
    // Its pool comes from chooseFriendlyToFocus, which reads only
    // figurePositions[playerNum]. That IS the friendly restriction.
    assert.equal(lib.order_hit_jabba.chooseFriendlyToFocus, true);
    const src = readFileSync(resolve(root, 'src/game/abilities.js'), 'utf8');
    const branch = src.slice(src.indexOf("entry.chooseFriendlyToFocus) {"));
    const pool = branch.slice(0, branch.indexOf('validTargets.push'));
    assert.ok(pool.includes('game.figurePositions?.[playerNum]'), 'friendly side only');
    assert.ok(!/opponentPlayerNum|enemyNum/.test(pool), 'and the opponent is never enumerated');
  });

  test('Incentivize does NOT ride that chooser, which is why it reaches both sides', () => {
    // The two abilities take different code paths on purpose. If Incentivize is
    // ever folded into the shared chooser it silently becomes friendly-only.
    const src = readFileSync(resolve(root, 'src/game/abilities.js'), 'utf8');
    const i = src.indexOf("abilityId === 'incentivize_jabba'");
    assert.ok(i > 0);
    const branch = src.slice(i, src.indexOf('validTargets.push', i));
    assert.ok(/for \(const pn of \[playerNum, enemyNum\]\)/.test(branch),
      'it enumerates both players itself');
  });
});
