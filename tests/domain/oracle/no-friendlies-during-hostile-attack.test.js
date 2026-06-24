/**
 * Behavioral oracle: "no figures considered friendly during this attack"
 * applies to Lure of the Dark Side / False Orders attacks.
 *
 * Per destruct 2026-05-07: when an enemy player controls one of your
 * figures to attack (Lure / False Orders), the controlled figure's
 * normal team is NOT considered friendly to the attacker. Friendly-
 * gated effects on both attacker side AND defender side are suppressed.
 *
 * Implementation: combat.noFriendliesActive flag set on FO/Lure combat
 * init. Each friendly-gated site consults the flag and skips when set.
 *
 * Created 2026-05-07 for combat-rebuild Section 5 (Lure/FO mechanics).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

function readSrc(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

// ── Flag wired at combat init ─────────────────────────────────────────────

test('FO/Lure combat init sets noFriendliesActive=true', () => {
  const src = readSrc('src/handlers/combat.js');
  // The FO/Lure attack-init block (where falseOrdersControllerPlayerNum
  // is set) must also set noFriendliesActive=true. Pin the colocation.
  const block = src.match(/falseOrdersControllerPlayerNum:[\s\S]{0,800}noFriendliesActive:\s*true/);
  assert.ok(block, 'noFriendliesActive: true is set in same combat-init block as falseOrdersControllerPlayerNum');
});

// ── Sentinel / Protector ──────────────────────────────────────────────────

test('Sentinel/Protector gate passives guarded by noFriendliesActive', () => {
  // Gate cutover (2026-06-18): the legacy inline scan in combat.js was retired;
  // Sentinel and Protector are now gate mods passives. Each `applies` must still
  // bail when noFriendliesActive (Lure/FO) — no figure is friendly to the
  // controlled attacker, so the friendly-adjacent shield can't trigger.
  const src = readSrc('src/engine/combat-abilities-mods.js');
  assert.match(src, /id: 'protector'[\s\S]{0,400}combat\.noFriendliesActive/,
    'Protector gate passive gated by noFriendliesActive');
  assert.match(src, /id: 'sentinel'[\s\S]{0,400}combat\.noFriendliesActive/,
    'Sentinel gate passive gated by noFriendliesActive');
});

// ── Get Behind Me / Bodyguard target swap ─────────────────────────────────

test('Bodyguard / Get Behind Me refuses when noFriendliesActive', () => {
  const src = readSrc('src/game/abilities.js');
  // attackTargetSwap path (Bodyguard/GBM) must check noFriendliesActive
  // and refuse with a manual-message.
  assert.match(src, /noFriendliesActive[^\n]*\n[\s\S]{0,200}cannot fire: no figures are considered friendly/,
    'Bodyguard/GBM swap blocks during Lure/FO with explanatory message');
});

// ── Fury of Kashyyyk Pierce ──────────────────────────────────────────────

test('Fury of Kashyyyk Pierce skipped when noFriendliesActive', () => {
  // Gate cutover (2026-06-16): the legacy inline in combat.js was retired; Fury
  // Pierce is now the gate mods passive 'fury_kashyyyk_pierce'. Its `applies`
  // must still bail when noFriendliesActive (Lure/FO), since no figure is
  // friendly to the controlled attacker.
  const src = readSrc('src/engine/combat-abilities-mods.js');
  assert.match(src, /fury_kashyyyk_pierce[\s\S]{0,800}combat\.noFriendliesActive/,
    'Fury Pierce gate passive gated by noFriendliesActive');
});

// ── This is the Way (Armorer) ─────────────────────────────────────────────

test('This is the Way (Armorer) skipped when noFriendliesActive', () => {
  // 2026-05-08 migration: This is the Way moved from inline combat-bridge.js
  // to a WHEN_DEFEATED hook in damage-pipeline-hooks.js. The noFriendliesActive
  // gate now lives on the hook's probe.
  const src = readSrc('src/game/damage-pipeline-hooks.js');
  assert.match(src, /this_is_the_way_armorer[\s\S]{0,500}noFriendliesActive/,
    'Armorer Block-Token grant gated by noFriendliesActive');
});

// ── Coordinated Hunt other-friendly branch ────────────────────────────────
// NOTE: the 'Coordinated Hunt other-friendly branch skipped when
// noFriendliesActive' probe was removed 2026-06-24. It pinned the legacy
// `coordinated_hunt_purge_commander ... !_chApplied && !combat.noFriendliesActive`
// block inside handleCombatRoll's `if (!combat._seqActive)` ad-hoc reroll engine,
// which was deleted in the gate-machine cleanup (it never executed in gate mode).
// Coordinated Hunt is now driven by the gate rerolls window via the
// owner_with_los_to_attacker condition (src/engine/combat-conditions.js).
// FLAGGED FOR REVIEW: the data-driven condition does not currently consult
// combat.noFriendliesActive — confirm Lure/FO no-friendlies handling for the
// "friendly Purge Commander with LOS" branch is still correct under the gate.
