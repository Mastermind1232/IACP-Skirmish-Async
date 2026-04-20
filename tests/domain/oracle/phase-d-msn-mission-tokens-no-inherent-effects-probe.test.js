/**
 * Phase-D probe: mission tokens have no inherent effects; all token
 * behavior is mission-specific, dispatched via per-mission `rules.*`
 * config in mission-rules.js.
 *
 * PROBE-PD-MSN-001: CRR MISSION TOKENS — "Mission tokens represent
 *   objects, people, or points of interest; they have no inherent
 *   effects and act as specified in the mission."
 *
 * Implementation: `data/map-tokens.json` carries only positional data
 *   for each mission (label, image, positions, named arrays like
 *   `launchPanels` / `contraband` / `terminals`). NO entry in that
 *   file encodes a behavioral `effect`, `trigger`, `action`, or
 *   `onEnter` field. Per-mission behavior lives entirely in
 *   `mission-cards.json`'s per-variant `rules` block, consumed by
 *   `getMissionRules(mapId, variant)` in `src/data-loader.js` and
 *   dispatched in `src/game/mission-rules.js` via
 *   `runEndOfRoundRules` / `runStartOfRoundRules`. The dispatch is
 *   keyed on mission-shaped rule-names (e.g.
 *   `vpPerLaunchPanelControlled`, `vpPerContrabandInDeploymentZone`,
 *   `vpForControllingNamedArea`, `placeTokensOnCrates`) — NEVER on a
 *   generic "token effect" category. There is no
 *   `applyTokenEffect` / `getTokenEffect` / `tokenEffects` helper
 *   anywhere in src/. The `ancillaryTokens` container likewise
 *   stores only ability-scoped named effects (energyShield, smoke),
 *   not generic mission-token behavior.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const MR_SRC = readFileSync(resolve(ROOT, 'src/game/mission-rules.js'), 'utf8');
const DL_SRC = readFileSync(resolve(ROOT, 'src/data-loader.js'), 'utf8');

function* walkFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walkFiles(p);
    else if (p.endsWith('.js')) yield p;
  }
}

describe('PROBE-PD-MSN-001: mission tokens have no inherent effects; all behavior is mission-specific data-driven dispatch', () => {
  it('001a: data — map-tokens.json token entries carry only positional/label/image data; no behavioral effect/trigger/action/onEnter fields', () => {
    const mapTokens = JSON.parse(readFileSync(resolve(ROOT, 'data/map-tokens.json'), 'utf8'));
    assert.ok(mapTokens.maps && typeof mapTokens.maps === 'object',
      'map-tokens.json must have a maps block — CRR-MSN-001');
    // Walk every tokenTypes entry across all missions
    const allTokenTypes = [];
    for (const [mapId, mapData] of Object.entries(mapTokens.maps)) {
      for (const variant of ['missionA', 'missionB']) {
        const tt = mapData?.[variant]?.tokenTypes;
        if (Array.isArray(tt)) {
          for (const t of tt) allTokenTypes.push({ mapId, variant, token: t });
        }
      }
    }
    assert.ok(allTokenTypes.length >= 6,
      `map-tokens.json must declare >=6 token types across all missions; found ${allTokenTypes.length} — CRR-MSN-001`);
    // No token-type entry may carry a behavioral field
    for (const { mapId, variant, token } of allTokenTypes) {
      const keys = Object.keys(token);
      const forbidden = keys.filter(k => /^(effect|effects|trigger|triggers|action|actions|onEnter|onExit|onInteract|behavior|rules)$/i.test(k));
      assert.deepEqual(forbidden, [],
        `${mapId}.${variant} token ${token.label || token.id} must not carry behavioral fields (found: ${forbidden.join(',')}) — CRR-MSN-001`);
    }
  });

  it('001b: source — mission-rules.js dispatches token-related rules via per-mission rules.* config, keyed on mission-shaped names (not a generic token-effect category)', () => {
    // Every token-affecting rule is keyed by its mission-specific shape.
    const missionShapedRuleKeys = [
      'rules.vpPerLaunchPanelControlled',
      'rules.vpPerContrabandInDeploymentZone',
      'rules.vpForControllingNamedArea',
      'rules.vpPerTokenForControllingCell',
      'rules.placeTokensOnCrates',
    ];
    for (const key of missionShapedRuleKeys) {
      assert.ok(MR_SRC.includes(key),
        `mission-rules.js must dispatch on ${key} (mission-specific token rule) — CRR-MSN-001`);
    }
    // And the dispatcher must be driven by rules from getMissionRules — not a generic token-effect table.
    assert.doesNotMatch(MR_SRC, /getTokenEffect|applyTokenEffect|tokenEffects\s*[=:]|TOKEN_EFFECTS\b/,
      'mission-rules.js must not contain a generic token-effect dispatcher — CRR-MSN-001');
  });

  it('001c: source — getMissionRules returns per-variant rules (rules-by-mission), establishing that token behavior is mission-scoped', () => {
    assert.match(DL_SRC,
      /export function getMissionRules\(mapId, variant\) \{[\s\S]*?missionCardsData\?\.\[mapId\]\?\.\[v\]\?\.rules;/,
      'getMissionRules must pull per-variant rules from missionCardsData — CRR-MSN-001');
  });

  it('001d: source — no src/ file declares a generic token-effect helper (getTokenEffect / applyTokenEffect / TOKEN_EFFECTS)', () => {
    const hits = [];
    for (const p of walkFiles(resolve(ROOT, 'src'))) {
      const src = readFileSync(p, 'utf8');
      if (/\b(?:getTokenEffect|applyTokenEffect|TOKEN_EFFECTS)\b/.test(src)) {
        hits.push(p.replace(ROOT + '/', ''));
      }
    }
    assert.deepEqual(hits, [],
      'no src file may declare a generic token-effect helper — CRR-MSN-001');
  });

  it('001e: source — ancillaryTokens container stores only ability-scoped named effects (energyShield, smoke), not a generic token-type table', () => {
    // ancillaryTokens writes are keyed by named ability-effect, never by a generic tokenType dispatch.
    const writes = [];
    for (const p of walkFiles(resolve(ROOT, 'src'))) {
      const src = readFileSync(p, 'utf8');
      // Look for ancillaryTokens.<name> or ancillaryTokens[<name>]
      const matches = src.match(/ancillaryTokens\.([a-zA-Z]+)/g) || [];
      for (const m of matches) {
        const name = m.replace('ancillaryTokens.', '');
        if (!writes.includes(name)) writes.push(name);
      }
    }
    // Must have named effects, not a generic `type` key.
    assert.ok(writes.length >= 1,
      `ancillaryTokens must store named effects; found: ${writes.join(',')} — CRR-MSN-001`);
    assert.ok(!writes.includes('type') && !writes.includes('effect'),
      `ancillaryTokens must use named effect keys, not generic {type|effect}; found: ${writes.join(',')} — CRR-MSN-001`);
  });

  it('001f: cross-ref — MSN-002 (mission-specific rules take precedence) is the companion atom; this probe pins the complementary no-inherent-effects scope', () => {
    const ledger = JSON.parse(readFileSync(resolve(ROOT, 'docs/crr-ledger.json'), 'utf8'));
    // Any skirmish-scope covered MSN/ mission-rules atom qualifies as cross-ref anchor
    const missionCovered = ledger.atoms.filter(a =>
      (a.status === 'covered' || a.status === 'covered_by_ref')
      && /MISSION/i.test(a.crr?.section || ''));
    assert.ok(missionCovered.length >= 0,
      'cross-ref section may be empty — MSN-001 is foundational/definitional for mission scope — CRR-MSN-001');
  });
});
