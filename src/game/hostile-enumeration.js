/**
 * Hostile-figure enumeration (alexanbv 2026-05-10).
 *
 * NPC hostility taxonomy (per alexanbv 2026-05-10):
 *   'hostile'           — Thugs. Full hostile: ability target + MP cost + blocks control.
 *   'treatedAsHostile'  — Krykna. Ability/attack target only; no MP cost, no control block.
 *   'neutral'           — future. No hostile treatment in any layer.
 *
 * Returns every figure that is hostile (or treated as hostile) to a given player,
 * INCLUDING mission-rule-declared NPCs (Thugs, Krykna). Replaces ad-hoc
 * `Object.entries(game.figurePositions[oppPN])` iteration in ability/AoE hot paths,
 * so NPCs correctly fall under "abilities that target hostile figures" per card text.
 *
 * Each yielded entry has the shape:
 *   {
 *     figureKey:           e.g. 'Stormtrooper-1-0' | 'npc_thug_3' | 'npc_krykna_5'
 *     coord:               lowercase coord string
 *     isNpc:               true for thugs/krykna, false for regular figures
 *     npcType?:            'thug' | 'krykna' (when isNpc)
 *     npcIndex?:           index into game.npcThugs / game.npcKrykna (when isNpc)
 *     controllerPlayerNum: opponent's player number for regular figures,
 *                          null for neutrals (no controller)
 *   }
 */

/**
 * @param {object} game
 * @param {number} forPlayerNum  attacker's player number; hostile = "not me"
 * @returns {Array}
 */
export function enumerateHostileFigures(game, forPlayerNum) {
  const out = [];
  const oppPN = forPlayerNum === 1 ? 2 : 1;
  // Regular opponent figures
  for (const [fk, coord] of Object.entries(game.figurePositions?.[oppPN] || {})) {
    if (!coord) continue;
    out.push({
      figureKey: fk,
      coord: String(coord).toLowerCase(),
      isNpc: false,
      controllerPlayerNum: oppPN,
    });
  }
  // NPCs (Thugs hostility='hostile', Krykna hostility='treatedAsHostile')
  for (const [arrName, npcType] of [['npcThugs', 'thug'], ['npcKrykna', 'krykna']]) {
    const arr = game[arrName];
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const npc = arr[i];
      if (!npc || npc.defeated) continue;
      const hostility = npc.hostility || (npc.hostileToAll ? 'hostile' : 'neutral');
      if (hostility === 'neutral') continue;
      out.push({
        figureKey: `npc_${npcType}_${i}`,
        coord: String(npc.coord).toLowerCase(),
        isNpc: true,
        npcType,
        npcIndex: i,
        controllerPlayerNum: null,
      });
    }
  }
  return out;
}

/** Returns the NPC's hostility class ('hostile' | 'treatedAsHostile' | 'neutral'). */
export function npcHostility(npc) {
  if (!npc) return 'neutral';
  if (npc.hostility) return npc.hostility;
  // Legacy compat: hostileToAll=true → 'hostile'; absent or false → 'neutral'.
  return npc.hostileToAll ? 'hostile' : 'neutral';
}

/**
 * Enumerate every figure in play — regular figures owned by either
 * player AND neutral NPCs (Thugs/Krykna) regardless of hostileToAll.
 * Used by AoE / splash effects whose card text reads "each figure
 * within N" (Shrapnel Splash, Blast, Wrist Flamethrower, etc.) so
 * neutrals are correctly affected.
 *
 * @param {object} game
 * @returns {Array} same entry shape as enumerateHostileFigures, but with
 *   controllerPlayerNum set to the figure's owner for regulars (and
 *   null for neutrals).
 */
export function enumerateAllFigures(game) {
  const out = [];
  for (const pn of [1, 2]) {
    for (const [fk, coord] of Object.entries(game.figurePositions?.[pn] || {})) {
      if (!coord) continue;
      out.push({
        figureKey: fk,
        coord: String(coord).toLowerCase(),
        isNpc: false,
        controllerPlayerNum: pn,
      });
    }
  }
  for (const [arrName, npcType] of [['npcThugs', 'thug'], ['npcKrykna', 'krykna']]) {
    const arr = game[arrName];
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const npc = arr[i];
      if (!npc || npc.defeated) continue;
      out.push({
        figureKey: `npc_${npcType}_${i}`,
        coord: String(npc.coord).toLowerCase(),
        isNpc: true,
        npcType,
        npcIndex: i,
        controllerPlayerNum: null,
      });
    }
  }
  return out;
}

