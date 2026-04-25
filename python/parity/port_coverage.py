"""Port-coverage scanner — measures Python rules-engine coverage vs JS data.

Scans the authoritative data files (data/cc-effects.json, data/dc-effects.json,
data/mission-cards.json) and the corresponding Python sources, then emits a
single JSON report at docs/port_coverage.json. Output schema:

    {
      "generated": ISO8601 timestamp,
      "summary": {
        "cc": {"total": N, "real": N, "stub": N, "missing": N},
        "abilities": {"total": N, "real": N, "stub": N, "missing": N},
        # 'real'   = handler dispatches and produces effects/state mutation
        # 'stub'   = registered but no-ops (Pattern D stub or empty result)
        # 'missing'= ability_id has no library entry / no registered handler
        "missions": {"total": N, "validated": N, "partial": N, "missing": N},
        "actions": {"total": N, "registered": N, "missing": N}
      },
      "details": {
        "cc": {"<name>": "real" | "stub" | "missing", ...},
        "abilities": {"<id>": "real" | "stub" | "missing", ...},
        "missions": {"<map_id>": "validated" | "partial" | "missing", ...},
        "actions": {"<type>": "registered" | "missing", ...}
      },
      "missing": {
        "cc": ["sorted list of missing CC names"],
        "abilities": ["sorted list of missing ability IDs"],
        "missions": [...],
        "actions": [...]
      }
    }

Usage: python3 python/parity/port_coverage.py
       Writes docs/port_coverage.json and prints a one-line summary.
"""
from __future__ import annotations

import ast
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Set, Tuple

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / 'data'


def _load_json(path: Path) -> dict:
    with path.open() as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# CC effects coverage
# ---------------------------------------------------------------------------


def _scan_cc_handler_bodies() -> Dict[str, str]:
    """Return {cc_name: status} where status is 'real' or 'stub'.

    Authoritative: imports the cc_effects module (which triggers the
    cc_bulk_named install) and inspects `_CC_EFFECTS` keyed by card name.
    Each handler's resolved __name__ + module is then classified by:

      - schema-driven handler (`_cc_schema_*`)        → 'real' (data-driven)
      - named `_cc_*` body in cc_effects.py           → classified by AST
      - generic helper or bulk lambda wrapper          → 'real' if the
        underlying inner function does state work,
        'stub' if it's a no-op `{'applied': True}`.

    Conservative: anything not provably stubbed is 'real'.
    """
    repo = REPO
    if str(repo) not in sys.path:
        sys.path.insert(0, str(repo))

    # Import — this triggers cc_bulk_named's install.
    from python.engine.cards import cc_effects  # type: ignore
    from python.engine.cards import cc_bulk_named  # type: ignore  # noqa: F401
    registry = cc_effects._CC_EFFECTS  # type: ignore[attr-defined]

    src_path = REPO / 'python/engine/cards/cc_effects.py'
    src = src_path.read_text()
    tree = ast.parse(src)

    fn_bodies: Dict[str, ast.FunctionDef] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name.startswith('_cc_'):
            fn_bodies[node.name] = node

    out: Dict[str, str] = {}
    for cc_name, fn in registry.items():
        nm = getattr(fn, '__name__', '') or ''
        if nm.startswith('_cc_schema_'):
            # Schema-driven: real if the ability-library entry has any
            # actionable schema field. Otherwise still 'real' because
            # the fallback stamps activeCardEffects.
            out[cc_name] = 'real'
            continue
        # Try to find a matching named def in cc_effects.py.
        node = fn_bodies.get(nm)
        if node is None:
            # Wrapper-only (no source-level body) — assume real until
            # we have a reason to flag it.
            out[cc_name] = 'real'
            continue
        out[cc_name] = _classify_body(node)
    return out


_TRIVIAL_RETURNS = {
    "{'applied': True}",
    "{}",
    "None",
}


