/**
 * Activation + round state cleanup.
 * Single authoritative lists of per-activation and round-scoped flags.
 */

// dcMessageMeta is set lazily by game-state.js after its module init
// completes. Cannot static-import here because game-state.js sits at the
// top of the dependency graph (game-state → domain/event-store →
// domain/reducer → activation-reducer → activation-state).
//
// game-state.js calls _registerDcMessageMeta(dcMessageMeta) on init.
// All handler/ability call sites that fire after game-state.js is loaded
// (i.e. once Discord is up) see the registered Map.
let _dcMessageMeta = null;
export function _registerDcMessageMeta(map) {
  _dcMessageMeta = map;
}

/**
 * Per-activation flags keyed by msgId.
 * Deleted from game[key] at end of activation.
 */
const ACTIVATION_MSGID_FLAGS = [
  'dcActionsData',
  'movementBank',
  'dcFinishedPinged',
  'pendingEndTurn',
  // fellSwoopFreeAttack MIGRATED 2026-05-13 → ACTIVATION_FIGKEY_FLAGS
  // (alexanbv: per-figure, not per-group).
  // overrunThisActivation + overrunDamagedThisMove MIGRATED 2026-05-13
  // → ACTIVATION_FIGKEY_FLAGS (alexanbv: "During this activation" =
  // per-figure activation).
  // pummelTwoAttacksThisActivation + pummelAttacksRemaining MIGRATED
  // 2026-05-13 → ACTIVATION_FIGKEY_FLAGS (alexanbv: per-figure).
  // stayDownPendingMsgId, burstFirePendingMsgId, cripplingBlowPending,
  // disruptorRiflePending, tonfaStrikeSecondAttack, barrageSecondAttack,
  // barrageTargetSpace, barrageDefenseBonus MIGRATED 2026-05-13 →
  // ACTIVATION_FIGKEY_FLAGS (alexanbv: every attack-frame grant is
  // per-figure unless card text says "group").
  // closeQuartersActive + mobileMovementActive MIGRATED 2026-05-13 →
  // ACTIVATION_FIGKEY_FLAGS (alexanbv: "all specials are per figure").
  // pendingMultiTargetRoll MIGRATED 2026-05-13 → ACTIVATION_FIGKEY_FLAGS
  // (alexanbv: Trample is per-figure; the chained picker belongs to the
  // figure that started it).
  'pendingMoveX',
  // On a Mission per-step push prompt: pauses the picker between steps
  // so the player can push a SMALL figure 1 space (or skip).
  'pendingOnAMissionPush',
  // Wild Beast (Bantha Rider) — per alexanbv 2026-05-10: when an attack
  // is granted to Bantha, may perform a Special Action instead. Limit
  // once per activation. Status-phase context tracked separately via
  // ROUND_OBJECT_FLAGS.wildBeastUsedThisStatusPhase.
  'wildBeastUsedThisActivation',
  // attackDicePenaltyForMsgId MIGRATED 2026-05-13 → ACTIVATION_FIGKEY_FLAGS
  // (alexanbv: per-figure since the penalty applies to a specific
  // attacking figure's pool).
  'rushPending',
  'shoulderRushPending',
  // forcedAttackTarget MIGRATED 2026-05-13 → ACTIVATION_FIGKEY_FLAGS
  // (alexanbv: per-figure; the forced-target lock applies to the
  // specific figure that received the grant, not the whole group).
  // Firing Squad's cross-trooper lock lives separately in
  // firingSquadLockedTarget (per-invocation, not per-figure).
  // selfDefeatsAfterAttackMsgId + postActivationConditions MIGRATED
  // 2026-05-13 → ACTIVATION_FIGKEY_FLAGS (alexanbv: per-figure).
  // applySelfStunAfterAttackFigureKey RECATEGORIZED 2026-05-13 →
  // ACTIVATION_PLAYERNUM_FLAGS (write site keys by playerNum, not msgId;
  // the msgId-cleanup loop never matched, leaving stale state if the
  // attack handler skipped its own delete on an error path).
  'pendingCombatResupply',
  'pendingTransmitPlans',
  'transmitPlansVpAwarded',
  // pendingPostAttackConditions DROPPED 2026-05-13 — only consumer was
  // gated by `if (false && ...)`; no live writers anywhere. Dead code.
  // pendingMpBonus retained — no live writers in main, but the
  // activation-cost-behavioral test asserts cleanup, and pending-state-
  // lint locks the readers in activation-setup.js.
  'pendingMpBonus',
  // freeAttackBonusPending moved to ACTIVATION_FIGKEY_FLAGS 2026-05-09
  // (per IACP rule clarification: "free attack bonus" is per-figure, not
  // per-multifigure-group; figureKey-keyed so figure 1's pending free
  // attack is not consumed by figure 0's attack).
  // freeAttackDifferentTargets MIGRATED 2026-05-13 → ACTIVATION_FIGKEY_FLAGS.
  // heroicUsedThisActivation + boRifleStaffUsedThisActivation moved
  // to ACTIVATION_FIGKEY_FLAGS 2026-05-09 (per-figure scope per IACP).
  // pendingOverrideAttackDice MIGRATED 2026-05-13 → ACTIVATION_FIGKEY_FLAGS
  // (alexanbv: per-figure attack-frame override; was the largest
  // remaining msgId-keyed surface ~50 sites).
  // pendingSlingBarrage MIGRATED 2026-05-13 → ACTIVATION_FIGKEY_FLAGS.
  // attackTypeOverride + overheatedActive moved to
  // ACTIVATION_FIGKEY_FLAGS 2026-05-09 (per-figure scope per IACP rule).
  // pendingStaticPulse RECATEGORIZED 2026-05-13 → ACTIVATION_SCALAR_FLAGS
  // (stored as a global object, not msgId-keyed; msgId cleanup never
  // matched. Round-boundary already clears via ROUND_OBJECT_FLAGS).
  // pendingForceCardPick RECATEGORIZED 2026-05-13 → ACTIVATION_SCALAR_FLAGS
  // (stored as a global object, not msgId-keyed).
  // nextAttackReach moved to ACTIVATION_FIGKEY_FLAGS 2026-05-09 (per-
  // figure scope per IACP multifigure-independent-activation rule).
  // selfDestructProtocolTriggered MIGRATED 2026-05-13 → ACTIVATION_FIGKEY_FLAGS.
  'falseOrdersUpgrade',
  // setTrapSpace MIGRATED 2026-05-13 → ROUND_OBJECT_FLAGS (alexanbv:
  // "Set a Trap is SoR/EoR" — round-scoped, not per-activation).
  // reverseEngineerActive RECATEGORIZED 2026-05-13 →
  // ACTIVATION_PLAYERNUM_FLAGS (write at abilities.js sets
  // `game.reverseEngineerActive[playerNum] = true`; consumed at attack-
  // declare in combat.js which deletes by playerNum. msgId cleanup
  // never matched.)
  // findsmanMeditationTarget RECATEGORIZED 2026-05-13 →
  // ACTIVATION_PLAYERNUM_FLAGS (write at abilities.js sets
  // `game.findsmanMeditationTarget[playerNum] = chosenDcName`; msgId
  // cleanup never matched).
  // nextAttackIgnoreFigureLOS + optimalBombardmentBlastBonus MIGRATED
  // 2026-05-13 → ACTIVATION_FIGKEY_FLAGS (alexanbv: per-figure).
  // deflectionPending + deflectionUnconditional RECATEGORIZED 2026-05-13
  // → ACTIVATION_PLAYERNUM_FLAGS (writes by playerNum, msgId cleanup
  // never matched; round-boundary still resets via ROUND_OBJECT_FLAGS).
  'dcActivationLogMessageIds',
  'defenderThreadData',
  'deviceRerollGranted',
  // autofireActive + fireMissionActive + autofireChainTargetSpace
  // MIGRATED 2026-05-13 → ACTIVATION_FIGKEY_FLAGS (alexanbv: per-figure).
  // darksaberSecondAttack MIGRATED 2026-05-13 → ACTIVATION_FIGKEY_FLAGS.
  // saberOrbitAttacksRemaining + unstableDevicesUsedThisActivation
  // moved to ACTIVATION_FIGKEY_FLAGS 2026-05-09 (per-figure scope).
  'pendingOverwatchPlacement',
  // activationKills MIGRATED 2026-05-13 → ACTIVATION_FIGKEY_FLAGS
  // (write sites at combat-bridge.js:1236 + after-attack-fire.js:141
  // both key by combat.attackerFigureKey; msgId cleanup never matched).
  // activationDamagedFigures MIGRATED 2026-05-13 → ACTIVATION_FIGKEY_FLAGS
  // (alexanbv: "AIM on rebel troopers is tracked per figure").
  'pendingBoRifle',
  'pendingBombDrop',
  // activationExtraActionThenStun + beastTamerInteractOverride MIGRATED
  // 2026-05-13 → ACTIVATION_FIGKEY_FLAGS (alexanbv: per-figure).
  // imperialRetrofittingMultiAttack + arcingShotActive MIGRATED 2026-05-13
  // → ACTIVATION_FIGKEY_FLAGS (alexanbv: per-figure).
  // wookieeAvengerSlamUsed + specialActionUsedThisActivation MIGRATED
  // 2026-05-13 → ACTIVATION_FIGKEY_FLAGS (alexanbv: "all specials are
  // per figure not per group").
  // focusFireActive + multiFireActive + multiFireBlockedTarget moved
  // to ACTIVATION_FIGKEY_FLAGS 2026-05-09 (per-figure scope per IACP).
  // spotWeldPending DROPPED 2026-05-13 — no live readers/writers
  // anywhere in src/. Dead registry entry.
  // yhsiwOptions RECATEGORIZED 2026-05-13 → ACTIVATION_SCALAR_FLAGS
  // (stored as a global array, not an msgId-keyed map).
  'pendingMissileSalvo',
  'pendingPounceSpaceChoice',
  // Audit 2026-05-05: per-activation msgId-keyed fields surfaced by
  // tests/certification/msgid-flags-completeness.test.js. Each was used
  // as `game.X[msgId] = ...` with inline cleanup at activation/attack
  // resolve, but never registered for the universal cleanup routine.
  // Registering here makes cleanupActivation() zero them per-msgId at
  // activation end, matching their actual lifecycle.
  // activationDoubleSpecialAction MIGRATED 2026-05-13 → ACTIVATION_FIGKEY_FLAGS.
  'companionActivatedBefore',
  // falseOrdersAttackTargets MIGRATED 2026-05-13 → ACTIVATION_FIGKEY_FLAGS
  // (alexanbv: per-figure; the False Orders target list is for the
  // specific controlled figure's attack, not the whole group).
  // paybackBonusSurge MIGRATED 2026-05-13 → ACTIVATION_FIGKEY_FLAGS
  // (write site at post-combat.js:82 already keys by targetFigureKey;
  // read in combat.js at attackerFigureKey. msgId cleanup never matched).
  // pounceAttackPending MIGRATED 2026-05-13 → ACTIVATION_FIGKEY_FLAGS
  // (alexanbv: per-figure; the Pounce attack belongs to the figure
  // that triggered it, not the group).
];

