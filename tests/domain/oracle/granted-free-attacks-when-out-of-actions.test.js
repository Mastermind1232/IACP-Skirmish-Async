/**
 * A GRANTED free attack must work when the figure has no actions left.
 *
 * alexanbv 2026-09-09, reporting BT-1: "moved and used missile salvo. After
 * clicking the red die option, the message showed no actions remaining and did
 * not proceed further. This is incorrect. Missile salvo is one action and the
 * whole of the one action is performing 3 attacks."
 *
 * The action gate in handleDcAction refused the attack before it ever reached
 * the code that decides whether to CHARGE for it. The charging site honoured
 * `freeAttackBonusPending`; the gate did not. Sequence for BT-1:
 *
 *   Move            -> action 1 spent
 *   Missile Salvo   -> action 2 spent, actionsRemaining = 0
 *   pick red die    -> forwards into dc_attack_ -> gate sees 0 actions -> refused
 *
 * Fell Swoop and Pummel had each been given their own named exemption, which is
 * why only those two worked. Every other ability that grants an attack was
 * broken the same way, so the fix is the FLAG rather than a third special case:
 * Missile Salvo, Heroic, Order Hit, Vader's Finest, Autofire, Fire Mission,
 * Darksaber Strike, Orbital Bombardment and Rapid Fire all set
 * freeAttackBonusPending.
 *
 * Pre-existing, not a regression: the gate was last touched 2026-04-06.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const src = readFileSync(resolve(root, 'src/handlers/dc-play-area.js'), 'utf8');
const gate = src.slice(src.indexOf('const hasFellSwoopFreeAttack'),
                       src.indexOf("await interaction.followUp({ content: 'No actions remaining this activation (2 per DC)."));

describe('the action gate exempts granted free attacks', () => {
  test('it reads freeAttackBonusPending, the general flag', () => {
    assert.match(gate, /const hasGrantedFreeAttack = action === 'Attack' && game\.freeAttackBonusPending\?\.\[_curActFigKey\] != null;/);
    assert.match(gate, /&& !hasGrantedFreeAttack/);
  });

  test('and pounceAttackPending, the other granted-attack flag', () => {
    assert.match(gate, /const hasPounceFreeAttack = action === 'Attack' && game\.pounceAttackPending\?\.\[_curActFigKey\] != null;/);
    assert.match(gate, /&& !hasPounceFreeAttack/);
  });

  test('the gate and the CHARGING site now use the same test', () => {
    // They disagreed before: `!= null` at the charge, absent at the gate. A
    // figure could be refused an attack the charging code would have made free.
    assert.match(src, /const isHeroicAttack = action === 'Attack' && game\.freeAttackBonusPending\?\.\[_ahFigureKey\] != null;/);
    assert.match(src, /const isPounceAttack = action === 'Attack' && game\.pounceAttackPending\?\.\[_ahFigureKey\] != null;/);
  });

  test('the exemptions apply to Attack only, never to Move or Interact', () => {
    for (const name of ['hasGrantedFreeAttack', 'hasPounceFreeAttack', 'hasFellSwoopFreeAttack', 'hasPummelFreeAttack']) {
      const line = gate.split('\n').find((l) => l.includes(`const ${name} =`));
      assert.ok(line, `${name} not found`);
      assert.match(line, /action === 'Attack'/, `${name} must be Attack-scoped`);
    }
  });

  test('the flag is consumed exactly once per free attack', () => {
    // Exempting the gate must not let a single grant be spent repeatedly: the
    // charging site decrements a count or deletes the key.
    assert.match(src, /const _fabCount = game\.freeAttackBonusPending\[_ahFigureKey\];/);
    assert.match(src, /if \(typeof _fabCount === 'number' && _fabCount > 1\) \{\s*\n\s*game\.freeAttackBonusPending\[_ahFigureKey\] = _fabCount - 1;/);
    assert.match(src, /delete game\.freeAttackBonusPending\[_ahFigureKey\];/);
  });
});

describe('Missile Salvo sets the flag the gate now honours', () => {
  const salvo = readFileSync(resolve(root, 'src/handlers/combat-special-effects.js'), 'utf8');

  test('each die pick marks the attack free before forwarding to the picker', () => {
    assert.match(salvo, /game\.freeAttackBonusPending\[_msFk\] = true;/);
    assert.match(salvo, /const newId = `dc_attack_\$\{msgId\}_f\$\{figureIndex\}`;/,
      'it forwards into the same handler the gate guards');
  });

  test('and it tells the player the attack is free, which it now is', () => {
    assert.match(salvo, /This attack costs no action\./);
  });

  test('the card is one action performing up to three attacks', () => {
    const dc = (() => {
      const d = JSON.parse(readFileSync(resolve(root, 'data/dc-effects.json'), 'utf8'));
      return d.cards || d;
    })();
    assert.match(dc['BT-1'].abilityText,
      /Special Action \(Missile Salvo\): Perform up to 3 Ranged attacks with different targets/);
    const lib = JSON.parse(readFileSync(resolve(root, 'data/ability-library.json'), 'utf8')).abilities;
    assert.equal(lib.missile_salvo.oncePer, 'activation', 'one use per activation, not one action per attack');
  });
});

describe('the grant is CONSUMED when the attack commits', () => {
  // Exempting the gate without consuming the flag would be worse than the
  // original bug: freeAttackBonusPending lives for the whole activation
  // (ACTIVATION_FIGKEY_FLAGS), so one grant would buy unlimited attacks at
  // zero actions. handleAttackTarget is where the attack actually commits and
  // is therefore where the flag must be spent.
  const combatSrc = readFileSync(resolve(root, 'src/handlers/combat.js'), 'utf8');

  test('handleAttackTarget now recognises the general flag at all', () => {
    // It previously referenced freeAttackBonusPending ZERO times, so every
    // granted free attack fell through to `consumeActionForCurrentFigure`.
    assert.match(combatSrc, /const isGrantedFreeAttack = game\.freeAttackBonusPending\?\.\[_attackerFkEarly\] != null;/);
  });

  test('a count grant decrements and a single-use grant clears', () => {
    assert.match(combatSrc, /const _fab = game\.freeAttackBonusPending\[_attackerFkEarly\];/);
    assert.match(combatSrc, /if \(typeof _fab === 'number' && _fab > 1\) \{[\s\S]{0,120}_fab - 1;/);
    assert.match(combatSrc, /delete game\.freeAttackBonusPending\[_attackerFkEarly\];/);
  });

  test('it short-circuits BEFORE the else that charges an action', () => {
    const chain = combatSrc.slice(combatSrc.indexOf('const isGrantedFreeAttack'));
    const upToCharge = chain.slice(0, chain.indexOf('consumeActionForCurrentFigure'));
    assert.match(upToCharge, /} else if \(isGrantedFreeAttack\) \{/);
    assert.ok(upToCharge.includes('isBLFreeAttack'), 'the per-ability markers still follow it');
  });

  test('the flag survives a whole activation, which is why consuming it matters', () => {
    const st = readFileSync(resolve(root, 'src/game/activation-state.js'), 'utf8');
    assert.match(st, /'freeAttackBonusPending'/, 'cleared only at activation end');
  });
});
