"""D3.5 — Pattern C passive-aura dispatch acknowledgement.

Pattern C abilities are passive auras. They do NOT actively "resolve" when
`dispatch.resolve(game, pattern_c_id, ctx)` is called — they're read/
consumed by other code paths at effect-relevant moments (condition
application, attack declaration, movement/push, CC timing, round start,
win-condition eval, etc.). This handler therefore does NOT mutate `game`;
it returns a structured acknowledgement that identifies where the passive
bites in the JS source and whether the Python port currently honours it.

JS audit (2026-04-20) of where the 63 Pattern C IDs are consumed:
  Pure-engine (`src/game/`) read sites — the only places the Python engine
  layer could mirror without drifting into handler-layer territory:
    - `src/game/conditions.js:35` — `immune_onar`, `immune_snowtrooper_elite`
    - `src/game/cc-timing.js`     — `adaptive_skills_mara_jade`,
                                     `devout_chirrut`, `fallen_master_malicos`
    - `src/game/abilities.js`     — `spiked_boots_snowtrooper` (push guard)

  Bridge layer (`src/engine/`) — handler-adjacent code that populates
  combat/movement state before calling the pure engine. 9 IDs.

  Handler layer (`src/handlers/`) — Discord-UI plumbing that reads passives
  to populate combat `bonus*` fields, movement queues, or gate interactions.
  43 IDs.

  Data-only — declared in library with `wiredStatus: wired` or no wiring
  status at all, but the ID never appears as a string literal in JS source
  (may be consumed via action-type keys, generic attachment handling, or
  is simply unwired in BOTH engines today). 11 IDs.

**Python pure-engine Pattern C read-side today (Slices 1-5):**
  - `conditions.is_condition_immune` — covers `immune_onar`,
    `immune_snowtrooper_elite`, and the `youWillNotDenyMeActive`
    Fifth Brother flag (not a Pattern C ID, but the semantic partner).

  That is the ENTIRE pure-engine surface that matches JS today. Every
  other Pattern C passive lives in layers that have not been ported yet.
  `compute_combat_result` and `movement_cache.compute_movement_cache` do
  NOT read Pattern C IDs in JS — the handler populates `combat.bonus*`
  fields and movement profile flags BEFORE calling the engine, so the
  engine stays passive-agnostic by design. Porting Pattern C into the
  Python pure engine would be a design divergence from JS and is NOT what
  this slice does.

**What D3.5 actually lands:**
  - `resolve_pattern_c` — dispatch acknowledgement handler. Classifies each
    ID by consumption-layer and status. Does NOT mutate `game`.
  - Status buckets: `wired-engine` (2), `deferred-bridge` (9),
    `deferred-handler-combat` (27), `deferred-handler-movement` (3),
    `deferred-handler-other` (11), `deferred-cc-timing` (3),
    `deferred-abilities-js` (1 — spiked_boots via push handler),
    `data-only-unreferenced` (7).
  - Registration in `dispatch.install_default_handlers` so Pattern C IDs
    stop raising `PatternNotImplemented`.
  - Unknown Pattern C ID (classifier says C but not in catalog) raises
    `UnclassifiedPatternC` — library drift guard.
  - Stray-field entries raise `UnsupportedPatternCField`.
  - Wrong-pattern calls raise `ValueError`.
  - Unknown ability raises `UnknownAbility`.

Result shape:
    {
      'ability_id': '...',
      'pattern': 'C',
      'status': 'wired-engine' | 'deferred-*' | 'data-only-unreferenced',
      'consumption_layer': 'engine' | 'bridge' | 'handler-combat' |
                           'handler-movement' | 'handler-other' |
                           'cc-timing' | 'abilities-js-push' | None,
      'js_site': '<file:symbol>'  # pointer for future porters
    }
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

from python.engine.abilities.classify import classify_ability
from python.engine.data.ability_library_loader import get_ability


class UnsupportedPatternCField(RuntimeError):
    """A Pattern C entry carries a field outside the passive allowlist."""

    def __init__(self, ability_id: str, fields: List[str]):
        super().__init__(
            f'ability {ability_id!r}: Pattern C entry has non-allowlist fields {fields}'
        )
        self.ability_id = ability_id
        self.fields = fields


class UnclassifiedPatternC(RuntimeError):
    """A Pattern C ability is in the library but not in the consumption
    catalog — library drift. Fail loudly so audits can't silently skip."""

    def __init__(self, ability_id: str):
        super().__init__(
            f'Pattern C ability {ability_id!r} is not in _CATALOG. Library '
            f'drift or missed audit — add an entry in pattern_c.py with its '
            f'consumption layer/site.'
        )
        self.ability_id = ability_id


