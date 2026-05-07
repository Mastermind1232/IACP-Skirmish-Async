/**
 * Start-of-Activation (SoA) orchestrator.
 *
 * Per destruct 2026-05-07: every SoA effect is a player-driven trigger.
 * No effect fires automatically — players pick which trigger to resolve next
 * within their bucket because the timing relative to other SoA effects can
 * matter. Bucket order is **init-player first, non-init second** (NOT
 * activator-based — if init-player is the opponent, opponent's bucket fires
 * before the activator's).
 *
 * Lifecycle:
 *   1. enumerateSoaDescriptors(game, ctx) — walk activator's DCs/CCs +
 *      opponent's opponent-triggers, return descriptor[] for each pending
 *      SoA decision. Preconditions are evaluated here; effects whose
 *      precondition is false (e.g. Jyn LOS-blocked-by-terrain) are not
 *      enumerated. Effects gated by hidden info (Jyn LOS-blocked-by-figures
 *      where Marksman could unblock) ARE enumerated to avoid info-leaks.
 *   2. bucketize(descriptors, initPlayerNum) — sort by ownerPlayerNum:
 *      bucket[0] = init-player, bucket[1] = non-init.
 *   3. walkBuckets — opens the current bucket; if it has triggers, post the
 *      chooser prompt to bucket-owner. Player picks → resolveTrigger →
 *      re-prompt with remaining → eventually skip/exhaust → advance to
 *      next bucket → continue activation.
 *
 * State persists on game.pendingSoaResolution across Discord round-trips.
 */

import { opponentPlayerNum, getCcHand, getDcList, getDcMessageIds } from './player-helpers.js';
import { getDcEffects, getMapData, getFigureSize } from '../data-loader.js';
import { countGameSpaces } from './board-helpers.js';
import { cardNameIncludes } from './card-names.js';
import { dcNameFromFigureKey } from './dc-helpers.js';
import { hasFigureLineOfSight, getFigureFootprint } from './spatial.js';

/**
 * Enumerate Start-of-Activation descriptors for an activating DC. Returns
 * a (possibly empty) array of descriptor objects, each shaped:
 *   {
 *     id: string,             // unique within the bucket walk
 *     ownerPlayerNum: 1|2,    // who decides whether to fire it
 *     sourceMsgId: string,    // the DC msgId that hosts the effect
 *     sourceLabel: string,    // human-readable, used as the chooser button
 *     subPromptKey: string,   // identifies the sub-prompt path on click
 *     extras: object,         // descriptor-specific data needed at fire time
 *   }
 *
 * Slice 1 (this commit): Vigor only. Subsequent slices migrate the rest.
 */
