/**
 * ELO rating system + matchmaking for the Skirbo Arena.
 */

// ── ELO Calculation ──────────────────────────────────────────────────────────

/**
 * Calculate ELO change for player A.
 * @param {number} ratingA - Current rating of player A
 * @param {number} ratingB - Current rating of player B
 * @param {number} scoreA - 1.0 = A wins, 0.0 = A loses, 0.5 = draw
 * @param {number} K - K-factor (default 32)
 * @returns {{ changeA: number, changeB: number }}
 */
export function calculateEloChange(ratingA, ratingB, scoreA, K = 32) {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;
  const scoreB = 1 - scoreA;
  return {
    changeA: K * (scoreA - expectedA),
    changeB: K * (scoreB - expectedB),
  };
}

/**
 * Apply ELO change to an agent, clamping to [100, 10000].
 */
export function updateAgentElo(agent, change, gameNum) {
  agent.elo = Math.max(100, Math.min(10000, agent.elo + change));
  if (agent.elo > agent.stats.bestElo) agent.stats.bestElo = agent.elo;

  // Sample ELO history every 10 games or after significant change
  if (gameNum % 10 === 0 || Math.abs(change) > 20) {
    agent.eloHistory.push({ game: gameNum, elo: Math.round(agent.elo) });
    // Keep last 200 entries
    if (agent.eloHistory.length > 200) agent.eloHistory = agent.eloHistory.slice(-200);
  }
}

/**
 * Update agent win/loss stats after a game.
 */
export function updateAgentStats(agent, won) {
  agent.stats.games++;
  if (won) {
    agent.stats.wins++;
    agent.stats.winStreak++;
  } else {
    agent.stats.losses++;
    agent.stats.winStreak = 0;
  }
}

// ── Matchmaking ──────────────────────────────────────────────────────────────

/**
 * Select two agents for a match.
 * 80%: weighted random favoring close-ELO pairings.
 * 20%: top-5 vs random non-top-5.
 */
export function selectMatchup(agentsArray) {
  if (agentsArray.length < 2) throw new Error('Need at least 2 agents');

  const sorted = [...agentsArray].sort((a, b) => b.elo - a.elo);

  if (Math.random() < 0.2 && agentsArray.length >= 6) {
    // Top-5 vs random non-top-5
    const top5 = sorted.slice(0, 5);
    const rest = sorted.slice(5);
    const a1 = top5[Math.floor(Math.random() * top5.length)];
    const a2 = rest[Math.floor(Math.random() * rest.length)];
    return [a1, a2];
  }

  // Weighted random favoring close ELO
  // Pick a random agent, then pick opponent weighted by 1/(1+eloDiff)
  const idx1 = Math.floor(Math.random() * agentsArray.length);
  const a1 = agentsArray[idx1];

  const candidates = agentsArray.filter(a => a.id !== a1.id);
  const weights = candidates.map(a => 1 / (1 + Math.abs(a.elo - a1.elo)));
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  let roll = Math.random() * totalWeight;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return [a1, candidates[i]];
  }
  return [a1, candidates[candidates.length - 1]];
}
