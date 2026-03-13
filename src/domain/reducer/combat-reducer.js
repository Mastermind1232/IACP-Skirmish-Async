export const combatReducerHandlers = {
  CombatDeclared(state, payload) {
    return {
      ...state,
      pendingCombat: {
        attackerMsgId: payload.attackerMsgId,
        defenderMsgId: payload.defenderMsgId,
        attackerPlayerNum: payload.attackerPlayerNum,
        defenderPlayerNum: payload.defenderPlayerNum,
        attackerDcName: payload.attackerDcName || null,
        defenderDcName: payload.defenderDcName || null,
        attackType: payload.attackType || 'melee',
        attackDice: payload.attackDice || [],
        defenseDice: payload.defenseDice || [],
        attackRoll: null,
        defenseRoll: null,
        p1Ready: false,
        p2Ready: false,
        surgeRemaining: 0,
        surgesSpent: [],
        bonusHits: payload.bonusHits || 0,
        bonusAccuracy: payload.bonusAccuracy || 0,
        bonusSurge: payload.bonusSurge || 0,
        bonusBlock: payload.bonusBlock || 0,
        bonusEvade: payload.bonusEvade || 0,
        bonusPierce: payload.bonusPierce || 0,
        bonusBlast: payload.bonusBlast || 0,
        ...(payload.extra || {}),
      },
    };
  },

  CombatPlayerReady(state, payload) {
    const readyKey = payload.playerNum === 1 ? 'p1Ready' : 'p2Ready';
    return {
      ...state,
      pendingCombat: {
        ...state.pendingCombat,
        [readyKey]: true,
      },
    };
  },

  CombatDiceRolled(state, payload) {
    const updates = {};
    if (payload.side === 'attack') {
      updates.attackRoll = payload.dice;
    } else {
      updates.defenseRoll = payload.dice;
    }
    return {
      ...state,
      pendingCombat: {
        ...state.pendingCombat,
        ...updates,
      },
    };
  },

  CombatRerollPerformed(state, payload) {
    const rollKey = payload.side === 'attack' ? 'attackRoll' : 'defenseRoll';
    const newRoll = [...state.pendingCombat[rollKey]];
    newRoll[payload.dieIndex] = {
      ...newRoll[payload.dieIndex],
      face: payload.newFace,
    };
    return {
      ...state,
      pendingCombat: {
        ...state.pendingCombat,
        [rollKey]: newRoll,
      },
    };
  },

  CombatSurgeSpent(state, payload) {
    return {
      ...state,
      pendingCombat: {
        ...state.pendingCombat,
        surgeRemaining: state.pendingCombat.surgeRemaining - (payload.cost || 1),
        surgesSpent: [...state.pendingCombat.surgesSpent, payload.surgeKey],
      },
    };
  },

  CombatPassiveApplied(state, payload) {
    const bonus = {};
    if (payload.effect) {
      for (const [key, value] of Object.entries(payload.effect)) {
        bonus[key] = (state.pendingCombat[key] || 0) + value;
      }
    }
    return {
      ...state,
      pendingCombat: {
        ...state.pendingCombat,
        ...bonus,
      },
    };
  },

  CombatTokenApplied(state, payload) {
    const bonus = {};
    if (payload.effect) {
      for (const [key, value] of Object.entries(payload.effect)) {
        bonus[key] = (state.pendingCombat[key] || 0) + value;
      }
    }
    return {
      ...state,
      pendingCombat: {
        ...state.pendingCombat,
        ...bonus,
      },
    };
  },

  CombatDamageCalculated(state, payload) {
    return {
      ...state,
      pendingCombat: {
        ...state.pendingCombat,
        totalDamage: payload.totalDamage,
        totalBlock: payload.totalBlock,
        netDamage: payload.netDamage,
      },
    };
  },

  CombatResolved(state, payload) {
    const next = { ...state };
    delete next.pendingCombat;
    return next;
  },

  CombatCancelled(state) {
    const next = { ...state };
    delete next.pendingCombat;
    return next;
  },

  CleaveTargetSelected(state, payload) {
    return {
      ...state,
      lastCleaveTarget: payload.targetFigureKey,
      lastCleaveDamage: payload.cleaveDamage,
    };
  },
};