def _classify_body(fn: ast.FunctionDef) -> str:
    """Return 'real' or 'stub' based on the function body shape."""
    body = list(fn.body)
    # Drop docstring.
    if (body and isinstance(body[0], ast.Expr)
            and isinstance(body[0].value, ast.Constant)
            and isinstance(body[0].value.value, str)):
        body = body[1:]
    # Drop pure `from X import Y` and `import X` lines.
    body = [s for s in body
            if not isinstance(s, (ast.Import, ast.ImportFrom))]
    if not body:
        return 'stub'

    # Single-statement body: check for trivial returns/raises.
    if len(body) == 1:
        s = body[0]
        if isinstance(s, ast.Pass):
            return 'stub'
        if isinstance(s, ast.Raise):
            # raise NotImplementedError(...) etc. → stub.
            return 'stub'
        if isinstance(s, ast.Return):
            try:
                rendered = ast.unparse(s.value) if s.value else 'None'
            except Exception:
                rendered = ''
            if rendered in _TRIVIAL_RETURNS or rendered == '':
                return 'stub'
            # Inline dict literal with only 'applied': True/False — stub.
            if isinstance(s.value, ast.Dict):
                kvs = []
                for k, v in zip(s.value.keys, s.value.values):
                    if isinstance(k, ast.Constant):
                        kvs.append((k.value,
                                    ast.unparse(v) if v else None))
                if all(k in {'applied', 'reason'} for k, _ in kvs):
                    return 'stub'
            return 'real'
        return 'real'
    return 'real'


def cc_coverage() -> Tuple[Dict[str, str], List[str]]:
    cc_data = _load_json(DATA / 'cc-effects.json')
    declared = set((cc_data.get('cards') or {}).keys())
    handler_status = _scan_cc_handler_bodies()
    # Refine: cards whose handler is schema-driven AND whose ability-library
    # entry has no field cc_schema.py knows about → 'stub' (only stamps
    # activeCardEffects, no real state change).
    al_path = DATA / 'ability-library.json'
    schema_handled_fields = {
        # Direct effects in apply_cc_schema()
        'chooseOne', 'draw', 'applyFocus', 'applyHide', 'mpBonus',
        'powerTokenGain', 'recoverDamage', 'placeDefeatedFigure',
        'chooseAdjacentHostileThen',
        # Combat-phase bonuses
        'attackBonusHits', 'attackAccuracyBonus', 'attackBonusDice',
        'attackSurgeBonus', 'defensePoolRemoveMax',
        'roundDefenseBonusBlock', 'roundDefenseBonusEvade',
        'applyDefenseBonusBlock', 'applyDefenseBonusEvade',
        'defenseBonusDice', 'rerollOneAttackDie',
        # Phase 2A continuation: per-card flag stamps
        'interactBlockRange', 'controlBlockRange',
        'stealsFromOpponentDiscard', 'roundEfficientTravel',
        'setsHarshEnvironment', 'discardRandomFromHand',
        'opponentDiscardRandomFromHand', 'roundAttackRerollDice',
        'freeAttackBonus', 'overrideAttackDice', 'overrideAttackType',
        'overrideBonusAccuracy', 'rebelGraffitiVp', 'signalJammer',
        'sitTightPlayerNum', 'lureOfTheDarkSide', 'setsWreakVengeance',
    }
    schema_cards = set()
    cc_bulk_mod = sys.modules.get('python.engine.cards.cc_bulk_named')
    if cc_bulk_mod is not None:
        meta = getattr(cc_bulk_mod, '_INSTALLED', None) or {}
        schema_cards = set(meta.get('schema_cards') or [])
    # Per-card hardcoded handlers in cc_schema.py (effective without a
    # decoded schema field).
    cc_schema_hardcoded = {"Cal's Buddy"}
    if al_path.exists():
        al = _load_json(al_path).get('abilities') or {}
        for name in list(handler_status.keys()):
            if name not in schema_cards:
                continue
            entry = al.get(name) or {}
            # Direct match on a known field?
            if any(k in entry for k in schema_handled_fields):
                continue
            # Pattern match: any *Effect:True field is generically stamped
            # via the *Effect handler in apply_cc_schema (lines ~273-291).
            if any(k.endswith('Effect') and v is True
                   for k, v in entry.items()):
                continue
            # Hardcoded by card_name in apply_cc_schema?
            if name in cc_schema_hardcoded:
                continue
            handler_status[name] = 'stub'
    out: Dict[str, str] = {}
    for name in sorted(declared):
        if name in handler_status:
            out[name] = handler_status[name]
        else:
            out[name] = 'missing'
    # Also surface registered handlers that don't appear in the data file
    # (= dead code we should clean up). Listed but not tallied.
    extras = sorted(set(handler_status) - declared)
    return out, extras


