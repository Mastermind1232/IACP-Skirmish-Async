/**
 * Unique-figure CC registry + Mara Jade Fast Learner picker eligibility.
 *
 * Source of truth: data/unique-figure-ccs.json (confirmed by alexanbv 2026-05-10).
 *
 * Used by handleCcConfirmPlay to offer a Mara/named-figure picker when BOTH
 * the named figure AND Mara Jade are in army AND Fast Learner is unused this
 * round. The picker is the only place the player can voluntarily route a CC
 * play through Mara to consume her once-per-round Fast Learner ability when
 * the named figure is also alive.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ADAPTIVE_SKILLS_ABILITY_ID } from './adaptive-skills-helpers.js';
import { getDcEffects } from '../data-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_PATH = join(__dirname, '..', '..', 'data', 'unique-figure-ccs.json');

let _registry = null;
function _loadRegistry() {
  if (_registry) return _registry;
  const raw = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  _registry = raw.cards || {};
  return _registry;
}

/**
 * Returns the registry entry for a CC, or null if it's not a unique-figure CC.
 * Entry shape: { figure?: string, figures?: string[], excludeFromFastLearner?: boolean }
 */
export function getUniqueFigureCcEntry(cardName) {
  if (!cardName) return null;
  const reg = _loadRegistry();
  return reg[cardName] || null;
}

/** All named figures for a CC as an array (single or multi). */
export function getUniqueFiguresForCc(cardName) {
  const entry = getUniqueFigureCcEntry(cardName);
  if (!entry) return [];
  if (entry.figures) return [...entry.figures];
  if (entry.figure) return [entry.figure];
  return [];
}

/** True when the CC cannot be played via Mara Fast Learner. */
export function isCcExcludedFromFastLearner(cardName) {
  return !!getUniqueFigureCcEntry(cardName)?.excludeFromFastLearner;
}

function _dcDisplay(dc) {
  return typeof dc === 'object' ? (dc.displayName || dc.dcName) : dc;
}
function _dcName(dc) {
  return typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
}
function _dcBase(name) {
  return String(name || '')
    .replace(/\s*\[(?:DG|Group) \d+\]$/i, '')
    .replace(/\s*\((?:Elite|Regular)\)\s*$/i, '')
    .trim();
}

/**
 * Determines whether to prompt a Fast Learner picker for this CC play.
 *
 * Returns { shouldPrompt, namedFigures, maraDc }:
 *   - shouldPrompt: true when both the named figure AND Mara are in the
 *     player's army, Fast Learner is unused this round, and the CC is not
 *     excluded (Arcing Shot, YWNDM).
 *   - namedFigures: array of {dcName, displayName} for matching named DCs
 *     (may have >1 entry when CC permits multiple, e.g. Static Pulse).
 *   - maraDc: {dcName, displayName} or null.
 */
export function getFastLearnerPickerEligibility(game, playerNum, cardName) {
  const entry = getUniqueFigureCcEntry(cardName);
  if (!entry) return { shouldPrompt: false, namedFigures: [], maraDc: null };
  if (entry.excludeFromFastLearner) return { shouldPrompt: false, namedFigures: [], maraDc: null };

  const dcList = (playerNum === 1 ? game.p1DcList : game.p2DcList) || [];
  const dcEffects = getDcEffects() || {};

  let maraDc = null;
  const figureNames = (entry.figures || [entry.figure]).map(s => String(s || '').toLowerCase());
  const namedFigures = [];

  for (const dc of dcList) {
    const dcName = _dcName(dc);
    if (!dcName) continue;
    const eff = dcEffects[dcName] || dcEffects[_dcBase(dcName)];
    const sIds = eff?.specialAbilityIds || [];
    if (sIds.includes(ADAPTIVE_SKILLS_ABILITY_ID)) {
      maraDc = { dcName, displayName: _dcDisplay(dc) };
      continue;
    }
    const base = _dcBase(dcName).toLowerCase();
    const disp = String(_dcDisplay(dc) || '').toLowerCase();
    if (figureNames.some(n => base.includes(n) || n.includes(base) || disp.includes(n) || n.includes(disp))) {
      namedFigures.push({ dcName, displayName: _dcDisplay(dc) });
    }
  }

  if (!maraDc || namedFigures.length === 0) return { shouldPrompt: false, namedFigures, maraDc };

  // Board-presence gate (alexanbv 2026-06-21): only prompt when BOTH a named
  // figure AND Mara are actually ON THE BOARD (alive). A defeated named figure
  // is still in the army dcList, but must not offer "play as <named>"; if only
  // Mara is alive she plays it via Fast Learner (the legality path handles that
  // substitution with no prompt), and if only the named figure is alive it
  // plays normally.
  const liveDcBases = new Set(
    Object.entries(game.figurePositions?.[playerNum] || {})
      .filter(([, pos]) => pos)
      .map(([fk]) => _dcBase(String(fk).replace(/-\d+-\d+$/, '')).toLowerCase()),
  );
  const onBoard = (dcName) => {
    const b = _dcBase(dcName).toLowerCase();
    return liveDcBases.has(b) || [...liveDcBases].some((l) => l.includes(b) || b.includes(l));
  };
  const namedOnBoard = namedFigures.filter((f) => onBoard(f.dcName));
  const maraOnBoard = onBoard(maraDc.dcName);
  if (!maraOnBoard || namedOnBoard.length === 0) return { shouldPrompt: false, namedFigures: namedOnBoard, maraDc };

  const flUsed = !!game.roundFigureAbilityUsed?.[`${maraDc.dcName}_fast_learner`];
  if (flUsed) return { shouldPrompt: false, namedFigures: namedOnBoard, maraDc };

  return { shouldPrompt: true, namedFigures: namedOnBoard, maraDc };
}
