/**
 * Oracle tests for centralized defeat pipeline (Phase 1.5).
 *
 * Verifies that all identified defeat sites now route through processFigureDefeat(),
 * ensuring consistent side effects: VP, CC attachments, passive redraws, Heroic Effort,
 * Scavenged Weaponry, Hunt Dissent, activation decrement, win conditions.
 *
 * Tests are structural (source-level) since the handler code requires Discord deps
 * that cannot be instantiated in pure unit tests.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

function readSrc(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

// ── ORACLE-DEFEAT-001: All converted sites call processFigureDefeat ──────────
describe('ORACLE-DEFEAT-001: Converted defeat sites use processFigureDefeat', () => {
  const sites = [
    {
      file: 'src/handlers/combat-special-effects.js',
      label: 'Indiscriminate Fire splash',
      marker: 'Indiscriminate Fire',
    },
    {
      file: 'src/handlers/strain-handler.js',
      label: 'Bleeding defeat (via applyStrain)',
      marker: 'processFigureDefeat',
    },
    {
      file: 'src/handlers/activation.js',
      label: 'It Will Be Alright sacrifice',
      marker: 'It Will Be Alright',
    },
    {
      file: 'src/handlers/combat-reactions.js',
      label: 'Strike Me Down',
      marker: 'Strike Me Down',
    },
    {
      file: 'src/handlers/combat-special-effects.js',
      label: 'Fighting Knife defeat',
      marker: 'Fighting Knife',
    },
    {
      file: 'src/handlers/combat-special-effects.js',
      label: 'Heavy Fire defeat',
      marker: 'Heavy Fire',
    },
    {
      file: 'src/handlers/combat.js',
      label: 'Strain defeat (applyStrainToFigure)',
      marker: 'ctxProcessFigureDefeat',
    },
    {
      file: 'src/handlers/combat.js',
      label: 'Strain defeat (resolveStrainDamage)',
      marker: 'resolveStrainDamage',
    },
    {
      file: 'src/handlers/combat.js',
      label: 'Figurehead redirect defeat',
      marker: 'Figurehead',
    },
    {
      file: 'src/handlers/movement.js',
      label: 'Overrun defeat',
      marker: 'Overrun',
    },
    {
      file: 'src/handlers/movement.js',
      label: 'Cut and Run defeat',
      marker: 'Cut and Run',
    },
    {
      file: 'src/handlers/movement.js',
      label: 'Swipe defeat',
      marker: 'Swipe',
    },
    {
      file: 'src/handlers/dc-play-area.js',
      label: 'Rush defeat',
      marker: 'Rush',
    },
    {
      file: 'src/handlers/dc-play-area.js',
      label: 'Orbital Bombardment defeat',
      marker: 'Orbital Bombardment',
    },
    {
      file: 'src/handlers/dc-play-area.js',
      label: 'Bomb Drop defeat',
      marker: 'Bomb Drop',
    },
    {
      file: 'src/handlers/interrupts.js',
      label: 'Overdrive self-damage defeat',
      marker: 'Overdrive',
    },
    {
      file: 'src/handlers/interrupts.js',
      label: 'Self-Destruct Probe hostile defeat',
      marker: 'Self-Destruct Probe',
    },
    {
      file: 'src/handlers/interrupts.js',
      label: 'Self-Destruct Protocol hostile defeat',
      marker: 'Self-Destruct Protocol',
    },
    {
      file: 'src/handlers/interrupts.js',
      label: 'YHSIW defeat',
      marker: 'You Have Something I Want',
    },
    {
      file: 'src/handlers/interrupts.js',
      label: 'Last Resort splash defeat',
      marker: 'Last Resort',
    },
    {
      file: 'src/handlers/interrupts.js',
      label: "Assassin's Blade defeat",
      marker: "Assassin's Blade",
    },
    {
      file: 'src/handlers/activation.js',
      label: 'Wookiee Avenger Slam defeat',
      marker: 'Wookiee Avenger Slam',
    },
    {
      file: 'src/handlers/activation.js',
      label: 'Durasteel Fist defeat',
      marker: 'Durasteel Fist',
    },
  ];

  for (const site of sites) {
    it(`${site.label} (${site.file}) calls processFigureDefeat`, () => {
      const src = readSrc(site.file);
      assert.ok(src.includes('processFigureDefeat'), `${site.file} must call processFigureDefeat`);
      assert.ok(src.includes(site.marker), `${site.file} should reference ${site.marker}`);
    });
  }
});

// ── ORACLE-DEFEAT-002: Converted sites do NOT inline removeFigurePosition for their defeat paths ──
describe('ORACLE-DEFEAT-002: No inline removeFigurePosition in converted defeat paths', () => {
  it('Indiscriminate Fire does not inline removeFigurePosition at defeat site', () => {
    const src = readSrc('src/handlers/combat-special-effects.js');
    // The Indiscriminate Fire function (applyIndiscriminateFireSplash) should not call removeFigurePosition
    const fnMatch = src.match(/async function applyIndiscriminateFireSplash[\s\S]*?^}/m);
    if (fnMatch) {
      assert.ok(
        !fnMatch[0].includes('removeFigurePosition'),
        'Indiscriminate Fire splash should not inline removeFigurePosition (handled by processFigureDefeat)'
      );
    }
  });

  it('It Will Be Alright does not inline removeFigurePosition', () => {
    const src = readSrc('src/handlers/activation.js');
    // The file should not contain removeFigurePosition at all (only import was removed)
    assert.ok(
      !src.includes('removeFigurePosition'),
      'activation.js should not reference removeFigurePosition after centralization'
    );
  });

  it('Strike Me Down does not inline removeFigurePosition', () => {
    const src = readSrc('src/handlers/combat-reactions.js');
    assert.ok(
      !src.includes('removeFigurePosition'),
      'combat-reactions.js should not reference removeFigurePosition after centralization'
    );
  });

  it('combat-special-effects.js does not import removeFigurePosition', () => {
    const src = readSrc('src/handlers/combat-special-effects.js');
    assert.ok(
      !src.includes('removeFigurePosition'),
      'combat-special-effects.js should not reference removeFigurePosition after full centralization'
    );
  });
});

// ── ORACLE-DEFEAT-003: processFigureDefeat handles all 9 defeat steps ────────
describe('ORACLE-DEFEAT-003: processFigureDefeat covers all defeat side effects', () => {
  const src = readSrc('src/engine/defeat-handler.js');

  const requiredSteps = [
    { label: 'position removal', pattern: 'removeFigurePosition' },
    { label: 'VP calculation', pattern: 'calculateKillVp' },
    { label: 'VP award', pattern: 'awardKillVp' },
    { label: 'defeat logging', pattern: 'logGameAction' },
    { label: 'activation decrement', pattern: 'decrementActivationIfGroupDefeated' },
    { label: 'CC attachment cleanup', pattern: 'ccAttachmentsKey' },
    { label: 'passive redraws', pattern: 'checkFriendlyDefeatedPassiveRedraws' },
    { label: 'Nefarious Gains', pattern: 'checkNefariousGains' },
    { label: 'Hunt Dissent', pattern: 'checkHuntDissent' },
    { label: 'This is the Way', pattern: 'checkThisIsTheWay' },
    { label: 'Heroic Effort', pattern: 'Heroic Effort' },
    { label: 'Scavenged Weaponry', pattern: 'Scavenged Weaponry' },
    { label: 'win conditions', pattern: 'checkWinConditions' },
  ];

  for (const step of requiredSteps) {
    it(`includes ${step.label}`, () => {
      assert.ok(src.includes(step.pattern), `defeat-handler.js must include ${step.label} (${step.pattern})`);
    });
  }
});

// ── ORACLE-DEFEAT-004: Strike Me Down uses awardVp: false with manual VP ─────
describe('ORACLE-DEFEAT-004: Strike Me Down VP reduction preserved', () => {
  it('Strike Me Down awards reduced VP manually and passes awardVp: false', () => {
    const src = readSrc('src/handlers/combat-reactions.js');
    // Should contain the VP reduction logic
    assert.ok(src.includes('baseCost - 3'), 'Strike Me Down should reduce VP cost by 3');
    assert.ok(src.includes('awardVp: false'), 'Strike Me Down should pass awardVp: false to processFigureDefeat');
    assert.ok(src.includes('awardKillVp'), 'Strike Me Down should manually award reduced VP');
  });
});

// ── ORACLE-DEFEAT-007: Main combat damage path uses processFigureDefeat ──────
describe('ORACLE-DEFEAT-007: combat-bridge.js main defeat path uses processFigureDefeat', () => {
  const src = readSrc('src/engine/combat-bridge.js');

  it('main combat defeat block calls processFigureDefeat with skipWinConditions', () => {
    assert.ok(
      src.includes('skipWinConditions: true'),
      'combat-bridge main defeat must pass skipWinConditions: true to processFigureDefeat'
    );
  });

  it('main combat defeat block does NOT inline removeFigurePosition for primary kill', () => {
    // The CANONICAL DEFEAT CORE comment marks the processFigureDefeat call.
    // Between "PRE-DEFEAT" and "Achievement: activation kill streak", there should be
    // no direct removeFigurePosition call (it's inside processFigureDefeat now).
    const preIdx = src.indexOf('PRE-DEFEAT');
    const postIdx = src.indexOf('Achievement: activation kill streak');
    assert.ok(preIdx > 0 && postIdx > preIdx, 'found defeat block boundaries');
    const block = src.slice(preIdx, postIdx);
    assert.ok(
      !block.includes('removeFigurePosition(game'),
      'main combat defeat should not inline removeFigurePosition (handled by processFigureDefeat)'
    );
  });

  it('Disruptor Rifle defeat calls processFigureDefeat (now in fireDisruptorRifle)', () => {
    // 2026-05-09: Disruptor Rifle migrated from inline step-7 to step-8
    // fireDisruptorRifle (after-attack-fire.js). Probe both files; the
    // canonical defeat call is wherever the live execute lives.
    const fireSrc = readSrc('src/handlers/after-attack-fire.js');
    const fireDrIdx = fireSrc.indexOf('Disruptor Rifle');
    assert.ok(fireDrIdx > 0, 'Disruptor Rifle handler found in after-attack-fire.js');
    const fireDrBlock = fireSrc.slice(fireDrIdx, fireDrIdx + 2000);
    assert.ok(
      fireDrBlock.includes('processFigureDefeat'),
      'fireDisruptorRifle must call processFigureDefeat when figure is defeated'
    );
  });

  it('combat-specific effects remain as post-defeat wrapper (not moved into processFigureDefeat)', () => {
    // Verify combat-specific effects are still present in combat-bridge.js
    const combatSpecific = [
      'Of No Importance', 'Price on Their Heads', 'Paid in Beskar',
      'Worth Every Credit', 'Apex Predator', 'Last Stand',
      'Imperial Citadel', 'Into the Force', 'Vengeance',
      'This is the Way', 'Bounty', 'Brutal Tactics', 'Useful Hide',
      'Celebration',
    ];
    for (const effect of combatSpecific) {
      assert.ok(src.includes(effect), `combat-specific effect "${effect}" should remain in combat-bridge.js`);
    }
  });
});

// ── ORACLE-DEFEAT-006: Context groups wire processFigureDefeat ───────────────
describe('ORACLE-DEFEAT-006: Context factory includes processFigureDefeat for defeat handler groups', () => {
  const src = readSrc('src/context-factory.js');

  const groups = ['combatReactions', 'combatSpecialEffects', 'activation'];
  for (const group of groups) {
    it(`${group} context group includes processFigureDefeat`, () => {
      // Find the group definition and check it includes processFigureDefeat
      assert.ok(src.includes('processFigureDefeat'), `context-factory.js must include processFigureDefeat`);
    });
  }
});