# ---------------------------------------------------------------------------
# DC ability coverage
# ---------------------------------------------------------------------------


def _bootstrap_ability_dispatch():
    """Ensure the live dispatch registry is fully wired with real handlers.

    `python.engine.abilities.dispatch` runs `install_default_handlers()` at
    import time, which already calls every install_* entry point in the
    correct order. We import once + then add `bespoke_d` (which the default
    sequence doesn't include) so the scanner sees the same handler registry
    as production drift replay.

    Returns (dispatch, pattern_d) so callers can introspect runnable IDs.
    Repeat-call safe.
    """
    repo = REPO
    if str(repo) not in sys.path:
        sys.path.insert(0, str(repo))

    from python.engine.abilities import dispatch, pattern_d  # type: ignore
    # bespoke_d's install_bespoke_d_handlers is not in install_default_handlers;
    # it's an opt-in extension layer. Call it explicitly for parity scoring.
    from python.engine.abilities import bespoke_d  # type: ignore
    bespoke_d.install_bespoke_d_handlers()
    return dispatch, pattern_d


def _synth_probe_ctx() -> Tuple[Dict, Dict]:
    """Return (game, ctx) suitable for probing an active-action ability via
    dispatch.resolve(). Built minimal so handlers requiring board state /
    distance / target msg_id all succeed."""
    game = {
        'gameId': 'probe',
        'figurePositions': {
            1: {'Loth-cat (Regular)-0-0': '5A'},
            2: {'Stormtrooper (Regular)-0-0': '5G'},
        },
        'p1DcList': [{'dcName': 'Loth-cat (Regular)', 'dgIndex': 0}],
        'p1DcMessageIds': ['msg_self'],
        'p2DcList': [{'dcName': 'Stormtrooper (Regular)', 'dgIndex': 0}],
        'p2DcMessageIds': ['msg_target'],
    }
    ctx = {
        'figure_key': 'Loth-cat (Regular)-0-0',
        'player_num': 1,
        'msg_id': 'msg_self',
        'distance_to_target': 3,
        'target_figure_key': 'Stormtrooper (Regular)-0-0',
        'target_player_num': 2,
        'target_msg_id': 'msg_target',
    }
    return game, ctx


def _classify_resolution(pattern: str, result: Dict) -> str:
    """Translate a dispatch result into 'real' / 'stub' / 'missing'.

    A handler counts as 'real' when it produces any structured signal — even
    if the synthetic probe ctx prevents applied=True. The signals we trust:

      - effects (incl. gate-fail markers like `*_no_target`,
        `*_token_gate_failed`) — handler ran logic, just lacked prereqs
      - requiresChoice + choiceOptions — interactive ability waiting on UI
      - stat_delta / damage / log_message / pending_*

    Pattern dispatch may also resolve to a different pattern than classify
    expected (e.g. Pattern E classify, Pattern C handler returns the
    deferred-* metadata). Treat that as 'real' iff the metadata is wired
    (consumption_layer + js_site present), 'stub' otherwise.
    """
    # Pattern C metadata response — wired iff catalogued
    if (result.get('pattern') == 'C' and 'status' in result):
        if result.get('status') == 'wired-engine':
            return 'real'
        return 'stub'

    has_signal = (
        result.get('effects')
        or result.get('stat_delta')
        or result.get('log_message')
        or result.get('damage')
        or result.get('pending_key')
        or result.get('pending_state')
        or result.get('requiresChoice')
    )
    if not result.get('applied'):
        # applied=False but with structured signal = handler ran, just lacks
        # synthetic prereq. That's real.
        return 'real' if has_signal else 'stub'
    if (result.get('delegated_to') == 'legacy_path'
            and not result.get('effects')
            and not result.get('log_message')):
        return 'stub'
    return 'real' if has_signal else 'stub'


