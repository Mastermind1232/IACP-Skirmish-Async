/**
 * Object-damage pipeline (alexanbv 2026-05-10).
 *
 * Mission-declared damageable objects. Mission rules' `persistent`
 * block carries a `damageableObjects` array describing objects on
 * the board that can suffer damage from abilities. Each object has
 * an id, current position, and a Health pool. When an object's HP
 * reaches 0, it's removed and any `splashOnDefeat` effect fires.
 *
 * Schema (data/missions/*.json `rules.persistent.damageableObjects`):
 *   [{
 *     id:           'crate-a1',        // unique within mission
 *     name:         'Supply Crate',    // human-readable
 *     coord:        'i12',             // initial position (lowercase)
 *     health:       5,                 // max HP
 *     targetable:   true,              // optional, default false; if true,
 *                                      // can be declared as a primary attack
 *                                      // target AND a valid cleave target
 *     defenseBlock: 1,                 // optional, default 0; inherent block
 *                                      // applied to any attack vs this object
 *                                      // (no defense die)
 *     defenseEvade: 0,                 // optional, default 0; inherent evade
 *     splashOnDefeat: {                // optional, fires on HP→0
 *       amount: 2,                     // damage per affected figure
 *       radius: 1,                     // figures within N of object's coord
 *       target: 'all'                  // 'all' | 'hostile' | 'friendly' (relative to attacker)
 *     },
 *     vpOnDefeat:   { playerNum: 'attacker', amount: 1 },  // optional
 *     moves:        false              // can be pushed/moved
 *   }, ...]
 *
 * State:
 *   game.objectHealth    = { [id]: [cur, max] }
 *   game.objectPositions = { [id]: coord }
 *   game.objectMeta      = { [id]: { name, splashOnDefeat, vpOnDefeat, moves } }
 *     ↳ frozen snapshot of mission-rule entry so handlers don't need to re-read rules
 *
 * Per alexanbv 2026-05-10:
 *   - Blast (step 8) and Cleave damage objects on/adjacent to target if
 *     they're declared damageable.
 *   - Splash effects only damage objects when the card text explicitly
 *     mentions "figure and object" (e.g. Shrapnel). Other AoE abilities
 *     skip objects (e.g. Wrist Flamethrower, Demolish).
 *   - Objects can be primary attack targets when the mission rules say so.
 */

import { countGameSpaces } from './board-helpers.js';

/**
 * Initialize object state from mission rules at mission load. Idempotent
 * — re-running on an already-initialized game is a no-op.
 *
 * @param {object} game - game state
 */
export function initDamageableObjectsForMission(game) {
  const objects = game?.selectedMission?.rules?.persistent?.damageableObjects;
  if (!Array.isArray(objects) || objects.length === 0) return;
  game.objectHealth = game.objectHealth || {};
  game.objectPositions = game.objectPositions || {};
  game.objectMeta = game.objectMeta || {};
  for (const obj of objects) {
    if (!obj?.id) continue;
    if (game.objectHealth[obj.id]) continue;
    const max = Number(obj.health) > 0 ? Number(obj.health) : 1;
    game.objectHealth[obj.id] = [max, max];
    if (obj.coord) game.objectPositions[obj.id] = String(obj.coord).toLowerCase();
    game.objectMeta[obj.id] = {
      name: obj.name || obj.id,
      targetable: !!obj.targetable,
      defenseBlock: Number(obj.defenseBlock) > 0 ? Number(obj.defenseBlock) : 0,
      defenseEvade: Number(obj.defenseEvade) > 0 ? Number(obj.defenseEvade) : 0,
      splashOnDefeat: obj.splashOnDefeat || null,
      vpOnDefeat: obj.vpOnDefeat || null,
      moves: !!obj.moves,
    };
  }
}

/**
 * Adapter that creates a `ctx.applyFigureDamageAt(coord, radius, amount, opts)`
 * function suitable for passing into applyDamageToObject as the splash
 * delegate. Iterates figures within `radius` of `coord`, optionally
 * filtered by `opts.filter` ('all' | 'hostile' | 'friendly' relative to
 * `opts.attackerPlayerNum`), and routes each through the canonical
 * applyDamage so figure-defeat hooks fire. Returns the number of figures
 * actually damaged.
 *
 * Wire this into call sites that invoke applyDamageToObject so
 * splashOnDefeat resolves correctly. Without it, splash is silently
 * skipped.
 */
