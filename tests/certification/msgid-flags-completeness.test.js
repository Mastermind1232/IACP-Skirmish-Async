/**
 * MSGID_FLAGS completeness — every game-state field that's written as
 * `game.X[someMsgId] = ...` in src/ must be registered in at least one
 * of the authoritative flag lists, OR explicitly allowlisted as a
 * false-positive in this test.
 *
 * Why this exists: the existing parity test (msgid-flags-parity) goes
 * one direction — checkpoint MSGID_FLAGS ⊆ ACTIVATION_MSGID_FLAGS ∪
 * EXTRAS — to catch typos or wrong-keyed entries. The OPPOSITE
 * direction was unguarded: a NEW msgId-keyed field added without
 * registration in either ACTIVATION_MSGID_FLAGS / ROUND_OBJECT_FLAGS /
 * CHECKPOINT MSGID_FLAGS would silently drop on cross-lobby load
 * (no remap → keyed by stale msgIds → lookup misses → ability never
 * fires for that DC again).
 *
 * That gap has bitten the project at least twice already
 * (`dcFinishedPinged` was the most recent — added to MSGID_FLAGS in
 * commit `8cf4c47` after a player hit the silent-dropout). This test
 * makes the next instance fail at commit time, not in production.
 *
 * Mechanism:
 *  1. Walk src/handlers, src/engine, src/game source files.
 *  2. Regex-extract `game.<FIELD>[<msgIdVar>] = ...` assignments where
 *     <msgIdVar> is named `msgId` or ends in `MsgId`/`MsgID`.
 *  3. For each candidate FIELD, assert membership in one of:
 *     - ACTIVATION_MSGID_FLAGS (cleared at activation end; save gate
 *       refuses mid-activation, so empty at save time — no remap need)
 *     - ROUND_OBJECT_FLAGS (cleared at round end)
 *     - CHECKPOINT MSGID_FLAGS in src/handlers/checkpoint.js (remapped
 *       on cross-lobby load)
 *     - ALLOWLIST below (explicit false-positive with reason).
 *
 * If a new field surfaces here, the engineer either:
 *   - registers it in the appropriate list (proper home), OR
 *   - adds it to ALLOWLIST with a one-line reason (false positive — e.g.
 *     the regex matched a non-keyed scalar assignment).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTIVATION_MSGID_FLAGS,
  ROUND_OBJECT_FLAGS,
} from '../../src/game/activation-state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

// ── Discovery ────────────────────────────────────────────────────────────────

function* walkSrc(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      // Skip test directories within src
      if (/\.test\b|\/tests?\b/.test(p)) continue;
      yield* walkSrc(p);
    } else if (p.endsWith('.js') && !p.endsWith('.test.js')) {
      yield p;
    }
  }
}

/** Extract the field names X for every `game.X[someMsgIdVar] = ...` in src/. */
function discoverMsgIdKeyedFields() {
  const candidates = new Set();
  const sources = [
    path.join(ROOT, 'src/handlers'),
    path.join(ROOT, 'src/engine'),
    path.join(ROOT, 'src/game'),
  ];
  // Variable forms that signal msgId semantics.
  // Examples matched: msgId, hostMsgId, attackerMsgId, defenderMsgId,
  //                   activeMsgId, dcMsgId, pendingMsgId, etc.
  // Examples excluded: figureKey, figKey, playerNum, dcName.
  const re = /game\.([a-zA-Z][a-zA-Z0-9]+)\[([a-zA-Z_][a-zA-Z0-9_]*)\]\s*=/g;
  const msgIdVarPattern = /^(msgId|.*[Mm]sgId|.*[Mm]sgID)$/;
  for (const dir of sources) {
    for (const file of walkSrc(dir)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(re)) {
        const [, field, varName] = m;
        if (!msgIdVarPattern.test(varName)) continue;
        candidates.add(field);
      }
    }
  }
  return candidates;
}

// ── Authoritative registration sources ──────────────────────────────────────

function getCheckpointMsgIdFlags() {
  const src = readFileSync(path.join(ROOT, 'src/handlers/checkpoint.js'), 'utf8');
  const m = src.match(/const MSGID_FLAGS = \[([\s\S]*?)\];/);
  if (!m) throw new Error('MSGID_FLAGS not found in src/handlers/checkpoint.js');
  return new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
}

const REGISTERED = new Set([
  ...ACTIVATION_MSGID_FLAGS,
  ...ROUND_OBJECT_FLAGS,
  ...getCheckpointMsgIdFlags(),
]);

/**
 * Explicit allowlist for fields the regex matches but that are NOT
 * msgId-keyed objects (false positives). Each entry needs a one-line
 * reason. Anything not on this list and not in REGISTERED fails the
 * test — the engineer must either register the field or add it here.
 */
