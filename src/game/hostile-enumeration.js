/**
 * Hostile-figure enumeration (alexanbv 2026-05-10).
 *
 * Returns every figure that is hostile to a given player, INCLUDING
 * mission-rule-declared neutral figures (Thugs, Krykna, future) that
 * are tagged hostileToAll. Replaces ad-hoc `Object.entries(game.figurePositions[oppPN])`
 * iteration in ability/AoE hot paths, so neutral figures correctly fall
 * under "abilities that target hostile figures" per card text.
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
  // Neutral figures tagged hostileToAll
  for (const [arrName, npcType] of [['npcThugs', 'thug'], ['npcKrykna', 'krykna']]) {
    const arr = game[arrName];
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const npc = arr[i];
      if (!npc || npc.defeated) continue;
      if (!npc.hostileToAll) continue;
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
