// Tests for the power-token on_declare gate ability + the Vague and Unconvincing
// (K-2SO) token-spend lock-out. Run: node --test src/engine/combat-abilities-tokens.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import './combat-abilities-tokens.js'; // self-registers the token abilities
import { vagueAndUnconvincingLockoutActive } from './combat-abilities-tokens.js';
import { abilitiesForWindow } from './combat-timing-registry.js';

const find = (list, id) => list.find((a) => a.id === id);
const onDeclare = (side, game, combat, deps) => abilitiesForWindow('on_declare', side, game, combat, deps);

describe('vagueAndUnconvincingLockoutActive — derived from the pending combat', () => {
  it('true when the pending-combat DEFENDER is K-2SO (vague_and_unconvincing_k2s0)', () => {
    const game = { pendingCombat: { defenderPlayerNum: 2, target: { figureKey: 'K-2S0-2-0' } } };
    assert.equal(vagueAndUnconvincingLockoutActive(game), true);
  });
  it('false for a non-K-2SO defender or no pending combat', () => {
    assert.equal(vagueAndUnconvincingLockoutActive({ pendingCombat: { target: { figureKey: 'Stormtrooper-2-0' } } }), false);
    assert.equal(vagueAndUnconvincingLockoutActive({}), false);
  });
});

describe('Spend a Power Token (on_declare) — Vague and Unconvincing lock-out', () => {
  // The attacker holds a Damage token (normally spendable), but K-2SO is the
  // defender → the token-spend button is suppressed for BOTH sides this attack.
  const game = (defFk) => ({
    figurePowerTokens: { 'Atk-1-0': ['Damage'], 'Def-2-0': ['Block'] },
    pendingCombat: { attackerPlayerNum: 1, defenderPlayerNum: 2, target: { figureKey: defFk } },
  });
  const combat = (defFk) => ({ attackerFigureKey: 'Atk-1-0', attackerPlayerNum: 1, defenderPlayerNum: 2, target: { figureKey: defFk } });

  it('suppresses the attacker token-spend when K-2SO defends', () => {
    const g = game('K-2S0-2-0');
    assert.equal(find(onDeclare('attacker', g, combat('K-2S0-2-0'), {}), 'spend_token:attacker'), undefined);
  });
  it('still offers the attacker token-spend against a non-K-2SO defender', () => {
    const g = game('Stormtrooper-2-0');
    assert.equal(find(onDeclare('attacker', g, combat('Stormtrooper-2-0'), {}), 'spend_token:attacker')?.kind, 'interactive');
  });
  it('suppresses the defender token-spend when K-2SO defends (both players locked out)', () => {
    const g = game('K-2S0-2-0');
    assert.equal(find(onDeclare('defender', g, combat('K-2S0-2-0'), {}), 'spend_token:defender'), undefined);
  });
});
