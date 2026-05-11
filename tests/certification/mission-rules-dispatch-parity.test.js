/**
 * Static-parse parity check: every rule key in mission-cards.json must have a
 * dispatch site somewhere in code (mission-rules.js, combat.js, round.js, or
 * dc-play-area.js).
 *
 * Why this exists: the data file describes mission mechanics declaratively,
 * but production code has historically routed several mechanics by hardcoded
 * `mapId === 'X' && variant === 'Y'` checks rather than reading the data
 * flags. Adding a new map with the same mechanic then requires editing
 * round.js too, defeating the data-driven design.
 *
 * Slice 8 wired all 5 missing keys (damageAdjacentToNpc, defenseModifierByZone,
 * npcKryknaActivation, openDoorPerTerminal, pushControlledCratesUpTo) to actual
 * dispatch sites + added 2 new keys (npcThugs, fluctuationSwapGate) for the
 * remaining hardcoded checks. This test is the guard so the same kind of
 * orphan flag can't sneak back in.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const DATA = JSON.parse(readFileSync(resolve(ROOT, 'data/mission-cards.json'), 'utf8'));

// Files that may contain rule-key dispatch logic. Concatenated into a single
// search corpus — a key is "dispatched" iff it appears as a property/string
// reference somewhere in this corpus.
const DISPATCH_CORPUS = [
  'src/game/mission-rules.js',
  'src/game/mission-eor-effects-wiring.js',
  'src/handlers/combat.js',
  'src/handlers/round.js',
  'src/handlers/dc-play-area.js',
  'src/handlers/map-events.js',
  'src/engine/setup-bridge.js',
  'src/engine/misc-helpers.js',
  'src/handlers/phase-gate.js',
  'src/handlers/interact.js',
].map((p) => readFileSync(resolve(ROOT, p), 'utf8')).join('\n\n--- FILE BOUNDARY ---\n\n');

// Top-level "rules" buckets we walk for dispatch keys.
const RULE_BUCKETS = ['persistent', 'startOfRound', 'endOfRound', 'immediate'];

// Field names that appear inside rule values (object payloads) but aren't
// themselves dispatch keys — exclude from the dispatch parity check.
const PAYLOAD_FIELDS = new Set([
  'controlCell','vpAmount','vpMessage','tokens','vpPerToken','tokenCountKey',
  'controlSpaces','crateValueByZone','tokenSource','vpPerCrate','tokenLabel',
  'tokenInteractType','controlAreaName','rotation','wakeOn','perRound',
  'allowOpponentDeploymentZoneCrates','vpAmountForOwnZoneOnly','minControlled',
  'maxVpFromZones','crateZoneRules','blastDestroysCrate','crates','tokenIcon',
  'color','iconText','vpThresholdsByZone','tokensFor','tokenAttachAtRoundStart',
  'tokenAttachAt','crateValue','vpThresholds','keyId','crateMessage','damage',
  'adjacentDamage','perFigure','exclude','onlyTo','vpEvent','tokenIcons',
  'spaces','spaceLabel','controlOwners','startSpace','endSpaces','vpFor',
  'vpEachZone','crateLayout','removeOnAttack','removeOnDestroy','centerSpace',
  'controlZone','tokenCount','attachAt','removeAfterAttach','crateLabel',
  'tokenCountByZone','attachToCrates','vpRules','attachAtPositions','attachToCrate',
  'npcType','npcName','figureCount','areaName','blockBonus','buffStateKey',
  'discardAfterScoring','evadeBonus','flipLimitPerRound','gameKey',
  'speedPenalty','strainStateKey','npcTag','opponentZone','ownZone','vp',
  'vpPerStrain','grantPowerToken','hp',
]);

function collectRuleKeys() {
  const keys = new Set();
  for (const mapData of Object.values(DATA.maps || {})) {
    for (const variant of Object.values(mapData)) {
      const rules = variant?.rules;
      if (!rules || typeof rules !== 'object') continue;
      // Top-level keys that aren't timing buckets are dispatch keys.
      for (const k of Object.keys(rules)) {
        if (RULE_BUCKETS.includes(k)) continue;
        keys.add(k);
      }
      // Keys inside timing buckets are dispatch keys.
      for (const bucket of RULE_BUCKETS) {
        const sub = rules[bucket];
        if (sub && typeof sub === 'object') {
          for (const k of Object.keys(sub)) keys.add(k);
        }
      }
    }
  }
  return [...keys].filter((k) => !PAYLOAD_FIELDS.has(k));
}

describe('Mission-rules dispatch parity (JSON keys ↔ code dispatch sites)', () => {
  it('every rule key in mission-cards.json has a dispatch site in code', () => {
    const ruleKeys = collectRuleKeys();
    const orphans = ruleKeys.filter((k) => {
      // Search for the key as a property reference. We use a word-boundary
      // pattern so partial matches don't pass (e.g. "npcThug" wouldn't match
      // when looking for "npcThugs" alone).
      const re = new RegExp(`\\b${k}\\b`);
      return !re.test(DISPATCH_CORPUS);
    });
    if (orphans.length) {
      assert.fail(
        `${orphans.length} rule key(s) in mission-cards.json have NO dispatch site in:\n` +
        `  src/game/mission-rules.js, src/handlers/combat.js, src/handlers/round.js,\n` +
        `  src/handlers/dc-play-area.js, src/engine/setup-bridge.js,\n` +
        `  src/handlers/phase-gate.js, src/handlers/interact.js\n\n` +
        `Orphan keys (defined in data, never read by code):\n` +
        orphans.map((k) => `  • ${k}`).join('\n') +
        `\n\nFix: either dispatch on the key in one of the listed files, or remove ` +
        `it from mission-cards.json. Adding a new map flag without a dispatch ` +
        `site is a silent no-op.`
      );
    }
    assert.ok(true);
  });

  it('every hardcoded mapId+variant check in round.js / dc-play-area.js for npcThugs/Krykna/Devaron-doors/fluctuation has been replaced with hasMissionFlag', () => {
    // Verify the 6 known sites no longer match the old `mapId === 'X' && variant === 'Y'` pattern
    // for the 4 distinct mechanic keys covered by slice 8.
    const round = readFileSync(resolve(ROOT, 'src/handlers/round.js'), 'utf8');
    const dcPa = readFileSync(resolve(ROOT, 'src/handlers/dc-play-area.js'), 'utf8');
    const corpus = round + '\n' + dcPa;
    const forbiddenPatterns = [
      /mapId === 'corellian-underground' && variant === 'a'/,
      /mapId === 'chopper-base-atollon' && variant === 'a'/,
      /mapId === 'lothal-wastes' && variant === 'b'/,
      /mapId === 'devaron-garrison' && variant === 'b'/,
    ];
    for (const re of forbiddenPatterns) {
      assert.doesNotMatch(corpus, re,
        `Hardcoded ${re.source} should be replaced with hasMissionFlag(mapId, variant, '<flag>') — slice 8`);
    }
  });
});
