export const COMBAT_EVENTS = {
  CombatDeclared: 'CombatDeclared',
  CombatPlayerReady: 'CombatPlayerReady',
  CombatDiceRolled: 'CombatDiceRolled',
  CombatRerollPerformed: 'CombatRerollPerformed',
  CombatSurgeSpent: 'CombatSurgeSpent',
  CombatPassiveApplied: 'CombatPassiveApplied',
  CombatTokenApplied: 'CombatTokenApplied',
  CombatDamageCalculated: 'CombatDamageCalculated',
  CombatResolved: 'CombatResolved',
  CombatCancelled: 'CombatCancelled',
  CleaveTargetSelected: 'CleaveTargetSelected',
};

export const COMBAT_EVENT_SCHEMAS = {
  CombatDeclared: { required: ['attackerMsgId', 'defenderMsgId', 'attackerPlayerNum'] },
  CombatPlayerReady: { required: ['playerNum'] },
  CombatDiceRolled: { required: ['side', 'dice'] },
  CombatRerollPerformed: { required: ['side', 'dieIndex', 'newFace'] },
  CombatSurgeSpent: { required: ['surgeKey'] },
  CombatPassiveApplied: { required: ['passiveName', 'effect'] },
  CombatTokenApplied: { required: ['tokenType', 'figureKey'] },
  CombatDamageCalculated: { required: ['totalDamage', 'totalBlock'] },
  CombatResolved: { required: ['damageDealt', 'defeated'] },
  CombatCancelled: { required: [] },
  CleaveTargetSelected: { required: ['targetFigureKey', 'cleaveDamage'] },
};
