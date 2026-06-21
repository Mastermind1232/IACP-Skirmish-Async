/**
 * Start-of-Round trigger descriptor enumeration.
 *
 * Produces the per-DC ability descriptors that the unified round-trigger
 * orchestrator (round-trigger-orchestrator.js) resolves in strict bins
 * (mission rules → init player → non-init player; player chooses order
 * within a bin). Per alexanbv 2026-06-13.
 *
 * Each descriptor: { id, ownerPlayerNum, sourceMsgId, sourceLabel,
 * abilityId, extras }. Mission-rule SoR effects are supplied separately by
 * the caller (mission bin), not here.
 *
 * NOTE: this enumerates which SoR abilities are *pending*; firing each
 * effect stays in the existing handlers, invoked when the orchestrator
 * hands the descriptor back. The set mirrors the SoR detectors currently
 * in runStartOfRoundDcEffects.
 */
import { getDcEffects } from '../data-loader.js';
import { getDcList, getDcMessageIds } from './player-helpers.js';

// SoR ability id -> human label. Keep in sync with runStartOfRoundDcEffects.
const SOR_ABILITIES = [
  { id: 'brash_ezra', label: 'Brash (move up to 4)' },
  { id: 'force_slow_cal', label: 'Force Slow' },
  { id: 'excavation_aphra', label: 'Excavation' },
  { id: 'programming_override_4lom', label: 'Programming Override' },
  { id: 'shift_clawdite_elite', label: 'Shift' },
  { id: 'shift_clawdite_reg', label: 'Shift' },
  { id: 'last_wielder_darksaber_bokatan', label: 'Last Wielder of the Darksaber' },
];
const SOR_ABILITY_IDS = new Set(SOR_ABILITIES.map((a) => a.id));
const SOR_LABEL = Object.fromEntries(SOR_ABILITIES.map((a) => [a.id, a.label]));

/**
 * Enumerate pending Start-of-Round ability descriptors across both players.
 * @param {object} game
 * @param {object} [deps] - { getDcEffects } injectable for testing
 * @returns {Array<{id,ownerPlayerNum,sourceMsgId,sourceLabel,abilityId,extras}>}
 */
export function enumerateSorDescriptors(game, deps = {}) {
  if (!game) return [];
  const _getDcEffects = deps.getDcEffects || getDcEffects;
  const dcEff = _getDcEffects() || {};
  const out = [];
  for (const playerNum of [1, 2]) {
    const dcList = getDcList(game, playerNum) || [];
    const msgIds = getDcMessageIds(game, playerNum) || [];
    for (let i = 0; i < dcList.length; i++) {
      const dc = dcList[i];
      if (!dc || dc.defeated) continue;
      const eff = dcEff[dc.dcName] || dcEff[dc.dcName?.replace(/\s*\[.*\]\s*$/, '')];
      const sIds = eff?.specialAbilityIds || [];
      for (const aid of sIds) {
        if (!SOR_ABILITY_IDS.has(aid)) continue;
        out.push({
          id: `sor:${aid}:${msgIds[i]}`,
          ownerPlayerNum: playerNum,
          sourceMsgId: msgIds[i],
          sourceLabel: SOR_LABEL[aid],
          abilityId: aid,
          extras: { dcName: dc.dcName },
        });
      }
    }
  }
  return out;
}

export { SOR_ABILITY_IDS };
