"""Aggregate per-step drift findings across all recorded traces.

Walks every .jsonl trace, replays it through Python, and bucketizes:
  - Top diverging state-fields (which JS state pieces does Python miss?)
  - Errors by action type (which handlers crash on real input?)
  - Top error messages (root-cause clustering)
  - First per-action-type divergence (canonical example for triage)

Output: docs/drift_findings.json + docs/drift_findings.md.

Run: PYTHONPATH=. python3 python/parity/drift_findings.py
"""
from __future__ import annotations
import collections
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DRIFT_DIR = REPO / 'python/parity/oracles/drift_traces'
DOCS = REPO / 'docs'

if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from python.parity.replay_harness import replay  # type: ignore


_FIELD_RE = re.compile(r'^\s*[+\-~]\s+([\w.\[\]\']+)')


def _action_key(custom_id: str) -> str:
    if not custom_id:
        return '?'
    segs = custom_id.split('_')
    if segs[0] in ('dc', 'combat', 'move', 'cc', 'phase', 'end', 'status', 'pass'):
        return '_'.join(segs[:2])
    return segs[0]


def main():
    field_counts = collections.Counter()
    err_action_counts = collections.Counter()
    err_msgs = collections.Counter()
    diff_action_counts = collections.Counter()
    first_diff_by_action: dict = {}
    first_err_by_action: dict = {}
    file_status = []

    files = sorted(DRIFT_DIR.glob('*.jsonl'))
    for path in files:
        summary = replay(path, max_diffs_per_step=999)
        diffs_total = summary.get('totalDiffs', 0)
        errs_total = summary.get('erroredSteps', 0)
        clean = diffs_total == 0 and errs_total == 0
        file_status.append({
            'file': path.name,
            'replayed': summary.get('replayedSteps', 0),
            'unsupported': summary.get('unsupportedSteps', 0),
            'errored': errs_total,
            'diffs': diffs_total,
            'clean': clean,
        })

        for step in summary.get('perStep', []):
            cid = step.get('customId') or ''
            ak = _action_key(cid)
            if step.get('status') == 'errored':
                err_action_counts[ak] += 1
                msg = (step.get('error') or '').strip()
                if msg:
                    err_msgs[msg[:120]] += 1
                if ak not in first_err_by_action:
                    first_err_by_action[ak] = {
                        'file': path.name, 'seq': step.get('seq'),
                        'customId': cid, 'error': msg[:300],
                    }
            for d in step.get('diffs', []):
                m = _FIELD_RE.match(d)
                top = (m.group(1).split('.')[0]
                       if m else d[:40])
                field_counts[top] += 1
            if step.get('diffs'):
                diff_action_counts[ak] += 1
                if ak not in first_diff_by_action:
                    first_diff_by_action[ak] = {
                        'file': path.name, 'seq': step.get('seq'),
                        'customId': cid,
                        'diffs': step['diffs'][:6],
                    }

    report = {
        'totals': {
            'files': len(files),
            'clean_files': sum(1 for f in file_status if f['clean']),
            'total_diffs': sum(f['diffs'] for f in file_status),
            'total_errors': sum(f['errored'] for f in file_status),
            'total_replayed': sum(f['replayed'] for f in file_status),
        },
        'top_diverging_fields': field_counts.most_common(30),
        'errors_by_action': err_action_counts.most_common(30),
        'top_error_messages': err_msgs.most_common(20),
        'diffs_by_action': diff_action_counts.most_common(30),
        'first_diff_by_action': first_diff_by_action,
        'first_error_by_action': first_err_by_action,
        'files': file_status,
    }
    DOCS.mkdir(exist_ok=True)
    (DOCS / 'drift_findings.json').write_text(json.dumps(report, indent=2))
    write_markdown(report)
    print(f"Wrote docs/drift_findings.{{json,md}}.  files={report['totals']['files']}  "
          f"clean={report['totals']['clean_files']}  "
          f"diffs={report['totals']['total_diffs']:,}  "
          f"errors={report['totals']['total_errors']:,}")


def write_markdown(report):
    L = []
    t = report['totals']
    L.append('# Drift Findings — what Python disagrees with JS about')
    L.append('')
    L.append(f'- Files replayed: **{t["files"]}** (clean: {t["clean_files"]})')
    L.append(f'- Steps replayed: **{t["total_replayed"]:,}**')
    L.append(f'- Diffs surfaced: **{t["total_diffs"]:,}**')
    L.append(f'- Steps that errored: **{t["total_errors"]:,}**')
    L.append('')
    L.append('## Top diverging state fields')
    L.append('')
    L.append('Each row: how many step-level diffs touched that top-level state field. '
             '"Top-level" = the first segment of the diff path (`figurePositions.1.X` → `figurePositions`).')
    L.append('')
    L.append('| # of diffs | Field |')
    L.append('|---|---|')
    for field, n in report['top_diverging_fields']:
        L.append(f'| {n:,} | `{field}` |')
    L.append('')
    L.append('## Errors by action type')
    L.append('')
    L.append('| # | Action prefix |')
    L.append('|---|---|')
    for k, n in report['errors_by_action']:
        L.append(f'| {n:,} | `{k}` |')
    L.append('')
    L.append('## Top error messages')
    L.append('')
    L.append('| # | Error |')
    L.append('|---|---|')
    for msg, n in report['top_error_messages']:
        safe = msg.replace('|', r'\|')[:100]
        L.append(f'| {n} | `{safe}` |')
    L.append('')
    L.append('## Diff-producing steps by action type')
    L.append('')
    L.append('| # | Action prefix |')
    L.append('|---|---|')
    for k, n in report['diffs_by_action']:
        L.append(f'| {n} | `{k}` |')
    L.append('')
    L.append('## First example diff per action type')
    L.append('')
    for k, ex in sorted(report['first_diff_by_action'].items()):
        L.append(f'### `{k}`')
        L.append('')
        L.append(f'- file: `{ex["file"]}`  seq: {ex["seq"]}  customId: `{ex["customId"]}`')
        L.append('- sample diffs:')
        L.append('```')
        for d in ex['diffs']:
            L.append(d)
        L.append('```')
        L.append('')
    L.append('## First error per action type')
    L.append('')
    L.append('| Action | File | Error |')
    L.append('|---|---|---|')
    for k, ex in sorted(report['first_error_by_action'].items()):
        safe = ex['error'][:80].replace('|', r'\|')
        L.append(f'| `{k}` | `{ex["file"]}` | `{safe}` |')
    L.append('')
    (DOCS / 'drift_findings.md').write_text('\n'.join(L) + '\n')


if __name__ == '__main__':
    main()
