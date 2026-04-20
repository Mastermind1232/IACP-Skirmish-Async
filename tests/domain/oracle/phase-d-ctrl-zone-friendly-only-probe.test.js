/**
 * Phase-D probe: deployment-zone control requires friendly-only presence.
 *
 * PROBE-PD-CTRL-003: CRR CONTROL — "In a Skirmish, a player Controls a
 *   deployment zone if there is at least one friendly figure in any space
 *   of that deployment zone and no hostile figures in any space of that
 *   deployment zone."
 *
 * Implementation: `runEndOfRoundRules` in src/game/mission-rules.js
 *   evaluates the `vpPerControlledDeploymentZone` rule. For each zone it
 *   counts friendly and hostile occupants; control is awarded iff the
 *   friendly count is >=1 AND the hostile count is 0 (strict "no hostile"
 *   requirement — NOT strict majority).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const MISSION_SRC = readFileSync(resolve(ROOT, 'src/game/mission-rules.js'), 'utf8');

describe('PROBE-PD-CTRL-003: zone control = friendly present AND no hostile present', () => {
  it('003a: source — rule evaluates vpPerControlledDeploymentZone with both counts', () => {
    assert.match(MISSION_SRC,
      /if \(rules\.vpPerControlledDeploymentZone && mapId\) \{/,
      'vpPerControlledDeploymentZone branch must be present — CRR-CTRL-003');
    assert.match(MISSION_SRC,
      /let p1Count = 0, p2Count = 0;/,
      'rule must tally p1 and p2 occupant counts per zone — CRR-CTRL-003');
  });

  it('003b: source — control predicate is "friendly present AND opponent absent"', () => {
    assert.match(MISSION_SRC,
      /if \(p1Count > 0 && p2Count === 0\) vpByPlayer\[1\] \+= vp;\s*\n\s*else if \(p2Count > 0 && p1Count === 0\) vpByPlayer\[2\] \+= vp;/,
      'control must require friendly >=1 AND no hostile in zone — CRR-CTRL-003');
  });

  it('003c: source — header doc names the CRR rule verbatim', () => {
    assert.match(MISSION_SRC,
      /a player Controls a deployment zone if there is at least one\s*\n\s*\/\/ friendly figure in any space of that deployment zone and no hostile figures/,
      'source comment must cite CRR CONTROL definition — CRR-CTRL-003');
  });

  it('003d: behavior — control predicate matches CRR semantics for all 9 count combos', () => {
    const control = (p1, p2) => {
      if (p1 > 0 && p2 === 0) return 'p1';
      if (p2 > 0 && p1 === 0) return 'p2';
      return null;
    };
    assert.equal(control(1, 0), 'p1', '1/0 → p1 controls');
    assert.equal(control(3, 0), 'p1', 'many/0 → p1 controls');
    assert.equal(control(0, 1), 'p2', '0/1 → p2 controls');
    assert.equal(control(0, 0), null, 'empty zone → no control');
    assert.equal(control(1, 1), null, '1/1 → hostile present, no control (NOT tie-majority)');
    assert.equal(control(3, 1), null, '3/1 → hostile present, NO p1 control (was under old strict-majority)');
    assert.equal(control(1, 3), null, '1/3 → hostile present, NO p2 control (was under old strict-majority)');
    assert.equal(control(2, 2), null, '2/2 → hostile present, no control');
  });
});