/**
 * Per-activation flags keyed by figureKey (e.g. "Trooper-0-0").
 * Deleted for each figure in the activated deployment group.
 */
const ACTIVATION_FIGKEY_FLAGS = [
  'figureMoved',
  'tripodAttacked',
  // Kuiil "Hop On!" (alexanbv 2026-06-21, CORRECTED model): the special action
  // DESIGNATES a SMALL friendly figure; for the REST OF THIS ACTIVATION, when
  // Kuiil enters that figure's space during movement he pushes it 1 space.
  // game.hopOnDesignated[kuiilFigureKey] = designatedFigureKey. Per-figure and
  // "for the rest of this activation" → clears at end of Kuiil's activation.
  'hopOnDesignated',
  'activationStartPositions',
  'overdriveUsedThisActivation',
  'massiveMovementLocked',
  'figureWallRunActive',
  // Migrated 2026-05-09 from ACTIVATION_MSGID_FLAGS to per-figureKey
  // per IACP rule clarification: "once per activation" applies to
  // each figure's activation in a multifigure group, not the group.
  'heroicUsedThisActivation',
  'boRifleStaffUsedThisActivation',
  'unstableDevicesUsedThisActivation',
  'saberOrbitAttacksRemaining',
  'focusFireActive',
  'multiFireActive',
  'multiFireBlockedTarget',
  'overheatedActive',
  'attackTypeOverride',
  // Migrated 2026-05-09 from ACTIVATION_MSGID_FLAGS to per-figureKey
  // per IACP rule clarification: each figure in a multifigure group has
  // its own complete activation; a figure's pending free attack must not
  // be consumed by another figure in the group.
  'freeAttackBonusPending',
  // Jundland Terror: rides alongside freeAttackBonusPending — the granted
  // interrupt may be an attack OR a Special Action (CSV row 706). Same
  // per-figure scoping and cleanup as the free-attack flag.
  'jundlandTerrorSpecialOption',
  // Jundland Terror "free Special Action" grant (CSV row 706): per-figureKey
  // marker { from }. The render path surfaces that figure's native specials at
  // 0 action cost; the dispatch path skips the action charge + consumes it.
  // Same per-figure activation scoping as the free-attack flag.
  'freeSpecialActionPending',
  // Migrated 2026-05-13 from ACTIVATION_MSGID_FLAGS — same rule. The
  // standard "1 attack per activation" cap is PER FIGURE, not per group.
  // Without Assault, each figure in a multifigure group can still
  // attack once on its own turn.
  'attackPerformedThisActivation',
  // alexanbv 2026-05-13 second-wave migration: Pounce, Fell Swoop,
  // Pummel, Imperial Retrofitting multi-attack grants are ALL per-figure.
  // Using these abilities on figure[0] does not grant them to siblings.
  // IR's once-per-round gate lives in the per-DC exhaust state, not here.
  'pounceAttackPending',
  'fellSwoopFreeAttack',
  'pummelTwoAttacksThisActivation',
  'pummelAttacksRemaining',
  'imperialRetrofittingMultiAttack',
  // Wild Fury (alexanbv 2026-06-21): grants ASSAULT to the activating
  // figure "for that activation" — set in the Wild Fury ccEffect resolver,
  // honored by the 1-attack-per-activation gates in dc-play-area.js and
  // available-actions.js. Per-figure, clears at end of the figure's activation.
  'activationAssaultGranted',
  // alexanbv 2026-05-13 third-wave: attack-frame grants per-figure.
  // CC-special-action grants (Burst Fire, Crippling Blow, Disruptor
  // Rifle, Tonfa Strike, Barrage) tag a single figure to receive the
  // free attack / post-attack effect. Stay Down attaches Stun to the
  // figure that took the free attack. Overrun's "during this activation"
  // is per-figure activation.
  'stayDownPendingMsgId',
  'burstFirePendingMsgId',
  'cripplingBlowPending',
  'disruptorRiflePending',
  'tonfaStrikeSecondAttack',
  'barrageSecondAttack',
  'guildProgrammingRefocus',
  'barrageTargetSpace',
  'barrageDefenseBonus',
  'overrunThisActivation',
  'overrunDamagedThisMove',
  // alexanbv 2026-05-13 fourth-wave: "all specials are per figure".
  'wookieeAvengerSlamUsed',
  'specialActionUsedThisActivation',
  'activationDoubleSpecialAction',
  // alexanbv 2026-05-13 fifth-wave: attack-frame special-action flags.
  'closeQuartersActive',
  'mobileMovementActive',
  'darksaberSecondAttack',
  'attackDicePenaltyForMsgId',
  'pendingSlingBarrage',
  'arcingShotActive',
  // alexanbv 2026-05-13 sixth-wave: defeat-prevention + post-attack
  // self-effects + per-attack LoS overrides + Aim damage tracking.
  'selfDestructProtocolTriggered',
  'selfDefeatsAfterAttackMsgId',
  'postActivationConditions',
  'nextAttackIgnoreFigureLOS',
  'optimalBombardmentBlastBonus',
  'activationDamagedFigures',
  // alexanbv 2026-05-13 seventh-wave: Autofire / Fire Mission per-figure
  // (Z-6 Trooper Autofire + Mortar Trooper Fire Mission both grant
  // per-figure next-attack bonuses).
  'autofireActive',
  'fireMissionActive',
  'autofireChainTargetSpace',
  // alexanbv 2026-05-13 eighth-wave: more per-figure activation grants.
  'activationExtraActionThenStun',
  'beastTamerInteractOverride',
  'freeAttackDifferentTargets',
  // alexanbv 2026-05-13 ninth-wave: Trample chained-picker continuation.
  'pendingMultiTargetRoll',
  // Ready Weapons sequential Damage-token distribution picker (per figureKey).
  'pendingDamageTokenDistribute',
  // alexanbv 2026-05-13 tenth-wave: Payback CC (already keyed by
  // attackerFigureKey at write site; was miscategorized in MSGID list).
  'paybackBonusSurge',
  // alexanbv 2026-05-13 eleventh-wave: activation-kills counter (already
  // keyed by attackerFigureKey at both write sites; was miscategorized).
  'activationKills',
  // Unique-hostile-defeat tracker for Celebration (CSV row 573 condition
  // "a unique hostile figure is defeated"). Keyed by attackerFigureKey at
  // the two defeat write sites (combat-bridge.js + after-attack-fire.js),
  // mirroring activationKills.
  'activationUniqueKills',
  // alexanbv 2026-05-13 twelfth-wave: forced-attack-target lock. The
  // lock is per-figure (Mandalorian Whip, Focus Fire, Battlefield
  // Leadership, Shoulder Rush, Leia/Jyn Hair Trigger). Firing Squad's
  // cross-trooper invocation lock lives separately in
  // firingSquadLockedTarget; combat.js attack-declare checks both.
  'forcedAttackTarget',
  // alexanbv 2026-05-13 thirteenth-wave: False Orders target list
  // keyed by controlledFigureKey (the figure being controlled).
  'falseOrdersAttackTargets',
  // alexanbv 2026-05-13 fourteenth-wave: per-figure attack-frame override
  // (Arsenal, Vanguard, Bo-Rifle, Saber Strike, Darksaber, Wookie Sling,
  // Heavy Repeater, Saber Orbit, Overheated, Multi-Fire, etc.).
  'pendingOverrideAttackDice',
  // Migrated 2026-05-09 from ACTIVATION_PLAYERNUM_FLAGS to per-figureKey
  // per IACP rule clarification 2026-05-09: figures in the same multifigure
  // group have completely independent activations — nothing carries over.
  // These "next attack" bonuses arm during a single figure's activation and
  // must not bleed into a sibling figure's attack within the same group.
  'nextAttackReach',
  'nextAttacksBonusHits',
  'nextAttacksBonusConditions',
  'nextAttackBonusSurgeAbilities',
  'nextAttackBonusPierce',
  'nextAttackBonusAccuracy',
  // vetInstinctsActiveThisActivation REMOVED 2026-05-09 — Veteran
  // Instincts is a one-time token distributor, not a per-activation
  // bonus flag. Card text grants 2 tokens (1 Hit/Surge + 1 Block/Evade)
  // and that's it. No persistent active flag.
  //
  // 2026-05-09: nextAttacksBonusHits + nextAttacksBonusConditions also
  // listed under ACTIVATION_PLAYERNUM_FLAGS below — Beatdown keys by
  // playerNum (group-activation scope per IACP), other abilities by
  // figureKey. Both cleanup routes apply.
];

