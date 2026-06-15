// Zillo-window combat ability — Zillo Technique pierce-cancel (alexanbv
// 2026-06-15 "rewire all of the missing resolvers"). The 'zillo' gate step is a
// defender exhaust window AFTER spend_surges: the defender may exhaust Zillo
// Technique to reduce the attack's Pierce by 2. Detection registers it into the
// combat-timing-registry so the sequence's zillo gate offers it; the executable
// effect lives in COMBAT_RESOLVERS.zillo_technique_pierce_cancel (combat.js).
// Side-effect import.
//
// Detection mirrors src/handlers/combat.js#maybePromptZilloPierceCancel: not yet
// prompted/resolved, non-NPC target, Pierce > 0 after reductions, and the
// defender holds an un-exhausted, non-depleted [Zillo Technique] card.

import { getDcList, getDcMessageIds } from '../game/player-helpers.js';
import { cardNameIncludes } from '../game/card-names.js';
import { registerCombatAbility } from './combat-timing-registry.js';

registerCombatAbility({
  id: 'zillo_technique_pierce_cancel', name: 'Zillo Technique', windows: ['zillo'], side: 'defender', kind: 'interactive',
  applies: (game, combat) => {
    if (combat.zilloPierceCancelPrompted || combat.zilloPierceResolved || combat.target?.isNpc) return false;
    const defPN = combat.defenderPlayerNum;
    if (!defPN) return false;
    const totalPierce = (combat.bonusPierce || 0)
      + (combat.surgePierce || 0)
      + (combat.attackInfo?.pierce || 0)
      - (combat.defenderReducePierce || 0);
    if (totalPierce <= 0) return false;
    const dcList = getDcList(game, defPN) || [];
    const dcMsgIds = getDcMessageIds(game, defPN) || [];
    let ztMsgId = null;
    for (let i = 0; i < dcList.length; i++) {
      if (dcList[i]?.dcName === '[Zillo Technique]') { ztMsgId = dcMsgIds[i] || null; break; }
    }
    if (!ztMsgId) return false;
    const exh = game.exhaustedSkirmishUpgrades?.[ztMsgId] || [];
    if (cardNameIncludes(exh, 'Zillo Technique')) return false;
    const depleted = (game.p1DepletedDcMessageIds || []).includes(ztMsgId)
      || (game.p2DepletedDcMessageIds || []).includes(ztMsgId);
    if (depleted) return false;
    return true;
  },
});
