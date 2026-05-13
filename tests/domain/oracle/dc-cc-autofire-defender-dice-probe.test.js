/**
 * Oracle: Z-6 Trooper's "Autofire" attachment Special Action says:
 *   "Perform an attack. The defending figure adds one white die to its
 *    defense pool. This attack gains: Surge: After this attack resolves,
 *    perform an attack targeting a figure within 3 spaces of the target
 *    space."
 *
 * Regression this probe guards against: the +1 white die was dead code
 * for ~all of Autofire's history. At attack-declare time, combat.js set
 * `combat.autofireAttack = true` AND deleted `game.autofireActive[msgId]`
 * (consumed). Then at defender-rolls time, the code checked
 * `game.autofireActive[...]` — which was already gone. The result: Autofire
 * attacks hit a regular-sized defense pool, not the +1 white die the card
 * promises.
 *
 * This is a source-shape probe (not a runtime attack simulation) because
 * pinning the correct flag at the pool-construction site is the whole fix.
 *
 * Assertions:
 *   1. The attack-declare block still sets `combat.autofireAttack = true`
 *      AND still deletes `game.autofireActive[msgId]`.
 *   2. The defender-dice-pool block reads `combat.autofireAttack`
 *      (the per-combat flag that survives the declare step) — NOT the
 *      deleted `game.autofireActive`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMBAT_PATH = resolve(__dirname, '../../../src/handlers/combat.js');
const src = readFileSync(COMBAT_PATH, 'utf8');

describe('DC-CC: Z-6 Autofire — defender +1 white die reads the right flag', () => {
  it('attack-declare block sets combat.autofireAttack and deletes game.autofireActive', () => {
    // Per alexanbv 2026-05-13: autofireActive is keyed by figureKey
    // (attackerFigureKey) post-migration. Pattern updated to match.
    const declareBlock = src.match(
      /if \(game\.autofireActive\?\.\[attackerFigureKey\]\)[\s\S]{0,400}?delete game\.autofireActive\[attackerFigureKey\];/,
    );
    assert.ok(declareBlock, 'expected autofire declare block with set-then-delete pattern');
    assert.ok(
      /(?:game\.pendingCombat|combat)\.autofireAttack\s*=\s*true/.test(declareBlock[0]),
      'declare block must mark autofireAttack on the per-combat object so later phases can detect it',
    );
  });

  it('defender-dice pool reads combat.autofireAttack (not the deleted game.autofireActive)', () => {
    const poolBlock = src.match(
      /\/\/ Autofire: defender adds 1 white die[\s\S]{0,500}?pool\.push\(['"]white['"]\);/,
    );
    assert.ok(poolBlock, 'expected defender-dice autofire block');
    assert.ok(
      /if \(combat\.autofireAttack\)/.test(poolBlock[0]),
      'defender-dice block must gate on combat.autofireAttack',
    );
    assert.ok(
      !/game\.autofireActive\?\.\[combat\.attackerMsgId\]/.test(poolBlock[0]),
      'defender-dice block must NOT read game.autofireActive (stale by this phase)',
    );
  });
});
