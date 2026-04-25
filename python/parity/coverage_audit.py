"""Comprehensive coverage audit — single source of truth for "what's done".

Cross-references every piece of evidence we have about the JS->Python port:

  1. Action enum    (python/engine/actions.py)         — the 81 things a player can do
  2. Drift traces   (python/parity/oracles/drift_traces/*.jsonl)
                                                       — what JS recordings actually exercise
  3. Oracle tests   (python/parity/oracles/**/*.py)    — what we've written verification for
  4. port_coverage  (docs/port_coverage.json)          — live dispatch probe results
  5. Pattern C cat. (python/engine/abilities/pattern_c.py:_CATALOG)
                                                       — manual passive-ability ledger
  6. port_audit     (docs/port_audit.md)               — file-by-file shape match

Outputs:
  docs/coverage_audit.json   — machine-readable, regenerable
  docs/coverage_audit.md     — human-readable report card

Run:
  python3 python/parity/coverage_audit.py            # write reports
  python3 python/parity/coverage_audit.py --refresh  # also rerun port_coverage.py first

The single answer to "are we treading old ground?" lives in coverage_audit.md.
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Set, Tuple

REPO = Path(__file__).resolve().parents[2]
DOCS = REPO / 'docs'
DRIFT_DIR = REPO / 'python/parity/oracles/drift_traces'
ORACLES_DIR = REPO / 'python/parity/oracles'
ACTIONS_PY = REPO / 'python/engine/actions.py'
ACTION_PARSER_PY = REPO / 'python/engine/action_parser.py'
PATTERN_C_PY = REPO / 'python/engine/abilities/pattern_c.py'
COVERAGE_JSON = DOCS / 'port_coverage.json'
PORT_AUDIT_MD = DOCS / 'port_audit.md'


# ---------------------------------------------------------------------------
# A. Action enum
# ---------------------------------------------------------------------------

def load_action_enum() -> Dict[str, str]:
    """Return {ENUM_NAME: 'string_value'} for every ActionType entry."""
    src = ACTIONS_PY.read_text()
    out: Dict[str, str] = {}
    for m in re.finditer(r"^\s*([A-Z_]+)\s*=\s*'([^']+)'", src, flags=re.MULTILINE):
        out[m.group(1)] = m.group(2)
    return out


# ---------------------------------------------------------------------------
# B. action_parser.py — canonical customId-prefix → ActionType map
# ---------------------------------------------------------------------------

def load_prefix_to_actiontype() -> Dict[str, str]:
    """Parse action_parser.py to build {prefix: ENUM_NAME}.

    Strategy: find every `def _parse_X(...)` block, scan its body for
    `ActionType.NAME`, then walk every `_PARSERS = ...` tuple line for
    `('prefix_', _parse_X)` pairs and resolve.

    A parser may emit multiple ActionTypes (e.g. _parse_false_orders_action
    can return MOVE / ATTACK / SKIP) — for that case we map the prefix to
    the first ActionType encountered, which is sufficient for marking the
    action *family* observed.
    """
    import ast
    src = ACTION_PARSER_PY.read_text()
    tree = ast.parse(src)

    fn_actiontypes: Dict[str, List[str]] = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef):
            continue
        if not node.name.startswith('_parse_'):
            continue
        types: List[str] = []
        for sub in ast.walk(node):
            # Match `ActionType.NAME` attribute references.
            if (isinstance(sub, ast.Attribute)
                    and isinstance(sub.value, ast.Name)
                    and sub.value.id == 'ActionType'):
                types.append(sub.attr)
        if types:
            fn_actiontypes[node.name] = types

    # Walk parser-tuple entries.
    out: Dict[str, str] = {}
    for tm in re.finditer(r"\(\s*'([a-z_][a-z0-9_]*)_'\s*,\s*(_parse_\w+)\s*\)", src):
        prefix = tm.group(1) + '_'
        fn = tm.group(2)
        types = fn_actiontypes.get(fn) or []
        if types:
            # First ActionType is the canonical/primary one.
            out[prefix] = types[0]
    return out


def walk_drift_traces(prefix_to_action: Dict[str, str]
                       ) -> Tuple[Dict[str, int], Dict[str, Set[str]], int,
                                  Dict[str, int]]:
    """Walk every .jsonl and tally customId hits per ActionType.

    Returns (hits_by_actiontype, files_by_actiontype, total_steps,
             unmapped_prefix_counter).
    """
    hits: Dict[str, int] = collections.Counter()
    files: Dict[str, Set[str]] = collections.defaultdict(set)
    unmapped: Dict[str, int] = collections.Counter()
    total = 0

    sorted_prefixes = sorted(prefix_to_action.keys(), key=len, reverse=True)

    for trace in sorted(DRIFT_DIR.glob('*.jsonl')):
        rel = trace.name
        for line in trace.open():
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            cid = rec.get('customId') or ''
            if not cid:
                continue
            total += 1
            matched = False
            for pfx in sorted_prefixes:
                if cid.startswith(pfx):
                    actype = prefix_to_action[pfx]
                    hits[actype] += 1
                    files[actype].add(rel)
                    matched = True
                    break
            if not matched:
                # Bucket by first segment for diagnostics.
                seg = cid.split('_', 2)
                key = '_'.join(seg[:2]) if len(seg) >= 2 else seg[0]
                unmapped[key] += 1
    return dict(hits), dict(files), total, dict(unmapped)


# ---------------------------------------------------------------------------
# C. Oracle test coverage — what action types are referenced in tests
# ---------------------------------------------------------------------------

def walk_oracle_tests(enum_names: List[str]) -> Tuple[Dict[str, Set[str]], Dict[str, Dict]]:
    """Return:
      - {ENUM_NAME: {test_file_relpath, ...}}
      - {test_file_relpath: {area, kind, fn_count}}

    `kind` is JS_PARITY (fixtures vs JS), FUZZ, SNAPSHOT, or UNIT.
    `area` is the parent dir under oracles/ (combat, movement, los, ...).
    """
    actype_refs: Dict[str, Set[str]] = {n: set() for n in enum_names}
    test_meta: Dict[str, Dict] = {}

    for path in sorted(ORACLES_DIR.rglob('*.py')):
        if path.name.startswith(('_', '__')):
            continue
        rel = str(path.relative_to(REPO))
        try:
            txt = path.read_text()
        except Exception:
            continue

        # Test fn count
        fn_count = len(re.findall(r'^\s*def\s+test_\w+', txt, re.MULTILINE))
        if fn_count == 0:
            continue

        # Classify
        parent = path.parent.name
        name = path.stem
        if 'parity' in name or 'fuzz' in name or '_js_' in name:
            kind = 'JS_PARITY'
        elif 'snapshot' in name:
            kind = 'SNAPSHOT'
        elif 'golden' in name:
            kind = 'JS_PARITY'
        elif 'probe' in name:
            kind = 'PROBE'
        else:
            kind = 'UNIT'

        test_meta[rel] = {'area': parent, 'kind': kind, 'fn_count': fn_count}

        for m in re.finditer(r'ActionType\.([A-Z_]+)', txt):
            nm = m.group(1)
            if nm in actype_refs:
                actype_refs[nm].add(rel)

    return actype_refs, test_meta


# ---------------------------------------------------------------------------
# D. port_coverage.json — live dispatch probe
# ---------------------------------------------------------------------------

def load_port_coverage(refresh: bool) -> Dict:
    if refresh:
        print('  · regenerating port_coverage.json...')
        subprocess.run(
            [sys.executable, str(REPO / 'python/parity/port_coverage.py')],
            check=True, cwd=REPO, capture_output=True,
        )
    if not COVERAGE_JSON.exists():
        return {}
    return json.loads(COVERAGE_JSON.read_text())


# ---------------------------------------------------------------------------
# E. Pattern C catalog — manual ledger of passive abilities
# ---------------------------------------------------------------------------

_CAT_ENTRY_RE = re.compile(
    r"^\s*'([a-z_]+)':\s*\(\s*\n?\s*'([^']+)',\s*'([^']+)',\s*\n?\s*'([^']+)'",
    re.MULTILINE,
)


def load_pattern_c_catalog() -> Dict[str, Tuple[str, str, str]]:
    src = PATTERN_C_PY.read_text()
    out: Dict[str, Tuple[str, str, str]] = {}
    for m in _CAT_ENTRY_RE.finditer(src):
        ability_id, status, kind, js_site = m.group(1), m.group(2), m.group(3), m.group(4)
        out[ability_id] = (status, kind, js_site)
    return out


# ---------------------------------------------------------------------------
# F. port_audit.md — file-by-file shape audit (read counts only)
# ---------------------------------------------------------------------------

def load_port_audit_counts() -> Dict[str, int]:
    if not PORT_AUDIT_MD.exists():
        return {}
    txt = PORT_AUDIT_MD.read_text()
    out: Dict[str, int] = {}
    for label in ['MISSING', 'STUB-ONLY', 'PARTIAL', 'COVERED-BY-SHAPE', 'UNVERIFIED']:
        m = re.search(rf'^\s*-\s*\*\*{re.escape(label)}\*\*:\s*(\d+)', txt, re.MULTILINE)
        if m:
            out[label] = int(m.group(1))
    return out


def load_port_audit_missing_files() -> List[Tuple[str, int, int]]:
    """Return [(js_path, js_loc, js_fns)] for MISSING-status rows, sorted by LOC desc."""
    if not PORT_AUDIT_MD.exists():
        return []
    txt = PORT_AUDIT_MD.read_text()
    out = []
    for line in txt.splitlines():
        m = re.match(r'\|\s*MISSING\s*\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|', line)
        if m:
            out.append((m.group(1), int(m.group(2)), int(m.group(3))))
    out.sort(key=lambda r: -r[1])
    return out


# ---------------------------------------------------------------------------
# Verdict computation per action type
# ---------------------------------------------------------------------------

def verdict(registered: bool, has_oracle: bool, has_drift: bool) -> str:
    if not registered:
        return 'UNREGISTERED'
    if has_drift and has_oracle:
        return 'GOLD'           # Wired + tested + observed in real game
    if has_drift and not has_oracle:
        return 'SILVER'         # Observed in real game but no targeted test
    if has_oracle and not has_drift:
        return 'BRONZE'         # Tested in isolation only — no live game evidence
    return 'UNVERIFIED'         # Wired, never seen, never tested


# ---------------------------------------------------------------------------
# Report writer
# ---------------------------------------------------------------------------

def build_report(refresh: bool) -> Dict:
    enum = load_action_enum()  # {ENUM: 'str'}
    enum_names = sorted(enum.keys())

    prefix_map = load_prefix_to_actiontype()  # {'dc_activate_': 'ACTIVATE_DC', ...}
    drift_hits, drift_files, drift_total, drift_unmapped = walk_drift_traces(prefix_map)
    actype_oracle, oracle_meta = walk_oracle_tests(enum_names)
    cov = load_port_coverage(refresh)
    cat = load_pattern_c_catalog()
    audit_counts = load_port_audit_counts()
    audit_missing_files = load_port_audit_missing_files()

    actions_section = cov.get('details', {}).get('actions', {})
    abilities_section = cov.get('details', {}).get('abilities', {})

    # Per-action-type rows
    action_rows = []
    # Build reverse map: ActionType -> list of customId prefixes parsed to it
    enum_to_prefixes: Dict[str, List[str]] = collections.defaultdict(list)
    for pfx, enum_name in prefix_map.items():
        enum_to_prefixes[enum_name].append(pfx)

    for enum_name in enum_names:
        action_str = enum[enum_name]
        registered = actions_section.get(enum_name) == 'registered' if actions_section else True
        has_oracle = bool(actype_oracle.get(enum_name))
        hits = drift_hits.get(enum_name, 0)
        has_drift = hits > 0
        action_rows.append({
            'enum': enum_name,
            'string': action_str,
            'registered': registered,
            'has_oracle': has_oracle,
            'oracle_files': sorted(actype_oracle.get(enum_name, [])),
            'drift_hits': hits,
            'drift_files': sorted(drift_files.get(enum_name, [])),
            'parser_prefixes': sorted(enum_to_prefixes.get(enum_name, [])),
            'verdict': verdict(registered, has_oracle, has_drift),
        })

    # Pattern C buckets
    pc_buckets = collections.Counter(s for s, _, _ in cat.values())
    pc_total = sum(pc_buckets.values())

    # Oracle test inventory
    oracle_by_area: Dict[str, Dict[str, int]] = collections.defaultdict(
        lambda: {'JS_PARITY': 0, 'SNAPSHOT': 0, 'PROBE': 0, 'UNIT': 0, 'tests': 0}
    )
    for meta in oracle_meta.values():
        bucket = oracle_by_area[meta['area']]
        bucket[meta['kind']] += 1
        bucket['tests'] += meta['fn_count']

    verdict_counts = collections.Counter(r['verdict'] for r in action_rows)

    # Compute headline weighted estimate
    weighted = compute_weighted_estimate(action_rows, cov, pc_buckets, pc_total)

    return {
        'generated': datetime.now(timezone.utc).isoformat(),
        'headline': {
            'action_types': len(enum_names),
            'verdict_counts': dict(verdict_counts),
            'drift_total_steps': drift_total,
            'drift_distinct_actions': sum(1 for r in action_rows if r['drift_hits'] > 0),
            'drift_unmapped_prefixes': drift_unmapped,
            'live_coverage': cov.get('summary', {}),
            'pattern_c_total': pc_total,
            'pattern_c_buckets': dict(pc_buckets),
            'port_audit_counts': audit_counts,
            'weighted_estimate': weighted,
        },
        'actions': action_rows,
        'oracles_by_area': dict(oracle_by_area),
        'pattern_c_catalog': {
            k: {'status': v[0], 'kind': v[1], 'js_site': v[2]}
            for k, v in cat.items()
        },
        'port_audit_top_missing': [
            {'js': p, 'loc': loc, 'fns': fns}
            for p, loc, fns in audit_missing_files[:30]
        ],
    }


def compute_weighted_estimate(action_rows: List[Dict], cov: Dict,
                              pc_buckets: collections.Counter,
                              pc_total: int) -> Dict:
    """Heuristic but transparent weighted completion estimate.

    Layers, each weighted by importance to AI training:
      - Ability resolution        weight 25  — most load-bearing
      - Combat math/primitives    weight 15
      - Action types verified     weight 20  — GOLD/SILVER count
      - Pattern C wired ratio     weight 10
      - CC effects                weight 10
      - Mission scoring           weight 10
      - Discord-flow handlers     weight 10  — lowest priority for AI
    """
    abilities = cov.get('summary', {}).get('abilities', {})
    cc = cov.get('summary', {}).get('cc', {})
    missions = cov.get('summary', {}).get('missions', {})

    def ratio(d, key='real', total='total'):
        t = d.get(total) or 1
        return (d.get(key) or 0) / t

    layers = [
        ('Ability resolution', 25, ratio(abilities, 'real')),
        ('Combat math/primitives', 15, 0.95),  # fuzzed, byte-identical
        ('Action types verified (GOLD+SILVER)', 20,
            sum(1 for r in action_rows if r['verdict'] in ('GOLD', 'SILVER'))
            / max(len(action_rows), 1)),
        ('Pattern C wired ratio', 10,
            (pc_buckets.get('wired-engine', 0) / pc_total) if pc_total else 0),
        ('Command card effects', 10, ratio(cc, 'real')),
        ('Mission scoring', 10, ratio(missions, 'validated', 'total')),
        ('Discord-flow handlers', 10, 0.10),  # mostly absent
    ]
    total_w = sum(w for _, w, _ in layers)
    score = sum(w * r for _, w, r in layers) / total_w
    return {
        'score': round(score * 100, 1),
        'layers': [
            {'layer': n, 'weight': w, 'ratio': round(r, 3),
             'contribution': round(w * r, 2)}
            for n, w, r in layers
        ],
    }


# ---------------------------------------------------------------------------
# Markdown writer
# ---------------------------------------------------------------------------

def write_markdown(report: Dict, out: Path) -> None:
    h = report['headline']
    cov = h['live_coverage']
    vc = h['verdict_counts']
    weighted = h['weighted_estimate']

    L = []
    L.append('# Coverage Audit — Single Source of Truth')
    L.append('')
    L.append(f"Regenerated: `{report['generated']}`. "
             f"Run `python3 python/parity/coverage_audit.py` to refresh.")
    L.append('')
    L.append('This report cross-references the action enum, drift recordings, '
             'oracle tests, the live dispatch probe, the Pattern C catalog, '
             'and the file-by-file shape audit. It answers two questions:')
    L.append('')
    L.append('1. **Have we ever observed each kind of action in a real game?**')
    L.append('2. **What\'s the honest, current completion estimate?**')
    L.append('')

    L.append('## Headline')
    L.append('')
    L.append(f"- **Weighted completion estimate: {weighted['score']}%** "
             '(layer-by-layer below)')
    L.append(f"- **Action types**: {h['action_types']} total, "
             f"{h['drift_distinct_actions']} ever observed in any drift recording")
    L.append(f"- **Drift evidence**: {h['drift_total_steps']:,} recorded steps "
             f"across {len(list(DRIFT_DIR.glob('*.jsonl')))} files")
    L.append(f"- **Live dispatch probe** (handler exists & runs): "
             f"DC abilities {cov.get('abilities', {}).get('real', 0)}/"
             f"{cov.get('abilities', {}).get('total', 0)}, "
             f"CC effects {cov.get('cc', {}).get('real', 0)}/"
             f"{cov.get('cc', {}).get('total', 0)}, "
             f"missions {cov.get('missions', {}).get('validated', 0)}/"
             f"{cov.get('missions', {}).get('total', 0)}, "
             f"action handlers {cov.get('actions', {}).get('registered', 0)}/"
             f"{cov.get('actions', {}).get('total', 0)}")
    L.append(f"- **Pattern C passives** wired vs deferred: "
             f"{h['pattern_c_buckets'].get('wired-engine', 0)}/"
             f"{h['pattern_c_total']} "
             f"(deferred: {sum(v for k, v in h['pattern_c_buckets'].items() if k.startswith('deferred-'))})")
    L.append('')

    L.append('## Verdict per action type')
    L.append('')
    L.append('Each of the 81 action types gets a medal based on three signals: '
             'is it registered in the stepper, does any oracle test reference it, '
             'has any drift recording exercised it.')
    L.append('')
    L.append('- **🥇 GOLD** — registered, oracle-tested, observed in drift')
    L.append('- **🥈 SILVER** — registered, observed in drift, no targeted oracle')
    L.append('- **🥉 BRONZE** — registered, oracle-tested, never seen in any recording')
    L.append('- **⬜ UNVERIFIED** — registered, no oracle, no drift evidence')
    L.append('- **🚫 UNREGISTERED** — enum value with no stepper handler')
    L.append('')
    L.append('Counts:')
    for v in ['GOLD', 'SILVER', 'BRONZE', 'UNVERIFIED', 'UNREGISTERED']:
        L.append(f'- {v}: **{vc.get(v, 0)}**')
    L.append('')

    # Per-row table, grouped by verdict
    order = ['GOLD', 'SILVER', 'BRONZE', 'UNVERIFIED', 'UNREGISTERED']
    rows_by_v = collections.defaultdict(list)
    for r in report['actions']:
        rows_by_v[r['verdict']].append(r)
    for v in order:
        rows = rows_by_v.get(v, [])
        if not rows:
            continue
        L.append(f'### {v} ({len(rows)})')
        L.append('')
        L.append('| Action | Drift hits | Drift files | Oracle tests |')
        L.append('|---|---|---|---|')
        for r in sorted(rows, key=lambda x: (-x['drift_hits'], x['enum'])):
            o = len(r['oracle_files'])
            L.append(f"| `{r['string']}` | {r['drift_hits']} "
                     f"| {len(r['drift_files'])} | {o} |")
        L.append('')

    L.append('## Pattern C catalog — passive abilities ledger')
    L.append('')
    L.append('Hand-maintained in `python/engine/abilities/pattern_c.py:_CATALOG`. '
             'Promoting an ability from `deferred-*` to `wired-engine` requires '
             'porting its consumption layer (combat handler, bridge, etc.).')
    L.append('')
    L.append('| Status bucket | Count |')
    L.append('|---|---|')
    for status, count in sorted(h['pattern_c_buckets'].items(),
                                  key=lambda kv: -kv[1]):
        L.append(f'| `{status}` | {count} |')
    L.append('')

    L.append('## Oracle tests by area')
    L.append('')
    L.append('| Area | Files | JS-parity | Snapshot | Probe | Unit | Test fns |')
    L.append('|---|---|---|---|---|---|---|')
    obs = report['oracles_by_area']
    for area in sorted(obs):
        b = obs[area]
        files = b['JS_PARITY'] + b['SNAPSHOT'] + b['PROBE'] + b['UNIT']
        L.append(f"| {area} | {files} | {b['JS_PARITY']} | {b['SNAPSHOT']} "
                 f"| {b['PROBE']} | {b['UNIT']} | {b['tests']} |")
    L.append('')

    L.append('## Top file-level gaps (from `port_audit.md`)')
    L.append('')
    L.append('Note: file-name match. Some "MISSING" entries are actually split '
             'across multiple Python files — this surfaces the largest 30 raw gaps '
             'so you can manually sift true missing vs. structurally split.')
    L.append('')
    L.append('| JS file | LOC | Fns |')
    L.append('|---|---|---|')
    for r in report['port_audit_top_missing']:
        L.append(f"| `{r['js']}` | {r['loc']} | {r['fns']} |")
    L.append('')

    L.append('## Weighted completion estimate')
    L.append('')
    L.append('Layer-by-layer breakdown. Weights reflect importance for AI training '
             '(ability resolution and combat are most load-bearing).')
    L.append('')
    L.append('| Layer | Weight | Ratio | Contribution |')
    L.append('|---|---|---|---|')
    for layer in weighted['layers']:
        L.append(f"| {layer['layer']} | {layer['weight']} "
                 f"| {layer['ratio']:.3f} | {layer['contribution']} |")
    L.append(f"| **Total** | **100** | — | **{weighted['score']}** |")
    L.append('')

    L.append('## What this audit *cannot* tell you')
    L.append('')
    L.append('- Whether a "real" handler is **correct** — only that it executes. '
             'Correctness lives in the oracle tests for that handler.')
    L.append('- Whether a SILVER/UNVERIFIED handler would crash under unusual '
             'state — synthetic ctx and drift coverage both bias toward common paths.')
    L.append('- Whether the Pattern C catalog\'s `wired-engine` claim corresponds '
             'to a real handler — that\'s a hand-maintained promise.')
    L.append('- Whether the file-name matcher in `port_audit.md` correctly '
             'attributes split-file ports — it does not.')
    L.append('')
    L.append('Closing the BRONZE/UNVERIFIED action types requires either '
             'fixing the JS recorder to drive mid-activation actions '
             '(attack/move/CC/choices), or building targeted scripted scenarios '
             'that exercise each handler against a JS fixture.')
    L.append('')

    out.write_text('\n'.join(L) + '\n')


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--refresh', action='store_true',
                   help='Rerun port_coverage.py first to refresh live numbers')
    args = p.parse_args()

    print('Building coverage audit...')
    report = build_report(refresh=args.refresh)
    json_out = DOCS / 'coverage_audit.json'
    md_out = DOCS / 'coverage_audit.md'
    json_out.write_text(json.dumps(report, indent=2, sort_keys=True))
    write_markdown(report, md_out)

    h = report['headline']
    print(f'  · wrote {json_out.relative_to(REPO)}')
    print(f'  · wrote {md_out.relative_to(REPO)}')
    print(f'  · weighted estimate: {h["weighted_estimate"]["score"]}%')
    print(f'  · action types observed in drift: '
          f'{h["drift_distinct_actions"]}/{h["action_types"]}')
    print(f'  · verdict counts: {h["verdict_counts"]}')


if __name__ == '__main__':
    main()
