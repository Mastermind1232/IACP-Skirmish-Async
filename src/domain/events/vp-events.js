export const VP_EVENTS = {
  VpAwarded: 'VpAwarded',
  VpDeducted: 'VpDeducted',
  ObjectiveClaimed: 'ObjectiveClaimed',
  TerminalControlled: 'TerminalControlled',
  CrateCollected: 'CrateCollected',
};

export const VP_EVENT_SCHEMAS = {
  VpAwarded: { required: ['playerNum', 'amount', 'reason'] },
  VpDeducted: { required: ['playerNum', 'amount', 'reason'] },
  ObjectiveClaimed: { required: ['playerNum', 'objectiveId'] },
  TerminalControlled: { required: ['playerNum', 'terminalId'] },
  CrateCollected: { required: ['playerNum', 'crateId'] },
};
