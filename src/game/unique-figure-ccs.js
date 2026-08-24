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
import { getDcEffects, getCcEffect } from '../data-loader.js';
import { dcNameFromFigureKey } from './dc-helpers.js';
import { aNewHopeAvailable, figureMatchesCcRestriction, hasDarksaberImperial, _getProgrammingOverrideKeywords } from './cc-timing.js';

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

/** On-board live figureKeys for a player (positions truthy). */
function _liveFigureKeys(game, playerNum) {
  const positions = game?.figurePositions?.[playerNum] || {};
  return Object.keys(positions).filter((fk) => positions[fk]);
}

/** Is the DC of this figureKey a FORCE USER (per dc-effects keywords)? */
function _figureIsForceUser(figureKey) {
  const dcEffects = getDcEffects() || {};
  const dn = dcNameFromFigureKey(figureKey);
  const eff = dcEffects[dn] || dcEffects[_dcBase(dn)];
  return (eff?.keywords || []).map((k) => String(k).toLowerCase()).includes('force user');
}

/** Is the DC of this figureKey the Adaptive Skills (Fast Learner / Mara) figure? */
function _figureIsFastLearner(figureKey) {
  const dcEffects = getDcEffects() || {};
  const dn = dcNameFromFigureKey(figureKey);
  const eff = dcEffects[dn] || dcEffects[_dcBase(dn)];
  return (eff?.specialAbilityIds || []).includes(ADAPTIVE_SKILLS_ABILITY_ID);
}

/** True iff the figure's DC matches one of the CC's named figures. */
function _figureIsNamed(figureKey, namedLower) {
  if (namedLower.length === 0) return false;
  const dn = _dcBase(dcNameFromFigureKey(figureKey)).toLowerCase();
  return namedLower.some((n) => dn === n || dn.includes(n) || n.includes(dn));
}

/**
 * Generalized unique-figure-CC player options (alexanbv 2026-06-21).
 *
 * Returns ONE entry per ELIGIBLE ON-BOARD figure who may play this unique-figure
 * CC, de-duped by figureKey using the CHEAPEST qualification. The range always
 * anchors on whichever figure is chosen.
 *
 * Qualification kinds + consumption (precedence: cheapest wins):
 *   - 'named'            (consume 'none')           — the CC's registry figure, alive on board.
 *   - 'there_is_another'(consume 'none')           — any FORCE USER on board, when
 *                          game.thereIsAnotherActive[pn] AND the CC's restriction
 *                          names a FORCE USER figure.
 *   - 'fast_learner'    (consume 'fast_learner')   — Mara Jade on board, FL unused this round.
 *   - 'a_new_hope'      (consume 'a_new_hope')      — any army figure on board, when an
 *                          un-depleted [A New Hope] is in play.
 *
 * Precedence note: a figure qualifying both via There is Another (Force User) AND
 * A New Hope keeps 'there_is_another' (no deplete) — TIA takes precedence.
 *
 * @returns {Array<{ figureKey, dcName, displayName, kind, consume }>}
 */
