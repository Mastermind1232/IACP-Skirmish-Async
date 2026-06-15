/**
 * Per-player combat ability DB (alexanbv 2026-06-15: "build a smaller database
 * at the start of each mission for each player, containing only the abilities on
 * the DCs and CCs of each player ... the pipeline should query for what relevant
 * abilities may be used"). Validates the spec loader, the per-player filter, the
 * window index, and the card-name collection from game state.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadAbilitySpec, abilitiesForCard, buildPlayerAbilityDb,
  getPlayerCardNames, getPlayerAbilityDb, playerAbilitiesForWindow,
  playerAbilitiesForGateWindow, GATE_TO_SPEC_WINDOW,
  SPEC_COLUMNS, _resetAbilityDbCaches,
} from '../../../src/engine/combat-ability-db.js';

describe('combat-ability-db: spec loader', () => {
  it('parses the spec into a card-indexed map covering many cards', () => {
    _resetAbilityDbCaches();
    const map = loadAbilitySpec();
    assert.ok(map.size > 400, `expected the full library (~532 cards), got ${map.size}`);
    // Every row has all 15 columns populated (no empty fields per the spec rule).
    for (const rows of map.values()) {
      for (const r of rows) {
        for (const col of SPEC_COLUMNS) {
          assert.ok(r[col] !== undefined && r[col] !== '', `row missing ${col}: ${JSON.stringify(r)}`);
        }
      }
    }
  });

  it('returns a card\'s abilities with the locked conventions (surge → spend_surges)', () => {
    const blaise = abilitiesForCard('Agent Blaise');
    const interrogate = blaise.find((r) => r.ability === 'Interrogate');
    assert.ok(interrogate, 'Agent Blaise should have Interrogate');
    assert.equal(interrogate.timing, 'spend_surges');
    assert.equal(interrogate.surge_option, 'TRUE');
    const adapt = blaise.find((r) => r.ability === 'Adapt');
    assert.equal(adapt.timing, 'when_opponent_plays_cc');
  });

  it('is case-insensitive on card name', () => {
    assert.equal(abilitiesForCard('agent blaise').length, abilitiesForCard('Agent Blaise').length);
  });
});

describe('combat-ability-db: per-player DB', () => {
  it('filters to only the player\'s cards and indexes by window', () => {
    const db = buildPlayerAbilityDb(['Agent Blaise', 'Ahsoka Tano', 'Assassinate', 'Ambush', 'Not A Real Card']);
    assert.deepEqual(db.missing, ['Not A Real Card']);
    assert.ok(db.cards.includes('Agent Blaise') && db.cards.includes('Assassinate'));
    // Window index routes each ability to its timing window.
    const decl = db.byWindow['attack:on_declare'] || [];
    assert.ok(decl.some((r) => r.card === 'Ambush'), 'Ambush plugs into attack:on_declare');
    assert.ok((db.byWindow['special_action'] || []).some((r) => r.ability === 'Force Leap'),
      'Ahsoka Force Leap plugs into special_action');
    assert.ok((db.byWindow['spend_surges'] || []).some((r) => r.ability === 'Interrogate'),
      'Interrogate plugs into spend_surges');
  });

  it('collects DC + attachment + CC card names from game state', () => {
    const game = {
      gameId: 'g1',
      p1DcList: [{ dcName: 'Ahsoka Tano' }, { dcName: 'Agent Blaise' }],
      p1DcAttachments: { msg1: ['[Black Market]'], msg2: ['[Combat Suit]'] },
      player1Squad: { ccList: ['Assassinate', 'Ambush'] },
    };
    const names = getPlayerCardNames(game, 1).sort();
    assert.deepEqual(names, ['Agent Blaise', 'Ahsoka Tano', 'Ambush', 'Assassinate', '[Black Market]', '[Combat Suit]']);
  });

  it('playerAbilitiesForGateWindow bridges gate windows to spec windows and filters by side', () => {
    _resetAbilityDbCaches();
    const game = {
      gameId: 'g3',
      // Alliance Smuggler (Elite) Slippery: defender at mods + after_resolve.
      // Ahsoka Twin Sabers: attacker at rerolls.
      p1DcList: [{ dcName: 'Alliance Smuggler (Elite)' }, { dcName: 'Ahsoka Tano' }],
      player1Squad: { ccList: ['Assassinate'] },
    };
    // mods/defender → Slippery (part 1), NOT the attacker-side Assassinate.
    const modsDef = playerAbilitiesForGateWindow(game, 1, 'mods', 'defender');
    assert.ok(modsDef.some((r) => r.ability === 'Slippery'), 'Slippery is a defender mods ability');
    assert.ok(!modsDef.some((r) => r.attack_side === 'attacker'), 'side filter excludes attacker rows');
    // mods/attacker → Assassinate (CC), not Slippery.
    const modsAtt = playerAbilitiesForGateWindow(game, 1, 'mods', 'attacker');
    assert.ok(modsAtt.some((r) => r.card === 'Assassinate'));
    assert.ok(!modsAtt.some((r) => r.ability === 'Slippery'));
    // rerolls/attacker → Twin Sabers.
    assert.ok(playerAbilitiesForGateWindow(game, 1, 'rerolls', 'attacker').some((r) => r.ability === 'Twin Sabers'));
    // 'special' gate window maps to nothing in the spec (bespoke handling).
    assert.deepEqual(GATE_TO_SPEC_WINDOW.special, []);
    assert.equal(playerAbilitiesForGateWindow(game, 1, 'special', 'attacker').length, 0);
  });

  it('getPlayerAbilityDb is memoized and window query is ability-agnostic', () => {
    _resetAbilityDbCaches();
    const game = {
      gameId: 'g2',
      p1DcList: [{ dcName: 'Agent Blaise' }],
      player1Squad: { ccList: ['Ambush'] },
    };
    const db1 = getPlayerAbilityDb(game, 1);
    const db2 = getPlayerAbilityDb(game, 1);
    assert.equal(db1, db2, 'same object returned (memoized)');
    const decl = playerAbilitiesForWindow(game, 1, 'attack:on_declare');
    assert.ok(decl.some((r) => r.card === 'Ambush'));
    // A player without a card gets nothing for its windows (scoped DB).
    assert.equal(playerAbilitiesForWindow(game, 1, 'when_defeated').length, 0);
  });
});