/**
 * Apply damage to a neutral NPC figure (Thug / Krykna). Pure, sync
 * core — mutates `npc.hp` / `npc.defeated`, awards Krykna and
 * Nefarious-Gains VP, and returns a structured log queue for the
 * async caller to drain.
 *
 * Distinct from applyDamage (figure pipeline) and applyDamageToObject
 * (object pipeline) — neutrals are figures but live in their own
 * state container (`game.npcThugs` / `game.npcKrykna`).
 *
 * Pre-2026-05-11 there were two functions doing the same thing
 * (`applyDamageToNpc` async + `applyDamageToNpcSync` sync). Unified
 * here. The async wrapper at the bottom of this file owns the
 * logging side-effect; this core stays pure for callers that need it
 * inside a synchronous resolver (resolveAbility, SoA orchestrator).
 *
 * Inputs:
 *   game                       — game state
 *   opts.npcType               — 'thug' | 'krykna'
 *   opts.npcIndex              — index into the respective array
 *   opts.amount                — damage to apply
 *   opts.attackerPlayerNum     — defeater's player num (for VP)
 *   opts.awardObjectiveVp(g,n,a) — optional VP awarder; if omitted, VP
 *                                  totals are computed but not banked
 *
 * Returns:
 *   {
 *     applied,                 — bool: did damage land?
 *     prevHp,                  — hp before
 *     newHp,                   — hp after (0 on defeat)
 *     defeated,                — bool: hp hit 0
 *     vp,                      — total VP awarded (Krykna 2 + Jabba +1)
 *     label,                   — "Thug N" / "Krykna N" for logging
 *     logs,                    — Array<{ kind, msg, opts }> for the
 *                                async wrapper to drain via logGameAction
 *   }
 */
export function applyDamageToNpcSync(game, opts) {
  const { npcType, npcIndex, amount, attackerPlayerNum, source } = opts || {};
  const _none = { applied: false, prevHp: 0, newHp: 0, defeated: false, vp: 0, label: '', logs: [] };
  if (!amount || amount <= 0) return _none;
  const arrName = npcType === 'thug' ? 'npcThugs' : npcType === 'krykna' ? 'npcKrykna' : null;
  if (!arrName) return _none;
  const arr = game[arrName];
  if (!Array.isArray(arr) || !arr[npcIndex]) return _none;
  const npc = arr[npcIndex];
  if (npc.defeated) return _none;
  const prevHp = npc.hp;
  npc.hp = Math.max(0, npc.hp - amount);
  const label = npcType === 'thug' ? `Thug ${npcIndex + 1}` : `Krykna ${npcIndex + 1}`;
  const logs = [
    { kind: 'damage', msg: `🩸 **${label}** suffers ${amount} Damage from **${source || 'attack'}** (HP: ${prevHp} → ${npc.hp}).`,
      opts: { phase: 'ROUND', icon: 'attack' } },
  ];
  if (npc.hp > 0) {
    return { applied: true, prevHp, newHp: npc.hp, defeated: false, vp: 0, label, logs };
  }
  npc.defeated = true;
  let vp = 0;
  // Krykna defeat awards 2 VP per card text.
  if (npcType === 'krykna' && attackerPlayerNum && opts?.awardObjectiveVp) {
    vp = 2;
    opts.awardObjectiveVp(game, attackerPlayerNum, vp);
    logs.push({ kind: 'defeat',
      msg: `🏆 **${label} defeated** — Player ${attackerPlayerNum} gains **${vp} VP** (Krykna kill bonus).`,
      opts: { phase: 'ROUND', icon: 'vp' } });
  } else {
    logs.push({ kind: 'defeat', msg: `💀 **${label}** defeated.`, opts: { phase: 'ROUND', icon: 'attack' } });
  }
  // Nefarious Gains (Jabba) per alexanbv 2026-05-11: NPC cost = 0, but
  // Jabba's "+1 VP per hostile defeated" still fires when the defeater's
  // team has Jabba alive. NPCs are neutral so the standard
  // checkNefariousGains "opposing-team" logic doesn't apply — emulate
  // the alive-on-attacker-team check here.
  if (attackerPlayerNum && opts?.awardObjectiveVp) {
    const _jabbaAlive = Object.keys(game.figurePositions?.[attackerPlayerNum] || {}).some(fk => fk.startsWith('Jabba the Hutt-'));
    if (_jabbaAlive) {
      opts.awardObjectiveVp(game, attackerPlayerNum, 1);
      vp += 1;
      logs.push({ kind: 'nefarious_gains',
        msg: `🤑 **Nefarious Gains** — Player ${attackerPlayerNum} (Jabba's army) gains **+1 VP** for defeating ${label} (NPC cost 0 + 1).`,
        opts: { phase: 'ROUND', icon: 'vp' } });
    }
  }
  return { applied: true, prevHp, newHp: 0, defeated: true, vp, label, logs };
}

