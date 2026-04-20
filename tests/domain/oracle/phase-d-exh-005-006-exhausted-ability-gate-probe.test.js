/**
 * Phase-D probe: exhausted DCs gate only the "activate this DC"
 * action, not other ability paths. Consequences:
 *   - EXH-005: when ALL of a player's DCs are exhausted, the player
 *     has no active figure → currentActivationTurnPlayerId is null →
 *     ctx.duringActivation is false → pre/during/post-activation
 *     abilities cannot be played. Lockout emerges from the
 *     activation state machine, not a dedicated gate.
 *   - EXH-006: passive and reaction abilities (played from hand or
 *     keyed to triggers like "when a friendly figure is defeated")
 *     are NOT filtered through the dcExhaustedState check. Only the
 *     ACTIVATE_DC action path filters by exhausted.
 *
 * PROBE-PD-EXH-005: CRR EXHAUSTED — "If all Deployment cards or
 *   activation tokens belonging to a player are exhausted, the
 *   player cannot use abilities that must be used before, during,
 *   or after the player's figure activates."
 * PROBE-PD-EXH-006: CRR EXHAUSTED — "Abilities on exhausted cards
 *   can be used as long as the abilities do not require the player
 *   to exhaust the card to use the ability."
 *
 * Implementation:
 *   - `src/engine/available-actions.js` checks
 *     `deps.dcExhaustedState?.get(msgId) ?? false` only inside the
 *     ACTIVATE_DC branch (line ~647). No other ability-offer branch
 *     in this file filters by exhausted state.
 *   - `src/game/cc-timing.js` derives `duringActivation` from
 *     `game.currentActivationTurnPlayerId === playerId` — a field
 *     set by the activation state machine and cleared when the
 *     activation ends. When every DC is exhausted, no DC can be
 *     activated (ACTIVATE_DC branch filters exhausted), so no
 *     activation opens and duringActivation stays false.
 *   - `cc-timing.js` routes no timing tag through dcExhaustedState —
 *     CC-triggered abilities never read the exhausted flag directly.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const AA_SRC = readFileSync(resolve(ROOT, 'src/engine/available-actions.js'), 'utf8');
const CT_SRC = readFileSync(resolve(ROOT, 'src/game/cc-timing.js'), 'utf8');

describe('PROBE-PD-EXH-005/006: exhausted gates only the activate-DC action; other ability paths remain open', () => {
  it('005a: source — available-actions.js filters only the ACTIVATE_DC action by exhausted (no other ability branch reads dcExhaustedState to block)', () => {
    assert.match(AA_SRC,
      /const exhausted = deps\.dcExhaustedState\?\.get\(msgId\) \?\? false;\s*\n\s*if \(exhausted\) continue;/,
      'available-actions.js must short-circuit the ACTIVATE_DC branch when exhausted — CRR-EXH-005');
    const reads = (AA_SRC.match(/dcExhaustedState\?\.get\(/g) || []).length;
    assert.equal(reads, 1,
      `available-actions.js must read dcExhaustedState at exactly one site (ACTIVATE_DC branch); found ${reads} — CRR-EXH-006`);
  });

  it('005b: source — cc-timing.js derives duringActivation from currentActivationTurnPlayerId (cleared when all DCs are exhausted → lockout emerges)', () => {
    assert.match(CT_SRC,
      /const duringActivation =\s*\n\s*!inSorWindow &&\s*\n\s*game\.currentActivationTurnPlayerId === playerId &&\s*\n\s*!game\.endOfRoundWhoseTurn;/,
      'cc-timing must derive duringActivation from currentActivationTurnPlayerId — CRR-EXH-005');
  });

  it('006a: source — cc-timing.js does NOT read dcExhaustedState for any timing tag (abilities not keyed on DC-exhaustion)', () => {
    assert.doesNotMatch(CT_SRC, /dcExhaustedState/,
      'cc-timing.js must not gate timings on dcExhaustedState — CRR-EXH-006');
  });
});
