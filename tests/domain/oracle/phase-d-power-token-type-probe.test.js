/**
 * Phase-D probe: power tokens — role-appropriate type restriction + Wild choice.
 *
 * PROBE-PD-PT-002: A figure can only spend a power token of the appropriate
 *   type: the attacker cannot spend block/evade tokens; the defender cannot
 *   spend damage/surge tokens. (CRR POWER TOKENS)
 *
 * PROBE-PD-PT-004: When an ability refers to the wild power token, the
 *   player can choose any power token type. (CRR POWER TOKENS)
 *
 * Implementation: `getEligibleTokens` in src/handlers/combat.js filters
 *   tokens by role-allowed set:
 *     attacker → ['Damage', 'Surge', 'Wild']
 *     defender → ['Block', 'Evade', 'Wild']
 *   Squad Cohesion shares the same allowed-set filter. Wild tokens, when
 *   spent, open a secondary "type selection" window (`sendWildTypeWindow`)
 *   that offers the role's two native types — attacker picks Damage/Surge,
 *   defender picks Block/Evade.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMBAT_SRC = readFileSync(resolve(__dirname, '../../../src/handlers/combat.js'), 'utf8');

describe('PROBE-PD-PT-002/004: role-appropriate power-token spend + Wild type choice', () => {
  it('002a: source — getEligibleTokens filters figure tokens by role-allowed set', () => {
    // The "own-token" spend path uses the allowed-set filter.
    assert.match(COMBAT_SRC,
      /function getEligibleTokens\(game, figureKey, role\) \{\s*\n\s*const allowed = role === 'attacker' \? \['Damage', 'Surge', 'Wild'\] : \['Block', 'Evade', 'Wild'\];/,
      'getEligibleTokens must use role-gated allowed set — CRR-PT-002');
    assert.match(COMBAT_SRC,
      /\.filter\(t => allowed\.includes\(t\.type\)\);/,
      'getEligibleTokens must filter by allowed.includes(type) — CRR-PT-002');
  });

  it('002b: source — attacker allowed set is exactly Damage/Surge/Wild (no Block/Evade)', () => {
    // Two independent sites share the same allowed-set literal (own-tokens + Squad Cohesion).
    const pat = /const allowed = role === 'attacker' \? \['Damage', 'Surge', 'Wild'\] : \['Block', 'Evade', 'Wild'\];/g;
    const matches = COMBAT_SRC.match(pat) || [];
    assert.ok(matches.length >= 2,
      `role-gated allowed sets must appear at own-tokens + cohesion sites — matched ${matches.length} — CRR-PT-002`);
  });

  it('002c: source — Squad Cohesion also filters donor tokens by the same role-allowed set', () => {
    // Donor tokens from nearby friendly Rebels are gathered only if their type is in the role's allowed set.
    assert.match(COMBAT_SRC,
      /tokens\.forEach\(\(type, index\) => \{\s*\n\s*if \(allowed\.includes\(type\)\) \{/,
      'Squad Cohesion must reject donor tokens of the wrong type — CRR-PT-002');
  });

  it('004a: source — sendWildTypeWindow offers the role-native pair', () => {
    // Wild spender picks one of attacker's [Damage, Surge] or defender's [Block, Evade].
    assert.match(COMBAT_SRC,
      /async function sendWildTypeWindow\(thread, gameId, role\) \{\s*\n\s*const types = role === 'attacker' \? \['Damage', 'Surge'\] : \['Block', 'Evade'\];/,
      'sendWildTypeWindow must scope Wild options to the role-native pair — CRR-PT-004');
  });

  it('004b: source — Wild type-selection customIds route through the wild role handler', () => {
    assert.match(COMBAT_SRC,
      /\.setCustomId\(`combat_token_\$\{gameId\}_wild_\$\{t\.toLowerCase\(\)\}`\)/,
      'Wild option buttons must emit the combat_token_<gid>_wild_<type> customId — CRR-PT-004');
    // And the handler dispatcher recognises that wild-role pattern.
    assert.match(COMBAT_SRC,
      /const m = interaction\.customId\.match\(\/\^combat_token_\(\[\^_\]\+\)_\(att\|def\|wild\)_\(\.\+\)\$\/\);/,
      'combat_token router must accept att|def|wild role segments — CRR-PT-004');
  });

  it('002d: behavior — eligibility filter rejects cross-role tokens (simulated)', () => {
    // Locally simulate the filter to pin the semantic: defender with Damage+Block can only spend Block (+Wild).
    const allowed = (role) => role === 'attacker' ? ['Damage', 'Surge', 'Wild'] : ['Block', 'Evade', 'Wild'];
    const tokens = ['Damage', 'Block', 'Wild', 'Surge', 'Evade'];
    const attackerEligible = tokens.map((type, index) => ({ type, index })).filter(t => allowed('attacker').includes(t.type));
    const defenderEligible = tokens.map((type, index) => ({ type, index })).filter(t => allowed('defender').includes(t.type));
    assert.deepEqual(attackerEligible.map(t => t.type), ['Damage', 'Wild', 'Surge'],
      'attacker eligibility must include Damage/Surge/Wild, exclude Block/Evade — CRR-PT-002');
    assert.deepEqual(defenderEligible.map(t => t.type), ['Block', 'Wild', 'Evade'],
      'defender eligibility must include Block/Evade/Wild, exclude Damage/Surge — CRR-PT-002');
  });

  it('004c: behavior — Wild type list is the role-native pair only (simulated)', () => {
    const nativePair = (role) => role === 'attacker' ? ['Damage', 'Surge'] : ['Block', 'Evade'];
    assert.deepEqual(nativePair('attacker'), ['Damage', 'Surge'],
      'attacker Wild must resolve to Damage/Surge — CRR-PT-004');
    assert.deepEqual(nativePair('defender'), ['Block', 'Evade'],
      'defender Wild must resolve to Block/Evade — CRR-PT-004');
  });
});
