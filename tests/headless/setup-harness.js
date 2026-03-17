/**
 * Setup Harness: drives through the real setup handler chain headlessly.
 *
 * Unlike the flow harness (which starts in ROUND_ACTIVE with synthetic figure
 * positions), this harness starts at ZONE_SELECTION and exercises:
 *   1. Deployment zone selection (real handler)
 *   2. Auto-deploy for both players (real handler)
 *   3. Deployment done + phase gate (real handlers)
 *   4. CC shuffle draw for both players (real handler)
 *   5. Phase gate dispatch → ROUND_ACTIVE
 *
 * This gives us end-to-end coverage of the real deployment pipeline that
 * initializeFigurePositions() bypasses.
 *
 * Usage:
 *   const result = await runSetupSim({ mapId, p1Army, p2Army, p1CcDeck, p2CcDeck });
 *   // result.game is in ROUND_ACTIVE with figures deployed via real handlers
 *   // result.errors contains any handler errors encountered
 *   // result.phases tracks which phases were visited
 */

import { createHarness } from '../../src/headless/game-harness.js';
import { buildHeadlessDeps } from '../../src/headless/headless-deps.js';
import { initializeDcState } from '../../src/headless/init-dc-state.js';
import { createFakeChannel } from '../../src/headless/fake-interaction.js';
import { getDcStats, getDeploymentZones, getDcEffects } from '../../src/data-loader.js';
import { PHASES } from '../../src/game/phase.js';
import { isFigurelessDc } from '../../src/game/dc-helpers.js';

let setupIdCounter = 1;

/**
 * Build a game state at ZONE_SELECTION phase, ready for deployment.
 * This mirrors game-builder.js but stops earlier in the pipeline.
 */
function buildSetupGame(config) {
  const {
    mapId = 'mos-eisley-outskirts',
    p1Army = [],
    p2Army = [],
    p1CcDeck = [],
    p2CcDeck = [],
    p1Id = 'player1',
    p2Id = 'player2',
    gameId = String(setupIdCounter++).padStart(5, '0'),
  } = config;

  // Build DC lists (same logic as game-builder)
  // Supports: { dcName, count?, attachments?: string[] }
  function buildDcList(army) {
    const dcList = [];
    const attachmentMap = {}; // dcListIndex → attachment names
    for (const entry of army) {
      const dcName = entry.dcName || entry;
      const count = entry.count || 1;
      const entryAttachments = entry.attachments || [];
      for (let dg = 0; dg < count; dg++) {
        const stats = getDcStats(dcName);
        const displayName = count > 1 ? `${dcName} [Group ${dg + 1}]` : dcName;
        const figureCount = stats?.figures ?? 1;
        const maxHp = stats?.health ?? 1;
        const healthState = [];
        for (let f = 0; f < figureCount; f++) {
          healthState.push([maxHp, maxHp]);
        }
        const idx = dcList.length;
        dcList.push({ dcName, displayName, healthState, cost: stats?.cost ?? 0 });
        if (entryAttachments.length > 0) {
          attachmentMap[idx] = [...entryAttachments];
        }
      }
    }
    return { dcList, attachmentMap };
  }

  const p1Build = buildDcList(p1Army);
  const p2Build = buildDcList(p2Army);
  const p1DcList = p1Build.dcList;
  const p2DcList = p2Build.dcList;

  // Build attachment maps keyed by msgId (hl{pn}dc{i})
  const p1DcAttachments = {};
  for (const [idx, atts] of Object.entries(p1Build.attachmentMap)) {
    p1DcAttachments[`hl1dc${idx}`] = atts;
  }
  const p2DcAttachments = {};
  for (const [idx, atts] of Object.entries(p2Build.attachmentMap)) {
    p2DcAttachments[`hl2dc${idx}`] = atts;
  }

  // Separate attachments from deployable figures for squad ccList
  const p1SquadDcList = p1DcList.map(d => ({ dcName: d.dcName, displayName: d.displayName }));
  const p2SquadDcList = p2DcList.map(d => ({ dcName: d.dcName, displayName: d.displayName }));

  const game = {
    gameId,
    player1Id: p1Id,
    player2Id: p2Id,
    selectedMap: { id: mapId },
    selectedMission: null,
    round: 0,
    currentRound: 0,
    ended: false,
    isTestGame: true,

    // Squads
    player1Squad: { dcList: p1SquadDcList, ccList: p1CcDeck },
    player2Squad: { dcList: p2SquadDcList, ccList: p2CcDeck },
    p1DcList,
    p2DcList,

    // VP
    player1VP: { total: 0, kills: 0, objectives: 0 },
    player2VP: { total: 0, kills: 0, objectives: 0 },

    // Figure positions — empty, will be populated by real deploy handlers
    figurePositions: { 1: {}, 2: {} },

    // CC state — deck provided, hand empty (drawn during CC_DRAW phase)
    player1CcHand: [],
    player2CcHand: [],
    player1CcDeck: [...p1CcDeck],
    player2CcDeck: [...p2CcDeck],
    player1CcDiscard: [],
    player2CcDiscard: [],
    player1CcDrawn: false,
    player2CcDrawn: false,

    // Initiative — P1 has initiative
    initiativePlayerId: p1Id,
    initiativeDetermined: true,

    // Phase — at zone selection, ready for deployment
    phase: PHASES.ZONE_SELECTION,
    roundPhase: null,

    // Damage tracking
    totalDamageReceived: { 1: 0, 2: 0 },

    // Attachments (e.g., Scavenged Walker)
    p1DcAttachments,
    p2DcAttachments,

    // Undo
    undoStack: [],

    // Channel IDs — fake channels for headless testing
    generalId: `general-${gameId}`,
    p1HandId: `p1-hand-${gameId}`,
    p2HandId: `p2-hand-${gameId}`,
    boardId: `board-${gameId}`,
  };

  return game;
}

