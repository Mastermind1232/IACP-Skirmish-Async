"""D3.1 — pattern classifier for ability-library.json.

Takes each of the 685 ability entries and assigns a resolution pattern:

  A — stat-delta: applies a list of declarative deltas (condition, token grant,
      heal, MP/action/CC-draw bank) with no player choice prompt, no multi-step
      chain, no trigger reaction. Routed through `pattern_a.resolve`.

  B — surge: `type == 'surge'` — surge-slot ability consumed during attack
      resolution. Handled by `surge.parse_surge_effect` (Slice 4).

  C — passive aura: `type == 'dcPassive'` OR `type == 'dcSpecial'` with
      `category in ('passive','passive-auto')` AND no `trigger`. Always-on
      modifier read by combat/movement/etc. (no active resolution step).

  D — triggered event: `type == 'dcSpecial'` with a `trigger` set (reacts to
      combat-declare, move-start, figure-defeat, etc.). Routed through the
      trigger bus at D3.6 landing time.

  E — multi-step pending-state chain: `type == 'dcSpecial'` active special
      actions (no trigger, not passive) OR `type == 'ccEffect'` with any
      chain-shaped field (see `_CHAIN_FIELDS`). Each chain gets a dedicated
      resolver at D3.7-D3.27 landing time.

A pattern assignment is mandatory; every ability must land in exactly one of
A/B/C/D/E. If classification cannot decide, the classifier raises
`ClassificationFailure` — NO silent "unclassified" bucket.

Wiring integration note: the JS entries carry a `wiredStatus` field (~642/685
set). A value of "wired" means JS has a production code branch; "stub" means
the ability exists in the library but JS has no handler wired. The classifier
does NOT consult `wiredStatus` — an ability's *pattern* depends on its shape,
not its wiring state. A wired-in-JS Pattern-A ability still needs a Python
Pattern-A handler to be wired; a stub ability has the same pattern as a wired
one of the same shape.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from python.engine.data.ability_library_loader import get_ability_library

INVENTORY_PATH = Path(__file__).resolve().parent / '_ability_inventory.json'


class ClassificationFailure(RuntimeError):
    """Raised when an ability entry can't be placed in A/B/C/D/E."""


# ── Pattern A allowlist ─────────────────────────────────────────────────────
# Fields that are permissible on a Pattern A ability. An entry is ONLY classed
# Pattern A if every non-metadata field it carries is in this set. Expand this
# set deliberately — each new field here widens the Pattern A surface, and the
# shared handler at `pattern_a.resolve` must understand every field that lands
# here or it raises `UnsupportedPatternAField`.
_PATTERN_A_FIELDS = frozenset({
    # metadata
    'type', 'label', 'logMessage', 'wiredStatus', 'category', 'trigger',
    'oncePer', 'timing', 'informational', 'description',
    # bank (activation-scope effect accumulators)
    'mpBonus', 'mpBonusFromSpeed', 'freeMoveBonus', 'freeMoveEqualToSpeed',
    'extraActionBonus', 'actionBonus',
    # conditions
    'applyFocus', 'applyHide',
    'applyDefenseBonusBlock', 'applyDefenseBonusEvade',
    # tokens
    'powerTokenGain', 'evadeTokenGain',
    # heals / self-damage
    'recoverDamage', 'recoverSelf',
    'recoverOnHostileDefeat', 'recoverOnHostileDefeatRange',
    'strainCostToSelf',
    # CC hand
    'draw', 'drawIfTrait',
    # DC ready/exhaust
    'readyOwnDeploymentCard', 'readyAdjacentFriendlyDeploymentCard',
    # round-bank flags (set-and-forget on round scope)
    'roundDefenseBonusBlock', 'roundDefenseBonusEvade',
    'roundDefenseAccuracyPenalty',
    # next-attack modifiers (one-shot flags consumed by combat engine)
    'nextAttacksBonusHits', 'attackAccuracyBonus', 'attackBonusHits',
    'attackBonusDice', 'attackBonusDiceColor', 'attackSurgeBonus',
    'defenseBonusDice', 'defenseBonusDiceColor',
    'nextAttackBonusAccuracy', 'nextAttackBonusPierce',
    'interactBlockRange', 'controlBlockRange',
})

