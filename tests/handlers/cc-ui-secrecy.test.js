// CC hand-secrecy in the combat gate (alexanbv 2026-06-25). CC-play offers must
// NOT appear as named buttons in the SHARED combat thread — they leak the
// player's hand (and their absence leaks that the player has no relevant CC).
// They go behind a neutral, always-present "Play a Command Card" button →
// ephemeral private list. DC abilities (public — the opponent knows your
// deployment cards) stay as direct buttons.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { registerCombatAbility } from '../../src/engine/combat-timing-registry.js';
import { _isGateCc, _postGateChooseWindow, handleModsPick } from '../../src/handlers/combat.js';
import { buildWindowGate } from '../../src/engine/combat-mods-gate.js';
import { autoResolvePassives } from '../../src/engine/combat-ability-gate.js';

// Register a SECRET CC and a PUBLIC DC ability, both defender-side mods abilities.
before(() => {
  registerCombatAbility({
    id: 'test_secret_cc', name: 'Secret Strike (CC)', windows: ['mods'], side: 'defender',
    kind: 'interactive', params: { kind: 'cc', card: 'Secret Strike' }, applies: () => true,
  });
  registerCombatAbility({
    id: 'test_public_dc', name: 'Public Brace (DC)', windows: ['mods'], side: 'defender',
    kind: 'interactive', params: {}, applies: () => true,
  });
});

const baseGame = () => ({ gameId: 'g1', player1Id: 'P1', player2Id: 'P2', pendingCombat: null });
const baseCombat = () => ({ gameId: 'g1', attackerPlayerNum: 1, defenderPlayerNum: 2, attackerFigureKey: 'A-1-0', target: { figureKey: 'D-2-0', coord: 'a1' } });

function captureThread() {
  const sent = [];
  return { sent, send: async (payload) => { sent.push(payload); return { id: 'm1' }; } };
}
function customIds(payload) {
  const out = [];
  for (const row of (payload.components || [])) for (const c of (row.components || [])) out.push(c.data?.custom_id ?? c.custom_id);
  return out;
}
function labels(payload) {
  const out = [];
  for (const row of (payload.components || [])) for (const c of (row.components || [])) out.push(c.data?.label ?? c.label);
  return out;
}

describe('CC UI secrecy — _isGateCc', () => {
  it('identifies a CC play (params.kind=cc) as a CC', () => {
    assert.equal(_isGateCc('test_secret_cc', 2, baseGame()), true);
  });
  it('does NOT classify a public DC ability as a CC', () => {
    assert.equal(_isGateCc('test_public_dc', 2, baseGame()), false);
  });
});

describe('CC UI secrecy — _postGateChooseWindow split', () => {
  it('keeps the DC ability button public but hides the CC behind Play-CC', async () => {
    const thread = captureThread();
    await _postGateChooseWindow('mods', 'defender', ['test_secret_cc', 'test_public_dc'], thread, baseGame(), baseCombat());
    assert.equal(thread.sent.length, 1);
    const payload = thread.sent[0];
    const ids = customIds(payload);
    const lbls = labels(payload);
    // Public DC ability is a direct button.
    assert.ok(ids.some((c) => c.endsWith('_test_public_dc')), 'DC ability button missing');
    assert.ok(lbls.includes('Public Brace (DC)'), 'DC ability label missing');
    // The neutral Play-CC + Done buttons are present.
    assert.ok(ids.some((c) => c.endsWith('_playcc')), 'Play-CC button missing');
    assert.ok(ids.some((c) => c.endsWith('_done')), 'Done button missing');
    // CRITICAL: the CC must NOT leak — neither its pick id nor its name appears.
    assert.ok(!ids.some((c) => c.endsWith('_test_secret_cc')), 'CC button leaked into the combat thread');
    assert.ok(!lbls.includes('Secret Strike (CC)'), 'CC name leaked into the combat thread');
    const blob = JSON.stringify(payload);
    assert.ok(!/Secret Strike/.test(blob), 'CC card name leaked anywhere in the public message');
  });

  it('Play-CC button is ALWAYS present even with zero playable CCs (absence must not leak)', async () => {
    const thread = captureThread();
    await _postGateChooseWindow('mods', 'defender', ['test_public_dc'], thread, baseGame(), baseCombat());
    const ids = customIds(thread.sent[0]);
    assert.ok(ids.some((c) => c.endsWith('_playcc')), 'Play-CC must show even with no CCs');
  });
});

describe('CC UI secrecy — Play-CC opens an EPHEMERAL private list', () => {
  it('handleModsPick(playcc) replies ephemerally with the side\'s CCs and does NOT touch the public thread', async () => {
    const game = baseGame();
    const combat = baseCombat();
    // Real defender-active mods gate holding the secret CC + public DC.
    const gate = buildWindowGate('mods', game, combat, {});
    // Drive past the attacker side so the DEFENDER is the active side.
    autoResolvePassives(gate, 'attacker');
    gate.attacker.passed = true;
    autoResolvePassives(gate, 'defender');
    combat.modsGate = gate;
    game.pendingCombat = combat;

    const followUps = [];
    let publicEdited = false;
    const interaction = {
      customId: `combat_mods_pick_g1_playcc`,
      user: { id: 'P2' }, // defender
      client: { channels: { fetch: async () => null } },
      message: { edit: async () => { publicEdited = true; } },
      deferUpdate: async () => {},
      followUp: async (p) => { followUps.push(p); },
    };
    const ctx = {
      getGame: () => game,
      replyIfGameEnded: async () => false,
      saveGames: () => {},
    };
    await handleModsPick(interaction, ctx);

    assert.equal(followUps.length, 1, 'expected one ephemeral reply');
    assert.equal(followUps[0].ephemeral, true, 'CC list must be ephemeral (private)');
    const ids = customIds(followUps[0]);
    assert.ok(ids.some((c) => c.endsWith('_test_secret_cc')), 'ephemeral list should offer the CC');
    assert.equal(publicEdited, false, 'Play-CC must NOT clear the public window (multi-CC: stays up)');
  });
});