/**
 * Drive through a post-deploy ability queue, resolving each ability.
 * Handles: pd_pick (ability picker), pd_security_pick (Security Detail leader choice),
 * pd_arms_dist_fig + pd_arms_dist_token (Arms Distribution), extra_armor_pick (Extra Armor),
 * pd_move_skip (skip movement for Forward Emplacement / Smooth Landing / Infiltration / Strike Team),
 * pd_walker_skip (Scavenged Walker skip), pd_strike_token_done (Strike Team token done).
 *
 * Movement-based abilities are skipped (pd_move_skip) rather than fully driven,
 * which still exercises the handler chain and queue advancement.
 */
async function drivePostDeployQueue(game, gameId, p1Id, p2Id, submit, harness, getHandChannel, errors, steps, verbose) {
  let abilitiesResolved = 0;
  let safety = 0;
  const MAX_ITERATIONS = 100;

  while (safety++ < MAX_ITERATIONS) {
    const g = harness.getGame();
    const q = g.postDeployQueue;
    if (!q) break; // Queue finished

    const pn = q.currentPlayerNum;
    const userId = pn === 1 ? p1Id : p2Id;

    // ── Active ability in progress (sub-flow) ──
    if (q.activeAbility) {
      const active = q.activeAbility;

      // Movement in progress — find and skip it
      if (active.moveFigures && g.moveInProgress) {
        const moveKeys = Object.keys(g.moveInProgress).filter(k => g.moveInProgress[k]?.postDeployReturn);
        if (moveKeys.length > 0) {
          const moveKey = moveKeys[0];
          await submit(`pd_move_skip_${gameId}_${pn}_${moveKey}`, userId);
          continue;
        }
        // No active move but moveFigures set — might be waiting for picker (smooth landing)
        // or movement hasn't started yet. Check for pd_sl_pick or pd_walker_move
      }

      // Smooth Landing picker — pick the first remaining figure
      if (active.abilityId === 'smooth_landing' && !active._pickedFigureKey) {
        const remaining = (active.moveFigures || []).filter(f => !(active._resolvedFigures || []).includes(f.figureKey));
        if (remaining.length > 0) {
          await submit(`pd_sl_pick_${gameId}_${pn}_${remaining[0].figureKey}`, userId);
          continue;
        }
      }

      // Scavenged Walker — skip
      if (active.abilityId === 'scavenged_walker_move') {
        // Find the msgId from the active ability
        const msgId = active.msgId || '';
        await submit(`pd_walker_skip_${gameId}_${pn}_${msgId}`, userId);
        continue;
      }

      // Strike Team adj pick — pick the first adjacent friendly
      if (active.abilityId === 'strike_team' && active.step === 'adj_pick') {
        // The buttons were posted — we need to find an adjacent friendly
        // Look for any figure key that isn't Cassian
        const friendlies = Object.keys(g.figurePositions?.[pn] || {}).filter(fk => fk !== active.figureKey);
        if (friendlies.length > 0) {
          await submit(`pd_strike_adj_${gameId}_${pn}_${friendlies[0]}`, userId);
          continue;
        }
      }

      // Strike Team token distribution — press Done immediately
      if (active.abilityId === 'strike_team' && active.step === 'tokens') {
        await submit(`pd_strike_token_done_${gameId}_${pn}`, userId);
        abilitiesResolved++;
        continue;
      }

      // Extra Armor — cycle figures to allocate all tokens, then confirm
      if (active.abilityId === 'extra_armor') {
        const pendingEa = g[`pendingExtraArmor_p${pn}`];
        if (pendingEa) {
          const allFks = Object.keys(g.figurePositions?.[pn] || {});
          if (allFks.length > 0) {
            const total = pendingEa.total || 4;
            let placed = 0;
            let fkIdx = 0;
            // Spread tokens across figures (each click adds 1, max 2 per figure)
            while (placed < total && fkIdx < allFks.length) {
              const fk = allFks[fkIdx];
              await submit(`extra_armor_pick_${gameId}_${pn}_${fk}`, userId);
              placed++;
              if (placed < total) {
                // Click same figure again for second token
                await submit(`extra_armor_pick_${gameId}_${pn}_${fk}`, userId);
                placed++;
              }
              fkIdx++;
            }
            await submit(`extra_armor_confirm_${gameId}_${pn}`, userId);
            continue;
          }
        }
      }

      // Arms Distribution — pick figure step
      if (active.abilityId === 'arms_distribution_deploy' && active.step === 'pick_figure') {
        const eligible = active.eligibleFigures || [];
        if (eligible.length > 0) {
          await submit(`pd_arms_dist_fig_${gameId}_${pn}_${eligible[0]}`, userId);
          continue;
        }
      }

      // Arms Distribution — pick token step
      if (active.abilityId === 'arms_distribution_deploy' && active.step === 'pick_token') {
        await submit(`pd_arms_dist_token_${gameId}_${pn}_Block`, userId);
        abilitiesResolved++;
        continue;
      }

      // Security Detail — pick first leader
      if (active.abilityId === 'security_detail') {
        // Not expected here normally (Security Detail is handled via pd_security_pick directly)
        // but as a fallback:
        if (active.leaders?.length > 0) {
          const leaderFk = active.leaders[0].figureKey;
          await submit(`pd_security_pick_${gameId}_${pn}_${active.figureKey}_${leaderFk}`, userId);
          abilitiesResolved++;
          continue;
        }
      }

      // Companion deploy — pick host space
      if (active.abilityId === 'companion_deploy') {
        const hostPos = g.figurePositions?.[pn]?.[active.figureKey];
        if (hostPos) {
          const { normalizeCoord } = await import('../../src/game/coords.js');
          const space = normalizeCoord(hostPos);
          await submit(`pd_comp_space_${gameId}_${pn}_${space}`, userId);
          abilitiesResolved++;
          continue;
        }
      }

      // If we're stuck with an active ability we don't know how to handle, skip
      if (verbose) console.log(`  [post-deploy] Stuck on active ability: ${active.abilityId} step=${active.step}`);
      errors.push({ step: steps.length, customId: 'pd_stuck', userId, error: `Stuck on post-deploy active ability: ${active.abilityId}` });
      break;
    }

    // ── Ability picker: choose next ability ──
    const abilities = q.abilities || [];
    if (abilities.length === 0) {
      // Check if there are nextPlayerAbilities to advance to
      const npa = q.nextPlayerAbilities || [];
      if (npa.length > 0) {
        // Manually advance to next player (handler should have done this)
        if (verbose) console.log(`  [post-deploy] Advancing to next player (${npa.length} abilities)`);
        q.currentPlayerNum = q.currentPlayerNum === 1 ? 2 : 1;
        q.abilities = npa;
        q.nextPlayerAbilities = null;
        q.activeAbility = null;
        continue;
      }
      // Queue is done — force finish (handler missed calling finishPostDeploy)
      if (verbose) console.log(`  [post-deploy] Force-finishing stalled queue`);
      const gg = harness.getGame();
      delete gg.postDeployQueue;
      gg.postDeployEffectsFired = true;
      break;
    }

    // Remember which ability we're about to pick (before it gets spliced)
    const nextAbility = abilities[0];
    await submit(`pd_pick_${gameId}_${pn}_0`, userId);
    abilitiesResolved++;

    // For Security Detail (interactive, multi-leader), pd_pick shows buttons
    // but doesn't set activeAbility. We need to immediately submit the leader pick.
    if (nextAbility?.abilityId === 'security_detail' && nextAbility.interactive) {
      const g2 = harness.getGame();
      // Pick the first leader
      const leaders = nextAbility.leaders || [];
      if (leaders.length > 0) {
        await submit(`pd_security_pick_${gameId}_${pn}_${nextAbility.figureKey}_${leaders[0].figureKey}`, userId);
      }
    }
  }

  if (safety >= MAX_ITERATIONS) {
    errors.push({ step: steps.length, customId: 'pd_loop', userId: p1Id, error: 'Post-deploy queue exceeded max iterations' });
  }

  return { abilitiesResolved };
}