# Tight allowlist — Pattern C entries carry pure metadata. Post-bda83d8
# `extendsAttachmentEligibility` was added for Bo-Katan's Last Wielder of the
# Darksaber (enables Darksaber attachment to a non-Sabine/Maul army DC). It
# is a static array of DC name strings (no trigger, no chain), pure metadata
# read by src/game/validation.js attachment-eligibility enforcement. Added to
# the allowlist to keep the classifier in sync with the library shape.
_PATTERN_C_FIELDS = frozenset({
    'type', 'label', 'wiredStatus', 'description', 'category', 'trigger',
    'extendsAttachmentEligibility',
})


# ── Consumption catalog ─────────────────────────────────────────────────────
# Keyed by ability_id → (status, layer, site).
#
# Status buckets:
#   wired-engine            — Ported to Python pure engine (bites today).
#   deferred-bridge         — Consumed in src/engine/; needs D4 bridge port.
#   deferred-handler-combat — Consumed in handlers/combat.js; D4.
#   deferred-handler-movement — handlers/movement.js; D4.
#   deferred-handler-other  — handlers/{setup, round, phase-gate, …}; D4.
#   deferred-cc-timing      — game/cc-timing.js; D4 CC layer.
#   deferred-abilities-js   — game/abilities.js push/smash handler; D3.6+.
#   data-only-unreferenced  — library-declared only, no live JS consumption.

