// Automatic (always-on) attacker/defender ATTACHMENT passives, wired as real
// gate passives so the gate is the sole pipeline (alexanbv 2026-06-17 step 2:
// "migrate the eager automatic abilities to gate passives"). These were applied
// EAGERLY at attack declaration (handleAttackTarget); now they fire in their
// mods window via _fireModsPassive, gated on the attachment being present on the
// side's own figure. The eager declaration handlers are removed.
//
// Effects live in _fireModsPassive (combat.js) keyed by these ids. Only the
// UNCONDITIONAL stat-bump attachments live here; conditional ones (Heir to the
// Jedi = Ranged-only, Prey on the Weak = cost comparison) graduate once their
// condition data is confirmed available in the passive predicate.
//
// Imported (side-effect) by combat-mods-gate.js.

import { registerCombatAbility } from './combat-timing-registry.js';
import { cardNameIncludes } from '../game/card-names.js';

function attackerAttachments(game, combat) {
  const m = combat?.attackerMsgId;
  return m ? (game?.p1DcAttachments?.[m] || game?.p2DcAttachments?.[m] || []) : [];
}
function defenderAttachments(game, combat) {
  const m = combat?.target?.msgId;
  return m ? (game?.p1DcAttachments?.[m] || game?.p2DcAttachments?.[m] || []) : [];
}

// id ↔ effect handled in _fireModsPassive. card = the attachment name to detect.
const AUTO_ATTACHMENT_PASSIVES = [
  { id: 'driven_by_hatred_hit', name: 'Driven by Hatred', side: 'attacker', card: 'Driven by Hatred' },
  { id: 'wookiee_avenger_hit', name: 'Wookiee Avenger', side: 'attacker', card: 'Wookiee Avenger' },
  { id: 'combat_suit_reduce_pierce', name: 'Combat Suit', side: 'defender', card: 'Combat Suit' },
];

let _registered = false;
export function registerAutoAttachmentPassives() {
  if (_registered) return;
  _registered = true;
  for (const a of AUTO_ATTACHMENT_PASSIVES) {
    registerCombatAbility({
      id: a.id, name: a.name, windows: ['mods'], side: a.side, kind: 'passive',
      applies: (game, combat) => cardNameIncludes(
        a.side === 'attacker' ? attackerAttachments(game, combat) : defenderAttachments(game, combat),
        a.card,
      ),
    });
  }
}

registerAutoAttachmentPassives();
