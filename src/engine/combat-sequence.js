// Canonical attack step sequence — the spine of the gate rebuild
// (alexanbv 2026-06-15 "build the correct sequence and REMOVE legacy paths").
//
// An attack walks these steps in order. GATE steps open an ability gate
// (attacker side fully, then defender side; abilities resolved in the player's
// chosen order with an always-available pass). NON-GATE steps run a mechanic
// (rolling dice, spending surges, computing/applying damage) reusing the
// existing roll/surge/damage functionality. The driver advances step→step;
// nested attacks (Extra Protection, Return Fire) recurse the whole sequence.

/** Ordered attack steps. */
export const ATTACK_STEPS = Object.freeze([
  'on_declare',    // gate: attacker on-declare effects, then defender's
  'roll',          // mechanic: roll the attack/defense pools (Focus adds a die)
  'rerolls',       // gate: attacker rerolls, then defender rerolls
  'special',       // gate: die-turns AFTER ALL rerolls (Zeb / Lasat Honor Guard, Rapid Recalibration)
  'mods',          // gate: attacker result modifiers, then defender's
  'spend_surges',  // mechanic: attacker spends surges (optional)
  'zillo',         // gate: Zillo Technique exhaust (pierce cancel) — AFTER spend_surges
  'damage',        // mechanic: dodge + range/accuracy check, then the damage pipeline
  'after_resolve', // gate: attacker after-attack effects (Blast/Cleave/CCs), then defender's (Return Fire)
]);

/** Steps that open an ability gate / special-ability prompt (the rest are mechanics). */
export const GATE_STEPS = Object.freeze(new Set([
  'on_declare', 'rerolls', 'special', 'mods', 'zillo', 'after_resolve',
]));

/** Is this step a gate window (vs a mechanic step)? */
export function isGateStep(step) {
  return GATE_STEPS.has(step);
}

/** The step after `step`, or null at the end of the sequence. */
export function nextStep(step) {
  const i = ATTACK_STEPS.indexOf(step);
  if (i < 0 || i + 1 >= ATTACK_STEPS.length) return null;
  return ATTACK_STEPS[i + 1];
}

/** The first step of an attack. */
export function firstStep() {
  return ATTACK_STEPS[0];
}
