export const ACTIVATION_EVENTS = {
  DcActivated: 'DcActivated',
  DcActionPerformed: 'DcActionPerformed',
  DcEndedActivation: 'DcEndedActivation',
  ActivationCleanedUp: 'ActivationCleanedUp',
  ActivationTurnPassed: 'ActivationTurnPassed',
};

export const ACTIVATION_EVENT_SCHEMAS = {
  DcActivated: { required: ['msgId', 'dcName', 'playerNum'] },
  DcActionPerformed: { required: ['msgId', 'actionType'] },
  DcEndedActivation: { required: ['msgId'] },
  ActivationCleanedUp: { required: ['msgId'] },
  ActivationTurnPassed: { required: ['newActivePlayerNum'] },
};
