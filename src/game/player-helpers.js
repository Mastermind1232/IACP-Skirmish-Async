// ── Opponent helper ─────────────────────────────────────────────────────────

export function opponentPlayerNum(pn) { return pn === 1 ? 2 : 1; }

// ── Initiative helper ───────────────────────────────────────────────────────

export function getInitiativePlayerNum(game) {
  return game.initiativePlayerId === game.player1Id ? 1 : 2;
}

// Player-number property accessors — eliminates `pn === 1 ? game.p1X : game.p2X` ternaries.

// ── Getters (read-only access) ──────────────────────────────────────────────

export function getPlayerId(game, pn)             { return pn === 1 ? game.player1Id : game.player2Id; }
export function getDcList(game, pn)               { return pn === 1 ? game.p1DcList : game.p2DcList; }
export function getDcMessageIds(game, pn)          { return pn === 1 ? game.p1DcMessageIds : game.p2DcMessageIds; }
export function getHandChannelId(game, pn)         { return pn === 1 ? game.p1HandId : game.p2HandId; }
export function getPlayAreaId(game, pn)            { return pn === 1 ? game.p1PlayAreaId : game.p2PlayAreaId; }
export function getActivationsRemaining(game, pn)  { return pn === 1 ? game.p1ActivationsRemaining : game.p2ActivationsRemaining; }
export function getActivationsTotal(game, pn)      { return pn === 1 ? game.p1ActivationsTotal : game.p2ActivationsTotal; }
export function getActivationsMessageId(game, pn)  { return pn === 1 ? game.p1ActivationsMessageId : game.p2ActivationsMessageId; }
export function getActivatedDcIndices(game, pn)    { return pn === 1 ? game.p1ActivatedDcIndices : game.p2ActivatedDcIndices; }
export function getDiscardThreadId(game, pn)       { return pn === 1 ? game.p1DiscardThreadId : game.p2DiscardThreadId; }
export function getSquad(game, pn)                 { return pn === 1 ? game.player1Squad : game.player2Squad; }
export function getCcHand(game, pn)                { return pn === 1 ? game.player1CcHand : game.player2CcHand; }
export function getCcDiscard(game, pn)             { return pn === 1 ? game.player1CcDiscard : game.player2CcDiscard; }
export function getCcDeck(game, pn)                { return pn === 1 ? game.player1CcDeck : game.player2CcDeck; }
export function getCcAttachments(game, pn)         { return pn === 1 ? game.p1CcAttachments : game.p2CcAttachments; }
export function getDcAttachments(game, pn)         { return pn === 1 ? game.p1DcAttachments : game.p2DcAttachments; }

// ── Setters (for properties that are reassigned, not just mutated) ──────────

export function setActivationsRemaining(game, pn, v) { if (pn === 1) game.p1ActivationsRemaining = v; else game.p2ActivationsRemaining = v; }
export function setActivationsTotal(game, pn, v)     { if (pn === 1) game.p1ActivationsTotal = v; else game.p2ActivationsTotal = v; }
export function setActivatedDcIndices(game, pn, v)   { if (pn === 1) game.p1ActivatedDcIndices = v; else game.p2ActivatedDcIndices = v; }

// ── Mutations ────────────────────────────────────────────────────────────────

/** Remove a figure's position from the game state. */
export function removeFigurePosition(game, pn, figureKey) {
  if (game.figurePositions?.[pn]) delete game.figurePositions[pn][figureKey];
}

// ── Key helpers (for code that needs both read + write via game[key]) ───────

export function ccHandKey(pn)       { return pn === 1 ? 'player1CcHand' : 'player2CcHand'; }
export function ccDiscardKey(pn)    { return pn === 1 ? 'player1CcDiscard' : 'player2CcDiscard'; }
export function ccDeckKey(pn)       { return pn === 1 ? 'player1CcDeck' : 'player2CcDeck'; }
export function ccDrawnKey(pn)      { return pn === 1 ? 'player1CcDrawn' : 'player2CcDrawn'; }
export function ccAttachmentsKey(pn) { return pn === 1 ? 'p1CcAttachments' : 'p2CcAttachments'; }
export function dcAttachmentsKey(pn) { return pn === 1 ? 'p1DcAttachments' : 'p2DcAttachments'; }
export function dcAttachmentMessageIdsKey(pn) { return pn === 1 ? 'p1DcAttachmentMessageIds' : 'p2DcAttachmentMessageIds'; }
export function vpKey(pn)           { return pn === 1 ? 'player1VP' : 'player2VP'; }
export function deployMetadataKey(pn) { return pn === 1 ? 'player1DeployMetadata' : 'player2DeployMetadata'; }
export function deployLabelsKey(pn)   { return pn === 1 ? 'player1DeployLabels' : 'player2DeployLabels'; }
export function armyCostModifierKey(pn) { return pn === 1 ? 'player1ArmyCostModifier' : 'player2ArmyCostModifier'; }
export function activatedDcIndicesKey(pn) { return pn === 1 ? 'p1ActivatedDcIndices' : 'p2ActivatedDcIndices'; }
