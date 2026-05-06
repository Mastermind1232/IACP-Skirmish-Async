/**
 * Slice 4.7-4.12 audit: verify every canonical CRR step transition is
 * wired in the live combat code paths (combat.js + combat-bridge.js).
 *
 * Per destruct's 2026-05-05 ruling, the canonical CRR sequence is:
 *
 *   pre-declare
 *   → step1+2-attacker → step1+2-defender → roll
 *   → step3-attacker → step3-rapidrecal → step3-defender
 *   → step4-attacker → step4-defender
 *   → step5
 *   → zillo-window
 *   → step6 (engine) → step7 (engine) → step8 (engine)
 *   → resolved
 *
 * For session 11, currentStep must become the authoritative gate. As a
 * prerequisite (slice 4.13 escalation), this audit ensures every transition
 * has at least one source-text site that writes the destination step. If
 * any transition falls out of the codebase, this test fails — preventing
 * silent flow-control drift while p1Ready/p2Ready and currentStep remain
 * parallel sources of truth.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');

const COMBAT_HANDLER = readFileSync(resolve(ROOT, 'src/handlers/combat.js'), 'utf8');
const COMBAT_BRIDGE = readFileSync(resolve(ROOT, 'src/engine/combat-bridge.js'), 'utf8');
const CC_HAND = readFileSync(resolve(ROOT, 'src/handlers/cc-hand.js'), 'utf8');

const ALL_SOURCE = COMBAT_HANDLER + '\n' + COMBAT_BRIDGE + '\n' + CC_HAND;

const REQUIRED_TRANSITIONS = [
  // Slice 4.x: every canonical step name should appear at least once as
  // an assignment target.
  'step1+2-attacker',
  'step1+2-defender',
  'roll',
  'step3-attacker',
  'step3-rapidrecal',
  'step3-defender',
  'step4-attacker',
  'step4-defender',
  'step5',
  'zillo-window',
  'step6',
  'step7',
  'step8',
];

test('slices 4.7-4.12: every canonical CRR step has a wired transition', () => {
  for (const step of REQUIRED_TRANSITIONS) {
    // Match either: combat.currentStep = 'X' (assignment) or
    // currentStep: 'X' (initialization in pendingCombat literal).
    // We allow both forms because attack-init sites use the literal
    // form while transition sites use the assignment form.
    const reAssign = new RegExp(
      `currentStep\\s*=\\s*'${step.replace(/[+]/g, '\\+')}'`,
      'g',
    );
    const reLiteral = new RegExp(
      `currentStep\\s*:\\s*'${step.replace(/[+]/g, '\\+')}'`,
      'g',
    );
    const matches = (ALL_SOURCE.match(reAssign) || []).length
      + (ALL_SOURCE.match(reLiteral) || []).length;
    assert.ok(
      matches > 0,
      `slice 4.x: no transition wired for canonical step '${step}' — `
      + `combat flow control would silently bypass it. Add a `
      + `currentStep = '${step}' assignment at the appropriate handler.`,
    );
  }
});

test('slice 4.x: combat-bridge.js wires the engine-driven steps (5→zillo→6→7→8)', () => {
  // Engine-driven steps don't take player input; they advance once the
  // prior step's prerequisites are met. The sequencing must live in
  // combat-bridge.js (post-surge resolution → damage application).
  const engineDrivenChain = [
    /currentStep\s*===\s*'step5'.*currentStep\s*=\s*'zillo-window'/s,
    /currentStep\s*===\s*'zillo-window'.*currentStep\s*=\s*'step6'/s,
    /currentStep\s*===\s*'step6'.*currentStep\s*=\s*'step7'/s,
    /currentStep\s*===\s*'step7'.*currentStep\s*=\s*'step8'/s,
  ];
  for (const re of engineDrivenChain) {
    assert.match(
      COMBAT_BRIDGE,
      re,
      'engine-driven step chain must advance step5→zillo-window→step6→step7→step8 in combat-bridge.js',
    );
  }
});

test('slice 4.x: cc-hand.js telemetry hook is in place (warn-mode soft validator)', () => {
  // Per slice 4.13: the validator currently warns on mismatches. Once
  // 4.7-4.12 are fully audited and a sim:discord shadow run shows no
  // WARN lines, this should be escalated to throw. For now, assert the
  // hook exists.
  assert.match(
    CC_HAND,
    /classifyCcStep\(card\)/,
    'cc-hand.js must invoke classifyCcStep on every CC commit (telemetry hook)',
  );
  assert.match(
    CC_HAND,
    /\[combat-order \$\{_tag\}\]/,
    'cc-hand.js must log combat-order ok|WARN tags for telemetry',
  );
});
