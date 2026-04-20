/**
 * Phase-D probe: Step-4 end-of-step evade-cancels-surge arithmetic — each
 * evade cancels one surge before surge abilities are resolved.
 *
 * PROBE-PD-ATK-021: CRR ATTACKS — "Step 4 Apply Modifiers: add/remove
 *   symbols and Accuracy; at end of step each evade cancels one surge;
 *   surge abilities that provide modifiers are not resolved until Step 5."
 *
 * Implementation: in `src/handlers/combat.js`, Step-4 end-of-step
 *   produces the cancellation:
 *     const evadeCancelled = Math.min(rawSurge, totalEvade);
 *     const totalSurge = rawSurge - evadeCancelled;
 *     combat.evadeCancelledSurge = evadeCancelled;
 *   Surge-spending (surgeAbilities, affordable, and the user-facing
 *   selection UI) runs STRICTLY AFTER this arithmetic — pinned by
 *   source-ordering. The computeCombatResult consumer in
 *   `src/game/combat.js` reads `combat.evadeCancelledSurge` but never
 *   re-runs the cancellation, guaranteeing exactly one cancellation
 *   point.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const H_CB_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat.js'), 'utf8');
const G_CB_SRC = readFileSync(resolve(ROOT, 'src/game/combat.js'), 'utf8');

describe('PROBE-PD-ATK-021: evade cancels surge 1:1 at end of Step 4, before Step 5 spending', () => {
  it('021a: source — evadeCancelled is Math.min(rawSurge, totalEvade) in handler', () => {
    assert.match(H_CB_SRC,
      /const evadeCancelled = Math\.min\(rawSurge, totalEvade\);/,
      'evade must cancel surge 1:1 bounded by both sides — CRR-ATK-021');
  });

  it('021b: source — totalSurge is rawSurge minus evadeCancelled (no other deduction path)', () => {
    assert.match(H_CB_SRC,
      /const totalSurge = rawSurge - evadeCancelled;/,
      'post-cancellation surge pool must be a single subtraction — CRR-ATK-021');
    const hits = (H_CB_SRC.match(/const totalSurge = rawSurge - evadeCancelled;/g) || []).length;
    assert.equal(hits, 1,
      'there must be exactly one totalSurge computation — no fork path — CRR-ATK-021');
  });

  it('021c: source — rawSurge includes bonuses; evade cancellation happens AFTER all surge bonuses accumulate', () => {
    assert.match(H_CB_SRC,
      /const rawSurge = roll\.surge \+ surgeBonus \+ \(combat\.tokenSurgeBonus \|\| 0\);[\s\S]*?const evadeCancelled = Math\.min\(rawSurge, totalEvade\);/,
      'rawSurge (post-bonus) must be computed before evade cancels — CRR-ATK-021');
  });

  it('021d: source — surge-spending (Step 5) follows the cancellation in source order', () => {
    const cancelIdx = H_CB_SRC.indexOf('const evadeCancelled = Math.min(rawSurge, totalEvade);');
    const spendIdx = H_CB_SRC.indexOf('const surgeAbilities = getAttackerSurgeAbilities(combat);');
    assert.ok(cancelIdx > 0, 'cancellation site must be locatable');
    assert.ok(spendIdx > 0, 'surge-spending site must be locatable');
    assert.ok(spendIdx > cancelIdx,
      'surge abilities (Step 5) must be gathered AFTER evade cancellation (end of Step 4) — CRR-ATK-021');
  });

  it('021e: source — affordable-surge filter uses the post-cancellation totalSurge as its budget', () => {
    assert.match(H_CB_SRC,
      /const remaining = totalSurge;\s*\n\s*const affordable = surgeAbilities\.filter/,
      'surge-spending budget must be the post-cancellation totalSurge — CRR-ATK-021');
  });

  it('021f: source — computeCombatResult (game/combat.js) reads evadeCancelledSurge but does not recompute it', () => {
    assert.match(G_CB_SRC,
      /const evadeCancelled = combat\.evadeCancelledSurge \|\| 0;/,
      'computeCombatResult must read the already-computed cancellation — CRR-ATK-021');
    const recomputeHits = (G_CB_SRC.match(/Math\.min\(rawSurge, totalEvade\)/g) || []).length;
    assert.equal(recomputeHits, 0,
      'there must be no second cancellation site in game/combat.js — CRR-ATK-021');
  });
});
