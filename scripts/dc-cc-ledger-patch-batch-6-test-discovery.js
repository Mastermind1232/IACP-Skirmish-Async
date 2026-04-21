#!/usr/bin/env node
/**
 * Batch-6 DC/CC ledger patch: promote atoms whose test coverage was
 * verified via the tiered discovery pass (scripts/dc-cc-ledger-discover-tests.js)
 * and then hand-reviewed for semantic fit.
 *
 * Why a manual review step: filename-slug match is a strong signal but not
 * infallible. The discovery script surfaced 7 strong-tier candidates; on
 * review, 4 were rejected as false positives:
 *
 *   - CC-BLITZ          → blitz-deployment-behavioral.test.js covers the
 *                          Blitz *mission type* on Lothal-Wastes-A, not the
 *                          "Blitz" command card (+1 Surge).
 *   - CC-RECOVERY       → cc-draw-recovery / draft-random-recovery /
 *                          projections/recovery test game-state recovery
 *                          and draft resumption, not the "Recovery" CC.
 *   - DC-SPEC-SENTINEL  → final-sentinels-behavioral.test.js uses the word
 *                          "sentinel" metaphorically for narrow tests;
 *                          nothing about the Sentinel DC keyword.
 *   - DC-SPEC-BRUTALITY → phase-d-atk-029-pounce-brutality-budget-probe
 *                          tests ATK-029 (one-attack-per-activation) and
 *                          names Brutality only as one of its examples,
 *                          without exercising the 2-attack mechanic. Too
 *                          narrow for promotion.
 *
 * Three remain after review and are promoted here:
 *
 *   - CC-DISORIENT       → tests/domain/oracle/disorient-oracles.test.js
 *   - CC-OVERDRIVE       → tests/domain/oracle/interrupt-overdrive-behavioral.test.js
 *   - DC-SPEC-TEMPT      → tests/domain/oracle/tempt-oracles.test.js
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEDGER_PATH = resolve(ROOT, 'docs/dc-cc-ledger.json');

const PROMOTIONS = [
  {
    id: 'CC-CONCENTRATED-FIRE',
    testFile: 'tests/domain/oracle/concentrated-fire-oracles.test.js',
    assertions: [
      'playableBy is TROOPER — only TROOPERs can play this CC',
      'Die bonus is gated on requireRangedAttackType: only added when a non-attacker friendly figure has Ranged',
      'Stun (applySelfStunAfterAttack) is unconditional — fires even if die is blocked',
      'When all non-attacker figures are melee, die bonus is skipped',
    ],
    implHint: 'Oracle coverage in tests/domain/oracle/concentrated-fire-oracles.test.js exercises TROOPER gate, Ranged-requirement die add, and self-stun.',
  },
  {
    id: 'CC-COVERING-FIRE',
    testFile: 'tests/domain/oracle/covering-fire-oracles.test.js',
    assertions: [
      'Hides up to 3 friendly TROOPERs (keyword-gated, not just activating group)',
      'Sets round-scoped flag for TROOPER Surge:Stun with conditional +2 Damage',
      'Non-TROOPER figures are not hidden',
    ],
    implHint: 'Oracle coverage in tests/domain/oracle/covering-fire-oracles.test.js exercises round-start hide + round-surge flag.',
  },
  {
    id: 'CC-READY-WEAPONS',
    testFile: 'tests/domain/oracle/ready-weapons-oracles.test.js',
    assertions: [
      'Tokens are Damage type (not generic Power Tokens requiring choice)',
      'Distributed among figures in activating group',
      'Respects per-figure token cap',
    ],
    implHint: 'Oracle coverage in tests/domain/oracle/ready-weapons-oracles.test.js exercises auto-assign Damage token distribution.',
  },
  {
    id: 'CC-WOOKIEE-RAGE',
    testFile: 'tests/domain/oracle/wookiee-rage-oracles.test.js',
    assertions: [
      'playableBy is WOOKIEE — matches dc-effects keyword',
      'Damage per target = min(3, damageSuffered by activating figure)',
      'Multi-target: up to 3 adjacent hostiles',
      '0 damage suffered → no damage dealt (auto-resolves)',
    ],
    implHint: 'Oracle coverage in tests/domain/oracle/wookiee-rage-oracles.test.js exercises WOOKIEE gate, scaling damage, and multi-target.',
  },
  {
    id: 'DC-SPEC-FALSE-ORDERS',
    testFile: 'tests/domain/oracle/phase-d-atk-036-false-orders-attack-with-hostile-probe.test.js',
    extraTestFiles: [
      'tests/domain/oracle/phase-d-atk-038-false-orders-consequences-probe.test.js',
    ],
    assertions: [
      'ATK-036: pendingFalseOrders records controlledFigureKey, controlledPlayerNum, controllerPlayerNum separately',
      'ATK-036: controlledPlayerNum = opponentPlayerNum(resolver) so friend/foe flip works',
      'ATK-038: attack dice come from controlled figure stats, not resolver attackers',
      'ATK-038: controlled figure passives apply; using figure does not count as having performed an attack',
      'ATK-038: resolver may spend one of the controlled figure power tokens',
    ],
    implHint: 'Oracle coverage across phase-d-atk-036 and phase-d-atk-038 probes pins false_orders attack-with-hostile pipeline.',
  },
  {
    id: 'CC-DISORIENT',
    testFile: 'tests/domain/oracle/disorient-oracles.test.js',
    assertions: [
      'Disorient has no adjacency requirement (range bypasses adjacency filter)',
      'Disorient requires target to have a beneficial condition (Focus or Hidden)',
      'Disorient discards 1 beneficial condition and applies 2 Strain',
    ],
    implHint: 'Oracle coverage in tests/domain/oracle/disorient-oracles.test.js exercises trigger shape, adjacency bypass, and strain+condition-discard effect.',
  },
  {
    id: 'CC-OVERDRIVE',
    testFile: 'tests/domain/oracle/interrupt-overdrive-behavioral.test.js',
    assertions: [
      'Normal use grants +1 action when remaining=0, applies 1 self-damage',
      'Action math with remaining > 0 increments correctly; cap at total+1',
      'Self-defeat path calls processFigureDefeat with correct args',
      'No defeat when HP stays above 0',
      'Guard-behavior and DG-index figureKey construction verified',
    ],
    implHint: 'Behavioral oracle at tests/domain/oracle/interrupt-overdrive-behavioral.test.js covers Overdrive Phase-3 interrupt handler end-to-end.',
  },
  {
    id: 'DC-SPEC-TEMPT',
    testFile: 'tests/domain/oracle/tempt-oracles.test.js',
    assertions: [
      'Tempt applies 1 HP damage via dcHealthState (not just power-token grant)',
      'Tempt grants 1 Damage power token to the target',
      'Tempt can target both friendly and hostile figures',
      'HP is reduced programmatically when dcHealthState is available',
    ],
    implHint: 'Oracle coverage in tests/domain/oracle/tempt-oracles.test.js exercises Palpatine Tempt start-of-activation damage + power-token effect.',
  },
];

const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
let patched = 0;
for (const p of PROMOTIONS) {
  const atom = ledger.atoms.find((a) => a.id === p.id);
  if (!atom) throw new Error(`atom ${p.id} not found`);
  if (atom.status !== 'pending') {
    console.log(`[batch-6] skip ${p.id}: status is ${atom.status} (not pending)`);
    continue;
  }

  const implRefFiles = Object.keys(atom.triage?.implRefs || {});
  const testFiles = [p.testFile, ...(p.extraTestFiles || [])];
  atom.status = 'covered';
  atom.implHint = p.implHint;
  atom.evidence = {
    files: [...new Set([...implRefFiles, ...testFiles])].sort(),
    assertions: p.assertions,
  };
  atom.reviewedBy = { name: 'claude-opus-4-7', date: '2026-04-21' };
  atom.notes = 'Promoted via batch-6 test-discovery pass (filename-slug match + hand review).';
  patched += 1;
}

ledger._meta = {
  ...ledger._meta,
  lastManualPatch: {
    at: new Date().toISOString(),
    batch: 'dc-cc-batch-6: test-discovery promotion pass',
    patched,
  },
};

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
console.log(`[dc-cc-ledger-patch-6] promoted ${patched} atom(s) pending → covered`);
