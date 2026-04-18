/**
 * Phase-D probe: skirmish setup places figures within deployment zones.
 *
 * PROBE-PD-DEPL-001: During setup of a skirmish, players place all of
 *   their figures within their deployment zone. (CRR DEPLOYMENT)
 *
 * Implementation: `src/handlers/setup.js` resolves the player's zone via
 *   `getDeploymentZones()[mapId][playerZone]` and feeds exactly those
 *   coordinates into `filterValidTopLeftSpaces` as the universe of legal
 *   top-left cells. The zone does NOT expand for Massive figures (source
 *   comment). All four deployment variants (standard, orient, reposition,
 *   sprint) use the same zone-bounded pattern.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDeploymentZones } from '../../../src/data-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SETUP_SRC = readFileSync(resolve(__dirname, '../../../src/handlers/setup.js'), 'utf8');

describe('PROBE-PD-DEPL-001: skirmish deployment restricts placement to the player zone', () => {
  it('001a: source — zoneSpaces is resolved from the player zone (red/blue), not the full map', () => {
    // Pattern: const zoneSpaces = (zones?.[playerZone] || []).map(...)
    const pat = /const zoneSpaces = \(zones\?\.\[playerZone\] \|\| \[\]\)\.map/g;
    const matches = SETUP_SRC.match(pat) || [];
    assert.ok(matches.length >= 1,
      `setup.js must resolve zoneSpaces from zones[playerZone] — matched ${matches.length} — CRR-DEPL-001`);
  });

  it('001b: source — filterValidTopLeftSpaces takes zoneSpaces as the universe of legal cells', () => {
    // Every deploy site uses: filterValidTopLeftSpaces(zoneSpaces, occupied, ...)
    const pat = /filterValidTopLeftSpaces\(zoneSpaces,\s*occupied,/g;
    const matches = SETUP_SRC.match(pat) || [];
    assert.ok(matches.length >= 4,
      `all deploy variants must feed zoneSpaces into filterValidTopLeftSpaces — matched ${matches.length} — CRR-DEPL-001`);
  });

  it('001c: source — the explanatory comment pins the rule: figures must deploy within the zone', () => {
    assert.match(SETUP_SRC, /figures must deploy within the zone/,
      'setup.js must state the deploy-within-zone invariant in code — CRR-DEPL-001');
  });

  it('001d: source — the initiative player gets their chosen zone; the opponent gets the complementary zone', () => {
    // const playerZone = playerNum === initiativePlayerNum ? game.deploymentZoneChosen : (chosen === 'red' ? 'blue' : 'red');
    const pat = /const playerZone = playerNum === initiativePlayerNum \? game\.deploymentZoneChosen : \(game\.deploymentZoneChosen === 'red' \? 'blue' : 'red'\);/g;
    const matches = SETUP_SRC.match(pat) || [];
    assert.ok(matches.length >= 4,
      `zone assignment by initiative must be consistent across deploy variants — matched ${matches.length} — CRR-DEPL-001`);
  });

  it('001e: data — getDeploymentZones() returns map-keyed zones with red and blue subkeys', () => {
    const zones = getDeploymentZones();
    const mapIds = Object.keys(zones);
    assert.ok(mapIds.length >= 1, 'at least one map must be registered — CRR-DEPL-001');
    for (const id of mapIds) {
      const z = zones[id];
      assert.ok(z && typeof z === 'object', `zones[${id}] must be an object — CRR-DEPL-001`);
      // Every map defines at least one of the two player zones.
      assert.ok(Array.isArray(z.red) || Array.isArray(z.blue),
        `zones[${id}] must define red or blue coord list — CRR-DEPL-001`);
    }
  });

  it('001f: source — zone is NOT extended for Massive; deploy stays within the zone', () => {
    assert.match(SETUP_SRC, /Zone is NOT extended for Massive/,
      'the comment pin must acknowledge that Massive figures still deploy within the zone — CRR-DEPL-001');
  });
});