/**
 * Per-activation flags keyed by playerNum.
 * Deleted for the activating player at end of activation.
 *
 * 2026-05-09: groupNextAttacksBonusHits + groupNextAttacksBonusConditions
 * for Beatdown's group-activation scope (per user clarification:
 * "Beatdown is one exception because it applies to 'group activation'
 * explicitly"). Per-figure scoped variants use nextAttacksBonusHits +
 * nextAttacksBonusConditions instead and are cleaned via
 * ACTIVATION_FIGKEY_FLAGS.
 */
const ACTIVATION_PLAYERNUM_FLAGS = [
  'groupNextAttacksBonusHits',
  'groupNextAttacksBonusConditions',
  // Recategorized 2026-05-13: these were registered in
  // ACTIVATION_MSGID_FLAGS but every write site keys them by playerNum.
  // Their msgId-cleanup loop never matched, so they relied entirely on
  // handler self-cleanup. Round-boundary still resets via
  // ROUND_OBJECT_FLAGS; this gives activation-end cleanup the right
  // shape for safety nets on error paths.
  'applySelfStunAfterAttackFigureKey',
  'findsmanMeditationTarget',
  'deflectionPending',
  'deflectionUnconditional',
  'reverseEngineerActive',
];

/**
 * Per-activation scalar flags (deleted outright).
 */
