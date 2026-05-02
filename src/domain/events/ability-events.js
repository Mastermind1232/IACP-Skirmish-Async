export const ABILITY_EVENTS = {
  AbilityTriggered: 'AbilityTriggered',
  AbilityResolved: 'AbilityResolved',
  InterruptPrompted: 'InterruptPrompted',
  InterruptResolved: 'InterruptResolved',
  StartOfRoundEffectRun: 'StartOfRoundEffectRun',
  EndOfRoundEffectRun: 'EndOfRoundEffectRun',
};

export const ABILITY_EVENT_SCHEMAS = {
  AbilityTriggered: { required: ['abilityId', 'source'] },
  AbilityResolved: { required: ['abilityId', 'result'] },
  InterruptPrompted: { required: ['interruptType', 'playerNum'] },
  InterruptResolved: { required: ['interruptType', 'choice'] },
  StartOfRoundEffectRun: { required: ['effectId'] },
  EndOfRoundEffectRun: { required: ['effectId'] },
};
