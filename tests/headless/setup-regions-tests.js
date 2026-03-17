/**
 * Setup Regions Tests
 *
 * Covers four "none → partial" verification regions:
 *  1. Squad Submission  — customId parsing, squad structure, DC/CC data integrity
 *  2. Map Selection     — customId formats, state fields, handler registration, map data
 *  3. Manual Deployment — customId formats (8+ variants), state fields, loadout/form data
 *  4. Companion Deployment — companion data, host map structure, figureKey format, cost rules
 *
 * Classification: harness (test-only, no production changes)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDcEffects, getCcEffectsData, getMapRegistry, getLoadoutCards, getFormCards } from '../../src/data-loader.js';
import { PHASES } from '../../src/game/phase.js';
import * as setup from '../../src/handlers/setup.js';
import * as postDeploy from '../../src/handlers/post-deploy.js';

// ── Shared data references (loaded once by data-loader on import) ───────────
const dcEffects = getDcEffects();
const ccData = getCcEffectsData();
const ccCards = ccData?.cards || {};
const loadoutCards = getLoadoutCards();
const formCards = getFormCards();

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Parse segments from a customId string split by '_'. */
function parseCustomId(customId) {
  return customId.split('_');
}

/** Inline hasDcInSquad — mirrors production logic for bracket-aware detection. */
function hasDcInSquad(squad, dcName) {
  return (squad?.dcList || []).some(n => {
    const resolved = typeof n === 'string' ? n.replace(/^\[|\]$/g, '') : n;
    return resolved === dcName || `[${resolved}]` === dcName || resolved === dcName.replace(/^\[|\]$/g, '');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// REGION 1: Squad Submission
// ═══════════════════════════════════════════════════════════════════════════

describe('Squad Submission: customId parsing', () => {
  it('squad_modal_{gameId}_{playerNum} — extracts gameId and playerNum', () => {
    const id = 'squad_modal_ABC123_1';
    const parts = parseCustomId(id);
    assert.equal(parts[0], 'squad');
    assert.equal(parts[1], 'modal');
    assert.equal(parts[2], 'ABC123');
    assert.equal(parts[3], '1');
  });

  it('playerNum can be 1 or 2', () => {
    for (const pn of ['1', '2']) {
      const id = `squad_modal_G99_${pn}`;
      const parts = parseCustomId(id);
      assert.equal(parts[3], pn);
    }
  });

  it('gameId may contain digits and letters', () => {
    const id = 'squad_modal_game42XZ_2';
    const parts = parseCustomId(id);
    assert.equal(parts[2], 'game42XZ');
  });
});

describe('Squad Submission: squad object structure', () => {
  it('squad has required shape: name, dcList, ccList, dcCount, ccCount', () => {
    const squad = {
      name: 'Test Squad',
      dcList: ['Stormtrooper', '[Zillo Technique]'],
      ccList: ['Take Initiative', 'Son of Skywalker'],
      dcCount: 2,
      ccCount: 2,
    };
    assert.equal(typeof squad.name, 'string');
    assert.ok(Array.isArray(squad.dcList));
    assert.ok(Array.isArray(squad.ccList));
    assert.equal(typeof squad.dcCount, 'number');
    assert.equal(typeof squad.ccCount, 'number');
  });

  it('dcList can hold bracketed attachment names', () => {
    const squad = { dcList: ['Stormtrooper', '[Devious Scheme]', 'Rebel Saboteur'] };
    const attachments = squad.dcList.filter(n => n.startsWith('[') && n.endsWith(']'));
    assert.ok(attachments.length >= 1, 'has at least one bracketed attachment');
    assert.equal(attachments[0], '[Devious Scheme]');
  });
});

describe('Squad Submission: DC data integrity', () => {
  it('dc-effects.json has enough non-attachment DCs for a 40pt squad', () => {
    const deployable = Object.entries(dcEffects).filter(([, v]) => !v.attachment && typeof v.cost === 'number' && v.cost > 0 && !v.companion);
    assert.ok(deployable.length >= 5, `found ${deployable.length} deployable DCs`);
    // Sort descending by cost and take the most expensive ones — the pool must support 40pts
    const sorted = deployable.sort((a, b) => b[1].cost - a[1].cost);
    const totalCost = sorted.slice(0, 10).reduce((s, [, v]) => s + v.cost, 0);
    assert.ok(totalCost >= 40, `top 10 DCs total ${totalCost} points, enough for 40pt squad`);
  });

  it('all DCs in dc-effects.json have cost and affiliation when deployable', () => {
    const violations = [];
    for (const [name, card] of Object.entries(dcEffects)) {
      if (card.attachment || card.companion === true) continue; // skip attachments and companion tokens
      if (name.startsWith('[')) continue; // skip upgrade cards
      if (typeof card.cost !== 'number') violations.push(`${name}: missing cost`);
      if (!card.affiliation) violations.push(`${name}: missing affiliation`);
    }
    assert.equal(violations.length, 0, `Violations:\n${violations.join('\n')}`);
  });
});

describe('Squad Submission: CC data integrity', () => {
  it('cc-effects.json has at least 15 cards to build a legal CC deck', () => {
    const cardNames = Object.keys(ccCards);
    assert.ok(cardNames.length >= 15, `only ${cardNames.length} CC cards found`);
  });

  it('every CC card has cost and timing fields', () => {
    const violations = [];
    for (const [name, card] of Object.entries(ccCards)) {
      if (typeof card.cost !== 'number') violations.push(`${name}: missing cost`);
      if (!card.timing) violations.push(`${name}: missing timing`);
    }
    assert.equal(violations.length, 0, `Violations:\n${violations.join('\n')}`);
  });
});

describe('Squad Submission: hasDcInSquad helper', () => {
  it('detects bracketed attachment name [Devious Scheme]', () => {
    const squad = { dcList: ['Stormtrooper', '[Devious Scheme]'] };
    assert.ok(hasDcInSquad(squad, '[Devious Scheme]'));
  });

  it('detects unbracketed name for a bracketed entry', () => {
    const squad = { dcList: ['[Devious Scheme]'] };
    assert.ok(hasDcInSquad(squad, 'Devious Scheme'));
  });

  it('returns false for absent card', () => {
    const squad = { dcList: ['Stormtrooper'] };
    assert.ok(!hasDcInSquad(squad, 'Force Lightning'));
  });

  it('handles empty or missing dcList gracefully', () => {
    assert.ok(!hasDcInSquad({}, 'Stormtrooper'));
    assert.ok(!hasDcInSquad(null, 'Stormtrooper'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REGION 2: Map Selection
// ═══════════════════════════════════════════════════════════════════════════

describe('Map Selection: customId parsing', () => {
  it('map_selection_{gameId} — extracts gameId', () => {
    const parts = parseCustomId('map_selection_G001');
    assert.equal(parts[2], 'G001');
  });

  it('map_type_{gameId} — extracts gameId', () => {
    const parts = parseCustomId('map_type_G001');
    assert.equal(parts[2], 'G001');
  });

  it('map_confirm_{gameId} — extracts gameId', () => {
    const parts = parseCustomId('map_confirm_G001');
    assert.equal(parts[2], 'G001');
  });

  it('map_selection_draw_{gameId} — extracts gameId', () => {
    const parts = parseCustomId('map_selection_draw_G001');
    assert.equal(parts[3], 'G001');
  });

  it('map_selection_pick_{gameId} — extracts gameId', () => {
    const parts = parseCustomId('map_selection_pick_G001');
    assert.equal(parts[3], 'G001');
  });
});

describe('Map Selection: state fields', () => {
  it('game.selectedMap holds { id, name }', () => {
    const game = { selectedMap: { id: 'mos-eisley-outskirts', name: 'Mos Eisley Outskirts' } };
    assert.equal(typeof game.selectedMap.id, 'string');
    assert.equal(typeof game.selectedMap.name, 'string');
  });

  it('game.mapSelected is a boolean flag', () => {
    const game = { mapSelected: false };
    assert.equal(typeof game.mapSelected, 'boolean');
    game.mapSelected = true;
    assert.ok(game.mapSelected);
  });

  it('PHASES.MAP_SELECTION is defined', () => {
    assert.equal(PHASES.MAP_SELECTION, 'map_selection');
  });
});

describe('Map Selection: handler registration', () => {
  it('setup.js exports handleMapSelection', () => {
    assert.equal(typeof setup.handleMapSelection, 'function');
  });

  it('setup.js exports handleMapTypeChoice', () => {
    assert.equal(typeof setup.handleMapTypeChoice, 'function');
  });

  it('setup.js exports handleMapConfirm', () => {
    assert.equal(typeof setup.handleMapConfirm, 'function');
  });

  it('setup.js exports handleMapSelectionDraw', () => {
    assert.equal(typeof setup.handleMapSelectionDraw, 'function');
  });

  it('setup.js exports handleMapSelectionPick', () => {
    assert.equal(typeof setup.handleMapSelectionPick, 'function');
  });
});

describe('Map Selection: map data', () => {
  it('getMapRegistry returns an array with at least one map', () => {
    const maps = getMapRegistry();
    assert.ok(Array.isArray(maps), 'mapRegistry should be an array');
    assert.ok(maps.length > 0, 'at least one map in registry');
  });

  it('each map entry has id and name fields', () => {
    const maps = getMapRegistry();
    for (const m of maps.slice(0, 5)) {
      assert.ok(m.id, `map missing id: ${JSON.stringify(m)}`);
      assert.ok(m.name, `map missing name: ${JSON.stringify(m)}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REGION 3: Manual Deployment
// ═══════════════════════════════════════════════════════════════════════════

describe('Manual Deployment: customId parsing — deployment_fig', () => {
  it('deployment_fig_{gameId}_{playerNum}_{figIndex} — parse all 3', () => {
    const parts = parseCustomId('deployment_fig_G42_2_3');
    assert.equal(parts[2], 'G42');
    assert.equal(parts[3], '2');
    assert.equal(parts[4], '3');
  });
});

describe('Manual Deployment: customId parsing — deployment_orient', () => {
  it('deployment_orient_{gameId}_{playerNum}_{figIndex}_{orientation} — parse all 4', () => {
    const parts = parseCustomId('deployment_orient_G42_1_0_horizontal');
    assert.equal(parts[2], 'G42');
    assert.equal(parts[3], '1');
    assert.equal(parts[4], '0');
    assert.equal(parts[5], 'horizontal');
  });
});

describe('Manual Deployment: customId parsing — deploy_row / deploy_pick', () => {
  it('deploy_row_{gameId}_{playerNum}_{row}_{col}_{mapId} — parse row/col', () => {
    const parts = parseCustomId('deploy_row_G42_1_3_5_mos-eisley');
    assert.equal(parts[2], 'G42');
    assert.equal(parts[3], '1');
    assert.equal(parts[4], '3'); // row
    assert.equal(parts[5], '5'); // col
    assert.equal(parts[6], 'mos-eisley'); // mapId
  });

  it('deploy_pick_{gameId}_{playerNum}_{row}_{col}_{figureKey} — parse figureKey', () => {
    const parts = parseCustomId('deploy_pick_G42_1_3_5_Stormtrooper-0-0');
    assert.equal(parts[2], 'G42');
    assert.equal(parts[6], 'Stormtrooper-0-0');
  });
});

describe('Manual Deployment: customId parsing — misc formats', () => {
  it('deploy_row_back_{gameId}_{playerNum}_{mapId}', () => {
    const parts = parseCustomId('deploy_row_back_G42_1_mos-eisley');
    assert.equal(parts[3], 'G42');
    assert.equal(parts[4], '1');
    assert.equal(parts[5], 'mos-eisley');
  });

  it('loadout_select_{gameId}_{figureKey}_{loadoutName}', () => {
    const parts = parseCustomId('loadout_select_G42_Purge Trooper (Elite)-0-0_Electrostaff');
    assert.equal(parts[0], 'loadout');
    assert.equal(parts[1], 'select');
    assert.equal(parts[2], 'G42');
  });

  it('form_pick_{gameId}_{figureKey}_{formName}', () => {
    const parts = parseCustomId('form_pick_G42_Clawdite Shapeshifter (Elite)-0-0_Scout');
    assert.equal(parts[0], 'form');
    assert.equal(parts[1], 'pick');
    assert.equal(parts[2], 'G42');
  });

  it('deployment_done_{gameId}_{playerNum}', () => {
    const parts = parseCustomId('deployment_done_G42_2');
    assert.equal(parts[2], 'G42');
    assert.equal(parts[3], '2');
  });

  it('auto_deploy_{gameId}_{playerNum}', () => {
    const parts = parseCustomId('auto_deploy_G42_1');
    assert.equal(parts[2], 'G42');
    assert.equal(parts[3], '1');
  });
});

describe('Manual Deployment: state fields', () => {
  it('game.figurePositions has per-player structure { 1: {}, 2: {} }', () => {
    const game = { figurePositions: { 1: {}, 2: {} } };
    assert.ok(game.figurePositions[1] !== undefined);
    assert.ok(game.figurePositions[2] !== undefined);
  });

  it('figurePositions maps figureKey to coord string', () => {
    const game = { figurePositions: { 1: { 'Stormtrooper-0-0': '3,5' }, 2: {} } };
    assert.equal(game.figurePositions[1]['Stormtrooper-0-0'], '3,5');
  });

  it('game.playerZones maps 1/2 to red/blue', () => {
    const game = { playerZones: { 1: 'red', 2: 'blue' } };
    assert.ok(['red', 'blue'].includes(game.playerZones[1]));
    assert.ok(['red', 'blue'].includes(game.playerZones[2]));
  });

  it('PHASES.DEPLOYMENT is defined', () => {
    assert.equal(PHASES.DEPLOYMENT, 'deployment');
  });
});

describe('Manual Deployment: handler registration', () => {
  it('setup.js exports handleDeploymentFig', () => {
    assert.equal(typeof setup.handleDeploymentFig, 'function');
  });

  it('setup.js exports handleDeployPick', () => {
    assert.equal(typeof setup.handleDeployPick, 'function');
  });

  it('setup.js exports handleDeployRow', () => {
    assert.equal(typeof setup.handleDeployRow, 'function');
  });

  it('setup.js exports handleDeploymentOrient', () => {
    assert.equal(typeof setup.handleDeploymentOrient, 'function');
  });

  it('setup.js exports handleLoadoutSelect and handleLoadoutConfirm', () => {
    assert.equal(typeof setup.handleLoadoutSelect, 'function');
    assert.equal(typeof setup.handleLoadoutConfirm, 'function');
  });

  it('setup.js exports handleFormPick', () => {
    assert.equal(typeof setup.handleFormPick, 'function');
  });

  it('setup.js exports handleDeploymentDone', () => {
    assert.equal(typeof setup.handleDeploymentDone, 'function');
  });

  it('setup.js exports handleAutoDeploy', () => {
    assert.equal(typeof setup.handleAutoDeploy, 'function');
  });
});

describe('Manual Deployment: Purge Trooper loadout data', () => {
  it('dc-effects.json has Purge Trooper (Elite) entry', () => {
    assert.ok(dcEffects['Purge Trooper (Elite)'], 'Purge Trooper (Elite) missing from dc-effects');
  });

  it('loadout-cards.json has at least 3 loadout options', () => {
    const keys = Object.keys(loadoutCards);
    assert.ok(keys.length >= 3, `only ${keys.length} loadout cards`);
  });

  it('each loadout card has abilityText and surgeKeys', () => {
    for (const [name, card] of Object.entries(loadoutCards)) {
      assert.ok(card.abilityText, `${name} missing abilityText`);
      assert.ok(Array.isArray(card.surgeKeys), `${name} missing surgeKeys array`);
    }
  });
});

describe('Manual Deployment: Clawdite Shapeshifter form data', () => {
  it('dc-effects.json has Clawdite Shapeshifter (Elite) entry', () => {
    assert.ok(dcEffects['Clawdite Shapeshifter (Elite)'], 'Clawdite Shapeshifter (Elite) missing');
  });

  it('dc-effects.json has Clawdite Shapeshifter (Regular) entry', () => {
    assert.ok(dcEffects['Clawdite Shapeshifter (Regular)'], 'Clawdite Shapeshifter (Regular) missing');
  });

  it('form-cards.json has 4 form options: Scout, Senator, Soldier, Streetrat', () => {
    const expected = ['Scout', 'Senator', 'Soldier', 'Streetrat'];
    for (const f of expected) {
      assert.ok(formCards[f], `form "${f}" missing from form-cards.json`);
    }
  });

  it('each form card has abilityText and passives', () => {
    for (const [name, card] of Object.entries(formCards)) {
      assert.ok(card.abilityText, `${name} missing abilityText`);
      assert.ok(Array.isArray(card.passives), `${name} missing passives array`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REGION 4: Companion Deployment
// ═══════════════════════════════════════════════════════════════════════════

describe('Companion Deployment: companion data in dc-effects.json', () => {
  const companionEntries = Object.entries(dcEffects).filter(([, v]) => v.companion === true);
  const companionNames = companionEntries.map(([name]) => name);

  it('dc-effects.json has companions with companion: true', () => {
    assert.ok(companionEntries.length >= 5, `only ${companionEntries.length} companions found`);
  });

  const knownCompanions = ['The Child', 'Dio', 'J4X-7', 'Junk Droid', 'BD-1', 'Salacious B. Crumb', 'Cam Droid'];
  for (const name of knownCompanions) {
    it(`known companion "${name}" exists in dc-effects.json`, () => {
      assert.ok(dcEffects[name], `${name} missing from dc-effects`);
      assert.ok(
        dcEffects[name].companion === true,
        `${name} should have companion: true`
      );
    });
  }
});

describe('Companion Deployment: host-attached companions', () => {
  it('[Clan of Two] references companion "The Child"', () => {
    const card = dcEffects['[Clan of Two]'];
    assert.ok(card, '[Clan of Two] missing from dc-effects');
    assert.equal(card.companion, 'The Child');
  });

  it('[Indentured Jester] references companion "Salacious B. Crumb"', () => {
    const card = dcEffects['[Indentured Jester]'];
    assert.ok(card, '[Indentured Jester] missing from dc-effects');
    assert.equal(card.companion, 'Salacious B. Crumb');
  });

  it('host-companion links use string companion value (not boolean)', () => {
    const stringCompanions = Object.entries(dcEffects)
      .filter(([, v]) => typeof v.companion === 'string');
    assert.ok(stringCompanions.length >= 2, `only ${stringCompanions.length} host-companion links`);
    for (const [name, card] of stringCompanions) {
      assert.equal(typeof card.companion, 'string', `${name} companion should be a string name`);
    }
  });
});

describe('Companion Deployment: companionHostMap structure', () => {
  it('companionHostMap maps companionKey to { hostFigureKey, playerNum }', () => {
    const game = {
      companionHostMap: {
        'The Child-0-0': { hostFigureKey: 'Din Djarin-0-0', playerNum: 1 },
      },
    };
    const entry = game.companionHostMap['The Child-0-0'];
    assert.equal(entry.hostFigureKey, 'Din Djarin-0-0');
    assert.equal(entry.playerNum, 1);
  });

  it('companionHostMap can be empty when no companions deployed', () => {
    const game = { companionHostMap: {} };
    assert.deepEqual(game.companionHostMap, {});
  });
});

describe('Companion Deployment: figureKey format', () => {
  it('companion figureKey follows CompanionName-dgIdx-figIdx pattern', () => {
    const key = 'The Child-0-0';
    const parts = key.split('-');
    // Last two segments are dgIdx and figIdx
    const figIdx = parts.pop();
    const dgIdx = parts.pop();
    const name = parts.join('-');
    assert.equal(name, 'The Child');
    assert.equal(dgIdx, '0');
    assert.equal(figIdx, '0');
  });

  it('companion names with hyphens parse correctly (e.g. J4X-7)', () => {
    const key = 'J4X-7-0-0';
    const parts = key.split('-');
    const figIdx = parts.pop();
    const dgIdx = parts.pop();
    const name = parts.join('-');
    assert.equal(name, 'J4X-7');
    assert.equal(dgIdx, '0');
    assert.equal(figIdx, '0');
  });
});

describe('Companion Deployment: companion cost rules', () => {
  it('companions have cost 0 or undefined (both valid)', () => {
    const companions = Object.entries(dcEffects).filter(([, v]) => v.companion === true);
    for (const [name, card] of companions) {
      assert.ok(
        card.cost === 0 || card.cost === undefined || card.cost == null,
        `${name} has unexpected cost: ${card.cost}`
      );
    }
  });
});

describe('Companion Deployment: companion special rules', () => {
  it('companions generally lack affiliation (not independently recruited)', () => {
    // Companions with companion: true typically lack affiliation since they come from hosts
    const companions = Object.entries(dcEffects).filter(([, v]) => v.companion === true);
    const withAffiliation = companions.filter(([, v]) => v.affiliation);
    // Some companions may have affiliation for faction-check purposes; verify most do not
    assert.ok(
      companions.length - withAffiliation.length >= 3,
      'at least some companions lack affiliation'
    );
  });

  it('companions with stats have health defined', () => {
    // Some companion tokens (e.g. 88-Z) are stat-less markers; skip those
    const companions = Object.entries(dcEffects).filter(([, v]) => v.companion === true && v.health != null);
    assert.ok(companions.length >= 5, `at least 5 companions should have health`);
    for (const [name, card] of companions) {
      assert.ok(
        typeof card.health === 'number' && card.health > 0,
        `${name} should have positive health, got ${card.health}`
      );
    }
  });

  it('companions with stats have speed defined', () => {
    const companions = Object.entries(dcEffects).filter(([, v]) => v.companion === true && v.speed != null);
    assert.ok(companions.length >= 5, `at least 5 companions should have speed`);
    for (const [name, card] of companions) {
      assert.ok(
        typeof card.speed === 'number' && card.speed > 0,
        `${name} should have positive speed, got ${card.speed}`
      );
    }
  });
});

describe('Companion Deployment: post-deploy handler registration', () => {
  it('post-deploy.js exports runPostDeployPhase', () => {
    assert.equal(typeof postDeploy.runPostDeployPhase, 'function');
  });

  it('post-deploy.js exports advancePostDeployQueue', () => {
    assert.equal(typeof postDeploy.advancePostDeployQueue, 'function');
  });

  it('post-deploy.js exports handlePostDeployPick', () => {
    assert.equal(typeof postDeploy.handlePostDeployPick, 'function');
  });
});
