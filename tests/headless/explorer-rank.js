/**
 * Explorer Rank: read-only CLI that ranks explored seed configs by validation priority.
 *
 * Reads exploration_transitions and exploration_episodes from Postgres.
 * Computes a simple priority score for each seed config and prints a ranked report.
 * Does NOT modify any data. Does NOT interact with Discord.
 *
 * Usage:
 *   node tests/headless/explorer-rank.js [--top=N] [--frontier=M] [--json]
 *
 * Options:
 *   --top=N       Show top N seed configs (default: 15)
 *   --frontier=M  Show M rarest transitions (default: 20)
 *   --json        Output as JSON instead of formatted text
 */

import pg from 'pg';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('DATABASE_URL not set. This tool requires a Postgres connection.');
  process.exit(1);
}

// ── CLI Args ────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { top: 15, frontier: 20, json: false };
  for (const arg of args) {
    if (arg.startsWith('--top=')) opts.top = parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--frontier=')) opts.frontier = parseInt(arg.split('=')[1], 10);
    else if (arg === '--json') opts.json = true;
  }
  return opts;
}

// ── Data Loading ────────────────────────────────────────────────────────────

async function loadData(pool) {
  const [transRes, epRes] = await Promise.all([
    pool.query('SELECT transition_key, headless_count, invariant_fails, scenarios_reaching FROM exploration_transitions'),
    pool.query('SELECT episode_id, seed_config, total_steps, unique_transitions, novel_transitions, invariant_errors, transitions_hit, result, duration_ms, created_at FROM exploration_episodes ORDER BY created_at ASC'),
  ]);

  // Index transitions by key
  const transitions = new Map();
  for (const row of transRes.rows) {
    transitions.set(row.transition_key, {
      headless_count: row.headless_count,
      invariant_fails: row.invariant_fails,
      scenarios: row.scenarios_reaching || [],
    });
  }

  return { transitions, episodes: epRes.rows };
}

// ── Scoring ─────────────────────────────────────────────────────────────────

/**
 * Compute rare_reach_score for an episode: SUM(1 / headless_count) for each
 * distinct transition the episode hit. Rewards seeds that reach low-coverage
 * (underexplored) transitions.
 */
function computeRareReachScore(transitionsHit, transitionIndex) {
  let score = 0;
  for (const key of transitionsHit) {
    const t = transitionIndex.get(key);
    if (t && t.headless_count > 0) {
      score += 1 / t.headless_count;
    } else {
      // Transition not in DB (shouldn't happen, but treat as maximally rare)
      score += 1;
    }
  }
  return score;
}

/**
 * Group episodes by seed_config and compute per-seed aggregate metrics.
 */
function rankSeeds(episodes, transitions) {
  // Group by canonical seed key
  const groups = new Map();
  for (const ep of episodes) {
    const sc = ep.seed_config;
    const key = `${sc.p1Deck} vs ${sc.p2Deck} @ ${sc.mapId}`;

    if (!groups.has(key)) {
      groups.set(key, {
        seedKey: key,
        p1Deck: sc.p1Deck,
        p2Deck: sc.p2Deck,
        mapId: sc.mapId,
        episodes: [],
      });
    }
    groups.get(key).episodes.push(ep);
  }

  // Score each seed group
  const ranked = [];
  for (const [, group] of groups) {
    const eps = group.episodes;
    const runs = eps.length;

    // Aggregate: use best episode's metrics (max, not average — we want peak capability)
    let bestRareReach = 0;
    let bestUniqueTransitions = 0;
    let bestNovelYield = 0;
    let totalGsErrors = 0;
    let anyCompleted = false;
    // Collect all transitions reached across all runs of this seed
    const allTransitionsReached = new Set();

    for (const ep of eps) {
      const hits = ep.transitions_hit || [];
      const rareReach = computeRareReachScore(hits, transitions);
      if (rareReach > bestRareReach) bestRareReach = rareReach;
      if (ep.unique_transitions > bestUniqueTransitions) bestUniqueTransitions = ep.unique_transitions;
      // novel_transitions: per-episode novel-yield relative to DB baseline at that batch's
      // start. This is a ranking signal for how much novel territory this seed can reach.
      // Two episodes (even in the same batch) may both claim credit for the same transition.
      // That is intentional — it means both seeds can reach that territory.
      if (ep.novel_transitions > bestNovelYield) bestNovelYield = ep.novel_transitions;
      totalGsErrors += ep.invariant_errors || 0;
      if (ep.result === 'completed') anyCompleted = true;
      for (const key of hits) allTransitionsReached.add(key);
    }

    // Composite score: rare_reach * completion bonus
    // Simple and inspectable. rare_reach_score is the primary signal.
    const completionMultiplier = anyCompleted ? 1.5 : 1.0;
    const compositeScore = bestRareReach * completionMultiplier;

    // Find the rarest transitions this seed reaches
    const rareTransitions = [];
    for (const key of allTransitionsReached) {
      const t = transitions.get(key);
      if (t) {
        rareTransitions.push({ key, headless_count: t.headless_count });
      }
    }
    rareTransitions.sort((a, b) => a.headless_count - b.headless_count);

    ranked.push({
      ...group,
      runs,
      bestRareReach,
      bestUniqueTransitions,
      bestNovelYield,
      totalGsErrors,
      anyCompleted,
      compositeScore,
      totalTransitionsReached: allTransitionsReached.size,
      rareTransitions: rareTransitions.slice(0, 5), // Top 5 rarest
    });
  }

  // Sort by composite score descending
  ranked.sort((a, b) => b.compositeScore - a.compositeScore);
  return ranked;
}

