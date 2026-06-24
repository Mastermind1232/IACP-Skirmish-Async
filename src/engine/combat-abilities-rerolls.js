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
import { opponentPlayerNum, getCcHand, getDcList, getDcMessageIds } from '../game/player-helpers.js';
import { registerCombatAbility } from './combat-timing-registry.js';
import { selectableDieIndices } from './combat-reroll.js';
import { conditionForRow, makeCondition, limitGuard, abilityLimitKey } from './combat-conditions.js';
import { stripBrackets } from '../game/card-names.js';
import { isAttachmentExhausted, combatSelfAttachmentMsgId, auraAttachmentBearerMsgId } from '../game/card-state-helpers.js';
import { attachmentsForMsgId } from '../game/squad-upgrades.js';
import { getMapData } from '../data-loader.js';
import { isWithinSpaces } from '../game/spatial.js';
import { chargeGeneratorsActive } from './combat-abilities-mods.js';

const _auraBearerDeps = { getMapData, isWithinSpaces, getDcList, getDcMessageIds };

// LINE-OF-SIGHT gated reroll cards (gate-rework 2026-06-18). Maps a CSV card to
// the LOS condition spec that gates its reroll button. Reusable primitives in
// combat-conditions.js do the spatial work; this is the only per-card mapping.
//   includeSelf:true  → the friendly_with_los_to_attacker primitive already
//     folds in the attacker-is-owner branch, so the LOS condition REPLACES the
//     row's self/others condition (Coordinated Hunt).
//   includeSelf:false → the LOS condition is ANDed with attacker_is_self so only
//     the owner's attack triggers it (Light It Up; Shared Calculations is a
//     forces-defender-reroll row whose base is already attacker_is_self).
const LOS_REROLL_CONDITIONS = {
  // "While you or a friendly HUNTER in your line of sight is attacking, it may
  // reroll 1 attack die" — the OWNER (Purge Commander) must be in play; eligible
  // when the attacker IS Purge Commander, or a HUNTER attacker is in Purge
  // Commander's LOS. NOT offered when Purge Commander isn't in the game
  // (alexanbv 2026-06-24 — it was firing for any HUNTER attacker via includeSelf).
  'Purge Commander (Elite)': { type: 'owner_with_los_to_attacker', ownerDcName: 'Purge Commander (Elite)', attackerKeyword: 'HUNTER' },
  // "if a friendly DROID within 3 has LOS to the target space, force the defender
  // to reroll 1 defense die" — the owner (Zuckuss) is attacking AND a DROID aura.
  'Zuckuss': { type: 'friendly_within_n_with_los_to_target', keyword: 'DROID', n: 3, includeSelf: false },
  // "if the target did not have LOS to you at the start of your activation, reroll
  // up to 1 attack die" — the owner (Rebel Pathfinder) attacking + the LOS snapshot.
  'Rebel Pathfinder (Elite)': { type: 'target_no_los_to_attacker_start', includeSelf: false },
};

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
      // Demoralizing Monologue (forced DEFENSE-die reroll + reveal-hand) and
      // Double or Nothing (reroll + conditional double) have BESPOKE effects
      // resolved via their ccEffect (resolveAbility), NOT a generic pick-a-die
      // reroll. Skip them here and register them as kind:'cc' gate buttons below
      // so the button runs the real effect (alexanbv 2026-06-19).
      if (card === 'Demoralizing Monologue' || card === 'Double or Nothing') continue;
      // Field Supply (CC row 654) is a CONDITIONAL token-spend reroll modeled on
      // Ko-Tun's "Dead Precise" (spent-token reroll): it's only offered when the
      // attacking figure spent a Hit/Surge token this attack AND Field Supply was
      // PLAYED at start of round. The generic loop can't express the played-round
      // half, so register it explicitly below (registerFieldSupplyReroll). Skip
      // here so it doesn't also get a wrong card-presence-only button.
      if (card === 'Field Supply') continue;
      // Lasat-Honor Guard (Zeb Orrelios) is a die-TURN that fires AFTER ALL rerolls
      // ("after any rerolls ... turn 1 die showing only a single attack icon to any
      // side") — NOT a reroll. It's registered in the SPECIAL window (die-turn) via
      // combat-abilities-special.js; the CSV files it under attack:rerolls only
      // because the spec lumps die-turns with rerolls. Skip it here so the generic
      // reroll resolver doesn't double-offer it alongside the special-window one
      // (alexanbv 2026-06-18: FIX-7 re-bin to the special window, not rerolls).
      if (r.ability === 'Lasat-Honor Guard') continue;
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
      // AURA exhaust attachments (Trusted Ally — worn by a friendly figure within
      // N spaces of the attacker) exhaust the BEARER's DC, not the attacker's own
      // (alexanbv 2026-06-18 FIX-4). The bearer msgId is located via
      // auraAttachmentBearerMsgId at offer time (ready bearer in range) and at
      // exhaust time (_markGateAbilityUsed reads params.auraExhaustOnUse). The aura
      // range comes from the "within N" in the row text (default 3).
      let auraRange = 3;
      if (isExhaustCard && isAura) {
        const wm = `${r.effect || ''} ${r.conditional || ''}`.match(/within\s+(\d+)/i);
        if (wm) auraRange = parseInt(wm[1], 10) || 3;
        params.auraExhaustOnUse = stripBrackets(card);
        params.auraRange = auraRange;
      }
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
      // ATTACHMENT-SCOPED reroll (Targeting Computer): the CSV reads "figures in
      // THIS GROUP may reroll 1 attack die" — the reroll belongs to the group
      // WEARING the attachment, not player-wide. Non-DC attachment rows have no
      // figure-identity rowCond (isDC=false → rowCond=null below), so without
      // scoping the reroll falls to player-wide card presence and is over-granted
      // to every group the owner controls. Scope it to the attacking side's OWN
      // attachment (combatSelfAttachmentMsgId → that group's attachment list).
      // Only for non-aura attachment rerolls (auras already gate via auraExhaustOnUse).
      const isAttachmentScoped = r.card_type === 'Attachment'
        && !forcesDefenderReroll && !deviceTokenGated
        && !/another friendly|friendly figure within|within \d/i.test(`${r.effect || ''} ${r.conditional || ''}`);
      if (isAttachmentScoped) params.attachmentScopedCard = stripBrackets(card);
      let rowCond = forcesDefenderReroll
        ? makeCondition({ type: 'attacker_is_self', card: r.card, side: 'attacker' })
        : deviceTokenGated
          ? makeCondition({ type: 'attacker_has_device_token' })
          : (isDC ? conditionForRow(r) : null);
      // LINE-OF-SIGHT gated reroll auras (gate-rework 2026-06-18). The CSV
      // self/others prose can't express "in your line of sight" / "has LOS to the
      // target space", so these rows' usability is the LOS condition (reusable
      // primitives in combat-conditions.js), ANDed where a base self-condition
      // also applies. No per-card hardcoding beyond mapping the card → its LOS spec.
      const losSpec = LOS_REROLL_CONDITIONS[r.card];
      if (losSpec) {
        const losCond = makeCondition(losSpec);
        // Coordinated Hunt: usable if the attacker IS Purge Commander (self) OR a
        // friendly HUNTER has LOS to the attacker — the friendly_with_los_to_attacker
        // primitive already includes the self branch (includeSelf), so it replaces
        // the (unmodeled-others) conditionForRow result. Shared Calculations /
        // Light It Up: the LOS condition is the gate; AND it with the self check so
        // a non-owner figure can't trigger another team's card.
        const selfCheck = makeCondition({ type: 'attacker_is_self', card: r.card, side: 'attacker' });
        rowCond = losSpec.includeSelf === false
          ? (game, combat) => selfCheck(game, combat) && losCond(game, combat)
          // "you OR a friendly … in LOS": the owner attacking always qualifies
          // (self branch), else a friendly with LOS does.
          : (game, combat) => selfCheck(game, combat) || losCond(game, combat);
      }
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
          if (params.auraExhaustOnUse) {
            // AURA exhaust attachment (Trusted Ally): offer only while a READY
            // bearer carrying the attachment is within range of the attacker.
            if (!auraAttachmentBearerMsgId(game, combat, params.auraExhaustOnUse, params.auraRange ?? 3, _auraBearerDeps, true)) return false;
          } else if (rowCond) {
            // The ability's figure (or owner-aura) must include the attacker —
            // NOT merely "the player holds the card."
            if (!rowCond(game, combat)) return false;
          } else if (params.attachmentScopedCard) {
            // Group-scoped attachment reroll (Targeting Computer): the attacking
            // side's OWN attachment list must carry the card. This restricts the
            // reroll to the group wearing the attachment instead of player-wide.
            const mid = combatSelfAttachmentMsgId(combat, side);
            const wantLc = params.attachmentScopedCard.toLowerCase();
            const atts = mid ? attachmentsForMsgId(game, mid) : [];
            const worn = (atts || []).some((a) => stripBrackets(String(a?.name || a?.cardName || a)).toLowerCase() === wantLc);
            if (!worn) return false;
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

// Demoralizing Monologue + Double or Nothing — combat-playable reroll CCs whose
// effect is BESPOKE (resolved via resolveAbility / their ccEffect), not a generic
// pick-a-die reroll. Offered as kind:'cc' gate buttons so the button runs the real
// effect through the counter-window → resolveAbility (alexanbv 2026-06-19: every
// combat-playable CC should have ONE working button). Excluded from the generic
// reroll loop above so they don't ALSO get a wrong reroll button.
let _bespokeRerollCcsRegistered = false;
export function registerBespokeRerollCcs() {
  if (_bespokeRerollCcsRegistered) return;
  _bespokeRerollCcsRegistered = true;
  for (const card of ['Demoralizing Monologue', 'Double or Nothing']) {
    registerCombatAbility({
      id: `cc:${slug(card)}:attacker`, name: card, windows: ['rerolls'], side: 'attacker',
      kind: 'interactive', params: { kind: 'cc', card },
      applies: (game, combat) => {
        const pn = combat.attackerPlayerNum;
        if (!pn) return false;
        if (!(getCcHand(game, pn) || []).includes(card)) return false;
        return (combat.attackDiceResults?.length || combat.defenseDiceResults?.length || 0) > 0;
      },
    });
  }
}
registerBespokeRerollCcs();

// Charge Generators (AT-DP) — REROLLS half (FIX-1 split). The card's "you may
// reroll 1 attack die" lives in the rerolls window, gated on the SAME suffered<9
// condition as the mods +1 Damage half (chargeGeneratorsActive). The CSV files
// the whole ability under attack:modifiers, so the data-driven loop never sees
// this — register it explicitly as an attacker reroll (pool 'attack', count 1).
// The generic _makeRerollResolver (via params.kind='reroll') serves it. Distinct
// once-per-attack limit key from the mods half so the two are independent.
let _chargeGenRerollRegistered = false;
export function registerChargeGeneratorsReroll() {
  if (_chargeGenRerollRegistered) return;
  _chargeGenRerollRegistered = true;
  const limGuard = limitGuard('once per attack', abilityLimitKey('AT-DP', 'Charge Generators (Reroll)'));
  registerCombatAbility({
    id: 'charge_generators_reroll', name: 'Charge Generators', windows: ['rerolls'], side: 'attacker',
    kind: 'interactive',
    params: { kind: 'reroll', pool: 'attack', count: 1, colorSwap: false, card: 'AT-DP', ability: 'Charge Generators (Reroll)', limit: 'once per attack' },
    applies: (game, combat, side, deps) => {
      if (!chargeGeneratorsActive(game, combat, deps)) return false;
      if (!limGuard(game, combat)) return false;
      return selectableDieIndices(combat, { pool: 'attack' }).length > 0;
    },
  });
}

registerChargeGeneratorsReroll();

// Field Supply (CC row 654) — attacker-rerolls option modeled on Ko-Tun's "Dead
// Precise" (a reroll gated on the attacker having SPENT a token this attack). Per
// alexanbv: "The reroll from Field Supply should be an option in the ATTACKER
// REROLLS step. Condition: (a) a token was SPENT, and (b) Field Supply was PLAYED
// at start of round. Basically the same as the regular token-spend reroll trigger
// except it also needs the CC played that round. It STACKS with other rerolls."
//
// Condition: combat.attackerSpentHitOrSurgeToken (a Hit/Surge token was spent by
// the attacker THIS attack — marked at the token-spend sites in combat.js) AND
// game.fieldSupplyPlayedRound[attackerPlayerNum] (Field Supply played this round).
// The generic _makeRerollResolver (params.kind='reroll', pool 'attack', count 1)
// serves it; its own once-per-attack limit key keeps it independent of (and
// additive with) every other reroll source. STACKS — not exclusive.
let _fieldSupplyRerollRegistered = false;
export function registerFieldSupplyReroll() {
  if (_fieldSupplyRerollRegistered) return;
  _fieldSupplyRerollRegistered = true;
  const limGuard = limitGuard('once per attack', abilityLimitKey('Field Supply', 'Field Supply'));
  registerCombatAbility({
    id: 'reroll:field_supply:attacker', name: 'Field Supply', windows: ['rerolls'], side: 'attacker',
    kind: 'interactive',
    params: { kind: 'reroll', pool: 'attack', count: 1, colorSwap: false, card: 'Field Supply', ability: 'Field Supply', limit: 'once per attack' },
    applies: (game, combat) => {
      const pn = combat.attackerPlayerNum;
      if (!pn) return false;
      // (a) a Hit/Surge token was spent this attack by the attacker.
      if (!combat.attackerSpentHitOrSurgeToken) return false;
      // (b) Field Supply was played this round by the attacking player.
      if (!game.fieldSupplyPlayedRound?.[pn]) return false;
      if (!limGuard(game, combat)) return false;
      return selectableDieIndices(combat, { pool: 'attack' }).length > 0;
    },
  });
}

registerFieldSupplyReroll();

// ── forcedRerollQueue drain in the GATE rerolls window (gate-rework 2026-06-18) ──
//
// Several reroll-granting effects (Guardian Stance, Battlefield Awareness, Cross
// Training, Doubt, Demoralizing Monologue, Versatile Weaponry, Raider, Precision,
// Survival is Strength, …) have attack_side='None' in the CSV so the data-driven
// registration loop above skips them; the legacy path pushes them into
// combat.forcedRerollQueue (third-party-ccs.js / the ad-hoc reroll path). In GATE
// mode the rerolls window never drained that queue, so those grants were ORPHANED.
//
// Fix: surface each pending queue entry as an optional reroll button in the gate
// rerolls window for the controlling side. Because the gate snapshot fixes its
// interactive id list at build time, we register a small fixed set of SLOTS per
// side (forced_reroll:<side>:<i>); slot i is offered iff there are MORE than i
// pending entries the side controls. The resolver (COMBAT_RESOLVERS) consumes the
// i-th pending entry through the generic reroll path and decrements/clears it.
const FORCED_REROLL_SLOTS = 6; // generous upper bound on simultaneous grants

/** Player number controlling `side` for this combat. */
function _sidePlayerNum(combat, side) {
  return side === 'attacker'
    ? combat?.attackerPlayerNum
    : (combat?.defenderPlayerNum ?? (combat?.attackerPlayerNum ? opponentPlayerNum(combat.attackerPlayerNum) : null));
}
/** The pending (remaining>0) queue entries this side controls, with their queue index. */
export function pendingForcedRerolls(combat, side) {
  const pn = _sidePlayerNum(combat, side);
  if (pn == null) return [];
  const q = combat?.forcedRerollQueue || [];
  const out = [];
  for (let i = 0; i < q.length; i++) {
    const e = q[i];
    if (e && e.controlPlayer === pn && (e.remaining ?? 0) > 0) out.push({ entry: e, queueIndex: i, slot: out.length });
  }
  return out;
}

let _forcedRerollRegistered = false;
export function registerForcedRerollSlots() {
  if (_forcedRerollRegistered) return;
  _forcedRerollRegistered = true;
  for (const side of ['attacker', 'defender']) {
    for (let i = 0; i < FORCED_REROLL_SLOTS; i++) {
      const id = `forced_reroll:${side}:${i}`;
      registerCombatAbility({
        id, name: 'Granted Reroll', windows: ['rerolls'], side, kind: 'interactive',
        params: { kind: 'forced_reroll', slot: i, side },
        // Offer slot i iff this side controls MORE than i pending forced rerolls,
        // AND a die is actually selectable for that entry's pool.
        applies: (game, combat) => {
          const pend = pendingForcedRerolls(combat, side);
          const me = pend[i];
          if (!me) return false;
          const pool = me.entry.pool || 'any';
          if (pool === 'any') {
            return selectableDieIndices(combat, { pool: 'attack' }).length
              + selectableDieIndices(combat, { pool: 'defense' }).length > 0;
          }
          return selectableDieIndices(combat, { pool }).length > 0;
        },
      });
    }
  }
}

registerForcedRerollSlots();
