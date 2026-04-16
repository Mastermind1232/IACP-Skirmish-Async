/**
 * Attack-target ranking tests.
 *
 * Tests the shared compareAttackTargets comparator used by both
 * oracleActivationPlan and pickWithinGroup. Each "scored" entry has the
 * fields the scoring stage produces: { action, missionTargetPriority,
 * hitViability, currentHp, maxHp, targetActivated, dist }.
 *
 * Tier order (lower value wins):
 *   1. hitViability         2. currentHp         3. maxHp
 *   4. targetActivated      5. missionTargetPriority  6. dist
 *
 * Regression case this file locks in:
 *   Before the fix, missionTargetPriority was tier 1 — Krykna beat every enemy
 *   figure on Chopper regardless of HP (9/9 forensic trace observations). After
 *   the fix, the mission term only breaks ties that survive hit viability and
 *   HP focus-fire.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareAttackTargets } from '../headless/learnings.js';

// Test-entry factory. All fields default to "neutral" so a test can override
// only the dimensions it cares about.
function entry(overrides = {}) {
  return {
    action: { tag: overrides.tag || 'unnamed' },
    hitViability: 0,             // 0 = reliable, 1 = marginal
    currentHp: 5,
    maxHp: 5,
    missionTargetPriority: 1,    // 0 = Krykna on Chopper, 1 = everything else
    targetActivated: 0,          // 0 = unactivated (turn-denial valuable), 1 = activated
    dist: 1,
    ...overrides,
  };
}

// Sort helper — returns the tag of the best-ranked entry.
function best(...entries) {
  return [...entries].sort(compareAttackTargets)[0].action.tag;
}

describe('compareAttackTargets — hit viability tier', () => {
  it('reliable hit beats marginal hit, even on identical HP', () => {
    const reliable = entry({ tag: 'reliable', hitViability: 0, currentHp: 5, maxHp: 5 });
    const marginal = entry({ tag: 'marginal', hitViability: 1, currentHp: 3, maxHp: 5 });
    assert.equal(best(reliable, marginal), 'reliable',
      'reliable hit wins at tier 1 despite higher HP');
  });

  it('marginal hit can still win if reliable target is far out of HP tier', () => {
    // Two marginal-viability targets — tier 1 doesn't discriminate; HP does.
    const fullHp = entry({ tag: 'full', hitViability: 1, currentHp: 8, maxHp: 8 });
    const nearDead = entry({ tag: 'near-dead', hitViability: 1, currentHp: 1, maxHp: 8 });
    assert.equal(best(fullHp, nearDead), 'near-dead');
  });
});

// ── Primary regression: Chopper mixed-candidate decisions ──────────────────
describe('compareAttackTargets — Chopper mixed candidates', () => {
  it('REGRESSION: full-HP Krykna loses to mid-HP enemy figure (the 9/9 trace case)', () => {
    // Full-HP Krykna, mid-HP enemy figure, both reliable hits.
    // Prior sort: Krykna wins on missionTargetPriority tier-1.
    // New sort: enemy figure wins on currentHp tier.
    const krykna = entry({ tag: 'krykna-full', missionTargetPriority: 0, currentHp: 8, maxHp: 8 });
    const enemyFig = entry({ tag: 'enemy-fig-mid', missionTargetPriority: 1, currentHp: 4, maxHp: 6 });
    assert.equal(best(krykna, enemyFig), 'enemy-fig-mid',
      'lower-HP enemy figure wins permanent-kill priority over full Krykna');
  });

  it('REGRESSION: full-HP Krykna loses to low-HP enemy figure', () => {
    const krykna = entry({ tag: 'krykna-full', missionTargetPriority: 0, currentHp: 8, maxHp: 8 });
    const enemyFig = entry({ tag: 'enemy-fig-low', missionTargetPriority: 1, currentHp: 2, maxHp: 4 });
    assert.equal(best(krykna, enemyFig), 'enemy-fig-low');
  });

  it('Krykna still wins when its HP is below the enemy figure\'s HP (near-dead finish)', () => {
    // The "Krykna should reasonably win" case: Krykna is nearly dead, enemy is full HP.
    // Finishing the Krykna claims 2 VP and removes the respawn loop participant.
    const krykna = entry({ tag: 'krykna-near-dead', missionTargetPriority: 0, currentHp: 2, maxHp: 8 });
    const enemyFig = entry({ tag: 'enemy-fig-full', missionTargetPriority: 1, currentHp: 5, maxHp: 5 });
    assert.equal(best(krykna, enemyFig), 'krykna-near-dead');
  });

  it('Krykna wins when all HP + turn-denial factors tie (mission as late tiebreaker)', () => {
    // Identical HP / maxHp / viability / activation status. Mission priority now
    // participates as a late tiebreaker — Krykna gets the edge over an
    // equal-profile enemy figure.
    const krykna = entry({ tag: 'krykna-tie', missionTargetPriority: 0, currentHp: 4, maxHp: 4, targetActivated: 0 });
    const enemyFig = entry({ tag: 'enemy-fig-tie', missionTargetPriority: 1, currentHp: 4, maxHp: 4, targetActivated: 0 });
    assert.equal(best(krykna, enemyFig), 'krykna-tie',
      'mission priority breaks true-tie in favor of VP-earning kill');
  });

  it('turn-denial beats mission priority at equal HP (activated Krykna loses to unactivated fig)', () => {
    // Krykna is already activated? NPCs don't really activate, but the field defaults to 0.
    // Simulate an edge case where an enemy fig is unactivated and Krykna target has
    // targetActivated=1 — the fig should now win on turn-denial before mission priority fires.
    const kryknaAct = entry({ tag: 'krykna-act', missionTargetPriority: 0, currentHp: 4, maxHp: 4, targetActivated: 1 });
    const figUnact = entry({ tag: 'fig-unact', missionTargetPriority: 1, currentHp: 4, maxHp: 4, targetActivated: 0 });
    assert.equal(best(kryknaAct, figUnact), 'fig-unact',
      'turn-denial tier wins over mission priority tier');
  });
});

// ── HP focus-fire still works independently of mission priority ─────────────
describe('compareAttackTargets — HP focus-fire tier', () => {
  it('current HP is the dominant signal when viability is equal', () => {
    const high = entry({ tag: 'high-hp', currentHp: 8, maxHp: 8 });
    const mid = entry({ tag: 'mid-hp', currentHp: 4, maxHp: 8 });
    const low = entry({ tag: 'low-hp', currentHp: 1, maxHp: 8 });
    assert.equal(best(high, mid, low), 'low-hp');
  });

  it('maxHp breaks ties when currentHp is equal (smaller baseline wins)', () => {
    const largeBase = entry({ tag: 'large-base', currentHp: 3, maxHp: 8 });
    const smallBase = entry({ tag: 'small-base', currentHp: 3, maxHp: 4 });
    assert.equal(best(largeBase, smallBase), 'small-base');
  });
});

// ── Turn-denial and distance tiers still function ──────────────────────────
describe('compareAttackTargets — late-tier tiebreakers', () => {
  it('turn-denial prefers unactivated when everything else ties', () => {
    const activated = entry({ tag: 'activated', targetActivated: 1 });
    const unactivated = entry({ tag: 'unactivated', targetActivated: 0 });
    assert.equal(best(activated, unactivated), 'unactivated');
  });

  it('distance is the final tiebreaker', () => {
    const near = entry({ tag: 'near', dist: 1 });
    const far = entry({ tag: 'far', dist: 5 });
    assert.equal(best(near, far), 'near');
  });
});

// ── Non-Chopper maps: behavior unchanged (no Krykna → no mission priority 0) ──
describe('compareAttackTargets — non-Chopper behavior unchanged', () => {
  it('on non-Krykna maps, all targets have missionTargetPriority=1 so HP-focus-fire dominates', () => {
    // Devaron, Corellian, Hoth, Lothal, Mos Eisley — no Krykna, so every
    // target gets missionTargetPriority=1. HP tier decides.
    const hpHigh = entry({ tag: 'hp-high', missionTargetPriority: 1, currentHp: 6 });
    const hpLow = entry({ tag: 'hp-low', missionTargetPriority: 1, currentHp: 2 });
    assert.equal(best(hpHigh, hpLow), 'hp-low');
  });

  it('turn-denial still works on non-Chopper maps at equal HP', () => {
    const activated = entry({ tag: 'act', missionTargetPriority: 1, targetActivated: 1 });
    const unactivated = entry({ tag: 'unact', missionTargetPriority: 1, targetActivated: 0 });
    assert.equal(best(activated, unactivated), 'unact');
  });
});

// ── Ordering over larger candidate lists (matches trace structure) ─────────
describe('compareAttackTargets — multi-candidate ordering', () => {
  it('ranks a 5-candidate mix correctly (matches ICA-vs-RH r=3 structure)', () => {
    // From the ICA forensic trace: 3 Krykna at various HP + 2 enemy figures.
    // Prior sort: first Krykna with lowest HP wins. New sort: whichever target
    // has the absolute lowest HP wins, regardless of NPC/fig.
    const k1 = entry({ tag: 'krykna-8', missionTargetPriority: 0, currentHp: 8, maxHp: 8 });
    const k2 = entry({ tag: 'krykna-3', missionTargetPriority: 0, currentHp: 3, maxHp: 8 });
    const k3 = entry({ tag: 'krykna-8b', missionTargetPriority: 0, currentHp: 8, maxHp: 8 });
    const f1 = entry({ tag: 'leia', missionTargetPriority: 1, currentHp: 5, maxHp: 5 });
    const f2 = entry({ tag: 'mara', missionTargetPriority: 1, currentHp: 6, maxHp: 6 });
    assert.equal(best(k1, k2, k3, f1, f2), 'krykna-3',
      'nearly-dead Krykna wins over full-HP figures');
  });

  it('ranks a mixed list where enemy figure should now beat Krykna', () => {
    // Trace-style mix but with healthier Krykna: enemy figure at low HP should win.
    const k1 = entry({ tag: 'krykna-8', missionTargetPriority: 0, currentHp: 8, maxHp: 8 });
    const k2 = entry({ tag: 'krykna-5', missionTargetPriority: 0, currentHp: 5, maxHp: 8 });
    const f1 = entry({ tag: 'fig-3', missionTargetPriority: 1, currentHp: 3, maxHp: 5 });
    assert.equal(best(k1, k2, f1), 'fig-3');
  });
});