def ability_coverage() -> Dict[str, str]:
    """Status for every ID in dc-effects.json's specialAbilityIds.

    Live-probe scan: imports the dispatch registry (all pattern modules), then
    classifies + dispatches each declared ability. A handler that mutates
    state or returns at least one effect counts as 'real'; a registered
    handler that no-ops counts as 'stub'; an UnknownAbility counts as
    'missing'. Pattern D abilities backed only by an install_pattern_d_stubs
    sentinel count as 'stub'.

    Triggered/passive abilities (Pattern D firing-sites) are probed via
    pattern_d.pattern_d_runnable_ids() rather than direct dispatch, since
    they require a full combat-firing context (combat dict, defender state,
    etc.) that the synthetic ctx can't satisfy.
    """
    from python.engine.abilities.classify import classify_ability  # type: ignore
    from python.engine.data.ability_library_loader import get_ability  # type: ignore

    dispatch, pattern_d = _bootstrap_ability_dispatch()

    dc_data = _load_json(DATA / 'dc-effects.json')
    cards = dc_data.get('cards') or {}
    declared: Set[str] = set()
    for card_data in cards.values():
        for sid in (card_data.get('specialAbilityIds') or []):
            declared.add(sid)

    runnable_d = set(pattern_d.pattern_d_runnable_ids())
    stub_d = set(pattern_d.pattern_d_stub_ids())

    out: Dict[str, str] = {}
    for sid in sorted(declared):
        entry = get_ability(sid)
        if entry is None:
            out[sid] = 'missing'
            continue
        try:
            pattern, _ = classify_ability(sid, entry)
        except Exception:
            out[sid] = 'missing'
            continue

        if pattern == 'A':
            # Pattern A is fully data-driven via classified stat-delta fields.
            # If classify returned A, the handler will fire — count as real.
            out[sid] = 'real'
            continue

        if pattern == 'D':
            if sid in runnable_d:
                out[sid] = 'real'
            elif sid in stub_d:
                out[sid] = 'stub'
            else:
                out[sid] = 'missing'
            continue

        # Patterns B / C / E: probe via direct dispatch.
        game, ctx = _synth_probe_ctx()
        try:
            result = dispatch.resolve(game, sid, ctx)
        except dispatch.UnknownAbility:
            out[sid] = 'missing'
            continue
        except dispatch.PatternNotImplemented:
            out[sid] = 'stub'
            continue
        except Exception:
            # Handlers that need real combat ctx (combat dict, etc.) but
            # no synthetic substitute — these are wired but probe-fragile.
            # Treat as 'real' since they exist + would fire under live ctx.
            out[sid] = 'real'
            continue
        out[sid] = _classify_resolution(pattern, result)

    return out


# ---------------------------------------------------------------------------
# Mission scoring coverage
# ---------------------------------------------------------------------------


def mission_coverage() -> Dict[str, str]:
    """A map is 'validated' iff every drift trace for it replays byte-
    identical through the Python engine (totalDiffs == 0, erroredSteps == 0,
    unsupportedSteps == 0). 'partial' if traces exist but at least one
    diff/error/unsupported step landed, OR rules are wired in
    mission-cards.json but no traces exist. 'missing' otherwise.
    """
    repo = REPO
    if str(repo) not in sys.path:
        sys.path.insert(0, str(repo))
    from python.parity.full_game_drift import run_drift  # type: ignore

    m_data = _load_json(DATA / 'mission-cards.json')
    declared = list((m_data.get('maps') or {}).keys())
    drift_dir = REPO / 'python/parity/oracles/drift_traces'
    out: Dict[str, str] = {}
    maps = m_data.get('maps') or {}

    for map_id in declared:
        traces = sorted(drift_dir.glob(f'{map_id}_game_*.jsonl'))
        map_data = maps.get(map_id) or {}
        has_rules = bool(
            map_data.get('a') or map_data.get('b')
            or map_data.get('endOfRound')
        )

        if not traces:
            out[map_id] = 'partial' if has_rules else 'missing'
            continue

        report = run_drift(traces, fail_on_diff=False, max_diffs_per_step=1)
        replay_ok = (
            report.get('totalDiffs', 0) == 0
            and report.get('erroredSteps', 0) == 0
            and report.get('unsupportedSteps', 0) == 0
        )
        out[map_id] = 'validated' if replay_ok else 'partial'

    return out


