// Combat-order validator (slice 3.4).
//
// Maps each known CC / DC ability to the canonical CRR step it should fire
// at, per destruct's 2026-05-05 audit. The validator is the **migration
// bridge** between legacy combat.js (no explicit step state) and the new
// orchestrator (combat-orchestrator.js): legacy handlers can invoke
// `classifyCcStep(ccName)` to discover what step a card SHOULD be played
// at, and a future migration sweep will route each handler through the
// orchestrator at that step.
//
// Classification rules (from destruct 2026-05-05):
//   1. Cards that modify the dice pool (add/remove dice) ALWAYS fire in
//      Step 1+2, regardless of the card's literal "while X" / "when X"
//      wording. Pool-mod rule overrides wording.
//   2. Otherwise, the literal trigger phrase determines the step:
//      - "when [you/X] declares an attack" / "when an attack targeting
//        you is declared" / "when [X] declares an attack" → Step 1+2
//      - "while attacking" / "while defending" → Step 4
//      - "after an attack ... resolves" / "after you resolve an attack" →
//        Step 8
//      - "when you suffer damage" / "before you are defeated" → Step 7
//      - "when defeated" → Step 7→8 boundary
//   3. Unique special-window cards (Zillo Technique exhaust) get their
//      own step.
//
// Within each step, conflict order is attacker → defender (CRR p.22).
// Initiative does NOT matter inside an attack.

import { COMBAT_STEPS } from './combat-frame.js';

/**
 * Canonical step classifications for skirmish CCs surveyed in the
 * 2026-05-05 audit. Only includes cards explicitly walked or whose
 * timing is directly inferred from destruct's rules.
 *
 * Format: { ccName: { step, side, reason, source? } }
 *   step: one of COMBAT_STEPS
 *   side: 'attacker' | 'defender' | 'either'
 *   reason: which classification rule applies (pool-mod / literal-on-declare /
 *           literal-while-X / literal-after-resolves / literal-defeat / special)
 */
export const CC_STEP_CLASSIFICATIONS = Object.freeze({
  // ── Step 1+2 (on-declare or pool-mod, attacker side) ────────────────────
  'Element of Surprise': {
    step: 'step1+2-attacker',
    side: 'attacker',
    reason: 'pool-mod (-1 defense die) AND on-declare wording',
  },
  'Tools for the Job': {
    step: 'step1+2-attacker',
    side: 'attacker',
    reason: 'pool-mod (+1 attack die) AND on-declare wording',
  },
  'Concentrated Fire': {
    step: 'step1+2-attacker',
    side: 'attacker',
    reason: 'pool-mod (+1 red die) on friendly TROOPER attack declaration',
  },

  // ── Step 1+2 (on-declare or pool-mod, defender side) ────────────────────
  'On the Lam': {
    step: 'step1+2-defender',
    side: 'defender',
    reason: 'literal "when an attack targeting you is declared"',
  },
  'Camouflage': {
    step: 'step1+2-defender',
    side: 'defender',
    reason: 'literal "when an attack targeting you is declared" (becomes Hidden — condition applied here, modifies results downstream)',
  },
  'Get Behind Me!': {
    step: 'step1+2-defender',
    side: 'defender',
    reason: 'literal "when an attack is declared targeting another friendly figure" (target redirect)',
  },
  'Iron Will': {
    step: 'step1+2-defender',
    side: 'defender',
    reason: 'literal "when an attack targeting you is declared" (damage cap enforced at Step 7)',
  },
  'Brace for Impact': {
    step: 'step1+2-defender',
    side: 'defender',
    reason: 'pool-mod (+1 black die) — pool-mod rule overrides "while defending" wording',
  },
  'Knowledge and Defense': {
    step: 'step1+2-defender',
    side: 'defender',
    reason: 'pool-mod (+1 black die) — pool-mod rule overrides "while defending" wording',
  },

  // ── Step 4 (while-X result modifiers, attacker side) ────────────────────
  'Assassinate': {
    step: 'step4-attacker',
    side: 'attacker',
    reason: 'literal "while attacking" + result modifier (+3 Hits)',
  },
  'Positioning Advantage': {
    step: 'step4-attacker',
    side: 'attacker',
    reason: 'literal "while attacking" + result modifier (+1 Hit)',
  },
  'Overwhelming Impact': {
    step: 'step4-attacker',
    side: 'attacker',
    reason: 'literal "while attacking" + result modifier (+Damage/+Surge per defense die rolled, ignore non-die defense)',
  },

  // ── Step 4 (while-X result modifiers, defender side) ────────────────────
  'Force Illusion': {
    step: 'step4-defender',
    side: 'defender',
    reason: 'literal "while a hostile figure is attacking" (defender becomes Hidden — condition modifies results in Step 4)',
  },
  'Parry': {
    step: 'step4-defender',
    side: 'defender',
    reason: 'literal "while defending" + result modifier (+1 Block or +1 Evade)',
  },

  // ── Step 7 interrupts (during damage application) ───────────────────────
  'Final Stand': {
    step: 'step7',
    side: 'either',
    reason: 'literal "before [a friendly figure] is defeated" — Step 7 interrupt, spawns nested attack',
  },
  'Extra Protection': {
    step: 'step7',
    side: 'either',
    reason: 'literal "when another friendly figure within 2 spaces suffers 3+ Damage" — Step 7 interrupt, spawns nested attack',
  },

  // ── Step 7→8 boundary ("when defeated") ─────────────────────────────────
  'Debts Repaid': {
    step: 'step7',
    side: 'either',
    reason: 'literal "when a friendly figure is defeated" — fires at end of Step 7, before Step 8',
  },

  // ── Step 8 (after attack resolves) ──────────────────────────────────────
  'Furious Charge': {
    step: 'step8',
    side: 'defender',
    reason: 'literal "after an attack targeting you resolves" (fires on miss/dodge too — conditional on damage)',
  },

  // ── Counter cards (counter-window, not a step) ──────────────────────────
  'Negation': {
    step: 'counter-window',
    side: 'either',
    reason: 'opens counter-window on opponent\'s 0-cost CC play; recursive',
  },
  'Comm Disruption': {
    step: 'counter-window',
    side: 'either',
    reason: 'opens counter-window on opponent\'s CC where cost ≤ friendly SPY groups; recursive',
  },
});

