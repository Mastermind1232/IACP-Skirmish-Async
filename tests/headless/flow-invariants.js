/**
 * Flow invariants: game-state and Discord-surface assertions.
 *
 * Two layers:
 *   1. assertFlowInvariants(game, actionDeps) — game state consistency (GS-*)
 *   2. assertSurfaceInvariants(game, surface, step) — Discord surface correctness (DS-*)
 *
 * Plus standalone:
 *   3. validatePayloadShape(payload, label) — Discord API limit checks
 *
 * Returns arrays of error strings. Empty = all invariants pass.
 */

import { getAvailableActions } from '../../src/engine/available-actions.js';

// ── Discord API Limits ──────────────────────────────────────────────────────
const DISCORD_MAX_ACTION_ROWS = 5;
const DISCORD_MAX_BUTTONS_PER_ROW = 5;
const DISCORD_MAX_SELECT_OPTIONS = 25;
const DISCORD_MAX_EMBEDS = 10;
const DISCORD_MAX_EMBED_FIELDS = 25;
const DISCORD_EMBED_TITLE_LIMIT = 256;
const DISCORD_EMBED_DESC_LIMIT = 4096;
const DISCORD_EMBED_FIELD_NAME_LIMIT = 256;
const DISCORD_EMBED_FIELD_VALUE_LIMIT = 1024;
const DISCORD_CONTENT_LIMIT = 2000;
const DISCORD_BUTTON_LABEL_LIMIT = 80;
const DISCORD_CUSTOM_ID_LIMIT = 100;

const PENDING_STATES = [
  'pendingCombat',
  'pendingNegation',
  'pendingCelebration',
  'pendingPowerTokenOverflow',
  'pendingDcAbilityChoice',
  'pendingPounceSpaceChoice',
  'pendingMissileSalvo',
  'pendingPowerTokenGrant',
  'pendingCoverFire',
  'pendingSpreadThePainCondPick',
];

// ── Map pending state keys to the action types that resolve them ─────────────
// If a pending state is active, at least one of these action types
// must be available to at least one player.
const PENDING_TO_ACTION_TYPES = {
  pendingCombat: [
    'combat_ready', 'combat_roll', 'combat_surge', 'combat_skip_surges', 'combat_reroll', 'combat_reroll_done', 'combat_resolve',
    // Combat reaction types — these are legitimate combat actions for reaction sub-states
    'strike_me_down_yes', 'strike_me_down_no',
    'slow_on_draw_yes', 'slow_on_draw_no',
    'force_exhaustion_yes', 'force_exhaustion_no',
    'illicit_arms_pick', 'illicit_arms_skip',
    'power_converter_approve', 'power_converter_skip',
    'there_is_no_try_die', 'there_is_no_try_face', 'there_is_no_try_skip',
    'tough_luck_remove', 'tough_luck_skip',
    'hunter_protocol_trigger', 'hunter_protocol_skip',
  ],
  pendingNegation: ['negation_play', 'negation_let_resolve'],
  pendingCelebration: ['celebration_play', 'celebration_pass'],
  pendingPowerTokenGrant: ['power_token_choice'],
  pendingDcAbilityChoice: ['dc_ability_choice'],
  pendingPounceSpaceChoice: ['pounce_space'],
  pendingMissileSalvo: ['missile_salvo_die', 'missile_salvo_done'],
  pendingCoverFire: ['cover_fire_block', 'cover_fire_skip'],
  pendingSpreadThePainCondPick: ['spread_pain_cond'],
  moveInProgress: ['move_pick_space', 'move_mp', 'move_letter', 'move_done'],
};

