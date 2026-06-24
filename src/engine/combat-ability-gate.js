// Per-step ability-resolution gate — slice C foundation (alexanbv 2026-06-14).
//
// This is the within-a-step layer that combat-pipeline.js's step machine does
// not model. combat-pipeline.js advances BETWEEN steps (recordPlayerPass per
// step); this module governs what happens INSIDE one step, per destruct's
// spec:
//
//   For each step there is an attacker gate, then a defender gate.
//   • PASSIVE abilities (+damage, +1 die, additive result mods that need no
//     decision) fire AUTOMATICALLY when the gate opens.
//   • All OTHER (interactive) abilities are resolved by the active player ONE
//     AT A TIME, in the order THE PLAYER chooses, until they pass.
//   • The attacker gate fully completes (passives auto-fired + player passed)
//     before the defender gate opens. Initiative does not matter inside an
//     attack (CRR p.22 — conflict order is always attacker → defender).
//
// PURE: no game state, no Discord. The live combat loop supplies the ability
// list for a step (classified passive/interactive + side), drives this gate to
// get the next thing to do, and performs the real effect. NOT YET WIRED into
// live combat — wiring is the per-step slices (C-live).

/**
 * @typedef {Object} GateAbility
 * @property {string} id        stable unique id for this pending ability instance
 * @property {string} name      display/card name
 * @property {'attacker'|'defender'} side  which gate it belongs to
 * @property {'passive'|'interactive'} kind  passive = auto-fire; interactive = player-ordered
 */

const SIDES = ['attacker', 'defender'];

function _sideState(abilities, side) {
  const mine = abilities.filter((a) => a.side === side);
  return {
    passive: mine.filter((a) => a.kind === 'passive').map((a) => a.id),
    interactive: mine.filter((a) => a.kind === 'interactive').map((a) => a.id),
    passivesFired: false,
    resolved: [],   // interactive ability ids resolved so far, in chosen order
    passed: false,
  };
}

/**
 * Build a fresh gate for one combat step.
 * @param {string} step  a COMBAT_STEPS value (for traceability; not validated here)
 * @param {GateAbility[]} abilities  every ability eligible at this step (both sides)
 * @returns {object} gate state
 */
export function buildStepGate(step, abilities = []) {
  if (!Array.isArray(abilities)) throw new Error('buildStepGate: abilities must be an array');
  for (const a of abilities) {
    if (!a || typeof a.id !== 'string' || !a.id) throw new Error('buildStepGate: each ability needs a string id');
    if (!SIDES.includes(a.side)) throw new Error(`buildStepGate: ability '${a.id}' has invalid side '${a.side}'`);
    if (a.kind !== 'passive' && a.kind !== 'interactive') throw new Error(`buildStepGate: ability '${a.id}' has invalid kind '${a.kind}'`);
  }
  const ids = abilities.map((a) => a.id);
  if (new Set(ids).size !== ids.length) throw new Error('buildStepGate: duplicate ability ids');
  const byId = {};
  for (const a of abilities) byId[a.id] = { ...a };
  return {
    step,
    byId,
    attacker: _sideState(abilities, 'attacker'),
    defender: _sideState(abilities, 'defender'),
  };
}

/** The side whose gate is currently open: attacker until it completes, then defender, else null. */
export function activeSide(gate) {
  if (!_sideComplete(gate, 'attacker')) return 'attacker';
  if (!_sideComplete(gate, 'defender')) return 'defender';
  return null;
}

function _sideComplete(gate, side) {
  const s = gate[side];
  // A side is complete once its passives have fired AND the player has passed.
  // alexanbv 2026-06-23: EVERY side must be prompted to pass (click Done), even
  // with zero abilities — no window may be auto-skipped. So a zero-ability side
  // is NOT auto-complete; it stays active until passGate() (the live driver
  // posts a Done-only window; self-play / runGate auto-pass it). Removing the
  // old zero-ability short-circuit is what makes empty windows appear.
  return s.passivesFired && s.passed;
}

