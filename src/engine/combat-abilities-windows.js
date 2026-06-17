// Generic condition-driven registration for the attack gate windows on_declare /
// mods / after_resolve (alexanbv 2026-06-16: "point the other timing instances to
// it ... offer all buttons even if not wired ... all legal abilities should be
// offered"). One loop registers EVERY CSV row for these windows, per card+side, as
// an executable gate ability whose `applies` is conditionForRow(row) — so each
// window offers all its legal abilities by condition (a diagnostic for missing
// abilities). Unwired effects → no resolver → a no-op button (intentional).
//
// Dedup: skip a row if a HAND-WIRED executable already covers that ability
// name+window (those carry real resolvers + precise detection). Rerolls have their
// own loop (params for the generic reroll resolver); special/zillo are hand-wired.
// Imported LAST in combat-mods-gate.js so the hand-wired entries register first.

import { loadAbilitySpec } from './combat-ability-db.js';
import { registerCombatAbility, getCombatAbility, allCombatAbilities } from './combat-timing-registry.js';
import { conditionForRow, conditionalGuard } from './combat-conditions.js';
import { getCcEffect } from '../data-loader.js';
import { getCcHand, opponentPlayerNum } from '../game/player-helpers.js';
import { figureMatchesCcRestriction } from '../game/cc-timing.js';
import { dcNameFromFigureKey } from '../game/index.js';
import { isCardPendingChange } from './cards-pending-change.js';

// Command Cards played by a figure OTHER than the attacker/defender (reactions by
// a friendly third party) — alexanbv 2026-06-16 said to leave these as exceptions
// for now; they need army-wide / other-figure detection, not the attacker/defender
// figure check. Skipped here so they aren't offered (wrongly) via this path.
// CCs with a bespoke INTERACTIVE combat effect (a sub-pick) used to be routed to
// a dedicated resolver via params.kind 'cc_interactive'. Heightened Reflexes now
// resolves via its removeDefenseDieResults ccEffect (requiresChoice over the
// rolled dice) through the unified counter-window, so this set is empty
// (alexanbv 2026-06-17). Kept for any future bespoke interactive combat CC.
const INTERACTIVE_CC = new Set([]);

const CC_THIRD_PARTY_EXCEPTIONS = new Set([
  'Concentrated Fire', 'Guardian Stance', 'Bodyguard', 'Get Behind Me!',
  'Extra Protection', 'Final Stand', 'Miracle Worker', 'There Is No Try',
  'Battlefield Awareness', 'Unlimited Power',
].map((s) => s.toLowerCase()));

/**
 * Build the `applies` predicate for a Command Card at an attacker/defender gate
 * window (alexanbv 2026-06-16): offer the button iff the card is IN HAND for that
 * side's player AND the attacking (resp. defending) figure satisfies the card's
 * playableBy restriction (unique name / faction / trait / size / unique). The
 * card's own resolve-time conditional (LoS, distance, …) is left to play time;
 * the modeled conditional-column guards are ANDed in.
 */
function ccAppliesFor(card, side, row) {
  const playableBy = (getCcEffect(card)?.playableBy || '').trim();
  const guard = conditionalGuard(row?.conditional, card);
  return (game, combat) => {
    // False Orders / Lure: the CONTROLLER (not the figure's owner) plays the
    // attacker-side on-declare/mods CCs (falseOrdersControllerPlayerNum), so the
    // gate offers from the controller's hand. No-op for normal attacks.
    const pn = side === 'attacker'
      ? (combat?.falseOrdersControllerPlayerNum ?? combat?.attackerPlayerNum)
      : (combat?.defenderPlayerNum ?? (combat?.attackerPlayerNum ? opponentPlayerNum(combat.attackerPlayerNum) : null));
    if (pn == null) return false;
    if (!(getCcHand(game, pn) || []).includes(card)) return false;
    const dcName = side === 'attacker'
      ? (combat?.attackerDcName || dcNameFromFigureKey(combat?.attackerFigureKey || ''))
      : (combat?.defenderDcName || dcNameFromFigureKey(combat?.target?.figureKey || ''));
    if (!figureMatchesCcRestriction(game, dcName, dcName, playableBy)) return false;
    return guard(game, combat);
  };
}