export function getUniqueCcPlayerOptions(game, playerNum, cardName) {
  const entry = getUniqueFigureCcEntry(cardName);
  if (!entry) return [];

  const liveKeys = _liveFigureKeys(game, playerNum);
  if (liveKeys.length === 0) return [];

  const namedLower = (entry.figures || [entry.figure])
    .map((s) => String(s || '').toLowerCase())
    .filter(Boolean);

  // Does the CC's restriction name a FORCE USER figure? Mirrors the
  // isCcPlayLegalByRestriction There-is-Another gate: the registry named figure(s)
  // for a unique-figure CC are by construction the restriction's named figure.
  const restrictionNamesForceUser = (() => {
    if (namedLower.length === 0) return false;
    const dcEffects = getDcEffects() || {};
    for (const [dcName, eff] of Object.entries(dcEffects)) {
      if (!(eff?.keywords || []).map((k) => String(k).toLowerCase()).includes('force user')) continue;
      const base = String(dcName).replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim().toLowerCase();
      if (!base) continue;
      if (namedLower.some((n) => base === n || base.includes(n) || n.includes(base))) return true;
    }
    return false;
  })();

  const tiaActive = !!game.thereIsAnotherActive?.[playerNum] && restrictionNamesForceUser && !entry.excludeFromFastLearner;
  const anhActive = aNewHopeAvailable(game, playerNum) && !entry.excludeFromFastLearner;

  // Mara's FL availability (excluded CCs cannot route through Fast Learner).
  const flBlocked = !!entry.excludeFromFastLearner;

  const options = [];
  const seen = new Set();
  const add = (figureKey, kind, consume) => {
    if (seen.has(figureKey)) return;
    seen.add(figureKey);
    options.push({
      figureKey,
      dcName: dcNameFromFigureKey(figureKey),
      displayName: dcNameFromFigureKey(figureKey),
      kind,
      consume,
    });
  };

  for (const fk of liveKeys) {
    // Precedence (cheapest qualification per figure):
    //   named (none) > fast_learner (Mara/FL) > there_is_another (none) > a_new_hope (deplete).
    //
    // NOTE on Mara + There is Another: Mara Jade is herself a FORCE USER, so when
    // There is Another is active she ALSO satisfies the TIA path (which costs
    // nothing). Per the designer's worked example (army = Luke + Leia + Mara, TIA
    // played, Son of Skywalker), Mara is classified as the FAST LEARNER path and
    // CONSUMES FL — her dedicated enabler — rather than free-riding TIA. So Fast
    // Learner is checked BEFORE There is Another. For any OTHER Force User, TIA
    // applies first (free). A New Hope is always the last resort (deplete).
    if (_figureIsNamed(fk, namedLower)) {
      add(fk, 'named', 'none');
      continue;
    }
    if (!flBlocked && _figureIsFastLearner(fk)) {
      const flUsed = !!game.roundFigureAbilityUsed?.[`${dcNameFromFigureKey(fk)}_fast_learner`];
      if (!flUsed) { add(fk, 'fast_learner', 'fast_learner'); continue; }
      // FL already used this round: Mara may still play it for free via TIA if
      // she's a Force User and TIA is active — fall through to the TIA check.
    }
    if (tiaActive && _figureIsForceUser(fk)) {
      add(fk, 'there_is_another', 'none');
      continue;
    }
    if (anhActive) {
      add(fk, 'a_new_hope', 'a_new_hope');
      continue;
    }
  }

  return options;
}

/**
 * KEYWORD-anchored CCs (alexanbv 2026-06-21): Command cards whose EFFECT range
 * anchors on the playing figure ("within N spaces of you") but whose play
 * restriction (playableBy) is a KEYWORD (e.g. LEADER), NOT a named figure. For
 * these, "you" is whichever restriction-satisfying figure the player chooses to
 * play the card from — so when 2+ such figures are on the board the player must
 * be asked WHICH one is the anchor (per the designer rule: any ability that
 * could affect/select among multiple figures must ask which one / in what order).
 *
 * Unique-figure CCs are handled by getUniqueCcPlayerOptions; this set is only the
 * keyword-restricted, anchor-dependent cards. Appended as the multi-figure-
 * selection audit surfaces more.
 */
const KEYWORD_ANCHORED_CCS = new Set(['Just Business']);

/**
 * Returns one option per ON-BOARD figure that satisfies a keyword-anchored CC's
 * play restriction, so the unified picker can ask WHICH figure is "you" (the
 * range anchor). Empty array when the card is not keyword-anchored, is a
 * unique-figure CC (handled elsewhere), has no playableBy, or no figure matches.
 *
 * @returns {Array<{ figureKey, dcName, displayName, kind:'anchor', consume:'none' }>}
 */
export function getKeywordAnchorPlayerOptions(game, playerNum, cardName) {
  if (!cardName || !KEYWORD_ANCHORED_CCS.has(cardName)) return [];
  // Unique-figure CCs anchor via getUniqueCcPlayerOptions, not here.
  if (getUniqueFigureCcEntry(cardName)) return [];
  const playableBy = getCcEffect(cardName)?.playableBy;
  if (!playableBy) return [];
  const options = [];
  for (const fk of _liveFigureKeys(game, playerNum)) {
    const dn = dcNameFromFigureKey(fk);
    if (figureMatchesCcRestriction(game, dn, dn, playableBy)) {
      options.push({ figureKey: fk, dcName: dn, displayName: dn, kind: 'anchor', consume: 'none' });
    }
  }
  return options;
}

// ── Universal "who is playing this Command card" declaration ────────────────
//
// alexanbv 2026-08-24:
//   "For any CC that is played by a figure, the first thing that must be
//    determined is which figure is playing it. Any CC with a restriction box is
//    a CC played by a figure. Futhermore, the player playing the CC must declare
//    which figure is playing the CC before opponent decides whether or not to
//    negate or comms."
//   "Only figures who can legally play the card should be offered. This step
//    should check legality and any changes to legality including Mara, a new
//    hope, taron, dark saber, companion, small, large, etc etc"
//
// Before this, only unique-figure cards (getUniqueCcPlayerOptions) and exactly
// one keyword card (Just Business) ever determined a figure. The other 92
// hand-played restricted cards determined nothing, so their effects fell back on
// "whoever is activating" — which is how Opportunistic came to hand its movement
// points to a non-SCUM figure, and to fail outright when played as the reaction
// it is, on the opponent's turn.