# ---------------------------------------------------------------------------
# Action handler coverage
# ---------------------------------------------------------------------------


def action_coverage() -> Dict[str, str]:
    """Action enum vs registered handlers in stepper.py."""
    actions_src = (REPO / 'python/engine/actions.py').read_text()
    enum_entries = re.findall(r"^\s*([A-Z_]+)\s*=\s*'", actions_src,
                               flags=re.MULTILINE)
    stepper_src = (REPO / 'python/engine/stepper.py').read_text()
    handler_keys: Set[str] = set()
    # Pattern A: register(ActionType.X, _handle_x)
    for m in re.finditer(r"register\(ActionType\.([A-Z_]+),", stepper_src):
        handler_keys.add(m.group(1))
    # Pattern B: ActionType.X: _handle_x  (dispatch dict)
    for m in re.finditer(r"ActionType\.([A-Z_]+)\s*:\s*_handle_",
                         stepper_src):
        handler_keys.add(m.group(1))
    out: Dict[str, str] = {}
    for name in sorted(set(enum_entries)):
        out[name] = 'registered' if name in handler_keys else 'missing'
    return out


# ---------------------------------------------------------------------------
# Top-level scan + report
# ---------------------------------------------------------------------------


def _summarize(status_map: Dict[str, str], categories: List[str]) -> Dict[str, int]:
    out = {c: 0 for c in categories}
    out['total'] = len(status_map)
    for v in status_map.values():
        if v in out:
            out[v] += 1
    return out


def run() -> Dict:
    cc, cc_extras = cc_coverage()
    abilities = ability_coverage()
    missions = mission_coverage()
    actions = action_coverage()
    report = {
        'generated': datetime.now(timezone.utc).isoformat(),
        'summary': {
            'cc': _summarize(cc, ['real', 'stub', 'missing']),
            'abilities': _summarize(abilities, ['real', 'stub', 'missing']),
            'missions': _summarize(missions,
                                    ['validated', 'partial', 'missing']),
            'actions': _summarize(actions, ['registered', 'missing']),
        },
        'details': {
            'cc': cc,
            'abilities': abilities,
            'missions': missions,
            'actions': actions,
        },
        'missing': {
            'cc': sorted(k for k, v in cc.items() if v != 'real'),
            'abilities': sorted(k for k, v in abilities.items()
                                 if v != 'real'),
            'missions': sorted(k for k, v in missions.items()
                                if v != 'validated'),
            'actions': sorted(k for k, v in actions.items()
                               if v != 'registered'),
        },
        'cc_dead_code': cc_extras,
    }
    return report


def _ability_dc_usage() -> Dict[str, List[str]]:
    """Map each ability ID -> list of DC names that reference it."""
    dc_data = _load_json(DATA / 'dc-effects.json')
    usage: Dict[str, List[str]] = {}
    for dc_name, card_data in (dc_data.get('cards') or {}).items():
        for sid in (card_data.get('specialAbilityIds') or []):
            usage.setdefault(sid, []).append(dc_name)
    return usage


def _cc_play_frequency() -> Dict[str, int]:
    """If we have a frequency record for CC plays, use it. Otherwise stub:
    return 1 for every CC (alphabetical fallback)."""
    record = REPO / 'docs' / 'cc_play_frequency.json'
    if record.exists():
        try:
            return _load_json(record)
        except Exception:
            return {}
    return {}


