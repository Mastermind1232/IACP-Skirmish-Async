// Combat-frame scaffolding for the combat-pipeline rebuild (slice 2).
//
// This module defines the target state shapes for the rebuild. NOTHING IN
// EXISTING COMBAT CODE CONSUMES THESE YET. The shapes encode the canonical
// CRR attack sequence (per destruct 2026-05-05) so that when slice 3 wires
// the gate machine, ordering is enforced by the state types — not by
// ad-hoc code paths.
//
// Canonical sequence (CRR p.10–11 + Conflicts p.22, refined by destruct):
//   pre-declare → step1+2-attacker → step1+2-defender → roll → step3-attacker →
//   step3-rapidrecal → step3-defender → step4-attacker → step4-defender →
//   step5 → zillo-window → step6 → step7 → step8 → resolved
//
// Within attacker / defender sub-windows the player chooses internal order.
// Counter-window opens after every CC play (opponent-only, alternating, recursive)
// — that's part of CcPlayStack, not the linear step list.

// ── Step ordering ─────────────────────────────────────────────────────────────

/** @typedef {'pre-declare' | 'step1+2-attacker' | 'step1+2-defender' | 'roll' | 'step3-attacker' | 'step3-rapidrecal' | 'step3-defender' | 'step4-attacker' | 'step4-defender' | 'step5' | 'zillo-window' | 'step6' | 'step7' | 'step8' | 'resolved'} CombatStep */

export const COMBAT_STEPS = Object.freeze([
  'pre-declare',
  'step1+2-attacker',
  'step1+2-defender',
  'roll',
  'step3-attacker',
  'step3-rapidrecal',
  'step3-defender',
  'step4-attacker',
  'step4-defender',
  'step5',
  'zillo-window',
  'step6',
  'step7',
  'step8',
  'resolved',
]);

/** Index of step in canonical order, or -1 if unknown. */
export function stepIndex(step) {
  return COMBAT_STEPS.indexOf(step);
}

/** True if `to` follows or equals `from` in canonical order. */
export function canAdvanceStep(from, to) {
  const fi = stepIndex(from);
  const ti = stepIndex(to);
  if (fi < 0 || ti < 0) return false;
  return ti >= fi;
}

// ── ResultSymbol ──────────────────────────────────────────────────────────────

/** @typedef {'damage' | 'surge' | 'hit' | 'block' | 'evade' | 'accuracy' | 'dodge'} ResultKind */

/** @typedef {'rolled-die' | 'power-token' | 'innate' | 'cc-play' | 'cc-discard' | 'condition' | 'surge-ability'} ResultSource */

const RESULT_KINDS = new Set(['damage', 'surge', 'hit', 'block', 'evade', 'accuracy', 'dodge']);
const RESULT_SOURCES = new Set(['rolled-die', 'power-token', 'innate', 'cc-play', 'cc-discard', 'condition', 'surge-ability']);

/**
 * Source-tagged result symbol. One per added symbol — multi-symbol modifiers
 * (e.g. "+2 Hits") expand to N separate ResultSymbol entries.
 *
 * Required for Overwhelming Impact's "ignore non-die defense results" filter
 * (which keeps only `source === 'rolled-die'` defense results) and for Quick
 * Strike's "did defender modify pool/results" tracking.
 *
 * @param {{ kind: ResultKind, value?: number, source: ResultSource }} args
 */
export function makeResultSymbol({ kind, value = 1, source }) {
  if (!RESULT_KINDS.has(kind)) throw new Error(`makeResultSymbol: invalid kind '${kind}'`);
  if (!RESULT_SOURCES.has(source)) throw new Error(`makeResultSymbol: invalid source '${source}'`);
  if (typeof value !== 'number' || value <= 0) throw new Error(`makeResultSymbol: value must be positive number`);
  return Object.freeze({ kind, value, source });
}

// ── Modifier ──────────────────────────────────────────────────────────────────

