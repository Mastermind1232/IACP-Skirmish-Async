/**
 * Phase-D probes: push and defeat are not voluntary exits (architectural invariants).
 *
 * PROBE-PD-PSH-003: A pushed figure is not considered to be voluntarily
 *   exiting its space. (CRR PUSH)
 * PROBE-PD-DEF-004: When being defeated and removed from the map, a figure
 *   is not considered to be voluntarily exiting its space. (CRR DEFEATED)
 *
 * Implementation: voluntary-exit gates (Cripple, Hold Ground, Tripod) live
 * in the Discord button-handler layer at src/handlers/movement.js and fire
 * before any position write. Push and defeat use primitive writes in
 * src/game/player-helpers.js (`pushFigure`, `removeFigurePosition`) that
 * do not traverse the handler layer and cannot be intercepted by the
 * voluntary-exit checks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pushFigure, removeFigurePosition } from '../../../src/game/player-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

const PH_SRC = readFileSync(join(ROOT, 'src/game/player-helpers.js'), 'utf8');
const HM_SRC = readFileSync(join(ROOT, 'src/handlers/movement.js'), 'utf8');

describe('PROBE-PD-PSH-003: push is not a voluntary exit (bypasses handler gates)', () => {
  it('003a: pushFigure body does not reference voluntary-exit gates (Cripple/HoldGround/Tripod)', () => {
    const fnIdx = PH_SRC.indexOf('export function pushFigure');
    const close = PH_SRC.indexOf('\n}\n', fnIdx);
    const body = PH_SRC.slice(fnIdx, close);
    assert.ok(!/crippledFigures/.test(body),
      'pushFigure must not check crippledFigures — CRR-PSH-003');
    assert.ok(!/holdGroundPlayerNum/.test(body),
      'pushFigure must not check holdGroundPlayerNum — CRR-PSH-003');
    assert.ok(!/voluntar/i.test(body),
      'pushFigure must not reference voluntary-exit semantics — CRR-PSH-003');
  });

  it('003b: voluntary-exit gates live in handler layer (src/handlers/movement.js), not in pushFigure', () => {
    assert.match(HM_SRC, /cannot voluntarily exit its space this round/,
      'Cripple gate must exist in handler layer — CRR-PSH-003');
    assert.match(HM_SRC, /Hold Ground.*active/,
      'Hold Ground gate must exist in handler layer — CRR-PSH-003');
    assert.ok(!/pushFigure\s*\(/.test(HM_SRC),
      'handler-layer voluntary-exit gates must not call pushFigure — CRR-PSH-003');
  });

  it('003c: pushFigure succeeds on a figure flagged as Crippled (no gate invoked)', () => {
    const game = {
      figurePositions: { 1: { 'Stormtrooper-1-0': 'a1' } },
      crippledFigures: ['Stormtrooper-1-0'],
      holdGroundPlayerNum: 2,
    };
    const result = pushFigure(game, 1, 'Stormtrooper-1-0', 'b2');
    assert.deepEqual(result, { prevPos: 'a1', newPos: 'b2' },
      'push must succeed regardless of Crippled/HoldGround state — CRR-PSH-003');
    assert.equal(game.figurePositions[1]['Stormtrooper-1-0'], 'b2',
      'pushed position must land even when voluntary-exit flags set — CRR-PSH-003');
  });
});

describe('PROBE-PD-DEF-004: defeat is not a voluntary exit (bypasses handler gates)', () => {
  it('004a: removeFigurePosition body does not reference voluntary-exit gates', () => {
    const fnIdx = PH_SRC.indexOf('export function removeFigurePosition');
    const close = PH_SRC.indexOf('\n}\n', fnIdx);
    const body = PH_SRC.slice(fnIdx, close);
    assert.ok(!/crippledFigures/.test(body),
      'removeFigurePosition must not check crippledFigures — CRR-DEF-004');
    assert.ok(!/holdGroundPlayerNum/.test(body),
      'removeFigurePosition must not check holdGroundPlayerNum — CRR-DEF-004');
    assert.ok(!/voluntar/i.test(body),
      'removeFigurePosition must not reference voluntary-exit semantics — CRR-DEF-004');
  });

  it('004b: voluntary-exit handler gates do not call removeFigurePosition', () => {
    assert.ok(!/removeFigurePosition\s*\(/.test(HM_SRC),
      'handler-layer voluntary-exit gates must not call removeFigurePosition — CRR-DEF-004');
  });

  it('004c: removeFigurePosition removes a Crippled figure cleanly (no gate invoked)', () => {
    const game = {
      figurePositions: { 1: { 'Stormtrooper-1-0': 'a1' } },
      figureConditions: { 'Stormtrooper-1-0': ['Stun'] },
      deviceTokens: { 'Stormtrooper-1-0': { focus: 1 } },
      crippledFigures: ['Stormtrooper-1-0'],
      holdGroundPlayerNum: 2,
    };
    removeFigurePosition(game, 1, 'Stormtrooper-1-0');
    assert.equal(game.figurePositions[1]['Stormtrooper-1-0'], undefined,
      'defeated figure position must be cleared — CRR-DEF-004');
    assert.equal(game.figureConditions['Stormtrooper-1-0'], undefined,
      'defeated figure conditions must be cleared — CRR-DEF-004');
    assert.equal(game.deviceTokens['Stormtrooper-1-0'], undefined,
      'defeated figure device tokens must be cleared — CRR-DEF-004');
  });
});
