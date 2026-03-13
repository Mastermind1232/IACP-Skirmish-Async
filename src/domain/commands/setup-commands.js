import { createDomainEvent } from '../events.js';

/**
 * Handles SelectMap command.
 * Emits MapSelected event.
 */
export function handleSelectMap(state, command) {
  const { gameId, playerId, payload } = command;
  const { mapId, missionVariant } = payload;

  if (!mapId) {
    return { events: [], error: 'Missing mapId' };
  }

  const events = [
    createDomainEvent('MapSelected', gameId, playerId, {
      mapId,
      missionVariant: missionVariant || null,
    }),
  ];

  return { events, error: null };
}

/**
 * Handles ConfirmMap command.
 * Emits MapConfirmed event.
 */
export function handleConfirmMap(state, command) {
  const { gameId, playerId, payload } = command;
  const { mapId } = payload;

  const events = [
    createDomainEvent('MapConfirmed', gameId, playerId, {
      mapId: mapId || state.selectedMap,
    }),
  ];

  return { events, error: null };
}

/**
 * Handles DetermineInitiative command.
 * Emits InitiativeDetermined event.
 */
export function handleDetermineInitiative(state, command) {
  const { gameId, playerId, payload } = command;
  const { initiativePlayerNum } = payload;

  if (!initiativePlayerNum) {
    return { events: [], error: 'Missing initiativePlayerNum' };
  }

  const events = [
    createDomainEvent('InitiativeDetermined', gameId, playerId, {
      initiativePlayerNum,
    }),
  ];

  return { events, error: null };
}

/**
 * Handles ChooseDeploymentZone command.
 * Emits DeploymentZoneChosen event.
 */
export function handleChooseDeploymentZone(state, command) {
  const { gameId, playerId, payload } = command;
  const { playerNum, zoneId } = payload;

  if (!zoneId) {
    return { events: [], error: 'Missing zoneId' };
  }

  const events = [
    createDomainEvent('DeploymentZoneChosen', gameId, playerId, {
      playerNum: playerNum || null,
      zoneId,
    }),
  ];

  return { events, error: null };
}

/**
 * Handles DeployFigure command.
 * Emits FigurePlaced event.
 */
export function handleDeployFigure(state, command) {
  const { gameId, playerId, payload } = command;
  const { figureKey, coord, playerNum } = payload;

  if (!figureKey || !coord) {
    return { events: [], error: 'Missing figureKey or coord' };
  }

  const events = [
    createDomainEvent('FigurePlaced', gameId, playerId, {
      figureKey,
      coord,
      playerNum: playerNum || null,
    }),
  ];

  return { events, error: null };
}

/**
 * Handles FinishDeployment command.
 * Emits DeploymentCompleted event.
 */
export function handleFinishDeployment(state, command) {
  const { gameId, playerId, payload } = command;
  const { playerNum } = payload;

  const events = [
    createDomainEvent('DeploymentCompleted', gameId, playerId, {
      playerNum: playerNum || null,
    }),
  ];

  return { events, error: null };
}

/**
 * Handles SubmitSquad command.
 * Emits SquadSubmitted event.
 */
export function handleSubmitSquad(state, command) {
  const { gameId, playerId, payload } = command;
  const { playerNum, affiliation } = payload;

  if (!affiliation) {
    return { events: [], error: 'Missing affiliation' };
  }

  const events = [
    createDomainEvent('SquadSubmitted', gameId, playerId, {
      playerNum: playerNum || null,
      affiliation,
    }),
  ];

  return { events, error: null };
}
