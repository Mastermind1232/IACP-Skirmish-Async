import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findGameByChannel, findGameByCommonChannel } from './game-channel-lookup.js';

const game1 = {
  generalId: 'gen1', chatId: 'chat1', boardId: 'board1',
  p1HandId: 'p1h1', p2HandId: 'p2h1',
  p1PlayAreaId: 'p1pa1', p2PlayAreaId: 'p2pa1',
};
const gamesMap = new Map([['g001', game1]]);

describe('findGameByChannel', () => {
  it('finds game by generalId', () => {
    const r = findGameByChannel(gamesMap, 'gen1');
    assert.strictEqual(r.gameId, 'g001');
    assert.strictEqual(r.isP1, false);
    assert.strictEqual(r.isP2, false);
  });
  it('finds game by p1HandId with isP1=true', () => {
    const r = findGameByChannel(gamesMap, 'p1h1');
    assert.strictEqual(r.gameId, 'g001');
    assert.strictEqual(r.isP1, true);
    assert.strictEqual(r.isP2, false);
  });
  it('finds game by p2PlayAreaId with isP2=true', () => {
    const r = findGameByChannel(gamesMap, 'p2pa1');
    assert.strictEqual(r.isP2, true);
  });
  it('returns null for unknown channel', () => {
    assert.strictEqual(findGameByChannel(gamesMap, 'unknown'), null);
  });
  it('returns null for null channelId', () => {
    assert.strictEqual(findGameByChannel(gamesMap, null), null);
  });
});

describe('findGameByCommonChannel', () => {
  it('finds game by boardId', () => {
    const r = findGameByCommonChannel(gamesMap, 'board1');
    assert.strictEqual(r, game1);
  });
  it('does not match hand channels', () => {
    assert.strictEqual(findGameByCommonChannel(gamesMap, 'p1h1'), null);
  });
  it('returns null for null', () => {
    assert.strictEqual(findGameByCommonChannel(gamesMap, null), null);
  });
});
