/**
 * Phase-D probe: when a figure carrying a mission-carried token (e.g.,
 * Mos Eisley Outskirts B "Smuggled Goods" contraband) is defeated, the
 * token drops in that figure's space so another figure can pick it up.
 *
 * PROBE-PD-RTK-002: CRR RETRIEVING TOKENS — "A carried token cannot be
 *   retrieved by others or dropped voluntarily; on figure defeat,
 *   carried tokens drop in the figure's space."
 *
 * Implementation:
 *   - `src/engine/defeat-handler.js` snapshots `lastPos` and
 *     `wasCarryingContraband` BEFORE removeFigurePosition, then after
 *     removal, if the mission's mechanics.type === 'carry', appends
 *     the last space to `game.droppedContrabandSpaces` and clears the
 *     carrier flag from `game.figureContraband`.
 *   - `src/game/board-helpers.js` `getLegalInteractOptions` extends
 *     the retrieve_contraband eligibility check to also include
 *     droppedContrabandSpaces (via getFigureAdjacentCoordsFromSet).
 *   - `src/handlers/interact.js` on pickup consumes one dropped-space
 *     entry that the picking figure is on/adjacent to, so each dropped
 *     token is a single-use pickup; static spawn coords are unchanged.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const DH_SRC = readFileSync(resolve(ROOT, 'src/engine/defeat-handler.js'), 'utf8');
const BH_SRC = readFileSync(resolve(ROOT, 'src/game/board-helpers.js'), 'utf8');
const IT_SRC = readFileSync(resolve(ROOT, 'src/handlers/interact.js'), 'utf8');

describe('PROBE-PD-RTK-002: carried contraband drops in defeated figure\'s space', () => {
  it('002a: source — defeat-handler captures lastPos before removeFigurePosition and records drop under mechanics.type === "carry"', () => {
    assert.match(DH_SRC,
      /const lastPos = game\.figurePositions\?\.\[defeatedPlayerNum\]\?\.\[figureKey\] \|\| null;\s*\n\s*const wasCarryingContraband = !!\(game\.figureContraband\?\.\[figureKey\]\);[\s\S]*?removeFigurePosition\(game, defeatedPlayerNum, figureKey\);/,
      'defeat-handler must snapshot lastPos + carry flag BEFORE removeFigurePosition — CRR-RTK-002');
    assert.match(DH_SRC,
      /if \(mech\?\.type === 'carry' && lastPos\) \{[\s\S]*?game\.droppedContrabandSpaces = game\.droppedContrabandSpaces \|\| \[\];[\s\S]*?game\.droppedContrabandSpaces\.push\(norm\);/,
      'defeat-handler must append dropped-space under mechanics.type=carry — CRR-RTK-002');
    assert.match(DH_SRC,
      /delete game\.figureContraband\[figureKey\];/,
      'defeat-handler must clear the carry flag on defeat — CRR-RTK-002');
  });

  it('002b: source — board-helpers retrieve_contraband eligibility includes droppedContrabandSpaces adjacency', () => {
    assert.match(BH_SRC,
      /const dropped = game\.droppedContrabandSpaces \|\| \[\];\s*\n\s*if \(dropped\.length\) \{\s*\n\s*const droppedSet = toLowerSet\(dropped\);\s*\n\s*eligible = getFigureAdjacentCoordsFromSet\(game, playerNum, figureKey, mapId, droppedSet\)\.length > 0;/,
      'board-helpers must include droppedContrabandSpaces in retrieve_contraband eligibility — CRR-RTK-002');
  });

  it('002c: source — interact.js consumes one droppedContrabandSpaces entry when picking up from a dropped space', () => {
    assert.match(IT_SRC,
      /if \(game\.droppedContrabandSpaces\?\.length\) \{[\s\S]*?const droppedSet = toLowerSet\(game\.droppedContrabandSpaces\);[\s\S]*?const hits = getFigureAdjacentCoordsFromSet\(game, playerNum, figureKey, mapId, droppedSet\);[\s\S]*?game\.droppedContrabandSpaces\.splice\(idx, 1\);/,
      'interact.js must consume one dropped-space entry on contraband pickup — CRR-RTK-002');
  });
});
