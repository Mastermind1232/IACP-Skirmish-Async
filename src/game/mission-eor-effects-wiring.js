/**
 * Mission phase-effects registration (alexanbv 2026-05-10).
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ⚠️ WHERE TO ADD NEW MISSION RULES — READ THIS FIRST
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Mission rules come in 5 flavours. Pick the right home for yours:
 *
 *   (A) SYNCHRONOUS mission EoR effect (mutate state / log / score VP —
 *       NO player picker).
 *       → data/mission-cards.json under
 *         `<mapId>.<a|b>.rules.endOfRound.<yourFlag>`
 *       → Add an `if (rules.yourFlag) { ... }` branch to
 *         `runEndOfRoundRules` in src/game/mission-rules.js.
 *       → Runs FIRST inside the EoR phase, before any async EoR
 *         effects + before either player's DC EoR.
 *       → Examples: vpForControllingNamedArea, vpPerLaunchPanelControlled,
 *         setTemporaryVpBuffForControllingCell, damageAdjacentToNpc.
 *
 *   (B) ASYNC mission EoR effect (posts a player picker; halts round-end).
 *       → data/mission-cards.json under
 *         `<mapId>.<a|b>.rules.endOfRound.<yourFlag>`
 *       → Register a handler in THIS FILE via registerMissionEorEffect.
 *         Returns `{ pending: false }` if no work, `{ pending: true }`
 *         after posting the picker.
 *       → Add the flag to EFFECT_ORDER in mission-eor-effects.js for
 *         deterministic ordering vs other async EoR effects.
 *       → Drain handler (button/modal that finishes the picker) must
 *         call BOTH:
 *           runRemainingMissionEorEffects(game, ctx)  // next async effect
 *           _runDcEorAndContinue(game, gameId, null, ctx, logVars)  // DC EoR + tail
 *         Use getMissionEorLogVars(game, { clear: true }) to retrieve
 *         captured logVars.
 *       → Examples: npcThugs, npcKryknaActivation, openDoorPerTerminal,
 *         fluctuationSwapGate.
 *
 *   (C) SYNCHRONOUS mission SOR effect (mutate state, log, place tokens —
 *       NO player picker).
 *       → data/mission-cards.json under
 *         `<mapId>.<a|b>.rules.startOfRound.<yourFlag>`
 *       → Add an `if (rules.yourFlag) { ... }` branch to
 *         `runStartOfRoundRules` in src/game/mission-rules.js.
 *       → Runs FIRST inside the SOR phase, before either player's DC SOR.
 *       → Examples: setTokenCountFromInitiativeHand.
 *
 *   (D) ASYNC mission SOR effect (posts a player picker; halts round-start).
 *       → data/mission-cards.json under
 *         `<mapId>.<a|b>.rules.startOfRound.<yourFlag>`
 *       → Register in THIS FILE via registerMissionSorEffect.
 *         Same `{ pending: bool }` contract as EoR effects.
 *       → Add flag to SOR_EFFECT_ORDER in mission-eor-effects.js.
 *       → Drain handler resumes via runRemainingMissionSorEffects + then
 *         continues the SOR chain (e.g. _continueAfterMissionSor).
 *       → Examples: randomRevealAndPlaceStrain.
 *
 *   (E) PERSISTENT mission rules (apply at deploy time or as ongoing
 *       constraints — move-cost, control rules, attack legality, etc.):
 *       → data/mission-cards.json under
 *         `<mapId>.<a|b>.rules.persistent.<yourFlag>` (or `immediate`).
 *       → Consumed by call sites that probe hasMissionFlag at the
 *         appropriate moment. No central dispatch.
 *
 * COMMON FLAG NAMES IN USE:
 *   EoR (B): npcThugs, npcKryknaActivation, openDoorPerTerminal,
 *            fluctuationSwapGate
 *   EoR (A): vpForControllingNamedArea, vpPerContrabandInDeploymentZone,
 *            vpPerLaunchPanelControlled, damageAdjacentToNpc,
 *            setTemporaryVpBuffForControllingCell
 *   SOR (D): randomRevealAndPlaceStrain
 *   SOR (C): setTokenCountFromInitiativeHand
 *   Persistent: pushControlledCratesUpTo, defenseModifierByZone, ...
 *
 * Side-effects: importing this file once at bot startup registers every
 * handler below. Round handler imports it lazily via
 * `await import('../game/mission-eor-effects-wiring.js')` at the
 * dispatch sites; the import is cached so registration runs once.
 */
import { ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import { registerMissionEorEffect, registerMissionSorEffect } from './mission-eor-effects.js';
import { setPendingMissionSorReveal } from './interrupts.js';
import { hasMissionFlag, getMapTokensData } from '../data-loader.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';
import { getInitiativePlayerNum, opponentPlayerNum } from './player-helpers.js';
import { initThugMovementQueue } from './thug-movement.js';
import { postThugPickerPrompt } from '../handlers/thug-movement.js';
import { postKryknaPushButtons } from '../engine/misc-helpers.js';
import { countTerminalsControlledByPlayer } from './board-helpers.js';

/**
 * Corellian Underground A: thug end-of-round push picker.
 * Initiative player moves all thugs 1 at a time.
 */
registerMissionEorEffect('npcThugs', async (game, ctx, opts) => {
  const mapId = game.selectedMap?.id;
  const variant = game.selectedMission?.variant;
  if (!hasMissionFlag(mapId, variant, 'npcThugs')) return { pending: false };

  // Lazy-init npcThugs from missionA token positions if needed.
  if (!game.npcThugs) {
    const missionData = getMapTokensData?.()[mapId]?.missionA;
    const positions = Object.values(missionData?.positions || {}).flat().filter(Boolean);
    if (positions.length > 0) {
      game.npcThugs = positions.map((coord, i) => ({
        id: `thug-${i + 1}`,
        coord: String(coord).toLowerCase(),
        hp: 4, maxHp: 4, defeated: false,
        hostility: 'hostile',
      }));
    }
  }
  const activeIndexes = (game.npcThugs || [])
    .map((t, i) => (t && !t.defeated ? i : -1))
    .filter((i) => i >= 0);
  if (activeIndexes.length === 0) return { pending: false };

  const initPN = getInitiativePlayerNum(game);
  initThugMovementQueue(game, initPN, mapId);
  await postThugPickerPrompt(game, ctx.client, opts?.interaction?.channel);
  return { pending: true };
});

/**
 * Chopper Base Atollon A: Krykna end-of-round push picker.
 * Players alternate (init first) until every Krykna has been pushed.
 */
registerMissionEorEffect('npcKryknaActivation', async (game, ctx, opts) => {
  const mapId = game.selectedMap?.id;
  const variant = game.selectedMission?.variant;
  if (!hasMissionFlag(mapId, variant, 'npcKryknaActivation')) return { pending: false };
  if (!postKryknaPushButtons) return { pending: false };

  // Lazy-init npcKrykna from missionA token positions if needed.
  if (!game.npcKrykna) {
    const missionData = getMapTokensData()['chopper-base-atollon']?.missionA;
    const positions = Object.values(missionData?.positions || {}).flat().filter(Boolean);
    if (positions.length > 0) {
      game.npcKrykna = positions.map((coord, i) => ({
        id: `krykna-${i + 1}`,
        coord: String(coord).toLowerCase().trim(),
        hp: 8, maxHp: 8, defeated: false,
        hostility: 'treatedAsHostile',
      }));
    }
  }
  const activeKrykna = (game.npcKrykna || []).filter((k) => !k.defeated);
  if (activeKrykna.length === 0) return { pending: false };

  const initNum = getInitiativePlayerNum(game);
  const otherNum = opponentPlayerNum(initNum);
  const queue = [];
  for (let i = 0; i < activeKrykna.length; i++) {
    queue.push(i % 2 === 0 ? initNum : otherNum);
  }
  game.pendingKryknaPushQueue = queue;
  game.kryknaPushedIds = [];
  // Stash logVars under the krykna-specific key as well so the existing
  // krykna_push_modal drain handler (index.js) keeps working unchanged.
  game._kryknaResumeLogVars = opts?.logVars || null;

  const channel = await fetchGameChannel(ctx.client, game.generalId);
  if (channel) await postKryknaPushButtons(game, channel, game.gameId);
  return { pending: true };
});

/**
 * Devaron Garrison B: terminal → door selection + crate push prompts.
 * Each controlled terminal grants a door selection; player picks which
 * door to open (or move) and which crate(s) to push.
 */
registerMissionEorEffect('openDoorPerTerminal', async (game, ctx, opts) => {
  const mapId = game.selectedMap?.id;
  const variant = game.selectedMission?.variant;
  if (!hasMissionFlag(mapId, variant, 'openDoorPerTerminal')) return { pending: false };
  const { postDevaronDoorButtons, postDevaronCratePushPrompts } = ctx;
  if (!postDevaronDoorButtons && !postDevaronCratePushPrompts) return { pending: false };

  // Lazy-init the crate objects in the unified objectHealth pipeline.
  if (!game._devaronCratesInited) {
    const dMap = getMapTokensData()['devaron-garrison'];
    const allCrates = Object.values(dMap?.missionB?.positions || {}).flat()
      .filter(Boolean).map((c) => String(c).toLowerCase());
    game.objectHealth = game.objectHealth || {};
    game.objectPositions = game.objectPositions || {};
    game.objectMeta = game.objectMeta || {};
    for (const c of allCrates) {
      const id = `crate-${c}`;
      if (game.objectHealth[id]) continue;
      game.objectHealth[id] = [5, 5];
      game.objectPositions[id] = c;
      game.objectMeta[id] = {
        name: `Crate @ ${c.toUpperCase()}`,
        targetable: true,
        defenseBlock: 1,
        defenseEvade: 0,
        splashOnDefeat: { amount: 2, radius: 1, target: 'all' },
        vpOnDefeat: null,
        moves: true,
      };
    }
    game._devaronCratesInited = true;
  }

  const p1T = countTerminalsControlledByPlayer(game, 1, mapId);
  const p2T = countTerminalsControlledByPlayer(game, 2, mapId);
  game._devaronResumeLogVars = opts?.logVars || null;
  // Doors first (blocking, init-then-non-init). Crates are posted only AFTER
  // the last door drains (handleDevaronDoorOpen → postDevaronCratePushPrompts)
  // so they aren't double-posted; the round then waits for each player's
  // "Done pushing crates" before resuming (alexanbv 2026-06-13: this path used
  // to dead-end after doors and soft-lock the round).
  if ((p1T > 0 || p2T > 0) && postDevaronDoorButtons) {
    game.pendingDoorSelections = [];
    if (p1T > 0) game.pendingDoorSelections.push({ playerNum: 1, doorsRemaining: p1T });
    if (p2T > 0) game.pendingDoorSelections.push({ playerNum: 2, doorsRemaining: p2T });
    const dDoors = getMapTokensData()['devaron-garrison']?.doors || [];
    const channel = await fetchGameChannel(ctx.client, game.generalId);
    if (channel) await postDevaronDoorButtons(game, dDoors, channel, game.gameId);
    return { pending: true };
  }
  // No doors → straight to the crate-push step.
  if (postDevaronCratePushPrompts) {
    const channel = await fetchGameChannel(ctx.client, game.generalId);
    if (channel) await postDevaronCratePushPrompts(game, channel, game.gameId);
  }
  return { pending: (game.pendingCratePush?.length || 0) > 0 };
});

/**
 * Lothal Wastes B: fluctuation swap gate. Initiative player swaps first,
 * then non-init player. Each may swap one pair of fluctuation tokens.
 */
registerMissionEorEffect('fluctuationSwapGate', async (game, ctx, opts) => {
  const mapId = game.selectedMap?.id;
  const variant = game.selectedMission?.variant;
  if (!hasMissionFlag(mapId, variant, 'fluctuationSwapGate')) return { pending: false };
  const { postFluctuationSwapButtons } = ctx;
  if (!postFluctuationSwapButtons) return { pending: false };

  const initNum = getInitiativePlayerNum(game);
  const otherNum = opponentPlayerNum(initNum);
  game.pendingFluctuationSwapQueue = [initNum, otherNum];
  game.fluctuationSwappedThisRound = [];
  game.pendingFluctuationSwapFirst = null;
  game._fluctuationResumeLogVars = opts?.logVars || null;

  const channel = await fetchGameChannel(ctx.client, game.generalId);
  if (channel) await postFluctuationSwapButtons(game, channel, game.gameId, initNum);
  return { pending: true };
});

// ── Mission START-of-round async effects ──────────────────────────────────────
//
// Same architecture as EoR: posted before either player's DC SOR.
// Use registerMissionSorEffect / runMissionSorEffects.

/**
 * Chopper Base Atollon B (Powered Perimeter): each player randomly reveals
 * 1 face-down mission token; strain tokens are placed on signal markers
 * matching the revealed colors. Implemented as a single "Reveal" button
 * either player can press; the click handler (handleSorMissionReveal in
 * round.js) advances the SOR chain.
 */
registerMissionSorEffect('randomRevealAndPlaceStrain', async (game, ctx, opts) => {
  const mapId = game.selectedMap?.id;
  const variant = game.selectedMission?.variant;
  if (!mapId || !variant) return { pending: false };
  // Belt-and-suspenders flag check against the canonical mission-cards data.
  const rules = ctx.getMissionRules?.(mapId, variant)?.startOfRound || {};
  if (!rules.randomRevealAndPlaceStrain) return { pending: false };

  const gameId = game.gameId;
  const missionName = game.selectedMission?.name || 'Mission Effect';
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`sor_mission_reveal_${gameId}`)
      .setLabel('Reveal Mission Tokens')
      .setStyle(ButtonStyle.Primary)
  );
  const channel = await fetchGameChannel(ctx.client, game.generalId);
  if (channel) {
    await channel.send({
      content: `⚡ **Round ${game.currentRound} — ${missionName}** — Each player randomly reveals 1 set-aside mission token. Either player: press to reveal.`,
      components: [row],
    }).catch(() => {});
  }
  setPendingMissionSorReveal(game);
  game._sorMissionRevealResumeLogVars = opts?.logVars || null;
  return { pending: true };
});
