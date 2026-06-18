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
import { opponentPlayerNum, getCcHand } from '../game/player-helpers.js';
import { registerCombatAbility } from './combat-timing-registry.js';
import { selectableDieIndices } from './combat-reroll.js';
import { conditionForRow, makeCondition, limitGuard, abilityLimitKey } from './combat-conditions.js';
import { stripBrackets } from '../game/card-names.js';
import { isAttachmentExhausted, combatSelfAttachmentMsgId } from '../game/card-state-helpers.js';

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
      // Gambit + Shrewd Scoundrel (Lando) are NOT standalone reroll sources —
      // they're modifiers ON a reroll (alexanbv 2026-06-16: "gambit applies to
      // ANY reroll, shrewd scoundrel only to Resourceful"). Gambit is injected as
      // a color-swap stage on any of Lando's rerolls; Shrewd Scoundrel is folded
      // into the Resourceful resolver. So don't register them as reroll buttons.
      if (r.ability === 'Gambit' || r.ability === 'Shrewd Scoundrel') continue;
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
      // "the player that rolled it must reroll" idiom (Precision, Raider,
      // Fyrnock Style) — a FORCE-reroll where the owner chooses any die (or a
      // specified pool) and whoever rolled it rerolls it. "choose 1 die" with no
      // pool word → 'any' (offer both pools); "choose 1 attack die" → 'attack'
      // regardless of side (attack dice belong to the attacker). alexanbv 2026-06-17.
      const playerThatRolled = /player that rolled it must reroll|player that rolled it/i.test(r.effect || '');
      let pool;
      if (forcesDefenderReroll) pool = 'defense';
      else if (playerThatRolled) {
        pool = /choose\s+(?:1|one)\s+attack die/i.test(r.effect || '') ? 'attack'
          : /choose\s+(?:1|one)\s+defense die/i.test(r.effect || '') ? 'defense'
            : 'any';
      } else pool = (side === 'attacker' ? 'attack' : 'defense');
      // Survival is Strength (The Armorer): a DEFENDER-side ability that rerolls an
      // ATTACK die (it lets the defending figure reroll an attacker's die after it
      // spent a Block). The default pool=(defender→defense) is WRONG — it must
      // target the attack pool. Detect "reroll … attack die" on a defender row and
      // override the pool to attack. alexanbv 2026-06-18 (gate-rework audit).
      if (side === 'defender' && !playerThatRolled && !forcesDefenderReroll && /reroll\s+(?:up to\s+)?\d*\s*attack die/i.test(r.effect || '')) {
        pool = 'attack';
      }
      // Die-COLOR restriction on the reroll selection (Overpower: "reroll 1 red
      // die" / "reroll 1 black die"). Only dice of that color are selectable — a
      // selection filter, NOT a color swap. Threaded to the resolver as
      // params.dieColor (the gate's _makeRerollResolver builds an `eligible`).
      const colorM = (r.effect || '').match(/reroll\s+(?:up to\s+)?\d*\s*(red|blue|green|yellow|white|black)\s+die/i);
      const dieColor = colorM ? colorM[1].toLowerCase() : null;
      // STRAIN cost on use (Rancor's Trained: "suffer 1 Strain to reroll"). The
      // pipelines column lists "strain;reroll"; the effect names the amount.
      const strainM = (r.effect || '').match(/suffer\s+(\d+)\s+strain/i);
      const strainCost = (/strain/i.test(r.pipelines || '') && strainM) ? (parseInt(strainM[1], 10) || 1) : 0;
      // Default limit is ONCE PER ATTACK (alexanbv 2026-06-17: "everything is by
      // default limit once/attack unless otherwise specified" — there is no
      // unlimited reroll). Only an explicit WIDER scope overrides it: "once per
      // round" (Saska's Power Converter — a shared device-token limit; the global
      // card:ability round key blocks every device-token figure once any uses it)
      // and "once per activation" (Lando's Shrewd Scoundrel, in its bespoke
      // resolver). Per-attack-named rows (Wing Guard, Purge Commander) just match
      // the default. card/ability/limit ride along so the gate's
      // _markGateAbilityUsed marks the owner used-list after the reroll resolves.
      const effLimit = (r.limit && String(r.limit).toLowerCase() !== 'none') ? r.limit : 'once per attack';
      const params = { kind: 'reroll', pool, count: deriveCount(r.effect), colorSwap: /color/i.test(r.effect || ''), card: r.card, ability: r.ability, limit: effLimit };
      if (dieColor) params.dieColor = dieColor;
      if (strainCost) params.strainCost = strainCost;
      const limGuard = limitGuard(effLimit, abilityLimitKey(r.card, r.ability));
      // EXHAUST abilities (alexanbv 2026-06-17: "everything that is an exhaust
      // ability should have limit: ready — only exhaust if used, and once
      // exhausted no longer offered"). Detect an exhaust attachment/upgrade on the
      // side's OWN figure (msgId resolvable from combat); offer only while READY
      // and exhaust it at resolve (handled by _markGateAbilityUsed via
      // params.exhaustOnUse). AURA exhaust attachments (Trusted Ally — worn by a
      // friendly within 3) need the bearer's msgId via dcMessageMeta, not available
      // in this pure predicate, so they stay on the interim path for now.
      const isExhaustCard = (r.card_type === 'Attachment' || r.card_type === 'Upgrade') && /exhaust/i.test(r.effect || '');
      const isAura = /another friendly|friendly figure within|within \d/i.test(`${r.effect || ''} ${r.conditional || ''}`);
      if (isExhaustCard && !isAura) params.exhaustOnUse = stripBrackets(card);
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
      // Device-token grants (Saska's Power Converter) are usable by ANY friendly
      // figure carrying a Device token, not just the source figure — so the
      // attacker-has-token condition REPLACES the figure-identity condition that
      // conditionForRow would otherwise derive. alexanbv 2026-06-17.
      const deviceTokenGated = /device token/i.test(r.conditional || '');
      const rowCond = forcesDefenderReroll
        ? makeCondition({ type: 'attacker_is_self', card: r.card, side: 'attacker' })
        : deviceTokenGated
          ? makeCondition({ type: 'attacker_has_device_token' })
          : (isDC ? conditionForRow(r) : null);
      // Attachment rows carry a BRACKETED card name (e.g. "[The Darksaber]") while
      // game.pXDcAttachments stores the bare name — normalize both with
      // stripBrackets so attachment rerolls are actually offered. alexanbv 2026-06-17.
      const cardLc = stripBrackets(card).toLowerCase();
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
          } else if (!getPlayerCardNames(game, pn).some((n) => stripBrackets(String(n)).toLowerCase() === cardLc)) {
            return false;
          }
          // Don't offer a reroll already used in its scope (default once per
          // attack; wider for Saska/Lando).
          if (!limGuard(game, combat)) return false;
          // Exhaust abilities: offer only while the card is READY (not exhausted).
          if (params.exhaustOnUse) {
            const mid = combatSelfAttachmentMsgId(combat, side);
            if (mid && isAttachmentExhausted(game, mid, params.exhaustOnUse)) return false;
          }
          if (pool === 'any') {
            return selectableDieIndices(combat, { pool: 'attack' }).length
              + selectableDieIndices(combat, { pool: 'defense' }).length > 0;
          }
          // Die-color-restricted rerolls (Overpower) are only offered when a die of
          // the required color is selectable — not just any die in the pool.
          const eligible = params.dieColor ? (d) => String(d?.color || '').toLowerCase() === params.dieColor : undefined;
          return selectableDieIndices(combat, { pool, eligible }).length > 0;
        },
      });
    }
  }
}

registerRerollAbilities();

// Capitalize (CC) — the ATTACKER plays it while attacking to reroll 1 die of
// EITHER pool ("the player that rolled it must reroll"). side='None' in the CSV
// so the data-driven loop skips it; register it explicitly as an attacker
// rerolls CC with pool 'any'. The resolver (COMBAT_RESOLVERS['capitalize'])
// discards the CC + rerolls the chosen die. alexanbv 2026-06-17.
let _capitalizeRegistered = false;
export function registerCapitalize() {
  if (_capitalizeRegistered) return;
  _capitalizeRegistered = true;
  registerCombatAbility({
    id: 'capitalize', name: 'Capitalize', windows: ['rerolls'], side: 'attacker',
    kind: 'interactive', params: { kind: 'capitalize', card: 'Capitalize' },
    applies: (game, combat) => {
      const pn = combat.attackerPlayerNum;
      if (!pn) return false;
      if (!(getCcHand(game, pn) || []).includes('Capitalize')) return false;
      return selectableDieIndices(combat, { pool: 'attack' }).length
        + selectableDieIndices(combat, { pool: 'defense' }).length > 0;
    },
  });
}

registerCapitalize();
