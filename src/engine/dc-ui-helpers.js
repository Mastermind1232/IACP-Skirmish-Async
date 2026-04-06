/**
 * DC UI helper functions extracted from index.js.
 * Build Discord embed data for deployment cards.
 */

export function getDcUpgradeAttachments(game, msgId) {
  if (!game || !msgId) return [];
  return (game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || []);
}

export function getConditionsForDcMessage(game, meta, deps) {
  if (!game?.figureConditions || !meta?.dcName) return undefined;
  const stats = deps.getDcStats(meta.dcName);
  const figures = stats.figures ?? 1;
  const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
  const dgIndex = dgMatch ? dgMatch[1] : '1';
  const out = [];
  let hasAny = false;
  for (let i = 0; i < figures; i++) {
    const fk = `${meta.dcName}-${dgIndex}-${i}`;
    const list = game.figureConditions[fk] || [];
    out.push(Array.isArray(list) ? list : [list]);
    if (out[out.length - 1].length) hasAny = true;
  }
  return hasAny ? out : undefined;
}

export function getTokensForDcMessage(game, meta, deps) {
  if (!game?.figurePowerTokens || !meta?.dcName) return undefined;
  const stats = deps.getDcStats(meta.dcName);
  const figures = stats.figures ?? 1;
  const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
  const dgIndex = dgMatch ? dgMatch[1] : '1';
  const out = [];
  let hasAny = false;
  for (let i = 0; i < figures; i++) {
    const fk = `${meta.dcName}-${dgIndex}-${i}`;
    const list = game.figurePowerTokens[fk] || [];
    out.push(Array.isArray(list) ? [...list] : []);
    if (out[out.length - 1].length) hasAny = true;
  }
  return hasAny ? out : undefined;
}

export function getNicknamesForDcMessage(game, meta, deps) {
  if (!game?.figureNicknames || !meta?.dcName) return undefined;
  const stats = deps.getDcStats(meta.dcName);
  const figures = stats.figures ?? 1;
  if (figures <= 1) return undefined;
  const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
  const dgIndex = dgMatch ? dgMatch[1] : '1';
  const out = [];
  let hasAny = false;
  for (let i = 0; i < figures; i++) {
    const fk = `${meta.dcName}-${dgIndex}-${i}`;
    const nick = game.figureNicknames[fk] || null;
    out.push(nick);
    if (nick) hasAny = true;
  }
  return hasAny ? out : undefined;
}

/**
 * Canonical DC display-state builder.
 * Assembles the complete argument set for buildDcEmbedAndFiles from game state.
 * deps must include: dcMessageMeta, dcExhaustedState, dcHealthState, getDcStats.
 */
export function buildDcDisplayState(game, msgId, deps) {
  const meta = deps.dcMessageMeta.get(msgId);
  if (!meta) return null;
  return {
    dcName:             meta.dcName,
    exhausted:          deps.dcExhaustedState?.get(msgId) ?? false,
    displayName:        meta.displayName,
    healthState:        deps.dcHealthState?.get(msgId) ?? [[null, null]],
    conditionsByFigure: getConditionsForDcMessage(game, meta, deps),
    dcAttachments:      getDcUpgradeAttachments(game, msgId),
    tokensByFigure:     getTokensForDcMessage(game, meta, deps),
    actionsData:        game.dcActionsData?.[msgId] ?? null,
    nicknamesByFigure:  getNicknamesForDcMessage(game, meta, deps),
    options:            { game, playerNum: meta.playerNum },
  };
}

/**
 * Convenience wrapper: builds canonical display state, applies overrides, renders.
 * deps must also include buildDcEmbedAndFiles.
 */
export async function renderDcEmbed(game, msgId, deps, overrides = {}) {
  const ds = { ...buildDcDisplayState(game, msgId, deps), ...overrides };
  return deps.buildDcEmbedAndFiles(
    ds.dcName, ds.exhausted, ds.displayName, ds.healthState,
    ds.conditionsByFigure, ds.dcAttachments, ds.tokensByFigure,
    ds.actionsData, ds.nicknamesByFigure, ds.options,
  );
}