// ── Which player should have actions for each pending state ──────────────────
// Returns the playerNum that should have actions, or null if context-dependent.
function getExpectedActingPlayer(game, pendingKey) {
  switch (pendingKey) {
    case 'pendingCombat': {
      const c = game.pendingCombat;
      if (!c) return null;
      // Combat reactions redirect the acting player — return null (can't predict)
      // when any reaction sub-state is active
      const reactionStates = [
        'pendingStrikeMeDown', 'pendingSlowOnTheDraw', 'pendingForceExhaustion',
        'pendingIllicitArms', 'pendingPowerConverter', 'pendingThereIsNoTry',
        'pendingToughLuck', 'pendingHunterProtocol',
      ];
      if (reactionStates.some(k => game[k])) return null;
      // Ready phase: whichever player hasn't readied
      if (!c.p1Ready || !c.p2Ready) return !c.p1Ready ? 1 : 2;
      // Roll phase: attacker rolls attack, defender rolls defense
      if (!c.attackRoll) return c.attackerPlayerNum;
      if (!c.defenseRoll) return c.attackerPlayerNum === 1 ? 2 : 1;
      // Reroll/surge: attacker for attack rerolls/surges
      if (c.rerollPhase === 'attacker') return c.attackerPlayerNum;
      if (c.rerollPhase === 'defender') return c.attackerPlayerNum === 1 ? 2 : 1;
      if (c.pendingSurges || c.surgeRemaining > 0) return c.attackerPlayerNum;
      return null;
    }
    case 'pendingNegation': {
      const neg = game.pendingNegation;
      if (!neg) return null;
      // Opponent of the player who played the card must respond
      return neg.playedBy === 1 ? 2 : 1;
    }
    case 'pendingCelebration': {
      const cel = game.pendingCelebration;
      return cel?.attackerPlayerNum || null;
    }
    case 'pendingPowerTokenGrant': {
      return game.pendingPowerTokenGrant?.playerNum || null;
    }
    case 'pendingDcAbilityChoice': {
      const choices = game.pendingDcAbilityChoice;
      if (!choices) return null;
      const firstKey = Object.keys(choices)[0];
      return choices[firstKey]?.playerNum || null;
    }
    case 'moveInProgress': {
      const moves = game.moveInProgress;
      if (!moves) return null;
      const firstKey = Object.keys(moves)[0];
      return moves[firstKey]?.playerNum || null;
    }
    case 'endOfRoundWhoseTurn': {
      if (!game.endOfRoundWhoseTurn) return null;
      return game.endOfRoundWhoseTurn === game.player1Id ? 1 : 2;
    }
    default:
      return null;
  }
}

// ── Game State Invariants ───────────────────────────────────────────────────

