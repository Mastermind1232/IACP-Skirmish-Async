import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// Load the FULL gate graph in the SAME order production does (combat-mods-gate.js
// imports the executable ability files AND the timing-only catalog/CSV). This is
// the only place the load-order clobber surfaces — the per-file tests import a
// single ability module in isolation, so they never see the catalog clobber.
import './combat-mods-gate.js';
import { getCombatAbility } from './combat-timing-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('combat-mods-gate load order — executable abilities are NOT clobbered by the catalog', () => {
  // Regression for alexanbv 2026-06-25: guidance_systems / illicit_arms /
  // zillo_technique_discard were registered EXECUTABLE in combat-abilities-mods.js
  // but ALSO had a timing-only catalog entry. The catalog is imported AFTER
  // combat-abilities-mods.js, so its entry was the last-write and clobbered the
  // executable one back to timing-only — silently dropping the button from the
  // mods window in live play.
  for (const id of ['guidance_systems', 'illicit_arms', 'zillo_technique_discard']) {
    it(`${id} stays EXECUTABLE in the full load (not clobbered to timing-only)`, () => {
      const a = getCombatAbility(id);
      assert.ok(a, `${id} missing from registry`);
      assert.equal(a.timingOnly, false, `${id} was clobbered back to timing-only — a stale catalog/CSV entry must be removed`);
      assert.equal(typeof a.applies, 'function', `${id} has no applies() — executable entry lost`);
    });
  }

  it('NO ability registered executable in combat-abilities-mods.js ends up timing-only after the full load', () => {
    const src = readFileSync(join(__dirname, 'combat-abilities-mods.js'), 'utf8');
    const ids = [...new Set([...src.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]))];
    const clobbered = ids.filter((id) => getCombatAbility(id)?.timingOnly);
    assert.deepEqual(clobbered, [], `executable mods abilities clobbered to timing-only by a later import: ${clobbered.join(', ')}`);
  });
});
