/**
 * Phase-D probe: Skirmish Upgrade (Attachment) cards apply to ALL
 * figures in the corresponding deployment group — not to a specific
 * figure. This is enforced structurally: attachments are keyed by
 * DC message id, and the engine has no per-figure attachment lookup.
 *
 * PROBE-PD-SKA-003: CRR SKIRMISH UPGRADES — "Abilities on Attachment
 *   cards apply to all figures in the corresponding group."
 *
 * Implementation: attachments are stored on the game state as
 *   `game.p1DcAttachments[msgId]` and `game.p2DcAttachments[msgId]`,
 *   both keyed by DC message id. Every call site reads this
 *   collection for the whole DC (not a specific figure), then applies
 *   the attachment effects during that figure's activation/attack
 *   flow. There is NO `p1FigureAttachments` or per-figure attachment
 *   store anywhere in src/.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

function* walkFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walkFiles(p);
    else if (p.endsWith('.js')) yield p;
  }
}

describe('PROBE-PD-SKA-003: Attachments are keyed by DC (not per-figure) so they apply to all figures in the group', () => {
  it('003a: source — many call sites read DcAttachments via [msgId] lookup (per-DC, not per-figure)', () => {
    let sitesWithMsgId = 0;
    for (const p of walkFiles(resolve(ROOT, 'src'))) {
      const src = readFileSync(p, 'utf8');
      const matches = src.match(/DcAttachments\?\.\[[^\]]+\]/g) || [];
      sitesWithMsgId += matches.length;
    }
    assert.ok(sitesWithMsgId >= 10,
      `DcAttachments must be read via [msgId] at >=10 sites (found ${sitesWithMsgId}) — CRR-SKA-003`);
  });

  it('003b: source — no src file declares a per-figure attachment container (FigureAttachments)', () => {
    const hits = [];
    for (const p of walkFiles(resolve(ROOT, 'src'))) {
      const src = readFileSync(p, 'utf8');
      if (/\bp1FigureAttachments\b|\bp2FigureAttachments\b|\bfigureAttachments\b|\bperFigureUpgrades\b/.test(src)) {
        hits.push(p.replace(ROOT + '/', ''));
      }
    }
    assert.deepEqual(hits, [],
      'no src file may declare a per-figure attachment container — CRR-SKA-003');
  });
});
