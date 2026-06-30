/**
 * CC discard/play-reveal audit (alexanbv 2026-06-26) — clear wins:
 *   PART A — every async CC discard routes through the central discardCc helper
 *     so it reveals the card name publicly AND fires when-discarded passives:
 *       • Wanton Destruction (cost discard, combat-special-effects.js)
 *       • Rule by Fear        (Upgrade discard, round.js)
 *   PART B — every CC play reveals publicly. The 4 play paths that previously
 *     did NOT reveal now emit the `<@pid> played command card **X**.` line:
 *       • Defeat-triggered CC   (defeat-cc-prompts.js)
 *       • After-attack gate CC  (after-attack-fire.js)
 *       • Tough Luck            (combat.js)
 *       • Celebration           (cc-hand.js)
 *
 * These are static source-content assertions (an established pattern in this
 * suite) — the heavy handlers take a Discord interaction, so we verify the
 * wiring at the source rather than reconstruct full interaction mocks. The
 * discardCc behavioural contract itself is covered in cc-reveal-ruling.test.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discardCc } from '../../../src/handlers/cc-hand.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const ccHandKey = (pn) => (pn === 1 ? 'player1CcHand' : 'player2CcHand');
const ccDiscardKey = (pn) => (pn === 1 ? 'player1CcDiscard' : 'player2CcDiscard');

describe('PART A — async discards route through discardCc', () => {
  const wantonSrc = read('src/handlers/combat-special-effects.js');
  const rbfSrc = read('src/handlers/round.js');

  it('Wanton Destruction (handleWantonCcPick) calls discardCc, not a manual splice/push', () => {
    const m = wantonSrc.match(/export async function handleWantonCcPick[\s\S]*?\n}\n/);
    assert.ok(m, 'handleWantonCcPick found');
    const body = m[0];
    assert.match(body, /discardCc\(game, wd\.ownerPlayerNum, cardName/, 'routes through discardCc');
    assert.doesNotMatch(body, /game\[dKey\] = /, 'no manual discard-pile push remains');
    assert.doesNotMatch(body, /Discarded \*\*\$\{cardName\}\*\*/, 'redundant raw discard log removed');
  });

  it('Rule by Fear (handleRbfDiscard) calls discardCc, not a manual splice + count-only log', () => {
    const m = rbfSrc.match(/export async function handleRbfDiscard[\s\S]*?\n}\n/);
    assert.ok(m, 'handleRbfDiscard found');
    const body = m[0];
    assert.match(body, /discardCc\(game, playerNum, card/, 'routes through discardCc');
    assert.doesNotMatch(body, /logGameAction\([^)]*discarded 1 CC/, 'count-only log emission removed');
    assert.doesNotMatch(body, /game\[discKey\]\.push/, 'no manual discard-pile push remains');
  });

  it('discardCc still reveals + fires when-discarded passives (Windfall self-VP)', async () => {
    const game = { [ccHandKey(1)]: ['Windfall'], [ccDiscardKey(1)]: [], player1VP: { total: 0, kills: 0, objectives: 0 } };
    const logged = [];
    const res = await discardCc(game, 1, 'Windfall', { client: null, logGameAction: async (_g, _c, m) => logged.push(m) });
    assert.equal(res.moved, true);
    assert.equal(res.windfallSelfVp, 1, 'Windfall when-discarded hook fired');
    assert.ok(logged.some((m) => /Windfall/.test(m) && /revealed/i.test(m)), 'discard revealed publicly');
  });
});

describe('PART B — the 4 retrofitted play paths emit a public play-reveal', () => {
  const REVEAL = /played command card \*\*/;

  it('Defeat-triggered CC (defeat-cc-prompts.js) reveals via the centralized poc factory', () => {
    const src = read('src/handlers/defeat-cc-prompts.js');
    // Reveal now emitted by makeCcPromptOpponentCancel in cc-pipeline.js, not inline.
    assert.match(src, /makeCcPromptOpponentCancel/, 'imports and uses centralized poc factory');
  });

  it('After-attack gate CC (after-attack-fire.js) reveals via the centralized poc factory', () => {
    const src = read('src/handlers/after-attack-fire.js');
    // Reveal now emitted by makeCcPromptOpponentCancel in cc-pipeline.js, not inline.
    assert.match(src, /makeCcPromptOpponentCancel/, 'imports and uses centralized poc factory');
  });

  it('Tough Luck (combat.js) reveals via the centralized poc factory', () => {
    const src = read('src/handlers/combat.js');
    // Reveal now emitted by makeCcPromptOpponentCancel in cc-pipeline.js, not inline.
    assert.match(src, /makeCcPromptOpponentCancel/, 'imports and uses centralized poc factory');
  });

  it('Centralized poc factory (cc-pipeline.js) emits the public play-reveal for all routed paths', () => {
    const src = read('src/handlers/cc-pipeline.js');
    assert.match(src, /played command card \*\*\$\{cardName\}\*\*/, 'reveal line present in centralized factory');
  });

  it('Celebration (cc-hand.js) reveals via the centralized poc factory', () => {
    const src = read('src/handlers/cc-hand.js');
    // Reveal now emitted by makeCcPromptOpponentCancel in cc-pipeline.js, not inline.
    assert.match(src, /makeCcPromptOpponentCancel/, 'imports and uses centralized poc factory');
  });
});
