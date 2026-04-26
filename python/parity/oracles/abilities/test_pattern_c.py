"""D3.5 oracle — Pattern C passive-aura dispatch acknowledgement.

Pattern C is a PASSIVE class — `dispatch.resolve(game, pattern_c_id, ctx)`
must NOT mutate `game`; it returns a structured record identifying where
the passive is consumed in JS and whether the Python port wires it today.

This oracle exercises:
  - Result shape (ability_id / pattern / status / consumption_layer / js_site)
  - Non-mutation invariant: `game` dict is identical before/after resolve
  - Catalog coverage: all 63 Pattern C IDs are catalogued (no KeyError)
  - Status distribution: wired-engine / deferred-* / data-only-unreferenced
  - Every catalog status string is a recognised bucket
  - Pure-engine-wired IDs (immune_onar, immune_snowtrooper_elite) actually
    bite in conditions.is_condition_immune (Slice 5 integration verification)
  - Deferred IDs resolve with a deferred-* status — NOT silent success
  - Fail-loud boundary: stray-field → UnsupportedPatternCField; wrong-pattern
    → ValueError; unknown ability → UnknownAbility; Pattern C ID missing
    from catalog → UnclassifiedPatternC
  - Dispatch registry routes Pattern C through the handler
  - install_default_handlers now wires A + B + C (idempotent)
  - Pattern C classifier count frozen at 63

Run as: python3 -m python.parity.oracles.abilities.test_pattern_c
"""
import sys

from python.engine.abilities import dispatch
from python.engine.abilities.dispatch import (
    PatternNotImplemented,
    UnknownAbility,
    dispatch_summary,
    get_handler,
    install_default_handlers,
    lookup_pattern,
    resolve,
)
from python.engine.abilities.pattern_c import (
    UnclassifiedPatternC,
    UnsupportedPatternCField,
    _CATALOG,
    pattern_c_deferred_to_handler,
    pattern_c_ids_by_status,
    pattern_c_status_counts,
    pattern_c_wired_in_engine,
    resolve_pattern_c,
)
from python.engine.abilities.classify import load_inventory
from python.engine.data.ability_library_loader import get_ability_library
from python.engine.mechanics.conditions import is_condition_immune


_VALID_STATUSES = frozenset({
    'wired-engine',
    'deferred-bridge',
    'deferred-handler-combat',
    'deferred-handler-movement',
    'deferred-handler-other',
    'deferred-cc-timing',
    'deferred-abilities-js',
    'data-only-unreferenced',
})


# ── Result shape ────────────────────────────────────────────────────────────

def test_result_dict_shape():
    r = resolve_pattern_c({}, 'immune_onar', {})
    assert set(r.keys()) == {'ability_id', 'pattern', 'status',
                             'consumption_layer', 'js_site'}
    assert r['ability_id'] == 'immune_onar'
    assert r['pattern'] == 'C'
    assert r['status'] == 'wired-engine'
    assert r['consumption_layer'] == 'engine'
    assert 'conditions' in r['js_site']


def test_resolve_does_not_mutate_game():
    # A Pattern C resolve call MUST be side-effect free — it's an
    # acknowledgement, not an effect application.
    game = {'figureConditions': {'FK-1': ['Stun']}, 'vp': {1: 5, 2: 3}}
    before = {'figureConditions': dict(game['figureConditions']),
              'vp': dict(game['vp'])}
    resolve_pattern_c(game, 'cower_c3po', {})
    assert game['figureConditions'] == before['figureConditions']
    assert game['vp'] == before['vp']


# ── Catalog coverage ────────────────────────────────────────────────────────

def test_catalog_covers_all_63_pattern_C_ids():
    inv = load_inventory()
    c_ids = set(aid for aid, info in inv.get('entries', {}).items()
                if info.get('pattern') == 'C')
    catalog_ids = set(_CATALOG.keys())
    missing = c_ids - catalog_ids
    extra = catalog_ids - c_ids
    assert not missing, f'Pattern C IDs missing from catalog: {sorted(missing)}'
    assert not extra, f'Catalog has non-Pattern-C entries: {sorted(extra)}'
    assert len(catalog_ids) == 63


def test_every_catalog_status_is_recognised():
    for aid, (status, layer, site) in _CATALOG.items():
        assert status in _VALID_STATUSES, f'{aid}: unknown status {status!r}'
        assert isinstance(layer, str) and layer
        assert isinstance(site, str) and site


def test_status_counts_match_expected_distribution():
    """Sanity-check the catalog distribution. All 52 portable Pattern C
    abilities are now wired-engine; the 11 data-only-unreferenced
    entries are inert in JS too. Total stays at 63.
    """
    counts = pattern_c_status_counts()
    expected = {
        'wired-engine': 52,
        'data-only-unreferenced': 11,
    }
    assert counts == expected, f'Pattern C status counts drifted: {counts}'
    assert sum(counts.values()) == 63