/** @typedef {'attack' | 'attacker' | 'defender'} ModifierSubjectKind */

/**
 * Subject-binding for a modifier. Drives Get-Behind-Me!-style target swaps:
 * - `attack`: bound to the attack as a whole, survives target swap
 * - `attacker`: bound to the attacker figure (attacker doesn't change mid-attack)
 * - `defender`: bound to a specific defender figure (drops on target swap)
 *
 * @typedef {{ kind: 'attack' } | { kind: 'attacker', figureKey: string } | { kind: 'defender', figureKey: string }} ModifierSubject
 */

const MODIFIER_SUBJECT_KINDS = new Set(['attack', 'attacker', 'defender']);

/**
 * @param {{ source: string, subject: ModifierSubject, effect: object, applyAt: CombatStep }} args
 */
export function makeModifier({ source, subject, effect, applyAt }) {
  if (typeof source !== 'string' || !source) throw new Error('makeModifier: source must be a non-empty string');
  if (!subject || !MODIFIER_SUBJECT_KINDS.has(subject.kind)) throw new Error(`makeModifier: invalid subject.kind`);
  if (subject.kind !== 'attack' && (typeof subject.figureKey !== 'string' || !subject.figureKey)) {
    throw new Error(`makeModifier: subject.kind='${subject.kind}' requires figureKey`);
  }
  if (!effect || typeof effect !== 'object') throw new Error('makeModifier: effect must be object');
  if (stepIndex(applyAt) < 0) throw new Error(`makeModifier: invalid applyAt '${applyAt}'`);
  return Object.freeze({
    source,
    subject: Object.freeze({ ...subject }),
    effect: Object.freeze({ ...effect }),
    applyAt,
  });
}

// ── CcPlayStackEntry ──────────────────────────────────────────────────────────

/**
 * A pending CC play sitting in the counter-window. Counter-windows are
 * opponent-only and alternating: attacker plays Brace → defender prompted
 * for counter → if defender plays Comm Disruption, attacker prompted for
 * counter on CD → etc. Recursion depth tracked by `depth`.
 *
 * On cancellation, the CC discards with ALL triggers suppressed (including
 * its "when discarded" effects, per destruct 2026-05-05).
 *
 * @param {{ ccName: string, playerNum: 1 | 2, payload?: object, depth?: number }} args
 */
export function makeCcPlayStackEntry({ ccName, playerNum, payload = null, depth = 0 }) {
  if (typeof ccName !== 'string' || !ccName) throw new Error('makeCcPlayStackEntry: ccName must be non-empty string');
  if (playerNum !== 1 && playerNum !== 2) throw new Error('makeCcPlayStackEntry: playerNum must be 1 or 2');
  if (typeof depth !== 'number' || depth < 0) throw new Error('makeCcPlayStackEntry: depth must be non-negative');
  return {
    ccName,
    playerNum,
    payload,
    depth,
    canceled: false,
    resolved: false,
  };
}

// ── AttackFrame ───────────────────────────────────────────────────────────────

/**
 * One frame on the combat stack. Root attack = parentFrameId null. Nested
 * attacks (Parting Shot, Final Stand, Extra Protection, Counterattack,
 * Electrobatons Flurry, etc.) push a new frame; completion pops back.
 *
 * Per-attack-frame limits (most "once per attack" abilities) live in
 * `perFrameLimits` and reset per frame — Tools for the Job spent in a parent
 * attack does NOT prevent Tools spent in a nested Parting Shot. Per-activation
 * limits live elsewhere on the game state, not here.
 *
 * @param {{
 *   frameId: string,
 *   parentFrameId?: string | null,
 *   attackerFigureKey: string,
 *   attackerPlayerNum: 1 | 2,
 *   defenderFigureKey: string,
 *   defenderPlayerNum: 1 | 2,
 *   attackPool?: string[],
 *   defensePool?: string[],
 * }} args
 */