/** True iff this figure's Deployment card is a companion (e.g. The Child). */
export function figureIsCompanion(figureKey) {
  const eff = (getDcEffects() || {})[dcNameFromFigureKey(figureKey)] || {};
  return eff.companion === true;
}

/** True iff this player's army contains Taron Malicos (Fallen Master). */
function _armyHasFallenMaster(game, playerNum) {
  const dcEffects = getDcEffects() || {};
  const list = (playerNum === 1 ? game?.p1DcList : game?.p2DcList) || [];
  for (const dc of list) {
    const dcName = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
    if (!dcName) continue;
    if ((dcEffects[dcName]?.specialAbilityIds || []).includes('fallen_master_malicos')) return true;
  }
  return false;
}

/**
 * Does Fallen Master waive the faction symbol for THIS figure?
 *
 * alexanbv: "Taron only allows non-companion Force Users to ignore the
 * restriction", and "Tarons ability just lets non-companion force user ignore
 * faction symbol in the restriction box, other restrictions still apply."
 *
 * The companion exclusion is the reason this has to be a per-figure test: The
 * Child is a FORCE USER companion, and an army-wide check has no figure to
 * exclude.
 */
export function fallenMasterWaivesFactionFor(game, playerNum, figureKey) {
  if (!_armyHasFallenMaster(game, playerNum)) return false;
  if (figureIsCompanion(figureKey)) return false;
  return _figureIsForceUser(figureKey);
}

/**
 * Every figure that may LEGALLY play this Command card right now, in the order
 * the player should be offered them.
 *
 * Native qualification is delegated to figureMatchesCcRestriction, which already
 * understands name / faction / trait / size / unique / non-massive. The two
 * abilities that change whether a figure NATIVELY satisfies a FACTION symbol are
 * folded in as its darksaber flag, which is exactly what that flag models:
 *   The Darksaber  - a FORCE USER holding it may use IMPERIAL cards
 *   Fallen Master  - a non-companion FORCE USER ignores the faction symbol
 *
 * The three enablers that let a figure play a card it does not qualify for at
 * all are name-restriction devices, so they only apply to unique-figure cards
 * and are delegated to getUniqueCcPlayerOptions to keep one copy of that
 * precedence (Fast Learner before There is Another before A New Hope).
 *
 * @returns {Array<{figureKey, dcName, displayName, kind, consume}>}
 */
export function getCcPlayerOptions(game, playerNum, cardName, opts = {}) {
  // Defaults wired to the real helpers so callers cannot forget them and
  // silently lose Programming Override's granted keywords or the Darksaber.
  const {
    getExtraKeywords = _getProgrammingOverrideKeywords,
    hasDarksaberFor = hasDarksaberImperial,
  } = opts;
  const playableBy = String(getCcEffect(cardName)?.playableBy || '').trim();
  const liveKeys = _liveFigureKeys(game, playerNum);
  if (liveKeys.length === 0) return [];

  // No restriction box: the card is not played "by" a restricted figure, so
  // there is nothing to declare and nothing to offer.
  if (!playableBy || playableBy.toLowerCase() === 'any figure') return [];

  const out = [];
  const seen = new Set();
  const add = (figureKey, kind, consume) => {
    if (seen.has(figureKey)) return;
    seen.add(figureKey);
    out.push({
      figureKey,
      dcName: dcNameFromFigureKey(figureKey),
      displayName: dcNameFromFigureKey(figureKey),
      kind,
      consume,
    });
  };

  for (const fk of liveKeys) {
    const dcName = dcNameFromFigureKey(fk);
    const extraKeywords = getExtraKeywords ? getExtraKeywords(game, playerNum, dcName) : null;
    const darksaber = hasDarksaberFor ? !!hasDarksaberFor(game, playerNum, dcName) : false;
    const factionWaived = darksaber || fallenMasterWaivesFactionFor(game, playerNum, fk);
    if (figureMatchesCcRestriction(game, dcName, dcName, playableBy, {
      hasDarksaber: factionWaived, extraKeywords,
    })) {
      add(fk, 'restriction', 'none');
    }
  }

  // Enablers (name-restriction devices) only reach unique-figure cards.
  for (const o of getUniqueCcPlayerOptions(game, playerNum, cardName)) {
    add(o.figureKey, o.kind, o.consume);
  }
  return out;
}
