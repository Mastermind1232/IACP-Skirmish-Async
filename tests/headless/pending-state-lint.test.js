/**
 * Pending-state lint — ensures every game.pending* key used in handler /
 * engine code is registered in an activation-state.js cleanup list (or is
 * explicitly exempted because it has its own lifecycle management).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTIVATION_MSGID_FLAGS,
  ACTIVATION_FIGKEY_FLAGS,
  ACTIVATION_PLAYERNUM_FLAGS,
  ACTIVATION_SCALAR_FLAGS,
  ROUND_OBJECT_FLAGS,
  ROUND_NULL_FLAGS,
  ROUND_ARRAY_FLAGS,
  ROUND_FALSE_FLAGS,
  ROUND_DELETE_FLAGS,
} from '../../src/game/activation-state.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

// ── Aggregate every key that activation-state.js will clean up ──────────────
const allCleanupFlags = new Set([
  ...ACTIVATION_MSGID_FLAGS,
  ...ACTIVATION_FIGKEY_FLAGS,
  ...ACTIVATION_PLAYERNUM_FLAGS,
  ...ACTIVATION_SCALAR_FLAGS,
  ...ROUND_OBJECT_FLAGS,
  ...ROUND_NULL_FLAGS,
  ...ROUND_ARRAY_FLAGS,
  ...ROUND_FALSE_FLAGS,
  ...ROUND_DELETE_FLAGS,
]);

// ── Keys with their own lifecycle (set + consumed in the same flow) ─────────
const ALLOWED_EXCEPTIONS = new Set([
  // Combat pipeline — managed by combat-bridge / post-combat handlers
  'pendingCombat',
  'pendingCelebration',
  'pendingReaction',
  'pendingCleave',
  'pendingFightingKnife',
  'pendingConcussiveBolt',
  'pendingSpreadThePain',
  'pendingSpreadThePainCondPick',
  'pendingBoltslinger',
  'pendingIndiscriminateFire',
  'pendingHeavyFire',
  'pendingHavocShot',
  'pendingDeflect',
  'pendingWantonDestruction',
  'pendingMastery',
  'pendingInterrogate',
  'pendingFigurehead',
  'pendingMissileSalvo',
  'pendingSuppressiveFireMp',
  'pendingBattlefieldLeadership',
  'pendingLure',
  'pendingEe3Carbine',
  'pendingRightBackAtYa',
  'pendingSlowOnTheDraw',
  'pendingStrikeMeDown',
  'pendingForceExhaustion',
  'pendingBleeding',
  'pendingAttachConfirm',
  'pendingZilloDiscard',

  // Movement handler — set/consumed in movement flow
  'pendingPounceSpaceChoice',
  'pendingDioFollow',
  'pendingShoulderRush',

  // DC play-area handler — set/consumed in dc-play-area flow
  'pendingDcAbilityChoice',
  'pendingFalseOrders',

  // Map/mission events — set/consumed in map-events or interact handler
  'pendingPowerConverter',
  'pendingRogueOneTokenPick',
  'pendingPowerTokenOverflow',

  // Defeat handler — set/consumed in defeat flow
  'pendingHeroicEffortReturn',
  'pendingScavengedWeaponryTransfer',
  'pendingIntoTheForce', // defeat-handler: set + cleared in the Into the Force pick flow

  // Combat pipeline reactive prompts — each set + cleared within its own
  // interaction flow (verified: every key has an explicit delete/clear site).
  'pendingCombatCcResolve', // after-attack-fire/combat: CC-resolve interrupt window
  'pendingDbhDiePick',      // combat: Driven by Hatred die pick

  // CC-play / ability reactive prompts — self-managed (set + cleared in flow)
  'pendingCcEffect',            // cc-hand: CC effect resolution handoff
  'pendingAdaptBlaise',         // blaise-adapt: Adapt (Blaise) prompt
  'pendingBarteredInfoFocused', // abilities: Bartered Information focus pick
  'pendingForbiddenKnowledge',  // abilities: Forbidden Knowledge prompt
  'pendingEyesOnThePrize',      // abilities: Eyes on the Prize prompt
  'pendingKuilTokenSplitState', // abilities: Kuiil token-split prompt

  // Movement / map reactive prompts — set + consumed in their move/map flow
  'pendingTriangulate',       // move-x-handler/abilities: Triangulate target pick
  'pendingCratePush',         // map-events/misc-helpers: crate push prompt

  // Round / strain reactive prompts — self-managed
  'pendingSmugglingCompartmentPeek', // round: Smuggling Compartment peek
  'pendingPrototypeMoveQueue',       // round: Prototype move queue
  'pendingScHeadhunter',             // strain-handler: SC Headhunter prompt
]);

// ── Directories and files to scan ───────────────────────────────────────────
const SCAN_PATHS = [
  'src/handlers',
  'src/game/abilities.js',
  'src/engine/combat-bridge.js',
  'src/engine/misc-helpers.js',
  'src/engine/defeat-handler.js',
];

/**
 * Walk SCAN_PATHS, read each .js file, and extract every `game.pending*` key
 * that appears in a write context (assignment / sub-key / property access).
 * Skips single-line comments.
 *
 * Returns Map<keyName, Set<relativePath>>
 */
