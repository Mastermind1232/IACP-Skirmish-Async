/**
 * Phase-D probe: Bleeding damage flows through the HP-damage path
 * (`reduceHp`), not the voluntary-strain path (`applyStrainToFigure`).
 * The CRR distinction matters for abilities that trigger on/prohibit
 * "voluntarily suffering strain" — Bleeding must NOT count.
 *
 * PROBE-PD-BLED-003: CRR BLEEDING — "Damage suffered from Bleeding is
 *   not considered voluntarily suffering strain."
 *
 * Implementation: `handleBleedResolve` in
 *   `src/handlers/combat-special-effects.js` dispatches
 *   `bleed_accept_<gameId>_<pn>_<figureKey>` buttons. On accept it
 *   calls `reduceHp(dcHealthState, game, msgId, figureIndex, 1, playerNum)`
 *   directly — the generic HP-damage path — and NEVER routes through
 *   `applyStrainToFigure` (the voluntary-strain helper in
 *   `src/handlers/combat.js` used by Relentless, Keep the Peace,
 *   Heavy Repeater, Soresu Form, etc.). The Bleeding prompt in
 *   `sendBleedingPrompt` (src/engine/combat-bridge.js) offers "take
 *   damage" (not "take strain") — ie the prompt labels and the
 *   damage-reduction path both treat Bleeding as involuntary damage,
 *   not self-inflicted strain.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const CS_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat-special-effects.js'), 'utf8');
const CB_SRC = readFileSync(resolve(ROOT, 'src/engine/combat-bridge.js'), 'utf8');
const CM_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat.js'), 'utf8');

describe('PROBE-PD-BLED-003: Bleeding damage uses the HP-damage path, not the voluntary-strain helper', () => {
  it('003a: source — handleBleedResolve calls reduceHp directly on "accept" (generic HP-damage path)', () => {
    assert.match(CS_SRC,
      /export async function handleBleedResolve[\s\S]*?if \(action === 'accept'\) \{[\s\S]*?reduceHp\(dcHealthState, game, msgId, figureIndex, 1, playerNum\);/,
      'handleBleedResolve must reduce HP directly on accept — CRR-BLED-003');
  });

  it('003b: source — handleBleedResolve must NOT route Bleeding through applyStrainToFigure', () => {
    const bleedFn = CS_SRC.match(/export async function handleBleedResolve[\s\S]*?\n\}\s*\n/)[0];
    assert.doesNotMatch(bleedFn, /applyStrainToFigure/,
      'handleBleedResolve must not invoke applyStrainToFigure — CRR-BLED-003');
  });

  it('003c: source — the Bleeding prompt frames the cost as "1 damage", not "1 strain"', () => {
    assert.match(CB_SRC,
      /\*\*Bleeding\*\* — \*\*\$\{displayName\}\*\* suffers 1 damage after resolving their action/,
      'Bleeding prompt must say "suffers 1 damage" — CRR-BLED-003');
  });

  it('003d: source — applyStrainToFigure is reserved for voluntary self-strain abilities (Relentless/Keep the Peace/Heavy Repeater/Soresu), never for Bleeding', () => {
    // Verify the voluntary-strain helper exists and its call sites are voluntary ability costs.
    assert.match(CM_SRC, /async function applyStrainToFigure\(game, playerNum, figureKey, amount, abilityLabel, sourceLabel/,
      'applyStrainToFigure helper must exist with an abilityLabel parameter — CRR-BLED-003');
    const callSiteLabels = [...CM_SRC.matchAll(/applyStrainToFigure\([^)]*?'([^']+)',\s*'([^']*)',/g)].map(m => m[1]);
    assert.ok(callSiteLabels.length >= 3,
      `applyStrainToFigure must have multiple labeled call sites (found ${callSiteLabels.length}) — CRR-BLED-003`);
    const hasBleedCaller = callSiteLabels.some(l => /bleed/i.test(l));
    assert.ok(!hasBleedCaller,
      `no applyStrainToFigure call site may be labeled as Bleeding (labels: ${callSiteLabels.join(',')}) — CRR-BLED-003`);
  });
});
