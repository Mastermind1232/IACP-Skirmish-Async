import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDcEffects } from '../../src/data-loader.js';
import { grantPowerTokens } from '../../src/game/game-helpers.js';

// ── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Minimal restriction parser that mirrors the runtime logic in setup.js and
 * validation.js.  We test the DATA here — given the restriction text in
 * dc-effects.json, does the filter accept the expected DCs?
 */
function parseRestriction(cardName) {
  const effects = getDcEffects();
  const card = effects[cardName] || effects[`[${cardName}]`];
  if (!card?.abilityText) return null;
  const firstLine = card.abilityText.split('\n')[0].trim();
  const onlyMatch = firstLine.match(/^(.+?)\s+ONLY$/i);
  if (!onlyMatch) return null;
  const restrictionRaw = onlyMatch[1].replace(/"/g, '').trim();

  const RESTRICTION_KEYWORDS = ['LEADER', 'HUNTER', 'DROID', 'CREATURE', 'TROOPER', 'VEHICLE',
    'SMUGGLER', 'WOOKIEE', 'WOOKIE', 'FORCE USER', 'HEAVY WEAPON', 'UNIQUE FIGURE',
    'NON-UNIQUE', 'NON-MASSIVE', 'BRAWLER', 'SPY', 'GUARDIAN', 'IMPERIAL', 'REBEL',
    'SCUM', 'FIGURE WITH', 'FIGURE COST', 'GROUP WITH', 'MASSIVE'];

  function _matchKw(phrase, dcKw, aff) {
    return phrase.split(/\s+/).filter(Boolean).every(w => dcKw.includes(w) || aff === w);
  }

  const normalized = restrictionRaw.replace(/(\d+)\s+OR\s+MORE/gi, '$1_OR_MORE');
  const orParts = normalized.split(/\s+OR\s+/i).map(s => s.trim()).filter(Boolean);
  const alternatives = [];
  for (const part of orParts) {
    if (part.includes(',') && !part.includes('NON-')) {
      alternatives.push(...part.split(/,\s*/).map(s => s.trim()).filter(Boolean));
    } else {
      alternatives.push(part.replace(/_OR_MORE/g, ' OR MORE'));
    }
  }

  return {
    restrictionText: restrictionRaw,
    filter: (dcName) => {
      const dcStats = effects[dcName];
      if (!dcStats) return false;
      const dcKw = (dcStats.keywords || []).map(k => String(k).toUpperCase());
      const dcNameUpper = (dcName || '').toUpperCase();
      const isUnique = !!dcStats.unique;
      const figureCost = dcStats.cost ?? 0;
      const figures = dcStats.figures ?? 1;
      const affiliation = (dcStats.affiliation || '').toUpperCase();

      return alternatives.some(alt => {
        const altUpper = alt.toUpperCase().replace(/\([^)]*\)/g, '').trim();
        if (altUpper.includes('NON-')) {
          if (altUpper.includes('NON-MASSIVE') && dcKw.includes('MASSIVE')) return false;
          if (altUpper.includes('NON-UNIQUE') && isUnique) return false;
          let remaining = altUpper.replace(/NON-MASSIVE/g, '').replace(/NON-UNIQUE/g, '').replace(/,/g, '').trim();
          if (remaining) {
            const grpMatch = remaining.match(/^(.+?)\s+GROUP\s+WITH\s+(\d+)\s+FIGURES?$/);
            if (grpMatch) {
              if (figures !== parseInt(grpMatch[2], 10)) return false;
              remaining = grpMatch[1].trim();
            }
            if (remaining && !_matchKw(remaining, dcKw, affiliation)) return false;
          }
          return true;
        }
        if (altUpper.startsWith('UNIQUE ')) {
          if (!isUnique) return false;
          if (altUpper === 'UNIQUE FIGURE') return true;
          const costMatch = altUpper.match(/FIGURE COST (\d+) OR MORE/);
          if (costMatch && figureCost < parseInt(costMatch[1], 10)) return false;
          if (altUpper.includes('UNIQUE FIGURE')) return true;
          const kwPart = altUpper.replace(/^UNIQUE\s+/, '').trim();
          if (kwPart && !_matchKw(kwPart, dcKw, affiliation)) return false;
          return true;
        }
        const groupMatch = altUpper.match(/(.+?)\s+GROUP WITH (\d+) FIGURES/);
        if (groupMatch) {
          if (figures !== parseInt(groupMatch[2], 10)) return false;
          if (!_matchKw(groupMatch[1].trim(), dcKw, affiliation)) return false;
          return true;
        }
        // Name before keyword
        if (dcNameUpper.includes(altUpper) || altUpper.includes(dcNameUpper.replace(/\s*\(.*\)$/, ''))) return true;
        if (RESTRICTION_KEYWORDS.some(k => altUpper.includes(k))) {
          return _matchKw(altUpper, dcKw, affiliation);
        }
        return false;
      });
    },
  };
}