const FALSE_POSITIVE_ALLOWLIST = {
  // 13 fields surfaced by the discovery on 2026-05-05 first-run. Each is
  // a true msgId-keyed field that's NOT registered in any of the
  // authoritative lists. Categorized by best-guess lifecycle. Each
  // should be promoted into the right registered list (and removed from
  // here) once verified by reading the ability's full lifecycle.
  //
  // ── Per-activation pending (likely belong in ACTIVATION_MSGID_FLAGS) ──
  'activationDoubleSpecialAction': 'TODO classify: name signals per-activation; should likely move to ACTIVATION_MSGID_FLAGS.',
  'companionActivatedBefore':      'TODO classify: per-activation cleanup at handlers/activation.js:607,754; should likely move to ACTIVATION_MSGID_FLAGS.',
  'falseOrdersAttackTargets':      'TODO classify: per-attack cleanup at handlers/combat.js:7034; should likely move to ACTIVATION_MSGID_FLAGS.',
  'pounceAttackPending':           'TODO classify: pending-pattern, per-activation cleanup at dc-play-area.js:1710; should likely move to ACTIVATION_MSGID_FLAGS.',
  'pendingEe3Carbine':             'TODO classify: registered as ACTIVATION_SCALAR_FLAGS but used as msgId-keyed object — wrong-typed registration. Move to ACTIVATION_MSGID_FLAGS.',
  'pendingVoracious':              'TODO classify: registered as ACTIVATION_SCALAR_FLAGS but used as msgId-keyed. Move to ACTIVATION_MSGID_FLAGS.',
  'partingShotTriggered':          'TODO classify: registered as ACTIVATION_SCALAR_FLAGS but used as msgId-keyed object via game.partingShotTriggered[msgId]=true. Move to ACTIVATION_MSGID_FLAGS.',
  // ── Persistent / round-scoped (likely belong in CHECKPOINT MSGID_FLAGS) ──
  'bloodFeudTargets':              'TODO classify: Blood Feud CC tracks targets across attacks — persistent. Should likely move to CHECKPOINT MSGID_FLAGS.',
  'orbitalBombardmentTokens':      'TODO classify: token accumulator on the board — persistent across rounds. Should likely move to CHECKPOINT MSGID_FLAGS.',
  'overwatchTokenPosition':        'TODO classify: Overwatch token persists until movement triggers it — persistent. Should likely move to CHECKPOINT MSGID_FLAGS.',
  'paybackBonusSurge':             'TODO classify: Dengar Payback bonus scope unclear (round? attack?). Investigate then move to ROUND_OBJECT_FLAGS or CHECKPOINT MSGID_FLAGS.',
  'secondChanceDcMsgId':           'TODO classify: reset to {} in round.js:513 — round-scoped. Should likely move to ROUND_OBJECT_FLAGS (and CHECKPOINT MSGID_FLAGS if save mid-round is possible).',
  'selfAugmentationMsgId':         'TODO classify: Self Augmentation persists once applied. Should likely move to CHECKPOINT MSGID_FLAGS.',
};

// ── Test ─────────────────────────────────────────────────────────────────────

describe('MSGID_FLAGS completeness — every msgId-keyed field is registered', () => {
  const candidates = [...discoverMsgIdKeyedFields()].sort();

  it('discovery finds at least one candidate (sanity)', () => {
    assert.ok(candidates.length > 0,
      'No msgId-keyed fields discovered — regex may be broken');
  });

  it('every discovered msgId-keyed field is registered or allowlisted', () => {
    const unregistered = candidates.filter(
      (f) => !REGISTERED.has(f) && !(f in FALSE_POSITIVE_ALLOWLIST),
    );
    if (unregistered.length > 0) {
      const lines = unregistered.map((f) => `  • ${f}`).join('\n');
      assert.fail(
        `${unregistered.length} msgId-keyed field(s) discovered in src/ that are NOT registered:\n${lines}\n\n` +
        `Each field must be added to one of:\n` +
        `  - ACTIVATION_MSGID_FLAGS in src/game/activation-state.js (cleared at activation end)\n` +
        `  - ROUND_OBJECT_FLAGS    in src/game/activation-state.js (cleared at round end)\n` +
        `  - MSGID_FLAGS           in src/handlers/checkpoint.js (remapped on cross-lobby load)\n` +
        `  - FALSE_POSITIVE_ALLOWLIST in this test (with one-line reason — only if the regex matched a non-keyed scalar)\n\n` +
        `Without registration, cross-lobby checkpoint loads will silently no-op for these fields ` +
        `(stale msgId keys → lookups miss → abilities never fire for affected DCs).`,
      );
    }
  });

  it('FALSE_POSITIVE_ALLOWLIST is clean (no stale entries)', () => {
    // If a field becomes registered later, remove it from the allowlist.
    const stale = Object.keys(FALSE_POSITIVE_ALLOWLIST).filter((f) => REGISTERED.has(f));
    assert.deepEqual(stale, [],
      `Allowlist contains entries that are now registered (drop them): ${stale.join(', ')}`);
  });
});