/** True when both gates are complete and the step can advance. */
export function isGateComplete(gate) {
  return activeSide(gate) === null;
}

/**
 * Pop the passive abilities for the active side that should auto-fire now.
 * Returns the list of passive ability ids (caller fires the real effects),
 * and marks them fired. Idempotent: returns [] if already fired.
 * Throws if called for a side that isn't currently active.
 */
export function autoResolvePassives(gate, side) {
  _assertActive(gate, side, 'autoResolvePassives');
  const s = gate[side];
  if (s.passivesFired) return [];
  s.passivesFired = true;
  return [...s.passive];
}

/**
 * The interactive abilities still available for the active side to resolve, in
 * the original eligible order (the player picks ANY of these next).
 */
export function pendingInteractive(gate, side) {
  const s = gate[side];
  return s.interactive.filter((id) => !s.resolved.includes(id));
}

/**
 * The active player chooses the next interactive ability to resolve. Moves it
 * into `resolved` (preserving chosen order). Returns the ability descriptor so
 * the caller can fire the real effect. Requires passives to have fired first.
 */
export function chooseAbility(gate, side, abilityId) {
  _assertActive(gate, side, 'chooseAbility');
  const s = gate[side];
  if (!s.passivesFired) throw new Error('chooseAbility: resolve passives (autoResolvePassives) before interactive choices');
  if (s.passed) throw new Error('chooseAbility: side already passed its gate');
  if (!s.interactive.includes(abilityId)) throw new Error(`chooseAbility: '${abilityId}' is not an interactive ability for ${side}`);
  if (s.resolved.includes(abilityId)) throw new Error(`chooseAbility: '${abilityId}' already resolved`);
  s.resolved.push(abilityId);
  return gate.byId[abilityId];
}

/**
 * The active player passes (declines to resolve any more interactive abilities
 * this gate). Completes the side; the next call to activeSide() returns the
 * other side (or null). Auto-marks passives fired if the caller never had any
 * interactive abilities to present.
 */
export function passGate(gate, side) {
  _assertActive(gate, side, 'passGate');
  const s = gate[side];
  s.passivesFired = true;
  s.passed = true;
  return gate;
}

function _assertActive(gate, side, fn) {
  if (!SIDES.includes(side)) throw new Error(`${fn}: invalid side '${side}'`);
  const active = activeSide(gate);
  if (active !== side) {
    throw new Error(`${fn}: ${side} gate is not active (active=${active ?? 'none — gate complete'})`);
  }
}

/**
 * Drive a gate to completion via callbacks — the canonical sequence in one
 * place (attacker gate fully, then defender gate; passives auto-fire, then the
 * player resolves interactive abilities in the order they pick, until pass).
 *
 * Used by headless self-play and tests to exercise the full window end-to-end.
 * The live Discord path drives the same gate statefully across button events
 * (build → autoResolvePassives → present pendingInteractive → chooseAbility /
 * passGate) rather than via this single-async-loop driver.
 *
 * @param {object} gate
 * @param {object} cb
 * @param {(side:string, id:string)=>Promise<void>|void} cb.firePassive
 * @param {(side:string, id:string)=>Promise<void>|void} cb.resolveInteractive
 * @param {(side:string, pendingIds:string[])=>Promise<?string>|?string} cb.pickNext
 *        returns the next interactive id to resolve, or null/undefined to pass
 */
export async function runGate(gate, { firePassive, resolveInteractive, pickNext } = {}) {
  let guard = 0;
  while (!isGateComplete(gate)) {
    if (++guard > 10000) throw new Error('runGate: exceeded iteration guard (callback not converging)');
    const side = activeSide(gate);
    for (const id of autoResolvePassives(gate, side)) {
      if (firePassive) await firePassive(side, id);
    }
    while (true) {
      const pending = pendingInteractive(gate, side);
      if (pending.length === 0) break;
      const choice = pickNext ? await pickNext(side, pending) : null;
      if (choice == null) break;
      if (resolveInteractive) await resolveInteractive(side, choice);
      chooseAbility(gate, side, choice);
    }
    passGate(gate, side);
  }
}