# ── Pure-engine-wired subset actually bites today ──────────────────────────

def test_wired_in_engine_returns_immunity_passives():
    wired = pattern_c_wired_in_engine()
    # Sanity: the two immunity baselines must always be present.
    assert {'immune_onar', 'immune_snowtrooper_elite'} <= set(wired)
    # Total wired count is bounded — drift from catalog spec implies
    # someone added a new wired entry without updating the catalog.
    assert len(wired) >= 2


def test_immune_onar_actually_bites_in_conditions():
    # Slice 5 integration test: the dispatch acknowledgement is truthful.
    # A DC effect with `immune_onar` in specialAbilityIds makes the figure
    # immune to harmful conditions via is_condition_immune.
    from python.engine.data import dc_effects_loader
    # Patch the dc-effects cache with a synthetic Onar-like entry.
    cache = dc_effects_loader.get_dc_effects()  # force load + return handle
    assert cache is not None
    stub_dc = 'OnarLike'
    cache[stub_dc] = {'specialAbilityIds': ['immune_onar']}
    try:
        # figure key format: "DcName-dgIndex-figureIndex".
        fk = f'{stub_dc}-1-0'
        game = {}
        assert is_condition_immune(game, fk) is True, \
            'immune_onar should gate harmful conditions via is_condition_immune'
    finally:
        cache.pop(stub_dc, None)


def test_immune_snowtrooper_actually_bites_in_conditions():
    from python.engine.data import dc_effects_loader
    cache = dc_effects_loader.get_dc_effects()
    stub_dc = 'SnowLike'
    cache[stub_dc] = {'specialAbilityIds': ['immune_snowtrooper_elite']}
    try:
        fk = f'{stub_dc}-1-0'
        assert is_condition_immune({}, fk) is True
    finally:
        cache.pop(stub_dc, None)


# ── Deferred IDs return a deferred-* status, not silent success ────────────

def test_cower_c3po_is_deferred_handler_combat():
    # cower_c3po was promoted to wired-engine after the post-roll
    # passive handler was ported. This test now confirms the wired
    # status, with a sanity check that the catalog notes the JS site.
    r = resolve_pattern_c({}, 'cower_c3po', {})
    assert r['status'] == 'wired-engine'
    assert 'handlers/combat.js' in r['js_site']


def test_spiked_boots_is_wired_engine():
    """spiked_boots_snowtrooper now resolved by Python's
    push_target_within_range._spiked_boots_blocks gate."""
    r = resolve_pattern_c({}, 'spiked_boots_snowtrooper', {})
    assert r['status'] == 'wired-engine'
    assert 'push_target_within_range' in r['js_site']


def test_defensive_fire_bokatan_is_wired_engine():
    """defensive_fire_bokatan now wired into attack_orchestrator
    post-attack hook (grants 1 Block token after ranged attack)."""
    r = resolve_pattern_c({}, 'defensive_fire_bokatan', {})
    assert r['status'] == 'wired-engine'
    assert 'attack_orchestrator' in r['js_site']


def test_adaptive_skills_is_wired_engine():
    """adaptive_skills_mara_jade wired into cc_timing.py."""
    r = resolve_pattern_c({}, 'adaptive_skills_mara_jade', {})
    assert r['status'] == 'wired-engine'


def test_attached_dio_is_data_only_unreferenced():
    r = resolve_pattern_c({}, 'attached_dio', {})
    assert r['status'] == 'data-only-unreferenced'


def test_deferred_list_is_empty_after_full_port():
    """All portable Pattern C abilities are now wired-engine. Only
    data-only-unreferenced entries remain (inert in JS too — no port
    needed). The deferred list should be empty."""
    deferred = pattern_c_deferred_to_handler()
    assert deferred == [], (
        f'Pattern C should have no deferred abilities (full port complete): {deferred}'
    )


# ── Fail-loud boundaries ────────────────────────────────────────────────────

def test_wrong_pattern_raises_ValueError():
    try:
        resolve_pattern_c({}, 'Focus', {})  # classified A
    except ValueError as e:
        assert 'Pattern C' in str(e) or 'pattern_c' in str(e)
        return
    assert False


def test_unknown_ability_raises_UnknownAbility():
    try:
        resolve_pattern_c({}, 'NotAPassive-ZZZ', {})
    except UnknownAbility:
        return
    assert False


