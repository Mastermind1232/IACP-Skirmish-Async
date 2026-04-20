/**
 * Phase-D probe: CRR CLV-005 — "If an attack has multiple Cleave abilities,
 * they are resolved one at a time in the order of the attacker's choice. The
 * target is independently chosen for each Cleave using the normal rules."
 *
 * Implementation chain (invariant pin):
 *   1. Every Cleave accumulation site in src/handlers/combat.js and
 *      src/engine/combat-bridge.js pushes onto combat.cleaveSources alongside
 *      the scalar surgeCleave/passiveCleave accumulator: passive Cleave X
 *      loadout keyword, surge Cleave X, Krayt Dragon Fury (Cleave X = Surges
 *      rolled), and Darksaber Strike (Blast → Cleave conversion).
 *   2. In src/engine/combat-bridge.js applyDamageAndFinishCombat, the Cleave
 *      block builds `cleaveQueue` from combat.cleaveSources (falling back to
 *      a single-entry queue built from the scalar sum when cleaveSources is
 *      absent — legacy / one-source paths). The first source is popped, used
 *      as pending.surgeCleave + pending.sourceLabel, and the remainder is
 *      persisted on pending.cleaveQueue for sequential resolution.
 *   3. In src/handlers/combat.js handleCleaveTarget, after applying the
 *      current Cleave's damage, if pending.cleaveQueue is non-empty the
 *      handler recomputes an up-to-date eligible-target list via the shared
 *      computeCleaveEligibleTargets helper and re-prompts the attacker with
 *      the next source — only calling finishCombatResolution when the queue
 *      is empty (or when no eligible targets remain).
 *   4. computeCleaveEligibleTargets excludes the initial attack target but
 *      does NOT exclude previously-Cleaved targets — each Cleave independently
 *      chooses from the rule-eligible set per "independently chosen".
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

describe('PROBE-PD-CLV-005: multiple Cleave abilities resolve one at a time with independent targets', () => {
  it('005a: source — passive Cleave (loadout) accumulation pushes onto combat.cleaveSources', () => {
    assert.match(H_CB_SRC,
      /combat\.passiveCleave\s*=\s*\(combat\.passiveCleave\s*\|\|\s*0\)\s*\+\s*_cv;\s*\(combat\.cleaveSources\s*=\s*combat\.cleaveSources\s*\|\|\s*\[\]\)\.push\(\{\s*value:\s*_cv,\s*label:\s*`Cleave \$\{_cv\} \(passive\)`\s*\}\);/,
      'passive Cleave accumulation must push onto combat.cleaveSources — CRR-CLV-005');
  });

  it('005b: source — surge Cleave accumulation pushes onto combat.cleaveSources', () => {
    assert.match(H_CB_SRC,
      /\(combat\.cleaveSources\s*=\s*combat\.cleaveSources\s*\|\|\s*\[\]\)\.push\(\{\s*value:\s*_cv,\s*label:\s*`Cleave \$\{_cv\} \(surge\)`\s*\}\);/,
      'surge Cleave accumulation must push onto combat.cleaveSources — CRR-CLV-005');
  });

  it('005c: source — Krayt Dragon Fury (Cleave X = Surges rolled) pushes onto combat.cleaveSources', () => {
    assert.match(H_CB_SRC,
      /\(combat\.cleaveSources\s*=\s*combat\.cleaveSources\s*\|\|\s*\[\]\)\.push\(\{\s*value:\s*_kdfX,\s*label:\s*`Cleave \$\{_kdfX\} \(Krayt Dragon Fury\)`\s*\}\);/,
      'Krayt Dragon Fury Cleave accumulation must push onto combat.cleaveSources — CRR-CLV-005');
  });

  it('005d: source — Darksaber Blast→Cleave conversion pushes onto combat.cleaveSources', () => {
    assert.match(CB_SRC,
      /\(combat\.cleaveSources\s*=\s*combat\.cleaveSources\s*\|\|\s*\[\]\)\.push\(\{\s*value:\s*_dsCv,\s*label:\s*`Cleave \$\{_dsCv\} \(Darksaber Blast→Cleave\)`\s*\}\);/,
      'Darksaber Blast→Cleave conversion must push onto combat.cleaveSources — CRR-CLV-005');
  });

  it('005e: source — applyDamageAndFinishCombat builds cleaveQueue from combat.cleaveSources', () => {
    assert.match(CB_SRC,
      /const cleaveQueue = Array\.isArray\(combat\.cleaveSources\) && combat\.cleaveSources\.length > 0\s*\n\s*\?\s*combat\.cleaveSources\.slice\(\)\s*\n\s*:\s*\(effectiveCleave > 0 \? \[\{ value: effectiveCleave, label: `Cleave \$\{effectiveCleave\}` \}\] : \[\]\);/,
      'cleaveQueue must be built from combat.cleaveSources (falling back to single-entry queue when absent) — CRR-CLV-005');
  });

  it('005f: source — initial prompt pops first source off cleaveQueue and persists the remainder on pending.cleaveQueue', () => {
    assert.match(CB_SRC,
      /const firstSource = cleaveQueue\.shift\(\);\s*\n\s*game\.pendingCleave = \{[\s\S]*?surgeCleave: firstSource\.value,[\s\S]*?sourceLabel: firstSource\.label,[\s\S]*?cleaveQueue,/,
      'initial Cleave prompt must pop first source and persist remaining queue on pending — CRR-CLV-005');
  });

  it('005g: source — shared helper computeCleaveEligibleTargets excludes the initial attack target but not prior-Cleaved targets', () => {
    // The helper must be exported, must reject combat.target.figureKey in both
    // melee and ranged branches, and must NOT filter previously-hit targets.
    assert.match(CB_SRC,
      /export function computeCleaveEligibleTargets\(game, combat, defenderPlayerNum, deps\)/,
      'computeCleaveEligibleTargets must be exported for shared initial+re-prompt use — CRR-CLV-005');
    assert.match(CB_SRC,
      /if \(c\.figureKey === combat\.target\?\.figureKey\) continue;/,
      'helper must exclude the initial attack target in the melee branch — CRR-CLV-005');
    assert.match(CB_SRC,
      /if \(fk === combat\.target\?\.figureKey\) continue;/,
      'helper must exclude the initial attack target in the ranged branch — CRR-CLV-005');
  });

  it('005h: source — handleCleaveTarget sequentially re-prompts with next queue entry + fresh eligible-target list', () => {
    // After applying damage, if cleaveQueue has entries, the handler must
    // (a) re-compute eligible targets via computeCleaveEligibleTargets,
    // (b) pop the next source, (c) persist the remaining queue, (d) send a
    // new prompt. Only if the queue is empty does it fall through to
    // finishCombatResolution.
    assert.match(H_CB_SRC,
      /const cleaveQueue = Array\.isArray\(pending\.cleaveQueue\) \? pending\.cleaveQueue\.slice\(\) : \[\];\s*\n\s*if \(cleaveQueue\.length > 0\) \{/,
      'handleCleaveTarget must check pending.cleaveQueue for more sources — CRR-CLV-005');
    assert.match(H_CB_SRC,
      /ctxComputeCleaveEligibleTargets\(game, pending\.combat, defPN, \{/,
      'handleCleaveTarget must re-compute eligible targets for next Cleave — CRR-CLV-005');
    assert.match(H_CB_SRC,
      /const nextSource = cleaveQueue\.shift\(\);/,
      'handleCleaveTarget must pop the next source off the queue — CRR-CLV-005');
  });

  it('005i: source — pending.cleaveQueue is the structural signal for sequential resolution (not a scalar total)', () => {
    // Grep for pending.cleaveQueue usage: it must exist in both the initial
    // prompt construction (combat-bridge.js) and the re-prompt handler
    // (combat.js). This pins the queue as the cross-file contract.
    assert.match(CB_SRC, /cleaveQueue,/,  'combat-bridge.js must construct pending.cleaveQueue');
    assert.match(H_CB_SRC, /pending\.cleaveQueue/, 'combat.js handleCleaveTarget must read pending.cleaveQueue');
  });
});
