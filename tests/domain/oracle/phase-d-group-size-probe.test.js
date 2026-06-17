/**
 * Phase-D probe: group size drives starting figure count.
 *
 * PROBE-PD-GRP-002: Each Deployment card's 'figures' count (the "bars"
 *   on the card) is the starting group size — that many figures are
 *   placed when deploying this group. (CRR GROUPS)
 *
 * Implementation: `stats.figures` from dc-effects.json is the canonical
 *   BASE group-size field. Every init-figures path reads it as
 *   `const figureCount = stats?.figures ?? 1;` and loops
 *   `for (let f = 0; f < figureCount; f++)` to create one health slot
 *   (and later one figure slot) per figure. Applies at headless game
 *   init (3 sites in init-dc-state.js).
 *
 * Squad Upgrade note (alexanbv 2026-06-17): a Squad Upgrade adds ONE extra
 *   figure ABOVE the base count, so the base `stats.figures` is no longer the
 *   whole story — the effective count is base+SU (effectiveFigureCount). Init
 *   still places the base figures; the SU figure's health box is added at attach
 *   and it's placed via the deploy components. `isGroupDefeated` (game-readers.js)
 *   therefore detects defeat by figure-position PREFIX (which naturally counts
 *   the SU figure), not by looping to a fixed base count.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDcEffects } from '../../../src/data-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const INIT_SRC = readFileSync(resolve(ROOT, 'src/headless/init-dc-state.js'), 'utf8');
const GAME_READERS_SRC = readFileSync(resolve(ROOT, 'src/engine/game-readers.js'), 'utf8');

describe('PROBE-PD-GRP-002: group size (stats.figures) drives starting figure count', () => {
  it('002a: source — init-dc-state.js reads figureCount from stats.figures (default 1)', () => {
    // Three independent init paths all use the same idiom.
    const pat = /const figureCount = stats\?\.figures \?\? 1;/g;
    const matches = INIT_SRC.match(pat) || [];
    assert.ok(matches.length >= 3,
      `init-dc-state.js must read stats.figures at each init site — matched ${matches.length} — CRR-GRP-002`);
  });

  it('002b: source — init-dc-state.js loops figureCount times to create one slot per figure', () => {
    const pat = /for \(let f = 0; f < figureCount; f\+\+\)/g;
    const matches = INIT_SRC.match(pat) || [];
    assert.ok(matches.length >= 3,
      `init-dc-state.js must iterate per figure — matched ${matches.length} — CRR-GRP-002`);
  });

  it('002c: source — game-readers.js detects group-defeat by figure-position prefix (SU-aware)', () => {
    // isGroupDefeated now iterates figure positions by `${dcName}-${dgIndex}-`
    // prefix so a Squad Upgrade figure (index = base count) keeps the group alive
    // while it survives — rather than looping to a fixed base figure count.
    assert.match(GAME_READERS_SRC, /const prefix = `\$\{dcName\}-\$\{dgIndex\}-`;/,
      'isGroupDefeated must detect defeat by figure prefix (counts the SU figure) — CRR-GRP-002');
    assert.match(GAME_READERS_SRC, /if \(k\.startsWith\(prefix\)\) return false;/,
      'any figure with the group prefix on the board → not defeated — CRR-GRP-002');
  });

  it('002d: data — multi-figure groups carry figures >= 2 in dc-effects.json', () => {
    const effects = getDcEffects();
    const multi = Object.keys(effects).filter((n) =>
      typeof effects[n]?.figures === 'number' && effects[n].figures >= 2
    );
    assert.ok(multi.length >= 1,
      `at least one multi-figure DC must exist — got ${multi.length} — CRR-GRP-002`);
  });

  it('002e: data — single-figure groups omit or set figures to 1 (default branch applies)', () => {
    const effects = getDcEffects();
    const singles = Object.keys(effects).filter((n) => {
      const f = effects[n]?.figures;
      return (f === undefined || f === 1) && typeof effects[n]?.cost === 'number';
    });
    assert.ok(singles.length >= 1,
      `at least one single-figure DC must exist — got ${singles.length} — CRR-GRP-002`);
  });

  it('002f: source — no branch overrides figureCount after the default-read (figures is authoritative)', () => {
    // Negative invariant: figureCount is never reassigned after the stats.figures read.
    const reassign = /\bfigureCount\s*=\s*[^=;]/g;
    for (const src of [INIT_SRC, GAME_READERS_SRC]) {
      const matches = [...src.matchAll(reassign)];
      for (const m of matches) {
        const ctx = src.slice(Math.max(0, m.index - 20), m.index + 50);
        assert.match(ctx, /const figureCount/,
          `figureCount must not be mutated after the stats.figures read — CRR-GRP-002`);
      }
    }
  });
});