export function makeAttackFrame({
  frameId,
  parentFrameId = null,
  attackerFigureKey,
  attackerPlayerNum,
  defenderFigureKey,
  defenderPlayerNum,
  attackPool = [],
  defensePool = [],
}) {
  if (typeof frameId !== 'string' || !frameId) throw new Error('makeAttackFrame: frameId required');
  if (typeof attackerFigureKey !== 'string' || !attackerFigureKey) throw new Error('makeAttackFrame: attackerFigureKey required');
  if (attackerPlayerNum !== 1 && attackerPlayerNum !== 2) throw new Error('makeAttackFrame: attackerPlayerNum must be 1 or 2');
  if (typeof defenderFigureKey !== 'string' || !defenderFigureKey) throw new Error('makeAttackFrame: defenderFigureKey required');
  if (defenderPlayerNum !== 1 && defenderPlayerNum !== 2) throw new Error('makeAttackFrame: defenderPlayerNum must be 1 or 2');
  return {
    frameId,
    parentFrameId,
    attacker: { figureKey: attackerFigureKey, playerNum: attackerPlayerNum },
    defender: { figureKey: defenderFigureKey, playerNum: defenderPlayerNum },
    attackPool: [...attackPool],
    defensePool: [...defensePool],
    attackResults: [],
    defenseResults: [],
    modifiers: [],
    ccPlayStack: [],
    currentStep: 'pre-declare',
    perStepPasses: { attacker: {}, defender: {} },
    perFrameLimits: {},
  };
}

/**
 * Drop modifiers bound to a specific defender. Used when a target swap (e.g.
 * Get Behind Me!) replaces the defender — only `attack`-bound modifiers and
 * `attacker`-bound modifiers persist; `defender:figureKey` modifiers fall off.
 *
 * Returns a NEW modifiers array; does not mutate the frame.
 */
export function dropDefenderBoundModifiers(modifiers, oldDefenderFigureKey) {
  return modifiers.filter((m) => {
    if (m.subject.kind !== 'defender') return true;
    return m.subject.figureKey !== oldDefenderFigureKey;
  });
}

/**
 * Advance a frame's currentStep. Refuses to go backward in canonical order —
 * the engine's gate machine should never need to rewind. Throws on invalid
 * transition so bugs surface loud rather than silently corrupting state.
 *
 * Returns a new frame object (immutable update).
 */
export function advanceFrameStep(frame, toStep) {
  if (!canAdvanceStep(frame.currentStep, toStep)) {
    throw new Error(`advanceFrameStep: cannot advance from '${frame.currentStep}' to '${toStep}'`);
  }
  return { ...frame, currentStep: toStep };
}

// ── Snapshot adapter ──────────────────────────────────────────────────────────

/**
 * Produce a read-only AttackFrame snapshot of the current legacy
 * `game.pendingCombat`. Returns null if no combat is in progress.
 *
 * This adapter is faithful for the structural fields (attacker / defender /
 * pools). The bonus fields (bonusHits, bonusBlock, bonusSurgeAbilities) are
 * NOT yet expanded into Modifier records — that round-trip lands in slice 3
 * when the gate machine starts consuming Modifier semantics. Slice 2's
 * promise is only "the new shape can be constructed and a snapshot of the
 * current attack maps cleanly into it."
 */
export function snapshotPendingCombat(game) {
  const c = game?.pendingCombat;
  if (!c) return null;
  return makeAttackFrame({
    frameId: 'root',
    parentFrameId: null,
    attackerFigureKey: c.attackerFigureKey || 'unknown',
    attackerPlayerNum: c.attackerPlayerNum,
    defenderFigureKey: c.target?.figureKey || 'unknown',
    defenderPlayerNum: c.defenderPlayerNum,
    attackPool: c.attackInfo?.dice || [],
    defensePool: Array.isArray(c.targetStats?.defense)
      ? c.targetStats.defense
      : (c.targetStats?.defense ? [c.targetStats.defense] : []),
  });
}
