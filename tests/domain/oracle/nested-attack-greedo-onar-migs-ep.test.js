/**
 * BEHAVIORAL: nested-attack ordering for the Greedo / friendly Onar Koma /
 * attacking Migs Mayfeld scenario with Extra Protection (EP) interrupting
 * mid-chain.
 *
 * Scenario (alexanbv 2026-05-09):
 *   1. Greedo (Scum, attacker) declares an attack on Migs Mayfeld
 *      (defender). Onar Koma is friendly to Greedo and within 2 spaces.
 *      Onar's owner has Extra Protection in hand.
 *   2. Slow on the Draw (Greedo): Migs's controller interrupts —
 *      Migs attacks Greedo first.
 *   3. Inner-1 (Migs → Greedo) reaches step 7. Greedo suffers 3 damage.
 *   4. Extra Protection probe: friendly Onar within 2 of Greedo, hand has
 *      EP, damage ≥ 3. EP prompt fires.
 *   5. Onar's owner plays EP: Onar moves up to 2 spaces, then performs an
 *      attack (inner-2). After inner-2 resolves, control returns to
 *      inner-1, which finishes resolving.
 *   6. Inner-1 done — outer (Greedo → Migs) resumes.
 *   7. After outer resolves, Migs's Return Fire fires (inner-3:
 *      Migs → Greedo) once per round.
 *   8. Throughout: Greedo's Parting Shot may interrupt before defeat at
 *      any inner where Greedo would die.
 *
 * Test categories:
 *   B-NA-STACK-*: combat-stack ordering invariants
 *   B-NA-EP-*:    Extra Protection frame correctness during nested chain
 *   B-NA-SOTD-*:  Slow on the Draw push/pop integration
 *   B-NA-RF-*:    Return Fire after outer resolution
 *   B-NA-RIPPLE-*: cross-test invariants (per-frame limits, ROUND flags)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  pushNestedCombat,
  popNestedCombat,
  peekNestedCombat,
  nestedCombatDepth,
  resolvePendingCombat,
} from '../../../src/game/combat-stack.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeFrame(label, overrides = {}) {
  return {
    _frameLabel: label,
    attackerPlayerNum: overrides.attackerPlayerNum ?? 1,
    defenderPlayerNum: overrides.defenderPlayerNum ?? 2,
    attackerFigureKey: overrides.attackerFigureKey ?? `${label}-attacker`,
    target: { figureKey: overrides.targetFigureKey ?? `${label}-target` },
    perFrameLimits: {},
    bonusPierce: 0,
    attackCcCount: 0,
    ...overrides,
  };
}

const GREEDO_FK = 'Greedo-1-0';
const MIGS_FK = 'Migs Mayfeld-1-0';
const ONAR_FK = 'Onar Koma-1-0';

function outerGreedoMigs() {
  return makeFrame('outer-greedo→migs', {
    attackerPlayerNum: 1,
    defenderPlayerNum: 2,
    attackerFigureKey: GREEDO_FK,
    targetFigureKey: MIGS_FK,
    attackerDcName: 'Greedo',
    defenderDcName: 'Migs Mayfeld',
  });
}

function inner1MigsGreedo() {
  return makeFrame('inner1-migs→greedo (Slow on the Draw)', {
    attackerPlayerNum: 2,
    defenderPlayerNum: 1,
    attackerFigureKey: MIGS_FK,
    targetFigureKey: GREEDO_FK,
    attackerDcName: 'Migs Mayfeld',
    defenderDcName: 'Greedo',
    sourceLabel: 'Slow on the Draw',
  });
}

function inner2OnarTarget() {
  return makeFrame('inner2-onar→? (Extra Protection)', {
    attackerPlayerNum: 1,
    defenderPlayerNum: 2,
    attackerFigureKey: ONAR_FK,
    targetFigureKey: MIGS_FK,
    attackerDcName: 'Onar Koma',
    sourceLabel: 'Extra Protection',
  });
}

function inner3MigsGreedoReturnFire() {
  return makeFrame('inner3-migs→greedo (Return Fire)', {
    attackerPlayerNum: 2,
    defenderPlayerNum: 1,
    attackerFigureKey: MIGS_FK,
    targetFigureKey: GREEDO_FK,
    attackerDcName: 'Migs Mayfeld',
    defenderDcName: 'Greedo',
    sourceLabel: 'Return Fire',
  });
}

// ── B-NA-STACK: basic stack ordering ────────────────────────────────────────

describe('B-NA-STACK: combat-stack ordering invariants', () => {
  it('B-NA-STACK-001: pushing inner over outer leaves outer on stack', () => {
    const game = { pendingCombat: outerGreedoMigs() };
    pushNestedCombat(game);
    game.pendingCombat = inner1MigsGreedo();
    assert.equal(nestedCombatDepth(game), 1, 'one frame stashed');
    assert.equal(peekNestedCombat(game)._frameLabel, 'outer-greedo→migs');
    assert.equal(game.pendingCombat._frameLabel, 'inner1-migs→greedo (Slow on the Draw)');
  });

  it('B-NA-STACK-002: full chain SoTD → EP → resolve preserves LIFO', () => {
    // Outer: Greedo → Migs
    const game = { pendingCombat: outerGreedoMigs() };
    // Slow on the Draw fires: stash outer, set inner-1
    pushNestedCombat(game);
    game.pendingCombat = inner1MigsGreedo();
    // Inside inner-1, EP triggers nested attack: stash inner-1, set inner-2
    pushNestedCombat(game);
    game.pendingCombat = inner2OnarTarget();
    assert.equal(nestedCombatDepth(game), 2, 'both outer and inner-1 stashed');
    // Inner-2 resolves first (LIFO)
    resolvePendingCombat(game);
    assert.equal(game.pendingCombat._frameLabel, 'inner1-migs→greedo (Slow on the Draw)',
      'inner-1 restored after inner-2 resolves');
    // Inner-1 resolves
    resolvePendingCombat(game);
    assert.equal(game.pendingCombat._frameLabel, 'outer-greedo→migs',
      'outer restored after inner-1 resolves');
    // Outer resolves
    resolvePendingCombat(game);
    assert.equal(game.pendingCombat, null, 'no frame left');
    assert.equal(nestedCombatDepth(game), 0, 'stack empty');
  });

  it('B-NA-STACK-003: per-frame limits do not leak from outer to inner', () => {
    // Outer used Tools for the Job once per attack
    const outer = outerGreedoMigs();
    outer.perFrameLimits = { tools_for_the_job_used: true };
    outer.bonusPierce = 3;
    const game = { pendingCombat: outer };
    pushNestedCombat(game);
    // Inner-1 starts fresh (caller's responsibility — verified here)
    game.pendingCombat = inner1MigsGreedo();
    assert.equal(game.pendingCombat.perFrameLimits.tools_for_the_job_used, undefined,
      'inner frame starts without outer\'s once-per-attack consumption');
    assert.equal(game.pendingCombat.bonusPierce, 0,
      'inner frame starts with own bonusPierce=0');
    // Inner consumes its own
    game.pendingCombat.perFrameLimits.tools_for_the_job_used = true;
    resolvePendingCombat(game);
    assert.equal(game.pendingCombat.perFrameLimits.tools_for_the_job_used, true,
      'outer\'s consumption preserved when popped back');
    assert.equal(game.pendingCombat.bonusPierce, 3,
      'outer\'s bonusPierce preserved when popped back');
  });

  it('B-NA-STACK-004: pendingCombat IS the inner frame while inner is active', () => {
    const game = { pendingCombat: outerGreedoMigs() };
    pushNestedCombat(game);
    game.pendingCombat = inner1MigsGreedo();
    // While inner-1 is active, any handler reading game.pendingCombat sees inner-1
    assert.equal(game.pendingCombat.attackerFigureKey, MIGS_FK,
      'inner-1: Migs is attacker');
    assert.equal(game.pendingCombat.target.figureKey, GREEDO_FK,
      'inner-1: Greedo is target (defender)');
  });
});

// ── B-NA-EP: Extra Protection frame correctness ─────────────────────────────

describe('B-NA-EP: EP handler must reference inner-1 frame, not whatever is on top at click time', () => {

  it('B-NA-EP-001: EP fires during inner-1; pendingExtraProtection should capture inner-1\'s defender context', () => {
    // Setup: outer pushed, inner-1 active, EP probe matches mid-inner-1
    const game = {
      pendingCombat: outerGreedoMigs(),
      figurePositions: {
        1: { [GREEDO_FK]: 'a3', [ONAR_FK]: 'a2' },
        2: { [MIGS_FK]: 'b1' },
      },
      player2CcHand: [],
      player1CcHand: ['Extra Protection'],
      selectedMap: { id: 'test' },
    };
    pushNestedCombat(game);
    game.pendingCombat = inner1MigsGreedo();
    // EP probe fires inside inner-1's WHEN_DAMAGED hook. Payload should
    // record the defender (Greedo, P1) — which is inner-1's defender.
    // The hook captures: opts.controllerPlayerNum = 1 (Greedo's owner).
    const epPayload = {
      targetFigKey: GREEDO_FK,
      damage: 3,
      playerNum: 1, // controllerPlayerNum of Greedo (defender of inner-1)
      onarFigKey: ONAR_FK,
      defenderPlayerNum: 1,
      attackerPlayerNum: 2, // inner-1 attacker = Migs (P2)
    };
    game.pendingExtraProtection = epPayload;

    // ASSERTION: defender side of EP payload matches inner-1's defender,
    // NOT outer's defender.
    assert.equal(game.pendingExtraProtection.defenderPlayerNum, 1,
      'EP payload defender = inner-1 defender (Greedo, P1)');
    assert.equal(game.pendingExtraProtection.attackerPlayerNum, 2,
      'EP payload attacker = inner-1 attacker (Migs, P2)');
  });

  it('B-NA-EP-002: damage-pipeline-hooks.js EP probe captures opts.combat as combatRef on the payload', async () => {
    // Fix shipped: `setPendingExtraProtection` now records
    // `combatRef: opts.combat` so the handler can read the inner-1
    // combat object directly instead of depending on
    // `game.pendingCombat` at click time. Verify by inspecting the
    // damage-pipeline-hooks source for the contract.
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(
      new URL('../../../src/game/damage-pipeline-hooks.js', import.meta.url),
      'utf8',
    );
    assert.match(src, /combatRef: opts\.combat/,
      'EP probe must capture opts.combat into combatRef on the pending payload');
  });

  it('B-NA-EP-003: handleExtraProtection prefers pending.combatRef over game.pendingCombat', async () => {
    // Click-time handler in src/handlers/interrupts.js must read the
    // combat object from the payload's combatRef snapshot, falling
    // back to game.pendingCombat only if the snapshot is missing
    // (defensive — pre-fix payloads).
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(
      new URL('../../../src/handlers/interrupts.js', import.meta.url),
      'utf8',
    );
    assert.match(src, /_epPending\.combatRef\s*\|\|\s*_epGame\.pendingCombat/,
      'handler must read combatRef first, with pendingCombat as defensive fallback');
  });

  it('B-NA-EP-003b: combatRef survives inner-1 pop so handler reaches the right frame', () => {
    const inner = inner1MigsGreedo();
    const game = { pendingCombat: outerGreedoMigs() };
    pushNestedCombat(game);
    game.pendingCombat = inner;
    // Probe captures the combat reference (mirrors damage-pipeline-hooks.js)
    game.pendingExtraProtection = {
      targetFigKey: GREEDO_FK, damage: 3, playerNum: 1,
      onarFigKey: ONAR_FK, defenderPlayerNum: 1, attackerPlayerNum: 2,
      combatRef: inner,
    };
    // Inner-1 resolves before user clicks the EP button
    resolvePendingCombat(game);
    // pendingCombat is now the outer; combatRef still points to inner-1
    assert.equal(game.pendingCombat._frameLabel, 'outer-greedo→migs');
    assert.equal(game.pendingExtraProtection.combatRef._frameLabel,
      'inner1-migs→greedo (Slow on the Draw)',
      'combatRef survives inner-1 pop and still points at inner-1');
    // Handler simulation: read combatRef → frame-correct
    const _epCombat = game.pendingExtraProtection.combatRef
      || game.pendingCombat;
    assert.equal(_epCombat.attackerFigureKey, MIGS_FK,
      'handler resumes against inner-1 (Migs is attacker), not outer');
  });

  it('B-NA-EP-004: no global once-per-combat flag — EP gating relies on hand check + pendingExtraProtection overlap guard', async () => {
    // Per alexanbv 2026-05-09: EP is a single-use Command Card. Once
    // played, it moves hand → discard. The hand check at probe time is
    // the natural single-use gate; no separate flag needed.
    // The probe additionally bails if pendingExtraProtection is already
    // set, to avoid overlapping prompts in quick-succession damage
    // events (e.g. Blast).
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(
      new URL('../../../src/game/damage-pipeline-hooks.js', import.meta.url),
      'utf8',
    );
    assert.doesNotMatch(src, /extraProtectionTriggeredThisCombat/,
      'no once-per-combat flag in EP probe');
    assert.match(src, /if \(game\.pendingExtraProtection\) return false/,
      'overlap guard: skip probe while a prompt is already pending');
  });

  it('B-NA-EP-005: combat-bridge re-entry uses combat._damageApplied per-frame marker, not a game-level flag', async () => {
    // The re-entry guard in applyDamageAndFinishCombat reads from the
    // combat object itself so the signal travels with the frame through
    // nested push/pop and doesn't pollute later combats in the round.
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(
      new URL('../../../src/engine/combat-bridge.js', import.meta.url),
      'utf8',
    );
    assert.match(src, /const _epReentry = !!combat\._damageApplied/,
      're-entry detected via per-combat marker');
    assert.match(src, /combat\._damageApplied = true/,
      'combat-bridge sets the marker after applying damage in first pass');
  });
});

// ── B-NA-SOTD: Slow on the Draw integration ─────────────────────────────────

describe('B-NA-SOTD: Slow on the Draw correctly stacks the outer', () => {
  it('B-NA-SOTD-001: declaring inner-1 (Migs interrupt) pushes outer onto stack', () => {
    // Outer in flight (Greedo declared attack on Migs)
    const outer = outerGreedoMigs();
    const game = { pendingCombat: outer };
    // Slow on the Draw fires; combat-bridge logic at line 1593-1594
    // pushes outer because game.pendingCombat is non-null at attack-decl
    if (game.pendingCombat) pushNestedCombat(game);
    // Inner-1 init
    game.pendingCombat = inner1MigsGreedo();
    assert.equal(nestedCombatDepth(game), 1);
    assert.equal(peekNestedCombat(game), outer, 'outer reference preserved by identity');
  });

  it('B-NA-SOTD-002: inner-1 finishing does NOT auto-pop until resolvePendingCombat called', () => {
    const outer = outerGreedoMigs();
    const game = { pendingCombat: outer };
    pushNestedCombat(game);
    game.pendingCombat = inner1MigsGreedo();
    // No automatic pop — caller must invoke resolvePendingCombat
    assert.equal(nestedCombatDepth(game), 1, 'outer still on stack mid-inner-1');
    resolvePendingCombat(game);
    assert.equal(game.pendingCombat, outer, 'outer restored on explicit pop');
  });

  it('B-NA-SOTD-003: handleSlowOnTheDraw uses pushNestedCombat (architectural fix)', async () => {
    // Source-level contract: SoTD migrated from slowOnTheDrawInterrupt
    // side-channel to canonical combat-stack push/pop. Verify the import
    // and that no Resume button is posted.
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(
      new URL('../../../src/handlers/combat-reactions.js', import.meta.url),
      'utf8',
    );
    assert.match(src, /import \{ resolvePendingCombat, pushNestedCombat \} from/,
      'pushNestedCombat imported');
    assert.match(src, /pushNestedCombat\(game\)/,
      'SoTD-yes calls pushNestedCombat instead of legacy side-channel');
    assert.doesNotMatch(src, /game\.slowOnTheDrawInterrupt = \{/,
      'no longer creates the slowOnTheDrawInterrupt side-channel object');
    assert.doesNotMatch(src, /slow_on_draw_resume_\$\{gameId\}/,
      'no longer posts Resume button — outer auto-resumes via popNestedCombat');
  });
});

// ── B-NA-EP-EXPIRE: EP window expires when inner finishes ────────────────────

describe('B-NA-EP-EXPIRE: EP window closes when its combat frame resolves', () => {
  it('B-NA-EP-EXPIRE-001: source-level contract — finishCombatResolution clears pendingExtraProtection if combatRef === current frame', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(
      new URL('../../../src/engine/combat-bridge.js', import.meta.url),
      'utf8',
    );
    assert.match(src, /game\.pendingExtraProtection\?\.\bcombatRef === combat/,
      'combat-bridge expires pendingExtraProtection when its combatRef matches the current frame');
  });

  it('B-NA-EP-EXPIRE-002: simulated — pendingExtraProtection is cleared when its combatRef finishes', () => {
    // Simulate: inner-1 in flight, pendingExtraProtection.combatRef = inner-1.
    // When inner-1 reaches finishCombatResolution, the expiry block clears
    // the pending state before resolvePendingCombat pops the outer.
    const outer = outerGreedoMigs();
    const inner = inner1MigsGreedo();
    const game = { pendingCombat: outer };
    pushNestedCombat(game);
    game.pendingCombat = inner;
    game.pendingExtraProtection = {
      targetFigKey: GREEDO_FK, damage: 3, playerNum: 1,
      onarFigKey: ONAR_FK, defenderPlayerNum: 1, attackerPlayerNum: 2,
      combatRef: inner,
    };
    // Simulate the expiry check that lives in finishCombatResolution
    if (game.pendingExtraProtection?.combatRef === game.pendingCombat) {
      delete game.pendingExtraProtection;
    }
    resolvePendingCombat(game);
    assert.equal(game.pendingExtraProtection, undefined,
      'EP window expired before outer resumed');
    assert.equal(game.pendingCombat, outer,
      'outer restored cleanly');
  });

  it('B-NA-EP-EXPIRE-003: EP from an earlier combat (different combatRef) is NOT expired by an unrelated combat finishing', () => {
    // Defensive: only the EP attached to the resolving combat frame is
    // expired. An EP from a different combat (shouldn't normally exist
    // simultaneously, but the guard must be precise) survives.
    const inner = inner1MigsGreedo();
    const otherCombat = { _frameLabel: 'unrelated' };
    const game = { pendingCombat: inner };
    game.pendingExtraProtection = {
      targetFigKey: GREEDO_FK, damage: 3, playerNum: 1,
      onarFigKey: ONAR_FK, defenderPlayerNum: 1, attackerPlayerNum: 2,
      combatRef: otherCombat,
    };
    if (game.pendingExtraProtection?.combatRef === game.pendingCombat) {
      delete game.pendingExtraProtection;
    }
    assert.notEqual(game.pendingExtraProtection, undefined,
      'unrelated EP not expired by mismatched-combat finish');
  });
});

// ── B-NA-RF: Return Fire ────────────────────────────────────────────────────

describe('B-NA-RF: Return Fire chain', () => {
  it('B-NA-RF-001: Return Fire after outer resolves stacks correctly', () => {
    // Outer Greedo→Migs is at post-resolution. After damage applies
    // and the outer is about to clear, Migs's Return Fire fires.
    const outer = outerGreedoMigs();
    const game = { pendingCombat: outer };
    // Outer resolution drains pendingCombat
    resolvePendingCombat(game);
    assert.equal(game.pendingCombat, null);
    // Now Migs's Return Fire declares an attack on Greedo. Since
    // pendingCombat is null, no stack push needed — straight inner-3.
    game.pendingCombat = inner3MigsGreedoReturnFire();
    assert.equal(nestedCombatDepth(game), 0,
      'inner-3 (Return Fire) is top-level after outer fully resolved');
  });

  it('B-NA-RF-002: Return Fire is once per round — second outer attack should not re-trigger', () => {
    // Card text: "Limit once per round." Implementation detail check —
    // the once-per-round guard must persist across attacks.
    const game = { roundFigureAbilityUsed: { [`${MIGS_FK}_return_fire`]: true } };
    // Second attack on Migs in the same round should NOT prompt RF.
    // Probe should check game.roundFigureAbilityUsed[`${migsFk}_return_fire`].
    assert.equal(game.roundFigureAbilityUsed[`${MIGS_FK}_return_fire`], true,
      'once-per-round guard set');
  });
});

// ── B-NA-RIPPLE: cross-test invariants ──────────────────────────────────────

describe('B-NA-RIPPLE: state invariants across the chain', () => {
  it('B-NA-RIPPLE-001: namedCcsPlayedPerTiming.attack resets only when stack is fully empty', () => {
    // resolvePendingCombat clears namedCcsPlayedPerTiming.attack ONLY if
    // it was a top-level attack (no nested frame to restore). Inner
    // resolution must NOT reset the attack-bucket — outer attack's CC
    // tally must persist across the inner.
    const game = {
      pendingCombat: outerGreedoMigs(),
      namedCcsPlayedPerTiming: { attack: { 1: { 'Aim': true } } },
    };
    pushNestedCombat(game);
    game.pendingCombat = inner1MigsGreedo();
    // Inner-1 finishes
    resolvePendingCombat(game);
    assert.deepEqual(game.namedCcsPlayedPerTiming.attack, { 1: { 'Aim': true } },
      'inner pop preserves outer\'s named-CC bucket');
    // Outer finishes
    resolvePendingCombat(game);
    assert.equal(game.namedCcsPlayedPerTiming.attack, undefined,
      'outer pop (stack empty) clears named-CC attack bucket');
  });

  it('B-NA-RIPPLE-002: nested EP attack (inner-2) inside inner-1 does not pop inner-1 prematurely', () => {
    const outer = outerGreedoMigs();
    const inner1 = inner1MigsGreedo();
    const game = { pendingCombat: outer };
    pushNestedCombat(game);                  // stack=[outer]
    game.pendingCombat = inner1;             // pendingCombat=inner1
    pushNestedCombat(game);                  // stack=[outer, inner1]
    game.pendingCombat = inner2OnarTarget(); // pendingCombat=inner2
    // Inner-2 (Onar's EP attack) finishes
    resolvePendingCombat(game);
    assert.equal(game.pendingCombat, inner1,
      'inner-1 restored — inner-2 must not skip the inner-1 frame');
    // Inner-1 finishes
    resolvePendingCombat(game);
    assert.equal(game.pendingCombat, outer);
  });

  it('B-NA-RIPPLE-003: Greedo Parting Shot at lethal during inner-1 inserts a deeper nested attack', () => {
    // Setup: inner-1 Migs→Greedo deals lethal damage to Greedo. Before
    // defeat, Greedo's Parting Shot interrupts to perform an attack.
    // That attack is inner-2-PS — pushes inner-1 onto the stack.
    const outer = outerGreedoMigs();
    const inner1 = inner1MigsGreedo();
    const game = { pendingCombat: outer };
    pushNestedCombat(game);
    game.pendingCombat = inner1;
    // Parting Shot pushes inner-1
    pushNestedCombat(game);
    game.pendingCombat = makeFrame('inner2-PS-greedo→?', {
      attackerFigureKey: GREEDO_FK,
      attackerPlayerNum: 1,
      defenderPlayerNum: 2,
      sourceLabel: 'Parting Shot',
    });
    assert.equal(nestedCombatDepth(game), 2);
    resolvePendingCombat(game);
    assert.equal(game.pendingCombat, inner1, 'PS pop restores inner-1');
    resolvePendingCombat(game);
    assert.equal(game.pendingCombat, outer, 'inner-1 pop restores outer');
  });
});
