/**
 * Dep-Bag Parity — non-mutating surfacing layer.
 *
 * Verifies that every dep key any handler group requires (per
 * `CONTEXT_GROUPS` in `src/context-factory.js`) is actually provided by
 * `buildHeadlessDeps(...)` in `src/headless/headless-deps.js`.
 *
 * Why this exists: the Discord handler layer and the headless-test
 * provider are two separate code paths that have to agree on the shape
 * of the shared `allDeps` bag. If a new dep is added to a handler group
 * but not wired into the headless provider, handlers running under
 * headless silently get `undefined` for that key — the exact shape of
 * the deploy-crash that commit 469895f fixed on the Discord side.
 *
 * Invariant: for every key in `getAllRequiredDepKeys()`, the bag
 * returned by `buildHeadlessDeps({})` has that key defined (not
 * undefined).
 *
 * Any legitimate exceptions live in `ALLOWED_OMISSIONS` below with a
 * one-line reason. Growth beyond that allowlist hard-fails.
 *
 * Non-mutating: this test only constructs the bag and compares key
 * sets. It does not call handler logic, does not change any game data,
 * does not modify the provider.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAllRequiredDepKeys, CONTEXT_GROUPS } from '../../src/context-factory.js';
import { buildHeadlessDeps } from '../../src/headless/headless-deps.js';

// ── Allowlist (explicit, not a vague baseline) ───────────────────────────────
// Each entry names a handler-group dep that `buildHeadlessDeps` is known to
// *intentionally* not provide. Reason is required. Remove entries when the
// provider starts supplying the key; the test will tighten automatically.
//
// Captured 2026-04-16. All 9 current omissions are Discord-UI-surface deps:
// button builders, channel/message managers, and embed renderers that have
// no meaning in a headless simulation. Handlers that touch them either guard
// with optional chaining or are not exercised on the headless code path.
export const ALLOWED_OMISSIONS = {
  buildSquadConfirmText:            'Discord text builder for squad-confirmation messages; no Discord messages in headless',
  channelDeleteGuard:               'Discord channel-delete safeguard; headless never deletes real channels',
  getDetermineInitiativeButtons:    'Discord button builder for initiative prompts; headless has no Discord UI',
  populatePlayAreas:                'Creates Discord play-area channel messages; headless uses no Discord channels',
  postFluctuationSwapButtons:       'Discord button post for mission fluctuation-swap UI; no Discord UI in headless',
  postGameOver:                     'Discord game-over message poster; headless uses an inline wrapper inside checkWinConditions (see headless-deps.js line ~363)',
  postKryknaPlaceButtons:           'Discord button post for Krykna NPC placement prompts; headless resolves Krykna via auto-queue (self-play.js)',
  renderDcEmbed:                    'Discord embed renderer for DC cards; Discord-side callers guard with optional chaining',
  reorderPlayAreaAfterAttachments:  'Reorders Discord channels after setup-attachments phase; headless has no channels to reorder',
};

// ── Build the bag with minimal test args ─────────────────────────────────────
const allDeps = buildHeadlessDeps({});

// ── Compute gaps ─────────────────────────────────────────────────────────────
const requiredKeys = [...getAllRequiredDepKeys()].sort();
const missing = [];
const present = [];
for (const key of requiredKeys) {
  if (allDeps[key] === undefined) missing.push(key);
  else present.push(key);
}

// Split missing into "allowed" vs "unexpected"
const unexpectedMissing = missing.filter(k => !(k in ALLOWED_OMISSIONS));
const allowedAndStillMissing = missing.filter(k => k in ALLOWED_OMISSIONS);

// Allowlist entries that are NO LONGER missing (provider caught up — allowlist
// should shrink). Surfaced as informational.
const staleAllowlistEntries = Object.keys(ALLOWED_OMISSIONS).filter(
  k => allDeps[k] !== undefined
);

// ── Reporting ────────────────────────────────────────────────────────────────
function logAlways() {
  console.log(`\n[dep-bag] CONTEXT_GROUPS groups: ${Object.keys(CONTEXT_GROUPS).length}`);
  console.log(`[dep-bag] Total unique required deps: ${requiredKeys.length}`);
  console.log(`[dep-bag] Provided by buildHeadlessDeps: ${present.length}`);
  console.log(`[dep-bag] Missing: ${missing.length}  (allowed: ${allowedAndStillMissing.length}, unexpected: ${unexpectedMissing.length})`);

  if (allowedAndStillMissing.length > 0) {
    console.log(`\n[dep-bag] Allowed Discord-only / intentional omissions:`);
    for (const k of allowedAndStillMissing) {
      console.log(`  • ${k} — ${ALLOWED_OMISSIONS[k]}`);
    }
  }
  if (unexpectedMissing.length > 0) {
    console.log(`\n[dep-bag] UNEXPECTED missing deps (will fail test):`);
    for (const k of unexpectedMissing) console.log(`  • ${k}`);
  }
  if (staleAllowlistEntries.length > 0) {
    console.log(`\n[dep-bag] Stale allowlist entries (now provided — remove from ALLOWED_OMISSIONS):`);
    for (const k of staleAllowlistEntries) console.log(`  • ${k}`);
  }
}

describe('Dep-bag parity (non-mutating surfacing)', () => {
  it('emits summary on every run', () => {
    logAlways();
    assert.ok(true);
  });

  it('every required dep key is provided by buildHeadlessDeps (or explicitly allowlisted)', () => {
    if (unexpectedMissing.length > 0) {
      assert.fail(
        `${unexpectedMissing.length} unexpected missing dep(s) — handlers running under headless will get undefined:\n` +
        unexpectedMissing.map(k => `  • ${k}`).join('\n') +
        `\n\nIf a miss is intentional (Discord-only surface), add it to ALLOWED_OMISSIONS in ` +
        `tests/certification/dep-bag-parity.test.js with a one-line reason.`
      );
    }
  });

  it('allowlist is clean (no stale entries)', () => {
    if (staleAllowlistEntries.length > 0) {
      assert.fail(
        `${staleAllowlistEntries.length} ALLOWED_OMISSIONS entries are now provided by ` +
        `buildHeadlessDeps — remove them to tighten the allowlist:\n` +
        staleAllowlistEntries.map(k => `  • ${k}`).join('\n')
      );
    }
  });

  it('buildHeadlessDeps returns an object', () => {
    assert.equal(typeof allDeps, 'object');
    assert.ok(allDeps !== null);
  });

  it('CONTEXT_GROUPS has at least one group', () => {
    assert.ok(Object.keys(CONTEXT_GROUPS).length > 0);
  });
});
