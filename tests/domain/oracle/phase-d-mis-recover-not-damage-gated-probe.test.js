/**
 * Phase-D probe: on a miss, non-damage-gated attack effects (such as the
 * Recover surge keyword) can still be triggered.
 *
 * PROBE-PD-MIS-004: CRR MISSES — "On a miss, non-damage-gated effects
 *   (such as the Recover keyword) can still be triggered."
 *
 * Implementation (post slice 2b — destruct 2026-05-08):
 *   Recover is now enqueued onto combat.afterAttackEffects via
 *   enqueueAttackerStep8Effects in src/handlers/after-attack-resolve.js
 *   and fired by the attacker via the post-resolve button window. The
 *   enqueue gate has NO hit/damage predicate — only `surgeRecover > 0
 *   && attackerMsgId != null`. Sustained-by-Rage zeroes surgeRecover
 *   upstream in combat-bridge.js BEFORE enqueue. Damage-gated keywords
 *   (Blast, Cleave) DO have `hit && damage > 0` gates in the same
 *   enqueue function — proving the contrast.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const CB_SRC = readFileSync(resolve(ROOT, 'src/engine/combat-bridge.js'), 'utf8');
const H_CB_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat.js'), 'utf8');
const AAR_SRC = readFileSync(resolve(ROOT, 'src/handlers/after-attack-resolve.js'), 'utf8');

describe('PROBE-PD-MIS-004: Recover (non-damage-gated) still fires on a miss', () => {
  it('004a: source — Recover enqueue gate is free of hit/damage predicates (only surgeRecover + attackerMsg)', () => {
    assert.match(AAR_SRC,
      /if \(\(combat\.surgeRecover \|\| 0\) > 0 && combat\.attackerMsgId != null\) \{\s*\n\s*enqueueAfterAttackEffect\(combat, \{\s*\n\s*side: 'attacker',\s*\n\s*type: 'recover'/,
      'Recover enqueue must require only surgeRecover > 0 + attackerMsg, no hit/damage gate — CRR-MIS-004');
  });

  it('004b: source — rule intent is documented at the enqueue site', () => {
    assert.match(AAR_SRC,
      /\/\/ Recover N — heal attacker\. Sustained by Rage blocks own Recover/,
      'Recover non-damage-gated rule must be commented at the enqueue site — CRR-MIS-004');
  });

  it('004c: source — Sustained-by-Rage zero-out happens upstream in combat-bridge BEFORE enqueue', () => {
    assert.match(CB_SRC,
      /const _sbrBlockRecover = getDcEffects\(\)\?\.\[combat\.attackerDcName\]\?\.specialAbilityIds\?\.includes\('sustained_by_rage'\);\s*\n\s*if \(_sbrBlockRecover\) combat\.surgeRecover = 0;/,
      'Sustained-by-Rage must zero surgeRecover before the queue is built — CRR-MIS-004 + SbR rule');
  });

  it('004d: source — by contrast, Blast IS damage-gated (hit && damage > 0) in the enqueue helper', () => {
    assert.match(AAR_SRC,
      /if \(hit && damage > 0 && totalBlast > 0\) \{[\s\S]{0,200}?type: 'blast'/,
      'Blast enqueue must require hit && damage > 0 — CRR-MIS-005 counterpart, CRR-MIS-004 contrast');
  });

  it('004e: source — surgeRecover accumulates during surge-spending with no hit/damage predicate', () => {
    assert.match(H_CB_SRC,
      /combat\.surgeRecover = \(combat\.surgeRecover \|\| 0\) \+ \(mod\.recover \?\? 0\);/,
      'surgeRecover accumulator must exist (surge spending happens regardless of hit) — CRR-MIS-004');
  });
});