const ACTIVATION_SCALAR_FLAGS = [
  'commsJammerActivePlayerNum',
  // alexanbv 2026-05-10: unified activation lock keyed by
  // `${msgId}_f${figureIndex}`. Acquired when ANY action is consumed,
  // identifying the exact figure currently activating. Blocks:
  //   - other figures in the same group (different figureIndex)
  //   - companion or other groups (different msgId)
  // Cleared on activation end (via ACTIVATION_SCALAR_FLAGS wipe) and on
  // intra-group figure switch (handleDcFigurePick releases stale lock
  // after the previous figure locked itself via perFigureRemaining→0).
  'activationLockKey',
  // partingShotTriggered is technically msgId-keyed (game.partingShotTriggered[msgId] = true)
  // but is INTENTIONALLY registered here, NOT in ACTIVATION_MSGID_FLAGS. The desired
  // semantic at activation end is "wipe everyone's parting-shot tracking" so the
  // next round's interrupts can fire fresh. ACTIVATION_SCALAR_FLAGS does
  // `delete game[key]` which achieves that whole-field wipe; the defensive
  // `game.partingShotTriggered = game.partingShotTriggered || {}` guard at the use
  // sites rebuilds the map cleanly. Moving to ACTIVATION_MSGID_FLAGS would only
  // delete the activating DC's entry per-msgId — preserving OTHER DCs' stale
  // parting-shot state across activations. Don't move. (Audit 2026-05-05.)
  'partingShotTriggered',
  'onTheLamActive',
  'arcingShotActiveScalar',
  'pendingWookSlamPush',
  'pendingSurgeOverflow',
  // alexanbv 2026-05-13: globals stored without an msgId/figureKey
  // index. Previously registered in ACTIVATION_MSGID_FLAGS where the
  // cleanup loop never matched. Round-boundary already resets these via
  // ROUND_OBJECT_FLAGS; SCALAR-style delete here covers activation-end.
  'pendingStaticPulse',
  'pendingForceCardPick',
  'yhsiwOptions',
  // Overcharged Weapons (CC): activating-hostile context stashed at the
  // start of a hostile activation (activation-setup.js). The
  // overchargedWeaponsEffect resolver reads it to resolve the forced
  // target. Cleared at activation end so it never leaks to a later one.
  'pendingOverchargedWeapons',
  // Parting Blow (CC): reacting-BRAWLER + exiting-hostile context stashed by
  // the move-interrupt posting paths (movement.js / move-interrupts-handler.js)
  // so the partingBlowEffect resolver targets correctly during the opponent's
  // move. Wiped at activation end (and at each new Move action, alongside
  // partingShotTriggered).
  'pendingPartingBlow',
  // All in a Day's Work (CC): set true once a Special Action OR Interact has
  // RESOLVED during the active figure's activation, gating the card's
  // "after you resolve a Special or Interact during your activation" timing.
  // Scalar (the activating player is implied by currentActivationTurnPlayerId);
  // wiped at activation end so the next activation starts unset. alexanbv 2026-06-20.
  'specialOrInteractResolvedThisActivation',
];

/**
 * Compute the canonical figureKey for the figure currently activating
 * under the given msgId. Used by ability/handler SET sites that have
 * only msgId in scope and need to key per-figure flags
 * (e.g. freeAttackBonusPending) without recomputing dgIndex inline.
 *
 * Resolution order:
 *   1. dcActionsData[msgId].selectedFigure (the active figure)
 *   2. fallback: figureIndex 0 (single-figure DCs / pre-activation arms)
 *
 * dcName + dgIndex come from dcMessageMeta. Synchronous lookup.
 *
 * @param {object} game
 * @param {string} msgId
 * @param {number} [overrideFigureIndex] — optional explicit figure index
 *   (use when caller knows the targeted figure, e.g. Officer Order grantee)
 * @returns {string|null} figureKey or null if meta missing
 */
export function figureKeyForActivation(game, msgId, overrideFigureIndex) {
  if (!msgId) return null;
  const meta = _dcMessageMeta?.get(msgId);
  if (!meta?.dcName) return null;
  const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const figureIndex = overrideFigureIndex != null
    ? overrideFigureIndex
    : (game?.dcActionsData?.[msgId]?.selectedFigure ?? 0);
  return `${meta.dcName}-${dgIndex}-${figureIndex}`;
}

/**
 * Clean per-activation state when a DC ends its activation.
 * @param {object} game
 * @param {string} msgId  - DC message ID for the activated card
 * @param {number} playerNum - 1 or 2
 * @param {string[]} figureKeys - all figureKeys for figures in this DG (e.g. ["Trooper-0-0", "Trooper-0-1"])
 */
export function cleanupActivation(game, msgId, playerNum, figureKeys) {
  for (const key of ACTIVATION_MSGID_FLAGS) {
    if (game[key]?.[msgId] !== undefined) delete game[key][msgId];
  }
  for (const key of ACTIVATION_FIGKEY_FLAGS) {
    if (!game[key]) continue;
    for (const fk of figureKeys) {
      delete game[key][fk];
    }
  }
  for (const key of ACTIVATION_PLAYERNUM_FLAGS) {
    if (game[key]?.[playerNum] !== undefined) delete game[key][playerNum];
  }
  for (const key of ACTIVATION_SCALAR_FLAGS) {
    delete game[key];
  }
  // moveInProgress uses compound keys `${msgId}_${figureIndex}` — clean any matching this activation
  if (game.moveInProgress) {
    const prefix = `${msgId}_`;
    for (const mk of Object.keys(game.moveInProgress)) {
      if (mk.startsWith(prefix)) delete game.moveInProgress[mk];
    }
  }
  // Per destruct 2026-05-07: clear the per-activation named-CC bucket so
  // a new activation starts with a fresh set. Each activation is its own
  // timing instance for "duringActivation" / "startofactivation" /
  // "endofactivation" CCs.
  if (game.namedCcsPlayedPerTiming?.activation) {
    delete game.namedCcsPlayedPerTiming.activation;
  }
  // Blend In (K-2SO): "Discard this card at the end of your activation."
  // Clear the untargetable protection for the ending figure(s) and remove the
  // attachment when K-2SO finishes its activation.
  if (game.blendInUntargetable) {
    for (const fk of figureKeys) {
      const entry = game.blendInUntargetable[fk];
      if (!entry) continue;
      delete game.blendInUntargetable[fk];
      if (entry.msgId) {
        const attKey = playerNum === 1 ? 'p1DcAttachments' : 'p2DcAttachments';
        const list = game[attKey]?.[entry.msgId];
        if (Array.isArray(list)) game[attKey][entry.msgId] = list.filter(n => n !== 'Blend In');
      }
    }
    if (Object.keys(game.blendInUntargetable).length === 0) delete game.blendInUntargetable;
  }
  // Clear MASSIVE pushed-this-phase flag for the activating figure(s)
  // (per CRR 2026-05-09): the rule scopes "current phase" to the
  // activating figure's activation cycle, so once that activation
  // ends, the figure may move freely again next phase.
  if (game.massivePushedThisPhase) {
    for (const fk of figureKeys) {
      delete game.massivePushedThisPhase[fk];
    }
    if (Object.keys(game.massivePushedThisPhase).length === 0) {
      delete game.massivePushedThisPhase;
    }
  }
}

/**
 * Per destruct 2026-05-07: multi-figure groups give each figure 2 actions
 * individually. When an action consumes from `actionsData`, we must
 * decrement BOTH the group-wide `remaining` AND the per-figure budget
 * `perFigureRemaining[figIdx]`. When a figure's budget hits 0, lock the
 * figure (figureLocked[figIdx] = true) so it cannot act again — IACP
 * rule "each figure must complete all of their actions before the next
 * figure begins" is enforced by preventing return to a locked figure.
 *
 * Use this helper at every action-consumption site that previously did
 * `actionsData.remaining = Math.max(0, actionsData.remaining - 1)`.
 *
 * @param {object} actionsData  - game.dcActionsData[msgId]
 * @param {number} cost          - 1 for normal action, 2 for Double Action
 * @returns {void}
 */
