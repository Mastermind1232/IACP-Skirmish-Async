/**
 * Session 11 retirement — lock the migration in place.
 *
 * Per destruct's 2026-05-05 audit: combat flow control should run on the
 * canonical CRR currentStep, not on the legacy `combat.p1Ready` /
 * `combat.p2Ready` boolean pair. Per-step player ack lives on
 * `combat.acked: { 1: bool, 2: bool }` and resets on every currentStep
 * advance.
 *
 * This audit ensures NO source file in `src/` references `combat.p1Ready`,
 * `combat.p2Ready`, `pendingCombat.p1Ready`, or `pendingCombat.p2Ready`.
 * If a future commit reintroduces the legacy field, this test fails —
 * preventing silent flow-control regression.
 *
 * NOTE: `phaseGate.p1Ready` (game-level pre-combat phase gate) and
 * `combatGate.p1Ready` (sub-phase ack gate) remain valid — they're
 * separate gate systems and were not part of session 11 scope. The regex
 * below is anchored to `combat.` and `pendingCombat.` to exclude them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');
const SRC = resolve(ROOT, 'src');

function* walkFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walkFiles(full);
    else if (full.endsWith('.js')) yield full;
  }
}

const FORBIDDEN = [
  /\bcombat\.p1Ready\b/,
  /\bcombat\.p2Ready\b/,
  /\bpendingCombat\.p1Ready\b/,
  /\bpendingCombat\.p2Ready\b/,
];

test('session 11: legacy combat.p1Ready / combat.p2Ready fully retired from src/', () => {
  const offenders = [];
  for (const file of walkFiles(SRC)) {
    if (file.endsWith('.test.js')) continue;
    const src = readFileSync(file, 'utf8');
    for (const re of FORBIDDEN) {
      if (re.test(src)) {
        offenders.push(`${file.replace(ROOT + '/', '')}: matches ${re.source}`);
      }
    }
  }
  assert.equal(
    offenders.length,
    0,
    `Found legacy p1Ready/p2Ready references — must use combat.acked + currentStep instead:\n${offenders.join('\n')}`,
  );
});

test('session 11: combat init sites use acked + currentStep, not legacy fields', () => {
  const COMBAT_HANDLER = readFileSync(resolve(SRC, 'handlers/combat.js'), 'utf8');
  // Positive checks: the init paths must include both currentStep AND acked.
  assert.match(
    COMBAT_HANDLER,
    /currentStep:\s*'step1\+2-attacker'/g,
    'combat.js must initialize pendingCombat with currentStep: \'step1+2-attacker\'',
  );
  assert.match(
    COMBAT_HANDLER,
    /acked:\s*\{\s*\}/g,
    'combat.js must initialize pendingCombat with empty acked map',
  );
  // Negative check: pendingCombat init must NOT carry the legacy boolean
  // pair (combatGate.p1Ready/p2Ready is a different gate system, see file
  // header — its lines start with `combat.combatGate = {` so they're
  // distinguishable from pendingCombat literals here).
  // The pendingCombat literals start with the `currentStep:` field today,
  // so check for the immediate-neighbour pattern.
  assert.doesNotMatch(
    COMBAT_HANDLER,
    /currentStep:\s*'step1\+2-attacker',\s*[\r\n]\s*p1Ready:\s*false/,
    'pendingCombat init must not include legacy p1Ready alongside currentStep',
  );
  assert.doesNotMatch(
    COMBAT_HANDLER,
    /currentStep:\s*'step1\+2-attacker',\s*[\r\n]\s*p2Ready:\s*false/,
    'pendingCombat init must not include legacy p2Ready alongside currentStep',
  );
});

test('session 11: ready-toggle handler writes to combat.acked, not legacy fields', () => {
  const COMBAT_HANDLER = readFileSync(resolve(SRC, 'handlers/combat.js'), 'utf8');
  assert.match(
    COMBAT_HANDLER,
    /combat\.acked\[playerNum\]\s*=\s*true/,
    'handleCombatReady must write to combat.acked[playerNum], not legacy p1Ready/p2Ready',
  );
});
