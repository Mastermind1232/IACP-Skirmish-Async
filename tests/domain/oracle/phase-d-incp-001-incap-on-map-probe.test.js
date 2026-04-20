/**
 * Phase-D probe: CRR INCP-001 — "An incapacitated figure remains on the
 * map under the same player's control but does not restrict movement or
 * block line of sight; other figures cannot end movement in its space."
 *
 * Substrate: The Child's Force Exhaustion. When The Child's owner opts in
 * at combat-reactions.js:806, `game.childIncapacitated = true` is set. The
 * Child's position in game.figurePositions is never deleted (only the
 * flag is set), so it remains on the board under the same player's control.
 *
 * Implementation chain (invariant pin):
 *   1. combat-reactions.js Force-Exhaustion handler sets
 *      `game.childIncapacitated = true` and does NOT delete The Child's
 *      entry from game.figurePositions — pin "remains on the map under
 *      the same player's control".
 *   2. LOS-blocking: buildFigureBlockingCoords in dc-play-area.js and the
 *      parallel engine-side loop in available-actions.js both skip
 *      companion figures (`fkEff?.companion === true`). The Child is a
 *      companion in dc-effects.json, so its footprint is NEVER added to
 *      figureBlockingCoords regardless of incap status — pin "does not
 *      block line of sight".
 *   3. Movement restriction: getOccupiedSpacesForMovement in movement.js
 *      normally skips companions (G39: companions share spaces). The
 *      incap exception re-introduces the blockage only when the companion
 *      is incapacitated — pin "does not restrict movement (when healthy),
 *      but other figures cannot end movement in its space (when incap)".
 *   4. The incap-exception lives at movement.js as a narrow dcName ===
 *      'The Child' + game.childIncapacitated gate wrapping the companion
 *      skip.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const CR_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat-reactions.js'), 'utf8');
const DC_PA_SRC = readFileSync(resolve(ROOT, 'src/handlers/dc-play-area.js'), 'utf8');
const AA_SRC = readFileSync(resolve(ROOT, 'src/engine/available-actions.js'), 'utf8');
const MV_SRC = readFileSync(resolve(ROOT, 'src/game/movement.js'), 'utf8');
const DC_EFF = JSON.parse(readFileSync(resolve(ROOT, 'data/dc-effects.json'), 'utf8'));

describe('PROBE-PD-INCP-001: incapacitated figure stays on the map, does not block LOS, but blocks movement-end', () => {
  it('001a: source — Force-Exhaustion opt-in sets game.childIncapacitated = true (without deleting figurePositions)', () => {
    assert.match(CR_SRC,
      /if \(isYes\) \{\s*\n\s*\/\/ Incapacitate The Child\s*\n\s*game\.childIncapacitated = true;/,
      'Force-Exhaustion incap must set game.childIncapacitated and leave figurePositions intact — CRR-INCP-001');
    // Defensive: the Force-Exhaustion handler must not delete The Child from
    // figurePositions. The only documented removal paths are defeat (0 HP).
    assert.doesNotMatch(CR_SRC,
      /delete game\.figurePositions\?\.\[[^\]]+\]\?\.\[['"]The Child-/,
      'Force-Exhaustion must NOT delete The Child from figurePositions — CRR-INCP-001');
  });

  it('001b: data — The Child is a companion (dc-effects.json), so companion-skip rules apply to LOS/movement', () => {
    const child = DC_EFF.cards?.['The Child'] || DC_EFF.companions?.['The Child'] || DC_EFF['The Child'];
    assert.ok(child, 'The Child entry must exist in dc-effects.json — CRR-INCP-001');
    assert.equal(child.companion, true,
      'The Child must be marked companion: true — CRR-INCP-001');
  });

  it('001c: source — LOS-blocking (handler) skips companion figures → The Child never blocks LOS regardless of incap status', () => {
    assert.match(DC_PA_SRC,
      /if \(fkEff\?\.companion === true\) continue;/,
      'buildFigureBlockingCoords must skip companion figures — CRR-INCP-001');
  });

  it('001d: source — LOS-blocking (engine) also skips companion figures (parity with handler)', () => {
    assert.match(AA_SRC,
      /if \(fkEff\?\.companion === true\) continue;/,
      'engine-side target enumeration must skip companions in figureBlockingCoords — CRR-INCP-001');
  });

  it('001e: source — getOccupiedSpacesForMovement re-introduces the blockage when companion is incapacitated (exception to G39)', () => {
    // The surgical incap gate wraps the companion skip: companions are
    // skipped EXCEPT when the companion is The Child and it is incap.
    assert.match(MV_SRC,
      /const _isIncap = dcName === 'The Child' && game\.childIncapacitated;\s*\n\s*if \(isDcCompanion\(dcName\) && !_isIncap\) continue;/,
      'movement.js must include The Child\'s footprint in occupied-for-movement when incapacitated — CRR-INCP-001 clause (c)');
  });

  it('001f: cross-ref — CRR-INCP-003 is already covered on the same substrate (untargetable while incap); INCP-001 shares the same game.childIncapacitated flag', () => {
    const ledger = JSON.parse(readFileSync(resolve(ROOT, 'docs/crr-ledger.json'), 'utf8'));
    const incp003 = ledger.atoms.find(a => a.id === 'CRR-INCP-003');
    assert.ok(incp003, 'CRR-INCP-003 must exist in the ledger');
    assert.equal(incp003.status, 'covered',
      'CRR-INCP-003 must be covered — INCP-001 cross-reference');
  });
});
