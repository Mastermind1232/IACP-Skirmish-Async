/**
 * Support Specialist (Del Meeko CC) — "Special Action: Choose a friendly DROID,
 * TECHNICIAN, or TROOPER within 3 spaces. That figure interrupts to perform an
 * action."
 *
 * alexanbv 2026-08-21: "Support specialist is a special action. Should be the
 * same as any other special action. Of course, this is one of those that allows
 * a lot of options. There needs to be a menu to choose which figure is being
 * selected and then another menu for which action that figure is doing."
 *
 * So two menus. It used to be one flat list crossing every eligible figure with
 * every action, which grows as figures x actions. And the card was tagged
 * `duringActivation`, which in this engine means "played from hand" rather than
 * from the DC's Special Action button.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';
import { getCcEffect, getDcStats } from '../../../src/data-loader.js';
import { isCcPlayableByDc } from '../../../src/game/cc-timing.js';
import { getDcActionButtons } from '../../../src/discord/components.js';
import { consumeActionForCurrentFigure } from '../../../src/game/activation-state.js';
import {
  buildGrantedActionOptions, grantedActionCustomId, grantedActionKeyFor,
} from '../../../src/handlers/granted-action.js';

const MSG = 'msg-ss';
const TROOP_MSG = 'msg-troop';
const DEL = 'Del Meeko-1-0';
const T1 = 'Stormtrooper (Regular)-1-0';
const T2 = 'Stormtrooper (Regular)-1-1';

function fixture() {
  return {
    gameId: 'g-ss',
    selectedMap: { id: 'mos-eisley-outskirts' },
    dcActionsData: { [MSG]: { selectedFigure: 0 } },
    // Real spaces on a real map: without one countGameSpaces returns Infinity
    // and the within-3 filter drops everybody. e19/e20/e21 are collinear and
    // within 3 of each other.
    figurePositions: { 1: { [DEL]: 'e19', [T1]: 'e20', [T2]: 'e21' } },
  };
}
const meta = () => new Map([
  [MSG, { gameId: 'g-ss', playerNum: 1, dcName: 'Del Meeko', displayName: 'Del Meeko [Group 1]' }],
  [TROOP_MSG, { gameId: 'g-ss', playerNum: 1, dcName: 'Stormtrooper (Regular)', displayName: 'Stormtrooper (Regular) [Group 1]' }],
]);

describe('Support Specialist is a Special Action', () => {
  it('is tagged specialAction, so it comes off the DC button', () => {
    assert.equal(getCcEffect('Support Specialist')?.timing, 'specialAction');
    assert.equal(isCcPlayableByDc('Support Specialist', 'Del Meeko', 'Del Meeko [Group 1]'), true);
  });

  it("Smuggler's Tricks, the other card printing the arrow, is tagged the same way", () => {
    assert.equal(getCcEffect("Smuggler's Tricks")?.timing, 'specialAction');
  });
});

describe('Support Specialist — figure menu, then the granted-action menu', () => {
  it('menu 1 lists figures only, one entry each, with no action in the value', () => {
    const r = resolveAbility('Support Specialist', {
      game: fixture(), playerNum: 1, dcMessageMeta: meta(),
    });
    assert.equal(r.requiresChoice, true);
    assert.deepEqual(r.choiceValues, [T1, T2], 'one entry per figure, bare figure keys');
    assert.ok(!r.choiceValues.some((v) => v.includes('|')),
      'the first menu must not pre-bind an action');
    assert.equal(r.choiceOptions.length, 2, 'no figure x action cross product');
  });

  it('choosing a figure hands off to the granted-action menu', () => {
    const game = fixture();
    const r = resolveAbility('Support Specialist', {
      game, playerNum: 1, dcMessageMeta: meta(), chosenFigureKey: T1,
    });
    assert.equal(r.applied, true);
    assert.ok(r.grantedActionMenu, 'expected a grantedActionMenu handoff');
    assert.equal(r.grantedActionMenu.granteeFigureKey, T1);
    assert.equal(r.grantedActionMenu.sourceLabel, 'Support Specialist');
    assert.equal(r.grantedActionMenu.playerNum, 1);
    assert.ok(r.grantedActionMenu.granteeMsgId, 'the grantee DC must be resolved');
  });

  it('does not pre-commit the figure to an action', () => {
    // The old build bound move/attack into the first menu and booked the
    // interrupt immediately. Nothing may be granted before menu 2 is answered.
    const game = fixture();
    resolveAbility('Support Specialist', {
      game, playerNum: 1, dcMessageMeta: meta(), chosenFigureKey: T1,
    });
    assert.equal(game.freeAttackBonusPending, undefined, 'no attack booked yet');
    assert.equal(game.pendingMoveX, undefined, 'no move booked yet');
  });

  it('tolerates a stale `figureKey|action` value from an older button', () => {
    const game = fixture();
    const r = resolveAbility('Support Specialist', {
      game, playerNum: 1, dcMessageMeta: meta(), chosenFigureKey: `${T1}|attack`,
    });
    assert.equal(r.applied, true);
    assert.equal(r.grantedActionMenu?.granteeFigureKey, T1,
      'the action half is dropped; the player re-picks in menu 2');
  });
});

describe('the granted-action menu covers every action alexanbv listed', () => {
  // "perform an action refers to any action, including interact move attack or
  //  special action. No rest actions in skirmish." + "discarding bleed /
  //  Discarding stun / Special actions from mission rules".
  const gaMeta = { gameId: 'g-ga', playerNum: 1, dcName: 'Rancor', displayName: 'Rancor [Group 1]' };
  const RANCOR = 'Rancor-1-0';
  const gaDeps = () => ({
    getDcActionButtons, getDcStats, getPlayerNumForMsgId: () => 1, msgId: 'm-ga',
  });
  const gaGame = (conds = []) => ({
    gameId: 'g-ga',
    figurePositions: { 1: { [RANCOR]: 'e19' } },
    figureConditions: { [RANCOR]: conds },
  });

  it('offers move, attack, interact and the native Special Action', () => {
    const keys = buildGrantedActionOptions(gaGame(), gaMeta, RANCOR, gaDeps()).map((o) => o.key);
    assert.ok(keys.includes('move'), keys.join());
    assert.ok(keys.includes('attack'), keys.join());
    assert.ok(keys.includes('interact'), keys.join());
    assert.ok(keys.some((k) => k.startsWith('special:')), `expected a Special Action, got ${keys.join()}`);
    assert.ok(!keys.includes('rest'), 'no rest actions in skirmish');
  });

  it('offers the condition discards only when the condition is held', () => {
    const clean = buildGrantedActionOptions(gaGame(), gaMeta, RANCOR, gaDeps()).map((o) => o.key);
    assert.ok(!clean.includes('stun') && !clean.includes('bleed'), clean.join());
    const afflicted = buildGrantedActionOptions(gaGame(['Stun', 'Bleed']), gaMeta, RANCOR, gaDeps()).map((o) => o.key);
    assert.ok(afflicted.includes('stun'), afflicted.join());
    assert.ok(afflicted.includes('bleed'), afflicted.join());
  });

  it('inherits Stun blocking Move and Attack but not Interact or Specials', () => {
    // destruct 2026-05-07. Inherited from the DC play area rather than re-derived.
    const keys = buildGrantedActionOptions(gaGame(['Stun']), gaMeta, RANCOR, gaDeps()).map((o) => o.key);
    assert.ok(!keys.includes('move') && !keys.includes('attack'), keys.join());
    assert.ok(keys.includes('interact'), keys.join());
    assert.ok(keys.some((k) => k.startsWith('special:')), keys.join());
  });

  it('withholds Special Actions from a Disabled figure', () => {
    const g = gaGame();
    g.disabledFigures = ['Rancor [Group 1]'];
    const keys = buildGrantedActionOptions(g, gaMeta, RANCOR, gaDeps()).map((o) => o.key);
    assert.ok(!keys.some((k) => k.startsWith('special:')), keys.join());
    assert.ok(keys.includes('move'), 'Disable only blocks Special Actions');
  });

  it('every offered key maps back to a real DC button', () => {
    const opts = buildGrantedActionOptions(gaGame(['Stun', 'Bleed']), gaMeta, RANCOR, gaDeps());
    assert.ok(opts.length > 0);
    for (const o of opts) {
      const t = grantedActionCustomId(o.key, 'm-ga', 0);
      assert.ok(t?.id && t?.buttonKey, `no re-dispatch target for ${o.key}`);
      assert.equal(grantedActionKeyFor(t.id), o.key, `round-trip failed for ${o.key}`);
    }
  });
});

describe('a granted action costs the interrupting figure nothing', () => {
  it('consumeActionForCurrentFigure is a no-op and never takes the activation lock', () => {
    // Without this the interrupt would invent an action budget for a figure that
    // is not activating AND steal game.activationLockKey from whoever is.
    const granted = { selectedFigure: 0, grantedAction: true };
    const game = {};
    consumeActionForCurrentFigure(granted, 1, game, 'm-ga');
    assert.equal(granted.perFigureRemaining, undefined, 'no budget invented or spent');
    assert.equal(game.activationLockKey, undefined, 'the real activation keeps its lock');

    // Control: an ordinary activating figure still spends normally.
    const normal = { selectedFigure: 0 };
    const game2 = {};
    consumeActionForCurrentFigure(normal, 1, game2, 'm-real');
    assert.equal(normal.perFigureRemaining[0], 1);
    assert.equal(game2.activationLockKey, 'm-real_f0');
  });
});

describe('condition discards are Special Actions (alexanbv 2026-08-21)', () => {
  // "condition discards count as special actions"
  // "they are different discards, and a figure cannot be double stunned. So a
  //  figure could discard stunned and bleeding."
  // "A disabled figure who is also stunned or bleeding may not discard it"
  const gaMeta = { gameId: 'g-cd', playerNum: 1, dcName: 'Rancor', displayName: 'Rancor [Group 1]' };
  const R = 'Rancor-1-0';
  const deps = () => ({ getDcActionButtons, getDcStats, getPlayerNumForMsgId: () => 1, msgId: 'm-cd' });
  const mk = (conds, disabled = false) => ({
    gameId: 'g-cd',
    figurePositions: { 1: { [R]: 'e19' } },
    figureConditions: { [R]: conds },
    ...(disabled ? { disabledFigures: ['Rancor [Group 1]'] } : {}),
  });

  it('offers BOTH discards to a figure that is Stunned and Bleeding', () => {
    const keys = buildGrantedActionOptions(mk(['Stun', 'Bleed']), gaMeta, R, deps()).map((o) => o.key);
    assert.ok(keys.includes('stun') && keys.includes('bleed'),
      `both discards are separate Special Actions, got ${keys.join()}`);
  });

  it('withholds the discards from a Disabled figure', () => {
    const keys = buildGrantedActionOptions(mk(['Stun', 'Bleed'], true), gaMeta, R, deps()).map((o) => o.key);
    assert.ok(!keys.includes('stun'), `Disabled blocks the Stun discard, got ${keys.join()}`);
    assert.ok(!keys.includes('bleed'), `Disabled blocks the Bleed discard, got ${keys.join()}`);
    // Move and Attack are absent here because of the Stun, not the Disable.
    assert.ok(keys.includes('interact'), 'Disable only reaches Special Actions');
  });

  it('a Disabled but only-Bleeding figure keeps Move and Attack', () => {
    const keys = buildGrantedActionOptions(mk(['Bleed'], true), gaMeta, R, deps()).map((o) => o.key);
    assert.ok(!keys.includes('bleed'), `Disabled blocks the discard, got ${keys.join()}`);
    assert.ok(keys.includes('move') && keys.includes('attack'),
      `Disable must not touch Move or Attack, got ${keys.join()}`);
  });
});

describe('Jundland Terror grants attack OR Special Action, discards included', () => {
  // alexanbv 2026-08-21: "confirm that Junland terror is 'attack or special
  // action' not just any action" — so no Move and no Interact — but condition
  // discards ARE Special Actions and belong on the menu.
  const MSGJ = 'msg-jt';
  const TUSKEN = 'Tusken Raider-1-0';
  const jtMeta = () => new Map([[MSGJ, {
    gameId: 'g-jt', playerNum: 1, dcName: 'Tusken Raider', displayName: 'Tusken Raider [Group 1]',
  }]]);
  const jtGame = (conds = [], disabled = false) => ({
    gameId: 'g-jt',
    selectedMap: { id: 'mos-eisley-outskirts' },
    figurePositions: { 1: { [TUSKEN]: 'e19' } },
    figureConditions: { [TUSKEN]: conds },
    ...(disabled ? { disabledFigures: ['Tusken Raider [Group 1]'] } : {}),
  });

  const modeMenu = (game) => resolveAbility('Jundland Terror', {
    game, playerNum: 1, dcMessageMeta: jtMeta(), chosenFigureKey: TUSKEN,
  });

  it('never offers Move or Interact', () => {
    const r = modeMenu(jtGame(['Stun', 'Bleed']));
    assert.equal(r.requiresChoice, true);
    const joined = (r.choiceOptions || []).join(' | ');
    assert.ok(!/\bMove\b/i.test(joined), `Jundland is attack or Special Action only, got ${joined}`);
    assert.ok(!/\bInteract\b/i.test(joined), `Jundland is attack or Special Action only, got ${joined}`);
  });

  it('offers both discards when the figure is Stunned and Bleeding', () => {
    const opts = modeMenu(jtGame(['Stun', 'Bleed'])).choiceOptions || [];
    assert.ok(opts.includes('Jundland: Discard Stun'), opts.join(' | '));
    assert.ok(opts.includes('Jundland: Discard Bleed'), opts.join(' | '));
  });

  it('offers no discard the figure does not need', () => {
    const opts = modeMenu(jtGame([])).choiceOptions || [];
    assert.ok(!opts.some((o) => o.startsWith('Jundland: Discard')), opts.join(' | '));
  });

  it('withholds specials AND discards from a Disabled figure, keeping Attack', () => {
    const opts = modeMenu(jtGame(['Stun'], true)).choiceOptions || [];
    assert.deepEqual(opts, ['Jundland: Attack'], opts.join(' | '));
  });

  it('resolving a discard removes the condition and still grants the 2 MP', () => {
    const game = jtGame(['Stun', 'Bleed']);
    const r = resolveAbility('Jundland Terror', {
      game, playerNum: 1, dcMessageMeta: jtMeta(),
      chosenFigureKey: TUSKEN, chosenOption: 'Jundland: Discard Stun',
    });
    assert.equal(r.applied, true);
    assert.ok(!(game.figureConditions[TUSKEN] || []).includes('Stun'), 'Stun discarded');
    assert.ok((game.figureConditions[TUSKEN] || []).includes('Bleed'), 'Bleed untouched — different discard');
    assert.equal(game.pendingMoveX?.[r.pendingMoveXMsgId]?.remaining, 2, 'the 2 MP are still granted');
  });
});