/**
 * Compute the coverage frontier: rarest transitions across all exploration.
 */
function computeFrontier(transitions, limit) {
  const entries = [];
  for (const [key, t] of transitions) {
    entries.push({
      key,
      headless_count: t.headless_count,
      invariant_fails: t.invariant_fails,
      scenario_count: (t.scenarios || []).length,
      scenarios: t.scenarios || [],
    });
  }
  entries.sort((a, b) => a.headless_count - b.headless_count);
  return entries.slice(0, limit);
}

/**
 * Compute summary health stats.
 */
function computeSummary(transitions, episodes) {
  let total = 0;
  let count1 = 0;
  let count2to5 = 0;
  let count6plus = 0;
  let totalHits = 0;
  let withGsFails = 0;

  for (const [, t] of transitions) {
    total++;
    totalHits += t.headless_count;
    if (t.headless_count === 1) count1++;
    else if (t.headless_count <= 5) count2to5++;
    else count6plus++;
    if (t.invariant_fails > 0) withGsFails++;
  }

  const completedEpisodes = episodes.filter(e => e.result === 'completed').length;

  return {
    totalTransitions: total,
    totalHits,
    totalEpisodes: episodes.length,
    completedEpisodes,
    countAt1: count1,
    countAt2to5: count2to5,
    countAt6plus: count6plus,
    withGsFails,
  };
}

// ── Output ──────────────────────────────────────────────────────────────────

function printText(ranked, frontier, summary, opts) {
  // Section 0: Summary
  console.log('═══ Exploration Health ═══');
  console.log(`  Transitions: ${summary.totalTransitions} (${summary.totalHits} total hits)`);
  console.log(`  Episodes: ${summary.totalEpisodes} (${summary.completedEpisodes} completed)`);
  console.log(`  Coverage depth: count=1: ${summary.countAt1}, count=2-5: ${summary.countAt2to5}, count=6+: ${summary.countAt6plus}`);
  if (summary.withGsFails > 0) {
    console.log(`  Transitions with GS errors: ${summary.withGsFails}`);
  }
  console.log();

  // Section 1: Ranked seeds
  console.log('═══ Explored Seeds (ranked by validation priority) ═══');
  console.log('  Score = rare_reach_score * completion_bonus (1.5x if any run completed)');
  console.log();

  const top = ranked.slice(0, opts.top);
  for (let i = 0; i < top.length; i++) {
    const s = top[i];
    const completedTag = s.anyCompleted ? 'yes' : 'no';
    const gsTag = s.totalGsErrors > 0 ? `  gs_errors=${s.totalGsErrors}` : '';
    console.log(`  #${i + 1}  ${s.seedKey}`);
    console.log(`       score=${s.compositeScore.toFixed(2)}  rare_reach=${s.bestRareReach.toFixed(2)}  unique=${s.bestUniqueTransitions}  novel_yield=${s.bestNovelYield}  completed=${completedTag}  runs=${s.runs}${gsTag}`);
    if (s.rareTransitions.length > 0) {
      console.log('       rare transitions reached:');
      for (const rt of s.rareTransitions) {
        console.log(`         ${rt.key} (count=${rt.headless_count})`);
      }
    }
    console.log();
  }

  if (ranked.length > opts.top) {
    console.log(`  ... and ${ranked.length - opts.top} more seeds (use --top=${ranked.length} to see all)`);
    console.log();
  }

  // Section 2: Coverage frontier
  console.log('═══ Coverage Frontier (rarest transitions) ═══');
  console.log();

  for (const t of frontier) {
    const seedList = t.scenarios.length > 0
      ? t.scenarios.map(s => {
          // scenarios_reaching contains episode UUIDs — not seed names
          // Show count instead
          return null;
        }).filter(Boolean)
      : [];
    console.log(`  ${t.key}`);
    console.log(`    count=${t.headless_count}  reached_by=${t.scenario_count} episodes${t.invariant_fails > 0 ? `  gs_fails=${t.invariant_fails}` : ''}`);
  }
  console.log();
}

function printJson(ranked, frontier, summary) {
  console.log(JSON.stringify({ summary, ranked, frontier }, null, 2));
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const pool = new pg.Pool({
    connectionString: DB_URL,
    ssl: DB_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  try {
    const { transitions, episodes } = await loadData(pool);

    if (transitions.size === 0) {
      console.log('No exploration data found. Run the explorer first:');
      console.log('  node tests/headless/explorer.js --episodes=10');
      process.exit(0);
    }

    const ranked = rankSeeds(episodes, transitions);
    const frontier = computeFrontier(transitions, opts.frontier);
    const summary = computeSummary(transitions, episodes);

    if (opts.json) {
      printJson(ranked, frontier, summary);
    } else {
      printText(ranked, frontier, summary, opts);
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Explorer-rank fatal error:', err);
  process.exit(1);
});
