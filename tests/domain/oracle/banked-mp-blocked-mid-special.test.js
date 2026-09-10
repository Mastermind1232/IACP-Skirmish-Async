/**
 * Banked MP cannot be spent between the steps of a special action.
 *
 * alexanbv 2026-09-10: "Spending banked Mp should not be permitted between
 * steps of any special action (for example, the three attacks of missile
 * salvo). MP gained as part of the special action must be spent immediately.
 * Banked mp are available once the special action fully resolves."
 *
 * Only BANKED spending is blocked. MP granted BY the special still flows
 * through its own immediate path, and the bank reopens once the special
 * finishes — the gate asks "is one in progress", nothing more.
 *
 * The multi-step specials each track progress under a different key and there
 * is no shared "in progress" concept, so the predicate lives in ONE module.
 * That is deliberate: this codebase keeps growing two or three copies of the
 * same predicate which then drift (the free-attack lists, the O/0 droid fold,
 * Squad Cohesion's attacker-only rule — all found in this sweep).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { midSpecialAction, MID_SPECIAL_ACTION_KEYS } from '../../../src/game/mid-special-action.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');

describe('the predicate', () => {
  test('Missile Salvo is detected by msgId, since it spans shots', () => {
    const g = { pendingMissileSalvo: { m1: { diceAvailable: ['blue'] } } };
    assert.equal(midSpecialAction(g, 'm1', null), 'Missile Salvo');
    assert.equal(midSpecialAction(g, 'other', null), null, 'a different group is unaffected');
  });

  test('the counted multi-attack specials are detected per figure', () => {
    for (const [key, label] of [['focusFireActive', 'Focus Fire'],
                                ['multiFireActive', 'Multi-Fire'],
                                ['overheatedActive', 'Overheated']]) {
      const g = { [key]: { 'A-1-0': { attacksRemaining: 2 } } };
      assert.equal(midSpecialAction(g, 'm', 'A-1-0'), label);
      assert.equal(midSpecialAction(g, 'm', 'B-1-0'), null, `${label} is per figure`);
    }
  });

  test('a special with ZERO attacks left is finished, not in progress', () => {
    // The bank must reopen the moment it resolves, not at end of activation.
    const g = { focusFireActive: { 'A-1-0': { attacksRemaining: 0 } } };
    assert.equal(midSpecialAction(g, 'm', 'A-1-0'), null);
  });

  test('the bare counters work the same way', () => {
    assert.equal(midSpecialAction({ saberOrbitAttacksRemaining: { 'A-1-0': 3 } }, 'm', 'A-1-0'), 'Saber Orbit');
    assert.equal(midSpecialAction({ pummelAttacksRemaining: { 'A-1-0': 1 } }, 'm', 'A-1-0'), 'Pummel');
    assert.equal(midSpecialAction({ saberOrbitAttacksRemaining: { 'A-1-0': 0 } }, 'm', 'A-1-0'), null);
  });

  test('it never throws on missing state', () => {
    assert.equal(midSpecialAction(null, 'm', 'A-1-0'), null);
    assert.equal(midSpecialAction({}, null, null), null);
    assert.equal(midSpecialAction({}, 'm', 'A-1-0'), null);
  });

  test('round and per-attack modifiers are deliberately NOT in scope', () => {
    // arcingShotActive, surgeDoublingActive and friends are modifiers, not
    // special actions mid-resolution. Including them would block MP spending
    // for most of a round.
    for (const k of ['arcingShotActive', 'surgeDoublingActive', 'deadlyPrecisionActive', 'mobileMovementActive']) {
      assert.ok(!MID_SPECIAL_ACTION_KEYS.includes(k), `${k} must not be treated as a special action`);
      assert.equal(midSpecialAction({ [k]: { 'A-1-0': { attacksRemaining: 9 } } }, 'm', 'A-1-0'), null);
    }
  });
});

describe('the gate is wired into the SpendMp path only', () => {
  const src = readFileSync(resolve(root, 'src/handlers/dc-play-area.js'), 'utf8');

  test('handleDcAction imports and calls the shared predicate', () => {
    assert.match(src, /import \{ midSpecialAction \} from '\.\.\/game\/mid-special-action\.js';/);
    assert.match(src, /const _msaName = midSpecialAction\(game, msgId, _msaFk\);/);
  });

  test('it fires for SpendMp and NOT for Move', () => {
    // Move during a special is a separate question and was not ruled on.
    const branch = src.slice(src.indexOf("const isSpendMp = action === 'SpendMp';"));
    const guard = branch.slice(0, branch.indexOf('partingShotTriggered'));
    assert.match(guard, /if \(isSpendMp\) \{/);
    assert.match(guard, /banked movement points cannot be spent between its steps/);
  });

  test('the refusal names the special that is blocking', () => {
    assert.match(src, /\*\*\$\{_msaName\}\*\* is still resolving/);
  });

  test('the GATE asks the helper rather than inlining the state checks', () => {
    // Other sites legitimately READ the salvo state (targetsFired, for target
    // exclusion; cleanup on activation end). What must not exist is a second
    // copy of the "is a special mid-resolution" PREDICATE, which is how these
    // drift apart. So the assertion is scoped to the gate itself.
    const branch = src.slice(src.indexOf("const isSpendMp = action === 'SpendMp';"));
    const guard = branch.slice(0, branch.indexOf('partingShotTriggered'));
    assert.ok(!/pendingMissileSalvo|focusFireActive|multiFireActive|saberOrbitAttacksRemaining/.test(guard),
      'the gate must not name individual special-action states');
    assert.match(guard, /midSpecialAction\(/);
  });
});
