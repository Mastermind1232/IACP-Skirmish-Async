/**
 * PROBE-ADAPTIVE-SKILLS: Mara Jade's **Adaptive Skills**.
 *
 * Card text: "Your affiliation matches your army's affiliation."
 *
 * Mechanical effect: the engine injects a trait onto Mara's figure
 * keywords based on the army's primary affiliation
 * (Imperial → Hunter, Scum → Smuggler, Rebel → Guardian), and CC
 * restriction checks treat Mara's affiliation as the army's.
 *
 * Phase 2.2 medium-risk probe grind (2026-04-22). Atom was wired at
 * 3 call sites (data-loader, cc-timing, cc-hand) with the DC scan and
 * trait map inlined. Pure helpers extracted to
 * src/game/adaptive-skills-helpers.js.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  findAdaptiveSkillsDc,
  firstSeenArmyAffiliation,
  adaptiveSkillsTrait,
  resolveAdaptiveSkills,
  ADAPTIVE_SKILLS_ABILITY_ID,
  ADAPTIVE_SKILLS_TRAIT_MAP,
} from '../../../src/game/adaptive-skills-helpers.js';
import { getDcEffects, getDcKeywords } from '../../../src/data-loader.js';

let DC_EFFECTS;
before(() => { DC_EFFECTS = getDcEffects(); });

describe('PROBE-ADAPTIVE-SKILLS-001: constants', () => {
  it('ability id is canonical slug', () => {
    assert.equal(ADAPTIVE_SKILLS_ABILITY_ID, 'adaptive_skills_mara_jade');
  });

  it('trait map covers the 3 player affiliations with the expected keywords', () => {
    assert.equal(ADAPTIVE_SKILLS_TRAIT_MAP.imperial, 'Hunter');
    assert.equal(ADAPTIVE_SKILLS_TRAIT_MAP.scum, 'Smuggler');
    assert.equal(ADAPTIVE_SKILLS_TRAIT_MAP.rebel, 'Guardian');
  });

  it('trait map has no "any" entry — Any-affiliation DCs never trigger injection', () => {
    assert.equal(ADAPTIVE_SKILLS_TRAIT_MAP.any, undefined);
  });
});

describe('PROBE-ADAPTIVE-SKILLS-002: findAdaptiveSkillsDc', () => {
  it('returns Mara Jade when she is in the army (string form)', () => {
    const out = findAdaptiveSkillsDc(['Mara Jade', 'Imperial Officer'], DC_EFFECTS);
    assert.equal(out, 'Mara Jade');
  });

  it('returns Mara Jade (object form with dcName)', () => {
    const out = findAdaptiveSkillsDc([{ dcName: 'Mara Jade' }], DC_EFFECTS);
    assert.equal(out, 'Mara Jade');
  });

  it('returns null when Mara is absent', () => {
    const out = findAdaptiveSkillsDc(['Imperial Officer', 'Stormtrooper (Regular)'], DC_EFFECTS);
    assert.equal(out, null);
  });

  it('handles null / empty list', () => {
    assert.equal(findAdaptiveSkillsDc(null, DC_EFFECTS), null);
    assert.equal(findAdaptiveSkillsDc([], DC_EFFECTS), null);
  });
});

describe('PROBE-ADAPTIVE-SKILLS-003: firstSeenArmyAffiliation', () => {
  it('skips "Any" DCs and returns first concrete affiliation', () => {
    // Pit Droid is Any; Stormtrooper is Imperial.
    const out = firstSeenArmyAffiliation(['Pit Droid', 'Stormtrooper (Regular)'], DC_EFFECTS);
    assert.equal(out, 'imperial');
  });

  it('returns null when army is entirely "Any" or unknown', () => {
    assert.equal(firstSeenArmyAffiliation(['Pit Droid'], DC_EFFECTS), 'any' === 'any' ? null : null);
  });

  it('lowercases the returned affiliation', () => {
    const out = firstSeenArmyAffiliation(['R2-D2'], DC_EFFECTS);
    assert.equal(out, 'rebel');
  });

  it('handles null / missing DC cleanly', () => {
    assert.equal(firstSeenArmyAffiliation(null, DC_EFFECTS), null);
    assert.equal(firstSeenArmyAffiliation([{ dcName: 'Not A Real DC' }], DC_EFFECTS), null);
  });
});

describe('PROBE-ADAPTIVE-SKILLS-004: adaptiveSkillsTrait', () => {
  it('imperial → Hunter', () => { assert.equal(adaptiveSkillsTrait('Imperial'), 'Hunter'); });
  it('scum → Smuggler', () => { assert.equal(adaptiveSkillsTrait('Scum'), 'Smuggler'); });
  it('rebel → Guardian', () => { assert.equal(adaptiveSkillsTrait('Rebel'), 'Guardian'); });
  it('any → null (Any-affiliation armies are not a case this card covers)', () => {
    assert.equal(adaptiveSkillsTrait('Any'), null);
  });
  it('null / empty / unknown → null', () => {
    assert.equal(adaptiveSkillsTrait(null), null);
    assert.equal(adaptiveSkillsTrait(''), null);
    assert.equal(adaptiveSkillsTrait('Hutt Cartel'), null);
  });
  it('case-insensitive', () => {
    assert.equal(adaptiveSkillsTrait('IMPERIAL'), 'Hunter');
    assert.equal(adaptiveSkillsTrait('rebel'), 'Guardian');
  });
});

describe('PROBE-ADAPTIVE-SKILLS-005: resolveAdaptiveSkills convenience', () => {
  it('Imperial army + Mara → Hunter', () => {
    const r = resolveAdaptiveSkills(['Mara Jade', 'Stormtrooper (Regular)'], DC_EFFECTS);
    assert.equal(r.dcName, 'Mara Jade');
    assert.equal(r.trait, 'Hunter');
  });

  it('Rebel army + Mara → Guardian', () => {
    const r = resolveAdaptiveSkills(['Mara Jade', 'Rebel Trooper (Regular)'], DC_EFFECTS);
    assert.equal(r.trait, 'Guardian');
  });

  it('Scum army + Mara → Smuggler', () => {
    const r = resolveAdaptiveSkills(['Mara Jade', 'IG-88'], DC_EFFECTS);
    assert.equal(r.trait, 'Smuggler');
  });

  it('No Mara → { null, null }', () => {
    const r = resolveAdaptiveSkills(['Stormtrooper (Regular)'], DC_EFFECTS);
    assert.deepStrictEqual(r, { dcName: null, trait: null });
  });

  it('Mara alone (Mara is herself Any-affiliation) → trait null because no definite affiliation', () => {
    // Mara Jade herself has affiliation "Any" in dc-effects so first-seen returns null.
    const r = resolveAdaptiveSkills(['Mara Jade'], DC_EFFECTS);
    assert.equal(r.dcName, 'Mara Jade');
    assert.equal(r.trait, null);
  });
});

describe('PROBE-ADAPTIVE-SKILLS-006: library entry wired', () => {
  it('adaptive_skills_mara_jade entry exists and is wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const entry = lib.abilities?.adaptive_skills_mara_jade;
    assert.ok(entry);
    assert.equal(entry.wiredStatus, 'wired');
    assert.equal(entry.label, 'Adaptive Skills');
  });

  it('dc-effects.json wires Mara Jade to adaptive_skills_mara_jade', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const mara = effects.cards?.['Mara Jade'];
    assert.ok(mara);
    assert.ok(
      (mara.specialAbilityIds || []).includes('adaptive_skills_mara_jade'),
      'Mara Jade must reference adaptive_skills_mara_jade',
    );
  });
});

describe('PROBE-ADAPTIVE-SKILLS-007: end-to-end trait injection via getDcKeywords', () => {
  // data-loader.js getDcKeywords(game) injects the Adaptive Skills trait into
  // Mara Jade's keywords. Verify with minimal synthetic game states.

  it('Mara in Imperial army → "Hunter" appears on Mara\'s keywords', () => {
    const game = {
      p1DcList: ['Mara Jade', 'Stormtrooper (Regular)'],
      p2DcList: [],
    };
    const kw = getDcKeywords(game)?.['Mara Jade'] || [];
    assert.ok(kw.some((k) => String(k) === 'Hunter'), `got: ${JSON.stringify(kw)}`);
  });

  it('Mara in Scum army → "Smuggler" injected', () => {
    const game = {
      p1DcList: ['Mara Jade', 'IG-88'],
      p2DcList: [],
    };
    const kw = getDcKeywords(game)?.['Mara Jade'] || [];
    assert.ok(kw.includes('Smuggler'), `got: ${JSON.stringify(kw)}`);
  });

  it('Mara in Rebel army → "Guardian" injected', () => {
    const game = {
      p1DcList: ['Mara Jade', 'Rebel Trooper (Regular)'],
      p2DcList: [],
    };
    const kw = getDcKeywords(game)?.['Mara Jade'] || [];
    assert.ok(kw.includes('Guardian'), `got: ${JSON.stringify(kw)}`);
  });

  it('No duplicate trait injection if already present', () => {
    const game = {
      p1DcList: ['Mara Jade', 'Stormtrooper (Regular)'],
      p2DcList: [],
    };
    const kw = getDcKeywords(game)?.['Mara Jade'] || [];
    assert.equal(kw.filter((k) => String(k) === 'Hunter').length, 1);
  });

  it('p2 side is also scanned (both players get injection)', () => {
    const game = {
      p1DcList: [],
      p2DcList: ['Mara Jade', 'Rebel Trooper (Regular)'],
    };
    const kw = getDcKeywords(game)?.['Mara Jade'] || [];
    assert.ok(kw.includes('Guardian'), `got: ${JSON.stringify(kw)}`);
  });
});
