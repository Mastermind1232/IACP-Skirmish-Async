/**
 * Headless Explorer: discovers game-state transitions cheaply.
 *
 * Runs N episodes using the flow harness, records transition coverage to DB,
 * and prints a summary. Seeds are drawn from destruct test deck pairings × maps.
 *
 * Usage:
 *   node tests/headless/explorer.js [--episodes=N] [--epsilon=E] [--seed-limit=M] [--max-steps=S] [--verbose]
 *
 * Examples:
 *   node tests/headless/explorer.js --episodes=10
 *   node tests/headless/explorer.js --episodes=50 --epsilon=0.3
 *   node tests/headless/explorer.js --episodes=5 --verbose
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createFlowHarness } from './flow-harness.js';
import { CoverageMap, computeTransitionKey, buildContextTags, recordEpisode } from './explorer-coverage.js';
import { pickExploratoryAction } from './explorer-policy.js';
import { getMapRegistry, getMapData, getDeploymentZones } from '../../src/data-loader.js';
import { isDbConfigured, initDb } from '../../src/db.js';

const __explorerDirname = dirname(fileURLToPath(import.meta.url));

// ── CLI Args ────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { episodes: 10, epsilon: 0.15, seedLimit: 50, maxSteps: 300, verbose: false };

  for (const arg of args) {
    if (arg.startsWith('--episodes=')) opts.episodes = parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--epsilon=')) opts.epsilon = parseFloat(arg.split('=')[1]);
    else if (arg.startsWith('--seed-limit=')) opts.seedLimit = parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--max-steps=')) opts.maxSteps = parseInt(arg.split('=')[1], 10);
    else if (arg === '--verbose') opts.verbose = true;
  }

  return opts;
}

// ── Seed Generation ─────────────────────────────────────────────────────────

function loadDestructDecks() {
  const path = join(__explorerDirname, '..', '..', 'data', 'destruct-test-decks.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}

function getUsableMaps() {
  const maps = getMapRegistry();
  const zones = getDeploymentZones();
  const usable = [];
  for (const m of maps) {
    try {
      const spaces = getMapData(m.id);
      if (!spaces || Object.keys(spaces).length === 0) continue;
      const z = zones[m.id];
      if (!z?.red?.length || !z?.blue?.length) continue;
      usable.push(m.id);
    } catch { /* skip */ }
  }
  return usable;
}

/**
 * Generate seed configs by pairing destruct decks against each other × maps.
 * Shuffle and take first `limit` seeds.
 */
function generateSeeds(limit) {
  const decks = loadDestructDecks();
  const maps = getUsableMaps();

  if (decks.length === 0) {
    console.error('No destruct test decks found.');
    process.exit(1);
  }
  if (maps.length === 0) {
    console.error('No usable maps found.');
    process.exit(1);
  }

  const seeds = [];

  // Generate matchups: each deck vs next deck (wrap around), across maps
  for (let i = 0; i < decks.length; i++) {
    for (let j = i + 1; j < decks.length; j++) {
      const mapId = maps[(i + j) % maps.length];
      seeds.push({
        p1Deck: decks[i],
        p2Deck: decks[j],
        mapId,
      });
    }
  }

  // Shuffle
  for (let i = seeds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [seeds[i], seeds[j]] = [seeds[j], seeds[i]];
  }

  return seeds.slice(0, limit);
}

/**
 * Convert a destruct deck entry to the army format expected by flow harness.
 */
function deckToArmy(deck) {
  return (deck.dcList || [])
    .filter(name => !name.startsWith('[')) // Skip skirmish upgrades for army
    .map(name => ({ dcName: name }));
}

/**
 * Extract CC hand from a deck (first 3 CC cards).
 */
function deckToCcHand(deck) {
  const cc = deck.ccList || [];
  return cc.slice(0, 3);
}

/**
 * Extract CC deck (remaining CC cards after hand).
 */
function deckToCcDeck(deck) {
  const cc = deck.ccList || [];
  return cc.slice(3);
}

// ── Episode Runner ──────────────────────────────────────────────────────────

