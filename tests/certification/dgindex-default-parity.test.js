/**
 * Certification: no `[Group N]` dgIndex fallback may default to 0.
 *
 * Figure keys are `${dcName}-${dgIndex}-${figureIndex}` and dgIndex is
 * 1-BASED everywhere it is produced (setup-bridge's auto-deploy loop and
 * processDcList both pre-increment; parseFigureKey defaults to 1). A
 * single-group DC's displayName carries no "[Group N]" suffix, so the regex
 * misses and the fallback decides the key.
 *
 * A `?? '0'` fallback therefore builds `${dcName}-0-N`, which matches nothing
 * any handler ever wrote. Live consequence (alexanbv 2026-08-11): the
 * end-of-activation cleanup in handleDcEndActivation passed such keys to
 * cleanupActivation, so every ACTIVATION_FIGKEY_FLAGS entry for a single-group
 * DC was silently left behind. attackPerformedThisActivation is not in
 * ROUND_OBJECT_FLAGS, so it survived the round reset too and permanently
 * blocked that figure's next attack.
 *
 * The headless harness shared the same fallback, so the entire suite
 * reproduced the broken behaviour and could not catch it. Hence this static
 * check rather than a behavioural test.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SCAN_DIRS = ['src'];
const SCAN_FILES = ['index.js'];

// A line is an offender only if it BOTH extracts a group index and defaults
// that extraction to 0. Keyed on the `?.[1] ?? 0` idiom specifically — a
// looser scan runs past it onto the trailing `selectedFigure ?? 0`, which is
// correctly 0-based (figure indices start at 0; only GROUP indices start at 1).
const GROUP_REGEX = /\[\(\?:DG\|Group\)/;
const BAD_FALLBACK = /\?\.\[1\]\s*\?\?\s*['"`]?0['"`]?/;
const isOffender = (line) => GROUP_REGEX.test(line) && BAD_FALLBACK.test(line);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

function collectFiles() {
  const files = [...SCAN_FILES.map((f) => join(ROOT, f))];
  for (const d of SCAN_DIRS) walk(join(ROOT, d), files);
  return files;
}

describe('dgIndex default parity', () => {
  test('no [Group N] regex fallback defaults to 0', () => {
    const offenders = [];
    for (const file of collectFiles()) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (isOffender(line)) {
          offenders.push(`${relative(ROOT, file)}:${i + 1}\n      ${line.trim()}`);
        }
      });
    }
    if (offenders.length) {
      assert.fail(
        `${offenders.length} dgIndex fallback(s) default to 0 — figure groups are 1-based, ` +
        `so these build keys (\`Name-0-N\`) that match nothing:\n\n  ` +
        offenders.join('\n\n  ') +
        `\n\nFix: change the fallback to 1. A 0 here silently no-ops every ` +
        `figureKey-keyed lookup for single-group DCs.`
      );
    }
  });

  test('the canonical 1-based fallback is actually in use', () => {
    // Guards against the check above passing because the pattern vanished
    // entirely (e.g. a refactor renamed the regex) rather than being correct.
    let good = 0;
    for (const file of collectFiles()) {
      const src = readFileSync(file, 'utf8');
      good += (src.match(/\?\.\[1\]\s*\?\?\s*['"`]?1['"`]?/g) || []).length;
    }
    assert.ok(good > 10, `expected many 1-based dgIndex fallbacks, found ${good}`);
  });
});
