// Exhaust attacker-attachment abilities that grant a simple combat-stat bonus,
// wired as INTERACTIVE gate buttons with exhaust-on-use (alexanbv 2026-06-17:
// "everything that is an exhaust ability should have limit: ready — only exhaust
// if USED, once exhausted no longer offered; remove the double handling").
//
// These were previously DOUBLE-handled: applied EAGERLY at attack declaration
// (handleAttackTarget) AND offered as a no-op `unwired` button by the CSV-window
// loop. Now they are a single gate ability per timing window: offered only while
// the attachment is READY (not exhausted) and on its own figure; clicking it
// applies the bonus and exhausts the card (the gate's _markGateAbilityUsed does
// the exhaust via params.exhaustOnUse). The eager declaration handlers are removed.
//
// Imported LAST in combat-mods-gate.js so these executable entries win over the
// CSV `unwired` no-op registrations (last-write-wins per id).

import { registerCombatAbility } from './combat-timing-registry.js';
import { isAttachmentExhausted } from '../game/card-state-helpers.js';
import { cardNameIncludes } from '../game/card-names.js';

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// effect: the combat field bumped on use. requireDamagedTarget: Feeding Frenzy
// only applies while the target has already suffered damage.
const EXHAUST_BONUS_ABILITIES = [
  { name: 'Scavenged Weaponry', window: 'on_declare', effect: 'hit', label: '+1 Damage' },
  { name: 'Explosive Armaments', window: 'mods', effect: 'blast', label: 'Blast 1' },
  { name: 'Feeding Frenzy', window: 'mods', effect: 'hit', label: '+1 Damage', requireDamagedTarget: true },
];

/** The attacker's own DC attachments (combat.attackerMsgId), or []. */
function attackerAttachments(game, combat) {
  const mid = combat?.attackerMsgId;
  if (!mid) return [];
  return game?.p1DcAttachments?.[mid] || game?.p2DcAttachments?.[mid] || [];
}

/** Has the target figure already suffered damage? (Feeding Frenzy condition.) */
function targetHasSufferedDamage(game, combat, deps) {
  const mid = combat?.target?.msgId;
  const hs = mid ? deps?.dcHealthState?.get?.(mid) : null;
  if (!hs) return false;
  const fi = combat?.target?.figureKey ? parseInt((String(combat.target.figureKey).match(/-(\d+)$/) || [])[1] || '0', 10) : 0;
  const hp = hs[fi];
  return Array.isArray(hp) && hp[0] < hp[1];
}

let _registered = false;
export function registerExhaustBonusAbilities() {
  if (_registered) return;
  _registered = true;
  for (const a of EXHAUST_BONUS_ABILITIES) {
    registerCombatAbility({
      // Reuse the CSV-window id so this EXECUTABLE entry OVERWRITES the `unwired`
      // no-op the CSV loop registered (last-write-wins; imported after it).
      id: `csv:${slug(a.name)}:${a.window}:attacker`,
      name: a.name,
      windows: [a.window],
      side: 'attacker',
      kind: 'interactive',
      params: { kind: 'exhaust_bonus', card: a.name, effect: a.effect, label: a.label, exhaustOnUse: a.name },
      applies: (game, combat, _side, deps) => {
        if (!cardNameIncludes(attackerAttachments(game, combat), a.name)) return false;
        // Offered only while READY (exhaust-on-use, not eagerly).
        if (isAttachmentExhausted(game, combat.attackerMsgId, a.name)) return false;
        if (a.requireDamagedTarget && !targetHasSufferedDamage(game, combat, deps)) return false;
        return true;
      },
    });
  }
}

registerExhaustBonusAbilities();