_CATALOG: Dict[str, Tuple[str, str, str]] = {
    # Engine-layer — wired in Python today via conditions.is_condition_immune
    'immune_onar': (
        'wired-engine', 'engine',
        'src/game/conditions.js:35 → py conditions.is_condition_immune',
    ),
    'immune_snowtrooper_elite': (
        'wired-engine', 'engine',
        'src/game/conditions.js:35 → py conditions.is_condition_immune',
    ),

    # Bridge-layer (src/engine/)
    'adapt_blaise': (
        'deferred-bridge', 'bridge',
        'src/engine/activation-setup.js (start-of-activation hook)',
    ),
    'dead_precise_kotun': (
        'wired-engine', 'engine',
        'src/handlers/combat.js → py mechanics/passive_combat.py:_handle_dead_precise_kotun',
    ),
    'fast_learner_mara_jade': (
        'deferred-bridge', 'bridge',
        'src/engine/activation-setup.js',
    ),
    'hunt_dissent_kallus': (
        'deferred-bridge', 'bridge',
        'src/engine/win-conditions.js + activation-setup.js',
    ),
    'scrap_battalion_ugnaught_elite': (
        'deferred-bridge', 'bridge',
        'src/engine/activation-setup.js',
    ),
    'scrap_battalion_ugnaught_reg': (
        'deferred-bridge', 'bridge',
        'src/engine/activation-setup.js',
    ),
    'trust_goes_both_ways_jyn': (
        'deferred-bridge', 'bridge',
        'src/engine/activation-setup.js + handlers/activation.js',
    ),
    'defensive_fire_bokatan': (
        'deferred-bridge', 'bridge',
        'src/engine/combat-bridge.js:2680',
    ),
    'this_is_the_way_armorer': (
        'deferred-bridge', 'bridge',
        'src/engine/win-conditions.js',
    ),
    'insignificant_dio': (
        'deferred-bridge', 'bridge',
        'src/engine/available-actions.js + handlers/dc-play-area.js',
    ),
    'overload_saboteur': (
        'deferred-bridge', 'bridge',
        'src/engine/available-actions.js + combat.js + combat-reactions.js',
    ),

    # Handler-combat — the handler populates combat.bonus* / combat pipeline
    'adv_targeting_computer_dark_trooper': (
        'wired-engine', 'engine',
        'src/handlers/combat.js → py mechanics/passive_combat.py:_handle_adv_targeting_computer (auto-Focus only; reroll-may deferred)',
    ),
    'agile_jet_trooper_elite': (
        'wired-engine', 'engine',
        'src/handlers/combat.js → py mechanics/passive_combat.py:_handle_agile_jet_trooper (greedy block→evade)',
    ),
    'agile_jet_trooper_reg': (
        'wired-engine', 'engine',
        'src/handlers/combat.js → py mechanics/passive_combat.py:_handle_agile_jet_trooper (greedy block→evade)',
    ),
    'aim_rebel_trooper_elite': (
        'wired-engine', 'engine',
        'src/handlers/combat.js → py mechanics/passive_combat.py:_handle_aim_rebel_trooper_elite',
    ),
    'aim_rebel_trooper_reg': (
        'wired-engine', 'engine',
        'src/handlers/combat.js → py mechanics/passive_combat.py:_handle_aim_rebel_trooper_reg',
    ),
    'awkward_atst': (
        'wired-engine', 'engine',
        'src/handlers/combat.js:2073 → py mcts/actions.py (legal_actions skip ATTACK_TARGET when distance==1)',
    ),
    'camouflage_mak': (
        'deferred-handler-combat', 'handler-combat',
        'src/handlers/combat.js',
    ),
    'camouflage_scout_trooper': (
        'deferred-handler-combat', 'handler-combat',
        'src/handlers/combat.js',
    ),
    'coordinated_hunt_purge_commander': (
        'deferred-handler-combat', 'handler-combat',
        'src/handlers/combat.js',
    ),
    'cower_c3po': (
        'wired-engine', 'engine',
        'src/handlers/combat.js:2702 → py mechanics/passive_combat.py:_handle_cower (greedy reroll worst defense die when adj friendly)',
    ),
    'cower_imperial_officer_reg': (
        'wired-engine', 'engine',
        'src/handlers/combat.js:2702 → py mechanics/passive_combat.py:_handle_cower',
    ),
    'gambit_lando': (
        'deferred-handler-combat', 'handler-combat',
        'src/handlers/combat.js',
    ),
    'improvised_cover_verena': (
        'wired-engine', 'engine',
        'src/handlers/combat.js:2131 → py mechanics/passive_combat.py:_handle_improvised_cover_verena (figure-adjacency clause; object/crate adjacency deferred until crates port)',
    ),
    'krayt_dragon_fury_tress': (
        'deferred-handler-combat', 'handler-combat',
        'src/handlers/combat.js',
    ),
    'light_it_up_rebel_pathfinder': (
        'deferred-handler-combat', 'handler-combat',
        'src/handlers/combat.js',
    ),
    'lucky_r2d2': (
        'wired-engine', 'engine',
        'src/handlers/combat.js:4370 → py mechanics/passive_combat.py:_handle_lucky_r2d2 (post-roll Dodge → recover 2 HP)',
    ),
    'mon_cala_sf_loku': (
        'deferred-handler-combat', 'handler-combat',
        'src/handlers/combat.js',
    ),
    'personal_combat_shield_gar_saxon': (
        'wired-engine', 'engine',
        'src/handlers/combat.js:5253-5364 → py mechanics/attack_orchestrator.py Phase 4a (Block-token spend → +1 Evade)',
    ),
    'pulse_cannon_iden': (
        'deferred-handler-combat', 'handler-combat',
        'src/handlers/combat.js',
    ),
    'shared_calculations_zuckuss': (
        'deferred-handler-combat', 'handler-combat',
        'src/handlers/combat.js',
    ),
    'spray_fire_heavy_stormtrooper': (
        'deferred-handler-combat', 'handler-combat',
        'src/handlers/combat.js',
    ),
    'squad_training_shoretrooper_elite': (
        'wired-engine', 'engine',
        'src/handlers/combat.js → py mechanics/passive_combat.py:_handle_squad_training (greedy reroll worst attack die)',
    ),
    'squad_training_shoretrooper_reg': (
        'wired-engine', 'engine',
        'src/handlers/combat.js → py mechanics/passive_combat.py:_handle_squad_training (greedy reroll worst attack die)',
    ),
    'squad_training_stormtrooper_elite': (
        'wired-engine', 'engine',
        'src/handlers/combat.js → py mechanics/passive_combat.py:_handle_squad_training (greedy reroll worst attack die)',
    ),
    'squad_training_stormtrooper_reg': (
        'wired-engine', 'engine',
        'src/handlers/combat.js → py mechanics/passive_combat.py:_handle_squad_training (greedy reroll worst attack die)',
    ),
    'take_cover_jawa_elite': (
        'wired-engine', 'engine',
        'src/handlers/combat.js → py mechanics/passive_combat.py:_handle_take_cover_defender',
    ),
    'take_cover_jawa_reg': (
        'wired-engine', 'engine',
        'src/handlers/combat.js → py mechanics/passive_combat.py:_handle_take_cover_defender',
    ),
    'targeting_computer_atst': (
        'wired-engine', 'engine',
        'src/handlers/combat.js → py mechanics/passive_combat.py:_handle_targeting_computer_atst (greedy reroll worst attack die)',
    ),
    'tripod_eweb': (
        'deferred-handler-combat', 'handler-combat',
        'src/handlers/combat.js + handlers/dc-play-area.js',
    ),
    'vague_and_unconvincing_k2s0': (
        'deferred-handler-combat', 'handler-combat',
        'src/handlers/combat.js',
    ),
    'versatile_weaponry_hk_elite': (
        'deferred-handler-combat', 'handler-combat',
        'src/handlers/combat.js',
    ),

    # Handler-movement
    'spiked_boots_snowtrooper': (
        'deferred-abilities-js', 'abilities-js-push',
        'src/game/abilities.js:320/416/1930 + handlers/movement.js:1054 '
        '(push/rush MASSIVE-pusher guard)',
    ),

    # Handler-other (setup, round, phase-gate, dc-play-area, cc-hand)
    'imperial_loadout_purge_trooper': (
        'deferred-handler-other', 'handler-other',
        'src/handlers/setup.js + phase-gate.js + activation-setup.js',
    ),
    'shape_clawdite_elite': (
        'deferred-handler-other', 'handler-other',
        'src/handlers/setup.js + round.js + phase-gate.js + activation-setup.js',
    ),
    'shape_clawdite_reg': (
        'deferred-handler-other', 'handler-other',
        'src/handlers/setup.js + round.js + phase-gate.js + activation-setup.js',
    ),
    'non_combatant_c3po': (
        'wired-engine', 'engine',
        'src/handlers/dc-play-area.js → py mcts/actions.py (legal_actions skips ATTACK_TARGET entirely for C-3PO)',
    ),

    # CC-timing layer (game/cc-timing.js)
    'adaptive_skills_mara_jade': (
        'deferred-cc-timing', 'cc-timing',
        'src/game/cc-timing.js + handlers/cc-hand.js (CC reroll gate)',
    ),
    'devout_chirrut': (
        'deferred-cc-timing', 'cc-timing',
        'src/game/cc-timing.js (CC timing window)',
    ),
    'fallen_master_malicos': (
        'deferred-cc-timing', 'cc-timing',
        'src/game/cc-timing.js',
    ),

    # Data-only — library-declared, no live JS consumption as string literal.
    # Some are consumed via action-type keys, attachment plumbing, or simply
    # unwired in BOTH engines today. These are flagged for the D4 port so the
    # same ID-name-literal check style can be applied where needed.
    'cover_fire_ct1701': (
        'data-only-unreferenced', 'unknown',
        'library-declared; consumed via cover_fire_* action-types in engine/combat-bridge.js',
    ),
    'dirty_dealing_bib': (
        'data-only-unreferenced', 'unknown',
        'library-declared; no JS string-literal consumption found',
    ),
    'dubious_counterparts_aphra': (
        'data-only-unreferenced', 'unknown',
        'library-declared; no JS string-literal consumption found',
    ),
    'modular_heavy_stormtrooper': (
        'data-only-unreferenced', 'unknown',
        'library-declared; no JS string-literal consumption found',
    ),
    'scavenged_stock_jawa_elite': (
        'data-only-unreferenced', 'unknown',
        'library-declared; no JS string-literal consumption found',
    ),
    'shady_contacts_saska': (
        'data-only-unreferenced', 'unknown',
        'library-declared; no JS string-literal consumption found',
    ),
    'attached_dio': (
        'data-only-unreferenced', 'unknown',
        'library-declared (dcPassive with trigger: friendly-movement); '
        'attachment plumbing in engine/setup-bridge.js handles host binding',
    ),
    'dead_weight_pardon_bokatan': (
        'data-only-unreferenced', 'unknown',
        'library-declared; no JS string-literal consumption found',
    ),
    'droid_kit_iden': (
        'data-only-unreferenced', 'unknown',
        'library-declared; no JS string-literal consumption found',
    ),
    'last_wielder_darksaber_bokatan': (
        'data-only-unreferenced', 'unknown',
        'library-declared; no JS string-literal consumption found',
    ),
    'personal_combat_shield_bokatan': (
        'data-only-unreferenced', 'unknown',
        'library-declared; gar_saxon variant is the wired sibling',
    ),
}


