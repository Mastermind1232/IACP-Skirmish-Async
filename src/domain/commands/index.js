export const COMMAND_TYPES = {
  SelectMap: 'SelectMap',
  ConfirmMap: 'ConfirmMap',
  DetermineInitiative: 'DetermineInitiative',
  ChooseDeploymentZone: 'ChooseDeploymentZone',
  DeployFigure: 'DeployFigure',
  FinishDeployment: 'FinishDeployment',
  ActivateDc: 'ActivateDc',
  PerformAction: 'PerformAction',
  EndTurn: 'EndTurn',
  PassActivationTurn: 'PassActivationTurn',
  DeclareAttack: 'DeclareAttack',
  ReadyForCombat: 'ReadyForCombat',
  RollCombatDice: 'RollCombatDice',
  SpendSurge: 'SpendSurge',
  PerformReroll: 'PerformReroll',
  ResolveCombat: 'ResolveCombat',
  StartMovement: 'StartMovement',
  MoveToSpace: 'MoveToSpace',
  CompleteMovement: 'CompleteMovement',
  PlayCommandCard: 'PlayCommandCard',
  DiscardCommandCard: 'DiscardCommandCard',
  DrawCommandCards: 'DrawCommandCards',
  PhaseGateReady: 'PhaseGateReady',
  PhaseGateUnready: 'PhaseGateUnready',
  // Round transitions
  EndEndOfRound: 'EndEndOfRound',
  EndStartOfRound: 'EndStartOfRound',
  StatusPhase: 'StatusPhase',
  // Activation extras
  ConfirmActivate: 'ConfirmActivate',
  CancelActivate: 'CancelActivate',
  DcEndActivation: 'DcEndActivation',
  // Movement extras
  MoveLetter: 'MoveLetter',
  MoveBackLetters: 'MoveBackLetters',
  MoveAdjustMp: 'MoveAdjustMp',
  // Combat extras
  AttackTarget: 'AttackTarget',
  CombatResolveReady: 'CombatResolveReady',
  CombatPassive: 'CombatPassive',
  CombatToken: 'CombatToken',
};

export function createCommand(type, gameId, playerId, payload = {}) {
  return {
    type,
    gameId,
    playerId,
    payload,
    timestamp: new Date().toISOString(),
  };
}