# Fields that FORCE an ability into Pattern E if present on a ccEffect,
# regardless of other fields. These markers encode chain/prompt/target-picker
# resolution that requires handler UI (Discord select menus, channel state).
_CHAIN_FIELDS = frozenset({
    # player-choice fields
    'chooseOne', 'chooseAdjacentHostileThen',
    'targetHostileFigure', 'targetFriendlyFigureAdjacent',
    'chooseFriendlyToFocus', 'chooseSpaceWithin2OfActivating',
    'choiceRange', 'choiceExcludeSelf',
    'choiceRequiresElite', 'choiceRequiresKeywords',
    'lookingForAFightChoice',
    'opponentDiscardFromHandChoice',
    # AoE / fixed-area targeting
    'fixedAreaEffect', 'fixedAreaRange', 'fixedAreaDamage', 'fixedAreaStrain',
    'fixedAreaConditions', 'fixedAreaTargetOnly', 'fixedAreaDiscardToken',
    # dice-based branching
    'rollOneDie', 'rollOneDieTarget', 'rollOneDieRange', 'rollOneDieNote',
    'rollOneDieSurgeCondition', 'rollOneDieSurgeSelfPowerToken',
    'rollOneDiePushSmall', 'rollOneDieTargetRange', 'rollOneDieRequiresLos',
    'rollOneDieMpCost', 'rollOneDieMaxTargets',
    # push / free-attack chains
    'pushTargetWithinRange', 'pushLandingEffect', 'postPushFreeAttack',
    'freeAttackBonus', 'freeAttackBonusCount', 'grantFreeAttackToTarget',
    'pushFriendlyWithin3Spaces',
    # attack overrides / multi-attack
    'overrideAttackDice', 'overrideAttackType', 'overrideAttackPierce',
    'overrideBonusAccuracy', 'attackOverrideOpts',
    'saberOrbitChain', 'multiFireDoubleAttack', 'focusFireDoubleAttack',
    'pummelTwoAttacksThisActivation',
    'activationDoubleSpecialAction', 'activationExtraActionThenStun',
    'partingBlowEffect', 'headbuttMove', 'headbuttDie',
    # placement / rubble / defeat mutations
    'placeDefeatedFigure', 'placesRubble', 'placeRubbleOnTargetAndAdjacent',
    'disablesFigure', 'cripplesFigure',
    # discard / deck manipulation
    'discardUpToNHarmful', 'discardHarmfulConditions',
    'discardHarmfulFromAdjacentFigures',
    'opponentDiscardDeckTop', 'opponentDiscardRandomFromHand',
    'discardRandomFromHand',
    'revealsOpponentDeckTop', 'revealsOpponentHand',
    'opponentHandRandomToDeckTop', 'stealsFromOpponentDiscard',
    'shuffleOneFromDiscardIntoDeck', 'clearOpponentDiscard',
    'shuffleHandIntoDeckThenDraw', 'searchDeckForCC',
    'returnDiscardToHand', 'discardFromDrawn',
    'negateCostZeroCc',
    # buffs/grants to other figures
    'grantMpToTarget', 'grantMpToFriendliesByKeyword',
    'grantMpToFriendliesWithin2',
    'grantHitTokensToActivating', 'distributeHitTokensEqualToRound',
    'focusFriendlyAdjacent', 'focusGainToAdjacentUpToN',
    'focusGainToUpToNFigures',
    'applyHideToFriendlyWithinRange',
    'applyBlockAndHideToIsolatedFriendlies',
    'applyStunToUpToNAdjacentHostiles', 'applySelfStunAfterAttack',
    'healFriendlyAdjacent', 'healAndClearConditionFriendlyAdjacent',
    'recoverDamageToAdjacent', 'recoverDamageToAdjacentIfTrait',
    'recoverDamageFromRound',
    # VP effects
    'celebrationVp', 'vpCondition', 'vpNoteIfAdjacentTerminal',
    'vpGainSelf', 'vpGainOpponent', 'autoDeductVp',
    'nextHostileDefeatVpBonus', 'nextDefeatedFriendlyVpReduction',
    'pickpocketVpByAccuracy', 'drawThenDiscardOneGainVp',
    'rebelGraffitiVp', 'elseGainVp',
    # next-activation reservations
    'nextActivationMpBonus', 'nextActivationFreeAttack',
    'firstActivationFigureName',
    # combat pool manipulation
    'defensePoolRemoveMax', 'defensePoolRemoveAll',
    'defensePoolRemoveOnlyWhenNotAttackerActivation',
    'attackPoolRemoveMax', 'attackPoolKeepMax',
    'attackPoolAddYellowUntilTotal',
    # state-flag installers ("setsXxx") — each begets a round-scoped subsystem
    'setsHarshEnvironment', 'setsHoldGround', 'setsTerminalControl',
    'setsTherIsNoTry', 'setsBounty', 'setsStillFaster', 'setsMandaAsteel',
    'setsToughLuck', 'setsUnlimitedPower', 'setsWindfall',
    'setsWreakVengeance', 'setsYouWillNotDenyMe',
    'signalJammer', 'opponentCannotPlayCCsThisRound',
    'noCommandDrawThisRound', 'mpCostToActivate',
    # combat-modifier flags (engine reads, but require pending-state wiring)
    'blockSurgeAbilities', 'mustSpendAll', 'mustTargetNonAdjacent',
    'requireRangedAttackType', 'requireHighestCostTarget',
    'requireNoLosAtActivationStart',
    'onlyIfSufferedDamageGte', 'conditionalFocusIfDamagedGte',
    'conditionalAdjacentLeaderPowerToken', 'conditionalExteriorPowerToken',
    'optionalPowerTokenOnConditionDiscard', 'powerTokenGainIfDamagedGte',
    'mpAfterAttack', 'mpCost', 'spendMpForBlockToken',
    'bonusDamagePerDefenseDie', 'bonusSurgePerDefenseDie',
    'ignoreDefenseResultsNotOnDice', 'defenderStrain',
    'defenderStrainPlusDiscardCopies', 'defenderRerollDiceMax',
    'forceDefenderRerollOne', 'doubleMatchingIconsOnReroll',
    'rerollOneAttackDie',
    'attackResultReplaceWithStun', 'attackBonusBlast', 'attackBonusPierce',
    'attackBonusSurgeAbilities', 'attackTargetSwap',
    'attackBonusHitsFromDefeatedFriendly', 'attackBonusHitsFromDefeatedMax',
    'nextAttackBonusSurgeAbilities',
    'selfDefeatsAfterAttack', 'endOfRoundSelfDamage',
    'selfStrainFromDiscardedCost', 'fixedSelfStrain',
    'maxDamageFromAttack',
    'exhaustOneDeploymentCard', 'readyActiveDc',
    'claimInitiative',
    'roundDefenderCannotBeTargetedUnlessWithinSpaces',
    'roundInTheShadowsPlayerNum', 'roundDefenderBonusBlockPerEvade',
    'roundDebuffNextHostileActivation', 'roundDroidExtraActionCostDamage',
    'roundAttackRerollDice', 'roundEfficientTravel',
    'defenderIgnorePierce', 'blastBonusToAdjacentVehiclesDroidHW',
    'damageTokenGainToGroup', 'vehicleSpeedBonusRound',
    'vanishImmunityUntilNextActivation',
    'defenseBonusDiceFromAttacker', 'defenseBonusDiceFromAttackerColor',
    'defenseBonusOnlyWhenNotAttackerActivation',
    'surgeDoublingActive', 'postActivationConditions',
    'postAttackAoeDamage', 'postAttackAoeRange', 'mutualExcludeAttackCc',
    'increaseArmyCostBy',
    # movement / pounce / rush chains
    'pounceRange', 'pounceNoAttack', 'hopOnPush',
    'rushPostMovePush', 'shoulderRushPostMove',
    'provokeNextActivation',
    'mobileMovement', 'arcingShotTargeting',
    'grantFreeAttackToTarget',
    'overrunThisActivation', 'missileSalvoStart',
    'flatDamageToFigureWithin', 'closeQuartersOverride',
    'trooperMpBonusRound', 'trooperRoundAttackHitBonus',
    'roundUtinniJawaBuffs',
    'applySelfCondition', 'selfCondition',
    'postActivationConditions',
    'nextAttacksBonusConditions',
    'drawCCIfAdjacentTerminal',
    'discardIfNotTrait',
    'whenDefeatHostileWithin3GainBlockTokens',
    'squadSwarmPlayerNum', 'sitTightPlayerNum',
    'roundSmugglersTricksPlayerNum',
    'strengthInNumbersPlayerNum',
    'vetInstinctsActiveThisActivation',
    'vpNoteIfAdjacentTerminal',
    'spotWeldCompanionPlace',
    'triangulateEffect', 'triangulateCountFriendlyDroids',
    'getsBehindMe',
    # per-card named effects — everything ending in "Effect" is a chain
})