export function consumeActionForCurrentFigure(actionsData, cost = 1, game = null, msgId = null) {
  if (!actionsData || cost <= 0) return;
  // Unified activation lock (alexanbv 2026-05-10): the lock identifies
  // the exact figure currently activating as `${msgId}_f${figureIndex}`,
  // enforcing "complete one before another" at BOTH scopes:
  //   - intra-group: figure 1 of group A vs figure 2 of group A
  //   - cross-msgId: group A vs companion vs other groups
  // Acquired only when unset (preserves the locked figure across its
  // remaining actions). Cleared on activation end (cleanupActivation
  // wipes via ACTIVATION_SCALAR_FLAGS) and on intra-group figure switch
  // (handleDcFigurePick releases when previous figure is figureLocked).
  if (game && msgId && !game.activationLockKey) {
    const figIdx = actionsData.selectedFigure ?? 0;
    game.activationLockKey = `${msgId}_f${figIdx}`;
  }
  // Per alexanbv 2026-06-13: actions are STRICTLY per-figure — there is no
  // group-level action counter. Decrement only the activating figure's
  // budget. (The old top-level `actionsData.remaining` group bank is gone.)
  const figIdx = actionsData.selectedFigure ?? 0;
  actionsData.perFigureRemaining = actionsData.perFigureRemaining || {};
  {
    const cur = actionsData.perFigureRemaining[figIdx] ?? 2; // DC_ACTIONS_PER_ACTIVATION
    const next = Math.max(0, cur - cost);
    actionsData.perFigureRemaining[figIdx] = next;
    // Per alexanbv 2026-06-24: a figure is NOT auto-locked when it spends its
    // last action. It stays SELECTED (and the lock stays) so the player can
    // still spend banked MP, play Command Cards, and resolve end-of-activation
    // stuff before explicitly ending it. The action handlers already refuse new
    // actions at 0 remaining (figureActionsRemaining guards). The figure ends
    // only via an explicit choice — End Figure (handleDcEndFigure), Done with Xa
    // (handleDcSwitchFig), or End Group Activation — each of which locks it,
    // releases the lock, and fires its per-figure EoA.
  }
}

// ── Per-figure action-budget accessors (alexanbv 2026-06-13) ──────────────
// Actions are strictly per-figure: each figure's remaining budget lives in
// actionsData.perFigureRemaining[figIdx]. There is no group-level counter.

/** Remaining actions for a specific figure (defaults to figure 0; full budget if untracked). */
export function figureActionsRemaining(actionsData, figureIndex) {
  if (!actionsData) return 0;
  const idx = figureIndex ?? actionsData.selectedFigure ?? 0;
  return actionsData.perFigureRemaining?.[idx] ?? 2; // DC_ACTIONS_PER_ACTIVATION
}

/** True if ANY figure of this DC still has actions left (group-done aggregate, computed per-figure). */
export function anyFigureHasActions(actionsData) {
  if (!actionsData) return false;
  const per = actionsData.perFigureRemaining;
  if (!per) return false;
  return Object.values(per).some((v) => (v ?? 0) > 0);
}

/** Sum of remaining actions across all figures (for UI counters). */
export function sumFigureActionsRemaining(actionsData) {
  const per = actionsData?.perFigureRemaining;
  if (!per) return 0;
  return Object.values(per).reduce((a, v) => a + (v ?? 0), 0);
}

/**
 * Grant N extra actions to a specific figure's budget (e.g. Grand Inquisitor,
 * Emperor, Dubious Counterparts), capped at `cap` (default the figure's
 * starting 2). Replaces the old top-level `actionsData.remaining += n`.
 */
export function grantActionToFigure(actionsData, figureIndex, n = 1, cap) {
  if (!actionsData || n <= 0) return;
  const idx = figureIndex ?? actionsData.selectedFigure ?? 0;
  actionsData.perFigureRemaining = actionsData.perFigureRemaining || {};
  const cur = actionsData.perFigureRemaining[idx] ?? 0;
  const ceiling = cap ?? 2; // DC_ACTIONS_PER_ACTIVATION
  actionsData.perFigureRemaining[idx] = Math.min(ceiling, cur + n);
}

/**
 * True iff a click-time-decremented action is still mid-resolution for this DC.
 * Action costs are committed when the button is pressed (Move/Special/etc.),
 * but the resolution can take multiple Discord interactions (move grid, target
 * pick, combat). During that window the "all actions completed" prompt and the
 * End Activation handler must be suppressed — otherwise the user can end the
 * activation with cost paid but effect unresolved (figure stays put, etc.).
 *
 * Checks the three universal in-flight surfaces:
 *   - game.pendingCombat        single-stream global; any pending combat blocks
 *   - game.moveInProgress[k]    compound key `${msgId}_${figureIndex}`
 *   - game.pendingSpacePick[k]  context key contains msgId
 *
 * Ability-specific pending flags (50+) aren't enumerated here — they resolve
 * inside the activation thread via prompts and don't tempt the user toward
 * the End Activation button the way an open move grid does. Avoiding the
 * enumerate-and-drift pattern is intentional.
 */
export function isActivationActionInProgress(game, msgId) {
  return describeActivationActionInProgress(game, msgId) !== null;
}

/**
 * Same checks as isActivationActionInProgress but returns a short
 * human-readable description of WHICH flag is blocking, or null if
 * nothing is blocking. Used by handleDcEndActivation so the player
 * sees the actual cause when their End Activation click is refused
 * (per alexanbv 2026-05-12: bare "action still resolving" is too
 * vague when a stale flag survives a fix).
 */
export function describeActivationActionInProgress(game, msgId) {
  if (!msgId) return null;
  if (game.pendingCombat) return 'combat in progress (pendingCombat)';
  if (game.moveInProgress) {
    const prefix = `${msgId}_`;
    for (const k of Object.keys(game.moveInProgress)) {
      if (k.startsWith(prefix)) return `move grid open (moveInProgress[${k}])`;
    }
  }
  if (game.pendingSpacePick) {
    for (const k of Object.keys(game.pendingSpacePick)) {
      if (k.includes(msgId)) return `space pick pending (pendingSpacePick[${k}])`;
    }
  }
  if (game.pendingSoaResolution) {
    const ctx = game.pendingSoaResolution.activationContext;
    if (ctx?.activatorMsgId === msgId) return 'start-of-activation chooser open (pendingSoaResolution)';
  }
  return null;
}

/**
 * All round-scoped flags reset at start of new round.
 * Object flags are reset to {}; null flags to null; array flags to [].
 */
