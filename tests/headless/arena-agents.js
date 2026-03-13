/**
 * Agent creation, evolution, naming, and army mutation for the Skirbo Arena.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { getDcEffects, getCcEffectsData } from '../../src/data-loader.js';

// ── Persistence ──────────────────────────────────────────────────────────────

export function loadArenaData(filePath) {
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf8'));
    }
  } catch { /* start fresh */ }
  return createEmptyArenaData();
}

export function saveArenaData(data, filePath) {
  data.meta.lastUpdated = new Date().toISOString();
  writeFileSync(filePath, JSON.stringify(data));
}

function createEmptyArenaData() {
  return {
    meta: {
      totalGames: 0,
      totalGenerations: 1,
      lastUpdated: null,
      settings: {
        populationSize: 20,
        matchesPerCycle: 50,
        kFactor: 32,
        mutationRate: 0.3,
        mutationStrength: 0.2,
        cullCount: 4,
        breedCount: 4,
      },
    },
    agents: {},
    matchHistory: [],
    evolutionLog: [],
  };
}

// ── Strategy Generation ──────────────────────────────────────────────────────

const REWARD_KEYS = ['vp', 'dmg', 'hp', 'dist', 'terminal'];
const ACTION_PREF_KEYS = [
  'attack_close', 'attack_ranged', 'move_toward', 'move_away', 'move_lateral',
  'move_done', 'start_move', 'activate', 'end_activation', 'pass',
  'ability', 'spend_surge', 'skip_surges', 'reroll', 'gate', 'combat_flow', 'other',
];

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

export function generateStrategy() {
  const rewardMultipliers = {};
  for (const key of REWARD_KEYS) {
    rewardMultipliers[key] = randRange(0.5, 1.5);
  }
  const actionPreferences = {};
  for (const key of ACTION_PREF_KEYS) {
    actionPreferences[key] = randRange(-0.5, 0.5);
  }
  return {
    rewardMultipliers,
    actionPreferences,
    epsilon: randRange(0.05, 0.20),
  };
}

// ── Affiliation Detection ────────────────────────────────────────────────────

export function getAgentAffiliation(dcList) {
  const dcEffects = getDcEffects();
  const counts = {};
  for (const name of dcList) {
    if (name.startsWith('[')) continue; // Skip attachments
    const eff = dcEffects[name];
    const aff = eff?.affiliation?.toLowerCase() || 'unknown';
    if (aff === 'any') continue;
    counts[aff] = (counts[aff] || 0) + 1;
  }
  const entries = Object.entries(counts);
  if (entries.length === 0) return 'Mixed';
  entries.sort((a, b) => b[1] - a[1]);
  if (entries.length > 1 && entries[0][1] === entries[1][1]) return 'Mixed';
  const top = entries[0][0];
  return top.charAt(0).toUpperCase() + top.slice(1);
}

// ── Name Generation ──────────────────────────────────────────────────────────

const ARCHETYPE_PREFIXES = {
  aggressive: ['Reckless', 'Vicious', 'Furious', 'Savage', 'Relentless', 'Brutal', 'Fierce'],
  defensive: ['Iron', 'Stalwart', 'Patient', 'Vigilant', 'Shielded', 'Steadfast', 'Resolute'],
  tactical: ['Cunning', 'Shrewd', 'Calculating', 'Methodical', 'Precise', 'Strategic', 'Keen'],
  balanced: ['Shadow', 'Phantom', 'Silent', 'Spectral', 'Twilight', 'Storm', 'Eclipse'],
};

const FACTION_SUFFIXES = {
  Imperial: ['Inquisitor', 'Executor', 'Moff', 'Sentinel', 'Enforcer', 'Operative', 'Warden'],
  Rebel: ['Pathfinder', 'Liberator', 'Vanguard', 'Phoenix', 'Spectre', 'Corsair', 'Ranger'],
  Mercenary: ['Marauder', 'Fang', 'Reaver', 'Syndicate', 'Outlaw', 'Broker', 'Predator'],
  Mixed: ['Rogue', 'Nomad', 'Drifter', 'Freelancer', 'Mercenary', 'Vagabond', 'Wildcard'],
};

