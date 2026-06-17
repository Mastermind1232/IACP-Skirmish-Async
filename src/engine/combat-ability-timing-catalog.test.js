import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// Both registration sources: the executable mods abilities + the full catalog.
import './combat-abilities-mods.js';
import './combat-ability-timing-catalog.js';
import { TIMING_WINDOWS, timingIndicatorsForWindow, allCombatAbilities } from './combat-timing-registry.js';

const idsFor = (w) => timingIndicatorsForWindow(w).map((a) => a.id);
const has = (w, id) => idsFor(w).includes(id);

describe('combat timing catalog: every window has a complete set of timing indicators', () => {
  it('all timing windows are populated', () => {
    for (const w of TIMING_WINDOWS) {
      assert.ok(timingIndicatorsForWindow(w).length > 0, `window '${w}' has no abilities`);
    }
  });

  it('every registered ability carries window + side + kind (a timing indicator)', () => {
    for (const a of allCombatAbilities()) {
      assert.ok(a.windows.length > 0, `${a.id} has no window`);
      assert.ok(['attacker', 'defender', 'either'].includes(a.side), `${a.id} bad side`);
    }
  });

  it('on_declare covers the headline declaration abilities', () => {
    // NOTE: result-modifier abilities mis-catalogued under on_declare (cunning,
    // find_weakness, scattergun, forest_fighters, take_cover, etc.) are being
    // graduated to executable mods-window passives (combat-abilities-mods.js)
    // and removed from this catalog — see gate-mods-timing-move.test.js.
    for (const id of ['focus_condition', 'merciless', 'on_the_lam', 'brace_for_impact', 'get_behind_me']) {
      assert.ok(has('on_declare', id), `on_declare missing ${id}`);
    }
  });

  it('rerolls covers the headline reroll abilities', () => {
    for (const id of ['targeting_computer', 'foresight', 'resourceful', 'there_is_no_try', 'cross_training_reroll']) {
      assert.ok(has('rerolls', id), `rerolls missing ${id}`);
    }
  });

  it('special covers the after-ALL-rerolls die-turn (Zeb only)', () => {
    const sp = timingIndicatorsForWindow('special');
    const subs = new Set(sp.map((a) => a.special));
    assert.ok(subs.has('zeb'), 'missing zeb');
    // Rapid Recalibration is NOT here — it fires at the end of the attacker
    // reroll stage, not after ALL rerolls (alexanbv 2026-06-16 correction).
    assert.ok(!subs.has('rapid_recal'), 'rapid_recal must not be in special');
  });

  it('rerolls covers Rapid Recalibration (last thing in the attacker reroll stage)', () => {
    const rr = timingIndicatorsForWindow('rerolls');
    const subs = new Set(rr.map((a) => a.special));
    assert.ok(subs.has('rapid_recal'), 'rerolls missing rapid_recal sub-window');
  });

  it('zillo window covers the Zillo Technique pierce-cancel (its own step after spend_surges)', () => {
    assert.ok(has('zillo', 'zillo_technique_pierce_cancel'), 'zillo window missing zillo_technique_pierce_cancel');
  });

  it('after_resolve covers Cleave/Blast/conditions + chain attacks + defeat triggers', () => {
    for (const id of ['cleave', 'blast', 'surge_condition', 'return_fire', 'flurry_of_blows', 'final_stand', 'debts_repaid']) {
      assert.ok(has('after_resolve', id), `after_resolve missing ${id}`);
    }
  });

  it('mods: the executable abilities stay executable (not overwritten by catalog timing-only)', () => {
    const mods = timingIndicatorsForWindow('mods');
    const sprayFire = mods.find((a) => a.id === 'spray_fire');
    assert.ok(sprayFire && sprayFire.timingOnly === false, 'spray_fire should be executable (has applies)');
    // and the previously-missing CC mods are now catalogued (timing-only)
    for (const id of ['guidance_systems', 'illicit_arms', 'zillo_technique_discard', 'parry', 'distracting']) {
      assert.ok(mods.find((a) => a.id === id), `mods catalog missing ${id}`);
    }
  });
});
