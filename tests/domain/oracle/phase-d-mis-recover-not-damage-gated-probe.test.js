/**
 * Phase-D probe: on a miss, non-damage-gated attack effects (such as the
 * Recover surge keyword) can still be triggered.
 *
 * PROBE-PD-MIS-004: CRR MISSES — "On a miss, non-damage-gated effects
 *   (such as the Recover keyword) can still be triggered."
 *
 * Implementation: `src/engine/combat-bridge.js` applies surge-Recover
 *   healing OUTSIDE the hit/damage branch chain. The Recover branch's
 *   only guards are `surgeRecover > 0`, an attacker-msgId check, and an
 *   opt-out for Sustained-by-Rage — no `hit`, no `damage > 0`, no miss
 *   predicate. The inline comment documents the rule explicitly. By
 *   contrast, damage-gated surge effects (Cleave) live behind a
 *   `hit && damage > 0` gate in the same file, and CRR-MIS-005 pins that
 *   those effects DO NOT fire on miss.
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

describe('PROBE-PD-MIS-004: Recover (non-damage-gated) still fires on a miss', () => {
  it('004a: source — Recover heal branch has no hit/damage guard; only surgeRecover > 0 + attacker-msg + SbR opt-out', () => {
    assert.match(CB_SRC,
      /if \(combat\.surgeRecover > 0 && combat\.attackerMsgId != null && !_sbrBlockRecover\) \{\s*\n\s*healHp\(dcHealthState, game, combat\.attackerMsgId, combat\.attackerFigureIndex \?\? 0, combat\.surgeRecover \|\| 0, combat\.attackerPlayerNum\);\s*\n\s*\}/,
      'Recover heal gate must be free of hit/damage predicates — CRR-MIS-004');
  });

  it('004b: source — rule intent is documented: "heal attacker even if attack dealt 0 damage"', () => {
    assert.match(CB_SRC,
      /\/\/ Recover keyword: heal attacker even if attack dealt 0 damage \(rules: RECOVER\)/,
      'the non-damage-gated rule must be commented at the heal site — CRR-MIS-004');
  });

  it('004c: source — Recover heal lives OUTSIDE (after) the hit/damage branch chain', () => {
    const chainEndIdx = CB_SRC.indexOf("} else if (damage > 0) {");
    const recoverIdx = CB_SRC.indexOf('if (combat.surgeRecover > 0 && combat.attackerMsgId != null && !_sbrBlockRecover)');
    assert.ok(chainEndIdx > 0, 'hit/damage logging chain must be locatable');
    assert.ok(recoverIdx > 0, 'Recover heal gate must be locatable');
    assert.ok(recoverIdx > chainEndIdx,
      'Recover heal must follow (not be nested inside) the hit/damage branches — CRR-MIS-004');
  });

  it('004d: source — by contrast, Cleave IS damage-gated (hit && damage > 0) — demonstrates the gate pattern Recover lacks', () => {
    assert.match(CB_SRC,
      /if \(hit && damage > 0 && cleaveQueue\.length > 0 && game\.selectedMap\?\.id\) \{/,
      'Cleave gate must require hit && damage > 0 — CRR-MIS-005 counterpart, CRR-MIS-004 contrast');
  });

  it('004e: source — surgeRecover accumulates during surge-spending with no hit/damage predicate', () => {
    assert.match(H_CB_SRC,
      /combat\.surgeRecover = \(combat\.surgeRecover \|\| 0\) \+ \(mod\.recover \?\? 0\);/,
      'surgeRecover accumulator must exist (surge spending happens regardless of hit) — CRR-MIS-004');
  });

  it('004f: source — embed-refresh for Recover triggers even on 0-damage (attacker HP embed must update on heal)', () => {
    assert.match(CB_SRC,
      /if \(combat\.surgeRecover > 0 && combat\.attackerMsgId != null\) embedRefreshMsgIds\.add\(combat\.attackerMsgId\);/,
      'Recover-driven embed refresh must fire regardless of damage dealt — CRR-MIS-004');
  });
});
