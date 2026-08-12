/**
 * End-of-activation Command Cards must have the activation held open for them.
 *
 * alexanbv 2026-08-12: end of activation and after activation resolves are two
 * different windows, and the first one happens while the activation still
 * stands. Both cards that live there are immediate spends and need it:
 *
 *   "if mp chosen from diplo it would be treated as an immediate spend at that
 *    moment ... Force Surge is move spaces, so it is also immediate spend"
 *
 * Force Surge is deliberately NOT a descriptor of its own (see
 * eoa-orchestrator.js: that would nag the player every activation). Instead a
 * placeholder descriptor is enumerated only for a player who actually holds a
 * playable endOfActivation card, purely to keep the activation alive while they
 * decide.
 *
 * This also guards a regression: commit 4e11213c removed 'endOfActivation' from
 * the after-resolves prompt, correctly, but left these cards with no prompt
 * anywhere at all until the placeholder was added.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../../${rel}`, import.meta.url).pathname, 'utf8');

describe('end-of-activation Command Card window', () => {
  const activation = read('src/handlers/activation.js');
  const handler = read('src/handlers/eoa-handler.js');

  test('the window is opened for a player holding a playable endOfActivation card', () => {
    assert.match(activation, /getPlayableReactionCardsForTiming\(game, _ccPn, \['endOfActivation'\]\)/,
      'must ask whether the player actually holds one');
    assert.match(activation, /subPromptKey: 'eoa_cc_window'/,
      'must enumerate the placeholder descriptor that holds the activation open');
  });

  test('it is gated on holding a card, so it cannot nag every activation', () => {
    // The 2026-06-18 decision was that Force Surge must not force a prompt at
    // every end of activation. `continue` when the player holds nothing is what
    // keeps that true.
    const idx = activation.indexOf("['endOfActivation']");
    const window = activation.slice(idx, idx + 260);
    assert.match(window, /if \(!_eoaCards\.length\) continue;/,
      'no playable card means no descriptor and no prompt');
  });

  test('both players are considered, initiative first', () => {
    const idx = activation.indexOf("['endOfActivation']");
    const before = activation.slice(Math.max(0, idx - 400), idx);
    assert.match(before, /getInitiativePlayerNum\(game\)/,
      'initiative player leads');
    assert.match(before, /opponentPlayerNum\(/,
      'the opponent is offered the window too');
  });

  test('the handler resolves the placeholder instead of erroring on it', () => {
    // An unhandled subPromptKey falls through to "Unknown EoA sub-prompt" and
    // would strand the activation open, since the descriptor never gets
    // consumed.
    const picks = handler.split("desc.subPromptKey === 'eoa_cc_window'");
    assert.strictEqual(picks.length, 3,
      'expected a branch in BOTH handleEoaPick and handleEoaFire');
  });

  test("'endOfActivation' is not offered in the after-resolves window", () => {
    // That window runs after teardown. Offering an immediate-spend card there
    // is the original bug.
    const idx = activation.indexOf('AFTER-ACTIVATION-RESOLVES window');
    assert.ok(idx > 0, 'window-2 block found');
    // Strip comments first: that block explains in prose why endOfActivation is
    // absent, so a bare substring check matches the explanation, not the code.
    const code = activation.slice(idx, idx + 2600)
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!code.includes("'endOfActivation'"),
      'window 2 must not offer end-of-activation cards');
  });
});

describe('Clan of Two placement lives in the EoA window', () => {
  const orchestrator = read('src/game/eoa-orchestrator.js');
  const handler = read('src/handlers/eoa-handler.js');
  const activation = read('src/handlers/activation.js');

  test('the placement is an EoA descriptor', () => {
    // alexanbv 2026-08-12: a companion activating second "resolves INSIDE the
    // figure's EOA window", and the two legal orderings ("teleport child,
    // activate child" / "activate child, teleport child") are only expressible
    // if the placement can be ordered against the companion's activation.
    assert.match(orchestrator, /subPromptKey: 'clan_of_two_teleport'/,
      'must be enumerated as a descriptor');
    assert.match(handler, /desc\.subPromptKey === 'clan_of_two_teleport'/,
      'and resolved by the EoA handler');
  });

  test('it no longer posts from the teardown continuation', () => {
    // That is window 2, after the activation is dismantled, where the ordering
    // cannot be expressed at all.
    const idx = activation.indexOf('export async function finishDcEndActivation');
    assert.ok(idx > 0);
    const code = activation.slice(idx).split('\n')
      .filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!code.includes('clan_of_two_teleport_'),
      'the button row must not be posted after teardown');
  });

  test('picking it consumes the descriptor, so the window cannot strand', () => {
    // The teleport resolves on its own customId via handleClanOfTwoTeleport,
    // which knows nothing about EoA bookkeeping. If the descriptor waited on
    // that, a player who never clicked a destination would leave the activation
    // open forever.
    const idx = handler.indexOf("desc.subPromptKey === 'clan_of_two_teleport'");
    const branch = handler.slice(idx, idx + 2200);
    assert.match(branch, /consumeDescriptor\(game, desc\.id\)/,
      'must consume on pick');
    assert.match(branch, /postChooserOrComplete\(/,
      'and advance the chooser so the bucket can close');
  });
});
