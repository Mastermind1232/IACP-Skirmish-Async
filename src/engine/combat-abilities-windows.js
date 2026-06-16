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
import { conditionForRow } from './combat-conditions.js';

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
      const side = (r.attack_side === 'attacker' || r.attack_side === 'defender') ? r.attack_side : null;
      if (!side) continue;
      // Skip if a hand-wired executable already covers this ability name in this window.
      if (covered.has(`${String(r.ability).toLowerCase()}|${gate}`)) continue;
      const id = `csv:${slug(r.card)}:${gate}:${side}`;
      if (seen.has(id) || getCombatAbility(id)) continue;
      seen.add(id);
      registerCombatAbility({
        id, name: r.card, windows: [gate], side, kind: 'interactive',
        // No effect resolver yet → a diagnostic no-op button (offered by condition).
        // limit carried so the pipeline can mark it used (once per round/etc.).
        params: { kind: 'unwired', card: r.card, ability: r.ability, limit: r.limit },
        applies: conditionForRow(r),
      });
    }
  }
}

registerCsvWindowAbilities();