const ROUND_OBJECT_FLAGS = [
  // Most-recent attack target per attacker msgId. Used by post-attack
  // free-attack abilities (Brutal Cleave) to enforce "different figure"
  // rules. Round-scoped (resets to {} at round start).
  'lastAttackTargetByMsgId',
  // Firing Squad same-target lock per Kayn msgId. Captured on the
  // first chosen Trooper's attack; forces subsequent Troopers in the
  // same invocation to target the same figure. Cleared when the
  // pending queue empties.
  'firingSquadLockedTarget',
  'aphraExcavationOptions',
  // Field Supply (CC) — per-player round flag set when the card is played at
  // start of round (fieldSupplyEffect). Gates Field Supply's attacker-rerolls
  // option (CSV row 654): the reroll is only offered when the attacking figure
  // ALSO spent a Hit/Surge token this attack. Round-scoped (resets to {}).
  'fieldSupplyPlayedRound',
  // setTrapSpace removed 2026-06-18: Set a Trap is intentionally unimplemented
  // (requires a map-tile model the engine lacks), so this round flag is no
  // longer written by any code. See setATrapEffect in abilities.js and
  // UNIMPLEMENTED_CARDS in validation.js.
  // Wild Beast (Bantha Rider) status-phase swap gate. Cleared at round
  // start; status-phase context = once per round-scoped status phase.
  'wildBeastUsedThisStatusPhase',
  // Per-player round COMBAT bonus flags REMOVED 2026-06-20 (alexanbv) — migrated
  // to the per-figure activeRoundModifiers registry (ROUND_ARRAY_FLAGS, see
  // round-modifiers.js): roundDefenseBonusBlock, roundDefenseBonusEvade,
  // roundDefenseAccuracyPenalty, roundDeflectionAccuracyPenalty,
  // roundVehicleDefenseBonusEvade, roundMobilePersonalCombatShield,
  // roundDefenderBonusBlockPerEvade, roundTrooperAttackHitBonus,
  // roundAttackRerollDice, roundAttackSurgeBonus.
  // Generic named-CC per-timing-instance tracker (destruct 2026-05-07).
  // Reset to {} at round start so SOR/EOR/status buckets clear naturally;
  // 'activation' bucket clears explicitly in cleanupActivation; 'attack'
  // bucket clears when pendingCombat resolves (resolvePendingCombat).
  'namedCcsPlayedPerTiming',
  'roundMobileGarSaxonFlamethrower',
  'roundPushImmuneUnlessMassive',
  'roundVehicleSpeedBonus',
  'deflectionPending',
  'deflectionUnconditional',
  'freeAttackBonusPending',
  'jundlandTerrorSpecialOption',
  'freeSpecialActionPending',
  'freeAttackDifferentTargets',
  // heroicUsedThisActivation + boRifleStaffUsedThisActivation moved
  // to ACTIVATION_FIGKEY_FLAGS 2026-05-09 (per-figure scope per IACP).
  'pendingOverrideAttackDice',
  'pendingSlingBarrage',
  // attackTypeOverride + overheatedActive moved to
  // ACTIVATION_FIGKEY_FLAGS 2026-05-09 (per-figure scope per IACP rule).
  // pendingStaticPulse + pendingForceCardPick MOVED 2026-05-13 to
  // ROUND_DELETE_FLAGS — these are global objects, not msgId-keyed
  // maps, so resetting to {} (truthy) breaks the `!game.field`
  // first-call gate. Cleared outright at round boundary instead.
  'nextAttackReach',
  'fellSwoopFreeAttack',
  // Lord of the Sith / [Driven by Hatred]: msgId-keyed "remove N dice
  // from this msgId's next attack pool" one-shot debuff. Cleared on
  // consumption in handleCombatDeclare (see combat.js attack-pool block).
  'attackDicePenaltyForMsgId',
  // On a Mission per-step push state: msgId-keyed snapshot of the
  // SMALL figure currently being prompted for a 1-space push. Cleared
  // by handleOnAMissionPush (direction or skip).
  'pendingOnAMissionPush',
  // Deploy the Garrison per-figure resolution state — tracks which
  // qualifying TROOPER/GUARDIAN figures have already chosen
  // token-or-move so the dispatch knows what's remaining each click.
  'pendingDeployGarrison',
  // Hunt Dissent (Agent Kallus): once-per-round gate keyed by Kallus's
  // playerNum. Set true on the FIRST opponent CC-play of the round
  // when the Hunt Dissent picker fires. Cleared on round boundary so
  // the trigger is available again next round.
  'huntDissentResolvedThisRound',
  'adaptBlaiseResolvedThisRound',
  // Hunt Dissent active distribution state (when picker is open).
  'pendingHuntDissent',
  'overrunThisActivation',
  'roundFigureAbilityUsed',
  'roundEfficientTravel',
  'nextAttackIgnoreFigureLOS',
  'findsmanMeditationTarget',
  'vanishImmunityUntilNextActivation',
  'falseOrdersUpgrade',
  // setTrapSpace listed earlier in this same array (alexanbv 2026-05-13
  // reclassification).
  'reverseEngineerActive',
  'pendingMpBonus',
  'pummelTwoAttacksThisActivation',
  'pummelAttacksRemaining',
  'overrunDamagedThisMove',
  'overdriveUsedThisActivation',
  'stayDownPendingMsgId',
  'burstFirePendingMsgId',
  'cripplingBlowPending',
  'disruptorRiflePending',
  'tonfaStrikeSecondAttack',
  'barrageSecondAttack',
  'guildProgrammingRefocus',
  'barrageTargetSpace',
  'barrageDefenseBonus',
  'pendingMultiTargetRoll',
  'pendingDamageTokenDistribute',
  // Murne Rin "Field Report" — sequential up-to-2 friendly-figure picker
  // continuation (msgId-keyed); transient within an activation.
  'pendingFieldReport',
  // Covering Fire — sequential up-to-3 TROOPER Hide picker continuation
  // ({chosen, candidates}); start-of-round play, resolved immediately.
  'pendingCoveringFire',
  // Built on Hope — top-vs-bottom placement choice for the non-chosen
  // cards (player-keyed {remaining}); transient within a single CC play.
  'pendingBuiltOnHope',
  'closeQuartersActive',
  'selfDestructProtocolTriggered',
  'mobileMovementActive',
  'pendingMoveX',
  'rushPending',
  'shoulderRushPending',
  'forcedAttackTarget',
  'figureMoved',
  'tripodAttacked',
  'hopOnDesignated',
  'activationStartPositions',
  'selfDefeatsAfterAttackMsgId',
  'applySelfStunAfterAttackFigureKey',
  'postActivationConditions',
  'pendingCombatResupply',
  'pendingTransmitPlans',
  'transmitPlansVpAwarded',
  'pendingPostAttackConditions',
  'nextActivationFreeAttack',
  // vetInstinctsActiveThisActivation REMOVED 2026-05-09 (one-time
  // token distributor, no persistent flag).
  'surgeDoublingActive',
  'optimalBombardmentBlastBonus',
  'recoverOnHostileDefeat',
  'nextHostileDefeatVpBonus',
  'dcActivationLogMessageIds',
  'defenderThreadData',
  'deviceRerollGranted',
  'nextAttackBonusAccuracy',
  'priceBounties',
  'diplomaticMissionEvade',
  'lastResortTriggered',
  // attackPerformedThisActivation MIGRATED 2026-05-13 to ACTIVATION_FIGKEY_FLAGS
  // per alexanbv: in a multifigure group without Assault, EACH figure
  // can attack once, not just one figure per group. Keying by msgId
  // (group) was sharing the gate across figures and blocking siblings.
  'vadersFocusUsedThisRound',
  // Vader's Finest Attack+Move special: per-msgId flag set when the
  // special action button is clicked. Consumed in
  // enqueueAttackerPerDcEffects to enqueue a vaders_finest_move
  // step-8 effect, which fires the 1-space Move-X picker.
  'vadersFinestPostAttackMove',
  'scavengedWalkerAttackPenalty',
  'drivenByHatredAttackPenalty',
  'roundProgrammingOverrideTrait',
  'autofireActive',
  'fireMissionActive',
  // Sniper Configuration: LOS-from-any-friendly per-figureKey flag (consumed at
  // attack-declare; round reset is the backstop).
  'sniperConfigLosAnyFriendly',
  'autofireChainTargetSpace',
  'darksaberSecondAttack',
  'saberOrbitAttacksRemaining',
  'pendingOverwatchPlacement',
  'activationKills',
  'activationDamagedFigures',
  'pendingBombDrop',
  // crossTrainingExhausted — removed: Cross Training now uses exhaustedSkirmishUpgrades
  // Moved 2026-05-05 from ROUND_NULL_FLAGS — used as msgId-keyed objects;
  // ROUND_OBJECT_FLAGS resets to {} which matches the defensive
  // `game.X = game.X || {}` guard pattern at all call sites.
  'pendingEe3Carbine',
  'pendingVanguardSwap',
  'emperorInterruptUsedThisActivation',
  // Moff Gideon "You Have Something I Want" — "Once during your
  // activation". msgId-keyed used flag mirroring emperorInterrupt above.
  'yhsiwUsedThisActivation',
  // pendingVoracious removed 2026-05-07 — Voracious migrated to SoA
  // orchestrator (slice 6); replaced by game.voraciousUsed.
  'massiveMovementLocked',
  'disarmPermanentWeakened',
  'adrenalineBonuses',
  'opportunisticMustSpendNow',
  'imperialRetrofittingMultiAttack',
  'urgencyMustSpendAll',
  'arcingShotActive',
  'pendingSpacePick',
  'roundTrooperSurgeStun',
  'pendingDcAbilityChoice',
  'moveInProgress',
  'forceSlowSkipActivation',
  'executorTriggered',
  'pendingSoaResolution',
  'voraciousUsed',
  // Yoda "Calming Presence" — once per round, keyed on Yoda's card msgId.
  'calmingPresenceUsed',
  'jynHairTriggerUsed',
  'chirrutOneWithForceUsed',
];