def _is_chain_field(field: str) -> bool:
    """Fields whose mere presence forces E. Includes explicit markers + any
    field ending in 'Effect' (~100 named effects in the library)."""
    if field in _CHAIN_FIELDS:
        return True
    if field.endswith('Effect') and field != 'wiredStatus':
        return True
    return False


def classify_ability(ability_id: str, entry: Dict[str, Any]) -> Tuple[str, str]:
    """Return (pattern, reason) — pattern is one of 'A','B','C','D','E'.

    Reason is a short human tag explaining the decision, useful for audit /
    inventory readout. Raises `ClassificationFailure` if decision can't be
    made.
    """
    if not isinstance(entry, dict):
        raise ClassificationFailure(f'{ability_id}: non-dict entry')

    typ = entry.get('type')
    if not typ:
        raise ClassificationFailure(f'{ability_id}: missing type')

    # ── Pattern B: surge ────────────────────────────────────────────────────
    if typ == 'surge':
        return 'B', 'surge-type'

    # ── Pattern C: passive aura ─────────────────────────────────────────────
    if typ == 'dcPassive':
        return 'C', 'dcPassive-type'
    if typ == 'dcSpecial':
        category = entry.get('category')
        trigger = entry.get('trigger')
        if category in ('passive', 'passive-auto') and not trigger:
            return 'C', f'dcSpecial-passive(category={category})'
        # ── Pattern D: triggered dcSpecial ──────────────────────────────────
        if trigger:
            return 'D', f'dcSpecial-triggered(trigger={trigger})'
        # ── Pattern E: dcSpecial active special action ──────────────────────
        return 'E', 'dcSpecial-active-special-action'

    # ── ccEffect: A vs E decision ───────────────────────────────────────────
    if typ == 'ccEffect':
        fields = set(entry.keys())
        chain_hits = [f for f in fields if _is_chain_field(f)]
        if chain_hits:
            sample = ','.join(sorted(chain_hits)[:3])
            return 'E', f'ccEffect-chain({sample}{"+" if len(chain_hits) > 3 else ""})'
        # All non-metadata fields must be Pattern A allowlist members.
        stray = [f for f in fields if f not in _PATTERN_A_FIELDS]
        if stray:
            return 'E', f'ccEffect-stray-field({",".join(sorted(stray)[:3])})'
        return 'A', 'ccEffect-pure-delta'

    raise ClassificationFailure(f'{ability_id}: unknown type {typ!r}')


