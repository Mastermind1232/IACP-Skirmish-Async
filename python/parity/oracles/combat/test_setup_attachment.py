"""P2.14 verification: get_attachment_restriction parser.

Validates the major restriction-line cases. Long-tail edge syntax
(eligibility extenders, multi-clause conjunction) verified by
inspection / Phase 3 wiring.
"""
from python.engine.setup_attachment import get_attachment_restriction


def _effects_with(card_name, ability_text, **card_extras):
    return {
        card_name: {'abilityText': ability_text, **card_extras},
        # Common DCs for tests:
        'Han Solo': {
            'unique': True, 'cost': 12,
            'keywords': ['LEADER', 'SCOUNDREL', 'SMUGGLER'],
            'affiliation': 'Rebel', 'figures': 1,
        },
        'Vader': {
            'unique': True, 'cost': 16,
            'keywords': ['LEADER', 'JEDI'],
            'affiliation': 'Imperial', 'figures': 1,
        },
        'Stormtrooper': {
            'unique': False, 'cost': 6,
            'keywords': ['TROOPER', 'IMPERIAL'],
            'affiliation': 'Imperial', 'figures': 3,
        },
        'AT-ST': {
            'unique': False, 'cost': 14,
            'keywords': ['VEHICLE', 'MASSIVE'],
            'affiliation': 'Imperial', 'figures': 1,
        },
        'Heavy Stormtrooper': {
            'unique': False, 'cost': 7,
            'keywords': ['TROOPER', 'IMPERIAL', 'HEAVY WEAPON'],
            'affiliation': 'Imperial', 'figures': 2,
        },
    }


# ── No-restriction passthrough ──────────────────────────────────────────


def test_card_with_no_ability_text_returns_none():
    fx = {'No Restriction Card': {'abilityText': ''}}
    assert get_attachment_restriction('No Restriction Card', dc_effects=fx) is None


def test_card_without_ONLY_line_returns_none():
    fx = {'C': {'abilityText': 'Gain a Surge: Damage.'}}
    assert get_attachment_restriction('C', dc_effects=fx) is None


def test_unknown_card_returns_none():
    assert get_attachment_restriction('Mystery', dc_effects={}) is None


# ── UNIQUE FIGURE restriction ───────────────────────────────────────────


def test_unique_figure_only_allows_unique_dcs():
    fx = _effects_with('UPG', 'UNIQUE FIGURE ONLY')
    r = get_attachment_restriction('UPG', dc_effects=fx)
    assert r is not None
    assert r['filter']('Han Solo') is True
    assert r['filter']('Vader') is True
    assert r['filter']('Stormtrooper') is False


def test_unique_figure_with_cost_threshold():
    fx = _effects_with('UPG', 'UNIQUE FIGURE WITH FIGURE COST 14 OR MORE ONLY')
    r = get_attachment_restriction('UPG', dc_effects=fx)
    assert r['filter']('Vader') is True   # 16 ≥ 14
    assert r['filter']('Han Solo') is False  # 12 < 14
    assert r['filter']('Stormtrooper') is False  # not unique


# ── Keyword restrictions ────────────────────────────────────────────────


def test_leader_only_allows_leaders():
    fx = _effects_with('UPG', 'LEADER ONLY')
    r = get_attachment_restriction('UPG', dc_effects=fx)
    assert r['filter']('Han Solo') is True
    assert r['filter']('Vader') is True
    assert r['filter']('Stormtrooper') is False


def test_trooper_only_allows_troopers():
    fx = _effects_with('UPG', 'TROOPER ONLY')
    r = get_attachment_restriction('UPG', dc_effects=fx)
    assert r['filter']('Stormtrooper') is True
    assert r['filter']('Han Solo') is False


# ── OR-split alternatives ───────────────────────────────────────────────


def test_or_split_two_keyword_alternatives():
    fx = _effects_with('UPG', 'TROOPER OR LEADER ONLY')
    r = get_attachment_restriction('UPG', dc_effects=fx)
    assert r['filter']('Stormtrooper') is True
    assert r['filter']('Han Solo') is True  # LEADER
    assert r['filter']('AT-ST') is False  # neither


def test_comma_list_in_or_alternative():
    fx = _effects_with('UPG', 'VEHICLE, DROID, OR HEAVY WEAPON ONLY')
    r = get_attachment_restriction('UPG', dc_effects=fx)
    assert r['filter']('AT-ST') is True  # VEHICLE
    assert r['filter']('Heavy Stormtrooper') is True  # HEAVY WEAPON


# ── NON- conjunctive ───────────────────────────────────────────────────


def test_non_massive_excludes_massive():
    fx = _effects_with('UPG', 'NON-MASSIVE TROOPER ONLY')
    r = get_attachment_restriction('UPG', dc_effects=fx)
    # Stormtrooper: not Massive, is Trooper → True.
    assert r['filter']('Stormtrooper') is True
    # AT-ST: is Massive → False.
    assert r['filter']('AT-ST') is False


def test_non_unique_excludes_unique():
    fx = _effects_with('UPG', 'NON-UNIQUE TROOPER ONLY')
    r = get_attachment_restriction('UPG', dc_effects=fx)
    assert r['filter']('Stormtrooper') is True
    assert r['filter']('Han Solo') is False  # unique


# ── Group With N Figures ────────────────────────────────────────────────


def test_group_with_n_figures_match():
    fx = _effects_with('UPG', 'TROOPER GROUP WITH 3 FIGURES ONLY')
    r = get_attachment_restriction('UPG', dc_effects=fx)
    assert r['filter']('Stormtrooper') is True   # 3 figures
    assert r['filter']('Heavy Stormtrooper') is False  # 2 figures
    assert r['filter']('Vader') is False  # 1 figure, not Trooper


# ── Name-based match ────────────────────────────────────────────────────


def test_name_based_restriction():
    fx = _effects_with('UPG', 'DARTH VADER ONLY')
    fx['Darth Vader'] = {'unique': True, 'cost': 18,
                          'keywords': ['LEADER', 'JEDI'],
                          'affiliation': 'Imperial', 'figures': 1}
    r = get_attachment_restriction('UPG', dc_effects=fx)
    assert r['filter']('Darth Vader') is True
    assert r['filter']('Han Solo') is False


# ── restrictionText returned verbatim ───────────────────────────────────


def test_restriction_text_preserved():
    fx = _effects_with('UPG', 'LEADER ONLY')
    r = get_attachment_restriction('UPG', dc_effects=fx)
    assert r['restrictionText'] == 'LEADER'


def test_alternatives_list_returned():
    fx = _effects_with('UPG', 'VEHICLE, DROID, OR HEAVY WEAPON ONLY')
    r = get_attachment_restriction('UPG', dc_effects=fx)
    assert set(r['alternatives']) == {'VEHICLE', 'DROID', 'HEAVY WEAPON'}
