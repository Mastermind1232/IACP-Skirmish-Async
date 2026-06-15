// Special-window combat abilities — die-turn timing AFTER all rerolls (alexanbv
// 2026-06-15 "rewire all of the missing resolvers"). The 'special' gate step
// holds die-turn abilities that resolve strictly between the reroll buckets and
// the mods step. Detection registers them into the combat-timing-registry so the
// sequence's special gate offers them; the executable effect lives in
// COMBAT_RESOLVERS (combat.js) — lasat_honor_guard / rapid_recalibration via
// _makeDieTurnResolver. Side-effect import (like combat-abilities-mods.js).
//
// Detection mirrors src/handlers/combat.js#_enterStep4 (the legacy Lasat firing
// site): attacker has the Lasat Honor Guard ability, dice are rolled, an
// eligible single-symbol die exists, and it hasn't been used this attack.

import { getDcEffects as _getDcEffects } from '../data-loader.js';
import { dcNameFromFigureKey } from '../game/index.js';
import { registerCombatAbility } from './combat-timing-registry.js';

const D = (deps, name, fallback) => (deps && deps[name]) || fallback;
function eff(deps, dcName) {
  const all = (D(deps, 'getDcEffects', _getDcEffects))() || {};
  return all[dcName] || all[(dcName || '').replace(/\s*\[.*\]\s*$/, '')] || null;
}
const ids = (e) => e?.specialAbilityIds || [];

// Zeb (Lasat Honor Guard): turn one single-symbol attack die to any side.
// Eligible die = (dmg + surge) === 1. Once per attack (lasatHonorGuardUsed).
registerCombatAbility({
  id: 'lasat_honor_guard', name: 'Lasat Honor Guard (Zeb)', windows: ['special'], side: 'attacker', kind: 'interactive',
  applies: (game, combat, side, deps) => {
    if (combat.lasatHonorGuardUsed || !(combat.attackDiceResults?.length > 0) || !combat.attackerFigureKey) return false;
    if (!ids(eff(deps, combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey))).includes('lasat_honor_guard')) return false;
    return combat.attackDiceResults.some((d) => ((d.dmg || 0) + (d.surge || 0)) === 1);
  },
});
