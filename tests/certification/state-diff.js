/**
 * State diff system for certification.
 * Captures game state snapshots and produces structured diffs.
 *
 * Tracked dimensions:
 *   hp, conditions, positions, vp, ccHands, ccDiscards,
 *   tokens, exhausted, pendingStates, roundPhase, figureKeys, deviceTokens
 */

// ── Helpers ────────────────────────────────────────────────────────

function deepClone(obj) {
  if (obj == null) return obj;
  // structuredClone is available in Node 17+; fall back to JSON round-trip
  if (typeof structuredClone === 'function') return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

/** Convert a Map to a plain object (one level deep-clone of values). */
function mapToObject(map) {
  if (!map || typeof map.entries !== 'function') return {};
  const out = {};
  for (const [k, v] of map.entries()) {
    out[k] = deepClone(v);
  }
  return out;
}

/** Collect all figure keys present in figurePositions for both players. */
function collectFigureKeys(positions) {
  const keys = new Set();
  if (!positions) return keys;
  for (const pn of [1, 2]) {
    if (positions[pn]) {
      for (const fk of Object.keys(positions[pn])) keys.add(fk);
    }
  }
  return keys;
}

/**
 * Build HP snapshot.
 * Prefers dcHealthState Map (msgId -> [[cur,max], ...]) when provided.
 * Falls back to game.p1DcList / p2DcList healthState arrays.
 */
function snapshotHp(game, dcHealthState, dcMessageMeta) {
  const hp = {};

  // Primary path: dcHealthState Map keyed by msgId
  if (dcHealthState && typeof dcHealthState.entries === 'function') {
    for (const [msgId, healthArr] of dcHealthState.entries()) {
      // Determine figure key from dcMessageMeta if available
      const meta = dcMessageMeta?.get?.(msgId);
      const label = meta?.dcName || meta?.displayName || msgId;
      hp[msgId] = {
        label,
        figures: deepClone(healthArr), // [[cur, max], ...]
      };
    }
  }

  // Fallback / supplement: in-game DC lists
  for (const pn of [1, 2]) {
    const dcList = game[`p${pn}DcList`] || [];
    const msgIds = game[`p${pn}DcMessageIds`] || [];
    for (let i = 0; i < dcList.length; i++) {
      const dc = dcList[i];
      const msgId = msgIds[i] || `p${pn}_dc${i}`;
      if (hp[msgId]) continue; // already captured from Map
      if (dc.healthState) {
        hp[msgId] = {
          label: dc.dcName || dc.displayName || msgId,
          figures: deepClone(dc.healthState),
        };
      }
    }
  }

  return hp;
}

/** Snapshot exhausted state from dcExhaustedState Map. */
function snapshotExhausted(dcExhaustedState) {
  if (!dcExhaustedState || typeof dcExhaustedState.entries !== 'function') return {};
  const out = {};
  for (const [msgId, val] of dcExhaustedState.entries()) {
    out[msgId] = !!val;
  }
  return out;
}

/** Snapshot pending states (any game key starting with "pending"). */
function snapshotPendingStates(game) {
  const out = {};
  for (const key of Object.keys(game)) {
    if (key.startsWith('pending')) {
      out[key] = deepClone(game[key]);
    }
  }
  return out;
}

/**
 * Snapshot tokens.
 * Tokens may live in game.figureTokens (object of token counts)
 * or be encoded as conditions in game.figureConditions (Focus, Hidden, etc.).
 * We capture both sources; assertion helpers reconcile.
 */
function snapshotTokens(game) {
  // Direct token map if it exists
  const tokenMap = deepClone(game.figureTokens || {});

  // Also scan figureConditions for token-like conditions
  const TOKEN_CONDITIONS = ['Focus', 'Hidden', 'Power Token', 'Block Token', 'Evade Token', 'Surge Token'];
  const conditions = game.figureConditions || {};
  for (const [fk, conds] of Object.entries(conditions)) {
    if (!Array.isArray(conds)) continue;
    for (const c of conds) {
      if (TOKEN_CONDITIONS.includes(c)) {
        if (!tokenMap[fk]) tokenMap[fk] = {};
        const tokenKey = c.toLowerCase().replace(/ token$/, '');
        tokenMap[fk][tokenKey] = (tokenMap[fk][tokenKey] || 0) + 1;
      }
    }
  }

  return tokenMap;
}

// ── Snapshot ────────────────────────────────────────────────────────

/**
 * Capture a deep-cloned snapshot of all tracked game-state dimensions.
 *
 * @param {object} game         - The game object
 * @param {object} deps         - External Maps: { dcHealthState, dcExhaustedState, dcMessageMeta }
 * @returns {object}            - Plain snapshot object
 */
export function snapshotGameState(game, deps = {}) {
  const { dcHealthState, dcExhaustedState, dcMessageMeta } = deps;
  const positions = deepClone(game.figurePositions || { 1: {}, 2: {} });

  return {
    hp: snapshotHp(game, dcHealthState, dcMessageMeta),
    conditions: deepClone(game.figureConditions || {}),
    positions,
    vp: {
      1: deepClone(game.player1VP || { total: 0, kills: 0, objectives: 0 }),
      2: deepClone(game.player2VP || { total: 0, kills: 0, objectives: 0 }),
    },
    ccHands: {
      1: deepClone(game.player1CcHand || []),
      2: deepClone(game.player2CcHand || []),
    },
    ccDiscards: {
      1: deepClone(game.player1CcDiscard || []),
      2: deepClone(game.player2CcDiscard || []),
    },
    tokens: snapshotTokens(game),
    exhausted: snapshotExhausted(dcExhaustedState),
    pendingStates: snapshotPendingStates(game),
    roundPhase: {
      round: game.currentRound ?? game.round ?? null,
      phase: game.phase ?? null,
      roundPhase: game.roundPhase ?? null,
    },
    figureKeys: [...collectFigureKeys(positions)],
    deviceTokens: deepClone(game.deviceTokens || {}),
  };
}

// ── Diff ────────────────────────────────────────────────────────────

/**
 * Compare two snapshots, return array of change entries.
 * Each entry: { dimension, key, before, after }
 *
 * Only includes values that actually changed.
 */
export function diffGameState(before, after) {
  const changes = [];

  // HP: compare per msgId, per figure index
  diffHp(before.hp, after.hp, changes);

  // Conditions: compare per figureKey
  diffObjectOfArrays('conditions', before.conditions, after.conditions, changes);

  // Positions: compare per player per figureKey
  for (const pn of [1, 2]) {
    diffFlatObject(`positions.p${pn}`, before.positions?.[pn] || {}, after.positions?.[pn] || {}, changes);
  }

  // VP: compare per player
  for (const pn of [1, 2]) {
    diffFlatObject(`vp.p${pn}`, before.vp?.[pn] || {}, after.vp?.[pn] || {}, changes);
  }

  // CC hands: compare per player (as arrays)
  for (const pn of [1, 2]) {
    diffArrayValue(`ccHands.p${pn}`, before.ccHands?.[pn] || [], after.ccHands?.[pn] || [], changes);
  }

  // CC discards: compare per player (as arrays)
  for (const pn of [1, 2]) {
    diffArrayValue(`ccDiscards.p${pn}`, before.ccDiscards?.[pn] || [], after.ccDiscards?.[pn] || [], changes);
  }

  // Tokens: compare per figureKey per token type
  diffNestedObject('tokens', before.tokens || {}, after.tokens || {}, changes);

  // Exhausted: compare per msgId
  diffFlatObject('exhausted', before.exhausted || {}, after.exhausted || {}, changes);

  // Pending states: compare per key
  diffPendingStates(before.pendingStates || {}, after.pendingStates || {}, changes);

  // Round/phase
  diffFlatObject('roundPhase', before.roundPhase || {}, after.roundPhase || {}, changes);

  // Figure keys (presence/absence)
  diffArrayValue('figureKeys', before.figureKeys || [], after.figureKeys || [], changes);

  // Device tokens
  diffFlatObject('deviceTokens', before.deviceTokens || {}, after.deviceTokens || {}, changes);

  return changes;
}

// ── Diff helpers (internal) ─────────────────────────────────────────

function jsonEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffHp(beforeHp, afterHp, changes) {
  const allMsgIds = new Set([...Object.keys(beforeHp || {}), ...Object.keys(afterHp || {})]);
  for (const msgId of allMsgIds) {
    const bEntry = beforeHp?.[msgId];
    const aEntry = afterHp?.[msgId];
    const bFigs = bEntry?.figures || [];
    const aFigs = aEntry?.figures || [];
    const maxLen = Math.max(bFigs.length, aFigs.length);
    for (let i = 0; i < maxLen; i++) {
      const bVal = bFigs[i] || null;
      const aVal = aFigs[i] || null;
      if (!jsonEq(bVal, aVal)) {
        const label = bEntry?.label || aEntry?.label || msgId;
        changes.push({
          dimension: 'hp',
          key: `${label}[${i}]`,
          msgId,
          figureIndex: i,
          before: bVal,
          after: aVal,
        });
      }
    }
  }
}

function diffObjectOfArrays(dimension, beforeObj, afterObj, changes) {
  const allKeys = new Set([...Object.keys(beforeObj || {}), ...Object.keys(afterObj || {})]);
  for (const key of allKeys) {
    const bArr = beforeObj?.[key] || [];
    const aArr = afterObj?.[key] || [];
    if (!jsonEq(bArr, aArr)) {
      changes.push({ dimension, key, before: bArr, after: aArr });
    }
  }
}

function diffFlatObject(dimension, beforeObj, afterObj, changes) {
  const allKeys = new Set([...Object.keys(beforeObj || {}), ...Object.keys(afterObj || {})]);
  for (const key of allKeys) {
    const bVal = beforeObj?.[key] ?? null;
    const aVal = afterObj?.[key] ?? null;
    if (!jsonEq(bVal, aVal)) {
      changes.push({ dimension, key, before: bVal, after: aVal });
    }
  }
}

function diffNestedObject(dimension, beforeObj, afterObj, changes) {
  const allKeys = new Set([...Object.keys(beforeObj || {}), ...Object.keys(afterObj || {})]);
  for (const outerKey of allKeys) {
    const bInner = beforeObj?.[outerKey] || {};
    const aInner = afterObj?.[outerKey] || {};
    if (typeof bInner !== 'object' || typeof aInner !== 'object') {
      if (!jsonEq(bInner, aInner)) {
        changes.push({ dimension, key: outerKey, before: bInner, after: aInner });
      }
      continue;
    }
    const innerKeys = new Set([...Object.keys(bInner), ...Object.keys(aInner)]);
    for (const innerKey of innerKeys) {
      const bVal = bInner[innerKey] ?? null;
      const aVal = aInner[innerKey] ?? null;
      if (!jsonEq(bVal, aVal)) {
        changes.push({ dimension, key: `${outerKey}.${innerKey}`, before: bVal, after: aVal });
      }
    }
  }
}

function diffArrayValue(dimension, beforeArr, afterArr, changes) {
  if (!jsonEq(beforeArr, afterArr)) {
    changes.push({ dimension, key: dimension, before: beforeArr, after: afterArr });
  }
}

function diffPendingStates(beforeObj, afterObj, changes) {
  const allKeys = new Set([...Object.keys(beforeObj || {}), ...Object.keys(afterObj || {})]);
  for (const key of allKeys) {
    const bVal = beforeObj?.[key];
    const aVal = afterObj?.[key];
    // Treat undefined and absent the same
    const bExists = bVal !== undefined;
    const aExists = aVal !== undefined;
    if (bExists !== aExists || !jsonEq(bVal, aVal)) {
      changes.push({
        dimension: 'pendingStates',
        key,
        before: bExists ? bVal : undefined,
        after: aExists ? aVal : undefined,
      });
    }
  }
}

// ── Assertion: expected changes ─────────────────────────────────────

/**
 * Verify that every expected change appears in the diff.
 *
 * @param {Array} diff       - Output of diffGameState()
 * @param {Array} expected   - Array of { dimension, key, delta? , value? }
 *   - delta: numeric difference (after - before) for numeric values
 *   - value: exact expected "after" value
 * @returns {{ pass: boolean, missing: Array, unexpected: Array }}
 */
export function assertExpectedChanges(diff, expected) {
  const missing = [];
  const matched = new Set();

  for (const exp of expected) {
    const match = diff.find((d, idx) =>
      !matched.has(idx) &&
      d.dimension === exp.dimension &&
      d.key === exp.key
    );
    if (!match) {
      missing.push(exp);
      continue;
    }

    const idx = diff.indexOf(match);
    let ok = true;

    if (exp.delta !== undefined) {
      // Numeric delta check
      const bNum = extractNumeric(match.before);
      const aNum = extractNumeric(match.after);
      if (aNum - bNum !== exp.delta) {
        missing.push({ ...exp, actual: { before: match.before, after: match.after, actualDelta: aNum - bNum } });
        continue;
      }
    }

    if (exp.value !== undefined) {
      if (!jsonEq(match.after, exp.value)) {
        missing.push({ ...exp, actual: match.after });
        continue;
      }
    }

    matched.add(idx);
  }

  const unexpected = diff.filter((_, idx) => !matched.has(idx));

  return {
    pass: missing.length === 0,
    missing,
    unexpected,
  };
}

function extractNumeric(val) {
  if (typeof val === 'number') return val;
  // HP arrays: [current, max] — use current
  if (Array.isArray(val) && val.length === 2 && typeof val[0] === 'number') return val[0];
  // VP objects: use total
  if (val && typeof val === 'object' && typeof val.total === 'number') return val.total;
  return 0;
}

// ── Assertion: no unexpected changes ────────────────────────────────

/**
 * Verify that every diff entry is in the allowed list.
 *
 * @param {Array} diff      - Output of diffGameState()
 * @param {Array} allowed   - Array of { dimension, key } pairs
 * @returns {{ pass: boolean, unexpected: Array }}
 */
export function assertNoUnexpectedChanges(diff, allowed) {
  const unexpected = diff.filter(d =>
    !allowed.some(a => a.dimension === d.dimension && a.key === d.key)
  );
  return { pass: unexpected.length === 0, unexpected };
}

// ── Domain-specific assertion helpers ───────────────────────────────

/**
 * Assert that damage was dealt to a specific figure.
 * Looks for an HP change where current HP decreased by expectedDelta.
 */
export function assertDamageDealt(diff, targetFigureKey, expectedDelta) {
  const hpChanges = diff.filter(d => d.dimension === 'hp' && d.key.includes(targetFigureKey));
  if (hpChanges.length === 0) {
    // Also try matching by label
    const byLabel = diff.filter(d => d.dimension === 'hp');
    for (const c of byLabel) {
      const bCur = c.before?.[0] ?? 0;
      const aCur = c.after?.[0] ?? 0;
      if (bCur - aCur === expectedDelta) {
        return { pass: true, change: c };
      }
    }
    return { pass: false, reason: `No HP change found for ${targetFigureKey}` };
  }
  for (const c of hpChanges) {
    const bCur = c.before?.[0] ?? 0;
    const aCur = c.after?.[0] ?? 0;
    if (bCur - aCur === expectedDelta) {
      return { pass: true, change: c };
    }
  }
  return {
    pass: false,
    reason: `HP delta mismatch for ${targetFigureKey}`,
    found: hpChanges,
  };
}

/**
 * Assert that healing was applied to a specific figure.
 * HP current increased by expectedDelta.
 */
export function assertHealApplied(diff, targetFigureKey, expectedDelta) {
  const hpChanges = diff.filter(d => d.dimension === 'hp' && d.key.includes(targetFigureKey));
  if (hpChanges.length === 0) {
    return { pass: false, reason: `No HP change found for ${targetFigureKey}` };
  }
  for (const c of hpChanges) {
    const bCur = c.before?.[0] ?? 0;
    const aCur = c.after?.[0] ?? 0;
    if (aCur - bCur === expectedDelta) {
      return { pass: true, change: c };
    }
  }
  return {
    pass: false,
    reason: `Heal delta mismatch for ${targetFigureKey}`,
    found: hpChanges,
  };
}

/**
 * Assert that a condition was applied to a figure.
 */
export function assertConditionApplied(diff, targetFigureKey, condition) {
  const condChange = diff.find(d => d.dimension === 'conditions' && d.key === targetFigureKey);
  if (!condChange) {
    return { pass: false, reason: `No condition change found for ${targetFigureKey}` };
  }
  const beforeArr = condChange.before || [];
  const afterArr = condChange.after || [];
  const added = afterArr.filter(c => !beforeArr.includes(c));
  if (added.includes(condition)) {
    return { pass: true, change: condChange };
  }
  return {
    pass: false,
    reason: `Condition "${condition}" not found in added conditions for ${targetFigureKey}`,
    added,
  };
}

/**
 * Assert that a condition was removed from a figure.
 */
export function assertConditionRemoved(diff, targetFigureKey, condition) {
  const condChange = diff.find(d => d.dimension === 'conditions' && d.key === targetFigureKey);
  if (!condChange) {
    return { pass: false, reason: `No condition change found for ${targetFigureKey}` };
  }
  const beforeArr = condChange.before || [];
  const afterArr = condChange.after || [];
  const removed = beforeArr.filter(c => !afterArr.includes(c));
  if (removed.includes(condition)) {
    return { pass: true, change: condChange };
  }
  return {
    pass: false,
    reason: `Condition "${condition}" not found in removed conditions for ${targetFigureKey}`,
    removed,
  };
}

/**
 * Assert that Focus was applied to a figure.
 */
export function assertFocusApplied(diff, targetFigureKey) {
  // Check conditions first (Focus is typically a condition)
  const condResult = assertConditionApplied(diff, targetFigureKey, 'Focus');
  if (condResult.pass) return condResult;

  // Fall back to token check
  const tokenChange = diff.find(d =>
    d.dimension === 'tokens' &&
    d.key === `${targetFigureKey}.focus`
  );
  if (tokenChange) {
    const bVal = tokenChange.before ?? 0;
    const aVal = tokenChange.after ?? 0;
    if (aVal > bVal) {
      return { pass: true, change: tokenChange };
    }
  }

  return { pass: false, reason: `No Focus applied to ${targetFigureKey}` };
}

/**
 * Assert that strain was suffered.
 * Strain may be tracked as HP reduction or as a separate counter.
 */
export function assertStrainSuffered(diff, targetFigureKey, amount) {
  // Strain is typically HP reduction (damage to self)
  const damageResult = assertDamageDealt(diff, targetFigureKey, amount);
  if (damageResult.pass) return damageResult;

  // Check for a strain-specific condition or token
  const tokenChange = diff.find(d =>
    d.dimension === 'tokens' &&
    d.key === `${targetFigureKey}.strain`
  );
  if (tokenChange) {
    const delta = (tokenChange.after ?? 0) - (tokenChange.before ?? 0);
    if (delta === amount) {
      return { pass: true, change: tokenChange };
    }
  }

  return {
    pass: false,
    reason: `No strain of ${amount} found for ${targetFigureKey}`,
  };
}

/**
 * Assert that a token was gained by a figure.
 */
export function assertTokenGained(diff, figureKey, tokenType) {
  // Check tokens dimension
  const tokenChange = diff.find(d =>
    d.dimension === 'tokens' &&
    d.key === `${figureKey}.${tokenType}`
  );
  if (tokenChange) {
    const bVal = tokenChange.before ?? 0;
    const aVal = tokenChange.after ?? 0;
    if (aVal > bVal) {
      return { pass: true, change: tokenChange };
    }
  }

  // Check deviceTokens for device type
  if (tokenType === 'device') {
    const deviceChange = diff.find(d =>
      d.dimension === 'deviceTokens' &&
      d.key === figureKey
    );
    if (deviceChange) {
      const bVal = deviceChange.before ?? 0;
      const aVal = deviceChange.after ?? 0;
      if (aVal > bVal) {
        return { pass: true, change: deviceChange };
      }
    }
  }

  // Check conditions (Focus, Hidden map to tokens)
  const conditionName = tokenType.charAt(0).toUpperCase() + tokenType.slice(1);
  const condResult = assertConditionApplied(diff, figureKey, conditionName);
  if (condResult.pass) return condResult;

  return { pass: false, reason: `No ${tokenType} token gained for ${figureKey}` };
}

/**
 * Assert that a CC card was played from a player's hand.
 */
export function assertCardPlayedFromHand(diff, playerNum, cardName) {
  const handDiff = diff.find(d => d.dimension === `ccHands.p${playerNum}` || d.key === `ccHands.p${playerNum}`);
  if (!handDiff) {
    return { pass: false, reason: `No hand change found for player ${playerNum}` };
  }
  const beforeHand = handDiff.before || [];
  const afterHand = handDiff.after || [];

  // Card should be in before but not in after (or one fewer copy)
  const beforeCount = beforeHand.filter(c => c === cardName).length;
  const afterCount = afterHand.filter(c => c === cardName).length;
  if (beforeCount > afterCount) {
    return { pass: true, change: handDiff };
  }

  return {
    pass: false,
    reason: `Card "${cardName}" was not removed from player ${playerNum} hand`,
    beforeHand,
    afterHand,
  };
}

/**
 * Assert that a pending state key appeared (was set).
 */
export function assertPendingStateSet(diff, stateKey) {
  const key = stateKey.startsWith('pending') ? stateKey : `pending${stateKey}`;
  const change = diff.find(d => d.dimension === 'pendingStates' && d.key === key);
  if (!change) {
    return { pass: false, reason: `No pending state change for "${key}"` };
  }
  if (change.after !== undefined && change.after !== null) {
    return { pass: true, change };
  }
  return { pass: false, reason: `Pending state "${key}" was not set (after is ${change.after})` };
}

/**
 * Assert that a pending state key was cleared (removed).
 */
export function assertPendingStateCleared(diff, stateKey) {
  const key = stateKey.startsWith('pending') ? stateKey : `pending${stateKey}`;
  const change = diff.find(d => d.dimension === 'pendingStates' && d.key === key);
  if (!change) {
    return { pass: false, reason: `No pending state change for "${key}"` };
  }
  if (change.before !== undefined && change.before !== null &&
      (change.after === undefined || change.after === null)) {
    return { pass: true, change };
  }
  return { pass: false, reason: `Pending state "${key}" was not cleared` };
}

/**
 * Assert that VP changed by a delta for a player.
 */
export function assertVpChanged(diff, playerNum, expectedDelta) {
  const vpChange = diff.find(d => d.dimension === `vp.p${playerNum}` && d.key === 'total');
  if (!vpChange) {
    return { pass: false, reason: `No VP total change found for player ${playerNum}` };
  }
  const bVal = vpChange.before ?? 0;
  const aVal = vpChange.after ?? 0;
  const actualDelta = aVal - bVal;
  if (actualDelta === expectedDelta) {
    return { pass: true, change: vpChange };
  }
  return {
    pass: false,
    reason: `VP delta mismatch for player ${playerNum}: expected ${expectedDelta}, got ${actualDelta}`,
    change: vpChange,
  };
}

/**
 * Assert that a figure was defeated (removed from positions).
 */
export function assertFigureDefeated(diff, figureKey) {
  // Check positions: figure should be removed from one of the player sides
  for (const pn of [1, 2]) {
    const posChange = diff.find(d =>
      d.dimension === `positions.p${pn}` &&
      d.key === figureKey
    );
    if (posChange && posChange.before !== null && posChange.after === null) {
      return { pass: true, change: posChange, playerNum: pn };
    }
  }

  // Check figureKeys array diff
  const fkChange = diff.find(d => d.dimension === 'figureKeys');
  if (fkChange) {
    const beforeKeys = fkChange.before || [];
    const afterKeys = fkChange.after || [];
    if (beforeKeys.includes(figureKey) && !afterKeys.includes(figureKey)) {
      return { pass: true, change: fkChange };
    }
  }

  return { pass: false, reason: `Figure "${figureKey}" was not defeated (still in positions)` };
}
