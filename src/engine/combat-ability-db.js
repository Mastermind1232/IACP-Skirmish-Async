/**
 * Per-mission, per-player ability database.
 *
 * Per alexanbv 2026-06-15: "The combat pipeline should be ability agnostic, and
 * at each point in the pipeline, should query for what relevant abilities may be
 * used. You may wish to build a smaller database at the start of each mission for
 * each player, containing only the abilities on the DCs and CCs of each player.
 * Then, you should only look up abilities on those cards."
 *
 * Source of truth: docs/combat-spec.csv — the per-ability spec sheet (one row
 * per ability/part: its timing window, attack side, resolution, targeting,
 * surge flag, pipelines, etc.). We parse it once (module-cached), then for each
 * player filter to ONLY the abilities on the cards they actually brought and
 * index those by timing window. The pipeline then scans a small per-player set
 * instead of the whole catalogue, and never names a specific ability.
 *
 * Note on REACTION cards: this DB scopes a player's OWN abilities. It must NOT
 * be used to decide whether to prompt an opponent for a reaction CC (Negation,
 * Comm Disruption, Parting Blow, Dirty Trick, …) — those are always offered
 * regardless of hand/deck contents so the opponent cannot infer what is held.
 * That prompting lives in the CC-play / reaction subroutine, not here.
 *
 * This module is PURE and additive: it reads the spec + the player's card lists
 * and returns indexed data. It mutates no game state and is memoized in memory
 * (never serialized), so it is reconstructible on reload.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDcList, getDcAttachments, getSquad } from '../game/player-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, '../../docs/combat-spec.csv');

export const SPEC_COLUMNS = [
  'card', 'card_type', 'ability', 'part', 'timing', 'attack_side', 'resolution',
  'affects_self', 'affects_others', 'conditional', 'limit', 'surge_option',
  'effect', 'pipelines', 'notes',
];

/** Quoted-CSV-aware single-line parser (handles doubled "" quotes and commas in fields). */
function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(cur); cur = '';
    } else cur += ch;
  }
  fields.push(cur);
  return fields;
}

let _specByCard = null; // Map<cardNameLower, row[]>

/**
 * Parse docs/combat-spec.csv into a Map keyed by lowercased card name → rows.
 * Cached after first call.
 * @returns {Map<string, object[]>}
 */