function collectPendingKeys() {
  const pendingKeys = new Map();

  // Match game.pendingFoo followed by  = , [ , .  (but NOT ?. or == or ===)
  const writePattern = /game\.(pending[A-Z]\w*)\s*(?:=[^=]|\[|\.(?!\?))/g;

  for (const scanPath of SCAN_PATHS) {
    const fullPath = path.join(ROOT, scanPath);
    const stat = fs.statSync(fullPath, { throwIfNoEntry: false });
    if (!stat) continue;

    const files = stat.isDirectory()
      ? fs.readdirSync(fullPath).filter(f => f.endsWith('.js')).map(f => path.join(fullPath, f))
      : [fullPath];

    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf-8').split('\n');
      let inBlockComment = false;

      for (const line of lines) {
        // Crude block-comment tracking
        if (inBlockComment) {
          if (line.includes('*/')) inBlockComment = false;
          continue;
        }
        if (line.includes('/*')) {
          inBlockComment = !line.includes('*/');
          continue;
        }
        // Skip single-line comments
        const trimmed = line.trimStart();
        if (trimmed.startsWith('//')) continue;
        if (trimmed.startsWith('*')) continue; // JSDoc continuation lines

        for (const match of line.matchAll(writePattern)) {
          const key = match[1];
          if (!pendingKeys.has(key)) pendingKeys.set(key, new Set());
          pendingKeys.get(key).add(path.relative(ROOT, file));
        }
      }
    }
  }
  return pendingKeys;
}

// ── Tests ───────────────────────────────────────────────────────────────────
describe('Pending state lint', () => {
  it('every game.pending* key has a matching entry in activation-state.js cleanup lists', () => {
    const pendingKeys = collectPendingKeys();
    const missing = [];

    for (const [key, files] of pendingKeys) {
      if (ALLOWED_EXCEPTIONS.has(key)) continue;
      if (allCleanupFlags.has(key)) continue;
      missing.push({ key, files: [...files] });
    }

    if (missing.length > 0) {
      const details = missing
        .map(m => `  ${m.key} (found in: ${m.files.join(', ')})`)
        .join('\n');
      assert.fail(
        `${missing.length} pending state key(s) are NOT registered in ` +
        `activation-state.js cleanup lists:\n${details}\n\n` +
        'Add these keys to the appropriate flag list in ' +
        'src/game/activation-state.js, or add to ALLOWED_EXCEPTIONS ' +
        'if they have their own lifecycle.'
      );
    }
  });

  it('cleanup flag lists do not contain duplicate entries', () => {
    const lists = {
      ACTIVATION_MSGID_FLAGS,
      ACTIVATION_FIGKEY_FLAGS,
      ACTIVATION_PLAYERNUM_FLAGS,
      ACTIVATION_SCALAR_FLAGS,
      ROUND_OBJECT_FLAGS,
      ROUND_NULL_FLAGS,
      ROUND_ARRAY_FLAGS,
      ROUND_FALSE_FLAGS,
      ROUND_DELETE_FLAGS,
    };
    const dupes = [];
    for (const [name, arr] of Object.entries(lists)) {
      const seen = new Set();
      for (const key of arr) {
        if (seen.has(key)) dupes.push(`${name}: ${key}`);
        seen.add(key);
      }
    }
    assert.strictEqual(
      dupes.length,
      0,
      `Duplicate entries found:\n  ${dupes.join('\n  ')}`
    );
  });
});
