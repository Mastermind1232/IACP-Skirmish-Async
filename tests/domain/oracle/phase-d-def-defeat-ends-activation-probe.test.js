/**
 * Phase-D probe: if a figure is defeated during its activation, its
 * activation ends.
 *
 * PROBE-PD-DEF-005: CRR DEFEATED — "If a figure is defeated during
 *   its activation, its activation ends."
 *
 * Implementation: defeat is a position-delete. `removeFigurePosition`
 *   in `src/game/player-helpers.js` deletes `game.figurePositions[pn]
 *   [figureKey]` (along with device tokens and conditions). Every
 *   defeat path flows through `processFigureDefeat` in
 *   `src/engine/defeat-handler.js`, whose Step 1 is that position
 *   delete. Once the position is gone:
 *     - `getAvailableActions` skips the whole DC if no survivors
 *       remain (`hasSurvivors` check)
 *     - Move is gated on `hasPosition` (the per-figure position flag)
 *     - Interact is gated on `pos` (the per-figure position)
 *     - Attack target computation returns `[]` if `!attackerPos`
 *   So a defeated figure is offered zero further actions; the engine
 *   naturally terminates its activation. Group-level activation-count
 *   decrement via `decrementActivationIfGroupDefeated` is a separate
 *   consequence (CRR-EXH-related), not the activation-ends rule
 *   itself.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const PH_SRC = readFileSync(resolve(ROOT, 'src/game/player-helpers.js'), 'utf8');
const DH_SRC = readFileSync(resolve(ROOT, 'src/engine/defeat-handler.js'), 'utf8');
const AA_SRC = readFileSync(resolve(ROOT, 'src/engine/available-actions.js'), 'utf8');

describe('PROBE-PD-DEF-005: a figure defeated during its activation has its activation end (no further actions offered)', () => {
  it('005a: source — removeFigurePosition deletes game.figurePositions[pn][figureKey] (the sole position-delete helper)', () => {
    assert.match(PH_SRC,
      /export function removeFigurePosition\(game, pn, figureKey\) \{[\s\S]*?delete game\.figurePositions\[pn\]\[figureKey\];/,
      'removeFigurePosition must delete the figure-position entry — CRR-DEF-005');
  });

  it('005b: source — processFigureDefeat Step 1 calls removeFigurePosition on the defeated figure', () => {
    assert.match(DH_SRC,
      /\/\/ 1\. Remove position \+ conditions \+ device tokens\s*\n\s*removeFigurePosition\(game, defeatedPlayerNum, figureKey\);/,
      'processFigureDefeat must remove the defeated figure position — CRR-DEF-005');
  });

  it('005c: source — getAvailableActions skips a DC entirely when all figures in the group have no position (group fully defeated)', () => {
    assert.match(AA_SRC,
      /\/\/ Skip if all figures for this DC are defeated \(no positions on board\)[\s\S]*?const hasSurvivors = Object\.keys\(figs\)\.some\(fk => fk\.startsWith\(meta\.dcName \+ '-'\)\);\s*\n\s*if \(!hasSurvivors\) continue;/,
      'getAvailableActions must skip DCs with no surviving figures — CRR-DEF-005');
  });

  it('005d: source — per-figure Move offer is gated on hasPosition (defeated figure cannot be offered Move)', () => {
    assert.match(AA_SRC,
      /const hasPosition = !!game\.figurePositions\?\.\[playerNum\]\?\.\[figureKey\];[\s\S]*?if \(!isStunned && hasPosition/,
      'Move offer must be gated on hasPosition — CRR-DEF-005');
  });

  it('005e: source — per-figure Interact offer is gated on the figure position (no position → no interact option)', () => {
    assert.match(AA_SRC,
      /const pos = game\.figurePositions\?\.\[playerNum\]\?\.\[figureKey\];\s*\n\s*if \(pos\) \{\s*\n\s*const interactOpts = getLegalInteractOptions/,
      'Interact offer must be gated on the figure position — CRR-DEF-005');
  });

  it('005f: source — attack target computation returns [] when the attacker has no position (defeated attacker has no targets)', () => {
    assert.match(AA_SRC,
      /const attackerPos = game\.figurePositions\?\.\[playerNum\]\?\.\[figureKey\];\s*\n\s*if \(!attackerPos\) return \[\];/,
      'Attack target computation must short-circuit to [] when attacker has no position — CRR-DEF-005');
  });
});
