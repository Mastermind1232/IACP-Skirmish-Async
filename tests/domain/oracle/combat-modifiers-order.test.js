/**
 * CRR-COMBAT-MODIFIERS-ORDER: step-4 modifiers fire attacker first, then defender.
 *
 * CRR p.10–11 (Steps of an Attack):
 *   "4. Apply Modifiers: If players have any effects that add or remove symbols
 *    or Accuracy, they are applied at this time. At the end of this step each
 *    (evade) result cancels one (surge) result. Any abilities that provide
 *    modifiers are not resolved until step 5."
 *
 *   "An ability that allows a player to modify die results can only be used
 *    during step 4 of the attack."
 *
 * Per Destruct's CRR-anchored breakdown of step 4:
 *   "Modifiers stage. Attacker modifiers first, then defender."
 *
 * This test pins the source-level ordering so a future refactor can't silently
 * shuffle defender modifiers in front of attacker modifiers. Source-level
 * ordering is sufficient because each ability is a synchronous if-block that
 * either applies its bonus or returns to await player input — the file order
 * IS the runtime order.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const H_CB_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat.js'), 'utf8');

/**
 * Locate the offset of the unique anchor string for an ability's modifier block.
 * Anchors chosen to be unique enough to survive minor refactors but specific
 * enough to fail loudly if the block is removed.
 */
function offsetOf(anchor) {
  const idx = H_CB_SRC.indexOf(anchor);
  assert.notStrictEqual(idx, -1, `anchor not found: "${anchor}" — modifier block was removed or renamed`);
  return idx;
}

describe('CRR-COMBAT-MODIFIERS-ORDER: step-4 attacker modifiers fire before defender modifiers', () => {
  it('attacker-side modifiers (Call the Shots / Heavy Repeater / Lasat Honor Guard / Pulse Cannon / Negotiate) precede defender-side modifiers (Agile / Defensible / Get Down / Elusive / Defensive Stance / Soresu / Lucky)', () => {
    // Attacker-side anchors
    const ATK = {
      callTheShots: offsetOf('// Call the Shots (Hera)'),
      heavyRepeater: offsetOf('// Heavy Repeater (Paz Vizsla)'),
      lasatHonorGuard: offsetOf('// Lasat Honor Guard (Zeb Orrelios)'),
      pulseCannon:   offsetOf('// Pulse Cannon (Iden Versio)'),
      negotiate:     offsetOf('// Negotiate (Hondo)'),
    };
    // Defender-side anchors
    const DEF = {
      agile:           offsetOf('// Agile (Jet Trooper E/R)'),
      defensible:      offsetOf('// Defensible (SC2-M)'),
      getDown:         offsetOf('// Get Down (Onar Koma)'),
      elusive:         offsetOf('// Elusive (CC)'),
      defensiveStance: offsetOf('// Defensive Stance (Diala Passil)'),
      // Soresu Form's declaration grant was moved to the gate rerolls window
      // (bespoke resolver) — no longer a declaration-order modifier here.
      lucky:           offsetOf('// Lucky (R2-D2)'),
    };
    const maxAtk = Math.max(...Object.values(ATK));
    const minDef = Math.min(...Object.values(DEF));
    assert.ok(maxAtk < minDef,
      `Attacker modifiers must fire before defender modifiers (CRR p.10 step 4 + Destruct).\n` +
      `  last attacker offset:  ${maxAtk}\n` +
      `  first defender offset: ${minDef}`);
  });

  it('evade-cancels-surge runs after all step-4 modifiers (last in the modifier sequence)', () => {
    // The evade-cancels-surge calculation lives in proceedAfterTokens. It must
    // come after all modifier blocks since it operates on final block/evade/surge totals.
    const evadeAnchor = offsetOf('// Evade cancels surge');
    const lastDefAnchor = offsetOf('// Lucky (R2-D2)');
    assert.ok(evadeAnchor > lastDefAnchor,
      'Evade-cancels-surge must run after the last defender modifier — CRR step 4 ("at the end of this step")');
  });

  it('Pulse Cannon and Negotiate live in proceedAfterRerolls (step 4), not proceedAfterTokens (step 5+)', () => {
    // After the slice-2 refactor, ATK modifiers fully consolidate in proceedAfterRerolls.
    const pAfterRerolls = H_CB_SRC.match(/export async function proceedAfterRerolls\(thread, game, combat, ctx\) \{[\s\S]*?^}/m);
    assert.ok(pAfterRerolls, 'proceedAfterRerolls body must be locatable');
    assert.match(pAfterRerolls[0], /Pulse Cannon \(Iden Versio\)/,
      'Pulse Cannon must live in proceedAfterRerolls (step 4 attacker modifier)');
    assert.match(pAfterRerolls[0], /Negotiate \(Hondo\)/,
      'Negotiate must live in proceedAfterRerolls (step 4 attacker modifier)');
  });
});