function classifyArchetype(strategy) {
  const m = strategy.rewardMultipliers;
  const p = strategy.actionPreferences;
  const aggScore = (m.dist || 1) + (p.attack_close || 0) + (p.attack_ranged || 0);
  const defScore = (m.hp || 1) + (p.move_away || 0) + (p.pass || 0);
  const tacScore = (m.vp || 1) + (p.ability || 0);

  if (aggScore > defScore && aggScore > tacScore) return 'aggressive';
  if (defScore > aggScore && defScore > tacScore) return 'defensive';
  if (tacScore > aggScore && tacScore > defScore) return 'tactical';
  return 'balanced';
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function generateAgentName(strategy, affiliation, existingNames = []) {
  const archetype = classifyArchetype(strategy);
  const prefixes = ARCHETYPE_PREFIXES[archetype];
  const suffixKey = FACTION_SUFFIXES[affiliation] ? affiliation : 'Mixed';
  const suffixes = FACTION_SUFFIXES[suffixKey];

  // Try up to 20 times to find a unique name
  for (let i = 0; i < 20; i++) {
    const name = `${pick(prefixes)} ${pick(suffixes)}`;
    if (!existingNames.includes(name)) return name;
  }
  // Fallback with number
  const base = `${pick(prefixes)} ${pick(FACTION_SUFFIXES[suffixKey])}`;
  return `${base} ${Math.floor(Math.random() * 99) + 1}`;
}

// ── Agent Creation ───────────────────────────────────────────────────────────

export function createAgentFromDeck(id, deck, generation, gameNum, existingNames = []) {
  const strategy = generateStrategy();
  const affiliation = getAgentAffiliation(deck.dcList);
  const name = generateAgentName(strategy, affiliation, existingNames);

  return {
    id,
    name,
    affiliation,
    elo: 1500,
    generation,
    createdAtGame: gameNum,
    parentIds: [],
    strategy,
    army: {
      deckName: deck.name,
      dcList: [...deck.dcList],
      ccList: [...deck.ccList],
    },
    stats: { games: 0, wins: 0, losses: 0, winStreak: 0, bestElo: 1500 },
    eloHistory: [{ game: gameNum, elo: 1500 }],
  };
}

export function initializePopulation(size, testDecks) {
  const agents = {};
  const existingNames = [];

  for (let i = 0; i < size; i++) {
    const deck = testDecks[i % testDecks.length];
    const id = `agent_${String(i + 1).padStart(3, '0')}`;
    const agent = createAgentFromDeck(id, deck, 1, 0, existingNames);
    agents[id] = agent;
    existingNames.push(agent.name);
  }

  return agents;
}

// ── Mutation ─────────────────────────────────────────────────────────────────

export function mutateStrategy(strategy, rate = 0.3, strength = 0.2) {
  const result = JSON.parse(JSON.stringify(strategy));

  for (const key of REWARD_KEYS) {
    if (Math.random() < rate) {
      result.rewardMultipliers[key] *= 1 + randRange(-strength, strength);
      result.rewardMultipliers[key] = Math.max(0.1, Math.min(3.0, result.rewardMultipliers[key]));
    }
  }

  for (const key of ACTION_PREF_KEYS) {
    if (Math.random() < rate) {
      result.actionPreferences[key] += randRange(-strength, strength);
      result.actionPreferences[key] = Math.max(-2.0, Math.min(2.0, result.actionPreferences[key]));
    }
  }

  if (Math.random() < rate) {
    result.epsilon += randRange(-0.03, 0.03);
    result.epsilon = Math.max(0.03, Math.min(0.30, result.epsilon));
  }

  return result;
}

export function mutateArmy(army) {
  const dcEffects = getDcEffects();
  let ccEffectsData;
  try {
    ccEffectsData = getCcEffectsData();
  } catch { ccEffectsData = null; }

  const result = {
    deckName: army.deckName + ' (mutated)',
    dcList: [...army.dcList],
    ccList: [...army.ccList],
  };

  // Try DC swap
  const nonAttachmentDcs = result.dcList
    .map((name, idx) => ({ name, idx }))
    .filter(({ name }) => !name.startsWith('['));

  if (nonAttachmentDcs.length > 0) {
    const target = pick(nonAttachmentDcs);
    const targetEff = dcEffects[target.name];
    const targetCost = targetEff?.cost;

    if (targetCost != null && targetCost > 0) {
      // Find same-cost alternatives from any affiliation
      const alternatives = Object.entries(dcEffects)
        .filter(([name, eff]) =>
          name !== target.name &&
          !name.startsWith('[') &&
          eff.cost != null &&
          eff.cost > 0 &&
          Math.abs(eff.cost - targetCost) <= 1 &&
          !result.dcList.includes(name) // No duplicates (unless not unique)
        )
        .map(([name]) => name);

      if (alternatives.length > 0) {
        const replacement = pick(alternatives);
        const replacementCost = dcEffects[replacement].cost;

        if (replacementCost === targetCost) {
          // Exact swap
          result.dcList[target.idx] = replacement;
        }
        // Skip ±1 swaps for simplicity — keep army valid
      }
    }
  }

  // Try CC swap
  if (result.ccList.length > 0 && ccEffectsData?.cards) {
    const ccIdx = Math.floor(Math.random() * result.ccList.length);
    const oldCc = result.ccList[ccIdx];
    const oldEff = ccEffectsData.cards[oldCc];
    const oldCost = oldEff?.cost ?? 1;

    const alternatives = Object.entries(ccEffectsData.cards)
      .filter(([name, eff]) =>
        name !== oldCc &&
        (eff.cost ?? 1) === oldCost
      )
      .map(([name]) => name);

    if (alternatives.length > 0) {
      result.ccList[ccIdx] = pick(alternatives);
    }
  }

  return result;
}

export function mutateAgent(parent, newId, generation, gameNum, existingNames = []) {
  const strategy = mutateStrategy(parent.strategy);
  const army = mutateArmy(parent.army);
  const affiliation = getAgentAffiliation(army.dcList);
  const name = generateAgentName(strategy, affiliation, existingNames);

  return {
    id: newId,
    name,
    affiliation,
    elo: 1500,
    generation,
    createdAtGame: gameNum,
    parentIds: [parent.id],
    strategy,
    army,
    stats: { games: 0, wins: 0, losses: 0, winStreak: 0, bestElo: 1500 },
    eloHistory: [{ game: gameNum, elo: 1500 }],
  };
}

export function crossoverAgents(parent1, parent2, newId, generation, gameNum, existingNames = []) {
  // Mix strategies: 50/50 from each parent
  const strategy = JSON.parse(JSON.stringify(parent1.strategy));

  for (const key of REWARD_KEYS) {
    if (Math.random() < 0.5) {
      strategy.rewardMultipliers[key] = parent2.strategy.rewardMultipliers[key];
    }
  }
  for (const key of ACTION_PREF_KEYS) {
    if (Math.random() < 0.5) {
      strategy.actionPreferences[key] = parent2.strategy.actionPreferences[key] ?? 0;
    }
  }
  if (Math.random() < 0.5) {
    strategy.epsilon = parent2.strategy.epsilon;
  }

  // Use parent1's army
  const army = {
    deckName: `${parent1.army.deckName} × ${parent2.army.deckName}`,
    dcList: [...parent1.army.dcList],
    ccList: [...parent1.army.ccList],
  };

  const affiliation = getAgentAffiliation(army.dcList);
  const name = generateAgentName(strategy, affiliation, existingNames);

  return {
    id: newId,
    name,
    affiliation,
    elo: 1500,
    generation,
    createdAtGame: gameNum,
    parentIds: [parent1.id, parent2.id],
    strategy,
    army,
    stats: { games: 0, wins: 0, losses: 0, winStreak: 0, bestElo: 1500 },
    eloHistory: [{ game: gameNum, elo: 1500 }],
  };
}

// ── Evolution ────────────────────────────────────────────────────────────────

let nextAgentNum = 100;

export function evolve(arenaData, testDecks) {
  const agents = arenaData.agents;
  const sorted = Object.values(agents).sort((a, b) => b.elo - a.elo);
  const generation = arenaData.meta.totalGenerations + 1;
  const gameNum = arenaData.meta.totalGames;
  const existingNames = sorted.map(a => a.name);

  const { cullCount } = arenaData.meta.settings;

  // Cull bottom agents
  const culled = sorted.slice(-cullCount);
  const culledIds = culled.map(a => a.id);
  for (const id of culledIds) {
    delete agents[id];
  }

  // Breed replacements
  const bred = [];
  const top5 = sorted.slice(0, Math.min(5, sorted.length));
  const top10 = sorted.slice(0, Math.min(10, sorted.length));

  // 2x mutations from top-5
  for (let i = 0; i < 2; i++) {
    const parent = pick(top5);
    const newId = `agent_${String(++nextAgentNum).padStart(3, '0')}`;
    const child = mutateAgent(parent, newId, generation, gameNum, existingNames);
    agents[newId] = child;
    bred.push({ id: newId, name: child.name, parentIds: child.parentIds });
    existingNames.push(child.name);
  }

  // 1x crossover from top-10
  if (top10.length >= 2) {
    const p1 = pick(top10);
    let p2 = pick(top10);
    let tries = 0;
    while (p2.id === p1.id && tries < 10) { p2 = pick(top10); tries++; }
    const newId = `agent_${String(++nextAgentNum).padStart(3, '0')}`;
    const child = crossoverAgents(p1, p2, newId, generation, gameNum, existingNames);
    agents[newId] = child;
    bred.push({ id: newId, name: child.name, parentIds: child.parentIds });
    existingNames.push(child.name);
  }

  // 1x fresh random
  const freshDeck = pick(testDecks);
  const freshId = `agent_${String(++nextAgentNum).padStart(3, '0')}`;
  const fresh = createAgentFromDeck(freshId, freshDeck, generation, gameNum, existingNames);
  agents[freshId] = fresh;
  bred.push({ id: freshId, name: fresh.name, parentIds: [] });

  // Mutate #1 in-place (small perturbation)
  if (sorted.length > 0) {
    const champion = agents[sorted[0].id];
    if (champion) {
      champion.strategy = mutateStrategy(champion.strategy, 0.15, 0.1);
    }
  }

  arenaData.meta.totalGenerations = generation;
  arenaData.evolutionLog.push({
    generation,
    game: gameNum,
    culled: culled.map(a => ({ id: a.id, name: a.name, elo: Math.round(a.elo) })),
    bred,
  });
}
