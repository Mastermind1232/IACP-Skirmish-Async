/**
 * Phase-D probe: a figure may interleave MP spending around other actions
 * in the same activation (Move → attack → continue moving).
 *
 * PROBE-PD-MOVE-012: CRR ACTIONS/MOVEMENT — "A figure may spend remaining
 *   MP before or after its next action in the same activation. MP carries
 *   forward within an activation; only ending the activation forfeits it."
 *
 * Implementation: the `dc_spend_mp_` button is exposed by
 *   `src/discord/components.js` whenever `game.movementBank[msgId].remaining
 *   > 0`. Its handler routes to `handleDcAction` with `action = 'SpendMp'`
 *   in `src/handlers/dc-play-area.js`. The SpendMp path:
 *     - bypasses the "no actions remaining" gate
 *       (`actionsRemaining <= 0 && action !== 'SpendMp'`),
 *     - reuses the existing bank (`mpRemaining = currentMp`, no speed
 *       addition),
 *     - and explicitly skips the per-Move action decrement
 *       (`if (!isSpendMp) { ... actData.remaining -= 1 ... }`).
 *   Because movementBank is msgId-keyed (activation-scoped) and
 *   cleanupActivation only wipes it at activation end (CRR-ACV-005),
 *   bank MP persists across other actions taken within the same
 *   activation.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const DCPA_SRC = readFileSync(resolve(ROOT, 'src/handlers/dc-play-area.js'), 'utf8');
const COMP_SRC = readFileSync(resolve(ROOT, 'src/discord/components.js'), 'utf8');
const IDX_SRC = readFileSync(resolve(ROOT, 'src/handlers/index.js'), 'utf8');

describe('PROBE-PD-MOVE-012: MP may be spent before or after another action (interleave)', () => {
  it('012a: source — dc_spend_mp_ handler is registered', () => {
    assert.match(IDX_SRC,
      /register\('dc_spend_mp_', \(i, ctx\) => handleDcAction\(i, ctx, 'dc_spend_mp_'\), 'dcPlayArea'\);/,
      'dc_spend_mp_ must be registered as a dcPlayArea button — CRR-MOVE-012');
  });

  it('012b: source — SpendMp button is surfaced whenever the per-figure bank remaining > 0', () => {
    // Per alexanbv 2026-06-13: MP is STRICTLY per-figure. The effective
    // MP read derives from the activating figure's own perFig sub-bank
    // (_spendFigBank.remaining), preferring its immediate sub-bank when
    // flagged _mustSpendImmediately. There is no top-level remaining.
    assert.match(COMP_SRC,
      /_effBankMp = _figImmediate \? \(_figImmediate\.remaining \?\? 0\) : \(_spendFigBank\?\.remaining \?\? 0\);/,
      'components must read the per-figure bank remaining (via effective per-figure read) — CRR-MOVE-012');
    assert.match(COMP_SRC,
      /const bankMp = _effBankMp;/,
      'SpendMp button reads the effective bank MP — CRR-MOVE-012');
    assert.match(COMP_SRC,
      /if \(bankMp > 0 && !hasActiveMoveSession && rows\.length < 5\) \{/,
      'SpendMp button appears whenever bank has MP (no gate on prior action taken) — CRR-MOVE-012');
  });

  it('012c: source — SpendMp bypasses the no-actions-remaining gate', () => {
    assert.match(DCPA_SRC,
      /if \(actionsRemaining <= 0 && action !== 'SpendMp'/,
      'SpendMp must be allowed even when actions are exhausted — CRR-MOVE-012');
  });

  it('012d: source — SpendMp reuses existing bank MP (no speed addition)', () => {
    assert.match(DCPA_SRC,
      /if \(isSpendMp\) \{[\s\S]{0,300}mpRemaining = currentMp;/,
      'SpendMp path uses currentMp (bank.remaining) without adding speed — CRR-MOVE-012');
  });

  it('012e: source — SpendMp does NOT consume a per-figure action', () => {
    assert.match(DCPA_SRC,
      /if \(!isSpendMp\) \{[\s\S]{0,400}consumeActionForCurrentFigure\(actData, 1, game, msgId\);/,
      'per-figure action consumption must be gated behind !isSpendMp — CRR-MOVE-012');
  });
});