export function makeFigureDamageAtAdapter(game, ctx) {
  return async function applyFigureDamageAt(coord, radius, amount, opts) {
    const { attackerPlayerNum, source, filter = 'all' } = opts || {};
    if (!coord || amount <= 0) return 0;
    const c = String(coord).toLowerCase();
    let count = 0;
    const { applyDamage } = await import('./damage-pipeline.js');
    const { logGameAction, client, dcHealthState, findDcMessageIdForFigure, deps, thread } = ctx || {};
    for (const pn of [1, 2]) {
      if (filter === 'hostile' && pn === attackerPlayerNum) continue;
      if (filter === 'friendly' && pn !== attackerPlayerNum) continue;
      for (const [fk, pos] of Object.entries(game.figurePositions?.[pn] || {})) {
        if (!pos) continue;
        const dist = countGameSpaces(game, c, String(pos).toLowerCase());
        if (typeof dist !== 'number' || dist < 0 || dist > radius) continue;
        const fMsgId = typeof findDcMessageIdForFigure === 'function'
          ? findDcMessageIdForFigure(game.gameId, pn, fk)
          : null;
        if (!fMsgId) continue;
        const fkMatch = fk.match(/-(\d+)-(\d+)$/);
        const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
        try {
          await applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
            figureKey: fk, msgId: fMsgId, figIndex: figIdx,
            amount, controllerPlayerNum: pn,
            attackerPlayerNum,
            source: source || 'Object splash',
          });
          count++;
        } catch (err) {
          console.error('[applyFigureDamageAt] applyDamage failed:', err?.message ?? err);
        }
      }
    }
    return count;
  };
}

/** True iff the object id is alive (HP > 0). */
export function isObjectAlive(game, objectId) {
  const hp = game?.objectHealth?.[objectId];
  return Array.isArray(hp) && (hp[0] ?? 0) > 0;
}

/** Lazy-init shim — callable from any consumer; no-op if already initialized
 *  or if the mission has no damageable objects. Cheap. */
function _ensureInit(game) {
  if (!game) return;
  if (!game.objectHealth) initDamageableObjectsForMission(game);
}

/** Returns object IDs occupying the given coord (lowercase compared). */
export function getDamageableObjectsAtCoord(game, coord) {
  _ensureInit(game);
  if (!coord || !game?.objectPositions) return [];
  const c = String(coord).toLowerCase();
  const positions = game?.objectPositions || {};
  const out = [];
  for (const [id, pos] of Object.entries(positions)) {
    if (!pos) continue;
    if (String(pos).toLowerCase() !== c) continue;
    if (!isObjectAlive(game, id)) continue;
    out.push(id);
  }
  return out;
}

/**
 * Returns object IDs whose coord is within N spaces of the given coord
 * (inclusive). Uses countGameSpaces for the same distance metric figures
 * use, so doors / impassable walls etc. are respected.
 */
export function getDamageableObjectsWithinN(game, coord, n) {
  _ensureInit(game);
  if (!coord || n < 0 || !game?.objectPositions) return [];
  const c = String(coord).toLowerCase();
  const positions = game?.objectPositions || {};
  const out = [];
  for (const [id, pos] of Object.entries(positions)) {
    if (!pos) continue;
    if (!isObjectAlive(game, id)) continue;
    const dist = countGameSpaces(game, c, String(pos).toLowerCase());
    if (typeof dist === 'number' && dist >= 0 && dist <= n) out.push(id);
  }
  return out;
}

/**
 * Apply N damage to an object id. Mutates game.objectHealth. On HP→0,
 * removes the object from positions and fires splashOnDefeat (delegated
 * to caller-supplied applyFigureDamage so the AoE goes through the
 * canonical figure-damage pipeline) plus vpOnDefeat.
 *
 * Returns { applied, prevHp, newHp, defeated, splashTargets, vp }.
 */
/**
 * SYNCHRONOUS object-damage entry point (alexanbv 2026-06-22 — all damage goes
 * through the pipeline). For sync resolvers (resolveAbility handlers, activation
 * passives) that cannot `await` applyDamageToObject. Handles HP decrement,
 * position removal on defeat, and the (sync) vpOnDefeat hook. splashOnDefeat
 * (which needs the async figure-damage pipeline) is returned in `splashPending`
 * for the caller to resolve if it can; objects with no splashOnDefeat are fully
 * handled here.
 *
 * @param {object} game
 * @param {string} objectId
 * @param {number} amount
 * @param {{attackerPlayerNum?:number, awardObjectiveVp?:Function}} [opts]
 * @returns {{applied:boolean, prevHp:number, newHp:number, defeated:boolean, vp:number, name:string, splashPending:object|null}}
 */
