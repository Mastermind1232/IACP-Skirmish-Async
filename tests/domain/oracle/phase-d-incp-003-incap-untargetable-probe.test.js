/**
 * Phase-D probe: an incapacitated figure cannot be targeted by attacks,
 * abilities, or game effects (except where a mission rule explicitly
 * overrides this, e.g. INCP-004 massive push).
 *
 * PROBE-PD-INCP-003: CRR INCAPACITATED — "An incapacitated figure cannot
 *   suffer damage or be targeted/affected by attacks, abilities, or
 *   game effects (except as specified by mission rules); its abilities
 *   are not available."
 *
 * Implementation: the current skirmish substrate for incapacitation is
 *   The Child's Force Exhaustion reaction (combat-reactions.js:806 sets
 *   `game.childIncapacitated = true`). The attack-target builder in
 *   `src/handlers/dc-play-area.js` excludes The Child from the legal
 *   target list while that flag is set, which is the key enforcement
 *   point for CRR-INCP-003.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const DPA_SRC = readFileSync(resolve(ROOT, 'src/handlers/dc-play-area.js'), 'utf8');

describe('PROBE-PD-INCP-003: incapacitated figures are untargetable by attacks', () => {
  it('003a: source — attack-target builder skips The Child when childIncapacitated is set', () => {
    assert.match(DPA_SRC,
      /if \(dcNameFromFigureKey\(k\) === 'the child' && game\.childIncapacitated\) continue;/,
      'dc-play-area.js must skip incapacitated Child in the target loop — CRR-INCP-003');
  });
});
