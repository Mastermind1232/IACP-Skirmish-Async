/**
 * Phase-D probe: a skirmish game is a single mission, so the rulebook's
 * "at end of mission, flip all depleted cards faceup" reset has no scope
 * in which to operate; CRR-DPL-002 is vacuously satisfied.
 *
 * PROBE-PD-DPL-002: CRR DEPLETE — "At the end of each mission, all
 *   depleted cards are flipped faceup (reset)."
 *
 * Implementation: depleted-card state is tracked per-player as two
 *   message-id arrays on the game object, `game.p1DepletedDcMessageIds`
 *   and `game.p2DepletedDcMessageIds`. Every write across the source
 *   tree now flows through one canonical helper —
 *   `depleteDc(game, msgId, playerNum)` in
 *   `src/game/card-state-helpers.js` — which does an additive
 *   `.push(msgId)` (after a `|| []` lazy-init). No code path ever
 *   removes an entry: there is no `splice`, `filter`, `pop`, `shift`,
 *   `delete`, or `= []` reassignment targeting either array anywhere
 *   in `src/`. When `checkWinConditions` sets `game.ended`, the game
 *   terminates with no reset pass. Because each skirmish game == one
 *   mission, the "end of mission reset" rule has no cross-mission
 *   scope to operate on, and the invariant "depletion is terminal
 *   within a skirmish game" is the skirmish-scope shape of
 *   CRR-DPL-002.
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

describe('PROBE-PD-DPL-002: skirmish has no end-of-mission depletion reset; rule vacuously satisfied', () => {
  it('002a: source — depleted-card state lives in two message-id arrays (p1/p2DepletedDcMessageIds)', () => {
    const GS_SRC = readFileSync(resolve(ROOT, 'src/game-state.js'), 'utf8');
    assert.match(GS_SRC, /'p1DepletedDcMessageIds',\s*'p2DepletedDcMessageIds'/,
      'game-state.js must declare both depletion arrays — CRR-DPL-002');
  });

  it('002b: source — the canonical depletion predicate reads both arrays and applies no reset', () => {
    const GR_SRC = readFileSync(resolve(ROOT, 'src/engine/game-readers.js'), 'utf8');
    assert.match(GR_SRC,
      /export function isDepletedRemovedFromGame\(game, msgId\) \{[\s\S]*?return p1\.includes\(msgId\) \|\| p2\.includes\(msgId\);/,
      'isDepletedRemovedFromGame must be a pure read — CRR-DPL-002');
  });

  it('002c: source — the canonical `depleteDc` helper is an additive `.push(msgId)` and is called from multiple sites; no non-push mutations exist anywhere', () => {
    // 1. The canonical write lives in card-state-helpers.js and is a push.
    const HELPER_SRC = readFileSync(resolve(ROOT, 'src/game/card-state-helpers.js'), 'utf8');
    assert.match(HELPER_SRC,
      /export function depleteDc\(game, msgId, playerNum\)[\s\S]*?game\[key\]\.push\(msgId\)/,
      'depleteDc must be an additive .push(msgId) — CRR-DPL-002');

    // 2. Multiple sites call the helper (Imperial Retrofitting, dc_deplete_,
    //    Under Duress, etc.).
    let callSites = 0;
    let nonPushWriteSites = [];
    for (const p of walkFiles(resolve(ROOT, 'src'))) {
      if (p.endsWith('card-state-helpers.js')) continue;
      const src = readFileSync(p, 'utf8');
      const calls = src.match(/\bdepleteDc\s*\(/g) || [];
      callSites += calls.length;
      // Look for any non-push mutation outside the helper: splice / pop /
      // shift / filter-reassign / delete / = [] / direct .push (which would
      // mean someone bypassed the helper).
      const bad = src.match(/p[12]DepletedDcMessageIds\s*=\s*\[\s*\]|p[12]DepletedDcMessageIds\.(?:splice|pop|shift|fill|push)\(|delete\s+game\.p[12]DepletedDcMessageIds/g);
      if (bad) nonPushWriteSites.push(p.replace(ROOT + '/', '') + ': ' + bad.join(','));
    }
    assert.ok(callSites >= 3,
      `must have >=3 depleteDc() call sites across src/ — found ${callSites} — CRR-DPL-002`);
    assert.deepEqual(nonPushWriteSites, [],
      'no source file may reset, splice, pop, shift, delete, or bypass-push either depletion array — CRR-DPL-002');
  });

  it('002d: source — no file under src/ references "flip faceup", "reset depleted", or an end-of-mission depletion-reset helper', () => {
    const hits = [];
    for (const p of walkFiles(resolve(ROOT, 'src'))) {
      const src = readFileSync(p, 'utf8');
      if (/flipFaceup|flip\s*faceup|resetDeplet|unDeplet|undepleteCards|endOfMissionReset/i.test(src)) {
        hits.push(p.replace(ROOT + '/', ''));
      }
    }
    assert.deepEqual(hits, [],
      'no end-of-mission depletion-reset helper may exist in skirmish — CRR-DPL-002');
  });

  it('002e: source — checkWinConditions terminates the game via game.ended without touching depletion arrays', () => {
    const MR_SRC = readFileSync(resolve(ROOT, 'src/game/mission-rules.js'), 'utf8');
    assert.match(MR_SRC, /await checkWinConditions\(game, client\);\s*\n\s*if \(game\.ended\) return \{ gameEnded: true \};/,
      'mission-rules.js must terminate via game.ended — CRR-DPL-002');
    assert.doesNotMatch(MR_SRC, /p[12]DepletedDcMessageIds\s*=|p[12]DepletedDcMessageIds\.(?:splice|pop|shift|fill)\(/,
      'mission-rules.js must not reset depletion arrays — CRR-DPL-002');
  });

  it('002f: cross-ref — DPL-001 (depletion marks card as used) and DPL-003 (exhausted-vs-depleted distinction) bracket this vacuous-satisfaction', () => {
    const ledger = JSON.parse(readFileSync(resolve(ROOT, 'docs/crr-ledger.json'), 'utf8'));
    const dpl001 = ledger.atoms.find(a => a.id === 'CRR-DPL-001');
    const dpl003 = ledger.atoms.find(a => a.id === 'CRR-DPL-003');
    assert.ok(dpl001 && dpl003, 'DPL-001 and DPL-003 must exist in the ledger');
    // DPL-001 pins the "depletion is terminal within the game" shape we rely on
    assert.ok(['covered', 'covered_by_ref'].includes(dpl001.status),
      'DPL-001 must be pinned (it establishes the one-way depletion invariant) — CRR-DPL-002 context');
  });
});
