/**
 * Phase-D probe: CRR ATK-036 — "Some abilities allow a player to perform an
 * attack with a hostile figure; the resolving player chooses the target and
 * controls the figure for the duration of that attack; all non-neutral
 * figures are considered hostile, no figures friendly, and the figure
 * cannot target itself."
 *
 * Substrate: Murne Rin's `false_orders` ability.
 *
 * Implementation chain (invariant pin):
 *   1. `false_orders` builds `pendingFalseOrders` with a three-field scope
 *      (controlledFigureKey, controlledPlayerNum, controllerPlayerNum) so the
 *      controller is recorded separately from the figure's natural side.
 *   2. controlledPlayerNum is set to opponentPlayerNum(resolver) — i.e. the
 *      figure comes from the HOSTILE side. This encodes "all non-neutral
 *      figures are hostile" in a 2-player skirmish where opponent = hostile.
 *   3. Phase-2 target enumeration (`handleFalseOrdersAction` attack branch)
 *      filters out the controlled figure itself (`if (figKey !==
 *      controlledFigureKey)`), pinning "cannot target itself".
 *   4. `handleFalseOrdersAtkPick` gates the button on the controllerPlayerNum
 *      (requirePlayer on controllerPlayerNum, not on the figure's own side),
 *      pinning "the resolving player chooses the target".
 *   5. `pendingCombat` stores `falseOrdersControllerPlayerNum` separately from
 *      `attackerPlayerNum` (which is the figure's natural side), and at least
 *      four combat sites (roll, reroll, surge, token-spend) resolve the
 *      controller via `combat.falseOrdersControllerPlayerNum ?? attackerPlayerNum`,
 *      pinning "controls the figure for the duration of that attack".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const ABIL_SRC = readFileSync(resolve(ROOT, 'src/game/abilities.js'), 'utf8');
const DC_PA_SRC = readFileSync(resolve(ROOT, 'src/handlers/dc-play-area.js'), 'utf8');
const COMBAT_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat.js'), 'utf8');

describe('PROBE-PD-ATK-036: False Orders performs an attack with a hostile figure under the resolver\'s control', () => {
  it('036a: source — `false_orders` builds pendingFalseOrders with three-field controller/controlled scope', () => {
    assert.match(ABIL_SRC,
      /setPendingFalseOrders\(game,\s*\{\s*\n\s*controlledFigureKey:\s*targetFigureKey,\s*\n\s*controlledPlayerNum:\s*enemyNum,\s*\n\s*controllerPlayerNum:\s*playerNum,/,
      'pendingFalseOrders must record controlledFigureKey, controlledPlayerNum, and controllerPlayerNum separately — CRR-ATK-036');
  });

  it('036b: source — controlledPlayerNum is opponentPlayerNum(resolver): the figure is hostile to the resolver', () => {
    assert.match(ABIL_SRC,
      /const enemyNum = opponentPlayerNum\(playerNum\);/,
      'enemyNum (controlled figure\'s side) must be resolver\'s opponent — "all non-neutral figures are hostile" — CRR-ATK-036');
  });

  it('036c: source — target enumeration in Phase-1 iterates ONLY game.figurePositions[enemyNum] (hostile side), not the resolver\'s own figures', () => {
    assert.match(ABIL_SRC,
      /for \(const \[fk, pos\] of Object\.entries\(game\.figurePositions\?\.\[enemyNum\] \|\| \{\}\)\) \{/,
      'candidate controlled-figure pool must be drawn from the resolver\'s opponent (hostile side) — CRR-ATK-036');
  });

  it('036d: source — Phase-2 target enumeration in handleFalseOrdersAction excludes the controlled figure itself (cannot target itself)', () => {
    // The attack branch builds allOtherPositions by iterating both players'
    // figurePositions and skipping the controlledFigureKey.
    assert.match(DC_PA_SRC,
      /if \(figKey !== controlledFigureKey\) allOtherPositions\[figKey\] = pos;/,
      'controlled figure must be excluded from its own target list — CRR-ATK-036');
  });

  it('036e: source — pendingCombat records falseOrdersControllerPlayerNum separately from attackerPlayerNum (figure\'s natural side)', () => {
    // pendingCombat is built with attackerPlayerNum = controlledPlayerNum
    // (the figure's own side) AND a separate falseOrdersControllerPlayerNum
    // field pointing at the resolver.
    assert.match(COMBAT_SRC,
      /attackerPlayerNum:\s*controlledPlayerNum,[\s\S]*?falseOrdersControllerPlayerNum:\s*controllerPlayerNum,/,
      'pendingCombat must record both attackerPlayerNum (figure\'s side) and falseOrdersControllerPlayerNum (resolver) — CRR-ATK-036');
  });

  it('036f: source — handleFalseOrdersAtkPick gates the target-pick button on controllerPlayerNum (resolver chooses target)', () => {
    assert.match(COMBAT_SRC,
      /const \{ controllerPlayerNum, controlledFigureKey, controlledPlayerNum \} = fo;\s*\n\s*if \(!await requirePlayer\(interaction, game, interaction\.user\.id, controllerPlayerNum, canActAsPlayer, 'Only the controller may choose\.'\)\) return;/,
      'target-pick must be gated on controllerPlayerNum (resolver), not controlledPlayerNum — CRR-ATK-036');
  });

  it('036g: source — controller scope flows through all downstream combat sites (roll/reroll/surge/token-phase)', () => {
    // At least 4 distinct "effective attacker" resolution sites must fall
    // back via `combat.falseOrdersControllerPlayerNum ?? ...` pattern. This
    // pins "controls the figure for the duration of that attack".
    const sites = COMBAT_SRC.match(/combat\.falseOrdersControllerPlayerNum\s*\?\?\s*(?:combat\.)?attackerPlayerNum/g) || [];
    assert.ok(sites.length >= 4,
      `falseOrdersControllerPlayerNum must gate ≥4 combat sites (got ${sites.length}) — CRR-ATK-036`);
  });
});
