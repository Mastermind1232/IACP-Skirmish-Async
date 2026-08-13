/**
 * Phase-D probe: Form Cards are unique per army — no two figures on
 * the same team may have the same Form. In skirmish, only Clawdite
 * Shapeshifter picks forms, so the rule collapses to "no two
 * Clawdites on the same team can share a form."
 *
 * PROBE-PD-FRM-003: CRR FORM CARDS — "Form Cards are unique: only 1
 *   copy of each Form card can be in play at a time; in skirmish,
 *   only 1 copy per army."
 *
 * Implementation:
 *   - `getFormsChosenByTeamClawdites(game, playerNum, excludeFigureKey)`
 *     in `src/game/figure-config.js` walks the player's Clawdite
 *     Shapeshifter figures and returns the Set of forms already
 *     taken (excluding the currently-picking figure).
 *   - Every form-pick site filters `Object.keys(formCards)` by
 *     `!takenForms.has(name)` BEFORE showing the option buttons
 *     (setup.js line 1636-1637, round.js line 1138-1139 and
 *     1395-1396). The Shape/Shift round-level form pick uses the
 *     same helper.
 *   - The form-commit path in setup.js line 1831-1838 re-checks
 *     `takenForms.has(formName)` and rejects with an error message
 *     if another Clawdite already has that form — double-check at
 *     commit time in case UI state went stale.
 *   - Skirmish has no non-Clawdite form-consumer, so per-team
 *     uniqueness = per-army uniqueness.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const FC_SRC = readFileSync(resolve(ROOT, 'src/game/figure-config.js'), 'utf8');
const SU_SRC = readFileSync(resolve(ROOT, 'src/handlers/setup.js'), 'utf8');
const RD_SRC = readFileSync(resolve(ROOT, 'src/handlers/round.js'), 'utf8');

describe('PROBE-PD-FRM-003: Form cards are unique per army — form-pick filter + commit-time rejection', () => {
  it('003a: source — getFormsChosenByTeamClawdites walks the same-team Clawdite figures and collects their forms (excluding the picking figure)', () => {
    assert.match(FC_SRC,
      /export function getFormsChosenByTeamClawdites\(game, playerNum, excludeFigureKey\) \{[\s\S]*?if \(fk === excludeFigureKey\) continue;[\s\S]*?if \(!fk\.startsWith\('Clawdite Shapeshifter'\)\) continue;[\s\S]*?const form = getConfig\(game, fk\)\?\.form;[\s\S]*?if \(form\) taken\.add\(form\);/,
      'helper must collect forms from same-team Clawdites, excluding the picking figure — CRR-FRM-003');
  });

  it('003b: source — setup.js filters the form-pick buttons by `!takenForms.has(n)` (no already-taken form appears as an option)', () => {
    assert.match(SU_SRC,
      /const takenForms = getFormsChosenByTeamClawdites\(game, playerNum, figureKey\);\s*\n\s*const formNames = Object\.keys\(formCards\)\.filter\(n => !takenForms\.has\(n\)\);/,
      'setup.js must filter the form-pick list by takenForms — CRR-FRM-003');
  });

  it('003c: source — setup.js form-commit path rejects a form already chosen by another Clawdite on the same team (commit-time double-check)', () => {
    assert.match(SU_SRC,
      /const takenForms = getFormsChosenByTeamClawdites\(game, ownerPlayerNum, figureKey\);\s*\n\s*if \(takenForms\.has\(formName\)\) \{[\s\S]*?already chosen by another Clawdite on your team/,
      'setup.js commit path must reject already-taken forms — CRR-FRM-003');
  });

  it('003d: source — round.js Shape/Shift in-round form pick uses the same helper (no second, divergent uniqueness rule)', () => {
    // Was >=2 until 2026-08-13. The second call site was in a DUPLICATED
    // start-of-round ability block that fired every round on top of the real
    // one — Brash, Excavation, Force Slow and Shift all resolved twice. Removing
    // the duplicate removed one of the two call sites, so this test failed on
    // the FIX rather than on a regression: it had quietly codified the bug.
    //
    // The stated intent — "no second, divergent uniqueness rule" — is what
    // matters, and one shared helper satisfies it. Assert the helper is used at
    // all, and that no hand-rolled alternative has crept in beside it.
    const hits = (RD_SRC.match(/getFormsChosenByTeamClawdites\(game, playerNum, _fk\)/g) || []).length;
    assert.ok(hits >= 1,
      `round.js Shape/Shift flow must call getFormsChosenByTeamClawdites (found ${hits}) — CRR-FRM-003`);
    assert.ok(!/formsChosen|takenForms\s*=\s*new Set\(\[/.test(RD_SRC.replace(/getFormsChosenByTeamClawdites\([^)]*\)/g, '')),
      'no divergent, hand-rolled form-uniqueness rule may exist beside the helper');
  });
});