export function assertFlowInvariants(game, actionDeps) {
  if (!game) return ['GS-1: Game state is null/undefined'];

  const errors = [];

  if (!game.gameId) errors.push('GS-1: game.gameId is falsy');
  if (game.ended) return errors;

  const p1Actions = getAvailableActions(game, 1, actionDeps);
  const p2Actions = getAvailableActions(game, 2, actionDeps);

  // GS-2: Someone can act
  if (p1Actions.length === 0 && p2Actions.length === 0) {
    let debugInfo = '';
    if (game.pendingDcAbilityChoice && Object.keys(game.pendingDcAbilityChoice).length > 0) {
      const entries = Object.entries(game.pendingDcAbilityChoice).map(([k, v]) =>
        `${k}:pn${v.playerNum},opts=${(v.choiceOptions||v.choices||v.targetFigureKeys||[]).length}`
      );
      debugInfo += ` dcAbilityChoice={${entries.join(',')}},`;
    }
    if (game.dcActionsData) {
      const adEntries = Object.entries(game.dcActionsData).map(([k, v]) => `${k}:rem=${v.remaining}`);
      debugInfo += ` dcActionsData={${adEntries.join(',')}},`;
    }
    debugInfo += ` activeTurn=${game.currentActivationTurnPlayerId}, p1Act=${game.p1ActivationsRemaining}, p2Act=${game.p2ActivationsRemaining}`;
    errors.push(
      `GS-2: Dead-end — no player has actions. ` +
      `phase=${game.phase}, roundPhase=${game.roundPhase}, ` +
      `pending=[${PENDING_STATES.filter(k => game[k]).join(', ')}]` +
      debugInfo
    );
  }

  // GS-3: Orphaned pending states
  for (const pendingKey of PENDING_STATES) {
    const val = game[pendingKey];
    if (!val) continue;
    if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) continue;
    if (p1Actions.length === 0 && p2Actions.length === 0) {
      errors.push(`GS-3: Orphaned pending '${pendingKey}' — set but no actions available`);
    }
  }

  // GS-4: Phase gate consistency
  if (game.phaseGate) {
    const all = [...p1Actions, ...p2Actions];
    const nonGate = all.filter(a => a.type !== 'phase_gate_ready' && a.type !== 'phase_gate_unready');
    if (nonGate.length > 0) {
      errors.push(`GS-4: Phase gate active but non-gate actions exist: ${nonGate.map(a => a.type).join(', ')}`);
    }
  }

  // GS-5: pendingCombat → combat actions exist
  // Skip if a higher-priority pending state (celebration, power token, etc.) is
  // temporarily taking precedence over combat actions in getAvailableActions.
  if (game.pendingCombat) {
    const higherPriorityActive = game.pendingCelebration || game.pendingPowerTokenGrant
      || game.pendingSpreadThePainCondPick || (game.pendingDcAbilityChoice && Object.keys(game.pendingDcAbilityChoice).length > 0);
    if (!higherPriorityActive) {
      const combatTypes = PENDING_TO_ACTION_TYPES.pendingCombat;
      const all = [...p1Actions, ...p2Actions];
      if (!all.some(a => combatTypes.includes(a.type))) {
        errors.push(
          `GS-5: pendingCombat set but no combat actions. ` +
          `attackRoll=${!!game.pendingCombat.attackRoll}, defenseRoll=${!!game.pendingCombat.defenseRoll}, ` +
          `rerollPhase=${game.pendingCombat.rerollPhase || 'none'}, surgeRemaining=${game.pendingCombat.surgeRemaining ?? '?'}`
        );
      }
    }
  }

  // GS-6: moveInProgress → movement actions exist
  // Skip if a higher-priority pending state (combat interrupt, bleeding, etc.) takes precedence
  const moveSuppressed = game.pendingCombat || game.pendingBleeding
    || game.pendingCelebration || game.pendingPowerTokenGrant
    || game.pendingSpreadThePainCondPick
    || (game.pendingDcAbilityChoice && Object.keys(game.pendingDcAbilityChoice).length > 0);
  if (game.moveInProgress && Object.keys(game.moveInProgress).length > 0 && !moveSuppressed) {
    const moveTypes = PENDING_TO_ACTION_TYPES.moveInProgress;
    const all = [...p1Actions, ...p2Actions];
    if (!all.some(a => moveTypes.includes(a.type))) {
      errors.push(`GS-6: moveInProgress set but no movement actions. keys=${Object.keys(game.moveInProgress).join(', ')}`);
    }
  }

  // GS-7: VP never negative
  if ((game.player1VP?.total ?? 0) < 0) errors.push(`GS-7: P1 VP negative: ${game.player1VP.total}`);
  if ((game.player2VP?.total ?? 0) < 0) errors.push(`GS-7: P2 VP negative: ${game.player2VP.total}`);

  // GS-8: For each active pending state, the correct player has matching action types
  // Side-effect states checked above phase gate may temporarily suppress other pending state actions
  const sideEffectPriorityActive = game.pendingCelebration || game.pendingPowerTokenGrant
    || game.pendingSpreadThePainCondPick || game.pendingBleeding
    || (game.pendingDcAbilityChoice && Object.keys(game.pendingDcAbilityChoice).length > 0);

  for (const [pendingKey, actionTypes] of Object.entries(PENDING_TO_ACTION_TYPES)) {
    const val = game[pendingKey];
    if (!val) continue;
    if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) continue;

    // Skip combat checks when a higher-priority side-effect state takes precedence
    if (pendingKey === 'pendingCombat' && sideEffectPriorityActive) continue;
    if (pendingKey === 'moveInProgress' && sideEffectPriorityActive) continue;

    const all = [...p1Actions, ...p2Actions];
    const hasMatchingAction = all.some(a => actionTypes.includes(a.type));
    if (!hasMatchingAction) {
      errors.push(
        `GS-8: Pending '${pendingKey}' active but no matching action types ` +
        `[${actionTypes.join(', ')}] available to either player`
      );
    }

    // Check the CORRECT player has the actions
    const expectedPn = getExpectedActingPlayer(game, pendingKey);
    if (expectedPn !== null) {
      const playerActions = expectedPn === 1 ? p1Actions : p2Actions;
      const playerHasAction = playerActions.some(a => actionTypes.includes(a.type));
      if (!playerHasAction) {
        errors.push(
          `GS-8b: Pending '${pendingKey}' expects P${expectedPn} to act but P${expectedPn} has no ` +
          `matching actions [${actionTypes.join(', ')}]. ` +
          `P${expectedPn} actions: [${playerActions.map(a => a.type).join(', ')}]`
        );
      }
    }
  }

  return errors;
}

