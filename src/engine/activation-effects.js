/**
 * Deterministic activation effects — shared between Discord and headless.
 * No Discord dependency. Uses only game-state primitives.
 */
import { getDcEffects } from '../data-loader.js';
import { filterCondition } from '../game/conditions.js';
import { getActivatedDcIndices, setActivatedDcIndices, getDcList, getDcMessageIds } from '../game/player-helpers.js';
import { dcNameFromFigureKey } from '../game/dc-helpers.js';

/**
 * Apply deterministic start-of-activation passives for a DC that is beginning activation.
 * Returns a list of applied effects for the caller to log/display.
 *
 * Scope: Mounted, Hunger Regular, Madness, Into the Fray, Comms Jammer,
 *         Focused on the Kill, Beast Tamer.
 *
 * @param {object} game
 * @param {object} opts
 * @param {string} opts.dcName - The DC name (e.g. 'Captain Terro')
 * @param {number} opts.playerNum - 1 or 2
 * @param {string} opts.displayName - Display name with DG tag
 * @param {string} opts.msgId - DC message ID
 * @param {Map} [opts.dcHealthState] - DC health state Map (needed for Madness strain)
 * @returns {{ applied: Array<{ effect: string, message: string }> }}
 */
export function applyStartOfActivationEffects(game, { dcName, playerNum, displayName, msgId, dcHealthState }) {
  const applied = [];
  const dcEff = getDcEffects()?.[dcName];
  const abilityIds = dcEff?.specialAbilityIds || [];

  // Scrap Battalion (Ugnaught Tinkerer Reg + Elite): auto-readies the
  // Junk Droid at the start of each Ugnaught's activation. Per destruct
  // 2026-05-07: this is one of the few SoA effects that fires
  // automatically — the Junk-Droid ready/exhaust state is the gate that
  // enables effective multiple Junk Droid activations per round when
  // combined with Spot Weld's place-and-ready mechanic.
  if (abilityIds.includes('scrap_battalion_ugnaught') ||
      abilityIds.includes('scrap_battalion_ugnaught_elite') ||
      (dcEff?.abilityText || '').includes('Scrap Battalion')) {
    const _sbDcList = getDcList(game, playerNum) || [];
    const _sbDcMsgIds = getDcMessageIds(game, playerNum) || [];
    for (let _sbI = 0; _sbI < _sbDcList.length; _sbI++) {
      if ((_sbDcList[_sbI]?.dcName || _sbDcList[_sbI]) === 'Junk Droid') {
        const _sbJdMsgId = _sbDcMsgIds[_sbI];
        if (_sbJdMsgId) {
          // Record the ready intent. The actual dcExhaustedState Map
          // lives in ctx — applyStartOfActivationEffects is shared with
          // headless and doesn't have direct access; the Discord caller
          // flips the Map after this returns. Idempotent if JD is
          // already ready (set(false) is a no-op).
          game._scrapBattalionReadyJd = game._scrapBattalionReadyJd || [];
          if (!game._scrapBattalionReadyJd.includes(_sbJdMsgId)) {
            game._scrapBattalionReadyJd.push(_sbJdMsgId);
          }
          applied.push({ effect: 'Scrap Battalion', message: `\u{1F527} **Scrap Battalion** — **Junk Droid** is readied at the start of **${displayName}**'s activation.` });
        }
        break;
      }
    }
  }

  // Mounted / Hunger Regular: migrated to SoA orchestrator (slice 3 —
  // destruct 2026-05-07 "do not make any effects auto, let players pick to
  // trigger each one"). See src/game/soa-orchestrator.js
  // enumerateActivatorSoaDescriptors. Auto-fire branches removed; the
  // chooser at activation start covers both.

  // Madness / Into the Fray: migrated to SoA orchestrator (slice 4 —
  // destruct 2026-05-07 "even auto effects matter for timing"). See
  // src/game/soa-orchestrator.js. Madness re-checks hand size at fire
  // time so the player can play another SoR CC first to change the
  // count. Into the Fray's surge count recomputes at fire time.

  // Comms Jammer / Focused on the Kill: migrated to SoA orchestrator
  // (slice 3 — destruct 2026-05-07). See enumerateActivatorSoaDescriptors.
  // attachments still needed downstream for Beast Tamer (which remains
  // inline pending slice 4).
  const attachments = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];

  // Beast Tamer / I Make the Rules Now: migrated to SoA orchestrator
  // (slice 4 — destruct 2026-05-07 "even auto effects matter for timing,
  // and BT can be exhausted for either MP or interact override").
  // IMTRN now triggers on EITHER team's HUNTER activation per destruct.

  return { applied };
}

