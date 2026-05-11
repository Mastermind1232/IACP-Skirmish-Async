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

/** True if the NPC's space costs +1 MP to move through (Thug-style hostility). */
export function npcCostsMpToMoveThrough(npc) {
  return npcHostility(npc) === 'hostile';
}

/** True if the NPC blocks objective/terminal control when adjacent (Thug-style). */
export function npcBlocksControl(npc) {
  return npcHostility(npc) === 'hostile';
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
 * Sync core of NPC damage: mutates npc.hp / npc.defeated and awards
 * VP without doing any Discord I/O. Use from synchronous resolvers
 * (resolveAbility); for async callers prefer applyDamageToNpc which
 * also writes a game-log line.
 *
 * Returns { applied, prevHp, newHp, defeated, vp, label }.
 */
export function applyDamageToNpcSync(game, opts) {
  const { npcType, npcIndex, amount, attackerPlayerNum } = opts || {};
  if (!amount || amount <= 0) return { applied: false, prevHp: 0, newHp: 0, defeated: false, vp: 0, label: '' };
  const arrName = npcType === 'thug' ? 'npcThugs' : npcType === 'krykna' ? 'npcKrykna' : null;
  if (!arrName) return { applied: false, prevHp: 0, newHp: 0, defeated: false, vp: 0, label: '' };
  const arr = game[arrName];
  if (!Array.isArray(arr) || !arr[npcIndex]) return { applied: false, prevHp: 0, newHp: 0, defeated: false, vp: 0, label: '' };
  const npc = arr[npcIndex];
  if (npc.defeated) return { applied: false, prevHp: 0, newHp: 0, defeated: false, vp: 0, label: '' };
  const prevHp = npc.hp;
  npc.hp = Math.max(0, npc.hp - amount);
  const label = npcType === 'thug' ? `Thug ${npcIndex + 1}` : `Krykna ${npcIndex + 1}`;
  if (npc.hp > 0) {
    return { applied: true, prevHp, newHp: npc.hp, defeated: false, vp: 0, label };
  }
  npc.defeated = true;
  let vp = 0;
  if (npcType === 'krykna' && attackerPlayerNum && opts?.awardObjectiveVp) {
    vp = 2;
    opts.awardObjectiveVp(game, attackerPlayerNum, vp);
  }
  // Nefarious Gains (Jabba) per alexanbv 2026-05-11: NPC cost = 0,
  // Jabba on defeater's team grants +1 VP.
  if (attackerPlayerNum && opts?.awardObjectiveVp) {
    const _jabbaAlive = Object.keys(game.figurePositions?.[attackerPlayerNum] || {}).some(fk => fk.startsWith('Jabba the Hutt-'));
    if (_jabbaAlive) {
      opts.awardObjectiveVp(game, attackerPlayerNum, 1);
      vp += 1;
    }
  }
  return { applied: true, prevHp, newHp: 0, defeated: true, vp, label };
}

/**
 * Apply damage to a neutral NPC figure (Thug / Krykna). Decrements
 * npc.hp, marks defeated on HP=0, awards VP if attackerPlayerNum is
 * set (per card text: "When a player defeats a Krykna, that player
 * gains 2 VPs"). Distinct from applyDamage (figure pipeline) and
 * applyDamageToObject (object pipeline) — neutrals are figures, not
 * objects, but live in a separate state container.
 *
 * Returns { applied, prevHp, newHp, defeated, vp }.
 */
export async function applyDamageToNpc(game, ctx, opts) {
  const { npcType, npcIndex, amount, attackerPlayerNum, source } = opts;
  if (!amount || amount <= 0) return { applied: false, prevHp: 0, newHp: 0, defeated: false };
  const arrName = npcType === 'thug' ? 'npcThugs' : npcType === 'krykna' ? 'npcKrykna' : null;
  if (!arrName) return { applied: false, prevHp: 0, newHp: 0, defeated: false };
  const arr = game[arrName];
  if (!Array.isArray(arr) || !arr[npcIndex]) return { applied: false, prevHp: 0, newHp: 0, defeated: false };
  const npc = arr[npcIndex];
  if (npc.defeated) return { applied: false, prevHp: 0, newHp: 0, defeated: false };
  const prevHp = npc.hp;
  npc.hp = Math.max(0, npc.hp - amount);
  const { logGameAction, client } = ctx || {};
  const label = npcType === 'thug' ? `Thug ${npcIndex + 1}` : `Krykna ${npcIndex + 1}`;
  if (logGameAction && client) {
    await logGameAction(game, client,
      `🩸 **${label}** suffers ${amount} Damage from **${source || 'attack'}** (HP: ${prevHp} → ${npc.hp}).`,
      { phase: 'ROUND', icon: 'attack' }).catch(() => {});
  }
  if (npc.hp > 0) {
    return { applied: true, prevHp, newHp: npc.hp, defeated: false, vp: 0 };
  }
  npc.defeated = true;
  let vp = 0;
  // Krykna defeat awards 2 VP per card text.
  if (npcType === 'krykna' && attackerPlayerNum && ctx?.awardObjectiveVp) {
    vp = 2;
    ctx.awardObjectiveVp(game, attackerPlayerNum, vp);
    if (logGameAction && client) {
      await logGameAction(game, client,
        `🏆 **${label} defeated** — Player ${attackerPlayerNum} gains **${vp} VP** (Krykna kill bonus).`,
        { phase: 'ROUND', icon: 'vp' }).catch(() => {});
    }
  } else if (logGameAction && client) {
    await logGameAction(game, client,
      `💀 **${label}** defeated.`,
      { phase: 'ROUND', icon: 'attack' }).catch(() => {});
  }
  // Nefarious Gains (Jabba) per alexanbv 2026-05-11: NPC cost = 0, but
  // Jabba's "+1 VP per hostile defeated" still fires when the defeater's
  // team has Jabba alive. Check via attacker's own team (NPCs are
  // neutral so the standard checkNefariousGains' "opposing-team" logic
  // doesn't apply — emulate the alive-on-attacker-team check here).
  if (attackerPlayerNum && ctx?.awardObjectiveVp) {
    const _jabbaAlive = Object.keys(game.figurePositions?.[attackerPlayerNum] || {}).some(fk => fk.startsWith('Jabba the Hutt-'));
    if (_jabbaAlive) {
      ctx.awardObjectiveVp(game, attackerPlayerNum, 1);
      vp += 1;
      if (logGameAction && client) {
        await logGameAction(game, client,
          `🤑 **Nefarious Gains** — Player ${attackerPlayerNum} (Jabba's army) gains **+1 VP** for defeating ${label} (NPC cost 0 + 1).`,
          { phase: 'ROUND', icon: 'vp' }).catch(() => {});
      }
    }
  }
  return { applied: true, prevHp, newHp: 0, defeated: true, vp };
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