async function runEpisode(seed, coverageMap, opts) {
  const episodeId = randomUUID();
  const startTime = Date.now();

  const p1Army = deckToArmy(seed.p1Deck);
  const p2Army = deckToArmy(seed.p2Deck);
  const p1CcHand = deckToCcHand(seed.p1Deck);
  const p2CcHand = deckToCcHand(seed.p2Deck);
  const p1CcDeck = deckToCcDeck(seed.p1Deck);
  const p2CcDeck = deckToCcDeck(seed.p2Deck);

  let fh;
  try {
    fh = createFlowHarness({
      mapId: seed.mapId,
      p1Army,
      p2Army,
      p1CcHand,
      p2CcHand,
      p1CcDeck,
      p2CcDeck,
    });
  } catch (err) {
    return {
      episodeId,
      status: 'setup-error',
      error: err.message,
      steps: 0,
      novel: 0,
      invariantErrors: 0,
      transitionsHit: [],
      durationMs: Date.now() - startTime,
    };
  }

  const transitionsHit = [];
  let invariantErrorCount = 0;
  let surfaceErrorCount = 0;
  let stepNum = 0;
  let result = 'completed';
  let stopReason = 'game_ended';

  for (stepNum = 0; stepNum < opts.maxSteps; stepNum++) {
    const game = fh.getGame();
    if (game.ended) break;

    // Get actions for both players
    const p1Actions = fh.getActions(1);
    const p2Actions = fh.getActions(2);
    const allActions = [
      ...p1Actions.map(a => ({ ...a, _playerNum: 1, _userId: 'player1' })),
      ...p2Actions.map(a => ({ ...a, _playerNum: 2, _userId: 'player2' })),
    ];

    if (allActions.length === 0) {
      result = 'dead-end';
      stopReason = 'no_actions';
      break;
    }

    // Pick action via explorer policy
    const pick = pickExploratoryAction(allActions, game, allActions[0]._playerNum, coverageMap, { epsilon: opts.epsilon });
    if (!pick) {
      result = 'dead-end';
      stopReason = 'policy_null';
      break;
    }

    const action = pick.action;
    const transitionKey = computeTransitionKey(game, action.type);
    const isNovel = coverageMap.isNovel(transitionKey) && !transitionsHit.includes(transitionKey);

    // Execute action — CC play needs special handling (multi-step UI chain)
    let stepResult;
    try {
      if (action.type === 'play_cc') {
        const ccName = action.params?.cardName || action.params?.ccName;
        if (ccName) {
          await fh.playCc(ccName, action._userId);
        }
        // playCc doesn't return invariant errors in the same shape — record transition and continue
        const tags = buildContextTags(game, action);
        if (ccName) tags.cc_name = ccName;
        coverageMap.recordTransition(transitionKey, tags, { scenarioId: episodeId });
        transitionsHit.push(transitionKey);
        if (opts.verbose && isNovel) {
          console.log(`  [step ${stepNum}] NOVEL: ${transitionKey} (${pick.reason}) cc=${ccName}`);
        }
        continue;
      }

      stepResult = await fh.act(action.customId, action._userId);
    } catch (err) {
      result = 'crash';
      stopReason = `act_error: ${err.message}`;
      // Record transition even on crash
      const tags = buildContextTags(game, action);
      coverageMap.recordTransition(transitionKey, tags, {
        scenarioId: episodeId,
        invariantFail: true,
      });
      transitionsHit.push(transitionKey);
      invariantErrorCount++;
      break;
    }

    // Classify invariant errors: DS-* are surface issues, GS-* are game-logic issues
    const allErrors = stepResult.invariantErrors || [];
    const gameErrors = allErrors.filter(e => !e.startsWith('DS-'));
    const surfaceErrors = allErrors.filter(e => e.startsWith('DS-'));
    const hasGameError = gameErrors.length > 0;
    const hasSurfaceError = surfaceErrors.length > 0;

    // Record transition — only game-logic errors count as invariant_fails
    const tags = buildContextTags(game, action);
    coverageMap.recordTransition(transitionKey, tags, {
      scenarioId: episodeId,
      invariantFail: hasGameError,
      surfaceFail: hasSurfaceError,
    });
    transitionsHit.push(transitionKey);

    if (hasGameError) {
      invariantErrorCount++;
      if (opts.verbose) {
        console.log(`  [step ${stepNum}] GS ERROR: ${gameErrors.join('; ')}`);
      }
    }
    if (hasSurfaceError) {
      surfaceErrorCount++;
      if (opts.verbose) {
        console.log(`  [step ${stepNum}] DS noise: ${surfaceErrors.length} surface errors`);
      }
    }

    if (opts.verbose && isNovel) {
      console.log(`  [step ${stepNum}] NOVEL: ${transitionKey} (${pick.reason})`);
    }
  }

  if (stepNum >= opts.maxSteps) {
    result = 'step-cap';
    stopReason = 'max_steps';
  }

  const durationMs = Date.now() - startTime;
  const dedupedHits = [...new Set(transitionsHit)];
  const uniqueTransitions = dedupedHits.length;

  // novel_yield: how many distinct transitions this episode hit that were NOT in the DB
  // at the start of this batch. This is a per-episode ranking signal — it measures this
  // seed config's ability to reach novel territory. Two episodes in the same batch may
  // both claim credit for the same transition; that is intentional (both seeds can reach
  // it). The globally-deduplicated batch novelty count is coverageMap.getBatchNovelCount().
  const novelYield = dedupedHits.filter(key => coverageMap.isNovel(key)).length;

  return {
    episodeId,
    status: result,
    stopReason,
    steps: stepNum,
    uniqueTransitions,
    novelYield,
    invariantErrors: invariantErrorCount,
    surfaceErrors: surfaceErrorCount,
    transitionsHit: dedupedHits,
    durationMs,
    seed,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.log(`Headless Explorer`);
  console.log(`  episodes: ${opts.episodes}`);
  console.log(`  epsilon: ${opts.epsilon}`);
  console.log(`  seed-limit: ${opts.seedLimit}`);
  console.log(`  max-steps: ${opts.maxSteps}`);
  console.log(`  db: ${isDbConfigured() ? 'yes' : 'no (in-memory only)'}`);
  console.log();

  // Initialize DB if available
  if (isDbConfigured()) {
    await initDb();
  }

  // Load existing coverage from DB
  const coverageMap = new CoverageMap();
  if (isDbConfigured()) {
    await coverageMap.loadFromDb();
    console.log(`Loaded ${coverageMap._preExisting.size} pre-existing transitions from DB.\n`);
  }

  // Generate seeds
  const seeds = generateSeeds(opts.seedLimit);
  console.log(`Generated ${seeds.length} seed configs.\n`);

  // Run episodes
  const episodeResults = [];
  let totalInvariantErrors = 0;
  let totalSurfaceErrors = 0;
  let totalSteps = 0;

  for (let i = 0; i < opts.episodes; i++) {
    const seed = seeds[i % seeds.length];
    const label = `[${i + 1}/${opts.episodes}] ${seed.p1Deck.name} vs ${seed.p2Deck.name} @ ${seed.mapId}`;

    if (opts.verbose) console.log(`\n${label}`);

    const result = await runEpisode(seed, coverageMap, opts);
    episodeResults.push(result);

    totalInvariantErrors += result.invariantErrors;
    totalSurfaceErrors += result.surfaceErrors;
    totalSteps += result.steps;

    // Per-episode summary (compact)
    const novelTag = result.novelYield > 0 ? ` (${result.novelYield} novel-yield)` : '';
    const errTag = result.invariantErrors > 0 ? ` [${result.invariantErrors} GS errors]` : '';
    const dsTag = result.surfaceErrors > 0 ? ` [${result.surfaceErrors} DS noise]` : '';
    console.log(
      `  ${label}: ${result.status} in ${result.steps} steps, ` +
      `${result.uniqueTransitions} unique transitions${novelTag}${errTag}${dsTag} (${result.durationMs}ms)`
    );

    // Persist episode to DB
    if (isDbConfigured()) {
      await recordEpisode({
        episode_id: result.episodeId,
        source: 'headless',
        seed_config: {
          mapId: seed.mapId,
          p1Deck: seed.p1Deck.name,
          p2Deck: seed.p2Deck.name,
        },
        total_steps: result.steps,
        unique_transitions: result.uniqueTransitions,
        // novel_yield: per-episode count of distinct transitions this episode hit that were
        // NOT in the DB at batch start. This is a seed-ranking signal, not a batch total.
        // Two episodes may both claim the same novel transition — intentional.
        // Batch-level deduplicated novelty: coverageMap.getBatchNovelCount().
        novel_transitions: result.novelYield,
        invariant_errors: result.invariantErrors,
        transitions_hit: result.transitionsHit,
        result: result.status,
        stop_reason: result.stopReason,
        duration_ms: result.durationMs,
      });
    }
  }

  // Persist coverage to DB
  if (isDbConfigured()) {
    console.log('\nPersisting coverage to DB...');
    await coverageMap.persistToDb();
  }

  // Batch summary
  const summary = coverageMap.getSummary();
  const batchNovel = coverageMap.getBatchNovelCount();
  console.log('\n═══ Batch Summary ═══');
  console.log(`  Episodes: ${opts.episodes}`);
  console.log(`  Total steps: ${totalSteps}`);
  console.log(`  Coverage: ${summary.total} transitions discovered (${batchNovel} novel this batch)`);
  console.log(`  Game-logic errors (GS): ${totalInvariantErrors}`);
  console.log(`  Surface noise (DS): ${totalSurfaceErrors}`);

  // Top action types by count
  const sorted = Object.entries(summary.byActionType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  if (sorted.length > 0) {
    console.log(`  Top action types: ${sorted.map(([t, c]) => `${t} (${c})`).join(', ')}`);
  }

  // Status breakdown
  const statusCounts = {};
  for (const r of episodeResults) {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
  }
  console.log(`  Episode outcomes: ${Object.entries(statusCounts).map(([s, c]) => `${s}=${c}`).join(', ')}`);

  console.log();
  process.exit(0);
}

main().catch(err => {
  console.error('Explorer fatal error:', err);
  process.exit(1);
});