def build_inventory(library: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Classify every ability and return the inventory dict.

    Shape: {ability_id: {type, category, trigger, pattern, reason, fields}}.
    Also includes a 'counts' top-level summary.
    """
    if library is None:
        library = get_ability_library()

    entries: Dict[str, Any] = {}
    counts = {'A': 0, 'B': 0, 'C': 0, 'D': 0, 'E': 0}
    for ab_id, entry in library.items():
        pattern, reason = classify_ability(ab_id, entry)
        counts[pattern] += 1
        entries[ab_id] = {
            'pattern': pattern,
            'reason': reason,
            'type': entry.get('type'),
            'category': entry.get('category'),
            'trigger': entry.get('trigger'),
            'wiredStatus': entry.get('wiredStatus'),
            'fields': sorted(k for k in entry.keys() if k not in ('label', 'description', 'logMessage', 'wiredStatus', 'type')),
        }

    return {'counts': counts, 'total': len(library), 'entries': entries}


def write_inventory(path: Optional[Path] = None) -> Dict[str, Any]:
    """Regenerate `_ability_inventory.json` from the live library."""
    inv = build_inventory()
    target = path or INVENTORY_PATH
    with open(target, 'w') as f:
        json.dump(inv, f, indent=2, sort_keys=True)
    return inv


def load_inventory(path: Optional[Path] = None) -> Dict[str, Any]:
    """Load the persisted inventory (falling back to rebuild if missing)."""
    target = path or INVENTORY_PATH
    if not target.exists():
        return build_inventory()
    with open(target, 'r') as f:
        return json.load(f)


if __name__ == '__main__':
    inv = write_inventory()
    c = inv['counts']
    print(f'Wrote {INVENTORY_PATH}')
    print(f'  total: {inv["total"]}')
    for p in ('A', 'B', 'C', 'D', 'E'):
        print(f'  {p}: {c[p]}')
