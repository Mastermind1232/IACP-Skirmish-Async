/**
 * The SoA and EoA windows resolve "in initiative order" (alexanbv 2026-08-12).
 *
 * Both orchestrators bucketize on an initiative player number, and every one of
 * the five call sites computed it from a field that is never assigned anywhere
 * in the codebase:
 *
 *   game.initiative        never written
 *   game.firstPlayer       never written
 *   game.initiativePlayerNum   never written
 *
 * So every site fell through its `??` chain to the ACTIVATOR, and initiative
 * order was never actually applied to either window. The bug was invisible
 * because the fallback is a valid player number, so nothing ever threw.
 *
 * The real field is game.initiativePlayerId (a Discord id), read through
 * getInitiativePlayerNum. These tests pin both halves: the phantom fields stay
 * dead, and the call sites keep using the helper.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../../../src/', import.meta.url).pathname;

function allSourceFiles(dir = SRC, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) allSourceFiles(full, out);
    else if (name.endsWith('.js') && !name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

const FILES = allSourceFiles();

describe('initiative order is read from the field that actually exists', () => {
  test('no source file reads a phantom initiative field', () => {
    const offenders = [];
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8');
      for (const [i, line] of src.split('\n').entries()) {
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
        if (/game\.initiativePlayerNum|game\.firstPlayer|game\.initiative\b(?!PlayerId)/.test(line)) {
          offenders.push(`${f.replace(SRC, 'src/')}:${i + 1}  ${line.trim()}`);
        }
      }
    }
    assert.deepStrictEqual(offenders, [],
      'these read an initiative field that is never assigned, so they silently fall back to the activator');
  });

  test('every orchestrator start site derives its init player from the helper', () => {
    const starters = [];
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8');
      if (f.includes('orchestrator.js')) continue; // the definitions, not call sites
      if (!/start(Soa|Eoa)Resolution\(/.test(src)) continue;
      starters.push([f.replace(SRC, 'src/'), src]);
    }
    assert.ok(starters.length >= 4, `expected the known start sites, found ${starters.length}`);
    for (const [name, src] of starters) {
      assert.match(src, /getInitiativePlayerNum\(game\)/,
        `${name} starts an SoA/EoA resolution but never derives the initiative player from getInitiativePlayerNum`);
    }
  });

  test('getInitiativePlayerNum reads initiativePlayerId, not a bare number', async () => {
    const { getInitiativePlayerNum } = await import('../../../src/game/player-helpers.js');
    const game = { player1Id: 'p1', player2Id: 'p2', initiativePlayerId: 'p2' };
    assert.strictEqual(getInitiativePlayerNum(game), 2);
    assert.strictEqual(getInitiativePlayerNum({ ...game, initiativePlayerId: 'p1' }), 1);
  });
});
