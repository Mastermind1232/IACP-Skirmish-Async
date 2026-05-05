/**
 * MSGID_FLAGS parity — checkpoint.js maintains its own MSGID_FLAGS
 * array used by remapMsgIdKeyedFields during cross-game checkpoint
 * loads. Each entry must correspond to an actual msgId-keyed game
 * field, otherwise the remap quietly no-ops on entries that never
 * match (the figurePowerTokens dead entry we found earlier — that
 * field is keyed by figureKey, not msgId).
 *
 * The authoritative list of msgId-keyed activation/round flags lives
 * in src/game/activation-state.js (ACTIVATION_MSGID_FLAGS). The
 * checkpoint MSGID_FLAGS list is intentionally a superset (it adds
 * non-activation msgId-keyed fields like dcAttachments, dcExhausted,
 * exhaustedSkirmishUpgrades) but every entry should be:
 *   - actually a field on `game` that's KEYED BY msgId, not figureKey
 *     or playerNum
 *   - either present in ACTIVATION_MSGID_FLAGS, OR explicitly listed
 *     in CHECKPOINT_MSGID_EXTRAS as a known non-activation msgId field
 *
 * What this DOES catch:
 *   - new entries in checkpoint MSGID_FLAGS that don't exist in
 *     ACTIVATION_MSGID_FLAGS or the known extras list (likely typo
 *     or wrong-keyed field)
 *
 * What this DOES NOT catch:
 *   - missing entries (a real msgId-keyed field that should be in the
 *     list but isn't); add a separate test for that gap if needed
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIVATION_MSGID_FLAGS } from '../../src/game/activation-state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CHECKPOINT_PATH = path.join(ROOT, 'src/handlers/checkpoint.js');

/**
 * Non-activation msgId-keyed fields that legitimately appear in the
 * checkpoint MSGID_FLAGS list. These are persistent fields keyed by
 * msgId that survive across activations (so they're not in
 * ACTIVATION_MSGID_FLAGS) but DO need msgId remapping on cross-lobby
 * checkpoint load.
 */
const CHECKPOINT_MSGID_EXTRAS = new Set([
  'dcActionsData',           // active activation thread state (msgId-keyed)
  'dcAttachments',
  'dcExhausted',
  'p1DcAttachments',
  'p2DcAttachments',
  'p1CcAttachments',
  'p2CcAttachments',
  'exhaustedSkirmishUpgrades',
  'movementBank',            // active move bank (msgId-keyed)
  'overrunDamagedThisMove',  // round-scope, but msgId-keyed
  'roundFigureAbilityUsed',  // compound key includes msgId
  // Audit 2026-05-05: persistent / round-scoped msgId-keyed fields added
  // by tests/certification/msgid-flags-completeness.test.js. Each survives
  // mid-round (or longer) and needs cross-lobby remap.
  'bloodFeudTargets',
  'orbitalBombardmentTokens',
  'overwatchTokenPosition',
  'secondChanceDcMsgId',
  'selfAugmentationMsgId',
]);

function getCheckpointMsgIdFlags() {
  const src = readFileSync(CHECKPOINT_PATH, 'utf8');
  const m = src.match(/const MSGID_FLAGS = \[([\s\S]*?)\];/);
  if (!m) throw new Error('MSGID_FLAGS not found in src/handlers/checkpoint.js');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const CHECKPOINT_FLAGS = getCheckpointMsgIdFlags();
const ACTIVATION_SET = new Set(ACTIVATION_MSGID_FLAGS);

describe('MSGID_FLAGS parity (checkpoint.js ↔ activation-state.js)', () => {
  it('checkpoint MSGID_FLAGS is non-empty (sanity)', () => {
    assert.ok(CHECKPOINT_FLAGS.length > 0, 'checkpoint MSGID_FLAGS is empty');
  });

  it('ACTIVATION_MSGID_FLAGS is non-empty (sanity)', () => {
    assert.ok(ACTIVATION_MSGID_FLAGS.length > 0, 'ACTIVATION_MSGID_FLAGS is empty');
  });

  for (const flag of CHECKPOINT_FLAGS) {
    it(`'${flag}' — must be in ACTIVATION_MSGID_FLAGS or CHECKPOINT_MSGID_EXTRAS`, () => {
      const inActivation = ACTIVATION_SET.has(flag);
      const inExtras = CHECKPOINT_MSGID_EXTRAS.has(flag);
      assert.ok(
        inActivation || inExtras,
        `Field '${flag}' is in checkpoint MSGID_FLAGS but is not registered as a ` +
        `msgId-keyed field (not in ACTIVATION_MSGID_FLAGS nor in this test's ` +
        `CHECKPOINT_MSGID_EXTRAS allowlist). The remap will silently no-op for ` +
        `this entry. Either remove from MSGID_FLAGS (if the field is keyed by ` +
        `figureKey/playerNum/etc.) or add to CHECKPOINT_MSGID_EXTRAS with a reason.`,
      );
    });
  }
});