/**
 * Returns the canonical CRR step classification for a CC, or null if the
 * card is not in our registry yet. Classification is "best known" — the
 * registry is incrementally populated as cards are audited.
 *
 * @param {string} ccName
 * @returns {{ step: string, side: 'attacker' | 'defender' | 'either', reason: string } | null}
 */
export function classifyCcStep(ccName) {
  if (!ccName || typeof ccName !== 'string') return null;
  return CC_STEP_CLASSIFICATIONS[ccName] || null;
}

/**
 * Validate that a CC is being played at the expected step. Returns
 * `{ ok: true }` if the play is consistent with the canonical
 * classification, `{ ok: false, reason }` otherwise.
 *
 * Counter-window CCs (Negation, Comm Disruption) are special — they can
 * fire whenever the opponent has a CC pending in the counter-window;
 * `currentStep` is checked for compatibility but not strict equality.
 *
 * Returns `{ ok: true, classification: null }` when the CC is unknown to
 * the registry (caller can decide whether unknowns are warnings or
 * errors).
 */
export function validateCcPlayAtStep(ccName, currentStep, { strict = false } = {}) {
  const classification = classifyCcStep(ccName);
  if (!classification) {
    return { ok: !strict, classification: null, reason: `CC '${ccName}' not in registry` };
  }
  if (classification.step === 'counter-window') {
    return { ok: true, classification, reason: 'counter-window CC — valid whenever a CC sits in the counter-window' };
  }
  if (classification.step === currentStep) {
    return { ok: true, classification };
  }
  return {
    ok: false,
    classification,
    reason: `CC '${ccName}' should fire at step '${classification.step}' but combat is at '${currentStep}'`,
  };
}

/**
 * Returns the count of registered classifications, useful for guardrail
 * tests that ensure the registry doesn't shrink unexpectedly.
 */
export function classificationCount() {
  return Object.keys(CC_STEP_CLASSIFICATIONS).length;
}

/**
 * Returns a sanity check that every classified step is in COMBAT_STEPS
 * (or is the special 'counter-window' marker). Throws on mismatch —
 * meant to run as a startup invariant.
 */
export function assertClassificationsAreValid() {
  const validSteps = new Set([...COMBAT_STEPS, 'counter-window']);
  for (const [name, c] of Object.entries(CC_STEP_CLASSIFICATIONS)) {
    if (!validSteps.has(c.step)) {
      throw new Error(`Invalid step '${c.step}' for CC '${name}' — not in COMBAT_STEPS`);
    }
    if (c.side !== 'attacker' && c.side !== 'defender' && c.side !== 'either') {
      throw new Error(`Invalid side '${c.side}' for CC '${name}'`);
    }
  }
}
