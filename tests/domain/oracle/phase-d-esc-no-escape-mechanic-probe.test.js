/**
 * Phase-D probe: skirmish has no mission-escape mechanic; the ESC-001/002/003
 * and STN-004 rule cluster is vacuously satisfied across the codebase.
 *
 * PROBE-PD-ESC-001: CRR ESCAPING — "To escape, a figure must spend one movement
 *   point while on or adjacent to the space indicated in the mission rule …
 *   Stunned figures cannot escape … an escaped figure is removed from the map."
 *
 * Implementation: skirmish has no escape mechanic. No mission in
 *   `data/mission-cards.json` invokes the escape rule; no ability in
 *   `data/ability-library.json` has "escape" in its effect text; no Command
 *   Card uses the mission-escape rule (the one match, "Desperate Escape" by
 *   Kuiil, is a 6-space end-of-round move). The token "escape" appears only
 *   inside `src/ai/self-play.js` as the AI training-loop's "escape hatch"
 *   stuck-detection heuristic — unrelated to the IACP escape mechanic.
 *   Consequently CRR-ESC-001 (MP-on-escape-space), CRR-ESC-002 (Stunned
 *   cannot escape), CRR-ESC-003 (escaped figure removed from map), and
 *   CRR-STN-004 (Stunned-cannot-escape restatement) are all vacuously
 *   satisfied: no code path in skirmish implements or exercises the escape
 *   rule, so no invariant can be violated.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const MC = JSON.parse(readFileSync(resolve(ROOT, 'data/mission-cards.json'), 'utf8'));
const AB = JSON.parse(readFileSync(resolve(ROOT, 'data/ability-library.json'), 'utf8'));
const CC = JSON.parse(readFileSync(resolve(ROOT, 'data/cc-effects.json'), 'utf8'));
const SP_SRC = readFileSync(resolve(ROOT, 'src/ai/self-play.js'), 'utf8');

function* walkFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walkFiles(p);
    else if (p.endsWith('.js')) yield p;
  }
}

describe('PROBE-PD-ESC-001: skirmish has no mission-escape mechanic; ESC/STN rule cluster vacuously satisfied', () => {
  it('001a: data — no mission in mission-cards.json references "escape" in any field', () => {
    const hits = Object.keys(MC).filter(k => JSON.stringify(MC[k]).toLowerCase().includes('escape'));
    assert.deepEqual(hits, [],
      'no skirmish mission may invoke the escape rule — CRR-ESC-001');
  });

  it('001b: data — no ability in ability-library.json mentions "escape" in its definition', () => {
    const hits = Object.keys(AB.abilities || {}).filter(k => JSON.stringify(AB.abilities[k]).toLowerCase().includes('escape'));
    assert.deepEqual(hits, [],
      'no ability may reference the escape rule — CRR-ESC-001');
  });

  it('001c: data — the only Command Card matching "escape" is Desperate Escape (a 6-space move, not mission-escape)', () => {
    const hits = Object.keys(CC.cards || {}).filter(k => JSON.stringify(CC.cards[k]).toLowerCase().includes('escape'));
    assert.deepEqual(hits, ['Desperate Escape'],
      'only Desperate Escape may match the escape token — CRR-ESC-001');
    const de = CC.cards['Desperate Escape'];
    assert.match(de.effect, /move up to 6 spaces/i,
      'Desperate Escape effect must be a 6-space move, not the mission-escape rule — CRR-ESC-001');
  });

  it('001d: source — every "escape" token in the src tree lives inside src/ai/self-play.js (training-loop escape hatch only)', () => {
    const hits = [];
    for (const p of walkFiles(resolve(ROOT, 'src'))) {
      const src = readFileSync(p, 'utf8');
      if (/escape/i.test(src)) hits.push(p.replace(ROOT + '/', ''));
    }
    assert.deepEqual(hits, ['src/ai/self-play.js'],
      'no src file outside self-play.js may mention escape — CRR-ESC-001');
  });

  it('001e: source — self-play.js "escape" references belong to the stuck-detection hatch block, never the IACP mission-escape vocabulary', () => {
    assert.match(SP_SRC, /ESCAPE_ACTION_TYPES/,
      'self-play.js must contain the stuck-escape-hatch constant — CRR-ESC-001');
    assert.match(SP_SRC, /Escape hatch: forcing/,
      'self-play.js must contain the stuck-escape-hatch log message — CRR-ESC-001');
    // The mission-escape rule requires: (a) spending MP on/adjacent to an escape space,
    // (b) removing the figure from the map, or (c) a Stunned-restriction check.
    // None of these phrases may appear anywhere in the self-play escape-hatch block.
    assert.doesNotMatch(SP_SRC, /escape.space|escape.figure.removed|removed.from.map.*escape|stunned.*escape/i,
      'self-play.js must not reference mission-escape vocabulary — CRR-ESC-001');
  });

  it('001f: cluster — ESC-002 (Stunned cannot escape), ESC-003 (escaped removed from map), and STN-004 (Stunned cannot escape during escape mission) are vacuous consequences of no-escape-in-skirmish', () => {
    const cc = (CC.cards || {})['Desperate Escape'];
    assert.ok(cc, 'Desperate Escape card must remain the unique escape-token match');
    assert.doesNotMatch(JSON.stringify(cc),
      /escape.*figure.*removed|removed.*from.*map|escaped.*figure|escape.*space/i,
      'Desperate Escape may not implement the mission-escape rule — CRR-ESC-002/003, CRR-STN-004');
  });
});
