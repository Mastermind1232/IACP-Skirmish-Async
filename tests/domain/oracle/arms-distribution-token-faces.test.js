/**
 * The "?" badge means any of the four power-token faces.
 *
 * alexanbv 2026-09-02: "? Is always any of the 4."
 *
 * Arms Distribution prints "?" and its start-of-activation prompt offered only
 * Damage and Block. The tell was that the DEPLOY half of the same ability
 * already offered all four, so the two halves of one card disagreed.
 *
 * Director Krennic's Advanced Weapons Research stays at two on purpose: its
 * card names the types outright ("1 Damage Token or 1 Surge Token") rather than
 * printing a "?", so it is not covered by the ruling.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const soa = readFileSync(resolve(root, 'src/handlers/soa-handler.js'), 'utf8');
const deploy = readFileSync(resolve(root, 'src/handlers/post-deploy.js'), 'utf8');
const dc = (() => {
  const d = JSON.parse(readFileSync(resolve(root, 'data/dc-effects.json'), 'utf8'));
  return d.cards || d;
})();

describe('Arms Distribution offers all four faces', () => {
  test('the start-of-activation prompt lists all four', () => {
    const block = soa.slice(soa.indexOf("subPromptKey === 'arms_distribution'"));
    const head = block.slice(0, 400);
    for (const t of ['damage', 'block', 'surge', 'evade']) {
      assert.ok(head.includes(`'${t}'`), `missing ${t}`);
    }
  });

  test('the deploy prompt still lists all four', () => {
    assert.match(deploy, /\['Damage', 'Surge', 'Block', 'Evade'\]\.map/);
  });

  test('both halves of the ability now agree', () => {
    // They did not before: deploy had four, start-of-activation had two.
    const soaBlock = soa.slice(soa.indexOf("subPromptKey === 'arms_distribution'"), soa.indexOf("subPromptKey === 'awr'"));
    const soaFaces = new Set((soaBlock.match(/'(damage|block|surge|evade)'/g) || []).map((s) => s.replace(/'/g, '')));
    assert.deepEqual([...soaFaces].sort(), ['block', 'damage', 'evade', 'surge']);
  });

  test('Long-Laid Plans, the other "?" ability, is unchanged at four', () => {
    assert.match(soa, /\['damage', 'block', 'surge', 'evade'\]\s*\n\s*\.filter\(\(t\) => !used\.includes\(t\)\)/);
  });
});

describe('Krennic keeps two, because his card names them', () => {
  test('the card text names Damage and Surge outright', () => {
    assert.match(dc['Director Krennic'].abilityText,
      /Advanced Weapons Research: At the start of your activation, a friendly figure within 2 spaces may gain 1 Damage Token or 1 Surge Token\./);
    assert.ok(!/\?/.test(dc['Director Krennic'].abilityText.split('\n')[0]), 'no "?" badge on this one');
  });

  test('so its prompt is still exactly Damage and Surge', () => {
    assert.match(soa, /subPromptKey === 'awr'\) return \[\{ key: 'damage'.*\{ key: 'surge'/);
    assert.ok(!/subPromptKey === 'awr'[\s\S]{0,200}'evade'/.test(soa), 'Krennic must not gain Evade');
  });
});

describe("Dead Precise's -1 Dodge fires while ATTACKING", () => {
  // alexanbv 2026-09-02: "Confirm that -dodge is used while attacking, not
  // while defending." Both halves of that are true and they are not the same
  // statement: the ability triggers on the ATTACKER's side, and what it reduces
  // is a result in the DEFENCE roll.
  const mods = readFileSync(resolve(root, 'src/engine/combat-abilities-mods.js'), 'utf8');
  const handlers = readFileSync(resolve(root, 'src/handlers/combat.js'), 'utf8');
  const gameCombat = readFileSync(resolve(root, 'src/game/combat.js'), 'utf8');

  test('it is registered on the attacker side', () => {
    assert.match(mods, /id: 'dead_precise_dodge', name: 'Dead Precise \(−1 Dodge\)', windows: \['mods'\], side: 'attacker'/);
  });

  test('and only when the ATTACKER spent a power token', () => {
    assert.match(mods, /applies: \(game, combat\) => !!combat\.attackerSpentPowerToken && _deadPreciseKoTunAura\(game, combat\)/);
    assert.match(mods, /_deadPreciseKoTunAura = makeCondition\(\{ type: 'within_n_of_source', card: 'Ko-Tun Feralo', n: 3, side: 'attacker' \}\)/);
  });

  test('what it reduces is the DEFENCE roll, per the card', () => {
    assert.match(handlers, /id === 'dead_precise_dodge'\)\s*\{\s*\n\s*combat\.bonusDodge = \(combat\.bonusDodge \|\| 0\) - 1;/);
    assert.match(gameCombat, /const _totalDodge = Math\.max\(0, \(defRoll\.dodge \|\| 0\) \+ \(combat\.bonusDodge \|\| 0\)\);/,
      'bonusDodge sums against the DEFENDER\'s rolled dodge');
  });

  test('and the log message says defense results, matching the card', () => {
    assert.match(handlers, /\*\*Dead Precise\*\* \(Ko-Tun within 3, Power Token spent\) — −1 Dodge to the defense results\./);
    assert.ok(!/Dead Precise\*\* \(Ko-Tun within 3, Power Token spent\) — −1 Dodge to the attack results/.test(handlers));
  });
});
