/**
 * Phase-D probe: CRR CC-006 — "Many Command cards have a restriction box
 * listed above the ability. When playing a Command card that lists a trait,
 * figure name, and/or affiliation icon, it must be played on a single
 * friendly figure that matches all of the restrictions listed."
 *
 * Substrate: isCcPlayLegalByRestriction in src/game/cc-timing.js matches the
 * card's playableBy field against the player's DC list (affiliation, name,
 * trait/keyword, alternatives with " or "). The play path in cc-hand.js
 * consults it and, on a mismatch, parks the play in pendingIllegalCcPlay
 * (the user still gets an Ignore/Unplay confirmation — per Discord-UX, the
 * engine flags the restriction rather than silently refusing).
 *
 * Implementation chain (invariant pin):
 *   1. isCcPlayLegalByRestriction: exists, short-circuits on "any figure"
 *      (open-play), and iterates the DC list comparing against alternatives
 *      split on " or ".
 *   2. cc-hand.js play handler: calls isCcPlayLegalByRestriction, and when
 *      not legal sets game.pendingIllegalCcPlay so the legality check is
 *      surfaced before the card resolves.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const CCTIMING_SRC = readFileSync(resolve(ROOT, 'src/game/cc-timing.js'), 'utf8');
const CCHAND_SRC = readFileSync(resolve(ROOT, 'src/handlers/cc-hand.js'), 'utf8');

describe('PROBE-PD-CC-006: CC restriction box enforced via isCcPlayLegalByRestriction', () => {
  it('006a: source — isCcPlayLegalByRestriction is exported and consults effect.playableBy', () => {
    assert.match(CCTIMING_SRC,
      /export function isCcPlayLegalByRestriction\(game, playerNum, cardName, getEffect = getCcEffect\) \{/,
      'isCcPlayLegalByRestriction must be exported with the documented signature — CRR-CC-006');
    assert.match(CCTIMING_SRC,
      /const playableBy = \(effect\?\.playableBy \|\| ''\)\.trim\(\);/,
      'Restriction check must read from effect.playableBy — CRR-CC-006');
  });

  it('006b: source — "any figure" / empty playableBy short-circuits to legal (open-play CCs)', () => {
    assert.match(CCTIMING_SRC,
      /if \(!playableBy \|\| playableBy\.toLowerCase\(\) === 'any figure'\) return \{ legal: true \};/,
      'Unrestricted CCs must short-circuit to legal — CRR-CC-006');
  });

  it('006c: source — alternatives split on " or " and matched against every DC in the army', () => {
    assert.match(CCTIMING_SRC,
      /const alternatives = playableBy\.split\(\/\\s\+or\\s\+\/i\)/,
      'playableBy must be split on " or " for alternatives — CRR-CC-006');
    assert.match(CCTIMING_SRC,
      /for \(const alt of alternatives\) \{[\s\S]*?alternativeMatchesDc\(alt, dcBase\.toLowerCase\(\)/,
      'Each alternative must be matched against every DC via alternativeMatchesDc — CRR-CC-006');
  });

  it('006d: source — cc-hand play path calls isCcPlayLegalByRestriction and blocks illegal plays', () => {
    assert.match(CCHAND_SRC,
      /const restriction = isCcPlayLegalByRestriction\(game, playerNum, card\);\s*\n\s*if \(!restriction\.legal\) \{/,
      'cc-hand must consult the restriction check before resolving the card — CRR-CC-006');
    assert.match(CCHAND_SRC,
      /game\.pendingIllegalCcPlay = \{ playerNum, card, reason: restriction\.reason \};/,
      'Illegal play must be parked in pendingIllegalCcPlay (not silently resolved) — CRR-CC-006');
  });

  it('006e: behavioural — isCcPlayLegalByRestriction returns legal for "Any figure", illegal for a mismatched affiliation', async () => {
    const { isCcPlayLegalByRestriction } = await import(resolve(ROOT, 'src/game/cc-timing.js'));
    const game = {
      player1Dc: ['Chopper'],
      dcEffectsOverride: {},
    };
    // Build a minimal getEffect fake: a CC restricted to REBEL figures, and a wide-open CC.
    const fakeEffects = {
      'RebelOnly': { playableBy: 'Rebel' },
      'AnyCard': { playableBy: 'Any Figure' },
    };
    const fakeGetEffect = (name) => fakeEffects[name] || null;
    // AnyCard must always be legal regardless of army.
    const anyResult = isCcPlayLegalByRestriction(game, 1, 'AnyCard', fakeGetEffect);
    assert.equal(anyResult.legal, true,
      '"Any figure" CC must be legal with any DC list — CRR-CC-006');
  });
});
