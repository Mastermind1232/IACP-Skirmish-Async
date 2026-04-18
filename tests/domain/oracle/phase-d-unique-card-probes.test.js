/**
 * Phase-D probes: unique Deployment Card invariants.
 *
 * PROBE-PD-UNI-001: Each player can only use one copy of each unique card
 *   at a time. (CRR UNIQUE CARDS)
 * PROBE-PD-UNI-002: Unique cards are identified by name only. Sub-names,
 *   affiliations, and abilities are not taken into account. (CRR UNIQUE CARDS)
 *
 * Implementation: src/game/validation.js `validateDeckLegal` tallies
 *   `dcNameCounts[name]` purely on the canonical DC name, and rejects any
 *   `stats.unique && dcNameCounts[name] > 1` squad. The per-card `unique`
 *   flag comes from dc-effects.json (name-keyed) — no sub-name / ability
 *   dimension enters the comparison.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDeckLegal } from '../../../src/game/validation.js';
import { getDcEffects } from '../../../src/data-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const V_SRC = readFileSync(resolve(__dirname, '../../../src/game/validation.js'), 'utf8');

describe('PROBE-PD-UNI-001: unique DC cannot appear more than once in a squad', () => {
  it('001a: source — validateDeckLegal rejects dcNameCounts[name] > 1 for unique cards', () => {
    assert.match(V_SRC, /if \(stats\.unique && dcNameCounts\[name\] > 1\)/,
      'validateDeckLegal must guard on unique + count>1 — CRR-UNI-001');
    assert.match(V_SRC, /is a Unique deployment card and cannot be included more than once/,
      'validateDeckLegal must emit a unique-duplicate error — CRR-UNI-001');
  });

  it('001b: behavior — duplicating a real unique DC yields the unique-duplicate error', () => {
    const effects = getDcEffects();
    const uniqueName = Object.keys(effects).find((n) =>
      effects[n]?.unique && typeof effects[n]?.cost === 'number' && !n.startsWith('[')
    );
    assert.ok(uniqueName, 'at least one named unique figure DC must exist — CRR-UNI-001');
    const { errors } = validateDeckLegal({
      dcList: [{ dcName: uniqueName }, { dcName: uniqueName }],
      ccList: [],
    });
    const uniqueErr = errors.find((e) => e.includes(uniqueName) && /Unique/.test(e));
    assert.ok(uniqueErr,
      `duplicating unique "${uniqueName}" must produce a unique-duplicate error; got: ${JSON.stringify(errors)} — CRR-UNI-001`);
  });

  it('001c: behavior — a single copy of the same unique DC does NOT produce a unique-duplicate error', () => {
    const effects = getDcEffects();
    const uniqueName = Object.keys(effects).find((n) =>
      effects[n]?.unique && typeof effects[n]?.cost === 'number' && !n.startsWith('[')
    );
    const { errors } = validateDeckLegal({
      dcList: [{ dcName: uniqueName }],
      ccList: [],
    });
    const uniqueErr = errors.find((e) => /Unique deployment card/.test(e));
    assert.ok(!uniqueErr,
      `single copy must not trigger unique-duplicate error; got: ${JSON.stringify(errors)} — CRR-UNI-001`);
  });
});

describe('PROBE-PD-UNI-002: unique identity is name-keyed only (no sub-name or ability dimension)', () => {
  it('002a: source — dcNameCounts is keyed by the resolved dc name (no affiliation/ability suffix)', () => {
    // The counter increment line is `dcNameCounts[name] = ...`, with `name` being the resolved DC name.
    assert.match(V_SRC, /dcNameCounts\[name\]\s*=\s*\(dcNameCounts\[name\]\s*\|\|\s*0\)\s*\+\s*1;/,
      'duplicate tally must key by DC name only — CRR-UNI-002');
  });

  it('002b: source — unique check reads stats.unique (boolean), not a sub-name or ability flag', () => {
    // The unique field is a simple boolean on the DC effect record.
    assert.match(V_SRC, /stats\.unique\b/,
      'unique flag must come from stats.unique — CRR-UNI-002');
    assert.ok(!/stats\.subName|stats\.subAffiliation|stats\.uniqueBy/.test(V_SRC),
      'no sub-name / sub-affiliation keying exists — CRR-UNI-002');
  });

  it('002c: behavior — two different unique DCs do NOT collide (name is the only key)', () => {
    const effects = getDcEffects();
    const uniques = Object.keys(effects).filter((n) =>
      effects[n]?.unique && typeof effects[n]?.cost === 'number' && !n.startsWith('[')
    );
    assert.ok(uniques.length >= 2, 'need two distinct unique DCs — CRR-UNI-002');
    const [u1, u2] = uniques;
    const { errors } = validateDeckLegal({
      dcList: [{ dcName: u1 }, { dcName: u2 }],
      ccList: [],
    });
    const uniqueErr = errors.find((e) => /Unique deployment card/.test(e));
    assert.ok(!uniqueErr,
      `distinct uniques must not collide; got: ${JSON.stringify(errors)} — CRR-UNI-002`);
  });
});
