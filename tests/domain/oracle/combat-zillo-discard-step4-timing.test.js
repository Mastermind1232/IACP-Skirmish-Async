/**
 * CRR-COMBAT-ZILLO-DISCARD-STEP4: Zillo Technique's discard-CC for +1 Block
 * fires during step 4 (Apply Modifiers — defender modifiers), not at attack
 * declare.
 *
 * Card text (data/dc-effects.json: "[Zillo Technique]"):
 *   "While a friendly figure is defending, you may discard 1 Command card to
 *    apply +1 Block to the defense results. Limit once per attack."
 *
 * CRR p.10 (Steps of an Attack):
 *   "4. Apply Modifiers: If players have any effects that add or remove
 *    symbols or Accuracy, they are applied at this time."
 *
 * +1 Block to defense results = step-4 defender modifier. Per Destruct's
 * CRR-anchored ordering, defender modifiers fire after attacker modifiers.
 *
 * Old code prompted the defender at attack-declare time, before any rolls
 * or modifiers. That forced a CC discard commit before the defender knew
 * any attack outcome — wrong timing and bad UX (player committing blind).
 *
 * New flow: prompt is part of the DEF block of proceedAfterRerolls,
 * alongside Defensible / Get Down / Elusive / etc.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const H_CB_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat.js'), 'utf8');

describe('CRR-COMBAT-ZILLO-DISCARD-STEP4: discard-CC for +1 Block fires in step 4 DEF block', () => {
  it('attack-declare path no longer renders the Zillo discard-CC prompt', () => {
    // The declare-time block is now comments only.
    const declareBlock = H_CB_SRC.match(/Zillo Technique \(I51-I52\) defender's team SU[\s\S]*?Z-6 Trooper Rotary Cannon/);
    assert.ok(declareBlock, 'declare-site Zillo placeholder must exist (comments only)');
    assert.doesNotMatch(declareBlock[0], /Discard 1 Command card for \*\*\+1 Block\*\*/,
      'declare-time discard-CC prompt must be removed — moved to step-4 DEF block');
    assert.doesNotMatch(declareBlock[0], /pendingZilloDiscard\s*=/,
      'declare-time pendingZilloDiscard assignment must be removed');
  });

  it('proceedAfterRerolls DEF block contains the Zillo discard-CC prompt', () => {
    const fn = H_CB_SRC.match(/export async function proceedAfterRerolls\(thread, game, combat, ctx\) \{[\s\S]*?^}/m);
    assert.ok(fn, 'proceedAfterRerolls body must be locatable');
    const body = fn[0];
    assert.match(body, /Zillo Technique \(I51-I52\)[^\n]*discard 1 CC for \+1 Block/i,
      'proceedAfterRerolls must include the step-4 Zillo discard-CC block');
    assert.match(body, /combat\.zilloDiscardResolved/,
      'block must use a once-per-attack flag (combat.zilloDiscardResolved)');
    assert.match(body, /Discard 1 Command card for \*\*\+1 Block\*\*/,
      'block must render the discard-CC prompt text');
  });

  it('Zillo discard prompt sits in the DEF block (after Get Down, before Elusive) — defender modifier ordering', () => {
    // Verify offset ordering: Get Down (DEF) < Zillo discard prompt < Elusive (DEF)
    const getDownIdx = H_CB_SRC.indexOf('// Get Down (Onar Koma)');
    const zilloIdx = H_CB_SRC.indexOf('Zillo Technique (I51-I52) — discard 1 CC for +1 Block');
    const elusiveIdx = H_CB_SRC.indexOf('// Elusive (CC):');
    assert.notStrictEqual(getDownIdx, -1, 'Get Down anchor must exist');
    assert.notStrictEqual(zilloIdx,  -1, 'Zillo discard step-4 anchor must exist');
    assert.notStrictEqual(elusiveIdx,-1, 'Elusive anchor must exist');
    assert.ok(getDownIdx < zilloIdx, 'Zillo discard prompt must come AFTER Get Down (both DEF, +1 Block flavor)');
    assert.ok(zilloIdx < elusiveIdx, 'Zillo discard prompt must come BEFORE Elusive');
  });

  it('handleZilloDiscard re-enters proceedAfterRerolls after the choice (use or skip)', () => {
    const fn = H_CB_SRC.match(/export async function handleZilloDiscard\(interaction, ctx\) \{[\s\S]*?^}/m);
    assert.ok(fn, 'handleZilloDiscard body must be locatable');
    const body = fn[0];
    assert.match(body, /combat\.zilloDiscardResolved\s*=\s*true/,
      'must set the once-per-attack flag (Skip and use both consume the per-attack option)');
    assert.match(body, /proceedAfterRerolls\(thread, game, combat, ctx\)/,
      'must re-enter proceedAfterRerolls so subsequent DEF + surge + resolve steps fire');
  });
});
