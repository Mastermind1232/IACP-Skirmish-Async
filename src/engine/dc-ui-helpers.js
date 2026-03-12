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
