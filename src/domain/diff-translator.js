import { createDomainEvent } from './events.js';
import { dcNameFromFigureKey } from '../game/dc-helpers.js';

/**
 * Translate a state diff (from event-log.js computeDiff) into domain events.
 * @param {string} handlerKey - the button/select prefix that triggered the change
 * @param {{ set: object, deleted: string[] } | null} diff
 * @param {{ gameId: string, playerId: string, before: object, after: object, correlationId?: string }} context
 * @returns {object[]} array of domain events
 */
export function translateDiffToEvents(handlerKey, diff, context, skipTypes = null) {
  const events = [];
  if (!diff) return events;
  const { set, deleted } = diff;
  const { gameId, playerId, before, after } = context;
  const meta = { correlationId: context.correlationId || null };
  const _skip = skipTypes ? new Set(skipTypes) : null;

  function emit(type, payload) {
    if (_skip && _skip.has(type)) return;
    events.push(createDomainEvent(type, gameId, playerId, payload, meta));
  }

  // ── Phase changes ──
  if (set?.phase && set.phase !== before?.phase) {
    const phaseEvents = translatePhaseChange(before, after, gameId, playerId, meta);
    events.push(...phaseEvents);
  }

  // ── Phase gate ──
  if (set?.phaseGate && !before?.phaseGate) {
    emit('PhaseGateOpened', { gateType: set.phaseGate.phase });
  }
  if (set?.phaseGate && before?.phaseGate) {
    if (set.phaseGate.p1Ready && !before.phaseGate.p1Ready) {
      emit('PhaseGatePlayerReady', { playerNum: 1 });
    }
    if (set.phaseGate.p2Ready && !before.phaseGate.p2Ready) {
      emit('PhaseGatePlayerReady', { playerNum: 2 });
    }
  }
  if (deleted?.includes('phaseGate') || (before?.phaseGate && !after?.phaseGate)) {
    emit('PhaseGateCleared', { gateType: before.phaseGate?.phase || 'unknown' });
  }

  // ── Combat ──
  if (set?.pendingCombat && !before?.pendingCombat) {
    emit('CombatDeclared', {
      attackerMsgId: set.pendingCombat.attackerMsgId,
      defenderMsgId: set.pendingCombat.defenderMsgId,
      attackerPlayerNum: set.pendingCombat.attackerPlayerNum,
    });
  }
  if (set?.pendingCombat && before?.pendingCombat) {
    if (set.pendingCombat.p1Ready && !before.pendingCombat.p1Ready) {
      emit('CombatPlayerReady', { playerNum: 1 });
    }
    if (set.pendingCombat.p2Ready && !before.pendingCombat.p2Ready) {
      emit('CombatPlayerReady', { playerNum: 2 });
    }
    if (set.pendingCombat.attackRoll && !before.pendingCombat.attackRoll) {
      emit('CombatDiceRolled', { side: 'attack', dice: set.pendingCombat.attackRoll });
    }
    if (set.pendingCombat.defenseRoll && !before.pendingCombat.defenseRoll) {
      emit('CombatDiceRolled', { side: 'defense', dice: set.pendingCombat.defenseRoll });
    }
  }
  if ((deleted?.includes('pendingCombat') || (before?.pendingCombat && !after?.pendingCombat))) {
    emit('CombatResolved', { damageDealt: 0, defeated: false });
  }

  // ── Movement ──
  if (set?.moveInProgress) {
    for (const [figKey, moveData] of Object.entries(set.moveInProgress)) {
      if (!before?.moveInProgress?.[figKey]) {
        emit('MovementStarted', { figureKey: figKey, movementPoints: moveData.movementPoints || moveData.remaining || 0 });
      }
    }
  }
  if (before?.moveInProgress) {
    for (const figKey of Object.keys(before.moveInProgress)) {
      if (!after?.moveInProgress?.[figKey]) {
        emit('MovementCompleted', { figureKey: figKey });
      }
    }
  }

  // ── Figure positions (FigureMoved) ──
  if (set?.figurePositions && before?.figurePositions) {
    for (const playerNum of [1, 2]) {
      const beforePos = before.figurePositions?.[playerNum] || {};
      const afterPos = after?.figurePositions?.[playerNum] || {};
      for (const [figKey, newCoord] of Object.entries(afterPos)) {
        const oldCoord = beforePos[figKey];
        if (oldCoord && oldCoord !== newCoord) {
          emit('FigureMoved', { figureKey: figKey, fromCoord: oldCoord, toCoord: newCoord, playerNum, mpCost: 1 });
        }
      }
    }
  }

  // ── Figure defeated (removed from positions) ──
  if (set?.figurePositions && before?.figurePositions) {
    for (const playerNum of [1, 2]) {
      const beforePos = before.figurePositions?.[playerNum] || {};
      const afterPos = after?.figurePositions?.[playerNum] || {};
      for (const figKey of Object.keys(beforePos)) {
        if (!(figKey in afterPos)) {
          emit('FigureDefeated', { figureKey: figKey, dcName: dcNameFromFigureKey(figKey), playerNum });
        }
      }
    }
  }

  // ── VP changes ──
  for (const playerNum of [1, 2]) {
    const vpKey = `player${playerNum}VP`;
    if (set?.[vpKey] && before?.[vpKey]) {
      const diff_vp = (set[vpKey].total || 0) - (before[vpKey].total || 0);
      if (diff_vp > 0) {
        emit('VpAwarded', { playerNum, amount: diff_vp, reason: 'unknown' });
      }
    }
  }

  // ── Conditions ──
  if (set?.figureConditions) {
    for (const [figKey, newConds] of Object.entries(after?.figureConditions || {})) {
      const oldConds = before.figureConditions?.[figKey] || [];
      for (const c of newConds) {
        if (!oldConds.includes(c)) {
          emit('ConditionApplied', { figureKey: figKey, condition: c });
        }
      }
    }
  }

  // ── Activation turn passed ──
  if (set?.currentActivationTurnPlayerId &&
      set.currentActivationTurnPlayerId !== before?.currentActivationTurnPlayerId) {
    const newNum = set.currentActivationTurnPlayerId === after?.player1Id ? 1 : 2;
    emit('ActivationTurnPassed', { newActivePlayerNum: newNum });
  }

  // ── Health changes ──
  if (set?.dcHealthState) {
    for (const [figKey, newHp] of Object.entries(after?.dcHealthState || {})) {
      const oldHp = before.dcHealthState?.[figKey];
      if (oldHp != null && newHp != null && oldHp !== newHp) {
        if (newHp < oldHp) {
          emit('FigureDamaged', { figureKey: figKey, amount: oldHp - newHp });
        } else {
          emit('FigureHealed', { figureKey: figKey, amount: newHp - oldHp, maxHp: newHp });
        }
      }
    }
  }

  // ── Condition removed ──
  if (set?.figureConditions) {
    for (const [figKey, oldConds] of Object.entries(before.figureConditions || {})) {
      const newConds = after?.figureConditions?.[figKey] || [];
      for (const c of oldConds) {
        if (!newConds.includes(c)) {
          emit('ConditionRemoved', { figureKey: figKey, condition: c });
        }
      }
    }
  }

  // ── Power token changes ──
  if (set?.figurePowerTokens || (before?.figurePowerTokens && after?.figurePowerTokens)) {
    const allFigKeys = new Set([
      ...Object.keys(before?.figurePowerTokens || {}),
      ...Object.keys(after?.figurePowerTokens || {}),
    ]);
    for (const figKey of allFigKeys) {
      const oldTokens = [...(before?.figurePowerTokens?.[figKey] || [])];
      const newTokens = [...(after?.figurePowerTokens?.[figKey] || [])];
      // Count tokens by type
      const oldCounts = {};
      for (const t of oldTokens) oldCounts[t] = (oldCounts[t] || 0) + 1;
      const newCounts = {};
      for (const t of newTokens) newCounts[t] = (newCounts[t] || 0) + 1;
      const allTypes = new Set([...Object.keys(oldCounts), ...Object.keys(newCounts)]);
      for (const tokenType of allTypes) {
        const oldCount = oldCounts[tokenType] || 0;
        const newCount = newCounts[tokenType] || 0;
        for (let i = 0; i < newCount - oldCount; i++) {
          emit('PowerTokenGained', { figureKey: figKey, tokenType });
        }
        for (let i = 0; i < oldCount - newCount; i++) {
          emit('PowerTokenSpent', { figureKey: figKey, tokenType });
        }
      }
    }
  }

  // ── DC activation ──
  if (set?.dcActionsData && before?.dcActionsData) {
    for (const [msgId, data] of Object.entries(after?.dcActionsData || {})) {
      if (!before.dcActionsData?.[msgId]) {
        emit('DcActivated', { msgId, totalActions: data?.total || 2 });
      }
    }
  } else if (set?.dcActionsData && !before?.dcActionsData) {
    for (const [msgId, data] of Object.entries(set.dcActionsData || {})) {
      emit('DcActivated', { msgId, totalActions: data?.total || 2 });
    }
  }

  // ── DC action performed ──
  if (set?.dcActionsData && before?.dcActionsData) {
    for (const [msgId, data] of Object.entries(after?.dcActionsData || {})) {
      const oldData = before.dcActionsData?.[msgId];
      if (oldData && data?.remaining != null && oldData.remaining != null) {
        const diff_actions = oldData.remaining - data.remaining;
        if (diff_actions > 0 && data.remaining >= 0) {
          emit('DcActionPerformed', { msgId, actionCost: diff_actions });
        }
      }
    }
  }

  // ── DC ended activation ──
  if (before?.dcActionsData) {
    for (const [msgId, oldData] of Object.entries(before.dcActionsData)) {
      const newData = after?.dcActionsData?.[msgId];
      if (oldData?.remaining > 0 && newData?.remaining === 0) {
        emit('DcEndedActivation', { msgId });
      }
    }
  }

  // ── Round transitions ──
  if (set?.currentRound && set.currentRound !== before?.currentRound) {
    emit('RoundStarted', { roundNumber: set.currentRound });
  }
  if (set?.roundPhase) {
    if (set.roundPhase === 'activation' && before?.roundPhase === 'start_of_round') {
      emit('ActivationPhaseStarted', { activePlayerId: after?.currentActivationTurnPlayerId || null });
    }
    if (set.roundPhase === 'end_of_round' && before?.roundPhase !== 'end_of_round') {
      emit('EndOfRoundStarted', {});
    }
  }
  if (before?.roundPhase && !after?.roundPhase) {
    emit('RoundEnded', { roundNumber: before.currentRound || 0 });
  }

  // ── Combat surge spent ──
  if (set?.pendingCombat && before?.pendingCombat) {
    const oldSurge = before.pendingCombat.surgeRemaining;
    const newSurge = after?.pendingCombat?.surgeRemaining;
    if (oldSurge != null && newSurge != null && newSurge < oldSurge) {
      // Detect which surge was spent from surgesSpent array
      const oldSpent = before.pendingCombat.surgesSpent || [];
      const newSpent = after?.pendingCombat?.surgesSpent || [];
      for (const key of newSpent) {
        if (!oldSpent.includes(key) || newSpent.filter(k => k === key).length > oldSpent.filter(k => k === key).length) {
          emit('CombatSurgeSpent', { surgeKey: key, cost: 1 });
          break; // One surge per handler call
        }
      }
    }
  }

  // ── Combat reroll ──
  if (set?.pendingCombat && before?.pendingCombat) {
    for (const side of ['attack', 'defense']) {
      const rollKey = side === 'attack' ? 'attackRoll' : 'defenseRoll';
      const oldRoll = before.pendingCombat[rollKey];
      const newRoll = after?.pendingCombat?.[rollKey];
      if (oldRoll && newRoll && oldRoll.length === newRoll.length) {
        for (let i = 0; i < oldRoll.length; i++) {
          if (JSON.stringify(oldRoll[i]?.face) !== JSON.stringify(newRoll[i]?.face)) {
            emit('CombatRerollPerformed', { side, dieIndex: i, newFace: newRoll[i].face });
          }
        }
      }
    }
  }

  // ── Figure deployed (new position, not moved) ──
  if (set?.figurePositions) {
    for (const playerNum of [1, 2]) {
      const beforePos = before.figurePositions?.[playerNum] || {};
      const afterPos = after?.figurePositions?.[playerNum] || {};
      for (const [figKey, coord] of Object.entries(afterPos)) {
        if (!(figKey in beforePos)) {
          emit('FigureDeployed', { figureKey: figKey, dcName: figKey.split('-').slice(0, -2).join('-'), playerNum, coord });
        }
      }
    }
  }

  // ── Hand changes ──
  for (const playerNum of [1, 2]) {
    const handKey = `player${playerNum}Hand`;
    const discardKey = `player${playerNum}Discard`;
    const oldHand = before?.[handKey] || [];
    const newHand = after?.[handKey] || [];
    const oldDiscard = before?.[discardKey] || [];
    const newDiscard = after?.[discardKey] || [];

    if (set?.[handKey] || set?.[discardKey]) {
      // Cards that left the hand and entered discard
      for (const card of oldHand) {
        if (!newHand.includes(card) && newDiscard.includes(card) && !oldDiscard.includes(card)) {
          emit('CardPlayed', { playerNum, cardName: card });
        }
      }
      // Cards drawn (appeared in hand, not from discard)
      const drawnCards = newHand.filter(c => !oldHand.includes(c));
      if (drawnCards.length > 0 && !set?.[discardKey]) {
        emit('CardsDrawn', { playerNum, count: drawnCards.length });
      }
    }
  }

  // ── Activation cleanup ──
  // Detected when dcActionsData entry is removed entirely
  if (before?.dcActionsData) {
    for (const msgId of Object.keys(before.dcActionsData)) {
      if (!after?.dcActionsData?.[msgId]) {
        emit('ActivationCleanedUp', { msgId });
      }
    }
  }

  // ── Activation phase ended ──
  if (set?.player1ActivationPhaseEnded && !before?.player1ActivationPhaseEnded) {
    emit('ActivationPhaseEnded', {});
  }

  // ── Deployment completed ──
  if (set?.player1Deployed && !before?.player1Deployed) {
    emit('DeploymentCompleted', { playerNum: 1 });
  }
  if (set?.player2Deployed && !before?.player2Deployed) {
    emit('DeploymentCompleted', { playerNum: 2 });
  }

  // ── Figure strain ──
  if (set?.figureStrain && before?.figureStrain) {
    for (const [figKey, newStrain] of Object.entries(after?.figureStrain || {})) {
      const oldStrain = before.figureStrain?.[figKey] || 0;
      if (newStrain > oldStrain) {
        emit('FigureStrained', { figureKey: figKey, amount: newStrain - oldStrain });
      }
    }
  }

  // ── VP deducted ──
  for (const playerNum of [1, 2]) {
    const vpKey = `player${playerNum}VP`;
    if (set?.[vpKey] && before?.[vpKey]) {
      const diff_vp = (before[vpKey].total || 0) - (after?.[vpKey]?.total || 0);
      if (diff_vp > 0) {
        emit('VpDeducted', { playerNum, amount: diff_vp, reason: 'unknown' });
      }
    }
  }

  // ── Movement points adjusted ──
  if (set?.movementBank && before?.movementBank) {
    for (const [msgId, newBank] of Object.entries(after?.movementBank || {})) {
      const oldBank = before.movementBank?.[msgId];
      if (oldBank && newBank?.remaining != null && oldBank.remaining != null && newBank.remaining !== oldBank.remaining) {
        emit('MovementPointsAdjusted', { msgId, oldMp: oldBank.remaining, newMp: newBank.remaining });
      }
    }
  }

  // ── Card discarded (directly, not via play) ──
  if (set?.player1Discard || set?.player2Discard) {
    for (const playerNum of [1, 2]) {
      const discardKey = `player${playerNum}Discard`;
      const handKey = `player${playerNum}Hand`;
      const oldDiscard = before?.[discardKey] || [];
      const newDiscard = after?.[discardKey] || [];
      const oldHand = before?.[handKey] || [];
      for (const card of newDiscard) {
        if (!oldDiscard.includes(card)) {
          // Only emit CardDiscarded if card wasn't played from hand (CardPlayed already handles that)
          const wasInHand = oldHand.includes(card);
          if (!wasInHand) {
            emit('CardDiscarded', { playerNum, cardName: card });
          }
        }
      }
    }
  }

  // ── Squad submitted ──
  for (const playerNum of [1, 2]) {
    const armyKey = `player${playerNum}Army`;
    if (set?.[armyKey] && !before?.[armyKey]) {
      emit('SquadSubmitted', { playerNum, affiliation: after?.[armyKey]?.affiliation || 'unknown' });
    }
  }

  // ── Objective claimed ──
  for (const playerNum of [1, 2]) {
    const vpKey = `player${playerNum}VP`;
    if (set?.[vpKey] && before?.[vpKey]) {
      const oldObj = before[vpKey].objectives || 0;
      const newObj = after?.[vpKey]?.objectives || 0;
      if (newObj > oldObj) {
        emit('ObjectiveClaimed', { playerNum, amount: newObj - oldObj });
      }
    }
  }

  // ── Terminal controlled ──
  if (set?.terminalControl && before?.terminalControl) {
    for (const [termId, newController] of Object.entries(after?.terminalControl || {})) {
      const oldController = before.terminalControl?.[termId];
      if (newController !== oldController) {
        emit('TerminalControlled', { terminalId: termId, playerNum: newController });
      }
    }
  } else if (set?.terminalControl && !before?.terminalControl) {
    for (const [termId, controller] of Object.entries(set.terminalControl)) {
      emit('TerminalControlled', { terminalId: termId, playerNum: controller });
    }
  }

  // ── Crate collected ──
  if (set?.collectedCrates) {
    const oldCrates = before?.collectedCrates || [];
    const newCrates = after?.collectedCrates || [];
    for (const crate of newCrates) {
      if (!oldCrates.includes(crate)) {
        emit('CrateCollected', { crateId: crate });
      }
    }
  }

  // ── Map type chosen ──
  if (set?.selectedMapType && set.selectedMapType !== before?.selectedMapType) {
    emit('MapTypeChosen', { mapType: set.selectedMapType });
  }

  // ── Negation ──
  if (set?.pendingNegation && !before?.pendingNegation) {
    emit('NegationAttempted', {
      playerNum: set.pendingNegation.playedBy,
      targetCardName: set.pendingNegation.card || 'unknown',
    });
  }
  if (before?.pendingNegation && !after?.pendingNegation) {
    emit('NegationResolved', { negated: !!before.pendingNegation.negated });
  }

  // ── Figure pushed (position change via push handler) ──
  if (set?.figurePositions && before?.figurePositions && /push|dark_energy|face_me/i.test(handlerKey)) {
    for (const playerNum of [1, 2]) {
      const beforePos = before.figurePositions?.[playerNum] || {};
      const afterPos = after?.figurePositions?.[playerNum] || {};
      for (const [figKey, newCoord] of Object.entries(afterPos)) {
        const oldCoord = beforePos[figKey];
        if (oldCoord && oldCoord !== newCoord) {
          emit('FigurePushed', { figureKey: figKey, fromCoord: oldCoord, toCoord: newCoord, playerNum });
        }
      }
    }
  }

  // ── Combat cancelled (pendingCombat deleted without resolution data) ──
  if ((deleted?.includes('pendingCombat') || (before?.pendingCombat && !after?.pendingCombat))
      && /cancel/i.test(handlerKey)) {
    emit('CombatCancelled', {});
  }

  // ── Deck shuffled (discard emptied, deck grew) ──
  for (const playerNum of [1, 2]) {
    const discardKey = `player${playerNum}CcDiscard`;
    const deckKey = `player${playerNum}CcDeck`;
    if (set?.[discardKey] && set?.[deckKey]) {
      const oldDiscard = before?.[discardKey] || [];
      const newDiscard = after?.[discardKey] || [];
      if (oldDiscard.length > 0 && newDiscard.length === 0) {
        emit('DeckShuffled', { playerNum });
      }
    }
  }

  // ── Command cards drawn flag ──
  for (const playerNum of [1, 2]) {
    const key = playerNum === 1 ? 'player1CcDrawn' : 'player2CcDrawn';
    if (set?.[key] && !before?.[key]) {
      emit('CommandCardsDrawn', { playerNum });
    }
  }

  // ── Attachment placed ──
  if (set?.dcAttachments) {
    for (const [dcName, newAttachments] of Object.entries(after?.dcAttachments || {})) {
      const oldAttachments = before?.dcAttachments?.[dcName] || [];
      for (const att of newAttachments) {
        if (!oldAttachments.includes(att)) {
          emit('AttachmentPlaced', { dcName, attachmentName: att });
        }
      }
    }
  }

  // ── Attachments confirmed ──
  if (set?.setupAttachmentConfirmed && !before?.setupAttachmentConfirmed) {
    emit('AttachmentsConfirmed', {});
  }

  // ── Map confirmed ──
  if (set?.confirmedMapId && set.confirmedMapId !== before?.confirmedMapId) {
    emit('MapConfirmed', { mapId: set.confirmedMapId });
  }

  // ── Cleave target selected ──
  if (set?.lastCleaveTarget && set.lastCleaveTarget !== before?.lastCleaveTarget) {
    emit('CleaveTargetSelected', {
      targetFigureKey: set.lastCleaveTarget,
      cleaveDamage: set.lastCleaveDamage || 0,
    });
  }

  // ── Combat damage calculated ──
  if (set?.pendingCombat && before?.pendingCombat) {
    if (set.pendingCombat.netDamage != null && before.pendingCombat.netDamage == null) {
      emit('CombatDamageCalculated', {
        totalDamage: set.pendingCombat.totalDamage || 0,
        totalBlock: set.pendingCombat.totalBlock || 0,
        netDamage: set.pendingCombat.netDamage || 0,
      });
    }
  }

  // ── Movement cancelled ──
  if (before?.moveInProgress && /cancel/i.test(handlerKey)) {
    for (const figKey of Object.keys(before.moveInProgress)) {
      if (!after?.moveInProgress?.[figKey]) {
        emit('MovementCancelled', { figureKey: figKey });
      }
    }
  }

  // ── Draft random started ──
  if (set?.draftRandomStarted && !before?.draftRandomStarted) {
    emit('DraftRandomStarted', {});
  }

  // ── Combat passive applied (bonus fields on pendingCombat) ──
  if (set?.pendingCombat && before?.pendingCombat) {
    for (const bonusKey of ['bonusHits', 'bonusSurge', 'bonusAccuracy', 'bonusBlock', 'bonusEvade', 'bonusPierce', 'bonusBlast']) {
      const oldVal = before.pendingCombat[bonusKey] || 0;
      const newVal = after?.pendingCombat?.[bonusKey] || 0;
      if (newVal !== oldVal && newVal > oldVal) {
        emit('CombatPassiveApplied', { effect: { [bonusKey]: newVal - oldVal } });
      }
    }
  }

  // ── Ability triggered / resolved (via lastResolvedAbility or triggeredAbilities) ──
  if (set?.lastResolvedAbility && !before?.lastResolvedAbility) {
    emit('AbilityResolved', {
      abilityId: set.lastResolvedAbility.abilityId || 'unknown',
      result: set.lastResolvedAbility.result || {},
    });
  }
  if (set?.triggeredAbilities) {
    const oldLen = before?.triggeredAbilities?.length || 0;
    const newArr = after?.triggeredAbilities || [];
    for (let i = oldLen; i < newArr.length; i++) {
      emit('AbilityTriggered', {
        abilityId: newArr[i].abilityId || 'unknown',
        source: newArr[i].source || 'unknown',
      });
    }
  }

  // ── Start/End of round effects run ──
  if (set?.sorEffectsRun) {
    const oldLen = before?.sorEffectsRun?.length || 0;
    const newArr = after?.sorEffectsRun || [];
    for (let i = oldLen; i < newArr.length; i++) {
      emit('StartOfRoundEffectRun', { effectId: newArr[i] });
    }
  }
  if (set?.eorEffectsRun) {
    const oldLen = before?.eorEffectsRun?.length || 0;
    const newArr = after?.eorEffectsRun || [];
    for (let i = oldLen; i < newArr.length; i++) {
      emit('EndOfRoundEffectRun', { effectId: newArr[i] });
    }
  }

  // ── Interrupt prompted / resolved ──
  // Detect any pending* field that looks like an interrupt
  for (const key of Object.keys(set || {})) {
    if (/^pending[A-Z]/.test(key) && set[key]?.interruptType && !before?.[key]) {
      emit('InterruptPrompted', {
        interruptType: set[key].interruptType,
        playerNum: set[key].playerNum || 0,
        pendingField: key,
      });
    }
  }
  for (const key of Object.keys(before || {})) {
    if (/^pending[A-Z]/.test(key) && before[key]?.interruptType && !after?.[key]) {
      emit('InterruptResolved', {
        interruptType: before[key].interruptType,
        pendingField: key,
      });
    }
  }

  return events;
}

function translatePhaseChange(before, after, gameId, playerId, meta) {
  const events = [];
  const newPhase = after?.phase;

  switch (newPhase) {
    case 'initiative':
      events.push(createDomainEvent('MapSelected', gameId, playerId,
        { mapId: after.selectedMap || 'unknown' }, meta));
      break;
    case 'zone_selection':
      events.push(createDomainEvent('InitiativeDetermined', gameId, playerId,
        { initiativePlayerNum: after.initiativePlayerNum || 0 }, meta));
      break;
    case 'deployment':
      events.push(createDomainEvent('DeploymentZoneChosen', gameId, playerId,
        { playerNum: 0, zoneId: 'unknown' }, meta));
      break;
    case 'ended':
      events.push(createDomainEvent('GameEnded', gameId, playerId,
        { winnerId: after.winnerId || null }, meta));
      break;
  }

  return events;
}
