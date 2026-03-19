/**
 * Explorer Policy: action selection for headless exploration.
 *
 * Separated from src/ai/strategy.js (greedy play) to keep concerns clean.
 * Uses epsilon-greedy with coverage-driven tie-breaking.
 */

import { scoreAction } from '../../src/ai/strategy.js';
import { computeTransitionKey } from './explorer-coverage.js';

/**
 * Pick an exploratory action from available actions.
 *
 * With probability epsilon: pick uniformly random from plausible actions
 *   (plausible = scoreAction >= 50% of best score, minimum threshold 10)
 * With probability (1 - epsilon): pick action with lowest coverage count
 *   (break ties randomly)
 *
 * @param {Array} actions - Available actions from getAvailableActions
 * @param {object} game - Current game state
 * @param {number} playerNum - 1 or 2
 * @param {import('./explorer-coverage.js').CoverageMap} coverageMap
 * @param {{ epsilon?: number }} [opts]
 * @returns {{ action: object, reason: 'coverage'|'epsilon'|'only' }}
 */
export function pickExploratoryAction(actions, game, playerNum, coverageMap, opts = {}) {
  if (!actions || actions.length === 0) return null;
  if (actions.length === 1) return { action: actions[0], reason: 'only' };

  const epsilon = opts.epsilon ?? 0.15;

  // Score all actions for plausibility filtering
  const scored = actions.map(a => ({
    action: a,
    score: scoreAction(a, game, playerNum),
    key: computeTransitionKey(game, a.type),
  }));

  const bestScore = Math.max(...scored.map(s => s.score));
  const threshold = Math.max(bestScore * 0.5, 10);
  const plausible = scored.filter(s => s.score >= threshold);
  // Fallback: if nothing passes threshold, use all actions
  const pool = plausible.length > 0 ? plausible : scored;

  // Epsilon: random from plausible
  if (Math.random() < epsilon) {
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return { action: pick.action, reason: 'epsilon' };
  }

  // Coverage-driven: pick lowest-count action
  let minCount = Infinity;
  for (const s of pool) {
    const count = coverageMap.getCount(s.key);
    if (count < minCount) minCount = count;
  }

  const lowestCoverage = pool.filter(s => coverageMap.getCount(s.key) === minCount);
  const pick = lowestCoverage[Math.floor(Math.random() * lowestCoverage.length)];
  return { action: pick.action, reason: 'coverage' };
}