// ── Attachment Restriction Tests ────────────────────────────────────────────

describe('attachment restriction parsing', () => {
  it('[Mortar Trooper] — SHORETROOPER ONLY — matches Shoretrooper (Elite)', () => {
    const r = parseRestriction('[Mortar Trooper]');
    assert.ok(r, 'should parse restriction');
    assert.ok(r.filter('Shoretrooper (Elite)'), 'should match Shoretrooper (Elite)');
    assert.ok(!r.filter('Stormtrooper (Elite)'), 'should NOT match Stormtrooper (Elite)');
    assert.ok(!r.filter('Heavy Stormtrooper (Elite)'), 'should NOT match Heavy Stormtrooper (Elite)');
  });

  it('[Flame Trooper] — NON-UNIQUE IMPERIAL TROOPER GROUP WITH 2 FIGURES — matches valid targets', () => {
    const r = parseRestriction('[Flame Trooper]');
    assert.ok(r, 'should parse restriction');
    assert.ok(r.filter('Shoretrooper (Elite)'), 'should match Shoretrooper (Elite) (2 figs, Imperial Trooper, non-unique)');
    assert.ok(r.filter('Heavy Stormtrooper (Elite)'), 'should match Heavy Stormtrooper (Elite) (2 figs, Imperial Trooper)');
    assert.ok(!r.filter('Stormtrooper (Elite)'), 'should NOT match Stormtrooper (Elite) (3 figs, not 2)');
    assert.ok(!r.filter('Luke Skywalker'), 'should NOT match Luke Skywalker (unique, Rebel)');
    assert.ok(!r.filter('Boba Fett'), 'should NOT match Boba Fett (unique, Scum)');
  });

  it('[Z-6 Trooper] — NON-UNIQUE REBEL TROOPER GROUP WITH 2 FIGURES — matches valid targets', () => {
    const r = parseRestriction('[Z-6 Trooper]');
    assert.ok(r, 'should parse restriction');
    const effects = getDcEffects();
    // Find a Rebel trooper group with 2 figures
    const rebelTroopers = Object.entries(effects).filter(([name, s]) =>
      s.affiliation === 'Rebel' && !s.unique && s.figures === 2 &&
      (s.keywords || []).some(k => String(k).toUpperCase() === 'TROOPER')
    );
    if (rebelTroopers.length > 0) {
      assert.ok(r.filter(rebelTroopers[0][0]), `should match ${rebelTroopers[0][0]}`);
    }
    assert.ok(!r.filter('Stormtrooper (Elite)'), 'should NOT match Imperial trooper');
  });

  it('[Clan of Two] — UNIQUE GUARDIAN ONLY — restricts to unique guardians', () => {
    const r = parseRestriction('[Clan of Two]');
    assert.ok(r, 'should parse restriction');
    assert.equal(r.restrictionText, 'UNIQUE GUARDIAN');
    // Should match unique figures with GUARDIAN keyword
    const effects = getDcEffects();
    const guardians = Object.entries(effects).filter(([, s]) =>
      s.unique && (s.keywords || []).some(k => String(k).toUpperCase() === 'GUARDIAN')
    );
    if (guardians.length > 0) {
      assert.ok(r.filter(guardians[0][0]), `should match unique GUARDIAN: ${guardians[0][0]}`);
    }
    // Should NOT match non-unique
    assert.ok(!r.filter('Stormtrooper (Elite)'), 'should NOT match non-unique');
    // Should NOT match unique non-guardian
    assert.ok(!r.filter('Luke Skywalker'), 'should NOT match unique non-GUARDIAN (unless Luke is GUARDIAN)');
  });

  it('[Advanced Com Systems] — LEADER ONLY — matches leaders', () => {
    const r = parseRestriction('[Advanced Com Systems]');
    assert.ok(r, 'should parse restriction');
    const effects = getDcEffects();
    const leaders = Object.entries(effects).filter(([, s]) =>
      (s.keywords || []).some(k => String(k).toUpperCase() === 'LEADER')
    );
    if (leaders.length > 0) {
      assert.ok(r.filter(leaders[0][0]), `should match LEADER: ${leaders[0][0]}`);
    }
  });

  it('[Lie in Ambush] — NON-MASSIVE, NON-UNIQUE — excludes massive and unique', () => {
    const r = parseRestriction('[Lie in Ambush]');
    assert.ok(r, 'should parse restriction');
    assert.ok(!r.filter('Rancor'), 'should NOT match Rancor (Massive)');
    assert.ok(!r.filter('Luke Skywalker'), 'should NOT match unique figure');
    assert.ok(r.filter('Stormtrooper (Elite)'), 'should match non-massive, non-unique');
  });
});

