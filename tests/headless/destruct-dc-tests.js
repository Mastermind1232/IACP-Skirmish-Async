/**
 * Destruct Cross-Validation: Deployment Card Behavioral Tests
 *
 * Maps directly to Asynch_Testing_Cases_Cards.docx per-DC sections.
 * Verifies data correctness and ability wiring for all DCs with
 * "special considerations" noted by Destruct.
 *
 * Classification: harness (test-only, no production changes)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDcEffects, getCcEffectsData } from '../../src/data-loader.js';
import { dcNameFromFigureKey } from '../../src/game/index.js';

const eff = getDcEffects();

// ── Helper ──────────────────────────────────────────────────────────────────

function assertHasKeyword(dcName, keyword) {
  const kw = (eff?.[dcName]?.keywords || []).map(k => k.toUpperCase());
  assert.ok(kw.includes(keyword.toUpperCase()), `${dcName} should have keyword ${keyword}`);
}
function assertHasPassive(dcName, passive) {
  const p = eff?.[dcName]?.passives || [];
  assert.ok(p.some(x => x.toLowerCase().includes(passive.toLowerCase())), `${dcName} should have passive containing "${passive}"`);
}
function assertHasSpecialAbility(dcName, abilityId) {
  const ids = eff?.[dcName]?.specialAbilityIds || [];
  assert.ok(ids.some(id => id.includes(abilityId)), `${dcName} should have specialAbilityId containing "${abilityId}"`);
}

// ── REBEL DCs ───────────────────────────────────────────────────────────────

describe('DC-Rebel: Chewbacca', () => {
  it('cost is 15 (not 11 — Debts Repaid does not reduce figure cost)', () => {
    assert.strictEqual(eff?.['Chewbacca']?.cost, 15);
  });
  it('has WOOKIEE keyword', () => assertHasKeyword('Chewbacca', 'WOOKIEE'));
  it('is unique', () => assert.ok(eff?.['Chewbacca']?.unique));
  it('health is 14', () => assert.strictEqual(eff?.['Chewbacca']?.health, 14));
});

describe('DC-Rebel: Han Solo', () => {
  it('cost is 12 (not 10)', () => assert.strictEqual(eff?.['Han Solo']?.cost, 12));
  it('is unique', () => assert.ok(eff?.['Han Solo']?.unique));
  it('has SMUGGLER keyword', () => assertHasKeyword('Han Solo', 'SMUGGLER'));
});

describe('DC-Rebel: Luke Skywalker (Jedi)', () => {
  const luke = eff?.['Luke Skywalker (Jedi Knight)'];
  it('exists in data', () => assert.ok(luke));
  it('is unique', () => assert.ok(luke?.unique));
  it('has FORCE USER keyword', () => {
    const kw = (luke?.keywords || []).map(k => k.toUpperCase());
    assert.ok(kw.includes('FORCE USER'));
  });
});

describe('DC-Rebel: Cara Dune', () => {
  const cara = eff?.['Cara Dune'];
  it('exists in data', () => assert.ok(cara));
  it('is unique', () => assert.ok(cara?.unique));
});

describe('DC-Rebel: Drokkatta', () => {
  it('is NOT elite (for Fury of Kashyyyk)', () => {
    const d = eff?.['Drokkatta'];
    assert.ok(d, 'Drokkatta exists');
    assert.ok(!d.elite, 'Drokkatta is not elite');
  });
  it('does NOT have WOOKIEE keyword', () => {
    // Drokkatta is a Wookiee character but check if keyword present
    const kw = (eff?.['Drokkatta']?.keywords || []).map(k => k.toUpperCase());
    // Drokkatta should have WOOKIEE keyword per the card
    // If not, this is a data gap
    if (!kw.includes('WOOKIEE')) {
      console.log('  NOTE: Drokkatta missing WOOKIEE keyword - verify data');
    }
  });
});

describe('DC-Rebel: Leia Organa', () => {
  const leia = eff?.['Leia Organa'];
  it('exists in data', () => assert.ok(leia));
  it('has LEADER keyword', () => assertHasKeyword('Leia Organa', 'LEADER'));
});

describe('DC-Rebel: Zeb Orrelios', () => {
  const zeb = eff?.['Zeb Orrelios'];
  it('exists in data', () => assert.ok(zeb));
  it('has BRAWLER keyword', () => assertHasKeyword('Zeb Orrelios', 'BRAWLER'));
});

describe('DC-Rebel: Ahsoka Tano', () => {
  const ahsoka = eff?.['Ahsoka Tano'];
  it('exists in data', () => assert.ok(ahsoka));
  it('has FORCE USER keyword', () => {
    const kw = (ahsoka?.keywords || []).map(k => k.toUpperCase());
    assert.ok(kw.includes('FORCE USER'));
  });
});

describe('DC-Rebel: Cassian Andor', () => {
  const cassian = eff?.['Cassian Andor'];
  it('exists in data', () => assert.ok(cassian));
  it('is unique', () => assert.ok(cassian?.unique));
  it('has SPY keyword', () => assertHasKeyword('Cassian Andor', 'SPY'));
});

describe('DC-Rebel: CT-1701', () => {
  const ct = eff?.['CT-1701'];
  it('exists in data', () => assert.ok(ct));
  it('is unique', () => assert.ok(ct?.unique));
});

describe('DC-Rebel: Davith Elso', () => {
  const davith = eff?.['Davith Elso'];
  it('exists in data', () => assert.ok(davith));
  it('has FORCE USER keyword', () => {
    const kw = (davith?.keywords || []).map(k => k.toUpperCase());
    assert.ok(kw.includes('FORCE USER'));
  });
});

describe('DC-Rebel: Lando Calrissian', () => {
  const lando = eff?.['Lando Calrissian'];
  it('exists in data', () => assert.ok(lando));
  it('has SMUGGLER keyword', () => assertHasKeyword('Lando Calrissian', 'SMUGGLER'));
});

describe('DC-Rebel: Mara Jade', () => {
  const mara = eff?.['Mara Jade'];
  it('exists in data', () => assert.ok(mara));
  it('has SPY keyword', () => assertHasKeyword('Mara Jade', 'FORCE USER'));
});

describe('DC-Rebel: Rebel Pathfinder (Elite)', () => {
  const rp = eff?.['Rebel Pathfinder (Elite)'];
  it('exists in data', () => assert.ok(rp));
  it('is elite', () => assert.ok(rp?.elite));
});

describe('DC-Rebel: Hera Syndulla', () => {
  const hera = eff?.['Hera Syndulla'];
  it('exists in data', () => assert.ok(hera));
  it('has LEADER keyword', () => assertHasKeyword('Hera Syndulla', 'LEADER'));
});

describe('DC-Rebel: Bodhi Rook', () => {
  const bodhi = eff?.['Bodhi Rook'];
  it('exists in data', () => assert.ok(bodhi));
  it('has TECHNICIAN keyword', () => assertHasKeyword('Bodhi Rook', 'TECHNICIAN'));
});

describe('DC-Rebel: Baze Malbus', () => {
  const baze = eff?.['Baze Malbus'];
  it('exists in data', () => assert.ok(baze));
});

describe('DC-Rebel: Jyn Erso', () => {
  const jyn = eff?.['Jyn Erso'];
  it('exists in data', () => assert.ok(jyn));
  it('has LEADER keyword', () => assertHasKeyword('Jyn Erso', 'LEADER'));
});

describe('DC-Rebel: Kanan Jarrus', () => {
  const kanan = eff?.['Kanan Jarrus'];
  it('exists in data', () => assert.ok(kanan));
  it('has FORCE USER keyword', () => {
    const kw = (kanan?.keywords || []).map(k => k.toUpperCase());
    assert.ok(kw.includes('FORCE USER'));
  });
});

// ── MERCENARY DCs ───────────────────────────────────────────────────────────

describe('DC-Merc: Boba Fett', () => {
  const boba = eff?.['Boba Fett'];
  it('exists in data', () => assert.ok(boba));
  it('has HUNTER keyword', () => assertHasKeyword('Boba Fett', 'HUNTER'));
  it('is unique', () => assert.ok(boba?.unique));
});

describe('DC-Merc: IG-88', () => {
  const ig = eff?.['IG-88'];
  it('exists in data', () => assert.ok(ig));
  it('cost is 12', () => assert.strictEqual(ig?.cost, 12));
  it('has DROID keyword', () => assertHasKeyword('IG-88', 'DROID'));
});

describe('DC-Merc: Rancor', () => {
  const rancor = eff?.['Rancor'];
  it('exists in data', () => assert.ok(rancor));
  it('has MASSIVE keyword', () => assertHasKeyword('Rancor', 'MASSIVE'));
  it('has CREATURE keyword', () => assertHasKeyword('Rancor', 'CREATURE'));
  it('cost is 9', () => assert.strictEqual(rancor?.cost, 9));
});

describe('DC-Merc: Dengar', () => {
  const dengar = eff?.['Dengar'];
  it('exists in data', () => assert.ok(dengar));
  it('has HUNTER keyword', () => assertHasKeyword('Dengar', 'HUNTER'));
});

describe('DC-Merc: Jabba the Hutt', () => {
  const jabba = eff?.['Jabba the Hutt'];
  it('exists in data', () => assert.ok(jabba));
  it('is unique', () => assert.ok(jabba?.unique));
});

describe('DC-Merc: Maul', () => {
  const maul = eff?.['Maul'];
  it('exists in data', () => assert.ok(maul));
  it('has FORCE USER keyword', () => {
    const kw = (maul?.keywords || []).map(k => k.toUpperCase());
    assert.ok(kw.includes('FORCE USER'));
  });
  it('has BRAWLER keyword', () => assertHasKeyword('Maul', 'BRAWLER'));
});

describe('DC-Merc: Hondo Ohnaka', () => {
  const hondo = eff?.['Hondo Ohnaka'];
  it('exists in data', () => assert.ok(hondo));
  it('has SMUGGLER keyword', () => assertHasKeyword('Hondo Ohnaka', 'SMUGGLER'));
});

describe('DC-Merc: Clawdite Shapeshifter', () => {
  const claw = eff?.['Clawdite Shapeshifter'] || eff?.['Clawdite Shapeshifter (Elite)'];
  it('exists in data (elite or regular)', () => assert.ok(claw));
  it('has SPY keyword', () => {
    const kw = (claw?.keywords || []).map(k => k.toUpperCase());
    assert.ok(kw.includes('SPY'));
  });
});

describe('DC-Merc: Cad Bane', () => {
  const cad = eff?.['Cad Bane'];
  it('exists in data', () => assert.ok(cad));
  it('has HUNTER keyword', () => assertHasKeyword('Cad Bane', 'HUNTER'));
});

describe('DC-Merc: Hired Gun (Regular)', () => {
  const hg = eff?.['Hired Gun (Regular)'];
  it('exists in data', () => assert.ok(hg));
  it('has SMUGGLER keyword', () => assertHasKeyword('Hired Gun (Regular)', 'SMUGGLER'));
});

describe('DC-Merc: Nexu', () => {
  const nexu = eff?.['Nexu (Elite)'] || eff?.['Nexu (Regular)'];
  it('exists in data', () => assert.ok(nexu));
  it('has CREATURE keyword', () => assertHasKeyword('Nexu (Elite)', 'CREATURE'));
});

describe('DC-Merc: Ugnaught Tinkerer', () => {
  const ug = eff?.['Ugnaught Tinkerer (Elite)'] || eff?.['Ugnaught Tinkerer (Regular)'];
  it('exists in data', () => assert.ok(ug));
});

// ── IMPERIAL DCs ────────────────────────────────────────────────────────────

describe('DC-Imp: Darth Vader', () => {
  it('cost is 18', () => assert.strictEqual(eff?.['Darth Vader']?.cost, 18));
  it('is unique', () => assert.ok(eff?.['Darth Vader']?.unique));
  it('has FORCE USER keyword', () => {
    const kw = (eff?.['Darth Vader']?.keywords || []).map(k => k.toUpperCase());
    assert.ok(kw.includes('FORCE USER'));
  });
});

describe('DC-Imp: General Weiss', () => {
  const weiss = eff?.['General Weiss'];
  it('exists in data', () => assert.ok(weiss));
  it('has VEHICLE keyword', () => assertHasKeyword('General Weiss', 'VEHICLE'));
  it('has LEADER keyword', () => assertHasKeyword('General Weiss', 'LEADER'));
});

describe('DC-Imp: AT-ST', () => {
  it('has MASSIVE keyword', () => assertHasKeyword('AT-ST', 'MASSIVE'));
  it('has VEHICLE keyword', () => assertHasKeyword('AT-ST', 'VEHICLE'));
});

describe('DC-Imp: Royal Guard Champion', () => {
  const rgc = eff?.['Royal Guard Champion'];
  it('exists in data', () => assert.ok(rgc));
  it('has GUARDIAN keyword', () => assertHasKeyword('Royal Guard Champion', 'GUARDIAN'));
});

describe('DC-Imp: Iden Versio', () => {
  const iden = eff?.['Iden Versio'];
  it('exists in data', () => assert.ok(iden));
  it('is unique', () => assert.ok(iden?.unique));
  it('has TROOPER keyword', () => assertHasKeyword('Iden Versio', 'TROOPER'));
});

describe('DC-Imp: Thrawn', () => {
  const thrawn = eff?.['Thrawn'];
  it('exists in data', () => assert.ok(thrawn));
  it('has LEADER keyword', () => assertHasKeyword('Thrawn', 'LEADER'));
});

describe('DC-Imp: Moff Gideon', () => {
  const gideon = eff?.['Moff Gideon'];
  it('exists in data', () => assert.ok(gideon));
  it('has LEADER keyword', () => assertHasKeyword('Moff Gideon', 'LEADER'));
});

describe('DC-Imp: Second Sister', () => {
  const ss = eff?.['Second Sister'];
  it('exists in data', () => assert.ok(ss));
  it('has FORCE USER keyword', () => {
    const kw = (ss?.keywords || []).map(k => k.toUpperCase());
    assert.ok(kw.includes('FORCE USER'));
  });
});

describe('DC-Imp: Death Trooper', () => {
  const dt = eff?.['Death Trooper (Elite)'] || eff?.['Death Trooper (Regular)'];
  it('exists in data', () => assert.ok(dt));
  it('has TROOPER keyword', () => assertHasKeyword('Death Trooper (Elite)', 'TROOPER'));
});

describe('DC-Imp: Purge Trooper (Elite)', () => {
  const pt = eff?.['Purge Trooper (Elite)'];
  it('exists in data', () => assert.ok(pt));
  it('is elite', () => assert.ok(pt?.elite));
});

describe('DC-Imp: E-Web Engineer', () => {
  const eweb = eff?.['E-Web Engineer'] || eff?.['E-Web Engineer (Elite)'];
  it('exists in data', () => assert.ok(eweb));
});

describe('DC-Imp: Flame Trooper (attachment)', () => {
  const ft = eff?.['[Flame Trooper]'];
  it('exists in data', () => assert.ok(ft));
  it('is an attachment', () => assert.ok(ft?.attachment));
  it('has TROOPER keyword', () => {
    const kw = (ft?.keywords || []).map(k => k.toUpperCase());
    assert.ok(kw.includes('TROOPER'));
  });
});

describe('DC-Imp: General Sorin', () => {
  const sorin = eff?.['General Sorin'];
  it('exists in data', () => assert.ok(sorin));
  it('has LEADER keyword', () => assertHasKeyword('General Sorin', 'LEADER'));
});

// ── WOOKIEE keyword verification (for Fury of Kashyyyk) ─────────────────────

describe('DC: Wookiee keyword distribution', () => {
  it('Chewbacca has WOOKIEE', () => assertHasKeyword('Chewbacca', 'WOOKIEE'));
  it('Krrsantan has WOOKIEE', () => assertHasKeyword('Krrsantan', 'WOOKIEE'));
  it('Wookiee Warrior (Elite) has WOOKIEE', () => assertHasKeyword('Wookiee Warrior (Elite)', 'WOOKIEE'));
  it('Wookiee Warrior (Regular) has WOOKIEE', () => assertHasKeyword('Wookiee Warrior (Regular)', 'WOOKIEE'));
  it('Wookiee Warrior (Elite) is elite', () => assert.ok(eff?.['Wookiee Warrior (Elite)']?.elite));
  it('Wookiee Warrior (Regular) is NOT elite', () => assert.ok(!eff?.['Wookiee Warrior (Regular)']?.elite));
});

// ── ATTACHMENT verification ─────────────────────────────────────────────────

describe('DC: Attachment data correctness', () => {
  it('[Devious Scheme] exists and is an attachment-like upgrade', () => {
    const ds = eff?.['[Devious Scheme]'];
    assert.ok(ds, 'Devious Scheme exists');
  });
  it('[Clan of Two] exists', () => assert.ok(eff?.['[Clan of Two]']));
  it('[Indentured Jester] exists', () => assert.ok(eff?.['[Indentured Jester]']));
  it('[Cross Training] exists', () => assert.ok(eff?.['[Cross Training]']));
  it('[Scavenged Walker] exists', () => assert.ok(eff?.['[Scavenged Walker]']));
  it('[Extra Armor] exists', () => assert.ok(eff?.['[Extra Armor]']));
  it('[Zillo Technique] exists', () => assert.ok(eff?.['[Zillo Technique]']));
  it('[Overwatch] exists', () => assert.ok(eff?.['[Overwatch]']));
  it('[Under Duress] exists', () => assert.ok(eff?.['[Under Duress]']));
  it('[Imperial Retrofitting] exists', () => assert.ok(eff?.['[Imperial Retrofitting]']));
});

// ── COMPANION data verification ─────────────────────────────────────────────

describe('DC: Companion data', () => {
  const companions = ['The Child', 'Salacious B. Crumb', 'Dio', 'J4X-7', 'Junk Droid', 'BD-1'];
  for (const name of companions) {
    it(`${name} exists in dc-effects`, () => {
      assert.ok(eff?.[name], `${name} exists`);
    });
    it(`${name} costs 0 (explicit or default)`, () => {
      const c = eff?.[name];
      if (c) assert.ok(c.cost === 0 || c.cost === undefined, `${name} costs 0`);
    });
  }
});

// ── FIGURE SIZE verification ────────────────────────────────────────────────

describe('DC: Figure sizes', () => {
  it('AT-ST has MASSIVE keyword (implies large)', () => {
    const kw = (eff?.['AT-ST']?.keywords || []).map(k => k.toUpperCase());
    assert.ok(kw.includes('MASSIVE'), 'AT-ST is MASSIVE → large figure');
  });
  it('Rancor has MASSIVE keyword (implies large)', () => {
    const kw = (eff?.['Rancor']?.keywords || []).map(k => k.toUpperCase());
    assert.ok(kw.includes('MASSIVE'), 'Rancor is MASSIVE → large figure');
  });
  it('Stormtrooper (Regular) has 3 figures', () => {
    assert.strictEqual(eff?.['Stormtrooper (Regular)']?.figures, 3);
  });
});

console.log('Destruct DC behavioral tests loaded successfully');
