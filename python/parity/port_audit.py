"""Port audit: build a JS↔Python inventory with honest status per file.

For each JS rules-logic file under src/game/, src/engine/, src/handlers/:
  - Find candidate Python counterpart(s) by file-name match
  - Count exported functions in JS vs top-level functions in Python
  - Report LOC / function count delta
  - Honest status (heuristic):
      MISSING        — no Python file with matching name pattern
      STUB-ONLY      — Python file exists but has ≤3 functions / <50 LOC
      PARTIAL        — Python file has some but <50% of JS functions
      COVERED        — Python function count ≥ JS function count
      UNVERIFIED     — Python exists; can't mechanically determine parity

This is a SIZE/SHAPE audit, not a correctness audit. It tells us where
there's code but doesn't guarantee the code is right. True correctness
requires behavioral parity tests (per-file or per-handler).
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

REPO = Path(__file__).resolve().parent.parent.parent
JS_ROOTS = [REPO / 'src' / 'game', REPO / 'src' / 'engine', REPO / 'src' / 'handlers']
PY_ROOTS = [REPO / 'python' / 'engine']


def js_files() -> List[Path]:
    out = []
    for root in JS_ROOTS:
        for p in root.rglob('*.js'):
            if p.name.endswith('.test.js'):
                continue
            out.append(p)
    return sorted(out)


def py_files() -> List[Path]:
    out = []
    for root in PY_ROOTS:
        for p in root.rglob('*.py'):
            if p.name.startswith('test_') or p.name == '__init__.py':
                continue
            out.append(p)
    return sorted(out)


def loc(p: Path) -> int:
    try:
        return sum(1 for _ in p.open('r', encoding='utf-8'))
    except Exception:
        return 0


JS_FN_RE = re.compile(r'^\s*(export\s+)?(async\s+)?function\s+(\w+)\s*\(',
                       re.MULTILINE)


def js_functions(p: Path) -> List[str]:
    try:
        txt = p.read_text(encoding='utf-8')
    except Exception:
        return []
    return [m.group(3) for m in JS_FN_RE.finditer(txt)]


PY_FN_RE = re.compile(r'^def\s+(\w+)\s*\(', re.MULTILINE)


def py_functions(p: Path) -> List[str]:
    try:
        txt = p.read_text(encoding='utf-8')
    except Exception:
        return []
    return [m.group(1) for m in PY_FN_RE.finditer(txt)]


def slugify_js(name: str) -> str:
    """Convert JS camelCase/kebab-case file stem to Python snake_case guess."""
    stem = name.replace('.js', '')
    # camelCase → snake_case
    s1 = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1_\2', stem)
    s1 = re.sub(r'([a-z\d])([A-Z])', r'\1_\2', s1)
    # kebab → snake
    s1 = s1.replace('-', '_').lower()
    return s1


def slugify_py(stem: str) -> str:
    return stem.lower()


def find_py_match(js_path: Path, py_paths: List[Path]) -> List[Path]:
    """Return candidate Python files whose stem matches the JS stem (snake-ified)."""
    js_slug = slugify_js(js_path.stem)
    # Also match without common suffixes like -helpers.
    js_slug_short = re.sub(r'_helpers$', '', js_slug)
    matches = []
    for p in py_paths:
        py_slug = slugify_py(p.stem)
        if py_slug == js_slug or py_slug == js_slug_short:
            matches.append(p)
        # Partial match: same root word.
        elif len(js_slug_short) > 4 and js_slug_short in py_slug:
            matches.append(p)
    return matches


def classify(js_path: Path, py_matches: List[Path]) -> Tuple[str, str]:
    """Return (status, note)."""
    js_fns = js_functions(js_path)
    js_loc = loc(js_path)
    if not py_matches:
        return ('MISSING', f'no python counterpart; JS has {len(js_fns)} fns, {js_loc} LOC')

    total_py_fns = sum(len(py_functions(p)) for p in py_matches)
    total_py_loc = sum(loc(p) for p in py_matches)

    if total_py_loc < 50 and total_py_fns <= 3:
        return ('STUB-ONLY', f'py={total_py_fns}fns/{total_py_loc}loc vs js={len(js_fns)}/{js_loc}')

    if len(js_fns) > 0 and total_py_fns < len(js_fns) * 0.5:
        return ('PARTIAL', f'py={total_py_fns}fns vs js={len(js_fns)}fns')

    if total_py_fns >= len(js_fns):
        return ('COVERED-BY-SHAPE', f'py={total_py_fns}fns ≥ js={len(js_fns)}fns '
                f'(py={total_py_loc}loc, js={js_loc}loc)')

    return ('UNVERIFIED', f'py={total_py_fns}fns/{total_py_loc}loc vs js={len(js_fns)}/{js_loc}')


def run_audit() -> Dict:
    js_list = js_files()
    py_list = py_files()
    rows = []
    status_counts = {
        'MISSING': 0, 'STUB-ONLY': 0, 'PARTIAL': 0,
        'COVERED-BY-SHAPE': 0, 'UNVERIFIED': 0,
    }
    for j in js_list:
        m = find_py_match(j, py_list)
        status, note = classify(j, m)
        status_counts[status] += 1
        rows.append({
            'js': str(j.relative_to(REPO)),
            'js_loc': loc(j),
            'js_fns': len(js_functions(j)),
            'py': [str(p.relative_to(REPO)) for p in m],
            'status': status,
            'note': note,
        })
    return {'rows': rows, 'counts': status_counts,
            'total_js': len(js_list), 'total_py': len(py_list)}


def write_markdown(report: Dict, out: Path) -> None:
    lines = [
        '# JS ↔ Python Port Audit',
        '',
        'Anti-backtracking inventory. SIZE/SHAPE heuristic only — high-value',
        'COVERED-BY-SHAPE entries still need behavioral verification before',
        'being marked COMPLETE. MISSING and STUB-ONLY are guaranteed gaps.',
        '',
        '## Summary',
        '',
        f'- Total JS rules-logic files: {report["total_js"]}',
        f'- Total Python engine files: {report["total_py"]}',
        '',
        'Status counts:',
        '',
    ]
    for k, v in report['counts'].items():
        lines.append(f'- **{k}**: {v}')
    lines.extend(['', '## Rows (sorted by JS LOC, largest first)', ''])
    lines.append('| Status | JS file | JS LOC | JS fns | Python counterpart(s) | Note |')
    lines.append('|---|---|---|---|---|---|')
    rows_sorted = sorted(report['rows'], key=lambda r: -r['js_loc'])
    for r in rows_sorted:
        py_str = ', '.join(r['py']) if r['py'] else '—'
        lines.append(
            f'| {r["status"]} | `{r["js"]}` | {r["js_loc"]} | {r["js_fns"]} '
            f'| {py_str} | {r["note"]} |'
        )
    out.write_text('\n'.join(lines) + '\n')


def main():
    report = run_audit()
    out = REPO / 'docs' / 'port_audit.md'
    out.parent.mkdir(exist_ok=True)
    write_markdown(report, out)
    print(f'Wrote {out}')
    print(f'Summary:')
    for k, v in report['counts'].items():
        print(f'  {k}: {v}')


if __name__ == '__main__':
    main()
