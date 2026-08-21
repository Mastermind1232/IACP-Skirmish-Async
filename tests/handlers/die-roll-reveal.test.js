// Unit tests for the shared out-of-combat die-roll reveal helpers
// (src/discord/dice-renderer.js): formatDieFaces + postDieRollResult.
//
// Out-of-combat abilities that roll a die (Dr. Hemlock/Neurostim, Tauntaun
// Headbutt, Trample, Telekinetic Throw, Terminal Protocol, Set the Charge,
// Force cards, IG-11 Self-Destruct, Last Resort, Fighting Knife, Indiscriminate
// Fire, etc.) now SHOW THE ROLLED DIE FACE in the activation/combat thread the
// same way combat does. postDieRollResult renders the face image and posts it,
// with a compact text fallback when no image can be rendered or no thread exists.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDieFaces, postDieRollResult } from '../../src/discord/dice-renderer.js';

describe('formatDieFaces', () => {
  it('formats an attack face with damage + surge', () => {
    assert.equal(formatDieFaces([{ color: 'red', dmg: 2, surge: 1 }]), 'Red: 2 Damage, 1 Surge');
  });
  it('formats a blank attack face', () => {
    assert.equal(formatDieFaces([{ color: 'yellow' }]), 'Yellow: Blank');
  });
  it('formats a defense block face', () => {
    assert.equal(formatDieFaces([{ color: 'white', block: 1, evade: 1 }], true), 'White: 1 Block, 1 Evade');
  });
  it('formats a dodge defense face', () => {
    assert.equal(formatDieFaces([{ color: 'white', dodge: true }], true), 'White: Dodge');
  });
  it('joins multiple dice with semicolons', () => {
    assert.equal(
      formatDieFaces([{ color: 'blue', dmg: 1 }, { color: 'blue', dmg: 2, surge: 1 }]),
      'Blue: 1 Damage; Blue: 2 Damage, 1 Surge',
    );
  });
  it('returns empty string for no dice', () => {
    assert.equal(formatDieFaces([]), '');
    assert.equal(formatDieFaces(null), '');
  });
});

describe('postDieRollResult', () => {
  it('is a clean no-op when no thread is provided (headless/self-play path)', async () => {
    // Must not throw — abilities call this in paths that may have no thread.
    await assert.doesNotReject(() =>
      postDieRollResult(null, { content: 'X rolled', dice: [{ color: 'red', faceIdx: 0, dmg: 2 }] }));
  });

  it('posts the rendered die IMAGE on the success path', async () => {
    const sent = [];
    const thread = { send: async (payload) => { sent.push(payload); } };
    // red faceIdx 0 renders from a real face JPG → image path.
    await postDieRollResult(thread, {
      content: '🎲 X rolled 1 red die:',
      dice: [{ color: 'red', faceIdx: 0, dmg: 2, surge: 0 }],
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].content, '🎲 X rolled 1 red die:');
    assert.ok(Array.isArray(sent[0].files) && sent[0].files.length === 1, 'should attach the die image');
    assert.equal(sent[0].files[0].name, 'die-roll.png');
  });

  it('falls back to text (content + compact faces) when the face cannot be rendered', async () => {
    const sent = [];
    const thread = { send: async (payload) => { sent.push(payload); } };
    // faceIdx -1 → renderer returns null → text fallback path.
    await postDieRollResult(thread, {
      content: 'X rolled',
      dice: [{ color: 'red', faceIdx: -1, dmg: 2, surge: 1 }],
    });
    assert.equal(sent.length, 1);
    // Text fallback is a plain string, not an embed/files payload.
    assert.equal(typeof sent[0], 'string');
    assert.match(sent[0], /^X rolled/);
    assert.match(sent[0], /Red: 2 Damage, 1 Surge/);
  });

  it('never throws when thread.send rejects', async () => {
    const thread = { send: async () => { throw new Error('discord down'); } };
    await assert.doesNotReject(() =>
      postDieRollResult(thread, { content: 'X rolled', dice: [{ color: 'red', faceIdx: 0, dmg: 1 }] }));
  });
});
