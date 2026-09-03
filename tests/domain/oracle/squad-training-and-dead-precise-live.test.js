/**
 * Squad Training and Dead Precise, pinned on the mechanisms that ACTUALLY run.
 *
 * alexanbv 2026-09-03: "delete the dead code. Leave internal naming."
 *
 * Both abilities had a pure-helper module and a probe test, and both modules
 * were dead: their functions were imported into handlers/combat.js and never
 * called. Deleting them removes the last coverage those two abilities had, so
 * this file replaces it with coverage of the live paths instead.
 *
 * The Dead Precise helper was worse than unused. Its docstring described a
 * DIFFERENT ability — "If you have not exited a space during this activation,
 * apply +2 Accuracy" — and its probe test asserted that wording. The real card
 * grants a reroll and -1 Dodge, gated on a spent power token. Reading that file
 * is what sent me down the wrong path earlier in this sweep.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abilitiesForCard } from '../../../src/engine/combat-ability-db.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const dc = (() => {
  const d = JSON.parse(read('data/dc-effects.json'));
  return d.cards || d;
})();

describe('the dead modules are gone and nothing references them', () => {
  for (const f of ['src/game/squad-training-helpers.js', 'src/game/dead-precise-kotun-helpers.js']) {
    test(`${f} no longer exists`, () => {
      assert.throws(() => read(f), /ENOENT/);
    });
  }

  test('handlers/combat.js imports neither', () => {
    const src = read('src/handlers/combat.js');
    assert.ok(!/squad-training-helpers/.test(src));
    assert.ok(!/dead-precise-kotun-helpers/.test(src));
    assert.ok(!/hasSquadTrainingAbility|applySquadTrainingReroll/.test(src));
    assert.ok(!/hasDeadPreciseAbility|deadPreciseBonusApplies|applyDeadPreciseBonus/.test(src));
  });
});

describe('Squad Training still runs, via the CSV condition', () => {
  test('all three live cards carry the spec row', () => {
    for (const card of ['Shoretrooper (Elite)', 'Stormtrooper (Elite)', 'Stormtrooper (Regular)']) {
      const row = (abilitiesForCard(card) || []).find((r) => r.ability === 'Squad Training');
      assert.ok(row, `${card} has no Squad Training row`);
      assert.equal(row.timing, 'attack:rerolls');
      assert.equal(row.attack_side, 'attacker');
      assert.match(row.conditional, /adjacent to another friendly TROOPER/);
    }
  });

  test('the condition parser turns that prose into a keyword-filtered adjacency', () => {
    const cond = read('src/engine/combat-conditions.js');
    assert.match(cond, /adjacent to \(\?:another \|a \)\?friendly \(trooper\|/,
      'the prose is matched and the keyword captured');
    assert.match(cond, /type: 'affected_adjacent_to_friendly', keyword: adjKw\[1\]\.toUpperCase\(\)/);
  });

  test('and that adjacency looks at the whole TEAM, not the same group', () => {
    // alexanbv 2026-09-02: "They can mix an match. The adjacent trooper can be
    // any trooper not just from the same group." The primitive enumerates every
    // figure the player controls and filters only on the keyword — there is no
    // group comparison, which is what makes mix-and-match work.
    const cond = read('src/engine/combat-conditions.js');
    const branch = cond.slice(cond.indexOf("case 'affected_adjacent_to_friendly'"));
    const body = branch.slice(0, 1200);
    assert.match(body, /const team = game\.figurePositions\?\.\[aff\.pn\] \|\| \{\};/);
    assert.match(body, /if \(fk === aff\.figureKey\) continue;/, 'only self is excluded');
    assert.ok(!/msgId|group|dgIndex/i.test(body), 'no group restriction anywhere in the check');
  });

  test('the orphan fourth slug has no live card, as the deleted file noted', () => {
    // squad_training_shoretrooper_reg pointed at a Shoretrooper Regular that
    // does not exist. Worth keeping the observation now the file is gone.
    assert.ok(!dc['Shoretrooper (Regular)'], 'no such card');
    const ids = Object.values(dc)
      .filter((v) => v && typeof v === 'object')
      .flatMap((v) => v.specialAbilityIds || []);
    assert.ok(!ids.includes('squad_training_shoretrooper_reg'));
  });
});

describe('Dead Precise still runs, via the mods registry and the rerolls row', () => {
  test('the -1 Dodge rider is a live mods passive', () => {
    const mods = read('src/engine/combat-abilities-mods.js');
    assert.match(mods, /id: 'dead_precise_dodge'.*side: 'attacker'/s);
    assert.match(mods, /applies: \(game, combat\) => !!combat\.attackerSpentPowerToken && _deadPreciseKoTunAura\(game, combat\)/);
  });

  test('the reroll half is the CSV row, and it is friendly-scoped', () => {
    const row = (abilitiesForCard('Ko-Tun Feralo') || []).find((r) => r.ability === 'Dead Precise');
    assert.ok(row);
    assert.equal(row.timing, 'attack:rerolls');
    assert.match(row.effect, /may reroll up to 1 attack die and apply -1 Dodge to the defense results/);
    assert.match(row.conditional, /a friendly figure within 3 spaces is attacking/);
  });

  test('the card text is the CURRENT ability, not the one the dead file described', () => {
    // The deleted helper's docstring said "+2 Accuracy if you have not exited a
    // space". That ability does not exist on this card.
    assert.match(dc['Ko-Tun Feralo'].abilityText, /Dead Precise: While a friendly figure within 3 spaces is attacking/);
    assert.ok(!/not exited a space/.test(dc['Ko-Tun Feralo'].abilityText));
    assert.ok(!/\+2 Accuracy/.test(dc['Ko-Tun Feralo'].abilityText));
  });
});
