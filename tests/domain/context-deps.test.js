import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXT_GROUPS } from '../../src/context-factory.js';

describe('context-factory dep coverage', () => {
  it('phaseGate context includes all _runStatusPhaseLogic deps', () => {
    // Every key destructured from ctx in _runStatusPhaseLogic (round.js lines 135-174)
    const requiredDeps = [
      'getGame',
      'replyIfGameEnded',
      'getPlayerZoneLabel',
      'logGameAction',
      'updateHandChannelMessages',
      'saveGames',
      'dcMessageMeta',
      'dcExhaustedState',
      'dcHealthState',
      'isDepletedRemovedFromGame',
      'buildDcEmbedAndFiles',
      'getConditionsForDcMessage',
      'getNicknamesForDcMessage',
      'getDcPlayAreaComponents',
      'countTerminalsControlledByPlayer',
      'isFigureInDeploymentZone',
      'checkWinConditions',
      'getMapTokensData',
      'getSpaceController',
      'getMissionRules',
      'runEndOfRoundRules',
      'runStartOfRoundRules',
      'getFiguresOnOrAdjacentToSpace',
      'runNpcThugActivation',
      'runNpcKryknaActivation',
      'applyNpcDamageToFigure',
      'getMapSpaces',
      'getMapRegistry',
      'filterMapSpacesByBounds',
      'getInitiativePlayerZoneLabel',
      'updateHandVisualMessage',
      'buildHandDisplayPayload',
      'sendRoundActivationPhaseMessage',
      'buildBoardMapPayload',
      'postDevaronDoorButtons',
      'postDevaronCratePushPrompts',
      'postKryknaPushButtons',
      'client',
    ];

    const phaseGateDeps = CONTEXT_GROUPS.phaseGate;

    for (const dep of requiredDeps) {
      assert.ok(
        phaseGateDeps.includes(dep),
        `Missing dep '${dep}' in CONTEXT_GROUPS.phaseGate`,
      );
    }
  });
});
