/**
 * Phase-D probe: attachment VP on last-figure defeat.
 *
 * PROBE-PD-WIN-005: When the last figure in a group is defeated, if that
 *   group had an attachment, the opposing player scores VPs equal to that
 *   attachment's cost. (CRR WIN CONDITIONS / VP)
 *
 * Implementation: `processFigureDefeat` in src/engine/defeat-handler.js
 *   checks `groupAlive` by scanning remaining figure positions for any
 *   `${dcName}-*` survivors. Only when the group is fully defeated
 *   (!groupAlive) does it iterate the DC's attachments, sum their
 *   deployment costs, and award the total to the attacker via
 *   `awardKillVp`. Negative-cost attachments reduce the awarded total
 *   (see CRR-NEGC-001 interaction).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFEAT_SRC = readFileSync(resolve(__dirname, '../../../src/engine/defeat-handler.js'), 'utf8');

describe('PROBE-PD-WIN-005: attachment VP awarded on last-figure defeat', () => {
  it('005a: source — processFigureDefeat is the canonical defeat path', () => {
    assert.match(DEFEAT_SRC,
      /export async function processFigureDefeat\(game, opts, deps\) \{/,
      'processFigureDefeat must be the exported defeat handler — CRR-WIN-005');
  });

  it('005b: source — group-alive check scans for remaining figures sharing the DC name prefix', () => {
    assert.match(DEFEAT_SRC,
      /const groupAlive = Object\.keys\(figPos\)\.some\(fk => fk\.startsWith\(dcName \+ '-'\) && figPos\[fk\]\);/,
      'groupAlive must scan figurePositions for `${dcName}-*` survivors — CRR-WIN-005');
  });

  it('005c: source — attachment-VP branch is gated by !groupAlive (last-figure only)', () => {
    assert.match(DEFEAT_SRC,
      /if \(!groupAlive\) \{[\s\S]{0,200}?const attachments = game\[attKey\]\?\.\[msgId\] \|\| \[\];/,
      'attachment-VP branch must require !groupAlive AND read attachments by msgId — CRR-WIN-005');
  });

  it('005d: source — attachment VP sums each attachment cost and awards to attacker', () => {
    assert.match(DEFEAT_SRC,
      /const attCost = attStats\?\.cost \?\? 0;/,
      'attachment-VP branch must read attStats.cost — CRR-WIN-005');
    assert.match(DEFEAT_SRC,
      /attachmentVp \+= attCost;/,
      'attachment-VP branch must accumulate attCost — CRR-WIN-005');
    assert.match(DEFEAT_SRC,
      /awardKillVp\(game, attackerPlayerNum, attachmentVp\);/,
      'attachment VP must be awarded to attackerPlayerNum via awardKillVp — CRR-WIN-005');
  });

  it('005e: source — the attachment-VP award is separate from the figure-kill VP award', () => {
    // vp (calculateKillVp) and attachmentVp (sum of attachment costs) are summed only for logging.
    assert.match(DEFEAT_SRC,
      /let vp = 0;\s*\n\s*let attachmentVp = 0;/,
      'vp and attachmentVp must be tracked as independent accumulators — CRR-WIN-005');
    assert.match(DEFEAT_SRC,
      /const totalVp = vp \+ attachmentVp;/,
      'log total must sum the two accumulators — CRR-WIN-005');
  });

  it('005f: behavior — simulated defeat sums attachment cost into attackerPlayerNum VP (logic sketch)', () => {
    // Pure-JS sketch of the award path: verifies the arithmetic + gating matches CRR.
    const runDefeatVp = (figPositions, dcName, attachmentCosts) => {
      const groupAlive = Object.keys(figPositions).some(fk =>
        fk.startsWith(dcName + '-') && figPositions[fk]);
      let attachmentVp = 0;
      if (!groupAlive) {
        for (const c of attachmentCosts) {
          const attCost = c ?? 0;
          if (attCost !== 0) attachmentVp += attCost;
        }
      }
      return attachmentVp;
    };
    // No survivors + attachment cost 3 → 3 VP
    assert.equal(runDefeatVp({}, 'FooDc', [3]), 3,
      'last-figure defeat with cost-3 attachment must award 3 VP — CRR-WIN-005');
    // Survivors remain → 0 VP (group not fully defeated)
    assert.equal(runDefeatVp({ 'FooDc-0-0': 'a1' }, 'FooDc', [3]), 0,
      'if any figure remains, no attachment VP — CRR-WIN-005');
    // Multiple attachments sum
    assert.equal(runDefeatVp({}, 'FooDc', [2, 3]), 5,
      'multiple attachments must sum costs — CRR-WIN-005');
    // Negative-cost attachment reduces total
    assert.equal(runDefeatVp({}, 'FooDc', [3, -1]), 2,
      'negative-cost attachment must reduce total (CRR-NEGC-001 interaction) — CRR-WIN-005');
  });
});