# ── Resolution entry point ──────────────────────────────────────────────────

def resolve_pattern_c(game: Dict[str, Any],
                      ability_id: str,
                      ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Acknowledge a Pattern C passive-aura ability. Does NOT mutate game.

    Raises on unknown ability / wrong-pattern / stray field / un-catalogued
    Pattern C ID. Returns a record identifying consumption layer + JS site.
    """
    entry = get_ability(ability_id)
    if entry is None:
        from python.engine.abilities.dispatch import UnknownAbility
        raise UnknownAbility(ability_id)

    pattern, _reason = classify_ability(ability_id, entry)
    if pattern != 'C':
        raise ValueError(
            f'resolve_pattern_c called on ability {ability_id!r} (pattern {pattern}); '
            f'route via dispatch.resolve()'
        )

    stray = sorted(f for f in entry.keys() if f not in _PATTERN_C_FIELDS)
    if stray:
        raise UnsupportedPatternCField(ability_id, stray)

    if ability_id not in _CATALOG:
        raise UnclassifiedPatternC(ability_id)

    status, layer, js_site = _CATALOG[ability_id]
    return {
        'ability_id': ability_id,
        'pattern': 'C',
        'status': status,
        'consumption_layer': layer,
        'js_site': js_site,
    }


# ── Introspection helpers ───────────────────────────────────────────────────

def pattern_c_ids_by_status(status: str) -> List[str]:
    """Return all Pattern C ability IDs currently catalogued with `status`."""
    return sorted(aid for aid, (s, _, _) in _CATALOG.items() if s == status)


def pattern_c_status_counts() -> Dict[str, int]:
    """Return status → count over the Pattern C catalog."""
    counts: Dict[str, int] = {}
    for aid, (status, _, _) in _CATALOG.items():
        counts[status] = counts.get(status, 0) + 1
    return counts


def pattern_c_wired_in_engine() -> List[str]:
    """Pattern C IDs whose passive bites in Python pure engine today."""
    return pattern_c_ids_by_status('wired-engine')


def pattern_c_deferred_to_handler() -> List[str]:
    """Pattern C IDs whose passive is acknowledged but still needs D4+ port."""
    return sorted(
        aid for aid, (status, _, _) in _CATALOG.items()
        if status.startswith('deferred-')
    )