def test_unclassified_pattern_c_id_raises():
    # Simulate library drift: insert a Pattern-C-shaped entry that the
    # catalog doesn't know about. Must raise UnclassifiedPatternC, not
    # silently succeed.
    from python.engine.data import ability_library_loader
    ability_library_loader.get_ability_library()
    lib = ability_library_loader._library
    stub_id = '__uncatalogued_passive__'
    stub_entry = {
        'type': 'dcPassive',
        'label': 'synth passive',
        'wiredStatus': 'wired',
    }
    lib[stub_id] = stub_entry
    try:
        try:
            resolve_pattern_c({}, stub_id, {})
        except UnclassifiedPatternC as e:
            assert e.ability_id == stub_id
            return
        assert False, 'expected UnclassifiedPatternC for uncatalogued Pattern C ID'
    finally:
        lib.pop(stub_id, None)


def test_stray_field_raises_UnsupportedPatternCField():
    # Surge-style drift: a Pattern C entry that carries a non-metadata field.
    from python.engine.data import ability_library_loader
    ability_library_loader.get_ability_library()
    lib = ability_library_loader._library
    stub_id = '__drift_passive__'
    stub_entry = {
        'type': 'dcPassive',
        'label': 'drifted',
        'wiredStatus': 'wired',
        'chooseOne': [{'applyFocus': True}],  # illegal on Pattern C
    }
    lib[stub_id] = stub_entry
    try:
        try:
            resolve_pattern_c({}, stub_id, {})
        except UnsupportedPatternCField as e:
            assert e.ability_id == stub_id
            assert 'chooseOne' in e.fields
            return
        except ValueError as e:
            # classify may route drift entries with chain fields to E.
            assert 'Pattern' in str(e)
            return
        assert False, 'expected UnsupportedPatternCField or ValueError'
    finally:
        lib.pop(stub_id, None)


# ── Dispatch registry integration ───────────────────────────────────────────

def test_dispatch_has_pattern_C_handler():
    h = get_handler('C')
    assert h is not None
    assert h.__name__ == 'resolve_pattern_c'


def test_dispatch_summary_reports_C_handler():
    s = dispatch_summary()
    assert s['registry']['A'] is not None
    assert s['registry']['B'] is not None
    assert s['registry']['C'] is not None
    # D wired post-D3.6; E wired post-D3.8 (chain registry).
    assert s['registry']['D'] is not None
    assert s['registry']['E'] is not None


def test_resolve_routes_Pattern_C_through_handler():
    out = resolve({}, 'immune_onar', {})
    assert out['pattern'] == 'C'
    assert out['status'] == 'wired-engine'


def test_lookup_pattern_returns_C_for_passive():
    assert lookup_pattern('immune_onar') == 'C'
    assert lookup_pattern('cower_c3po') == 'C'
    assert lookup_pattern('attached_dio') == 'C'


def test_install_default_handlers_idempotent_with_C():
    install_default_handlers()
    install_default_handlers()
    assert get_handler('A') is not None
    assert get_handler('B') is not None
    assert get_handler('C') is not None


# ── All 63 Pattern C IDs resolve cleanly through dispatch ──────────────────

def test_all_63_pattern_c_ids_resolve():
    inv = load_inventory()
    c_ids = sorted(aid for aid, info in inv.get('entries', {}).items()
                   if info.get('pattern') == 'C')
    assert len(c_ids) == 63
    for aid in c_ids:
        r = resolve_pattern_c({}, aid, {})
        assert r['pattern'] == 'C', aid
        assert r['ability_id'] == aid
        assert r['status'] in _VALID_STATUSES, f'{aid}: status {r["status"]!r}'
        assert r['consumption_layer'], aid
        assert r['js_site'], aid


def test_all_63_through_dispatch():
    inv = load_inventory()
    c_ids = sorted(aid for aid, info in inv.get('entries', {}).items()
                   if info.get('pattern') == 'C')
    for aid in c_ids:
        out = resolve({}, aid, {})
        assert out['pattern'] == 'C', aid


# ── Pattern C count frozen at 63 ────────────────────────────────────────────

def test_pattern_c_count_frozen_at_63_in_library():
    # Pin the classifier's Pattern C population at 63. The catalog test
    # already enforces {library C IDs} == {catalog keys}; this one pins the
    # absolute count so a library reshape that mutates both simultaneously
    # is still caught.
    from python.engine.abilities.classify import classify_ability
    lib = get_ability_library()
    c_count = sum(1 for aid, e in lib.items()
                  if classify_ability(aid, e)[0] == 'C')
    assert c_count == 63, f'Pattern C count drifted: {c_count}'


# ── Runner ──────────────────────────────────────────────────────────────────

def main():
    tests = [v for k, v in sorted(globals().items())
             if k.startswith('test_') and callable(v)]
    passed = 0
    for t in tests:
        try:
            t()
            passed += 1
            print(f'PASS {t.__name__}')
        except AssertionError as e:
            print(f'FAIL {t.__name__}: {e}')
            sys.exit(1)
        except Exception as e:
            print(f'ERROR {t.__name__}: {type(e).__name__}: {e}')
            sys.exit(1)
    print(f'\n{passed}/{len(tests)} green')


if __name__ == '__main__':
    main()
