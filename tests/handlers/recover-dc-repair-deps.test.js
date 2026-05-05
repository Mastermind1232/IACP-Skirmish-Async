/**
 * Regression: deps required by recoverMissingDcCards's companion path
 * must be reachable from the recover ctx group.
 *
 * 2026-05-04 incident: the /resync DC-repair shipped without
 * createCompanionDcEmbed in the recover group. recoverMissingDcCards
 * called renderDcCompanion which delegates the actual post to
 * ctx.createCompanionDcEmbed; the missing dep caused a console.warn +
 * silent skip. Destruct's The Child companion never re-appeared after
 * /resync. Hardened renderDcCompanion to THROW on missing dep so a
 * future drift fails loudly; this test pins the dep wiring at the
 * group level so the production path can't silently regress either.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXT_GROUPS } from '../../src/context-factory.js';

describe('recover ctx group — DC-repair companion path deps', () => {
  it('recover group declares createCompanionDcEmbed', () => {
    const recoverDeps = CONTEXT_GROUPS.recover || [];
    assert.ok(
      recoverDeps.includes('createCompanionDcEmbed'),
      'recover group must list createCompanionDcEmbed — recoverMissingDcCards needs it for The Child / Junk Droid / etc. Without it, renderDcCompanion throws and companion embeds never re-appear during /resync repair',
    );
  });

  it('recover group has every dep that recoverMissingDcCards uses', () => {
    // Mirrors the destructuring inside recoverMissingDcCards. Any dep
    // it pulls from `deps` must come through ctx → ctx-group declaration.
    // (Note: checkpoint.js takes a different path — direct imports of
    // renderDcCompanion + helpers — so we don't compare to its group.)
    const recoverDeps = new Set(CONTEXT_GROUPS.recover || []);
    const required = [
      'buildDcEmbedAndFiles',
      'getDcPlayAreaComponents',
      'getNicknamesForDcMessage',
      'dcMessageMeta',
      'dcExhaustedState',
      'dcHealthState',
      'updateAttachmentMessageForDc',
      'renderDcCompanion',
      'createCompanionDcEmbed',
      'listCheckpointsForGame',
      'getCheckpointById',
    ];
    for (const dep of required) {
      assert.ok(
        recoverDeps.has(dep),
        `recover group missing ${dep} — Phase 1.5 DC repair will silently skip whichever surface depends on it`,
      );
    }
  });
});