/**
 * Async wrapper around `applyDamageToNpcSync` for handler-context
 * callers that have a Discord client + logGameAction. Drains the
 * sync core's `logs` queue, then returns the same shape (minus the
 * `logs` field) for callers that expect the legacy contract.
 *
 * Pre-unification this was a parallel ~80-line implementation; now
 * it's a thin adapter that owns only the Discord I/O.
 */
export async function applyDamageToNpc(game, ctx, opts) {
  const { logGameAction, client, awardObjectiveVp } = ctx || {};
  const result = applyDamageToNpcSync(game, { ...opts, awardObjectiveVp });
  if (!result.applied) return { applied: false, prevHp: 0, newHp: 0, defeated: false };
  if (logGameAction && client) {
    for (const entry of result.logs) {
      await logGameAction(game, client, entry.msg, entry.opts).catch(() => {});
    }
  }
  // Match legacy return shape (no `logs`, no `label`).
  return {
    applied: result.applied,
    prevHp: result.prevHp,
    newHp: result.newHp,
    defeated: result.defeated,
    vp: result.vp,
  };
}

/** True if a figureKey refers to an NPC slot (npc_thug_N / npc_krykna_N). */
export function isNpcFigureKey(figureKey) {
  return typeof figureKey === 'string' && /^npc_(?:thug|krykna)_\d+$/.test(figureKey);
}

/** Parse an npc figureKey into { npcType, npcIndex } or null. */
export function parseNpcFigureKey(figureKey) {
  if (typeof figureKey !== 'string') return null;
  const m = figureKey.match(/^npc_(thug|krykna)_(\d+)$/);
  if (!m) return null;
  return { npcType: m[1], npcIndex: parseInt(m[2], 10) };
}

/**
 * Classify an adjacency-helper entry as hostile (or treated-as-hostile) for
 * ability-targeting purposes.
 *   - Opponent's regular figure → hostile
 *   - NPC with hostility 'hostile' or 'treatedAsHostile' → counts as hostile target
 *   - NPC with hostility 'neutral' → not a valid hostile target
 *
 * Use at hostile-target callsites so Force Choke / Trample / Demolish / etc.
 * include Thugs (hostile) AND Krykna (treated-as-hostile) when card text reads
 * "hostile figure" per CRR neutral-figure rules.
 */
export function isEntryHostileTo(game, entry, playerNum) {
  if (!entry) return false;
  if (entry.isNpc) {
    const arr = entry.npcType === 'thug' ? game?.npcThugs : entry.npcType === 'krykna' ? game?.npcKrykna : null;
    const h = npcHostility(arr?.[entry.npcIndex]);
    return h === 'hostile' || h === 'treatedAsHostile';
  }
  return entry.playerNum != null && entry.playerNum !== playerNum;
}

/** Human-readable label for an adjacency entry (NPC or regular figure). */
export function entryDisplayLabel(entry) {
  if (!entry) return 'figure';
  if (entry.isNpc) {
    const label = entry.npcType === 'thug' ? 'Thug' : 'Krykna';
    return `${label} ${(entry.npcIndex ?? 0) + 1}`;
  }
  return (entry.figureKey || '').replace(/-\d+-\d+$/, '');
}
