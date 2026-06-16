// Rerolls-window abilities — DATA-DRIVEN from docs/combat-spec.csv (alexanbv
// 2026-06-15 "there are many reroll abilities, you can check Csv. You should not
// be doing these with ad hoc functions"). One loop registers every reroll-pipeline
// row; the gate offers it when the side's player holds the card, and the single
// generic resolver (_makeRerollResolver → rerollDie) serves them all using the
// params DERIVED from the row (pool ← attack_side, count ← effect "reroll N",
// colorSwap ← "color"). No per-ability hand-coded function. Side-effect import.
//
// PHASE 1: the unconditional rows (no freeform `conditional` guard). The ~40
// guarded rows graduate once guard encoding is decided — their detection just
// needs the extra guard predicate; params + resolver are already generic.

import { loadAbilitySpec, getPlayerCardNames } from './combat-ability-db.js';
import { opponentPlayerNum } from '../game/player-helpers.js';
import { registerCombatAbility } from './combat-timing-registry.js';
import { selectableDieIndices } from './combat-reroll.js';
import { conditionForRow, makeCondition } from './combat-conditions.js';

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
function deriveCount(effect) {
  const m = String(effect || '').toLowerCase().match(/reroll\s+(?:up to\s+)?(\d+)/);
  return m ? (parseInt(m[1], 10) || 1) : 1;
}

let _registered = false;
/** Register every UNCONDITIONAL reroll-window CSV row. Idempotent. */
export function registerRerollAbilities() {
  if (_registered) return;
  _registered = true;
  const seen = new Set();
  for (const rows of loadAbilitySpec().values()) {
    for (const r of rows) {
      if (r.timing !== 'attack:rerolls') continue;
      const side = (r.attack_side === 'attacker' || r.attack_side === 'defender') ? r.attack_side : null;
      if (!side) continue;
      const card = r.card;
      // Rapid Recalibration is a die-SWITCH (set a face), not a reroll — it's
      // registered as a die-turn in combat-abilities-special.js. Skip it here so
      // the reroll resolver doesn't shadow the die-turn one (alexanbv 2026-06-16).
      if (card === 'Rapid Recalibration') continue;
      // "Force the defender to reroll a defense die" (Versatile Weaponry) — the
      // ATTACKER's ability, but it rerolls a DEFENSE die and is usable while the
      // owner is attacking (alexanbv 2026-06-16 re-audit). Pool = defense.
      const forcesDefenderReroll = /force the defender to reroll/i.test(r.effect || '');
      let id = `reroll:${slug(card)}:${side}`;
      if (seen.has(id)) {
        // A second reroll ability on the same card+side (e.g. HK's Versatile
        // Weaponry alongside Targeting Computer) — disambiguate by ability so it
        // isn't dropped. First ability keeps the base id (test-stable).
        id = `reroll:${slug(card)}:${slug(r.ability)}:${side}`;
      }
      if (seen.has(id)) continue; // truly duplicate row
      seen.add(id);
      const pool = forcesDefenderReroll ? 'defense' : (side === 'attacker' ? 'attack' : 'defense');
      const params = { kind: 'reroll', pool, count: deriveCount(r.effect), colorSwap: /color/i.test(r.effect || '') };
      // CONDITION (alexanbv 2026-06-16): a DC ability's usability is the row's
      // self-then-others condition (attacker_is_self ∥ owner-centric aura/group),
      // derived from affects_self / affects_others. CC/attachment/upgrade rerolls
      // stay on interim card-presence until their conditions (attachment target,
      // token, exhaust) are encoded.
      const isDC = r.card_type === 'DC';
      // Versatile Weaponry's affects_others="the defender" describes the EFFECT
      // target, not who uses it — the owner (the attacking figure) uses it. So its
      // usability is attacker_is_self, not conditionForRow (which would read it as
      // a defender-grant and return false → never offered).
      const rowCond = forcesDefenderReroll
        ? makeCondition({ type: 'attacker_is_self', card: r.card, side: 'attacker' })
        : (isDC ? conditionForRow(r) : null);
      const cardLc = card.toLowerCase();
      registerCombatAbility({
        // Label with the ABILITY name (Targeting Computer / Foresight), not the
        // figure/card name (alexanbv 2026-06-16 re-audit) — for DC reroll abilities
        // r.card is the figure name.
        id, name: r.ability || card, windows: ['rerolls'], side, kind: 'interactive', params,
        applies: (game, combat) => {
          const pn = side === 'attacker'
            ? combat.attackerPlayerNum
            : (combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum));
          if (!pn) return false;
          if (rowCond) {
            // The ability's figure (or owner-aura) must include the attacker —
            // NOT merely "the player holds the card."
            if (!rowCond(game, combat)) return false;
          } else if (!getPlayerCardNames(game, pn).some((n) => String(n).toLowerCase() === cardLc)) {
            return false;
          }
          return selectableDieIndices(combat, { pool }).length > 0;
        },
      });
    }
  }
}

registerRerollAbilities();
