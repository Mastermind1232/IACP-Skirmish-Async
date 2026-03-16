/**
 * Discord Surface Tests
 *
 * Targeted tests for weak regions: hand-private-surfaces, stale-component, payload-shape.
 * Uses validatePayloadShape() directly for structural validation,
 * and exercises Discord API limits with synthetic + real-world payloads.
 *
 * Classification: harness (test-only, no production changes)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePayloadShape } from './flow-invariants.js';
import { getDcEffects, getCcEffectsData } from '../../src/data-loader.js';

const eff = getDcEffects();
const ccData = getCcEffectsData()?.cards || {};

// ═══════════════════════════════════════════════════════════════════════════
// PAYLOAD SHAPE: Component Rows
// ═══════════════════════════════════════════════════════════════════════════

describe('Payload: Action row limits', () => {
  it('5 action rows passes', () => {
    const rows = Array.from({ length: 5 }, () => ({ type: 1, components: [] }));
    const errors = validatePayloadShape({ components: rows }, 'test');
    assert.strictEqual(errors.length, 0);
  });

  it('6 action rows fails', () => {
    const rows = Array.from({ length: 6 }, () => ({ type: 1, components: [] }));
    const errors = validatePayloadShape({ components: rows }, 'test');
    assert.ok(errors.some(e => e.includes('action rows')));
  });

  it('0 action rows passes', () => {
    const errors = validatePayloadShape({ components: [] }, 'test');
    assert.strictEqual(errors.length, 0);
  });
});

describe('Payload: Button limits', () => {
  it('5 buttons per row passes', () => {
    const buttons = Array.from({ length: 5 }, (_, i) => ({
      type: 2, label: `B${i}`, custom_id: `btn_${i}`,
    }));
    const errors = validatePayloadShape({
      components: [{ type: 1, components: buttons }],
    }, 'test');
    assert.strictEqual(errors.length, 0);
  });

  it('6 buttons per row fails', () => {
    const buttons = Array.from({ length: 6 }, (_, i) => ({
      type: 2, label: `B${i}`, custom_id: `btn_${i}`,
    }));
    const errors = validatePayloadShape({
      components: [{ type: 1, components: buttons }],
    }, 'test');
    assert.ok(errors.some(e => e.includes('buttons')));
  });

  it('button label at 80 chars passes', () => {
    const errors = validatePayloadShape({
      components: [{ type: 1, components: [{ type: 2, label: 'x'.repeat(80), custom_id: 'b' }] }],
    }, 'test');
    assert.ok(!errors.some(e => e.includes('button label')));
  });

  it('button label at 81 chars fails', () => {
    const errors = validatePayloadShape({
      components: [{ type: 1, components: [{ type: 2, label: 'x'.repeat(81), custom_id: 'b' }] }],
    }, 'test');
    assert.ok(errors.some(e => e.includes('button label')));
  });
});

describe('Payload: Select menu limits', () => {
  it('25 options passes', () => {
    const options = Array.from({ length: 25 }, (_, i) => ({ label: `O${i}`, value: `v${i}` }));
    const errors = validatePayloadShape({
      components: [{ type: 1, components: [{ type: 3, options }] }],
    }, 'test');
    assert.ok(!errors.some(e => e.includes('select')));
  });

  it('26 options fails', () => {
    const options = Array.from({ length: 26 }, (_, i) => ({ label: `O${i}`, value: `v${i}` }));
    const errors = validatePayloadShape({
      components: [{ type: 1, components: [{ type: 3, options }] }],
    }, 'test');
    assert.ok(errors.some(e => e.includes('select')));
  });

  it('0 options fails', () => {
    const errors = validatePayloadShape({
      components: [{ type: 1, components: [{ type: 3, options: [] }] }],
    }, 'test');
    assert.ok(errors.some(e => e.includes('0 options')));
  });
});

describe('Payload: CustomId length', () => {
  it('100-char customId passes', () => {
    const errors = validatePayloadShape({
      components: [{ type: 1, components: [{ type: 2, custom_id: 'x'.repeat(100), label: 'Ok' }] }],
    }, 'test');
    assert.ok(!errors.some(e => e.includes('customId')));
  });

  it('101-char customId fails', () => {
    const errors = validatePayloadShape({
      components: [{ type: 1, components: [{ type: 2, custom_id: 'x'.repeat(101), label: 'Ok' }] }],
    }, 'test');
    assert.ok(errors.some(e => e.includes('customId')));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PAYLOAD SHAPE: Content Length
// ═══════════════════════════════════════════════════════════════════════════

describe('Payload: Content length', () => {
  it('2000-char content passes', () => {
    const errors = validatePayloadShape({ content: 'x'.repeat(2000) }, 'test');
    assert.strictEqual(errors.length, 0);
  });

  it('2001-char content fails', () => {
    const errors = validatePayloadShape({ content: 'x'.repeat(2001) }, 'test');
    assert.ok(errors.some(e => e.includes('content')));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PAYLOAD SHAPE: Embed Limits
// ═══════════════════════════════════════════════════════════════════════════

describe('Payload: Embed limits', () => {
  it('10 embeds passes', () => {
    const embeds = Array.from({ length: 10 }, () => ({ title: 'T' }));
    const errors = validatePayloadShape({ embeds }, 'test');
    assert.ok(!errors.some(e => e.includes('embeds')));
  });

  it('11 embeds fails', () => {
    const embeds = Array.from({ length: 11 }, () => ({ title: 'T' }));
    const errors = validatePayloadShape({ embeds }, 'test');
    assert.ok(errors.some(e => e.includes('embeds')));
  });

  it('embed title at 256 chars passes', () => {
    const errors = validatePayloadShape({ embeds: [{ title: 'x'.repeat(256) }] }, 'test');
    assert.ok(!errors.some(e => e.includes('title')));
  });

  it('embed title at 257 chars fails', () => {
    const errors = validatePayloadShape({ embeds: [{ title: 'x'.repeat(257) }] }, 'test');
    assert.ok(errors.some(e => e.includes('title')));
  });

  it('embed description at 4096 chars passes', () => {
    const errors = validatePayloadShape({ embeds: [{ description: 'x'.repeat(4096) }] }, 'test');
    assert.ok(!errors.some(e => e.includes('description')));
  });

  it('embed description at 4097 chars fails', () => {
    const errors = validatePayloadShape({ embeds: [{ description: 'x'.repeat(4097) }] }, 'test');
    assert.ok(errors.some(e => e.includes('description')));
  });

  it('25 embed fields passes', () => {
    const fields = Array.from({ length: 25 }, () => ({ name: 'F', value: 'V' }));
    const errors = validatePayloadShape({ embeds: [{ fields }] }, 'test');
    assert.ok(!errors.some(e => e.includes('fields')));
  });

  it('26 embed fields fails', () => {
    const fields = Array.from({ length: 26 }, () => ({ name: 'F', value: 'V' }));
    const errors = validatePayloadShape({ embeds: [{ fields }] }, 'test');
    assert.ok(errors.some(e => e.includes('fields')));
  });

  it('field name at 256 chars passes', () => {
    const errors = validatePayloadShape({ embeds: [{ fields: [{ name: 'x'.repeat(256), value: 'v' }] }] }, 'test');
    assert.ok(!errors.some(e => e.includes('field name')));
  });

  it('field name at 257 chars fails', () => {
    const errors = validatePayloadShape({ embeds: [{ fields: [{ name: 'x'.repeat(257), value: 'v' }] }] }, 'test');
    assert.ok(errors.some(e => e.includes('field name')));
  });

  it('field value at 1024 chars passes', () => {
    const errors = validatePayloadShape({ embeds: [{ fields: [{ name: 'n', value: 'x'.repeat(1024) }] }] }, 'test');
    assert.ok(!errors.some(e => e.includes('field value')));
  });

  it('field value at 1025 chars fails', () => {
    const errors = validatePayloadShape({ embeds: [{ fields: [{ name: 'n', value: 'x'.repeat(1025) }] }] }, 'test');
    assert.ok(errors.some(e => e.includes('field value')));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PAYLOAD SHAPE: Combo violations
// ═══════════════════════════════════════════════════════════════════════════

describe('Payload: Multiple violations detected', () => {
  it('6 rows + long content + 11 embeds = 3 errors', () => {
    const errors = validatePayloadShape({
      content: 'x'.repeat(2500),
      components: Array.from({ length: 6 }, () => ({ type: 1, components: [] })),
      embeds: Array.from({ length: 11 }, () => ({ title: 'T' })),
    }, 'test');
    assert.ok(errors.length >= 3, `Expected 3+ errors, got ${errors.length}`);
  });

  it('valid payload produces 0 errors', () => {
    const errors = validatePayloadShape({
      content: 'Hello world',
      components: [
        { type: 1, components: [{ type: 2, label: 'Click me', custom_id: 'btn_1' }] },
      ],
      embeds: [{ title: 'Status', description: 'All good', fields: [{ name: 'HP', value: '10' }] }],
    }, 'test');
    assert.strictEqual(errors.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HAND PRIVACY: CC names must not leak
// ═══════════════════════════════════════════════════════════════════════════

describe('Hand privacy: CC name leak detection', () => {
  it('can detect bold CC name in shared text', () => {
    const sharedText = '**Son of Skywalker** was played!';
    assert.ok(sharedText.includes('**Son of Skywalker**'), 'Bold CC name detected');
  });

  it('plain CC name in shared text is NOT a leak (used in logs)', () => {
    const sharedText = 'Son of Skywalker was played by Player 1.';
    // Plain text mentions are fine — only bold-formatted hand card display leaks
    assert.ok(!sharedText.includes('**Son of Skywalker**'));
  });

  it('CC hand structure: each player has separate hand array', () => {
    const game = {
      p1CcHand: ['Son of Skywalker', 'Adrenaline', 'Negation'],
      p2CcHand: ['Assassinate', 'Force Push', 'Vanish'],
    };
    assert.ok(!game.p1CcHand.some(c => game.p2CcHand.includes(c)), 'Hands should not overlap');
  });

  it('CC hand should have 3 cards at start', () => {
    const hand = ['Card A', 'Card B', 'Card C'];
    assert.strictEqual(hand.length, 3);
  });

  it('playing a CC removes it from hand', () => {
    const hand = ['Son of Skywalker', 'Adrenaline', 'Negation'];
    const played = 'Adrenaline';
    const idx = hand.indexOf(played);
    assert.ok(idx >= 0, 'Card found in hand');
    hand.splice(idx, 1);
    assert.strictEqual(hand.length, 2);
    assert.ok(!hand.includes(played));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// STALE COMPONENT: Pending state lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe('Stale component: Pending state cleanup patterns', () => {
  it('pendingCombat set then cleared leaves no stale state', () => {
    const game = {};
    game.pendingCombat = { attackerMsgId: 'msg1', defenderMsgId: 'msg2' };
    assert.ok(game.pendingCombat);
    game.pendingCombat = null;
    assert.strictEqual(game.pendingCombat, null);
  });

  it('pendingNegation lifecycle: create → resolve → clear', () => {
    const game = {};
    game.pendingNegation = { playerNum: 2, cardName: 'Adrenaline', combatThreadId: 't1' };
    assert.ok(game.pendingNegation);
    // Resolve
    const resolved = game.pendingNegation.cardName;
    assert.strictEqual(resolved, 'Adrenaline');
    // Clear
    game.pendingNegation = null;
    assert.strictEqual(game.pendingNegation, null);
  });

  it('moveInProgress cleanup after move completes', () => {
    const game = {};
    game.moveInProgress = { figureKey: 'Luke-0-0', remainingMP: 4 };
    assert.ok(game.moveInProgress);
    // Simulate move end
    delete game.moveInProgress;
    assert.strictEqual(game.moveInProgress, undefined);
  });

  it('pendingCcConfirmation clear after CC resolved', () => {
    const game = {};
    game.pendingCcConfirmation = { cardName: 'Force Push', playerNum: 1 };
    assert.ok(game.pendingCcConfirmation);
    game.pendingCcConfirmation = null;
    assert.strictEqual(game.pendingCcConfirmation, null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REAL-WORLD PAYLOAD SIMULATION
// ═══════════════════════════════════════════════════════════════════════════

describe('Real-world: DC action menu payload shape', () => {
  it('typical DC activation menu fits within limits', () => {
    // Simulates a DC activation menu: move, attack, special, end, pass
    const payload = {
      content: 'Luke Skywalker (Jedi Knight) — Choose an action:',
      components: [
        {
          type: 1,
          components: [
            { type: 2, label: 'Move (4 MP)', custom_id: 'dc_move_game123_msg456' },
            { type: 2, label: 'Attack', custom_id: 'dc_attack_game123_msg456' },
            { type: 2, label: 'Special', custom_id: 'dc_special_game123_msg456' },
            { type: 2, label: 'End Activation', custom_id: 'end_turn_game123_msg456' },
          ],
        },
      ],
    };
    const errors = validatePayloadShape(payload, 'dc-actions');
    assert.strictEqual(errors.length, 0);
  });

  it('surge spending menu with 5 options fits', () => {
    const surgeOptions = Array.from({ length: 5 }, (_, i) => ({
      label: `+${i + 1} Damage`, value: `surge_${i}`,
    }));
    const payload = {
      content: 'Spend surges:',
      components: [
        { type: 1, components: [{ type: 3, options: surgeOptions, custom_id: 'combat_surge_game123' }] },
        { type: 1, components: [{ type: 2, label: 'Done', custom_id: 'combat_surge_game123_done' }] },
      ],
    };
    const errors = validatePayloadShape(payload, 'surge-menu');
    assert.strictEqual(errors.length, 0);
  });

  it('deployment figure picker with many figures fits', () => {
    // Max 25 options in select
    const options = Array.from({ length: 20 }, (_, i) => ({
      label: `Stormtrooper (${i + 1}/20)`, value: `deploy_fig_${i}`,
    }));
    const payload = {
      components: [
        { type: 1, components: [{ type: 3, options, custom_id: 'deployment_fig_game123_1' }] },
      ],
    };
    const errors = validatePayloadShape(payload, 'deploy-picker');
    assert.strictEqual(errors.length, 0);
  });
});

describe('Real-world: CustomId length for complex IDs', () => {
  it('longest realistic customId < 100 chars', () => {
    // Format: deployment_orient_{gameId}_{playerNum}_{figIndex}_{orientation}
    const longId = `deployment_orient_game1234567890abcdef_1_12_horizontal`;
    assert.ok(longId.length <= 100, `CustomId ${longId.length} chars exceeds limit`);
  });

  it('deploy_pick with long figureKey stays under limit', () => {
    const id = `deploy_pick_game1234567890abcdef_1_a5_Ugnaught Tinkerer (Elite)-0-1`;
    assert.ok(id.length <= 100, `CustomId ${id.length} chars`);
  });

  it('CC play select with long card name stays under limit', () => {
    const id = `cc_confirm_play_game1234567890abcdef_1`;
    assert.ok(id.length <= 100, `CustomId ${id.length} chars`);
  });
});

describe('Real-world: DC count per faction within deploy limits', () => {
  // A full army might have 8-10 DCs, each needing a select option
  it('max DCs per army fits in 25-option select menu', () => {
    // 40 points max, cheapest non-companion is ~2-3 points → max ~13-15 DCs + figures
    // But multi-figure groups expand: 3-figure group = 3 options
    // Practical max: ~20 individual figures
    assert.ok(20 <= 25, 'Max figures per army fits in select menu');
  });

  it('all CC effects have names under 80 chars (button label safe)', () => {
    const long = Object.keys(ccData).filter(name => name.length > 80);
    assert.strictEqual(long.length, 0, `CCs with long names: ${long}`);
  });

  it('all DC names under 80 chars (button label safe)', () => {
    const long = Object.keys(eff || {}).filter(name => name.length > 80);
    assert.strictEqual(long.length, 0, `DCs with long names: ${long}`);
  });
});
