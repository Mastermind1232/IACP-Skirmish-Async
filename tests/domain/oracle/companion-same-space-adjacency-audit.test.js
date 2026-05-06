/**
 * Audit lock: CRR companion-same-space adjacency is preserved at the four
 * raw-adjacency aura sites that previously missed it. Per destruct
 * 2026-05-06 + CRR p.21 COMPANIONS, same-space figures (host + companion,
 * or any two figures sharing a cell) count as mutually adjacent.
 *
 * This test pins TWO invariants at each site:
 *
 *   (a) the activator's own coord IS added to the adjacency set (via
 *       `_defPosLower` / `_stPosLower` / `pos !== newTopLeft` etc.) so
 *       same-space figures are eligible.
 *   (b) the activator/source-figure is still excluded from triggering the
 *       aura on itself (via `fk === ...figureKey` skip), so a lone non-
 *       companion figure can NOT match its own aura. This protects
 *       destruct's other concern: "make sure this doesn't break normal
 *       figures not being adjacent to self."
 *
 * Sites pinned:
 *   1. Cower (combat.js)
 *   2. Squad Training (combat.js)
 *   3. Deference Protocol (movement.js)
 *   4. Cassian Said I Had To (movement.js)
 *
 * Pure source-text scan — no game-state setup. The behavioral helpers
 * (getFiguresAdjacentToTarget / getFiguresAdjacentToCoord) already pin
 * same-space inclusion via adjacency-same-square.test.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');
const COMBAT = readFileSync(resolve(ROOT, 'src/handlers/combat.js'), 'utf8');
const MOVEMENT = readFileSync(resolve(ROOT, 'src/handlers/movement.js'), 'utf8');

describe('CRR companion-same-space adjacency audit', () => {
  it('Cower: includes self-coord in adjacency set AND skips defender-self in iteration', () => {
    // Find the Cower block
    const block = COMBAT.match(/Cower \(C-3PO[\s\S]{0,1200}?defSpecialReroll \+= 1[\s\S]{0,200}?\}\s*\}\s*\}/);
    assert.ok(block, 'Cower block locatable');
    const src = block[0];
    // (a) same-space inclusion
    assert.match(src, /adjToDefC\.add\(_defPosLower\)/,
      'Cower must add the defender\'s own coord to the adjacency set (CRR companion same-space)');
    // (b) self-exclude — defender doesn\'t trigger Cower on themselves
    assert.match(src, /fk === combat\.target\?\.figureKey/,
      'Cower must still exclude the defender\'s own figureKey (no self-aura)');
  });

  it('Squad Training: includes self-coord in adjacency set AND skips attacker-self in iteration', () => {
    const block = COMBAT.match(/Squad Training[\s\S]{0,1500}?applySquadTrainingReroll[\s\S]{0,200}?\}\s*\}\s*\}\s*\}/);
    assert.ok(block, 'Squad Training block locatable');
    const src = block[0];
    assert.match(src, /stAdj\.add\(_stPosLower\)/,
      'Squad Training must add the attacker\'s own coord to the adjacency set');
    assert.match(src, /fk === combat\.attackerFigureKey/,
      'Squad Training must still exclude the attacker\'s own figureKey');
  });

  it('Deference Protocol: same-space LEADER trigger AND mover-self exclude', () => {
    const dpStart = MOVEMENT.indexOf('Deference Protocol (KX-Series Security Droid)');
    assert.ok(dpStart > 0, 'Deference Protocol block locatable');
    const dpEnd = MOVEMENT.indexOf('Cassian Said I Had To', dpStart);
    assert.ok(dpEnd > dpStart, 'Deference Protocol block end locatable');
    const src = MOVEMENT.slice(dpStart, dpEnd);
    // Same-space inclusion via `pos !== newTopLeft` clause.
    assert.match(src, /pos !== newTopLeft/,
      'Deference Protocol must accept LEADER moving INTO KX\'s own space (same-space adjacency)');
    assert.match(src, /fk === figureKey/,
      'Deference Protocol must still exclude the moved-figure (KX moving doesn\'t trigger his own ability)');
  });

  it('Cassian Said I Had To: same-space LEADER trigger AND mover-self exclude', () => {
    const csStart = MOVEMENT.indexOf('Cassian Said I Had To (K-2S0)');
    assert.ok(csStart > 0, 'Cassian Said I Had To block locatable');
    // End at next comment // Swipe ...
    const csEnd = MOVEMENT.indexOf('Swipe (Salacious', csStart);
    assert.ok(csEnd > csStart, 'Cassian block end locatable');
    const src = MOVEMENT.slice(csStart, csEnd);
    assert.match(src, /pos !== newTopLeft/,
      'Cassian Said I Had To must accept LEADER moving INTO K-2S0\'s own space');
    assert.match(src, /fk === figureKey/,
      'Cassian Said I Had To must still exclude the moved-figure');
  });
});
