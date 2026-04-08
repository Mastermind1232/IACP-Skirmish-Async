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

// ── Health state sync ────────────────────────────────────────────────────────

/** Sync a figure's health state array back to the DC list for persistence. */
export function syncHealthStateToList(game, playerNum, msgId, healthState) {
  const dcIds = getDcMessageIds(game, playerNum);
  const dcList = getDcList(game, playerNum);
  const idx = dcIds ? dcIds.indexOf(msgId) : -1;
  if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
}

// ── Setters (for properties that are reassigned, not just mutated) ──────────

export function setActivationsRemaining(game, pn, v) { if (pn === 1) game.p1ActivationsRemaining = v; else game.p2ActivationsRemaining = v; }
export function setActivationsTotal(game, pn, v)     { if (pn === 1) game.p1ActivationsTotal = v; else game.p2ActivationsTotal = v; }
export function setActivatedDcIndices(game, pn, v)   { if (pn === 1) game.p1ActivatedDcIndices = v; else game.p2ActivatedDcIndices = v; }

// ── Activation count recompute (single source of truth) ─────────────────────

/**
 * Recompute ActivationsTotal and ActivationsRemaining from board state.
 * A DC is activatable if it has figures on the board (alive and deployed).
 * Lie-in-Ambush set-aside groups are "out of play" and do NOT count until deployed.
 * Remaining = activatable DCs that haven't been activated this round.
 *
 * Call this instead of hand-rolling ±1 delta math on activation counts.
 * @returns {{ total: number, remaining: number }}
 */
export function recomputeActivationCounts(game, pn) {
  const dcList = getDcList(game, pn) || [];
  const figs = game.figurePositions?.[pn] || {};
  const figKeys = Object.keys(figs);
  const activatedIndices = getActivatedDcIndices(game, pn) || [];

  let total = 0;
  let activated = 0;

  for (let i = 0; i < dcList.length; i++) {
    const dcName = dcList[i]?.dcName || dcList[i];
    // Skip figureless DCs (skirmish upgrades like [Extra Armor])
    if (/^\[.+\]$/.test(dcName)) continue;

    const hasFigures = figKeys.some(fk => fk.startsWith(dcName + '-') && figs[fk]);

    if (hasFigures) {
      total++;
      if (activatedIndices.includes(i)) activated++;
    }
  }

  setActivationsTotal(game, pn, total);
  setActivationsRemaining(game, pn, total - activated);
  return { total, remaining: total - activated };
}

// ── Mutations ────────────────────────────────────────────────────────────────

/** Remove a figure's position and clean up per-figure state (device tokens, conditions). */
export function removeFigurePosition(game, pn, figureKey) {
  if (game.figurePositions?.[pn]) delete game.figurePositions[pn][figureKey];
  if (game.deviceTokens?.[figureKey]) delete game.deviceTokens[figureKey];
  if (game.figureConditions?.[figureKey]) delete game.figureConditions[figureKey];
}

/**
 * Canonical push/pull/displacement write. Moves a figure that is already on the
 * board to a new space. Returns { prevPos, newPos } or null if the figure has
 * no current position (guard — prevents ghost writes).
 */
export function pushFigure(game, playerNum, figureKey, newSpace) {
  const positions = game.figurePositions?.[playerNum];
  if (!positions) return null;
  const prevPos = positions[figureKey];
  if (prevPos == null) return null;
  positions[figureKey] = String(newSpace).toLowerCase();
  return { prevPos, newPos: positions[figureKey] };
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

// ── DC / playableBy matching ────────────────────────────────────────────────

/**
 * Check whether a DC name/keywords match a playableBy restriction.
 * Shared by headless CC play and Discord CC hand attachment filter.
 * @param {string} dcName - DC name (may include [DG N] suffix)
 * @param {string} playableBy - playableBy string from CC effect
 * @param {Function} getDcEffectsFn - returns all DC effects object
 * @param {Function} getDcKeywordsFn - returns keywords map (game => {dcName: [kw...]})
 * @param {object} game - game state
 * @param {string} [displayName] - optional display name for name matching (Discord only)
 * @returns {boolean}
 */
export function dcMatchesPlayableBy(dcName, playableBy, getDcEffectsFn, getDcKeywordsFn, game, displayName) {
  if (!playableBy) return true;
  const lower = playableBy.toLowerCase().trim();
  if (!lower || lower === 'any figure') return true;

  const dcBase = dcName.replace(/\s*\[(?:DG|Group) \d+\]$/i, '').replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
  const allDcEffects = (getDcEffectsFn ? getDcEffectsFn() : null) || {};
  const dcData = allDcEffects[dcName] || allDcEffects[dcBase] || {};
  const kwRaw = getDcKeywordsFn
    ? (getDcKeywordsFn(game)?.[dcName] || getDcKeywordsFn(game)?.[dcBase] || [])
    : (dcData.keywords || []);
  const kwLower = kwRaw.map(k => String(k).toLowerCase());
  const affiliationLower = (dcData.affiliation || '').toLowerCase();

  const AFFILIATIONS = new Set(['imperial', 'rebel', 'scum', 'mercenary']);
  const alternatives = lower.split(/\s+or\s+/i).map(a => a.trim().replace(/^"|"$/g, ''));

  for (const alt of alternatives) {
    if (alt === 'unique' || alt === 'any unique figure') {
      if (dcData.unique) return true;
      continue;
    }
    if (alt === 'any small figure') {
      if (kwLower.includes('small')) return true;
      continue;
    }
    // Name match — check both dcName and optional displayName
    const dcLow = dcBase.toLowerCase();
    if (dcLow.includes(alt) || alt.includes(dcLow)) return true;
    if (displayName) {
      const dispBase = String(displayName)
        .replace(/\s*\[(?:DG|Group) \d+\]$/i, '')
        .replace(/\s*\((?:Elite|Regular)\)\s*$/i, '')
        .trim().toLowerCase();
      if (dispBase.includes(alt) || alt.includes(dispBase)) return true;
    }
    // Decompose into affiliation + keyword parts
    const words = alt.split(/\s+/);
    let reqAff = null;
    const reqKwWords = [];
    for (const w of words) {
      if (AFFILIATIONS.has(w) && !reqAff) reqAff = w;
      else reqKwWords.push(w);
    }
    const reqKw = reqKwWords.join(' ');
    if (reqAff && affiliationLower !== reqAff && affiliationLower !== 'any') continue;
    if (reqKw && !kwLower.includes(reqKw)) continue;
    if (reqAff || reqKw) return true;
  }
  return false;
}
