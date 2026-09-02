/**
 * Ko-Tun Feralo, against the card alexanbv posted on 2026-09-02.
 *
 * The art in vassal_extracted is older than the live card, and it is the older
 * art that disagreed. On the CURRENT card:
 *
 *   Arms Distribution: After deployment and at the start of your activation,
 *                      a friendly figure within 3 spaces may gain 1 [?].
 *   Dead Precise:      While a friendly figure within 3 spaces is attacking, if
 *                      that figure spent a power token during that attack, that
 *                      figure may reroll up to 1 attack die and apply -1 [Dodge]
 *                      to the defense results.
 *   Squad Cohesion:    When a friendly REBEL figure within 3 spaces DECLARES AN
 *                      ATTACK, it may spend a power token from a friendly REBEL
 *                      figure within 3 spaces of itself for its effect.
 *
 * So the reroll in Dead Precise is correct after all, and so is the split
 * deploy/activation payout in Arms Distribution — the 2026-05-07 ruling matches
 * the card, and our stale art is what made both look wrong.
 *
 * What WAS wrong: our text said Dead Precise applies -1 Dodge to the "attack
 * results" (Dodge is a defence result) and dropped "friendly" from both; and
 * Squad Cohesion had a live defender path, which "declares an attack" excludes
 * and which alexanbv ruled out on 2026-06-16.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abilitiesForCard } from '../../../src/engine/combat-ability-db.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const dc = (() => {
  const d = JSON.parse(readFileSync(resolve(root, 'data/dc-effects.json'), 'utf8'));
  return d.cards || d;
})();
const text = dc['Ko-Tun Feralo'].abilityText;
const rows = abilitiesForCard('Ko-Tun Feralo') || [];
const row = (a) => rows.find((r) => r.ability === a);

describe('Arms Distribution keeps its deploy half', () => {
  test('the text names both windows and one figure, one token', () => {
    assert.match(text,
      /Arms Distribution: After deployment and at the start of your activation, a friendly figure within 3 spaces may gain 1 Power Token\./);
    assert.ok(!/distribute 2 Power Tokens/.test(text), 'the stale "2 among up to 2" wording is gone');
  });

  test('the spec row names both windows too', () => {
    assert.match(row('Arms Distribution').timing, /post_deploy;start_of_activation/);
    assert.match(row('Arms Distribution').effect, /^After deployment and at the start of your activation,/);
  });

  test('and the deploy-time grant is still wired', () => {
    // The 2026-05-07 ruling ("1 at deploy + 1 at SoA") is the card, so this
    // path must NOT be removed as the stale art suggested.
    const src = readFileSync(resolve(root, 'src/handlers/post-deploy.js'), 'utf8');
    assert.match(src, /arms_distribution_deploy/);
    const soa = readFileSync(resolve(root, 'src/game/soa-orchestrator.js'), 'utf8');
    assert.match(soa, /arms_distribution_kotun/);
  });
});

describe('Dead Precise: friendly, up to 1, and DEFENSE results', () => {
  test('the text matches the card', () => {
    assert.match(text,
      /Dead Precise: While a friendly figure within 3 spaces is attacking, if that figure spent a power token during that attack, that figure may reroll up to 1 attack die and apply -1 Dodge to the defense results\./);
  });

  test('-1 Dodge lands on the DEFENCE results, not the attack results', () => {
    // Dodge is a defence-die result; "attack results" was simply wrong.
    assert.ok(!/-1 Dodge to the attack results/.test(text));
    assert.match(row('Dead Precise').effect, /-1 Dodge to the defense results/);
  });

  test('both halves are friendly-scoped, in the row and in the aura', () => {
    assert.match(row('Dead Precise').affects_others, /a friendly figure within 3 spaces/);
    assert.match(row('Dead Precise').conditional, /a friendly figure within 3 spaces is attacking/);
    // The -1 Dodge rider's aura enumerates only the affected figure's OWN team,
    // so "friendly" is structural rather than a string in a condition.
    const cond = readFileSync(resolve(root, 'src/engine/combat-conditions.js'), 'utf8');
    const branch = cond.slice(cond.indexOf("case 'within_n_of_source'"));
    assert.match(branch.slice(0, 2000), /const team = game\.figurePositions\?\.\[aff\.pn\] \|\| \{\};/,
      'the aura only looks at the affected figure\'s team');
  });

  test('the reroll survives — it is the card, not a phantom', () => {
    assert.match(row('Dead Precise').pipelines, /reroll/);
    assert.match(text, /may reroll up to 1 attack die/);
  });
});

describe('Squad Cohesion is attacker-only, on every path', () => {
  const src = readFileSync(resolve(root, 'src/handlers/combat.js'), 'utf8');

  test('the inline prep no longer builds a defender pool', () => {
    assert.ok(!/getSquadCohesionTokens\(game, combat, 'defender'\)/.test(src),
      'the defender pool was built here for months after the 2026-06-16 ruling');
    assert.match(src, /delete combat\.squadCohesionTokens\.defender;/,
      'and a pool carried in from a save mid-attack is cleared');
  });

  test('the defender token window no longer opens on cohesion alone', () => {
    assert.ok(!/hasDefCohesion/.test(src),
      'a defender with no token of its own must get no window');
  });

  test('the gate path still agrees, so both paths now say the same thing', () => {
    const tokens = readFileSync(resolve(root, 'src/engine/combat-abilities-tokens.js'), 'utf8');
    assert.match(tokens, /if \(side !== 'attacker'\) return false;/);
    assert.match(src, /side === 'attacker' \? getSquadCohesionTokens\(game, combat, side\) : null/);
  });

  test('the card text is unchanged — it was already right', () => {
    assert.match(text,
      /Squad Cohesion: When a friendly REBEL figure within 3 spaces declares an attack, it may spend a Power Token from a friendly REBEL figure within 3 spaces of itself for its effect\./);
  });
});

describe('the innate band is still Professional alone', () => {
  test('the current card confirms the +3 Accuracy removal was right', () => {
    assert.deepEqual(dc['Ko-Tun Feralo'].abilities, ['Professional']);
    assert.ok(dc['Ko-Tun Feralo'].surgeAbilities.includes('accuracy 3'), 'it is a surge');
    assert.equal(row('+3 Accuracy'), undefined, 'and not an attack modifier row');
  });

  test('her stat line matches the posted card', () => {
    const k = dc['Ko-Tun Feralo'];
    assert.equal(k.cost, 7);
    assert.equal(k.health, 11);
    assert.equal(k.speed, 4);
    assert.deepEqual(k.defense, ['black']);
    assert.deepEqual(k.attack, { dice: ['blue', 'blue', 'green'], type: 'range' });
  });
});
