// Rerolls-window combat abilities — executable detection (alexanbv 2026-06-15
// "rewire all of the missing resolvers" + "each ability should call a reroll
// function with certain inputs"). The rerolls gate looks up available reroll
// abilities and posts a button per ability; clicking calls the shared generic
// rerollDie (combat-reroll.js) via a thin _makeRerollResolver entry in
// COMBAT_RESOLVERS (combat.js). Side-effect import.
//
// This file registers the high-coverage GENERIC innate rerolls — every card whose
// ability is "while attacking/defending, reroll N die" collapses to one of these
// (getInnateRerolls counts them). Named/guarded reroll abilities (Saska color
// swap, Armorer block-spent, Ko-Tun token-spent, Guardian Stance multi) graduate
// next, each as its own registration + resolver params. Imported LAST in
// combat-mods-gate.js so executable entries win over the timing-only catalog.

import { getInnateRerolls } from '../game/combat.js';
import { dcNameFromFigureKey } from '../game/index.js';
import { registerCombatAbility } from './combat-timing-registry.js';
import { selectableDieIndices } from './combat-reroll.js';

// Attacker: card grants "reroll N attack dice". Offer while the attacker has an
// innate attack reroll AND at least one attack die is still selectable (unlocked).
registerCombatAbility({
  id: 'innate_attack_reroll', name: 'Reroll Attack Die', windows: ['rerolls'], side: 'attacker', kind: 'interactive',
  applies: (game, combat) => {
    const dcName = combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey || '');
    if ((getInnateRerolls(dcName)?.attackReroll || 0) <= 0) return false;
    return selectableDieIndices(combat, { pool: 'attack' }).length > 0;
  },
});

// Defender: card grants "reroll N defense dice".
registerCombatAbility({
  id: 'innate_defense_reroll', name: 'Reroll Defense Die', windows: ['rerolls'], side: 'defender', kind: 'interactive',
  applies: (game, combat) => {
    const dcName = combat.defenderDcName || (combat.target?.figureKey ? dcNameFromFigureKey(combat.target.figureKey) : '');
    if ((getInnateRerolls(dcName)?.defenseReroll || 0) <= 0) return false;
    return selectableDieIndices(combat, { pool: 'defense' }).length > 0;
  },
});
