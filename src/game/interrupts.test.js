import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERRUPT_TYPES,
  pushInterrupt, peekInterrupt, popInterrupt, popInterruptById, getInterruptById,
  hasAnyInterrupts, hasInterrupt, getBlockingInterrupts, clearAllInterrupts,
} from './interrupts.js';

describe('interrupts: foundation module', () => {
  it('pushInterrupt creates the stack lazily and returns the entry', () => {
    const game = {};
    const entry = pushInterrupt(game, INTERRUPT_TYPES.CC_CHOICE, { card: 'Take Initiative' });
    assert.ok(Array.isArray(game.interrupts));
    assert.equal(game.interrupts.length, 1);
    assert.equal(entry.type, INTERRUPT_TYPES.CC_CHOICE);
    assert.deepEqual(entry.payload, { card: 'Take Initiative' });
    assert.equal(entry.blocksSave, true);
    assert.ok(entry.id);
    assert.ok(entry.createdAt > 0);
  });

  it('pushInterrupt with { blocksSave: false } marks it non-blocking', () => {
    const game = {};
    const e = pushInterrupt(game, 'tracking-only', {}, { blocksSave: false });
    assert.equal(e.blocksSave, false);
    assert.equal(getBlockingInterrupts(game).length, 0);
  });

  it('peekInterrupt finds the first matching type without removing', () => {
    const game = {};
    pushInterrupt(game, INTERRUPT_TYPES.CC_NEGATION, { src: 'a' });
    pushInterrupt(game, INTERRUPT_TYPES.CC_NEGATION, { src: 'b' });
    const found = peekInterrupt(game, INTERRUPT_TYPES.CC_NEGATION);
    assert.equal(found.payload.src, 'a');
    assert.equal(game.interrupts.length, 2);
  });

  it('peekInterrupt returns null for unknown type or empty stack', () => {
    assert.equal(peekInterrupt({}, INTERRUPT_TYPES.CC_CHOICE), null);
    assert.equal(peekInterrupt({ interrupts: [] }, INTERRUPT_TYPES.CC_CHOICE), null);
  });

  it('popInterrupt removes the first matching entry and returns it', () => {
    const game = {};
    pushInterrupt(game, INTERRUPT_TYPES.CC_CHOICE, { x: 1 });
    pushInterrupt(game, INTERRUPT_TYPES.CC_CHOICE, { x: 2 });
    const popped = popInterrupt(game, INTERRUPT_TYPES.CC_CHOICE);
    assert.equal(popped.payload.x, 1);
    assert.equal(game.interrupts.length, 1);
    assert.equal(game.interrupts[0].payload.x, 2);
  });

  it('popInterrupt returns null when no match', () => {
    const game = { interrupts: [] };
    assert.equal(popInterrupt(game, INTERRUPT_TYPES.CC_CHOICE), null);
  });

  it('popInterruptById removes the specific entry', () => {
    const game = {};
    pushInterrupt(game, INTERRUPT_TYPES.CC_CHOICE);
    const e2 = pushInterrupt(game, INTERRUPT_TYPES.CC_CHOICE);
    pushInterrupt(game, INTERRUPT_TYPES.CC_CHOICE);
    const popped = popInterruptById(game, e2.id);
    assert.equal(popped.id, e2.id);
    assert.equal(game.interrupts.length, 2);
    assert.ok(!game.interrupts.some((i) => i.id === e2.id));
  });

  it('getInterruptById finds without removing', () => {
    const game = {};
    const e = pushInterrupt(game, INTERRUPT_TYPES.CC_CHOICE, { v: 1 });
    const found = getInterruptById(game, e.id);
    assert.equal(found.payload.v, 1);
    assert.equal(game.interrupts.length, 1);
  });

  it('hasAnyInterrupts is false on empty/missing stack, true after push', () => {
    assert.equal(hasAnyInterrupts({}), false);
    assert.equal(hasAnyInterrupts({ interrupts: [] }), false);
    const game = {};
    pushInterrupt(game, INTERRUPT_TYPES.CC_CHOICE);
    assert.equal(hasAnyInterrupts(game), true);
  });

  it('hasInterrupt is type-specific', () => {
    const game = {};
    pushInterrupt(game, INTERRUPT_TYPES.CC_NEGATION);
    assert.equal(hasInterrupt(game, INTERRUPT_TYPES.CC_NEGATION), true);
    assert.equal(hasInterrupt(game, INTERRUPT_TYPES.CC_CHOICE), false);
  });

  it('getBlockingInterrupts filters by blocksSave', () => {
    const game = {};
    pushInterrupt(game, 'a');                            // default blocksSave: true
    pushInterrupt(game, 'b', {}, { blocksSave: false });  // non-blocking
    pushInterrupt(game, 'c');
    const blocking = getBlockingInterrupts(game);
    assert.equal(blocking.length, 2);
    assert.deepEqual(blocking.map((i) => i.type), ['a', 'c']);
  });

  it('clearAllInterrupts wipes the stack (used by checkpoint load)', () => {
    const game = {};
    pushInterrupt(game, INTERRUPT_TYPES.CC_CHOICE);
    pushInterrupt(game, INTERRUPT_TYPES.CC_NEGATION);
    clearAllInterrupts(game);
    assert.deepEqual(game.interrupts, []);
    assert.equal(hasAnyInterrupts(game), false);
  });

  it('clearAllInterrupts on null/undefined game is safe (no throw)', () => {
    clearAllInterrupts(null);
    clearAllInterrupts(undefined);
  });

  it('multiple interrupts of different types coexist on the stack', () => {
    const game = {};
    pushInterrupt(game, INTERRUPT_TYPES.CC_NEGATION, { src: 'card-x' });
    pushInterrupt(game, INTERRUPT_TYPES.BLEEDING, { figure: 'Vader-1-0' });
    pushInterrupt(game, INTERRUPT_TYPES.SPACE_PICK, { spaces: ['a1', 'a2'] });
    assert.equal(game.interrupts.length, 3);
    assert.ok(hasInterrupt(game, INTERRUPT_TYPES.CC_NEGATION));
    assert.ok(hasInterrupt(game, INTERRUPT_TYPES.BLEEDING));
    assert.ok(hasInterrupt(game, INTERRUPT_TYPES.SPACE_PICK));
  });

  it('IDs are unique even across same-millisecond pushes', () => {
    const game = {};
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      const e = pushInterrupt(game, INTERRUPT_TYPES.CC_CHOICE);
      ids.add(e.id);
    }
    assert.equal(ids.size, 100);
  });
});
