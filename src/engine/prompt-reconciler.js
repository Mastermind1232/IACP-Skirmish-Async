/**
 * Prompt reconciler — narrow registry covering the Walker / massive-displacement
 * recovery path. Answers "should each prompt kind exist?" from pure game state,
 * and on `refreshAllGameComponents` deletes stale prompts and re-posts missing
 * ones so repeated refresh is idempotent.
 *
 * Scope intentionally limited to kinds implicated in the live bug cluster:
 *   - massivePushFigure: controller picks order among 2+ displaced figures
 *   - massivePushSpace: controller picks placement space for current displaced figure
 *   - postDeployChooser: "After Deployment" ability chooser
 *   - walkerMove: Scavenged Walker "Perform Move / Skip" prompt
 */
import { fetchGameChannel } from '../discord/channel-helpers.js';

export const PROMPT_KINDS = Object.freeze([
  'massivePushFigure',
  'massivePushSpace',
  'crushPick',
  'postDeployChooser',
  'walkerMove',
]);

function _pendingSig(kind, game) {
  const p = game.pendingMassivePush;
  if (!p) return null;
  if (kind === 'massivePushFigure') {
    const keys = (p._currentPickable || []).map((e) => e.figureKey).join(',');
    return `fig|${p.phase}|${p.currentIndex}|${keys}`;
  }
  if (kind === 'massivePushSpace') {
    const queue = p.phase === 'friendly' ? p.friendlyQueue : p.enemyQueue;
    const entry = queue?.[p.currentIndex];
    const spaces = (p._currentValidSpaces || []).map((s) => String(s).toLowerCase()).join(',');
    return `sp|${entry?.figureKey || '?'}|${spaces}`;
  }
  return null;
}

function _queueSig(kind, game) {
  const q = game.postDeployQueue;
  if (!q) return null;
  if (kind === 'postDeployChooser') {
    const abils = (q.abilities || []).filter((a) => a.interactive).map((a) => `${a.label}:${a.dcName}:${a.msgId || ''}`).join('|');
    return `pdc|${q.currentPlayerNum}|${abils}`;
  }
  if (kind === 'walkerMove') {
    const a = q.activeAbility;
    if (!a || a.abilityId !== 'scavenged_walker_move') return null;
    const fig = a.moveFigures?.[0];
    return `walk|${a.playerNum}|${fig?.figureKey || '?'}|${fig?.dcName || '?'}`;
  }
  return null;
}

function _crushSig(game) {
  const c = game.pendingCrushChoice;
  if (!c) return null;
  const keys = (c.eligible || []).map((e) => e.figureKey).join(',');
  return `crush|${c.figureKey}|${keys}`;
}

export function signatureFor(kind, game) {
  if (kind === 'massivePushFigure' || kind === 'massivePushSpace') return _pendingSig(kind, game);
  if (kind === 'crushPick') return _crushSig(game);
  if (kind === 'postDeployChooser' || kind === 'walkerMove') return _queueSig(kind, game);
  return null;
}

/**
 * Pure-state determination: which prompts SHOULD exist right now.
 * Massive displacement blocks everything else (parent-flow gate invariant).
 * Returns an array of { kind, signature }.
 */