// ── Discord Surface Invariants ──────────────────────────────────────────────

export function assertSurfaceInvariants(game, surface, step) {
  if (!game || !surface) return [];

  const errors = [];

  // DS-1: Hidden info must not leak to shared surfaces
  // Only check entries from the CURRENT step to avoid O(n²) re-flagging of old entries.
  const p1Hand = game.player1CcHand || [];
  const p2Hand = game.player2CcHand || [];
  const currentSharedEntries = surface.getShared().filter(e => e.step === step);

  // Only match card names in markdown bold (**CardName**) to avoid false positives.
  // Many CC names ("Focus", "Crush", "Repair", "Disarm") share names with game
  // conditions/mechanics that legitimately appear as standalone words in shared text.
  // Real card leaks always use bold formatting (e.g., "played **Focus**").
  function cardNameLeaked(cardName, text) {
    const escaped = cardName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\*\\*${escaped}\\*\\*`, 'i');
    return pattern.test(text);
  }

  // dc_special followUps legitimately contain DC ability names in bold.
  // If the bold text appears at the start of the followUp content (**AbilityName** — ...),
  // it's a DC ability being reported, not a CC card leak. Skip those entries.
  function isDcSpecialActionName(entry, cardName) {
    if (!entry.customId?.startsWith('dc_special_') && !entry.customId?.startsWith('dc_ability_choice_')) return false;
    const content = entry.content || '';
    return content.startsWith(`**${cardName}**`);
  }

  for (const cardName of p1Hand) {
    if (!cardName) continue;
    for (const entry of currentSharedEntries) {
      if (entry.source !== 'interaction') continue;
      if (isDcSpecialActionName(entry, cardName)) continue;
      const fullText = (entry.content || '') + JSON.stringify(entry.embeds || []);
      if (cardNameLeaked(cardName, fullText)) {
        errors.push(
          `DS-1: P1 hand card "${cardName}" leaked to shared surface at step ${entry.step} ` +
          `(${entry.responseType} from ${entry.customId})`
        );
      }
    }
  }
  for (const cardName of p2Hand) {
    if (!cardName) continue;
    for (const entry of currentSharedEntries) {
      if (entry.source !== 'interaction') continue;
      if (isDcSpecialActionName(entry, cardName)) continue;
      const fullText = (entry.content || '') + JSON.stringify(entry.embeds || []);
      if (cardNameLeaked(cardName, fullText)) {
        errors.push(
          `DS-1: P2 hand card "${cardName}" leaked to shared surface at step ${entry.step} ` +
          `(${entry.responseType} from ${entry.customId})`
        );
      }
    }
  }

  // DS-2: Private hand updates only go to correct player
  for (const call of surface.getUiCalls('updateHandVisualMessage')) {
    const expectedVis = call.playerNum === 1 ? 'p1' : 'p2';
    if (call.visibility !== expectedVis) {
      errors.push(`DS-2: updateHandVisualMessage P${call.playerNum} wrong visibility '${call.visibility}' at step ${call.step}`);
    }
  }
  for (const call of surface.getUiCalls('updateDiscardPileMessage')) {
    const expectedVis = call.playerNum === 1 ? 'p1' : 'p2';
    if (call.visibility !== expectedVis) {
      errors.push(`DS-2: updateDiscardPileMessage P${call.playerNum} wrong visibility '${call.visibility}' at step ${call.step}`);
    }
  }

  // DS-3: Message edits reference existing messages
  for (const edit of surface.getOrphanedEdits()) {
    errors.push(`DS-3: Edit at step ${edit.step} targeted unknown message '${edit.messageId}'`);
  }

  // DS-4: Pending state creation must produce a visible, resolvable UI path
  // Some pending states are created as side effects of another handler
  // (e.g., combat_resolve creates pendingCelebration or pendingPowerTokenGrant).
  // In those cases, the triggering handler's response IS the surface output,
  // and action types may not be available until the next act() call.
  const sideEffectStates = [
    'pendingCombat', 'pendingCelebration', 'pendingPowerTokenGrant',
    'pendingPowerTokenOverflow', 'pendingSpreadThePainCondPick', 'pendingCoverFire',
    'pendingPounceSpaceChoice', 'pendingMissileSalvo', 'pendingStrainChoice',
    'pendingBleeding', 'pendingStrikeMeDown', 'pendingSlowOnTheDraw',
    'pendingForceExhaustion', 'pendingIllicitArms', 'pendingDcAbilityChoice',
  ];

  for (const trans of surface.pendingTransitions) {
    if (trans.transition !== 'created') continue;

    // A. Someone has actions (skip side-effect states — actions appear after handler completes)
    if (!trans.p1HasActions && !trans.p2HasActions && !sideEffectStates.includes(trans.key)) {
      errors.push(
        `DS-4a: Pending '${trans.key}' created at step ${trans.step} but no player has actions`
      );
    }

    // B. The correct player has matching action types
    const actionTypes = PENDING_TO_ACTION_TYPES[trans.key];
    if (actionTypes && !sideEffectStates.includes(trans.key)) {
      const allActionTypes = [...(trans.p1ActionTypes || []), ...(trans.p2ActionTypes || [])];
      const hasMatchingAction = allActionTypes.some(t => actionTypes.includes(t));
      if (!hasMatchingAction) {
        errors.push(
          `DS-4b: Pending '${trans.key}' created at step ${trans.step} but no matching ` +
          `action types [${actionTypes.join(', ')}] available. ` +
          `Available: [${allActionTypes.join(', ')}]`
        );
      }
    }

    // C. Visible UI was produced at this step
    if (!trans.hasVisibleUi && !sideEffectStates.includes(trans.key)) {
      const stepEntries = surface.getStepEntries(trans.step);
      if (stepEntries.length === 0) {
        errors.push(
          `DS-4c: Pending '${trans.key}' created at step ${trans.step} with no surface output at all`
        );
      }
    }
  }

  // DS-5: Stale component assertions
  // After a pending state is CLEARED, verify that either:
  //   a. Components were removed/replaced on a message (componentHistory has entry), OR
  //   b. An interaction response updated/replaced the original message, OR
  //   c. A UI call refreshed components (updateDcActionsMessage, updatePlayAreaDcButtons, etc.)
  for (const trans of surface.pendingTransitions) {
    if (trans.transition !== 'cleared') continue;

    const stepEntries = surface.getStepEntries(trans.step);
    const componentChanges = surface.getComponentChanges(trans.step);

    // Check for evidence of component cleanup
    const hasComponentRemoval = componentChanges.some(c => c.action === 'remove' || c.action === 'replace');
    const hasInteractionUpdate = stepEntries.some(e =>
      e.source === 'interaction' && (e.responseType === 'update' || e.responseType === 'editReply')
    );
    // A followUp at the clearing step is evidence the handler processed the state change —
    // in production, this often replaces or supersedes the old UI (e.g., combat result replaces combat buttons)
    const hasInteractionFollowUp = stepEntries.some(e =>
      e.source === 'interaction' && e.responseType === 'followUp'
    );
    const hasUiRefresh = stepEntries.some(e =>
      e.source === 'uiCall' &&
      ['updateDcActionsMessage', 'updatePlayAreaDcButtons', 'refreshAllGameComponents',
       'clearMoveGridMessages', 'maybeShowEndActivationPhaseButton',
       'sendRoundActivationPhaseMessage'].includes(e.fn)
    );

    const hasCleanupEvidence = hasComponentRemoval || hasInteractionUpdate || hasInteractionFollowUp || hasUiRefresh;

    // Some states are cleared silently (the game just advances). That's acceptable
    // for states like endOfRoundWhoseTurn that don't have persistent buttons.
    // But for states with explicit UI (combat, negation, celebration, movement),
    // we expect cleanup.
    // Note: pendingCombat excluded — combat reactions (strike_me_down, slow_on_draw)
    // cancel combat without followUp, and combat_resolve cleanup varies by handler.
    const requiresExplicitCleanup = [
      'pendingNegation',
      'moveInProgress', 'pendingDcAbilityChoice',
    ];

    if (requiresExplicitCleanup.includes(trans.key) && !hasCleanupEvidence) {
      errors.push(
        `DS-5: Pending '${trans.key}' cleared at step ${trans.step} but no component ` +
        `cleanup detected (no edit removing components, no interaction update, no UI refresh call)`
      );
    }
  }

  // DS-6: Opponent's action controls not visible to wrong player
  const currentStepEntries = surface.getStepEntries(step);
  for (const entry of currentStepEntries) {
    if (entry.source !== 'interaction') continue;
    if (entry.responseType === 'deferUpdate') continue;
    if (entry.visibility !== 'shared' && entry.components?.length > 0) {
      const visPn = entry.visibility === 'p1' ? 1 : 2;
      if (entry.playerNum !== visPn) {
        errors.push(
          `DS-6: Private response with components at step ${step} for wrong player. ` +
          `Acting: P${entry.playerNum}, visibility: ${entry.visibility}`
        );
      }
    }
  }

  // DS-7: Component row count ≤ 5 per message
  // DS-8: Buttons per row ≤ 5, select options ≤ 25, label/customId length limits
  for (const entry of surface.entries) {
    if (entry.source !== 'interaction') continue;
    const components = entry.components;
    if (!components || components.length === 0) continue;

    if (components.length > DISCORD_MAX_ACTION_ROWS) {
      errors.push(
        `DS-7: ${components.length} action rows at step ${entry.step} ` +
        `(max ${DISCORD_MAX_ACTION_ROWS}). customId=${entry.customId}`
      );
    }

    for (let rowIdx = 0; rowIdx < components.length; rowIdx++) {
      const row = components[rowIdx];
      const children = row?.components || row?.data?.components || [];

      for (const child of children) {
        const d = child?.data || child || {};

        if (d.type === 2) { // Button
          if (d.label && d.label.length > DISCORD_BUTTON_LABEL_LIMIT) {
            errors.push(
              `DS-8: Button label ${d.label.length} chars at step ${entry.step} row ${rowIdx} ` +
              `(max ${DISCORD_BUTTON_LABEL_LIMIT}). Label: "${d.label.slice(0, 40)}…"`
            );
          }
          if (d.custom_id && d.custom_id.length > DISCORD_CUSTOM_ID_LIMIT) {
            errors.push(
              `DS-8: Button customId ${d.custom_id.length} chars at step ${entry.step} ` +
              `(max ${DISCORD_CUSTOM_ID_LIMIT})`
            );
          }
        }

        if (d.type === 3) { // StringSelectMenu
          // Discord.js builders store options at child.options (array of OptionBuilder),
          // while plain objects store them at child.data.options or child.options.
          const rawOpts = child?.options || d.options || [];
          const options = Array.isArray(rawOpts) ? rawOpts : [];
          if (options.length > DISCORD_MAX_SELECT_OPTIONS) {
            errors.push(
              `DS-8: Select menu has ${options.length} options at step ${entry.step} row ${rowIdx} ` +
              `(max ${DISCORD_MAX_SELECT_OPTIONS}). customId=${d.custom_id || '?'}`
            );
          }
          if (options.length === 0) {
            errors.push(
              `DS-8: Select menu has 0 options at step ${entry.step} row ${rowIdx}. ` +
              `customId=${d.custom_id || '?'}`
            );
          }
          if (d.custom_id && d.custom_id.length > DISCORD_CUSTOM_ID_LIMIT) {
            errors.push(
              `DS-8: Select customId ${d.custom_id.length} chars at step ${entry.step} ` +
              `(max ${DISCORD_CUSTOM_ID_LIMIT})`
            );
          }
        }
      }

      // Buttons-per-row limit
      const buttonCount = children.filter(c => (c?.data?.type || c?.type) === 2).length;
      if (buttonCount > DISCORD_MAX_BUTTONS_PER_ROW) {
        errors.push(
          `DS-8: ${buttonCount} buttons in row ${rowIdx} at step ${entry.step} ` +
          `(max ${DISCORD_MAX_BUTTONS_PER_ROW})`
        );
      }
    }
  }

  // DS-9: Embed structure limits + content length
  for (const entry of surface.entries) {
    if (entry.source !== 'interaction') continue;

    if (entry.content && entry.content.length > DISCORD_CONTENT_LIMIT) {
      errors.push(
        `DS-9: Content ${entry.content.length} chars at step ${entry.step} ` +
        `(max ${DISCORD_CONTENT_LIMIT}). customId=${entry.customId}`
      );
    }

    const embeds = entry.embeds;
    if (!embeds || embeds.length === 0) continue;

    if (embeds.length > DISCORD_MAX_EMBEDS) {
      errors.push(
        `DS-9: ${embeds.length} embeds at step ${entry.step} (max ${DISCORD_MAX_EMBEDS})`
      );
    }

    for (let ei = 0; ei < embeds.length; ei++) {
      const d = embeds[ei]?.data || embeds[ei] || {};

      if (d.title && d.title.length > DISCORD_EMBED_TITLE_LIMIT) {
        errors.push(
          `DS-9: Embed title ${d.title.length} chars at step ${entry.step} embed ${ei} ` +
          `(max ${DISCORD_EMBED_TITLE_LIMIT})`
        );
      }
      if (d.description && d.description.length > DISCORD_EMBED_DESC_LIMIT) {
        errors.push(
          `DS-9: Embed description ${d.description.length} chars at step ${entry.step} embed ${ei} ` +
          `(max ${DISCORD_EMBED_DESC_LIMIT})`
        );
      }

      const fields = d.fields || [];
      if (fields.length > DISCORD_MAX_EMBED_FIELDS) {
        errors.push(
          `DS-9: Embed has ${fields.length} fields at step ${entry.step} embed ${ei} ` +
          `(max ${DISCORD_MAX_EMBED_FIELDS})`
        );
      }
      for (let fi = 0; fi < fields.length; fi++) {
        const f = fields[fi];
        if (f.name && f.name.length > DISCORD_EMBED_FIELD_NAME_LIMIT) {
          errors.push(
            `DS-9: Embed field name ${f.name.length} chars at step ${entry.step} field ${fi} ` +
            `(max ${DISCORD_EMBED_FIELD_NAME_LIMIT})`
          );
        }
        if (f.value && f.value.length > DISCORD_EMBED_FIELD_VALUE_LIMIT) {
          errors.push(
            `DS-9: Embed field value ${f.value.length} chars at step ${entry.step} field ${fi} ` +
            `(max ${DISCORD_EMBED_FIELD_VALUE_LIMIT}). Name: "${f.name || '?'}"`
          );
        }
      }
    }
  }

  // DS-10: Channel routing structural checks
  // Verify interaction responses don't target structurally invalid channels.
  // In headless mode, null channelId is expected (no real Discord channels),
  // so we only flag the specific anti-pattern of empty-string channelId.
  for (const edit of surface.editLog) {
    if (edit.channelId === '') {
      errors.push(
        `DS-10: Edit at step ${edit.step} targeted empty-string channel for message '${edit.messageId}'`
      );
    }
  }

  return errors;
}

// ── Payload Shape Validation (standalone, for direct test use) ───────────────

/**
 * Validate a single Discord payload against API limits.
 * Returns array of error strings. Empty = valid.
 */
export function validatePayloadShape(payload, label = 'payload') {
  const errors = [];
  const { content, embeds, components } = payload;

  if (content && typeof content === 'string' && content.length > DISCORD_CONTENT_LIMIT) {
    errors.push(`${label}: content ${content.length} chars (max ${DISCORD_CONTENT_LIMIT})`);
  }

  if (components && Array.isArray(components)) {
    if (components.length > DISCORD_MAX_ACTION_ROWS) {
      errors.push(`${label}: ${components.length} action rows (max ${DISCORD_MAX_ACTION_ROWS})`);
    }
    for (let i = 0; i < components.length; i++) {
      const row = components[i];
      const children = row?.components || row?.data?.components || [];
      const buttons = children.filter(c => (c?.data?.type || c?.type) === 2);
      if (buttons.length > DISCORD_MAX_BUTTONS_PER_ROW) {
        errors.push(`${label}: row ${i} has ${buttons.length} buttons (max ${DISCORD_MAX_BUTTONS_PER_ROW})`);
      }
      for (const child of children) {
        const d = child?.data || child || {};
        if (d.type === 3 && d.options) {
          if (d.options.length > DISCORD_MAX_SELECT_OPTIONS) {
            errors.push(`${label}: select has ${d.options.length} options (max ${DISCORD_MAX_SELECT_OPTIONS})`);
          }
          if (d.options.length === 0) {
            errors.push(`${label}: select has 0 options`);
          }
        }
        if (d.type === 2 && d.label && d.label.length > DISCORD_BUTTON_LABEL_LIMIT) {
          errors.push(`${label}: button label ${d.label.length} chars (max ${DISCORD_BUTTON_LABEL_LIMIT})`);
        }
        if (d.custom_id && d.custom_id.length > DISCORD_CUSTOM_ID_LIMIT) {
          errors.push(`${label}: customId ${d.custom_id.length} chars (max ${DISCORD_CUSTOM_ID_LIMIT})`);
        }
      }
    }
  }

  if (embeds && Array.isArray(embeds)) {
    if (embeds.length > DISCORD_MAX_EMBEDS) {
      errors.push(`${label}: ${embeds.length} embeds (max ${DISCORD_MAX_EMBEDS})`);
    }
    for (let i = 0; i < embeds.length; i++) {
      const d = embeds[i]?.data || embeds[i] || {};
      if (d.title && d.title.length > DISCORD_EMBED_TITLE_LIMIT) {
        errors.push(`${label}: embed ${i} title ${d.title.length} chars (max ${DISCORD_EMBED_TITLE_LIMIT})`);
      }
      if (d.description && d.description.length > DISCORD_EMBED_DESC_LIMIT) {
        errors.push(`${label}: embed ${i} description ${d.description.length} chars (max ${DISCORD_EMBED_DESC_LIMIT})`);
      }
      const fields = d.fields || [];
      if (fields.length > DISCORD_MAX_EMBED_FIELDS) {
        errors.push(`${label}: embed ${i} has ${fields.length} fields (max ${DISCORD_MAX_EMBED_FIELDS})`);
      }
      for (const f of fields) {
        if (f.name && f.name.length > DISCORD_EMBED_FIELD_NAME_LIMIT) {
          errors.push(`${label}: embed field name ${f.name.length} chars (max ${DISCORD_EMBED_FIELD_NAME_LIMIT})`);
        }
        if (f.value && f.value.length > DISCORD_EMBED_FIELD_VALUE_LIMIT) {
          errors.push(`${label}: embed field value ${f.value.length} chars (max ${DISCORD_EMBED_FIELD_VALUE_LIMIT})`);
        }
      }
    }
  }

  return errors;
}
