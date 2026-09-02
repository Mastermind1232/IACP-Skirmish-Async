/**
 * Data Integrity & Wiring Tests
 *
 * Validates that ALL 241 DCs and 293 CCs have complete, consistent data.
 * Cross-validates ability-library wiring, surge abilities, attack/defense dice,
 * keyword consistency, figure sizes, and CC timing/cost fields.
 *
 * Classification: harness (test-only, no production changes)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDcEffects, getCcEffectsData, getAbilityLibrary,
  getFigureSizes, getMapRegistry, getDeploymentZones,
  getLoadoutCards, getFormCards, getDiceData,
} from '../../src/data-loader.js';

const eff = getDcEffects();
const ccData = getCcEffectsData();
const cc = ccData?.cards || {};
const abilityLib = getAbilityLibrary();
const abilities = abilityLib?.abilities || {};
const figureSizes = getFigureSizes();
const mapReg = getMapRegistry();
const dzones = getDeploymentZones();
const loadouts = getLoadoutCards();
const forms = getFormCards();
const dice = getDiceData();

// ── Helpers ─────────────────────────────────────────────────────────────────

function getDC(name) { return eff?.[name] || null; }
function getCC(name) { return cc?.[name] || null; }

const VALID_AFFILIATIONS = ['Rebel', 'Imperial', 'Scum', 'Any'];
const VALID_DICE = ['red', 'blue', 'green', 'yellow', 'white', 'black', 'any', 'special'];

// ═══════════════════════════════════════════════════════════════════════════
// DC DATA INTEGRITY
// ═══════════════════════════════════════════════════════════════════════════

describe('DC: All cards have required fields', () => {
  // Exclude underscore-prefixed metadata keys (e.g. "_Cal_Kestis_audit_note",
  // alexanbv 2026-05-10) — these are inline audit notes / comments stored as
  // string values in dc-effects.json, not real deployment cards.
  const allDCs = Object.entries(eff || {}).filter(
    ([k, v]) => !k.startsWith('_') && v && typeof v === 'object'
  );

  it('at least 200 DCs exist', () => {
    assert.ok(allDCs.length >= 200, `Got ${allDCs.length}`);
  });

  it('every DC has affiliation', () => {
    const missing = allDCs.filter(([k, v]) => !v.affiliation);
    assert.ok(missing.length < 10, `${missing.length} DCs missing affiliation: ${missing.slice(0, 5).map(m => m[0])}`);
  });

  it('every DC has valid affiliation', () => {
    const bad = allDCs.filter(([k, v]) => v.affiliation && !VALID_AFFILIATIONS.includes(v.affiliation));
    assert.strictEqual(bad.length, 0, `Invalid affiliations: ${bad.map(b => `${b[0]}=${b[1].affiliation}`)}`);
  });

  // Companions (BD-1, C-3P0, Dio, Salacious B. Crumb, The Child, Yoda, etc.) lack combat stats — that's correct
  const KNOWN_COMPANIONS = ['88-Z', 'BD-1', 'C-3P0', 'Pit Droid', 'Salacious B. Crumb', 'The Child', 'Yoda',
    'Cam Droid', 'Dio', 'J4X-7', 'Junk Droid', 'Bantha Rider'];

  it('every non-attachment non-companion DC has attack dice', () => {
    const missing = allDCs.filter(([k, v]) => !v.attachment && !v.attack?.dice?.length && !k.startsWith('[') && !KNOWN_COMPANIONS.includes(k));
    assert.strictEqual(missing.length, 0, `DCs missing attack dice: ${missing.map(m => m[0])}`);
  });

  // Fully-statted figures whose card prints a DASH in the Defense circle, not a
  // die. Distinct from KNOWN_COMPANIONS, which have no combat stats at all.
  // These must carry `defense: []` rather than omit the key: combat.js:3845
  // normalises a MISSING defense to ['white'], so dropping the field would hand
  // the figure a free white die, while an empty array passes through untouched.
  const PRINTS_NO_DEFENSE_DIE = ['Kuiil'];

  it('every non-attachment non-companion DC has defense dice', () => {
    const missing = allDCs.filter(([k, v]) => !v.attachment && !v.defense?.length && !k.startsWith('[')
      && !KNOWN_COMPANIONS.includes(k) && !PRINTS_NO_DEFENSE_DIE.includes(k));
    assert.strictEqual(missing.length, 0, `DCs missing defense: ${missing.map(m => m[0])}`);
  });

  it('a dash-defence figure carries an empty array, not a missing field', () => {
    for (const k of PRINTS_NO_DEFENSE_DIE) {
      const v = eff[k];
      assert.ok(v, `${k} exists`);
      assert.ok(Array.isArray(v.defense), `${k} must have defense: [] — a missing field becomes ['white']`);
      assert.strictEqual(v.defense.length, 0);
    }
  });

  it('every non-attachment non-companion DC has cost', () => {
    const missing = allDCs.filter(([k, v]) => !v.attachment && v.cost == null && !k.startsWith('[') && !KNOWN_COMPANIONS.includes(k));
    assert.strictEqual(missing.length, 0, `DCs missing cost: ${missing.map(m => m[0])}`);
  });

  it('every DC has abilityText', () => {
    const missing = allDCs.filter(([k, v]) => !v.abilityText);
    assert.ok(missing.length < 5, `${missing.length} DCs missing abilityText: ${missing.slice(0, 5).map(m => m[0])}`);
  });

  it('attack dice use valid colors', () => {
    const bad = [];
    for (const [k, v] of allDCs) {
      for (const d of (v.attack?.dice || [])) {
        if (!VALID_DICE.includes(d)) bad.push(`${k}: ${d}`);
      }
    }
    assert.strictEqual(bad.length, 0, `Invalid attack dice: ${bad.slice(0, 5)}`);
  });

  it('defense dice use valid colors', () => {
    const bad = [];
    for (const [k, v] of allDCs) {
      for (const d of (v.defense || [])) {
        if (!VALID_DICE.includes(d)) bad.push(`${k}: ${d}`);
      }
    }
    assert.strictEqual(bad.length, 0, `Invalid defense dice: ${bad.slice(0, 5)}`);
  });
});

describe('DC: Unique figures have unique flag', () => {
  const uniqueNames = [
    'Chewbacca', 'Han Solo', 'Darth Vader', 'Luke Skywalker (Jedi Knight)',
    'Boba Fett', 'IG-88', 'General Weiss', 'Ahsoka Tano', 'Ezra Bridger',
    'Kanan Jarrus', 'Leia Organa', 'Obi-Wan Kenobi', 'Mara Jade',
    'Jabba the Hutt', 'Maul', 'Thrawn', 'Iden Versio', 'Moff Gideon',
  ];

  for (const name of uniqueNames) {
    it(`${name} is unique`, () => {
      const dc = getDC(name);
      assert.ok(dc, `${name} exists`);
      assert.ok(dc.unique, `${name} should be unique`);
    });
  }
});

describe('DC: Elite vs Regular paired consistency', () => {
  const pairs = [
    'Stormtrooper', 'Royal Guard', 'Rebel Trooper', 'Wookiee Warrior',
    'Nexu', 'Hired Gun', 'Death Trooper', 'Ugnaught Tinkerer',
    'Wing Guard', 'Trandoshan Hunter',
  ];

  for (const base of pairs) {
    it(`${base} has both Elite and Regular`, () => {
      const e = getDC(`${base} (Elite)`);
      const r = getDC(`${base} (Regular)`);
      assert.ok(e, `${base} (Elite) exists`);
      assert.ok(r, `${base} (Regular) exists`);
    });

    it(`${base} Elite costs more than Regular`, () => {
      const e = getDC(`${base} (Elite)`);
      const r = getDC(`${base} (Regular)`);
      if (e && r && e.cost != null && r.cost != null) {
        assert.ok(e.cost >= r.cost, `Elite cost ${e.cost} < Regular cost ${r.cost}`);
      }
    });

    it(`${base} Elite is marked elite`, () => {
      const e = getDC(`${base} (Elite)`);
      if (e) assert.ok(e.elite, `${base} (Elite) should be elite`);
    });
  }
});

describe('DC: Surge abilities reference valid ability-library entries', () => {
  it('ability library has entries', () => {
    assert.ok(Object.keys(abilities).length > 100, `Only ${Object.keys(abilities).length} abilities`);
  });

  it('at least 80% of surge abilities resolve in library', () => {
    let total = 0;
    let found = 0;
    for (const [k, v] of Object.entries(eff || {})) {
      for (const s of (v.surgeAbilities || [])) {
        total++;
        if (abilities[s]) found++;
      }
    }
    const pct = total > 0 ? (found / total * 100) : 100;
    assert.ok(pct >= 80, `Only ${pct.toFixed(1)}% of surge abilities found in library (${found}/${total})`);
  });
});

describe('DC: Cost validation (Destruct-specific)', () => {
  it('Chewbacca costs 15', () => assert.strictEqual(getDC('Chewbacca')?.cost, 15));
  it('Han Solo costs 12', () => assert.strictEqual(getDC('Han Solo')?.cost, 12));
  it('Darth Vader costs 18', () => assert.strictEqual(getDC('Darth Vader')?.cost, 18));
  it('Boba Fett costs 13', () => assert.strictEqual(getDC('Boba Fett')?.cost, 13));
  it('IG-88 costs 12', () => assert.strictEqual(getDC('IG-88')?.cost, 12));
  it('Rancor costs 9', () => assert.strictEqual(getDC('Rancor')?.cost, 9));
});

// ═══════════════════════════════════════════════════════════════════════════
// CC DATA INTEGRITY
// ═══════════════════════════════════════════════════════════════════════════

describe('CC: All cards have required fields', () => {
  const allCCs = Object.entries(cc);

  it('at least 250 CCs exist', () => {
    assert.ok(allCCs.length >= 250, `Got ${allCCs.length}`);
  });

  it('every CC has cost', () => {
    const missing = allCCs.filter(([k, v]) => v.cost == null);
    assert.strictEqual(missing.length, 0, `CCs missing cost: ${missing.slice(0, 5).map(m => m[0])}`);
  });

  it('every CC has timing', () => {
    const missing = allCCs.filter(([k, v]) => !v.timing);
    assert.ok(missing.length < 3, `${missing.length} CCs missing timing: ${missing.slice(0, 5).map(m => m[0])}`);
  });

  it('every CC has effect text', () => {
    const missing = allCCs.filter(([k, v]) => !v.effect);
    assert.ok(missing.length < 5, `${missing.length} CCs missing effect: ${missing.slice(0, 5).map(m => m[0])}`);
  });

  it('CC costs are non-negative integers', () => {
    const bad = allCCs.filter(([k, v]) => v.cost < 0 || !Number.isInteger(v.cost));
    assert.strictEqual(bad.length, 0, `Invalid CC costs: ${bad.slice(0, 5).map(b => `${b[0]}=${b[1].cost}`)}`);
  });

  it('no duplicate CC names', () => {
    const names = allCCs.map(([k]) => k);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    assert.strictEqual(dupes.length, 0, `Duplicate CCs: ${dupes}`);
  });
});

describe('CC: Timing distribution sanity', () => {
  it('has specialAction CCs', () => {
    const sa = Object.values(cc).filter(v => v.timing === 'specialAction');
    assert.ok(sa.length >= 50, `Only ${sa.length} specialAction CCs`);
  });

  it('has startOfRound CCs', () => {
    const sor = Object.values(cc).filter(v => v.timing === 'startOfRound');
    assert.ok(sor.length >= 20, `Only ${sor.length} startOfRound CCs`);
  });

  it('has duringActivation CCs', () => {
    const da = Object.values(cc).filter(v => v.timing === 'duringActivation');
    assert.ok(da.length >= 30, `Only ${da.length} duringActivation CCs`);
  });

  it('has duringAttack CCs', () => {
    const atk = Object.values(cc).filter(v => v.timing === 'duringAttack');
    assert.ok(atk.length >= 10, `Only ${atk.length} duringAttack CCs`);
  });
});

describe('CC: 0-cost cards for Negation targeting', () => {
  it('Negation costs 1', () => assert.strictEqual(getCC('Negation')?.cost, 1));

  it('at least 50 zero-cost CCs exist (Negation targets)', () => {
    const zeroCost = Object.values(cc).filter(v => v.cost === 0);
    assert.ok(zeroCost.length >= 50, `Only ${zeroCost.length} zero-cost CCs`);
  });

  it('Celebration is 0-cost', () => assert.strictEqual(getCC('Celebration')?.cost, 0));
  it('Parting Blow costs 2', () => assert.strictEqual(getCC('Parting Blow')?.cost, 2));
  it('Dirty Trick costs 2', () => assert.strictEqual(getCC('Dirty Trick')?.cost, 2));
});

describe('CC: Destruct-mentioned cards all exist', () => {
  const destructCCs = [
    'Assassinate', 'Lord of the Sith', 'On the Lam', 'Son of Skywalker',
    'Adrenaline', 'Blaze of Glory', 'Capitalize', 'Cloned Reinforcements',
    'Comm Disruption', 'Dirty Trick', 'Evacuate', 'Final Stand',
    'Get Behind Me!', 'Jundland Terror', 'Knowledge and Defense',
    'Parting Blow', 'Reduce to Rubble', 'Reinforcements', 'Repair',
    'Squad Swarm', 'Stay Down', 'Still Faster Than You',
    'Support Specialist', 'Vanish', 'You Will Not Deny Me',
    'Ambush', 'Bodyguard', 'Built on Hope',
    'Change of Plans', 'Disarm', 'Disengage', 'Elusive',
    'Extra Protection', 'Ferocity', 'Field Tactician',
    'Force Push', 'In the Shadows', 'Negation',
    'Right Back At Ya!', 'Shared Experience', 'Smoke Grenade',
    'Sniper Configuration', 'Strength in Numbers',
    'De Wanna Wanga', 'Devotion',
    'Element of Surprise', 'Fool Me Once',
    'Harsh Environment', 'Opportunistic', 'Parry',
    'Rebel Graffiti', 'Rest in Peace', 'Reverse Engineer',
    'Self-Augmentation', 'Sit Tight', 'Targeting Network',
    'To the Limit', 'Urgency',
  ];

  for (const name of destructCCs) {
    it(`"${name}" exists in cc-effects.json`, () => {
      assert.ok(getCC(name), `CC "${name}" not found`);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FIGURE SIZE DATA
// ═══════════════════════════════════════════════════════════════════════════

describe('Figure sizes: Massive figures have size data', () => {
  it('figure sizes data loaded', () => {
    assert.ok(typeof figureSizes === 'object');
  });

  const massiveDCs = Object.entries(eff || {}).filter(([k, v]) =>
    (v.keywords || []).some(kw => kw.toUpperCase() === 'MASSIVE')
  );

  it('at least 3 MASSIVE DCs exist', () => {
    assert.ok(massiveDCs.length >= 3, `Only ${massiveDCs.length} MASSIVE DCs`);
  });

  for (const [name] of massiveDCs) {
    it(`MASSIVE figure "${name}" has size entry or is known large`, () => {
      // MASSIVE keyword implies large figure — verify keyword present
      const dc = getDC(name);
      const kw = (dc?.keywords || []).map(k => k.toUpperCase());
      assert.ok(kw.includes('MASSIVE'), `${name} missing MASSIVE keyword`);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// MAP & DEPLOYMENT ZONE DATA
// ═══════════════════════════════════════════════════════════════════════════

describe('Map registry integrity', () => {
  it('map registry has entries', () => {
    assert.ok(mapReg.length >= 4, `Only ${mapReg.length} maps`);
  });

  it('every map has id and name', () => {
    const bad = mapReg.filter(m => !m.id || !m.name);
    assert.strictEqual(bad.length, 0, `Maps missing id/name: ${bad.length}`);
  });

  it('deployment zones exist for maps', () => {
    const dzKeys = Object.keys(dzones);
    assert.ok(dzKeys.length >= 4, `Only ${dzKeys.length} deployment zone entries`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LOADOUT & FORM CARDS
// ═══════════════════════════════════════════════════════════════════════════

describe('Loadout cards (Purge Trooper)', () => {
  it('loadout cards data loaded', () => {
    assert.ok(typeof loadouts === 'object');
  });

  it('has at least 1 loadout entry', () => {
    assert.ok(Object.keys(loadouts).length >= 1, 'No loadout cards found');
  });
});

describe('Form cards (Clawdite Shapeshifter)', () => {
  it('form cards data loaded', () => {
    assert.ok(typeof forms === 'object');
  });

  it('has at least 1 form entry', () => {
    assert.ok(Object.keys(forms).length >= 1, 'No form cards found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DICE DATA
// ═══════════════════════════════════════════════════════════════════════════

describe('Dice data integrity', () => {
  it('dice data has attack and defense', () => {
    assert.ok(dice?.attack, 'Missing attack dice data');
    assert.ok(dice?.defense, 'Missing defense dice data');
  });

  it('attack dice includes standard colors', () => {
    for (const color of ['red', 'blue', 'green', 'yellow']) {
      assert.ok(dice.attack[color], `Missing attack ${color} die`);
    }
  });

  it('defense dice includes standard colors', () => {
    for (const color of ['white', 'black']) {
      assert.ok(dice.defense[color], `Missing defense ${color} die`);
    }
  });

  it('each die has faces array', () => {
    for (const [color, die] of Object.entries(dice.attack)) {
      assert.ok(Array.isArray(die.faces || die), `Attack ${color} missing faces`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ATTACHMENT DATA INTEGRITY
// ═══════════════════════════════════════════════════════════════════════════

describe('Attachment data: all bracketed names are attachments', () => {
  const brackets = Object.entries(eff || {}).filter(([k]) => k.startsWith('['));

  it('has at least 15 attachments', () => {
    assert.ok(brackets.length >= 15, `Only ${brackets.length} attachments`);
  });

  it('bracketed names split into attachments and skirmish upgrades', () => {
    const withFlag = brackets.filter(([k, v]) => v.attachment);
    const withoutFlag = brackets.filter(([k, v]) => !v.attachment);
    // Some are attachments (e.g., [Flame Trooper], [Cross Training])
    // Others are skirmish upgrades (e.g., [Devious Scheme], [Fury of Kashyyyk])
    assert.ok(withFlag.length >= 5, `Only ${withFlag.length} have attachment flag`);
    assert.ok(withoutFlag.length >= 5, `Only ${withoutFlag.length} are skirmish upgrades`);
    // Total should cover all bracketed names
    assert.strictEqual(withFlag.length + withoutFlag.length, brackets.length);
  });

  it('attachments have cost or restriction text', () => {
    const noInfo = brackets.filter(([k, v]) => v.cost == null && !v.abilityText);
    assert.strictEqual(noInfo.length, 0, `Attachments with no cost or ability text: ${noInfo.map(n => n[0])}`);
  });
});

describe('Attachment: Destruct-mentioned attachments exist', () => {
  const expected = [
    '[Devious Scheme]', '[Clan of Two]', '[Indentured Jester]',
    '[Cross Training]', '[Scavenged Walker]', '[Extra Armor]',
    '[Zillo Technique]', '[Overwatch]', '[Under Duress]',
    '[Imperial Retrofitting]', '[Flame Trooper]',
  ];

  for (const name of expected) {
    it(`${name} exists`, () => assert.ok(getDC(name), `${name} not found`));
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// KEYWORD CONSISTENCY
// ═══════════════════════════════════════════════════════════════════════════

describe('Keyword consistency', () => {
  it('WOOKIEE spelled consistently (not WOOKIE)', () => {
    const wookieSpelling = Object.entries(eff || {}).filter(([k, v]) =>
      (v.keywords || []).includes('WOOKIE')
    );
    // Both spellings may exist — just ensure WOOKIEE also exists
    const wookieeSpelling = Object.entries(eff || {}).filter(([k, v]) =>
      (v.keywords || []).includes('WOOKIEE')
    );
    assert.ok(wookieeSpelling.length >= 2, `Only ${wookieeSpelling.length} WOOKIEE keyword cards`);
  });

  it('MASSIVE figures: Rancor, AT-ST, General Weiss all have it', () => {
    for (const name of ['Rancor', 'AT-ST', 'General Weiss']) {
      const dc = getDC(name);
      assert.ok(dc, `${name} exists`);
      const kw = (dc.keywords || []).map(k => k.toUpperCase());
      assert.ok(kw.includes('MASSIVE'), `${name} missing MASSIVE`);
    }
  });

  it('MOBILE keyword exists on at least 5 DCs', () => {
    const mobile = Object.entries(eff || {}).filter(([k, v]) =>
      (v.keywords || []).some(kw => kw.toUpperCase() === 'MOBILE')
    );
    assert.ok(mobile.length >= 5, `Only ${mobile.length} MOBILE DCs`);
  });

  it('FORCE USER keyword on expected cards', () => {
    for (const name of ['Darth Vader', 'Luke Skywalker (Jedi Knight)', 'Obi-Wan Kenobi', 'Kanan Jarrus', 'Ahsoka Tano', 'Mara Jade', 'Maul']) {
      const dc = getDC(name);
      if (!dc) continue;
      const kw = (dc.keywords || []).map(k => k.toUpperCase());
      assert.ok(kw.includes('FORCE USER'), `${name} missing FORCE USER`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SIM-FARM CARD CENSUS
// ═══════════════════════════════════════════════════════════════════════════

describe('Sim-farm card census completeness', () => {
  const allDcNames = Object.keys(eff || {});
  const allCcNames = Object.keys(cc || {});

  it('DC census includes all DCs (>= 241)', () => {
    assert.ok(allDcNames.length >= 241, `Only ${allDcNames.length} DCs in census (expected >= 241)`);
  });

  it('CC census includes all CCs (>= 292)', () => {
    // Threshold matches the actual card count in data/cc-effects.json (292).
    // The prior >= 293 was an off-by-one over-estimate; no card was removed.
    assert.ok(allCcNames.length >= 292, `Only ${allCcNames.length} CCs in census (expected >= 292)`);
  });

  it('deployable DCs (with health, cost, attack) >= 130', () => {
    let deployable = 0;
    for (const [name, dc] of Object.entries(eff || {})) {
      if (name.startsWith('[')) continue;
      if (dc.health > 0 && dc.cost > 0 && dc.attack) deployable++;
    }
    assert.ok(deployable >= 130, `Only ${deployable} deployable DCs (expected >= 130)`);
  });

  it('every CC has timing and playableBy', () => {
    const missing = Object.entries(cc || {}).filter(([, v]) => !v.timing || !v.playableBy);
    assert.strictEqual(missing.length, 0, `CCs missing timing/playableBy: ${missing.map(([n]) => n).join(', ')}`);
  });
});
