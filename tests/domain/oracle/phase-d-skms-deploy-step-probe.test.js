/**
 * Phase-D probe: Setup Step 4 — initiative player chooses a deployment zone.
 *
 * PROBE-PD-SKMS-004: The initiative player chooses a deployment zone and
 *   places all their figures there; opposing players deploy in the
 *   complementary remaining zone. (CRR SKIRMISH SETUP STEP 4)
 *
 * Implementation: `handleDeploymentZone` in src/handlers/setup.js permits
 *   the zone-choice interaction only for
 *   `game.deviousSchemeZoneChooser || game.initiativePlayerId`. The chosen
 *   zone is stored on `game.deploymentZoneChosen`; the opposing player is
 *   auto-assigned the complementary zone. Deployment placement (covered
 *   by CRR-DEPL-001) then restricts each player to their assigned zone.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SETUP_SRC = readFileSync(resolve(__dirname, '../../../src/handlers/setup.js'), 'utf8');

describe('PROBE-PD-SKMS-004: initiative player chooses deployment zone; opponent gets complementary zone', () => {
  it('004a: source — zone-choice interaction is gated to the initiative player (or Devious Scheme override)', () => {
    assert.match(SETUP_SRC,
      /const zoneChooserId = game\.deviousSchemeZoneChooser \|\| game\.initiativePlayerId;/,
      'zone chooser must default to initiativePlayerId — CRR-SKMS-004');
    assert.match(SETUP_SRC,
      /Only the designated player can choose the deployment zone\./,
      'non-initiative players must be rejected from the zone-choice flow — CRR-SKMS-004');
  });

  it('004b: source — the chosen zone is recorded on game.deploymentZoneChosen (single source of truth)', () => {
    assert.match(SETUP_SRC, /game\.deploymentZoneChosen = zone;/,
      'chosen zone must be stored on game.deploymentZoneChosen — CRR-SKMS-004');
  });

  it('004c: source — the opposing player is assigned the complementary zone (red <-> blue)', () => {
    assert.match(SETUP_SRC, /const otherZone = zone === 'red' \? 'blue' : 'red';/,
      'other zone must be the complement of the chosen zone — CRR-SKMS-004');
    assert.match(SETUP_SRC,
      /game\[`player\$\{zoneChooserPlayerNum === 1 \? 2 : 1\}DeploymentZone`\] = otherZone;/,
      'opponent must receive the complementary zone — CRR-SKMS-004');
  });

  it('004d: source — deploy-time zone lookup resolves each player to their assigned zone', () => {
    // Pattern: const playerZone = playerNum === initiativePlayerNum ? game.deploymentZoneChosen : (chosen === 'red' ? 'blue' : 'red');
    const pat = /const playerZone = playerNum === initiativePlayerNum \? game\.deploymentZoneChosen : \(game\.deploymentZoneChosen === 'red' \? 'blue' : 'red'\);/g;
    const matches = SETUP_SRC.match(pat) || [];
    assert.ok(matches.length >= 4,
      `deploy variants must resolve playerZone via initiativePlayerNum check — matched ${matches.length} — CRR-SKMS-004`);
  });

  it('004e: source — zone cannot be re-chosen once set (guard against double-selection)', () => {
    assert.match(SETUP_SRC,
      /if \(game\.deploymentZoneChosen\) \{\s*\n\s*await interaction\.followUp\(\{ content: `Deployment zone already chosen/,
      'once game.deploymentZoneChosen is set, re-entry must be rejected — CRR-SKMS-004');
  });
});