const ROUND_NULL_FLAGS = [
  'aphraExcavationTarget',
  'hitAndRunPendingMp',
  'nextAttacksBonusHits',
  'nextAttackBonusSurgeAbilities',
  'nextAttackBonusPierce',
  // Expose Weakness: target-keyed pierce on a chosen hostile (keyed by the DEFENDER
  // figureKey, not the activator). Clears at round end. alexanbv 2026-06-20.
  'nextAttackPierceVsDefender',
  'nextAttacksBonusConditions',
  'roundDefenderCannotBeTargetedUnlessWithinSpaces',
  'roundDebuffNextHostileActivation',
  'roundDroidExtraActionCostDamage',
  'sitTightPlayerNum',
  'roundInTheShadows',
  'strengthInNumbersPlayerNum',
  'strengthInNumbersData',
  'agitateNextActivation',
  'forceVisionNextActivation',
  'forceVisionPending',
  // I Make My Own Luck: "Han Solo must activate first THIS ROUND" — the
  // activation-order constraint and its owning player clear at round end.
  'firstActivationFigureName',
  'firstActivationPlayerNum',
  // Coordinated Attack: same-target lock pair (self-clears after the second
  // attack; round reset is the backstop if only one attack is taken).
  'coordinatedAttackPair',
  'stillFasterExcludeMsgId',
  'pendingStillFaster',
  'roundUtinniJawaBuffs',
  // roundSmugglersTricksPlayerNum removed 2026-06-20 — Smuggler's Tricks is
  // now INTENTIONALLY UNIMPLEMENTED (UNIMPLEMENTED_CARDS), so the flag is
  // never written and must not be registered (else the unused-flag cert fails).
  'squadSwarmPlayerNum',
  'squadSwarmCumulativeCost',
  'fieldTacticsActivationPlayerNum',
  'fieldTacticsActivationMsgId',
  'pendingRushPush',
  'pendingMassivePush',
  // pendingCrushChoice — nested suspend INSIDE the massive-displacement
  // pipeline (Crush CC): when 2+ SMALL enemies are eligible, the massive
  // figure's controller is prompted to pick which one takes 4 Damage before
  // the push. Cleared like pendingMassivePush on phase/round boundaries.
  'pendingCrushChoice',
  'pendingMoveXSequence',
  'pendingExecutiveOrderAction',
  'pendingEmperorInterrupt',
  'pendingExecutiveOrder',
  'pendingBombardmentSorin',
  'pendingFiringSquad',
  'pendingCoordinatedRaid',
  // pendingAwr removed 2026-05-07 — AWR migrated to SoA orchestrator (slice 8a).
  'sonOfSkywalkerActive',
  'dataTheftStolenCard',
  'conditionalFocusIfDamagedGte',
  // pendingToughLuck removed 2026-06-18 — Tough Luck is now the discrete
  // combat._pendingToughLuck gate reaction, not a round-cleared game flag.
  'pendingBELReorder',
  'pendingThereIsNoTry',
  'pendingSelfDestruct',
  'pendingSelfDestructMove',
  'pendingMoveInterrupts',
  'pendingStrainEvent',
  'pendingLastResort',
  'nextDefeatedFriendlyVpReduction',
  'doubleMatchingIconsOnReroll',
  'pendingHunterProtocol',
  'holdGroundPlayerNum',
  'windfallDiscardCost',
  'wreakVengeanceActive',
  'deadlyPrecisionActive',
  'thereIsAnotherActive',
  // toughLuckPlayerNum removed 2026-06-18 — Tough Luck no longer arms a
  // round-long player flag; it is a one-shot post-reroll reaction.
  'thereIsNoTryPlayerNum',
  'youWillNotDenyMeActive',
  'mandaAsteelPlayerNum',
  // Mandalorian Steel: The Armorer's figure key, captured at play so the
  // within-4-spaces proximity check (CSV row 743) can resolve the Armorer's
  // current position at attack-resolution time.
  'mandaAsteelArmorerFigureKey',
  'stillFasterPlayerNum',
  'signalJammerActive',
  'terminalControlPlayerNum',
  'unlimitedPowerActive',
  'shadowOpsBlockedPlayer',
  'criticalHitBlockedPlayer',
  'pendingOrbitalBombardment',
  'pendingYHSIW',
  'powerfulInfluencePlayerNum',
  'restInPeaceActive',
  'pendingIllicitArms',
  'pendingExtraProtection',
  'pendingExecutorInterrupt',
  'pendingDefeatPick',
  'pendingPartingShot',
  'pendingFinalStand',
  'pendingDyingLunge',
  'pendingMiracleWorker',
  'pendingPreservationProtocol',
  'pendingDefeatCcPrompt',
  'pendingFastLearnerPick',
  'pendingCcConfirmation',
  'pendingNegation',
  'pendingCommDisruptionPrompt',
  'pendingCoverFire',
  'pendingStrainChoice',
  // pendingVoracious historical note (2026-05-05): was used as an
  // msgId-keyed map, so registered in ROUND_OBJECT_FLAGS. Replaced by
  // voraciousUsed in slice 6 (2026-05-07) when Voracious migrated to
  // the SoA orchestrator.
  'pendingAssassinsBlade',
  'pendingPunishingStrike',
  'pendingConspire',
  'pendingItWillBeAlright',
  'pendingGeneralsOrders',
  'pendingMotivation',
  'pendingTrustedAlly',
  'pendingTokenDistribution',
  'pendingLieInAmbush',
  'pendingPowerTokenGrant',
  'pendingChannelTheForceStrain',
  'pendingIllegalCcPlay',
  'pendingCcAttachment',
  'pendingCcChoice',
  'pendingCcSpaceChoice',
  'pendingIKnowEverything',
  'pendingSurgeOverflow',
  'pendingInterrogate',
  'pendingMastery',
  'pendingMilitaryEfficiency',
  'pendingMissionSorReveal',
  'pendingSuppressiveFireMp',
  // Combat pipeline pendings — safety net (deleted on happy path, but no fallback if handler throws)
  // NOTE: pendingCombat intentionally omitted — handled by recovery.js
  'pendingCelebration',
  'pendingCleave',
  'pendingFightingKnife',
  'pendingConcussiveBolt',
  'pendingSpreadThePain',
  'pendingSpreadThePainCondPick',
  'pendingReaction',
  'pendingBoltslinger',
  'pendingIndiscriminateFire',
  'pendingHeavyFire',
  'pendingHavocShot',
  'pendingDeflect',
  'pendingWantonDestruction',
  'pendingFigurehead',
  'pendingRogueOneTokenPick',
  'pendingZilloDiscard',
  'pendingStrikeMeDown',
  'pendingLastStand',
  'pendingErgChoices',
  'pendingSlowOnTheDraw',
  'pendingForceIsWithMe',
  'pendingFlawlessExecution',
  'pendingForceExhaustion',
  'pendingForceExhaustionDiePick',
  'slowOnTheDrawInterrupt',
  // Movement/activation pendings — safety net
  'pendingFalseOrders',
  // pendingOrderedMove RETIRED 2026-05-09 — migrated to pendingMoveX
  // (single move pipeline; ordered moves now use the move-x picker
  // step-by-step + Stop button + end-of-move MASSIVE displacement).
  'pendingShoulderRush',
  'pendingDioFollow',
  // pendingEe3Carbine moved to ROUND_OBJECT_FLAGS 2026-05-05 — same
  // reasoning as pendingVoracious above.
  'pendingRightBackAtYa',
  'pendingBattlefieldLeadership',
  'pendingScavengedWeaponryTransfer',
  'pendingHeroicEffortReturn',
  'pendingHeroicEffortDraw',
];

