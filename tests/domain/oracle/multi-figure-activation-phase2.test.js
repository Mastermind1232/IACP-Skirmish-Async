/**
 * Behavioral oracle for multi-figure activation Phase 2 (UI gating).
 *
 * Per destruct 2026-05-07: "Multifigure group activations are done figure
 * by figure. Each figure 2 actions, complete one figure before the other."
 *
 * Phase 1 (commit 9b447f49): figureCount * 2 total actions, per-figure
 * tracking via consumeActionForCurrentFigure.
 *
 * Phase 2 (this file): UI gating
 * - dropdown excludes locked figures
 * - action buttons disable when current figure has 0 actions remaining
 * - End Figure button forfeits remaining + locks current figure
 * - selectedFigure cleared when figure locks (force re-pick)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { consumeActionForCurrentFigure } from '../../../src/game/activation-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
function readSrc(p) { return readFileSync(join(ROOT, p), 'utf8'); }

test('consumeActionForCurrentFigure: clears selectedFigure when figure locks', () => {
  const actionsData = {
    remaining: 4,
    total: 4,
    selectedFigure: 0,
    perFigureRemaining: { 0: 2, 1: 2 },
    figureLocked: {},
  };
  consumeActionForCurrentFigure(actionsData, 1);
  assert.equal(actionsData.perFigureRemaining[0], 1);
  assert.equal(actionsData.figureLocked[0], undefined, 'still has 1 action — not locked');
  assert.equal(actionsData.selectedFigure, 0, 'selectedFigure unchanged');

  consumeActionForCurrentFigure(actionsData, 1);
  assert.equal(actionsData.perFigureRemaining[0], 0);
  assert.equal(actionsData.figureLocked[0], true, 'locked after 2nd action');
  assert.equal(actionsData.selectedFigure, null,
    'selectedFigure cleared so dropdown re-prompts for next figure');
});

test('consumeActionForCurrentFigure: 2-action special locks immediately', () => {
  const actionsData = {
    remaining: 4,
    total: 4,
    selectedFigure: 0,
    perFigureRemaining: { 0: 2, 1: 2 },
    figureLocked: {},
  };
  consumeActionForCurrentFigure(actionsData, 2);
  assert.equal(actionsData.perFigureRemaining[0], 0);
  assert.equal(actionsData.figureLocked[0], true);
  assert.equal(actionsData.selectedFigure, null);
  // Group remaining decremented by 2; figure 1's budget intact
  assert.equal(actionsData.remaining, 2);
  assert.equal(actionsData.perFigureRemaining[1], 2);
});

test('UI: dropdown excludes locked figures (components.js shape pin)', () => {
  // The components.js dropdown loop: `if (_figLocked[f]) continue;` — pin
  // the source pattern via regex so a refactor that drops the filter is
  // caught by this oracle.
  const src = readSrc('src/discord/components.js');
  assert.match(src,
    /if \(figures > 1\) \{[\s\S]*?for \(let f = 0; f < figures; f\+\+\) \{[\s\S]{0,200}if \(_figLocked\[f\]\) continue;/,
    'dropdown loop must filter locked figures');
});

test('UI: action buttons disabled when current figure out of actions', () => {
  const src = readSrc('src/discord/components.js');
  // _curFigOutOfActions is folded into noMove/noAttack/noAct.
  assert.match(src, /_curFigOutOfActions[\s\S]{0,400}noMove[\s\S]{0,200}_curFigOutOfActions/,
    'noMove gate includes _curFigOutOfActions');
  assert.match(src, /noAttack[\s\S]{0,200}_curFigOutOfActions/,
    'noAttack gate includes _curFigOutOfActions');
  assert.match(src, /noAct[\s\S]{0,200}_curFigOutOfActions/,
    'noAct gate includes _curFigOutOfActions');
});

test('UI: End Figure button surfaced when other unlocked figures exist', () => {
  const src = readSrc('src/discord/components.js');
  assert.match(src, /dc_end_figure_\$\{msgId\}_f\$\{selectedFigure\}/,
    'End Figure button customId pattern present');
  assert.match(src, /_hasOtherUnlocked/,
    'End Figure button gated on having other unlocked figures');
});

test('Handler: dc_end_figure_ registered + handler exported', () => {
  const idx = readSrc('src/handlers/index.js');
  assert.match(idx, /register\('dc_end_figure_', handleDcEndFigure/,
    'dc_end_figure_ prefix registered to handleDcEndFigure');
});
