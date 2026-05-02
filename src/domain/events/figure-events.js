export const FIGURE_EVENTS = {
  FigureDeployed: 'FigureDeployed',
  FigureDamaged: 'FigureDamaged',
  FigureHealed: 'FigureHealed',
  FigureDefeated: 'FigureDefeated',
  FigureStrained: 'FigureStrained',
  ConditionApplied: 'ConditionApplied',
  ConditionRemoved: 'ConditionRemoved',
  PowerTokenGained: 'PowerTokenGained',
  PowerTokenSpent: 'PowerTokenSpent',
};

export const FIGURE_EVENT_SCHEMAS = {
  FigureDeployed: { required: ['figureKey', 'dcName', 'playerNum', 'coord'] },
  FigureDamaged: { required: ['figureKey', 'amount'] },
  FigureHealed: { required: ['figureKey', 'amount'] },
  FigureDefeated: { required: ['figureKey', 'dcName', 'playerNum'] },
  FigureStrained: { required: ['figureKey', 'amount'] },
  ConditionApplied: { required: ['figureKey', 'condition'] },
  ConditionRemoved: { required: ['figureKey', 'condition'] },
  PowerTokenGained: { required: ['figureKey', 'tokenType'] },
  PowerTokenSpent: { required: ['figureKey', 'tokenType'] },
};
