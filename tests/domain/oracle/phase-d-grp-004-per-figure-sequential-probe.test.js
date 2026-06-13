/**
 * Phase-D probe: while activating a group of 2+ figures, each figure
 * resolves its activation independently — both actions for one figure
 * resolve before the next figure starts. In the engine this is
 * enforced by a single-pointer `selectedFigure` + a per-DC
 * action-count state machine that sequences the whole group.
 *
 * PROBE-PD-GRP-004: CRR GROUP — "each figure resolves its activation
 *   independently; resolve both actions for one figure before the
 *   next figure."
 *
 * Pinned companions (same FSM — covered_by_ref targets):
 *   - CRR-ACV-003 (intra-group figure order + both-actions-before-next)
 *   - CRR-ACV-008 (inter-action ability window)
 *   - CRR-ACT-003 (each action resolved completely before the next)
 *
 * Implementation: `game.dcActionsData[msgId]` is the per-DC activation
 *   FSM. It carries a single-integer `selectedFigure` pointer (the
 *   currently-resolving figure) and a `remaining` counter (action
 *   budget). All action buttons embed `f${selectedFigure}` in their
 *   customId and resolve against that one figure. Multi-figure group
 *   switching goes through `handleDcSwitchFig` in
 *   `src/handlers/activation.js`, which nulls `selectedFigure` back to
 *   the picker state — there is no parallel-figure action path.
 *   `getAvailableActions` in `src/engine/available-actions.js` reads
 *   `data.selectedFigure ?? 0` once and builds every offer against
 *   that single figure.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const AC_SRC = readFileSync(resolve(ROOT, 'src/handlers/activation.js'), 'utf8');
const AA_SRC = readFileSync(resolve(ROOT, 'src/engine/available-actions.js'), 'utf8');
const DP_SRC = readFileSync(resolve(ROOT, 'src/handlers/dc-play-area.js'), 'utf8');
const CP_SRC = readFileSync(resolve(ROOT, 'src/discord/components.js'), 'utf8');

function* walkFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walkFiles(p);
    else if (p.endsWith('.js')) yield p;
  }
}

describe('PROBE-PD-GRP-004: per-figure sequential resolution in a group (single-pointer selectedFigure FSM)', () => {
  it('004a: source — handleDcSwitchFig nulls game.dcActionsData[msgId].selectedFigure (exclusive single-figure pointer)', () => {
    assert.match(AC_SRC,
      /export async function handleDcSwitchFig[\s\S]*?game\.dcActionsData\[msgId\]\.selectedFigure = null;/,
      'handleDcSwitchFig must null selectedFigure — CRR-GRP-004');
  });

  it('004b: source — getAvailableActions reads data.selectedFigure (single integer) and builds action offers against that one figure', () => {
    assert.match(AA_SRC,
      /const data = game\.dcActionsData\?\.\[msgId\];[\s\S]*?const figureIndex = data\.selectedFigure \?\? 0;/,
      'available-actions.js must read selectedFigure as the single current figure — CRR-GRP-004');
  });

  it('004c: source — available-actions gates on anyFigureHasActions (per-figure action counter gates each figure independently)', () => {
    assert.match(AA_SRC,
      /const data = game\.dcActionsData\?\.\[msgId\];\s*\n\s*if \(!data \|\| !anyFigureHasActions\(data\)\) continue;/,
      'available-actions.js must gate action-offering on anyFigureHasActions(data) — CRR-ACT-003');
  });

  it('004d: source — dc-play-area.js action handlers uniformly resolve against data.selectedFigure (no parallel per-figure action paths)', () => {
    const selReads = DP_SRC.match(/actionsData\?\.selectedFigure \?\? 0/g) || [];
    assert.ok(selReads.length >= 4,
      `dc-play-area.js must read actionsData.selectedFigure uniformly (found ${selReads.length} sites) — CRR-GRP-004`);
  });

  it('004e: source — Discord components embed f${selectedFigure} in action button customIds (button UI reflects the single-figure pointer)', () => {
    // Stun/Move/Attack/Interact buttons all tag the customId with the active figure index.
    assert.match(CP_SRC, /setCustomId\(`dc_remove_stun_\$\{msgId\}_f\$\{selectedFigure\}`\)/,
      'Remove-Stun button must embed f${selectedFigure} — CRR-GRP-004');
    assert.match(CP_SRC, /setCustomId\(`dc_move_\$\{msgId\}_f\$\{selectedFigure\}`\)/,
      'Move button must embed f${selectedFigure} — CRR-GRP-004');
    assert.match(CP_SRC, /setCustomId\(`dc_attack_\$\{msgId\}_f\$\{selectedFigure\}`\)/,
      'Attack button must embed f${selectedFigure} — CRR-GRP-004');
    assert.match(CP_SRC, /setCustomId\(`dc_interact_\$\{msgId\}_f\$\{selectedFigure\}`\)/,
      'Interact button must embed f${selectedFigure} — CRR-GRP-004');
  });

  it('004f: source — no src file declares a parallel-figure action dispatcher (no simultaneous-figure state)', () => {
    const hits = [];
    for (const p of walkFiles(resolve(ROOT, 'src'))) {
      const src = readFileSync(p, 'utf8');
      if (/parallelFigures|simultaneousFigures|multiFigureActive\b|activeFigureSet\b/.test(src)) {
        hits.push(p.replace(ROOT + '/', ''));
      }
    }
    assert.deepEqual(hits, [],
      'no src file may declare a parallel-figure activation container — CRR-GRP-004');
  });
});