const ROUND_ARRAY_FLAGS = [
  'crippledFigures',
  'disabledFigures',
  'etiquetteBlockPairs',
  'fluctuationSwappedThisRound',
  'abilityExhaustedMsgIds',
  // Rest in Peace (CC): list of playerNums who played Rest in Peace this round
  // and owe an end-of-round draw. Consumed + emptied in _runDcEorForPlayer;
  // reset to [] at round boundary as a safety net. (alexanbv 2026-06-18.)
  'restInPeacePending',
  // Active round-modifier registry (alexanbv 2026-06-20): array of per-figure
  // combat-bonus descriptors (Take Position, Survival Instincts, Take Cover,
  // Cavalry Charge, Armed Escort, Fuel Upgrade, Deflection, Personal Energy
  // Shield, Choose a Side SCUM, Smuggled Supplies, Just Business, Battlefield
  // Awareness). Reset to [] at the round boundary clears the 'during-round'
  // descriptors; 'until-eor' descriptors are cleared earlier at EOR-phase start
  // (clearRoundModifiersUntilEor in handlers/round.js). See round-modifiers.js.
  'activeRoundModifiers',
];

const ROUND_FALSE_FLAGS = [
  // harshEnvironmentActive removed 2026-06-18: Harsh Environment is
  // intentionally unimplemented (requires an interior/exterior space model the
  // engine lacks), so this flag is never set. The dormant consumer in
  // combat-bridge.js is harmless. See setsHarshEnvironment in abilities.js and
  // UNIMPLEMENTED_CARDS in validation.js.
  'noCommandDrawThisRound',
  'p1LaunchPanelFlippedThisRound',
  'p2LaunchPanelFlippedThisRound',
];

const ROUND_DELETE_FLAGS = [
  // (powerConverterUsedThisRound removed 2026-06-24 with the legacy
  // handlePowerConverter handler — no longer written anywhere.)
  'commsJammerActivePlayerNum',
  'partingShotTriggered',
  'onTheLamActive',
  // Recategorized 2026-05-13: global picker objects (not msgId-keyed
  // maps). Stored as { ... } so the `!game.field` first-call gate must
  // see undefined after reset — ROUND_OBJECT_FLAGS' `= {}` reset breaks
  // that gate (truthy empty object).
  'pendingStaticPulse',
  'pendingForceCardPick',
  'jundlandTerrorPlayedThisEor',
  'reinforcementsPlayedThisSor',
  'pendingBlackMarket',
  'deWannaWangaUsedThisRound',
  'arcingShotActiveScalar',
  'pendingDoorSelections',
  'pendingKryknaPushQueue',
  'kryknaPushedIds',
  'pendingClaimedKryknaQueue',
  'roundDioxisActive',
  'pendingStartOfRoundResolve',
  'pendingSorActions',
  'pendingDeployOrientation',
  'pendingFluctuationSwapQueue',
  'pendingFluctuationSwapFirst',
  'drivenByHatredForceChoke',
  // Multi-figure-selection pickers (alexanbv 2026-06-21): global picker objects
  // ({chosen/targets, candidates}) for "choose up to N figures" CCs / special
  // actions. Use a `!game.pendingX` first-call gate, so they must reset to
  // undefined (delete), not {} — same rationale as pendingStaticPulse above.
  'pendingRoar',
  'pendingOptimalBombardment',
  'pendingTriangulateSel',
  'pendingPackAlphaSel',
  'pendingSquadCommand',
  // Stale per-attack tracking — safety net
  'lastAttackAttackerMsgId',
  'lastAttackAttackerFigureIndex',
  'lastAttackTargetFigureKey',
  'lastDefeatInfo',
  'lastAttackTargetSpacesForRubble',
  'lastAttackAttackerPlayerNum',
  // Per-round gates that must reset
  'iKnowEverythingResolved',
];

/**
 * Reset all round-scoped flags at the start of a new round.
 * Called in handleEndEndOfRound after all end-of-round effects resolve.
 * @param {object} game
 */
export function cleanupRoundStart(game) {
  for (const key of ROUND_OBJECT_FLAGS) {
    game[key] = {};
  }
  for (const key of ROUND_NULL_FLAGS) {
    game[key] = null;
  }
  for (const key of ROUND_ARRAY_FLAGS) {
    game[key] = [];
  }
  for (const key of ROUND_FALSE_FLAGS) {
    game[key] = false;
  }
  for (const key of ROUND_DELETE_FLAGS) {
    delete game[key];
  }
  // Smoke Grenade tokens: "discard the smoke token at the end of the next
  // round". Each smoke token records an expiresAfterRound (the round it must be
  // discarded at the END of). This runs at start-of-round AFTER game.currentRound
  // has been incremented, so any token whose expiry round has already elapsed
  // (expiresAfterRound < currentRound) is now cleared.
  const _smokeExpiry = game.ancillaryTokens?.smokeExpiry;
  if (_smokeExpiry && typeof _smokeExpiry === 'object') {
    const _curRound = game.currentRound || 1;
    const _smokeArr = game.ancillaryTokens.smoke || [];
    const _survivors = [];
    const _newExpiry = {};
    for (const space of _smokeArr) {
      const exp = _smokeExpiry[space];
      // Keep tokens with no recorded expiry (defensive) or not yet expired.
      if (exp == null || exp >= _curRound) {
        _survivors.push(space);
        if (exp != null) _newExpiry[space] = exp;
      }
    }
    game.ancillaryTokens.smoke = _survivors;
    game.ancillaryTokens.smokeExpiry = _newExpiry;
  }
}

// Export flag lists for testing
export {
  ACTIVATION_MSGID_FLAGS,
  ACTIVATION_FIGKEY_FLAGS,
  ACTIVATION_PLAYERNUM_FLAGS,
  ACTIVATION_SCALAR_FLAGS,
  ROUND_OBJECT_FLAGS,
  ROUND_NULL_FLAGS,
  ROUND_ARRAY_FLAGS,
  ROUND_FALSE_FLAGS,
  ROUND_DELETE_FLAGS,
};