export function getExpectedPrompts(game) {
  const expected = [];
  // Crush pick is a nested suspend that runs BEFORE the massive push is set up
  // (push is deferred until the target is chosen). It gates everything else.
  const cr = game.pendingCrushChoice;
  if (cr && (cr.eligible || []).length >= 2) {
    expected.push({ kind: 'crushPick', signature: signatureFor('crushPick', game) });
    return expected;
  }
  const p = game.pendingMassivePush;
  if (p) {
    const orderLocked = p._figurePickLockedIdx === p.currentIndex;
    if (p._currentPickable && !orderLocked && p._currentPickable.length >= 2) {
      expected.push({ kind: 'massivePushFigure', signature: signatureFor('massivePushFigure', game) });
    } else if (p._currentValidSpaces && p._currentValidSpaces.length > 0) {
      expected.push({ kind: 'massivePushSpace', signature: signatureFor('massivePushSpace', game) });
    }
    return expected;
  }
  const q = game.postDeployQueue;
  if (!q) return expected;
  const a = q.activeAbility;
  if (a?.abilityId === 'scavenged_walker_move') {
    const fig = a.moveFigures?.[0];
    const inProgress = fig && Object.values(game.moveInProgress || {}).some((m) => m.figureKey === fig.figureKey);
    if (fig && !inProgress) {
      expected.push({ kind: 'walkerMove', signature: signatureFor('walkerMove', game) });
    }
    return expected;
  }
  if (!a && q.awaitingOrder && (q.abilities || []).some((ab) => ab.interactive)) {
    expected.push({ kind: 'postDeployChooser', signature: signatureFor('postDeployChooser', game) });
  }
  return expected;
}

function _ensureStore(game) {
  if (!game.promptMessageIds) game.promptMessageIds = {};
  return game.promptMessageIds;
}

export function recordPromptMessage(game, kind, channelId, messageId, signature) {
  if (!channelId || !messageId) return;
  const store = _ensureStore(game);
  store[kind] = { channelId, messageId, signature, at: Date.now() };
}

export function clearPromptRecord(game, kind) {
  if (!game.promptMessageIds) return;
  delete game.promptMessageIds[kind];
}

async function _deleteRecordedPrompt(game, kind, client) {
  const rec = game.promptMessageIds?.[kind];
  if (!rec) return;
  try {
    const ch = await fetchGameChannel(client, rec.channelId);
    if (ch) {
      const msg = await ch.messages.fetch(rec.messageId).catch(() => null);
      // alexanbv 2026-06-23: keep message (no delete) for traceability — disable its buttons instead
      if (msg) await msg.edit({ components: [] }).catch(() => {});
    }
  } catch {}
  clearPromptRecord(game, kind);
}

async function _renderPrompt(kind, game, gameId, client, ctx) {
  if (kind === 'massivePushFigure' || kind === 'massivePushSpace') {
    const mod = await import('../handlers/movement.js');
    if (kind === 'massivePushFigure') await mod.renderMassivePushFigurePrompt(game, client);
    else await mod.renderMassivePushSpacePrompt(game, client);
    return;
  }
  if (kind === 'crushPick') {
    const mod = await import('../handlers/move-x-handler.js');
    await mod.renderCrushPickPrompt(game, client);
    return;
  }
  if (kind === 'postDeployChooser' || kind === 'walkerMove') {
    const mod = await import('../handlers/post-deploy.js');
    if (kind === 'postDeployChooser') await mod.renderPostDeployChooserPrompt(game, gameId, client, ctx);
    else await mod.renderWalkerMovePrompt(game, gameId, client, ctx);
    return;
  }
}

/**
 * Reconcile prompts against game state. For each tracked kind:
 *   - if recorded but not expected (or signature differs) → delete stale
 *   - if expected but not recorded → render
 * Safe to call repeatedly: idempotent when state is stable.
 */
export async function reconcilePrompts(game, gameId, client, ctx) {
  const expected = getExpectedPrompts(game);
  const expectedByKind = new Map();
  for (const e of expected) expectedByKind.set(e.kind, e);
  const store = game.promptMessageIds || {};

  for (const kind of PROMPT_KINDS) {
    const exp = expectedByKind.get(kind);
    const rec = store[kind];
    if (!exp && rec) {
      await _deleteRecordedPrompt(game, kind, client);
      continue;
    }
    if (exp && rec && rec.signature !== exp.signature) {
      await _deleteRecordedPrompt(game, kind, client);
      await _renderPrompt(kind, game, gameId, client, ctx);
      continue;
    }
    if (exp && !rec) {
      await _renderPrompt(kind, game, gameId, client, ctx);
    }
  }
}