export function enumerateActivatorSoaDescriptors(game, opts) {
  const { dcName, playerNum, msgId } = opts || {};
  if (!dcName || !playerNum || !msgId) return [];
  const eff = getDcEffects()?.[dcName];
  const descriptors = [];

  // Vigor (Ahsoka Tano, Fifth Brother): SoA choice — gain 2 MP or 1 Block Token.
  // Detected by name match (Vigor isn't in specialAbilityIds today; activation-
  // setup.js used the same name predicate). The descriptor's owner is the
  // ACTIVATING player.
  if (dcName === 'Ahsoka Tano' || dcName === 'Fifth Brother') {
    descriptors.push({
      id: `vigor:${msgId}`,
      ownerPlayerNum: playerNum,
      sourceMsgId: msgId,
      sourceLabel: 'Vigor',
      subPromptKey: 'vigor',
      extras: { dcName },
    });
  }

  // Responsive (Shyla Varad): SoA choice — gain 1 MP or recover 1 Damage.
  if (dcName === 'Shyla Varad') {
    descriptors.push({
      id: `responsive:${msgId}`,
      ownerPlayerNum: playerNum,
      sourceMsgId: msgId,
      sourceLabel: 'Responsive',
      subPromptKey: 'responsive',
      extras: { dcName },
    });
  }

  // Fulcrum (Agent Kallus): SoA y/n — both players draw 1 CC if used.
  if (dcName === 'Agent Kallus') {
    descriptors.push({
      id: `fulcrum:${msgId}`,
      ownerPlayerNum: playerNum,
      sourceMsgId: msgId,
      sourceLabel: 'Fulcrum',
      subPromptKey: 'fulcrum',
      extras: { dcName },
    });
  }

  // Hunger (Wampa Elite): SoA choice — gain 3 MP + Block Token OR 3 MP +
  // Evade Token, but only if no hostile within 2 spaces. When a hostile IS
  // within 2 the trigger doesn't enter the bucket at all.
  if (dcName === 'Wampa (Elite)' && game) {
    const _heDgIdx = (game.dcMessageMeta?.get?.(msgId)?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _heFk = `Wampa (Elite)-${_heDgIdx}-0`;
    const _hePos = game.figurePositions?.[playerNum]?.[_heFk];
    if (_hePos) {
      const _heEnemyNum = opponentPlayerNum(playerNum);
      const _heHostiles = Object.values(game.figurePositions?.[_heEnemyNum] || {});
      const _heAnyClose = _heHostiles.some((hp) => hp && countGameSpaces(game, _hePos, hp) <= 2);
      if (!_heAnyClose) {
        descriptors.push({
          id: `hunger_elite:${msgId}`,
          ownerPlayerNum: playerNum,
          sourceMsgId: msgId,
          sourceLabel: 'Hunger',
          subPromptKey: 'hunger_elite',
          extras: { dcName, figureKey: _heFk },
        });
      }
    }
  }

  // Mounted (Captain Terro / Kuiil / Dewback): grant 3 MP. Per destruct
  // 2026-05-07 even auto grants must be player-driven (timing matters).
  const _abilityIds = eff?.specialAbilityIds || [];
  if (_abilityIds.includes('mounted_terro') || _abilityIds.includes('mounted_kuiil') || _abilityIds.includes('mounted_dewback') || (eff?.passives || []).includes('Mounted')) {
    descriptors.push({
      id: `mounted:${msgId}`,
      ownerPlayerNum: playerNum,
      sourceMsgId: msgId,
      sourceLabel: 'Mounted',
      subPromptKey: 'mounted',
      extras: { dcName },
    });
  }

  // Hunger Regular (Wampa): if no hostile within 3 spaces, gain 2 MP.
  // Trigger only enumerates when the precondition is met.
  if (dcName === 'Wampa' && game) {
    const _hrDgIdx = (game.dcMessageMeta?.get?.(msgId)?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _hrFk = `Wampa-${_hrDgIdx}-0`;
    const _hrPos = game.figurePositions?.[playerNum]?.[_hrFk];
    if (_hrPos) {
      const _hrEnemyNum = opponentPlayerNum(playerNum);
      const _hrHostiles = Object.values(game.figurePositions?.[_hrEnemyNum] || {});
      const _hrAnyClose = _hrHostiles.some((hp) => hp && countGameSpaces(game, _hrPos, hp) <= 3);
      if (!_hrAnyClose) {
        descriptors.push({
          id: `hunger_regular:${msgId}`,
          ownerPlayerNum: playerNum,
          sourceMsgId: msgId,
          sourceLabel: 'Hunger',
          subPromptKey: 'hunger_regular',
          extras: { dcName },
        });
      }
    }
  }

  // Focused on the Kill (Skirmish Upgrade): +2 MP at start.
  const _fotkAtts = game?.p1DcAttachments?.[msgId] || game?.p2DcAttachments?.[msgId] || [];
  if (_fotkAtts.length && cardNameIncludes(_fotkAtts, 'Focused on the Kill')) {
    descriptors.push({
      id: `fotk:${msgId}`,
      ownerPlayerNum: playerNum,
      sourceMsgId: msgId,
      sourceLabel: 'Focused on the Kill',
      subPromptKey: 'fotk',
      extras: { dcName },
    });
  }

  // Comms Jammer (ISB Infiltrator Elite): opponent cannot play CC during
  // this activation. Player-driven so the activator can choose timing.
  if (_abilityIds.includes('comms_jammer_isb')) {
    descriptors.push({
      id: `comms_jammer:${msgId}`,
      ownerPlayerNum: playerNum,
      sourceMsgId: msgId,
      sourceLabel: 'Comms Jammer',
      subPromptKey: 'comms_jammer',
      extras: { dcName },
    });
  }

  // Madness (Taron Malicos): suffer 1 Strain + become Focused if hand ≤ 2.
  // Per destruct 2026-05-07: hand count is re-checked at FIRE time (player
  // can play another SoR CC first to change the count). Enumerator only
  // checks the dcName predicate; the precondition (hand ≤ 2) is verified
  // when the player clicks Apply. If the count is >2 at fire time, the
  // trigger is a no-op (logged).
  if (dcName === 'Taron Malicos') {
    descriptors.push({
      id: `madness:${msgId}`,
      ownerPlayerNum: playerNum,
      sourceMsgId: msgId,
      sourceLabel: 'Madness',
      subPromptKey: 'madness',
      extras: { dcName },
    });
  }

  // Into the Fray (Baze Malbus): +1 MP + 1 Surge Token per hostile with LOS.
  // Surge count is computed at FIRE time so the player can choose timing
  // relative to other SoA effects (e.g. opponent moves a figure first).
  if (dcName === 'Baze Malbus') {
    descriptors.push({
      id: `into_the_fray:${msgId}`,
      ownerPlayerNum: playerNum,
      sourceMsgId: msgId,
      sourceLabel: 'Into the Fray',
      subPromptKey: 'into_the_fray',
      extras: { dcName },
    });
  }

  // Beast Tamer (Skirmish Upgrade): exhaust at start of any one CREATURE's
  // activation. Per destruct 2026-05-07: player chooses to exhaust EITHER
  // for Speed MP OR for Interact Override (Non-Sentient only). Both
  // options exhaust the upgrade. Trigger only enumerates if Beast Tamer
  // is attached and not already exhausted, AND the activating DC has the
  // CREATURE keyword.
  if (_fotkAtts.length && cardNameIncludes(_fotkAtts, 'Beast Tamer')) {
    const _btKws = (eff?.keywords || []).map((k) => String(k).toUpperCase());
    if (_btKws.includes('CREATURE')) {
      const _btExhausted = game?.exhaustedSkirmishUpgrades?.[msgId] || [];
      if (!cardNameIncludes(_btExhausted, 'Beast Tamer')) {
        const _btIsNonSentient = (eff?.abilityText || '').includes('Non-Sentient');
        descriptors.push({
          id: `beast_tamer:${msgId}`,
          ownerPlayerNum: playerNum,
          sourceMsgId: msgId,
          sourceLabel: 'Beast Tamer',
          subPromptKey: 'beast_tamer',
          extras: { dcName, isNonSentient: _btIsNonSentient },
        });
      }
    }
  }

  // Unshakable (neutral 1pt skirmish upgrade): per destruct 2026-05-07
  // friendly-only SoA trigger. Card text: "Exhaust this card at the
  // start of one of your activations and choose 1 of your figures with
  // a figure cost of 9 or greater. That figure discards 1 HARMFUL
  // condition and suffers 1 Strain." Owner = activating player. Trigger
  // only enumerates if the player owns Unshakable, it's not exhausted,
  // and at least one cost-≥9 friendly has a HARMFUL condition.
  if (game) {
    const _usDcList = getDcList(game, playerNum) || [];
    const _usDcMsgIds = getDcMessageIds(game, playerNum) || [];
    let _usMsgId = null;
    for (let _ui = 0; _ui < _usDcList.length; _ui++) {
      if ((_usDcList[_ui]?.dcName || _usDcList[_ui]) === '[Unshakable]') {
        _usMsgId = _usDcMsgIds[_ui] || null;
        break;
      }
    }
    if (_usMsgId) {
      const _usExh = game.exhaustedSkirmishUpgrades?.[_usMsgId] || [];
      const _usDepleted = (game[`p${playerNum}DepletedDcMessageIds`] || []).includes(_usMsgId);
      if (!cardNameIncludes(_usExh, 'Unshakable') && !_usDepleted) {
        const _usAllFigPos = game.figurePositions?.[playerNum] || {};
        let _usAnyEligible = false;
        const _usEffMap = getDcEffects() || {};
        for (const [fk, pos] of Object.entries(_usAllFigPos)) {
          if (!pos) continue;
          const fkDcName = dcNameFromFigureKey(fk);
          const fkCost = _usEffMap[fkDcName]?.cost ?? 0;
          if (fkCost < 9) continue;
          const conds = game.figureConditions?.[fk] || [];
          const harmful = conds.filter((c) => ['Stun', 'Bleed', 'Weaken'].includes(c) && !(c === 'Weaken' && game.disarmPermanentWeakened?.[fk]));
          if (harmful.length > 0) { _usAnyEligible = true; break; }
        }
        if (_usAnyEligible) {
          descriptors.push({
            id: `unshakable:${_usMsgId}`,
            ownerPlayerNum: playerNum,
            sourceMsgId: _usMsgId,
            sourceLabel: 'Unshakable',
            subPromptKey: 'unshakable',
            extras: { unshakableMsgId: _usMsgId },
          });
        }
      }
    }
  }

  // Hair Trigger (Jyn Odan): per destruct 2026-05-07 — opponent trigger
  // when a HOSTILE figure activates within Jyn's reach (LOS check). Card
  // text: "At the start of a hostile figure's activation, you may
  // interrupt to perform an attack that targets that figure. Limit once
  // per round."
  // Per-figure LOS info-leak rule:
  //   - terrain-only LOS check (figures don't block) — uses empty
  //     figureBlockingCoords
  //   - if terrain blocks, don't enumerate (no card can fix)
  //   - if terrain clear (figures may or may not block), enumerate so
  //     Jyn's player isn't forced to reveal whether she has Marksman
  // Once-per-round limit via game.jynHairTriggerUsed[jynMsgId].
  if (game) {
    const _enemyPn = opponentPlayerNum(playerNum);
    const _jynDcList = getDcList(game, _enemyPn) || [];
    const _jynDcMsgIds = getDcMessageIds(game, _enemyPn) || [];
    for (let _ji = 0; _ji < _jynDcList.length; _ji++) {
      const _jyn = _jynDcList[_ji];
      if (!_jyn?.dcName || _jyn.dcName !== 'Jyn Odan') continue;
      const _jynMsgId = _jynDcMsgIds[_ji];
      if (!_jynMsgId) continue;
      if (game.jynHairTriggerUsed?.[_jynMsgId]) continue;
      const _jynDgIdx = (_jyn.displayName || _jyn.dcName).match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const _jynFk = `Jyn Odan-${_jynDgIdx}-0`;
      const _jynPos = game.figurePositions?.[_enemyPn]?.[_jynFk];
      if (!_jynPos) continue;
      // Activator's figure key (per-figure trigger).
      const _actDgIdx = (game.dcMessageMeta?.get?.(msgId)?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const _actFk = `${dcName}-${_actDgIdx}-0`;
      const _actPos = game.figurePositions?.[playerNum]?.[_actFk];
      if (!_actPos) continue;
      // Terrain-only LOS: pass empty figureBlockingCoords. If terrain
      // blocks, skip — no card can fix terrain.
      const _ms = getMapData(game.selectedMap?.id);
      if (!_ms) continue;
      const _jynFp = getFigureFootprint(game, _enemyPn, _jynFk, getFigureSize);
      const _actFp = getFigureFootprint(game, playerNum, _actFk, getFigureSize);
      if (!_jynFp.length || !_actFp.length) continue;
      if (!hasFigureLineOfSight(_jynFp, _actFp, _ms, [])) continue;
      descriptors.push({
        id: `hair_trigger:${_jynMsgId}->${msgId}`,
        ownerPlayerNum: _enemyPn,
        sourceMsgId: _jynMsgId,
        sourceLabel: 'Hair Trigger',
        subPromptKey: 'hair_trigger',
        extras: { dcName: 'Jyn Odan', jynFigureKey: _jynFk, targetFigureKey: _actFk, targetMsgId: msgId, targetPlayerNum: playerNum },
      });
    }
  }

  // Voracious (Rancor): per destruct 2026-05-07 — opponent trigger.
  // Fires on any other figure's activation (Rancor's own activation does
  // NOT trigger). Rancor's player may defeat a friendly non-companion
  // figure within 2 spaces of Rancor to recover 2 Damage and ready
  // Rancor's DC. Limit once per round (tracked via game.voraciousUsed).
  // ONE descriptor per Rancor; sub-prompt enumerates eligible sacrifice
  // targets at fire time.
  if (game) {
    for (const rPn of [1, 2]) {
      const _vrDcList = getDcList(game, rPn) || [];
      const _vrDcMsgIds = getDcMessageIds(game, rPn) || [];
      for (let _ri = 0; _ri < _vrDcList.length; _ri++) {
        const _r = _vrDcList[_ri];
        if (!_r?.dcName) continue;
        const _rEff = getDcEffects()?.[_r.dcName];
        if (!(_rEff?.specialAbilityIds || []).includes('voracious_rancor')) continue;
        // Rancor's own activation does not trigger his own ability.
        if (_r.dcName === dcName && rPn === playerNum) continue;
        const _rMsgId = _vrDcMsgIds[_ri];
        if (!_rMsgId) continue;
        const _rDgIdx = (_r.displayName || _r.dcName).match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
        const _rFk = `${_r.dcName}-${_rDgIdx}-0`;
        const _rPos = game.figurePositions?.[rPn]?.[_rFk];
        if (!_rPos) continue;
        // Limit once per round.
        if (game.voraciousUsed?.[_rMsgId]) continue;
        // Pre-check: at least one eligible friendly non-companion figure
        // within 2 spaces of Rancor must exist.
        const _friendlyPos = game.figurePositions?.[rPn] || {};
        let _anyTarget = false;
        for (const [_fk, _fp] of Object.entries(_friendlyPos)) {
          if (!_fp || _fk === _rFk) continue;
          if (countGameSpaces(game, _rPos, _fp) > 2) continue;
          _anyTarget = true;
          break;
        }
        if (!_anyTarget) continue;
        descriptors.push({
          id: `voracious:${_rMsgId}->${msgId}`,
          ownerPlayerNum: rPn,
          sourceMsgId: _rMsgId,
          sourceLabel: 'Voracious',
          subPromptKey: 'voracious',
          extras: { dcName: _r.dcName, rancorFigureKey: _rFk, rancorPlayerNum: rPn, activatorMsgId: msgId },
        });
      }
    }
  }

  // I Make the Rules Now (Cad Bane): per destruct 2026-05-07 (corrected
  // twice): Fires at start of ANY OTHER figure's activation (any team,
  // any trait — Cad Bane's own activation does NOT trigger). Grants 1 MP
  // to ONE chosen friendly HUNTER (Cad Bane's team) within 4 spaces of
  // Cad Bane — including Cad Bane himself (he is HUNTER). ONE descriptor
  // per Cad Bane; the sub-prompt asks Cad Bane's player which HUNTER to
  // grant. Owner = Cad Bane's player (independent of activator). The
  // sub-prompt enumerates eligible HUNTERs at fire time so the candidate
  // list is fresh.
  if (game) {
    for (const cadPn of [1, 2]) {
      const _imrnDcList = getDcList(game, cadPn) || [];
      const _imrnDcMsgIds = getDcMessageIds(game, cadPn) || [];
      for (let _ii = 0; _ii < _imrnDcList.length; _ii++) {
        const _cad = _imrnDcList[_ii];
        if (!_cad?.dcName) continue;
        const _cadEff = getDcEffects()?.[_cad.dcName];
        if (!(_cadEff?.specialAbilityIds || []).includes('i_make_the_rules_cad_bane')) continue;
        if (_cad.dcName === dcName && cadPn === playerNum) continue;
        const _cadDgIdx = (_cad.displayName || _cad.dcName).match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
        const _cadFk = `${_cad.dcName}-${_cadDgIdx}-0`;
        const _cadPos = game.figurePositions?.[cadPn]?.[_cadFk];
        if (!_cadPos) continue;
        const _cadMsgId = _imrnDcMsgIds[_ii];
        if (!_cadMsgId) continue;
        // Pre-check: at least one eligible friendly HUNTER must exist
        // within 4 spaces, otherwise the descriptor never enters the
        // bucket. The full candidate list is recomputed at fire time.
        const _friendlyPos = game.figurePositions?.[cadPn] || {};
        let _anyHunter = false;
        for (const [_huntFk, _huntPos] of Object.entries(_friendlyPos)) {
          if (!_huntPos) continue;
          const _huntDcName = dcNameFromFigureKey(_huntFk);
          const _huntEff = getDcEffects()?.[_huntDcName];
          const _huntKws = (_huntEff?.keywords || []).map((k) => String(k).toUpperCase());
          if (!_huntKws.includes('HUNTER')) continue;
          if (countGameSpaces(game, _cadPos, _huntPos) > 4) continue;
          _anyHunter = true;
          break;
        }
        if (!_anyHunter) continue;
        descriptors.push({
          id: `imrn:${_cadMsgId}->${msgId}`,
          ownerPlayerNum: cadPn,
          sourceMsgId: _cadMsgId,
          sourceLabel: 'I Make the Rules Now',
          subPromptKey: 'imrn',
          extras: { dcName: _cad.dcName, cadFigureKey: _cadFk, cadPlayerNum: cadPn, activatorMsgId: msgId },
        });
      }
    }
  }

  // Tactical Movement (Fenn Signis): pick a friendly figure within 3 → that
  // figure gains 2 MP. Trigger only enters the bucket when at least one
  // eligible friendly exists.
  if (dcName === 'Fenn Signis' && game) {
    const _tmDgIdx = (game.dcMessageMeta?.get?.(msgId)?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _tmSelfFk = `${dcName}-${_tmDgIdx}-0`;
    const _tmSelfPos = game.figurePositions?.[playerNum]?.[_tmSelfFk];
    if (_tmSelfPos) {
      const _tmCandidates = Object.entries(game.figurePositions?.[playerNum] || {})
        .filter(([fk, fp]) => fp && countGameSpaces(game, _tmSelfPos, fp) <= 3)
        .map(([fk]) => fk);
      if (_tmCandidates.length > 0) {
        descriptors.push({
          id: `tac_move:${msgId}`,
          ownerPlayerNum: playerNum,
          sourceMsgId: msgId,
          sourceLabel: 'Tactical Movement',
          subPromptKey: 'tac_move',
          // destruct 2026-05-07: show ALL eligible figures (no cap of 4).
          // Discord caps a single ActionRow at 5 buttons, but multiple rows
          // can be chunked at the handler. Pass the full list down.
          extras: { dcName, candidates: _tmCandidates, sourceFigureKey: _tmSelfFk },
        });
      }
    }
  }

  return descriptors;
}

/**
 * Build the SoA chooser button row for a bucket.
 * One button per descriptor + a "Skip all remaining" button.
 *
 * The orchestrator does not import discord.js directly; the caller (engine
 * or handler) builds the actual Discord components. This helper just
 * returns the (id, label) pairs the caller can map onto buttons.
 *
 * @param {object} resolution - game.pendingSoaResolution
 * @returns {{ ownerPlayerNum: number, choices: Array<{customId: string, label: string, descId: string}>, gameId: string } | null}
 *   null if no bucket pending
 */
export function describeChooserPrompt(resolution, gameId) {
  if (!resolution || !Array.isArray(resolution.buckets)) return null;
  const bucket = resolution.buckets[resolution.currentBucketIdx];
  if (!bucket || !bucket.descriptors?.length) return null;
  const choices = bucket.descriptors.map((d) => ({
    customId: `soa_pick_${gameId}_${d.id}`,
    label: d.sourceLabel,
    descId: d.id,
  }));
  choices.push({ customId: `soa_skip_all_${gameId}`, label: 'Skip all remaining', descId: '__skip_all__' });
  return { ownerPlayerNum: bucket.ownerPlayerNum, choices, gameId };
}

/**
 * Bucketize descriptors by ownerPlayerNum, ordered init-first.
 * @param {Array} descriptors
 * @param {number} initPlayerNum - the player WITH initiative
 * @returns {Array<{ ownerPlayerNum: number, descriptors: Array }>}
 */
export function bucketize(descriptors, initPlayerNum) {
  const nonInitPlayerNum = opponentPlayerNum(initPlayerNum);
  const initBucket = descriptors.filter((d) => d.ownerPlayerNum === initPlayerNum);
  const nonInitBucket = descriptors.filter((d) => d.ownerPlayerNum === nonInitPlayerNum);
  return [
    { ownerPlayerNum: initPlayerNum, descriptors: initBucket },
    { ownerPlayerNum: nonInitPlayerNum, descriptors: nonInitBucket },
  ];
}

/**
 * Initialize pendingSoaResolution on game from descriptors + activation context.
 * No-op (returns false) if descriptors is empty — caller continues activation
 * inline.
 *
 * @param {object} game
 * @param {Array} descriptors
 * @param {number} initPlayerNum
 * @param {object} activationContext - { activatorPlayerNum, activatorMsgId }
 * @returns {boolean} true if a resolution was started (caller must wait)
 */
export function startSoaResolution(game, descriptors, initPlayerNum, activationContext) {
  if (!Array.isArray(descriptors) || descriptors.length === 0) return false;
  const buckets = bucketize(descriptors, initPlayerNum);
  // Skip empty leading buckets so currentBucketIdx points at the first
  // non-empty one; if both are empty we already returned false above.
  let firstIdx = 0;
  while (firstIdx < buckets.length && buckets[firstIdx].descriptors.length === 0) firstIdx++;
  if (firstIdx >= buckets.length) return false;
  game.pendingSoaResolution = {
    buckets,
    currentBucketIdx: firstIdx,
    activationContext: { ...(activationContext || {}) },
  };
  return true;
}

/**
 * Remove a descriptor by id from the current bucket. Advance to the next
 * non-empty bucket if the current one is exhausted. Clear pendingSoaResolution
 * entirely when no buckets remain.
 *
 * @param {object} game
 * @param {string} descId - descriptor id to remove (e.g. 'vigor:msg_palp')
 * @returns {{ exhausted: boolean }} exhausted=true when activation should resume
 */
export function consumeDescriptor(game, descId) {
  const r = game.pendingSoaResolution;
  if (!r) return { exhausted: true };
  const bucket = r.buckets[r.currentBucketIdx];
  if (!bucket) return { exhausted: true };
  bucket.descriptors = bucket.descriptors.filter((d) => d.id !== descId);
  while (r.currentBucketIdx < r.buckets.length && r.buckets[r.currentBucketIdx].descriptors.length === 0) {
    r.currentBucketIdx++;
  }
  if (r.currentBucketIdx >= r.buckets.length) {
    delete game.pendingSoaResolution;
    return { exhausted: true };
  }
  return { exhausted: false };
}

/**
 * Skip all remaining triggers in the current bucket and advance to the next.
 * Returns true when the resolution is fully exhausted (activation continues).
 */
export function skipCurrentBucket(game) {
  const r = game.pendingSoaResolution;
  if (!r) return true;
  r.currentBucketIdx++;
  while (r.currentBucketIdx < r.buckets.length && r.buckets[r.currentBucketIdx].descriptors.length === 0) {
    r.currentBucketIdx++;
  }
  if (r.currentBucketIdx >= r.buckets.length) {
    delete game.pendingSoaResolution;
    return true;
  }
  return false;
}

/**
 * Look up a descriptor by id in the current bucket.
 */
export function findDescriptorInCurrentBucket(game, descId) {
  const r = game.pendingSoaResolution;
  if (!r) return null;
  const bucket = r.buckets[r.currentBucketIdx];
  if (!bucket) return null;
  return bucket.descriptors.find((d) => d.id === descId) || null;
}