export function loadAbilitySpec() {
  if (_specByCard) return _specByCard;
  const map = new Map();
  let text;
  try {
    text = readFileSync(SPEC_PATH, 'utf8');
  } catch {
    _specByCard = map; // missing spec → empty DB (degrade gracefully)
    return map;
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  for (let i = 1; i < lines.length; i++) { // skip header
    const f = parseCsvLine(lines[i]);
    if (f.length !== SPEC_COLUMNS.length) continue;
    const row = {};
    SPEC_COLUMNS.forEach((c, idx) => { row[c] = f[idx]; });
    const key = row.card.toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  _specByCard = map;
  return map;
}

/** All spec rows (abilities) for a single card name. */
export function abilitiesForCard(cardName) {
  if (!cardName) return [];
  return loadAbilitySpec().get(String(cardName).toLowerCase()) || [];
}

/**
 * Build a per-player ability DB from an explicit list of card names.
 * @param {string[]} cardNames
 * @returns {{ byWindow: Object<string, object[]>, byCard: Object<string, object[]>, cards: string[], missing: string[] }}
 *   byWindow — abilities indexed by timing window; byCard — abilities per card;
 *   cards — card names that matched the spec; missing — names with no spec rows.
 */
export function buildPlayerAbilityDb(cardNames) {
  const byWindow = {};
  const byCard = {};
  const cards = [];
  const missing = [];
  for (const name of cardNames || []) {
    if (!name) continue;
    const rows = abilitiesForCard(name);
    if (!rows.length) { missing.push(name); continue; }
    byCard[name] = rows;
    cards.push(name);
    for (const row of rows) {
      const w = row.timing || 'None';
      (byWindow[w] = byWindow[w] || []).push(row);
    }
  }
  return { byWindow, byCard, cards, missing };
}

/**
 * Collect every card name a player brought: DCs + DC attachments/upgrades + CC deck.
 * Names are returned as-is so they match the spec's `card` column (DCs unbracketed,
 * upgrades/attachments bracketed like "[Black Market]", CCs by name).
 */
export function getPlayerCardNames(game, playerNum) {
  const names = new Set();
  for (const e of (getDcList(game, playerNum) || [])) {
    const n = e?.dcName || e;
    if (typeof n === 'string' && n) names.add(n);
  }
  const atts = getDcAttachments(game, playerNum) || {};
  for (const arr of Object.values(atts)) {
    for (const a of (arr || [])) {
      const n = a?.name || a?.cardName || a;
      if (typeof n === 'string' && n) names.add(n);
    }
  }
  for (const c of (getSquad(game, playerNum)?.ccList || [])) {
    const n = c?.name || c?.cardName || c;
    if (typeof n === 'string' && n) names.add(n);
  }
  return [...names];
}

const _dbCache = new Map(); // `${gameId}:${pn}:${signature}` → db

/**
 * Get (memoized) the per-player ability DB for the current mission. Rebuilt
 * automatically if the player's card set changes (signature-keyed) and on
 * reload (cache is in-memory only). Never persisted to game state.
 */
export function getPlayerAbilityDb(game, playerNum) {
  const cards = getPlayerCardNames(game, playerNum);
  const sig = cards.slice().sort().join('|');
  const key = `${game?.gameId}:${playerNum}:${sig}`;
  const hit = _dbCache.get(key);
  if (hit) return hit;
  const db = buildPlayerAbilityDb(cards);
  _dbCache.set(key, db);
  return db;
}

/**
 * Ability-agnostic query: the abilities on a player's cards that plug into a
 * given timing window. The combat pipeline calls this at each window instead of
 * referencing any specific ability.
 * @returns {object[]} spec rows (may be empty)
 */
export function playerAbilitiesForWindow(game, playerNum, window) {
  return getPlayerAbilityDb(game, playerNum).byWindow[window] || [];
}

/**
 * Bridge from the attack gate's 5 sub-windows (combat-timing-registry
 * TIMING_WINDOWS) to the spec's full attack-window vocabulary. The 'special'
 * sub-window (Rapid Recalibration / Zeb / Zillo) has its own bespoke handling
 * and no attack:* spec timing; surge abilities live at the spend-surges step
 * (spec timing 'spend_surges'), not in the gate.
 */
export const GATE_TO_SPEC_WINDOW = {
  on_declare: ['attack:on_declare'],
  rerolls: ['attack:rerolls'],
  mods: ['attack:modifiers'],
  after_resolve: ['attack:after_resolves'],
  special: [],
};

/**
 * Scoped, ability-agnostic query for a GATE window + side: the abilities on a
 * player's cards that plug into that attack sub-window for that side. This is
 * what the per-step gate builder calls so it only considers abilities the player
 * actually brought (per alexanbv 2026-06-15: "only look up abilities on those
 * cards").
 * @param {object} game
 * @param {number} playerNum
 * @param {('on_declare'|'rerolls'|'mods'|'after_resolve'|'special')} gateWindow
 * @param {('attacker'|'defender')} [side] - omit to include both sides
 * @returns {object[]} spec rows (may be empty)
 */
export function playerAbilitiesForGateWindow(game, playerNum, gateWindow, side) {
  const specWindows = GATE_TO_SPEC_WINDOW[gateWindow] || [];
  if (specWindows.length === 0) return [];
  const db = getPlayerAbilityDb(game, playerNum);
  const out = [];
  for (const w of specWindows) {
    for (const row of (db.byWindow[w] || [])) {
      if (!side || row.attack_side === side) out.push(row);
    }
  }
  return out;
}

/** Test hook: clear the in-memory caches (spec + per-player DBs). */
export function _resetAbilityDbCaches() {
  _specByCard = null;
  _dbCache.clear();
}
