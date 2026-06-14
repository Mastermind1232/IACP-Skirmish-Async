// Combat timing-window registry — slice C spine (alexanbv 2026-06-14).
//
// The combat pipeline references TIMING WINDOWS, never specific abilities.
// Each ability registers under one or more windows with a side + kind +
// `applies` predicate. At each window, for each side, the pipeline asks
// abilitiesForWindow() what is eligible right now and resolves passives
// automatically / interactive ones in player-chosen order (via
// combat-ability-gate.js). Adding a new combat ability = one registration;
// the pipeline never changes.
//
// Windows are sequential — an attack walks them in order:
//   on_declare → rerolls → mods → special → after_resolve
// `special` hosts the unique sub-windows that need their own timing:
//   Rapid Recalibration, Zeb (Lasat Honor Guard), Zillo Technique exhaust.
// (When figures suffer damage / are defeated, that routes through the shared
//  damage/defeat pipeline — not a window here.)

export const TIMING_WINDOWS = Object.freeze([
  'on_declare',
  'rerolls',
  'mods',
  'special',
  'after_resolve',
]);

const TIMING_WINDOW_SET = new Set(TIMING_WINDOWS);
const SIDES = new Set(['attacker', 'defender', 'either']);
const KINDS = new Set(['passive', 'interactive']);

/** @type {Map<string, object>} */
const _registry = new Map();

/**
 * Register one combat ability against the timing window(s) it triggers in.
 *
 * @param {object} entry
 * @param {string} entry.id        stable unique id
 * @param {string} entry.name      display name
 * @param {string[]} entry.windows one or more TIMING_WINDOWS values
 * @param {'attacker'|'defender'|'either'} entry.side  whose gate it belongs to
 * @param {'passive'|'interactive'|((game,combat,side)=>'passive'|'interactive')} entry.kind
 *        fixed, or a function for state-dependent kind (e.g. Negotiate)
 * @param {(game:object, combat:object, side:string, deps?:object)=>boolean} [entry.applies]
 *        is this ability eligible in the current combat state? OPTIONAL: omit
 *        for a "timing-only" catalog entry — registered with its window/side/
 *        kind timing indicator but not yet executable (its live detection /
 *        resolution for that window hasn't been wired). Timing-only entries are
 *        NOT returned by abilitiesForWindow (the executable query) but ARE
 *        included by timingIndicatorsForWindow (the completeness view).
 * @param {string} [entry.special]  sub-window tag when windows includes 'special'
 *        (e.g. 'rapid_recal' | 'zeb' | 'zillo_exhaust')
 * @param {string} [entry.detect]  human-readable detection condition (doc)
 */
export function registerCombatAbility(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('registerCombatAbility: entry required');
  const { id, name, windows, side, kind, applies } = entry;
  if (typeof id !== 'string' || !id) throw new Error('registerCombatAbility: id required');
  if (typeof name !== 'string' || !name) throw new Error(`registerCombatAbility(${id}): name required`);
  if (!Array.isArray(windows) || windows.length === 0) throw new Error(`registerCombatAbility(${id}): windows must be a non-empty array`);
  for (const w of windows) if (!TIMING_WINDOW_SET.has(w)) throw new Error(`registerCombatAbility(${id}): unknown window '${w}'`);
  if (!SIDES.has(side)) throw new Error(`registerCombatAbility(${id}): invalid side '${side}'`);
  if (typeof kind !== 'function' && !KINDS.has(kind)) throw new Error(`registerCombatAbility(${id}): kind must be passive|interactive or a function`);
  if (applies != null && typeof applies !== 'function') throw new Error(`registerCombatAbility(${id}): applies must be a function or omitted (timing-only)`);
  _registry.set(id, {
    id, name, windows: [...windows], side, kind,
    applies: applies || null,
    timingOnly: !applies,
    special: entry.special || null,
    detect: entry.detect || null,
  });
}

export function getCombatAbility(id) {
  return _registry.get(id) || null;
}

export function registeredAbilityCount() {
  return _registry.size;
}

/** Test helper: wipe the registry. */
export function clearCombatAbilityRegistry() {
  _registry.clear();
}

/**
 * Resolve the eligible abilities at a timing window for one side, as
 * GateAbility[] (id/name/side/kind) ready to feed combat-ability-gate.js.
 * Kind functions are evaluated against the live combat state here.
 *
 * @param {string} window  a TIMING_WINDOWS value
 * @param {'attacker'|'defender'} side
 * @param {object} game
 * @param {object} combat   game.pendingCombat
 * @param {object} [deps]   injected helpers forwarded to applies/kind (tests)
 * @returns {{id:string,name:string,side:string,kind:'passive'|'interactive',special:?string}[]}
 */
export function abilitiesForWindow(window, side, game, combat, deps = {}) {
  if (!TIMING_WINDOW_SET.has(window)) throw new Error(`abilitiesForWindow: unknown window '${window}'`);
  if (side !== 'attacker' && side !== 'defender') throw new Error(`abilitiesForWindow: side must be attacker|defender, got '${side}'`);
  const out = [];
  for (const e of _registry.values()) {
    if (e.timingOnly) continue; // not executable yet — timing indicator only
    if (!e.windows.includes(window)) continue;
    if (e.side !== side && e.side !== 'either') continue;
    if (!e.applies(game, combat, side, deps)) continue;
    const kind = typeof e.kind === 'function' ? e.kind(game, combat, side) : e.kind;
    if (!KINDS.has(kind)) throw new Error(`abilitiesForWindow: ability '${e.id}' kind() returned invalid '${kind}'`);
    out.push({ id: e.id, name: e.name, side, kind, special: e.special });
  }
  return out;
}

/**
 * Completeness view: EVERY ability registered for a window (executable AND
 * timing-only), regardless of current combat state. Used to verify the catalog
 * is complete and to inspect each ability's timing indicator.
 * @param {string} window
 * @returns {{id,name,side,windows,kind,special,detect,timingOnly}[]}
 */
export function timingIndicatorsForWindow(window) {
  if (!TIMING_WINDOW_SET.has(window)) throw new Error(`timingIndicatorsForWindow: unknown window '${window}'`);
  const out = [];
  for (const e of _registry.values()) {
    if (!e.windows.includes(window)) continue;
    out.push({ id: e.id, name: e.name, side: e.side, windows: [...e.windows], kind: e.kind, special: e.special, detect: e.detect, timingOnly: e.timingOnly });
  }
  return out;
}

/** Every registered ability (completeness/inspection). */
export function allCombatAbilities() {
  return [..._registry.values()].map((e) => ({ id: e.id, name: e.name, side: e.side, windows: [...e.windows], special: e.special, timingOnly: e.timingOnly }));
}