// ── Token Cap Tests ─────────────────────────────────────────────────────────

describe('power token cap enforcement', () => {
  it('grantPowerTokens enforces default cap of 2 with overflow', () => {
    const game = {};
    grantPowerTokens(game, 'Stormtrooper-1-0', 'Block', 1);
    grantPowerTokens(game, 'Stormtrooper-1-0', 'Block', 1);
    assert.strictEqual(game.figurePowerTokens['Stormtrooper-1-0'].length, 2);
    assert.strictEqual(game.pendingPowerTokenOverflow, undefined);
    // Third token should trigger overflow
    grantPowerTokens(game, 'Stormtrooper-1-0', 'Hit', 1);
    assert.strictEqual(game.figurePowerTokens['Stormtrooper-1-0'].length, 3);
    assert.ok(game.pendingPowerTokenOverflow, 'should have pending overflow');
    assert.strictEqual(game.pendingPowerTokenOverflow[0].discardCount, 1);
  });

  it('Into the Fray scenario: 4 surge tokens triggers overflow for excess', () => {
    const game = {};
    // Simulate Into the Fray granting 4 Surge tokens (4 hostiles with LOS)
    grantPowerTokens(game, 'Baze Malbus-1-0', 'Surge', 4);
    assert.strictEqual(game.figurePowerTokens['Baze Malbus-1-0'].length, 4);
    // Overflow should be queued: 4 tokens, max 2, so overflow = 2
    assert.ok(game.pendingPowerTokenOverflow);
    assert.strictEqual(game.pendingPowerTokenOverflow[0].discardCount, 2);
  });

  it('Beskar Armor scenario: 2 block tokens at cap does not overflow', () => {
    const game = {};
    grantPowerTokens(game, 'Din Djarin-1-0', 'Block', 2);
    assert.strictEqual(game.figurePowerTokens['Din Djarin-1-0'].length, 2);
    assert.strictEqual(game.pendingPowerTokenOverflow, undefined);
  });

  it('sequential grants accumulate overflow correctly', () => {
    const game = {};
    // Security Detail grants 1 Block
    grantPowerTokens(game, 'Officer-1-0', 'Block', 1);
    // Some other ability grants another Block
    grantPowerTokens(game, 'Officer-1-0', 'Block', 1);
    assert.strictEqual(game.figurePowerTokens['Officer-1-0'].length, 2);
    assert.strictEqual(game.pendingPowerTokenOverflow, undefined);
    // Third grant overflows
    grantPowerTokens(game, 'Officer-1-0', 'Hit', 1);
    assert.strictEqual(game.pendingPowerTokenOverflow[0].discardCount, 1);
  });

  it('no-ops for null figureKey or zero count', () => {
    const game = {};
    grantPowerTokens(game, null, 'Block', 1);
    grantPowerTokens(game, 'fig-1-0', 'Block', 0);
    assert.strictEqual(game.figurePowerTokens, undefined);
  });
});
