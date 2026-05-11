/**
 * Destruct Cross-Validation: DC Expansion Tests
 *
 * Tests DCs mentioned in Destruct's testing docs that were NOT covered
 * in the initial destruct-dc-tests.js. Validates data correctness,
 * keywords, ability text presence, and Destruct-specific behavioral notes.
 *
 * Classification: harness (test-only, no production changes)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDcEffects, getCcEffectsData, getAbilityLibrary } from '../../src/data-loader.js';

const eff = getDcEffects();
const ccCards = getCcEffectsData()?.cards || {};
const abilities = getAbilityLibrary()?.abilities || {};

function getDC(name) { return eff?.[name] || null; }
function assertExists(name) { assert.ok(getDC(name), `"${name}" exists in dc-effects.json`); }
function assertHasKeyword(name, kw) {
  const dc = getDC(name);
  assert.ok(dc, `${name} exists`);
  const keywords = (dc.keywords || []).map(k => k.toUpperCase());
  assert.ok(keywords.includes(kw.toUpperCase()), `${name} has ${kw} (got: ${keywords})`);
}
function assertAbilityTextContains(name, text) {
  const dc = getDC(name);
  assert.ok(dc?.abilityText, `${name} has abilityText`);
  assert.ok(dc.abilityText.toLowerCase().includes(text.toLowerCase()),
    `${name} abilityText contains "${text}"`);
}

// ═══════════════════════════════════════════════════════════════════════════
// REBEL DCs (expansion)
// ═══════════════════════════════════════════════════════════════════════════

describe('DC-Rebel: Ezra Bridger', () => {
  it('exists', () => assertExists('Ezra Bridger'));
  it('is FORCE USER', () => assertHasKeyword('Ezra Bridger', 'FORCE USER'));
  it('has Brash ability (SOR movement)', () => assertAbilityTextContains('Ezra Bridger', 'Brash'));
  it('has Much to Learn (reroll)', () => assertAbilityTextContains('Ezra Bridger', 'Much to Learn'));
  it('Much to Learn references FORCE USER', () => assertAbilityTextContains('Ezra Bridger', 'FORCE USER'));
});

describe('DC-Rebel: Gaarkhan', () => {
  it('exists', () => assertExists('Gaarkhan'));
  it('has WOOKIE keyword', () => {
    const dc = getDC('Gaarkhan');
    const kw = (dc.keywords || []).map(k => k.toUpperCase());
    assert.ok(kw.includes('WOOKIE') || kw.includes('WOOKIEE'), `Gaarkhan has Wookiee (got: ${kw})`);
  });
  it('has Brutal Cleave ability', () => assertAbilityTextContains('Gaarkhan', 'Brutal Cleave'));
  it('has Charge special action', () => assertAbilityTextContains('Gaarkhan', 'Charge'));
});

describe('DC-Rebel: Jyn Odan', () => {
  it('exists', () => assertExists('Jyn Odan'));
  it('is unique', () => assert.ok(getDC('Jyn Odan')?.unique));
  it('has abilityText', () => assert.ok(getDC('Jyn Odan')?.abilityText));
});

describe('DC-Rebel: Ko-Tun Feralo', () => {
  it('exists', () => assertExists('Ko-Tun Feralo'));
  it('is unique', () => assert.ok(getDC('Ko-Tun Feralo')?.unique));
  it('has Dead Precise or Squad Cohesion', () => {
    const dc = getDC('Ko-Tun Feralo');
    const txt = dc?.abilityText?.toLowerCase() || '';
    assert.ok(txt.includes('dead precise') || txt.includes('squad cohesion'),
      'Ko-Tun has Dead Precise or Squad Cohesion');
  });
});

describe('DC-Rebel: Luke Skywalker (Hero)', () => {
  it('exists', () => assertExists('Luke Skywalker'));
  it('is unique', () => assert.ok(getDC('Luke Skywalker')?.unique));
  it('is FORCE USER', () => assertHasKeyword('Luke Skywalker', 'FORCE USER'));
});

describe('DC-Rebel: Obi-Wan Kenobi', () => {
  it('exists', () => assertExists('Obi-Wan Kenobi'));
  it('is unique', () => assert.ok(getDC('Obi-Wan Kenobi')?.unique));
  it('is FORCE USER', () => assertHasKeyword('Obi-Wan Kenobi', 'FORCE USER'));
  it('has Alter Mind ability', () => assertAbilityTextContains('Obi-Wan Kenobi', 'Alter Mind'));
  it('has Strike Me Down ability', () => assertAbilityTextContains('Obi-Wan Kenobi', 'Strike Me Down'));
  it('Alter Mind blocks interact for figures cost ≤9', () => {
    assertAbilityTextContains('Obi-Wan Kenobi', 'cannot interact');
  });
});

describe('DC-Rebel: Verena Talos', () => {
  it('exists', () => assertExists('Verena Talos'));
  it('is unique', () => assert.ok(getDC('Verena Talos')?.unique));
  it('has BRAWLER keyword', () => assertHasKeyword('Verena Talos', 'BRAWLER'));
});

describe('DC-Rebel: Chirrut Imwe', () => {
  it('exists', () => assertExists('Chirrut Imwe'));
  it('is unique', () => assert.ok(getDC('Chirrut Imwe')?.unique));
});

describe('DC-Rebel: Murne Rin', () => {
  it('exists', () => assertExists('Murne Rin'));
  it('is unique', () => assert.ok(getDC('Murne Rin')?.unique));
  it('has False Orders or Figurehead', () => {
    const dc = getDC('Murne Rin');
    const txt = dc?.abilityText?.toLowerCase() || '';
    assert.ok(txt.includes('false orders') || txt.includes('figurehead'),
      'Murne has False Orders or Figurehead');
  });
});

describe('DC-Rebel: Saska Teft', () => {
  it('exists', () => assertExists('Saska Teft'));
  it('has TECHNICIAN keyword', () => assertHasKeyword('Saska Teft', 'TECHNICIAN'));
});

describe("DC-Rebel: Mak Eshka'rey", () => {
  it('exists', () => assertExists("Mak Eshka'rey"));
  it('has SPY keyword', () => assertHasKeyword("Mak Eshka'rey", 'SPY'));
  it('has Camouflage or Critical Hit', () => {
    const dc = getDC("Mak Eshka'rey");
    const txt = dc?.abilityText?.toLowerCase() || '';
    assert.ok(txt.includes('camouflage') || txt.includes('critical'),
      "Mak has Camouflage or Critical Hit");
  });
});

describe('DC-Rebel: C-3P0', () => {
  it('exists', () => assertExists('C-3P0'));
  it('is a companion (no attack dice)', () => {
    const dc = getDC('C-3P0');
    assert.ok(!dc?.attack?.dice?.length, 'C-3P0 has no attack dice (companion)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MERCENARY DCs (expansion)
// ═══════════════════════════════════════════════════════════════════════════

describe('DC-Merc: HK Assassin Droid', () => {
  it('Elite exists', () => assertExists('HK Assassin Droid (Elite)'));
  it('HK-47 also exists', () => assertExists('HK-47'));
  it('is DROID', () => assertHasKeyword('HK Assassin Droid (Elite)', 'DROID'));
  it('is HUNTER', () => assertHasKeyword('HK Assassin Droid (Elite)', 'HUNTER'));
  it('Elite is elite', () => assert.ok(getDC('HK Assassin Droid (Elite)')?.elite));
});

describe('DC-Merc: Krrsantan', () => {
  it('exists', () => assertExists('Krrsantan'));
  it('is WOOKIEE', () => assertHasKeyword('Krrsantan', 'WOOKIEE'));
  it('is unique', () => assert.ok(getDC('Krrsantan')?.unique));
});

describe('DC-Merc: 4-LOM', () => {
  it('exists', () => assertExists('4-LOM'));
  it('is unique', () => assert.ok(getDC('4-LOM')?.unique));
  it('is DROID', () => assertHasKeyword('4-LOM', 'DROID'));
});

describe('DC-Merc: Bossk', () => {
  it('exists', () => assertExists('Bossk'));
  it('is unique', () => assert.ok(getDC('Bossk')?.unique));
  it('has HUNTER keyword', () => assertHasKeyword('Bossk', 'HUNTER'));
  it('has Indiscriminate Fire ability', () => assertAbilityTextContains('Bossk', 'Indiscriminate'));
});

describe('DC-Merc: Migs Mayfeld', () => {
  it('exists', () => assertExists('Migs Mayfeld'));
  it('is unique', () => assert.ok(getDC('Migs Mayfeld')?.unique));
});

describe('DC-Merc: Paz Vizsla', () => {
  it('exists', () => assertExists('Paz Vizsla'));
  it('is unique', () => assert.ok(getDC('Paz Vizsla')?.unique));
});

describe('DC-Merc: Shyla Varad', () => {
  it('exists', () => assertExists('Shyla Varad'));
  it('is unique', () => assert.ok(getDC('Shyla Varad')?.unique));
  it('is BRAWLER', () => assertHasKeyword('Shyla Varad', 'BRAWLER'));
});

describe('DC-Merc: Wing Guard', () => {
  it('Elite exists', () => assertExists('Wing Guard (Elite)'));
  it('Regular exists', () => assertExists('Wing Guard (Regular)'));
  it('has GUARDIAN keyword', () => assertHasKeyword('Wing Guard (Elite)', 'GUARDIAN'));
});

describe('DC-Merc: Gar Saxon', () => {
  it('exists', () => assertExists('Gar Saxon'));
  it('is unique', () => assert.ok(getDC('Gar Saxon')?.unique));
  it('is LEADER', () => assertHasKeyword('Gar Saxon', 'LEADER'));
});

describe('DC-Merc: Onar Koma', () => {
  it('exists', () => assertExists('Onar Koma'));
  it('is unique', () => assert.ok(getDC('Onar Koma')?.unique));
});

describe('DC-Merc: Taron Malicos', () => {
  it('exists', () => assertExists('Taron Malicos'));
  it('is FORCE USER', () => assertHasKeyword('Taron Malicos', 'FORCE USER'));
  it('is unique', () => assert.ok(getDC('Taron Malicos')?.unique));
});

describe('DC-Merc: Zuckuss', () => {
  it('exists', () => assertExists('Zuckuss'));
  it('is unique', () => assert.ok(getDC('Zuckuss')?.unique));
});

describe('DC-Merc: Doctor Aphra', () => {
  it('exists', () => assertExists('Doctor Aphra'));
  it('is unique', () => assert.ok(getDC('Doctor Aphra')?.unique));
  it('has Excavation ability', () => assertAbilityTextContains('Doctor Aphra', 'Excavat'));
});

describe('DC-Merc: Greedo', () => {
  it('exists', () => assertExists('Greedo'));
  it('is unique', () => assert.ok(getDC('Greedo')?.unique));
  it('has HUNTER keyword', () => assertHasKeyword('Greedo', 'HUNTER'));
});

describe('DC-Merc: Bib Fortuna', () => {
  it('exists', () => assertExists('Bib Fortuna'));
  it('is unique', () => assert.ok(getDC('Bib Fortuna')?.unique));
});

describe('DC-Merc: Jawa Scavenger', () => {
  it('Elite exists', () => assertExists('Jawa Scavenger (Elite)'));
  it('Regular exists', () => assertExists('Jawa Scavenger (Regular)'));
});

describe('DC-Merc: Kuiil', () => {
  it('exists', () => assertExists('Kuiil'));
  it('is unique', () => assert.ok(getDC('Kuiil')?.unique));
});

// ═══════════════════════════════════════════════════════════════════════════
// IMPERIAL DCs (expansion)
// ═══════════════════════════════════════════════════════════════════════════

describe('DC-Imp: Fifth Brother', () => {
  it('exists', () => assertExists('Fifth Brother'));
  it('is FORCE USER', () => assertHasKeyword('Fifth Brother', 'FORCE USER'));
  it('is unique', () => assert.ok(getDC('Fifth Brother')?.unique));
});

describe('DC-Imp: Heavy Stormtrooper', () => {
  it('Elite exists', () => assertExists('Heavy Stormtrooper (Elite)'));
  it('Regular exists', () => assertExists('Heavy Stormtrooper (Regular)'));
  it('is TROOPER', () => assertHasKeyword('Heavy Stormtrooper (Elite)', 'TROOPER'));
});

describe('DC-Imp: Scout Trooper', () => {
  it('Elite exists', () => assertExists('Scout Trooper (Elite)'));
  it('is TROOPER', () => assertHasKeyword('Scout Trooper (Elite)', 'TROOPER'));
});

describe('DC-Imp: 74-Z Bikes', () => {
  const bikes = getDC('74-Z Speeder Bike (Elite)') || getDC('74-Z Speeder Bikes');
  it('exists in some form', () => {
    const found = Object.keys(eff || {}).filter(k => k.includes('74-Z'));
    assert.ok(found.length > 0, `74-Z exists: ${found}`);
  });
});

describe('DC-Imp: ISB Infiltrator', () => {
  it('Elite exists', () => assertExists('ISB Infiltrator (Elite)'));
  it('Regular exists', () => assertExists('ISB Infiltrator (Regular)'));
  it('has SPY keyword', () => assertHasKeyword('ISB Infiltrator (Elite)', 'SPY'));
});

describe('DC-Imp: Trandoshan Hunter', () => {
  it('Elite exists', () => assertExists('Trandoshan Hunter (Elite)'));
  it('Regular exists', () => assertExists('Trandoshan Hunter (Regular)'));
  it('has HUNTER keyword', () => assertHasKeyword('Trandoshan Hunter (Elite)', 'HUNTER'));
});

describe('DC-Imp: Agent Kallus', () => {
  it('exists', () => assertExists('Agent Kallus'));
  it('is unique', () => assert.ok(getDC('Agent Kallus')?.unique));
  it('is SPY', () => assertHasKeyword('Agent Kallus', 'SPY'));
  it('is LEADER', () => assertHasKeyword('Agent Kallus', 'LEADER'));
});

describe('DC-Imp: Dark Trooper Mk III', () => {
  it('exists', () => assertExists('Dark Trooper Mk III'));
  it('is DROID', () => assertHasKeyword('Dark Trooper Mk III', 'DROID'));
});

describe('DC-Imp: Agent Blaise', () => {
  it('exists', () => assertExists('Agent Blaise'));
  it('is unique', () => assert.ok(getDC('Agent Blaise')?.unique));
  it('has Interrogate ability', () => assertAbilityTextContains('Agent Blaise', 'Interrogat'));
});

describe('DC-Imp: BT-1', () => {
  it('exists', () => assertExists('BT-1'));
  it('is DROID', () => assertHasKeyword('BT-1', 'DROID'));
  it('is HEAVY WEAPON', () => assertHasKeyword('BT-1', 'HEAVY WEAPON'));
});

describe('DC-Imp: Del Meeko', () => {
  it('exists', () => assertExists('Del Meeko'));
  it('is unique', () => assert.ok(getDC('Del Meeko')?.unique));
});

describe('DC-Imp: Director Krennic', () => {
  it('exists', () => assertExists('Director Krennic'));
  it('is unique', () => assert.ok(getDC('Director Krennic')?.unique));
  it('is LEADER', () => assertHasKeyword('Director Krennic', 'LEADER'));
});

describe('DC-Imp: 0-0-0', () => {
  it('exists', () => assertExists('0-0-0'));
  it('is DROID', () => assertHasKeyword('0-0-0', 'DROID'));
  it('is unique', () => assert.ok(getDC('0-0-0')?.unique));
  it('has Invasive Procedure ability', () => assertAbilityTextContains('0-0-0', 'Invasive'));
});

describe('DC-Imp: Imperial Officer', () => {
  it('Elite exists', () => assertExists('Imperial Officer (Elite)'));
  it('Regular exists', () => assertExists('Imperial Officer (Regular)'));
  it('is LEADER', () => assertHasKeyword('Imperial Officer (Elite)', 'LEADER'));
});

describe('DC-Imp: Purge Commander', () => {
  it('exists', () => assertExists('Purge Commander (Elite)'));
  it('is elite', () => assert.ok(getDC('Purge Commander (Elite)')?.elite));
});

// ═══════════════════════════════════════════════════════════════════════════
// SKIRMISH UPGRADES (Destruct-mentioned)
// ═══════════════════════════════════════════════════════════════════════════

describe('Skirmish upgrades: Destruct-mentioned', () => {
  const upgrades = [
    '[Fury of Kashyyyk]', '[Heavy Fire]', '[Beast Tamer]',
    '[Black Market]', '[Clan of Two]', '[Punishing Strike]',
    '[Scavenged Weaponry]', '[Under Duress]', '[Scavenged Walker]',
    '[Imperial Citadel]', '[Imperial Retrofitting]', '[Zillo Technique]',
    '[Overwatch]', '[Devious Scheme]', '[Indentured Jester]',
  ];

  for (const name of upgrades) {
    it(`${name} exists`, () => assert.ok(getDC(name), `${name} not found`));
  }
});

describe('Skirmish upgrade: Fury of Kashyyyk', () => {
  it('references Wookiee', () => assertAbilityTextContains('[Fury of Kashyyyk]', 'Wookiee'));
});

describe('Skirmish upgrade: Punishing Strike', () => {
  it('references condition', () => assertAbilityTextContains('[Punishing Strike]', 'condition'));
});

describe('Skirmish upgrade: Under Duress', () => {
  it('references strain', () => assertAbilityTextContains('[Under Duress]', 'strain'));
});

// ═══════════════════════════════════════════════════════════════════════════
// CC EXPANSION: Destruct-mentioned CCs not yet in destruct-cc-tests.js
// ═══════════════════════════════════════════════════════════════════════════

describe('CC expansion: additional Destruct-mentioned CCs', () => {
  const additionalCCs = [
    'Arcing Shot', 'Bodyguard', 'Built on Hope',
    'Close and Personal', 'Droid Mastery',
    'Harsh Environment', 'Rebel Graffiti',
    'Targeting Network', 'Devotion',
    'Self-Augmentation', 'Sniper Configuration',
  ];

  for (const name of additionalCCs) {
    it(`"${name}" exists`, () => {
      assert.ok(ccCards[name], `CC "${name}" not found in cc-effects.json`);
    });
  }
});

describe('CC: Harsh Environment', () => {
  it('exists', () => assert.ok(ccCards['Harsh Environment']));
  it('references interior or exterior', () => {
    const txt = ccCards['Harsh Environment']?.effect?.toLowerCase() || '';
    assert.ok(txt.includes('interior') || txt.includes('exterior') || txt.includes('tile'),
      'Harsh Environment references tile types');
  });
});

describe('CC: Self-Augmentation', () => {
  it('exists', () => assert.ok(ccCards['Self-Augmentation']));
  it('references Droid', () => {
    const txt = ccCards['Self-Augmentation']?.effect?.toLowerCase() || '';
    assert.ok(txt.includes('droid'), 'Self-Augmentation references Droid');
  });
});
