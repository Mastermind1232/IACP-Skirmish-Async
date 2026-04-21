/**
 * PROBE-AWR: Director Krennic's Advanced Weapons Research.
 *
 * Card text: "At the start of each of your activations, a friendly figure
 *  within 2 spaces may gain 1 Damage Token or 1 Surge Token."
 *  The Advanced Com Systems attachment extends the range to 3.
 *
 * Phase 2 high-risk probe grind (2026-04-21): this atom was
 * `structural-only` in the ledger — wired via handlers/activation.js and
 * engine/activation-setup.js with no structured library fields and no
 * behavioral test. Extracted pure helpers to src/game/awr-helpers.js so
 * the rule logic could be probed without pulling in discord.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { awrRange, enumerateAwrTargets } from '../../../src/game/awr-helpers.js';
import { grantPowerTokens } from '../../../src/game/game-helpers.js';

const MAP_ID = 'anchorhead-cantina-bar';

function buildGame({
  krennicPos = 'a1',
  friendlies = [],    // [{ fk, pos }]
  hostiles = [],      // [{ fk, pos }]
  attachments = [],   // string[] passed as Krennic's p1DcAttachments[msgId]
} = {}) {
  const krennicFk = 'Director Krennic-1-0';
  const p1Positions = { [krennicFk]: krennicPos };
  for (const f of friendlies) p1Positions[f.fk] = f.pos;
  const p2Positions = {};
  for (const h of hostiles) p2Positions[h.fk] = h.pos;
  const game = {
    gameId: 'gawr',
    figurePositions: { 1: p1Positions, 2: p2Positions },
    figurePowerTokens: {},
    figureMaxPowerTokens: {},
    p1DcAttachments: { msg_krennic: attachments },
    selectedMap: { id: MAP_ID },
  };
  return { game, krennicFk };
}

describe('PROBE-AWR-001: range is 2 by default, 3 with Advanced Com Systems', () => {
  it('no attachments → range 2', () => {
    assert.equal(awrRange([]), 2);
    assert.equal(awrRange(null), 2);
    assert.equal(awrRange(undefined), 2);
  });
  it('Advanced Com Systems attachment → range 3', () => {
    assert.equal(awrRange(['Advanced Com Systems']), 3);
  });
  it('other attachments (e.g. E-11 Blaster) do not change range', () => {
    assert.equal(awrRange(['E-11 Blaster', 'Comlink']), 2);
  });
});

describe('PROBE-AWR-002: target enumeration respects range + friendly-only', () => {
  it('friendlies within 2 are returned; hostiles are ignored', () => {
    const { game, krennicFk } = buildGame({
      krennicPos: 'a1',
      friendlies: [
        { fk: 'Stormtrooper-1-0', pos: 'b1' },  // 1 space away
        { fk: 'Imperial Officer-1-0', pos: 'c1' },  // 2 spaces
      ],
      hostiles: [{ fk: 'Rebel Trooper-1-0', pos: 'b1' }],  // adjacent hostile — NOT offered
    });
    const out = enumerateAwrTargets(game, 1, krennicFk, 2);
    const fks = out.map(([fk]) => fk);
    assert.ok(fks.includes('Stormtrooper-1-0'));
    assert.ok(fks.includes('Imperial Officer-1-0'));
    assert.ok(!fks.includes('Rebel Trooper-1-0'), 'hostile must not be offered');
    assert.equal(fks[0], krennicFk, 'Krennic must sort first');
  });

  it('friendly beyond range is excluded at range 2 but included at range 3', () => {
    const { game, krennicFk } = buildGame({
      krennicPos: 'a1',
      friendlies: [{ fk: 'Stormtrooper-1-0', pos: 'd1' }],  // 3 spaces away
    });
    const range2 = enumerateAwrTargets(game, 1, krennicFk, 2).map(([fk]) => fk);
    const range3 = enumerateAwrTargets(game, 1, krennicFk, 3).map(([fk]) => fk);
    assert.ok(!range2.includes('Stormtrooper-1-0'), 'excluded at range 2');
    assert.ok(range3.includes('Stormtrooper-1-0'), 'included at range 3');
  });

  it('Krennic himself is always the first eligible target', () => {
    const { game, krennicFk } = buildGame({
      krennicPos: 'a1',
      friendlies: [{ fk: 'Stormtrooper-1-0', pos: 'a1' }],  // same space impossible, use 'b1'
    });
    // swap to adjacent so both are valid
    game.figurePositions[1]['Stormtrooper-1-0'] = 'b1';
    const out = enumerateAwrTargets(game, 1, krennicFk, 2);
    assert.equal(out[0][0], krennicFk, 'Krennic sorted first');
  });

  it('returns empty when Krennic has no position', () => {
    const { game, krennicFk } = buildGame({ krennicPos: null });
    // Explicitly unset Krennic's position
    delete game.figurePositions[1][krennicFk];
    const out = enumerateAwrTargets(game, 1, krennicFk, 2);
    assert.deepStrictEqual(out, []);
  });
});

describe('PROBE-AWR-003: Advanced Com Systems expands eligible pool', () => {
  it('friendly at 3 spaces appears only when ACS is attached', () => {
    const { game, krennicFk } = buildGame({
      krennicPos: 'a1',
      friendlies: [{ fk: 'Stormtrooper-1-0', pos: 'd1' }],
      attachments: [],
    });
    // Without ACS
    const rangeNoACS = awrRange(game.p1DcAttachments.msg_krennic);
    assert.equal(rangeNoACS, 2);
    assert.equal(enumerateAwrTargets(game, 1, krennicFk, rangeNoACS).length, 1); // just Krennic
    // With ACS
    game.p1DcAttachments.msg_krennic = ['Advanced Com Systems'];
    const rangeWithACS = awrRange(game.p1DcAttachments.msg_krennic);
    assert.equal(rangeWithACS, 3);
    const out = enumerateAwrTargets(game, 1, krennicFk, rangeWithACS);
    assert.equal(out.length, 2);
    assert.ok(out.map(([fk]) => fk).includes('Stormtrooper-1-0'));
  });
});

describe('PROBE-AWR-004: token grant side-effect', () => {
  it('grantPowerTokens applies 1 Damage Token to chosen target', () => {
    const { game } = buildGame({
      krennicPos: 'a1',
      friendlies: [{ fk: 'Stormtrooper-1-0', pos: 'b1' }],
    });
    grantPowerTokens(game, 'Stormtrooper-1-0', 'Damage', 1);
    assert.deepStrictEqual(
      game.figurePowerTokens['Stormtrooper-1-0'],
      ['Damage'],
    );
  });

  it('grantPowerTokens applies 1 Surge Token to chosen target', () => {
    const { game } = buildGame({
      krennicPos: 'a1',
      friendlies: [{ fk: 'Stormtrooper-1-0', pos: 'b1' }],
    });
    grantPowerTokens(game, 'Stormtrooper-1-0', 'Surge', 1);
    assert.deepStrictEqual(
      game.figurePowerTokens['Stormtrooper-1-0'],
      ['Surge'],
    );
  });

  it('Krennic can target himself (self-eligible per card text)', () => {
    const { game, krennicFk } = buildGame({ krennicPos: 'a1' });
    grantPowerTokens(game, krennicFk, 'Damage', 1);
    assert.deepStrictEqual(game.figurePowerTokens[krennicFk], ['Damage']);
  });
});

describe('PROBE-AWR-005: library entry is wired and named correctly', () => {
  it('ability-library entry has wiredStatus and expected label', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'));
    const entry = lib.abilities?.advanced_weapons_research;
    assert.ok(entry, 'advanced_weapons_research must exist');
    assert.equal(entry.wiredStatus, 'wired');
    assert.equal(entry.label, 'Advanced Weapons Research');
  });
});