/**
 * Apply deterministic end-of-activation effects for a DC that just finished activating.
 * Returns a list of applied effects for the caller to log/display.
 *
 * @param {object} game
 * @param {object} opts
 * @param {string} opts.dcName - The DC name (e.g. 'Riot Trooper (Elite)')
 * @param {number} opts.playerNum - 1 or 2
 * @param {string} opts.displayName - Display name with DG tag
 * @param {string} opts.msgId - DC message ID
 * @returns {{ applied: Array<{ effect: string, message: string }> }}
 */
export function applyEndOfActivationEffects(game, { dcName, playerNum, displayName, msgId, figureIndex }) {
  const applied = [];
  const dcEff = getDcEffects()?.[dcName];
  const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
  const prefix = `${dcName}-${dgIndex}-`;
  let figureKeys = Object.keys(game.figurePositions?.[playerNum] || {}).filter(k => k.startsWith(prefix));
  // Per destruct 2026-05-07: each figure of a multi-figure group has
  // individual EoA. When figureIndex is supplied, narrow the figureKeys
  // loop to the single locking figure. When omitted (single-figure
  // group end-of-activation), the loop runs over all figures (legacy
  // behavior).
  if (typeof figureIndex === 'number' && figureIndex >= 0) {
    figureKeys = figureKeys.filter(k => k === `${dcName}-${dgIndex}-${figureIndex}`);
  }

  // Weakened auto-discards at end of activation (CRR-WKN-002: WEAKENED L2772-2775).
  // Disarm permanent Weakened lock (filterCondition) keeps the condition through the filter.
  for (const fk of figureKeys) {
    if (!game.figureConditions?.[fk]?.includes('Weaken')) continue;
    if (game.disarmPermanentWeakened?.[fk]) continue;
    filterCondition(game, fk, 'Weaken');
    applied.push({ effect: 'Weaken discard', message: `**Weakened** — **${dcNameFromFigureKey(fk)}** discarded Weaken at end of activation.` });
  }

  // Shield (Riot Trooper E/R), In The Shadows (ISB Infiltrator Elite),
  // Unnerving (0-0-0), and Hold the Line (Baze Malbus): these were
  // previously auto-fired here. Per the owner's rule (destruct 2026-05-07
  // "let players pick to trigger each one") every EoA ability must be
  // PLAYER CHOICE. They are now enumerated as player-choice descriptors in
  // src/game/eoa-orchestrator.js (subPromptKeys shield / in_the_shadows /
  // unnerving / hold_the_line) and resolved in src/handlers/eoa-handler.js.
  // The auto-fire blocks were removed to stop double-firing (once here,
  // once via the orchestrator descriptor).

  // Son of Skywalker: auto-ready Luke's DC after any activation ends (not Luke's own)
  if (game.sonOfSkywalkerActive) {
    const sos = game.sonOfSkywalkerActive;
    const sosDcMsgId = sos.dcMsgId;
    const sosPlayerNum = sos.playerNum;
    if (sosDcMsgId !== msgId) {
      const sosActivated = getActivatedDcIndices(game, sosPlayerNum);
      const sosDcIds = sosPlayerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      const sosIdx = (sosDcIds || []).indexOf(sosDcMsgId);
      if (sosIdx >= 0 && Array.isArray(sosActivated) && sosActivated.includes(sosIdx)) {
        setActivatedDcIndices(game, sosPlayerNum, sosActivated.filter((i) => i !== sosIdx));
        applied.push({ effect: 'Son of Skywalker', message: `**Son of Skywalker** — **Luke Skywalker** is automatically **Readied**.` });
      }
    }
  }

  return { applied };
}
