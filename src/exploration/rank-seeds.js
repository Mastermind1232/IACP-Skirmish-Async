/**
 * Seed ranking: shared logic for prioritizing headless exploration seeds.
 * Used by both the CLI (explorer-rank.js) and the bot (auto-select in /selfplay start).
 */

import { getPool } from '../db.js';

// ── Pure ranking functions (extracted from explorer-rank.js) ─────────────────

/**
 * Compute rare_reach_score: SUM(1 / headless_count) for each transition hit.
 */
export function computeRareReachScore(transitionsHit, transitionIndex) {
  let score = 0;
  for (const key of transitionsHit) {
    const t = transitionIndex.get(key);
    if (t && t.headless_count > 0) {
      score += 1 / t.headless_count;
    } else {
      score += 1;
    }
  }
  return score;
}

/**
 * Group episodes by seed_config, compute per-seed aggregate metrics, return ranked list.
 */
export function rankSeeds(episodes, transitions) {
  const groups = new Map();
  for (const ep of episodes) {
    const sc = ep.seed_config;
    const key = `${sc.p1Deck} vs ${sc.p2Deck} @ ${sc.mapId}`;
    if (!groups.has(key)) {
      groups.set(key, { seedKey: key, p1Deck: sc.p1Deck, p2Deck: sc.p2Deck, mapId: sc.mapId, episodes: [] });
    }
    groups.get(key).episodes.push(ep);
  }

  const ranked = [];
  for (const [, group] of groups) {
    const eps = group.episodes;
    let bestRareReach = 0;
    let bestUniqueTransitions = 0;
    let bestNovelYield = 0;
    let totalGsErrors = 0;
    let anyCompleted = false;
    const allTransitionsReached = new Set();

    for (const ep of eps) {
      const hits = ep.transitions_hit || [];
      const rareReach = computeRareReachScore(hits, transitions);
      if (rareReach > bestRareReach) bestRareReach = rareReach;
      if (ep.unique_transitions > bestUniqueTransitions) bestUniqueTransitions = ep.unique_transitions;
      if (ep.novel_transitions > bestNovelYield) bestNovelYield = ep.novel_transitions;
      totalGsErrors += ep.invariant_errors || 0;
      if (ep.result === 'completed') anyCompleted = true;
      for (const key of hits) allTransitionsReached.add(key);
    }

    const completionMultiplier = anyCompleted ? 1.5 : 1.0;
    const compositeScore = bestRareReach * completionMultiplier;

    const rareTransitions = [];
    for (const key of allTransitionsReached) {
      const t = transitions.get(key);
      if (t) rareTransitions.push({ key, headless_count: t.headless_count });
    }
    rareTransitions.sort((a, b) => a.headless_count - b.headless_count);

    ranked.push({
      ...group,
      runs: eps.length,
      bestRareReach,
      bestUniqueTransitions,
      bestNovelYield,
      totalGsErrors,
      anyCompleted,
      compositeScore,
      totalTransitionsReached: allTransitionsReached.size,
      rareTransitions: rareTransitions.slice(0, 5),
    });
  }

  ranked.sort((a, b) => b.compositeScore - a.compositeScore);
  return ranked;
}

// ── Auto-selection ───────────────────────────────────────────────────────────

/**
 * Get the top validation candidate from ranked exploration data.
 * Picks the highest-ranked seed with zero discord episodes.
 * If all have discord runs, picks highest-ranked with fewest discord runs.
 *
 * @param {function} getDestructDecks - Returns array of deck objects from destruct-test-decks.json
 * @returns {Promise<{ mapId, p1Deck, p2Deck, score, seedKey } | null>}
 */
export async function getTopValidationCandidate(getDestructDecks) {
  const pool = getPool();
  if (!pool) return null;

  const [transRes, epRes] = await Promise.all([
    pool.query('SELECT transition_key, headless_count, invariant_fails, scenarios_reaching FROM exploration_transitions'),
    pool.query('SELECT seed_config, total_steps, unique_transitions, novel_transitions, invariant_errors, transitions_hit, result, source FROM exploration_episodes ORDER BY created_at ASC'),
  ]);

  if (transRes.rows.length === 0) return null;

  const transitions = new Map();
  for (const row of transRes.rows) {
    transitions.set(row.transition_key, {
      headless_count: row.headless_count,
      invariant_fails: row.invariant_fails,
      scenarios: row.scenarios_reaching || [],
    });
  }

  const ranked = rankSeeds(epRes.rows, transitions);
  if (ranked.length === 0) return null;

  // Count discord episodes per seed key
  const discordRunsBySeed = new Map();
  for (const row of epRes.rows) {
    if (row.source !== 'discord') continue;
    const sc = row.seed_config;
    const key = `${sc.p1Deck} vs ${sc.p2Deck} @ ${sc.mapId}`;
    discordRunsBySeed.set(key, (discordRunsBySeed.get(key) || 0) + 1);
  }

  const decks = getDestructDecks();
  const decksByName = new Map(decks.map(d => [d.name, d]));

  // Try unvalidated seeds first (zero discord runs), in ranked order
  for (const seed of ranked) {
    if ((discordRunsBySeed.get(seed.seedKey) || 0) > 0) continue;
    const p1Deck = decksByName.get(seed.p1Deck);
    const p2Deck = decksByName.get(seed.p2Deck);
    if (p1Deck && p2Deck) {
      return { mapId: seed.mapId, p1Deck, p2Deck, score: seed.compositeScore, seedKey: seed.seedKey };
    }
  }

  // All have discord runs — pick highest-ranked with fewest runs
  const byPriority = [...ranked]
    .map(s => ({ ...s, discordRuns: discordRunsBySeed.get(s.seedKey) || 0 }))
    .sort((a, b) => a.discordRuns - b.discordRuns || b.compositeScore - a.compositeScore);

  for (const seed of byPriority) {
    const p1Deck = decksByName.get(seed.p1Deck);
    const p2Deck = decksByName.get(seed.p2Deck);
    if (p1Deck && p2Deck) {
      return { mapId: seed.mapId, p1Deck, p2Deck, score: seed.compositeScore, seedKey: seed.seedKey, discordRuns: seed.discordRuns };
    }
  }

  return null;
}