const SPEC_TO_GATE = {
  'attack:on_declare': 'on_declare',
  'attack:modifiers': 'mods',
  'attack:after_resolves': 'after_resolve',
};
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

let _registered = false;
/** Register every on_declare/mods/after_resolve CSV row as a condition-driven gate ability. */
export function registerCsvWindowAbilities() {
  if (_registered) return;
  _registered = true;
  // EXECUTABLE coverage by ability-name + window (hand-wired entries win).
  const covered = new Set();
  for (const a of allCombatAbilities()) {
    if (a.timingOnly) continue;
    for (const w of a.windows) covered.add(`${String(a.name).toLowerCase()}|${w}`);
  }
  const seen = new Set();
  for (const rows of loadAbilitySpec().values()) {
    for (const r of rows) {
      const gate = SPEC_TO_GATE[r.timing];
      if (!gate) continue;
      // Skip cards whose IACP text is mid-change — don't offer the soon-to-be-
      // wrong ability (alexanbv 2026-06-16). See cards-pending-change.js.
      if (isCardPendingChange(r.card)) continue;
      const side = (r.attack_side === 'attacker' || r.attack_side === 'defender') ? r.attack_side : null;
      if (!side) continue;
      // Skip if a hand-wired executable already covers this ability name in this window.
      if (covered.has(`${String(r.ability).toLowerCase()}|${gate}`)) continue;
      const id = `csv:${slug(r.card)}:${gate}:${side}`;
      // Skip if already handled this pass, or if an EXECUTABLE entry already
      // owns this id. A timing-only catalog entry (no applies) is overwritten —
      // this loop imports last specifically to graduate those to executable
      // condition-driven buttons. (CC ids collide with the timing-only ones
      // because card===ability for a Command Card.)
      const existing = getCombatAbility(id);
      if (seen.has(id) || (existing && !existing.timingOnly)) continue;
      seen.add(id);
      const isCc = r.card_type === 'CC';
      // resolution=automatic NON-CC rows are auto-applied passives, not player
      // choices — never offer them as interactive buttons. The CSV loop used to
      // register them as `unwired` no-op buttons, which (combined with the eager
      // declaration handlers that actually apply the effect) was the phantom-button
      // half of the double-handling. Skip them here; they stay eager-handled until
      // migrated to real gate passives. alexanbv 2026-06-17. (CCs are excluded —
      // playing a CC is always a choice even if its effect auto-resolves.)
      if (!isCc && r.resolution === 'automatic') continue;
      // Third-party-figure CCs (Guardian Stance, Concentrated Fire, …) are
      // exceptions handled elsewhere — don't offer them via the attacker/defender
      // figure check.
      if (isCc && CC_THIRD_PARTY_EXCEPTIONS.has(String(r.card).toLowerCase())) continue;
      registerCombatAbility({
        id, name: r.card, windows: [gate], side, kind: 'interactive',
        // CC rows: detection by in-hand + the figure's playableBy restriction, and
        // params.kind 'cc' so the gate dispatches the click to the play-CC pipeline.
        // Non-CC rows: figure-ability conditionForRow detection. Either way an
        // unwired effect is a diagnostic no-op button (offered by condition).
        params: isCc
          // A few CCs have a bespoke INTERACTIVE combat effect (e.g. Heightened
          // Reflexes' "choose a defense die and remove its results") — kind
          // 'cc_interactive' routes them to a dedicated resolver instead of the
          // plain play-CC pipeline (alexanbv 2026-06-16 re-audit).
          ? { kind: INTERACTIVE_CC.has(r.card) ? 'cc_interactive' : 'cc', card: r.card, ability: r.ability, playableBy: (getCcEffect(r.card)?.playableBy || '').trim(), limit: r.limit }
          : { kind: 'unwired', card: r.card, ability: r.ability, limit: r.limit },
        applies: isCc ? ccAppliesFor(r.card, side, r) : conditionForRow(r),
      });
    }
  }
}

registerCsvWindowAbilities();