/**
 * Run a complete setup simulation from zone selection through round 1.
 *
 * @param {object} config
 * @param {string} config.mapId
 * @param {Array} config.p1Army - [{ dcName: 'Stormtrooper', count: 1 }, ...]
 * @param {Array} config.p2Army
 * @param {Array} [config.p1CcDeck] - CC deck for player 1
 * @param {Array} [config.p2CcDeck] - CC deck for player 2
 * @param {boolean} [config.verbose]
 * @returns {Promise<{ game, errors, phases, steps, figureCount }>}
 */
export async function runSetupSim(config) {
  const { verbose = false } = config;
  const errors = [];
  const phases = [];
  const steps = [];

  // Build game at ZONE_SELECTION
  const game = buildSetupGame(config);
  const gameId = game.gameId;
  const p1Id = game.player1Id;
  const p2Id = game.player2Id;

  // Initialize DC state maps
  const dcMessageMeta = new Map();
  const dcExhaustedState = new Map();
  const dcHealthState = new Map();
  initializeDcState(game, dcMessageMeta, dcExhaustedState, dcHealthState);

  // Build deps and harness
  const deps = buildHeadlessDeps({
    dcMessageMeta,
    dcExhaustedState,
    dcHealthState,
    lightweight: true,
  });

  const harness = createHarness(game, {
    deps,
    dcMessageMeta,
    dcExhaustedState,
    dcHealthState,
    lightweight: true,
  });

  // Helper to submit an action and track results
  async function submit(customId, userId, opts = {}) {
    const result = await harness.submitAction(customId, userId, opts);
    const g = harness.getGame();
    const stepInfo = { customId, userId, phase: g?.phase, error: result.error };
    steps.push(stepInfo);
    if (result.error) {
      errors.push({ step: steps.length, customId, userId, error: result.error });
      if (verbose) console.log(`  [setup step ${steps.length}] ERROR: ${result.error}`);
    }
    if (verbose) console.log(`  [setup step ${steps.length}] ${customId} → phase=${g?.phase} roundPhase=${g?.roundPhase}`);
    return result;
  }

  // Helper to get fake channel for a player's hand
  function getHandChannel(playerNum) {
    const handId = playerNum === 1 ? game.p1HandId : game.p2HandId;
    return createFakeChannel(handId);
  }

  try {
    // ── Phase 1: Zone Selection ─────────────────────────────────────────────
    phases.push('zone_selection');
    await submit(`deployment_zone_red_${gameId}`, p1Id);

    let g = harness.getGame();

    // Check if we entered attachment phase (army has skirmish upgrades)
    if (g.phase === PHASES.ATTACHMENT) {
      phases.push('attachment');
      // For armies with skirmish upgrades, handle attachment placement.
      // Auto-attach logic in handleDeploymentZone may have already placed some.
      // For each player with pending attachments, confirm done.
      for (const pn of [1, 2]) {
        const pending = g.setupAttachmentPending?.[pn] || [];
        if (pending.length > 0) {
          // There are unplaced attachments — we need to pick targets.
          // For now, skip armies with manual attachments (they need select menus).
          errors.push({
            step: steps.length,
            customId: 'attachment_manual',
            userId: pn === 1 ? p1Id : p2Id,
            error: `Manual attachment placement needed for ${pending.length} card(s) — not yet supported in setup harness`,
          });
        }
        // If already confirmed (auto-attached), skip
        if (g.setupAttachmentConfirmed?.[pn]) continue;

        // Confirm attachment done
        await submit(`attach_done_confirm_${gameId}_${pn}`, pn === 1 ? p1Id : p2Id, {
          channel: getHandChannel(pn),
        });
      }

      g = harness.getGame();

      // Both confirmed → phase gate should fire
      if (g.phaseGate?.phase === 'attach_done') {
        await submit(`phase_gate_ready_${gameId}`, p1Id);
        await submit(`phase_gate_ready_${gameId}`, p2Id);
        g = harness.getGame();
      }
    }

    // ── Phase 2: Deployment ──────────────────────────────────────────────────
    if (g.phase === PHASES.DEPLOYMENT) {
      phases.push('deployment');
      const initPn = g.initiativePlayerId === p1Id ? 1 : 2;
      const nonInitPn = initPn === 1 ? 2 : 1;
      const initUserId = initPn === 1 ? p1Id : p2Id;
      const nonInitUserId = nonInitPn === 1 ? p1Id : p2Id;

      // Auto-deploy initiative player
      await submit(`auto_deploy_${gameId}_${initPn}`, initUserId, {
        channel: getHandChannel(initPn),
      });

      // Deployment done — initiative player
      await submit(`deployment_done_${gameId}`, initUserId, {
        channel: getHandChannel(initPn),
      });

      g = harness.getGame();

      // Auto-deploy non-initiative player
      await submit(`auto_deploy_${gameId}_${nonInitPn}`, nonInitUserId, {
        channel: getHandChannel(nonInitPn),
      });

      // Deployment done — non-initiative player
      await submit(`deployment_done_${gameId}`, nonInitUserId, {
        channel: getHandChannel(nonInitPn),
      });

      g = harness.getGame();
    }

    // ── Phase 3: Deploy Done Phase Gate ──────────────────────────────────────
    g = harness.getGame();
    if (g.phaseGate?.phase === 'deploy_done') {
      phases.push('deploy_done_gate');
      await submit(`phase_gate_ready_${gameId}`, p1Id);
      await submit(`phase_gate_ready_${gameId}`, p2Id);
      g = harness.getGame();
    }

    // ── Phase 3b: Post-Deploy Abilities ─────────────────────────────────────
    g = harness.getGame();
    if (g.postDeployQueue) {
      phases.push('post_deploy');
      const pdResult = await drivePostDeployQueue(g, gameId, p1Id, p2Id, submit, harness, getHandChannel, errors, steps, verbose);
      if (pdResult.abilitiesResolved > 0 && verbose) {
        console.log(`  [post-deploy] Resolved ${pdResult.abilitiesResolved} abilities`);
      }
      g = harness.getGame();
    }

    // ── Phase 4: CC Draw ─────────────────────────────────────────────────────
    if (g.phase === PHASES.CC_DRAW) {
      phases.push('cc_draw');

      // Draw for each player, handling Moff Gideon's "I Know Everything" interrupts
      for (const pn of [1, 2]) {
        const userId = pn === 1 ? p1Id : p2Id;
        const drawnKey = pn === 1 ? 'player1CcDrawn' : 'player2CcDrawn';
        g = harness.getGame();
        if (g[drawnKey]) continue; // Already drawn

        await submit(`cc_shuffle_draw_${gameId}`, userId, {
          channel: getHandChannel(pn),
        });

        // Check for I Know Everything interrupt (Moff Gideon)
        g = harness.getGame();
        if (g.pendingIKnowEverything) {
          phases.push('i_know_everything');
          // The targeted player picks which card to keep (pick 0 = first card)
          const targetUserId = g.pendingIKnowEverything.targetPlayerNum === 1 ? p1Id : p2Id;
          await submit(`ike_keep_${gameId}_0`, targetUserId, {
            channel: getHandChannel(g.pendingIKnowEverything.targetPlayerNum),
          });
          g = harness.getGame();
        }

        // If still not drawn (e.g., both players trigger IKE), retry
        g = harness.getGame();
        if (!g[drawnKey]) {
          await submit(`cc_shuffle_draw_${gameId}`, userId, {
            channel: getHandChannel(pn),
          });
          g = harness.getGame();
        }
      }

      g = harness.getGame();
    }

    // ── Phase 5: CC Drawn Phase Gate ─────────────────────────────────────────
    g = harness.getGame();
    if (g.phaseGate?.phase === 'cc_drawn') {
      phases.push('cc_drawn_gate');
      await submit(`phase_gate_ready_${gameId}`, p1Id);
      await submit(`phase_gate_ready_${gameId}`, p2Id);
      g = harness.getGame();
    }

    // ── Phase 6: Pre-Activation Phase Gate ──────────────────────────────────
    g = harness.getGame();
    if (g.phaseGate?.phase === 'pre_activation') {
      phases.push('pre_activation_gate');
      await submit(`phase_gate_ready_${gameId}`, p1Id);
      await submit(`phase_gate_ready_${gameId}`, p2Id);
      g = harness.getGame();
    }

    // ── Phase 7: Start-of-Round Phase Gate (if SOR effects exist) ───────────
    g = harness.getGame();
    if (g.phaseGate?.phase === 'post_start_of_round') {
      phases.push('post_start_of_round_gate');
      await submit(`phase_gate_ready_${gameId}`, p1Id);
      await submit(`phase_gate_ready_${gameId}`, p2Id);
      g = harness.getGame();
    }

    // Check final state
    g = harness.getGame();
    const figureCount = {
      p1: Object.keys(g.figurePositions?.[1] || {}).length,
      p2: Object.keys(g.figurePositions?.[2] || {}).length,
    };

    return {
      game: g,
      errors,
      phases,
      steps,
      figureCount,
      reachedRoundActive: g.phase === PHASES.ROUND_ACTIVE,
      gameId,
    };
  } catch (err) {
    errors.push({ step: steps.length, customId: 'uncaught', error: err.message, stack: err.stack });
    return {
      game: harness.getGame(),
      errors,
      phases,
      steps,
      figureCount: { p1: 0, p2: 0 },
      reachedRoundActive: false,
      gameId,
    };
  }
}