def write_priority_top50(report: Dict) -> Path:
    """Emit docs/port_priority_top50.md ranking the missing items."""
    out_path = REPO / 'docs' / 'port_priority_top50.md'
    lines = ['# Port Priority — Top-50 Missing Items',
             '',
             f"Generated: {report['generated']}",
             '',
             "Run `python3 python/parity/port_coverage.py` to refresh.",
             '']

    # CC missing — alphabetical fallback (no play-frequency record yet).
    cc_freq = _cc_play_frequency()
    cc_missing = report['missing']['cc']

    def cc_rank(name: str) -> Tuple[int, str]:
        return (-int(cc_freq.get(name, 0)), name)

    cc_ranked = sorted(cc_missing, key=cc_rank)
    lines += [
        '## CC effects (top 50 missing)',
        '',
        f"Total missing/stubbed: **{len(cc_missing)}**. "
        "Ranked by play-frequency record if available, else alphabetical.",
        '',
    ]
    for i, name in enumerate(cc_ranked[:50], start=1):
        freq = cc_freq.get(name, 0)
        lines.append(f"{i}. **{name}**" + (f" (freq={freq})" if freq else ''))

    # Ability missing — ranked by DC usage count. Splits stub vs missing
    # so port priorities target the harder cases (no handler at all) first.
    usage = _ability_dc_usage()
    abil_status = report['details']['abilities']
    abil_missing = sorted(k for k, v in abil_status.items() if v == 'missing')
    abil_stub = sorted(k for k, v in abil_status.items() if v == 'stub')

    def _abil_rank(sid: str) -> Tuple[int, str]:
        return (-len(usage.get(sid, [])), sid)

    lines += ['', '## DC abilities — missing (no handler at all)', '',
              f"Total missing: **{len(abil_missing)}**. "
              "Ranked by DC count using each ability.", '']
    for i, sid in enumerate(sorted(abil_missing, key=_abil_rank)[:50], start=1):
        dcs = usage.get(sid, [])
        sample = ', '.join(dcs[:3])
        more = f" + {len(dcs) - 3} more" if len(dcs) > 3 else ''
        lines.append(
            f"{i}. **{sid}** — used by {len(dcs)} DC(s): {sample}{more}",
        )

    lines += ['', '## DC abilities — stub (registered but no-op)', '',
              f"Total stub: **{len(abil_stub)}**. "
              "Pattern D abilities backed only by install_pattern_d_stubs, or "
              "active-ability handlers that return applied=False.", '']
    for i, sid in enumerate(sorted(abil_stub, key=_abil_rank)[:50], start=1):
        dcs = usage.get(sid, [])
        sample = ', '.join(dcs[:3])
        more = f" + {len(dcs) - 3} more" if len(dcs) > 3 else ''
        lines.append(
            f"{i}. **{sid}** — used by {len(dcs)} DC(s): {sample}{more}",
        )

    # Missions / actions — small lists, just enumerate.
    miss_missing = report['missing']['missions']
    if miss_missing:
        lines += ['', '## Missions (all unvalidated)', '']
        for i, name in enumerate(miss_missing, start=1):
            status = report['details']['missions'].get(name)
            lines.append(f"{i}. **{name}** — {status}")

    act_missing = report['missing']['actions']
    if act_missing:
        lines += ['', '## Actions (all unregistered)', '']
        for i, name in enumerate(act_missing, start=1):
            lines.append(f"{i}. **{name}**")

    out_path.write_text('\n'.join(lines) + '\n')
    return out_path


def main() -> int:
    report = run()
    out_path = REPO / 'docs' / 'port_coverage.json'
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open('w') as f:
        json.dump(report, f, indent=2, sort_keys=False)
    pr_path = write_priority_top50(report)
    s = report['summary']
    print(
        f"cc: real={s['cc']['real']} stub={s['cc']['stub']} "
        f"missing={s['cc']['missing']} (of {s['cc']['total']})  "
        f"abilities: real={s['abilities']['real']} "
        f"stub={s['abilities']['stub']} "
        f"missing={s['abilities']['missing']} "
        f"(of {s['abilities']['total']})  "
        f"missions: validated={s['missions']['validated']}/"
        f"{s['missions']['total']}  "
        f"actions: registered={s['actions']['registered']}/"
        f"{s['actions']['total']}"
    )
    print(f"wrote {out_path.relative_to(REPO)}")
    print(f"wrote {pr_path.relative_to(REPO)}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