export function applyObjectDamageSync(game, objectId, amount, opts = {}) {
  const { attackerPlayerNum, awardObjectiveVp } = opts;
  const hp = game?.objectHealth?.[objectId];
  const meta = game?.objectMeta?.[objectId] || {};
  const name = meta.name || objectId;
  if (!Array.isArray(hp) || (hp[0] ?? 0) <= 0 || !(amount > 0)) {
    return { applied: false, prevHp: hp?.[0] ?? 0, newHp: hp?.[0] ?? 0, defeated: false, vp: 0, name, splashPending: null };
  }
  const [cur, max] = hp;
  const newHp = Math.max(0, cur - amount);
  game.objectHealth[objectId] = [newHp, max];
  if (newHp > 0) return { applied: true, prevHp: cur, newHp, defeated: false, vp: 0, name, splashPending: null };
  // Defeated — remove from the board and award vpOnDefeat.
  if (game.objectPositions) delete game.objectPositions[objectId];
  let vp = 0;
  if (meta.vpOnDefeat?.amount > 0 && typeof awardObjectiveVp === 'function') {
    const grantPN = meta.vpOnDefeat.playerNum === 'attacker' ? attackerPlayerNum : meta.vpOnDefeat.playerNum;
    if (grantPN === 1 || grantPN === 2) { awardObjectiveVp(game, grantPN, meta.vpOnDefeat.amount); vp = meta.vpOnDefeat.amount; }
  }
  return { applied: true, prevHp: cur, newHp: 0, defeated: true, vp, name, splashPending: meta.splashOnDefeat || null };
}

export async function applyDamageToObject(game, ctx, opts) {
  const { objectId, amount, attackerPlayerNum, source } = opts;
  if (!objectId || !amount || amount <= 0) {
    return { applied: false, prevHp: 0, newHp: 0, defeated: false };
  }
  const hp = game?.objectHealth?.[objectId];
  if (!Array.isArray(hp)) {
    return { applied: false, prevHp: 0, newHp: 0, defeated: false };
  }
  const [cur, max] = hp;
  if ((cur ?? 0) <= 0) {
    return { applied: false, prevHp: 0, newHp: 0, defeated: false };
  }
  const prevHp = cur;
  const newHp = Math.max(0, cur - amount);
  game.objectHealth[objectId] = [newHp, max];
  const meta = game.objectMeta?.[objectId] || {};
  const objName = meta.name || objectId;
  const { logGameAction, client } = ctx || {};
  if (logGameAction && client) {
    await logGameAction(game, client,
      `📦 **${objName}** suffers ${amount} Damage from **${source || 'attack'}** (HP: ${prevHp} → ${newHp}).`,
      { phase: 'ROUND', icon: 'attack' }).catch(() => {});
  }
  if (newHp > 0) {
    return { applied: true, prevHp, newHp, defeated: false };
  }
  // Object defeated — remove from positions, fire splash + VP hooks.
  const coord = game.objectPositions?.[objectId];
  if (game.objectPositions) delete game.objectPositions[objectId];
  if (logGameAction && client) {
    await logGameAction(game, client,
      `💥 **${objName}** destroyed!`,
      { phase: 'ROUND', icon: 'attack' }).catch(() => {});
  }
  // Splash on defeat: figures within radius of object's coord suffer
  // splash.amount Damage. Caller passes ctx.applyFigureDamageAt to route
  // through the canonical figure-damage pipeline.
  const splash = meta.splashOnDefeat;
  let splashTargets = 0;
  if (splash?.amount > 0 && coord && typeof ctx?.applyFigureDamageAt === 'function') {
    const radius = Math.max(0, splash.radius ?? 1);
    splashTargets = await ctx.applyFigureDamageAt(coord, radius, splash.amount, {
      attackerPlayerNum,
      source: `${objName} destroyed`,
      filter: splash.target || 'all',
    });
  }
  // VP on defeat
  let vp = 0;
  if (meta.vpOnDefeat?.amount > 0 && ctx?.awardObjectiveVp) {
    const grantPN = meta.vpOnDefeat.playerNum === 'attacker' ? attackerPlayerNum : meta.vpOnDefeat.playerNum;
    if (grantPN === 1 || grantPN === 2) {
      ctx.awardObjectiveVp(game, grantPN, meta.vpOnDefeat.amount);
      vp = meta.vpOnDefeat.amount;
      if (logGameAction && client) {
        await logGameAction(game, client,
          `🏆 **${objName} destroyed** — Player ${grantPN} +${vp} VP.`,
          { phase: 'ROUND', icon: 'vp' }).catch(() => {});
      }
    }
  }
  return { applied: true, prevHp, newHp: 0, defeated: true, splashTargets, vp };
}
